import { Request, Response } from 'express';
import { prisma } from '../prisma';
import { AuthRequest } from '../middleware/authMiddleware';

const THAI_MONTHS: Record<string, number> = {
  'ม.ค.': 0,
  'ก.พ.': 1,
  'มี.ค.': 2,
  'เม.ย.': 3,
  'พ.ค.': 4,
  'มิ.ย.': 5,
  'ก.ค.': 6,
  'ส.ค.': 7,
  'ก.ย.': 8,
  'ต.ค.': 9,
  'พ.ย.': 10,
  'ธ.ค.': 11
};

const toTwoDigits = (value: number): string => (value < 10 ? `0${value}` : String(value));

const parseDateInput = (input: unknown): Date | null => {
  if (typeof input !== 'string' || input.trim().length === 0) {
    return null;
  }

  const normalized = input.trim();
  const directDate = new Date(normalized);
  if (!Number.isNaN(directDate.getTime())) {
    return directDate;
  }

  const thaiDateMatch = normalized.match(/^(\d{1,2})\s+([^\s]+)\s+(\d{4})$/u);
  if (!thaiDateMatch) {
    return null;
  }

  const day = Number(thaiDateMatch[1]);
  const monthToken = thaiDateMatch[2].trim();
  const thaiYear = Number(thaiDateMatch[3]);
  const month = THAI_MONTHS[monthToken];
  if (!Number.isInteger(day) || !Number.isInteger(thaiYear) || month === undefined) {
    return null;
  }

  const gregorianYear = thaiYear > 2400 ? thaiYear - 543 : thaiYear;
  const parsedDate = new Date(gregorianYear, month, day);
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
};

const normalizeTimeInput = (input: unknown): string | null => {
  if (typeof input !== 'string') {
    return null;
  }

  const trimmed = input.trim();
  const match = trimmed.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) {
    return null;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  return `${toTwoDigits(hour)}:${toTwoDigits(minute)}`;
};

const getDayRange = (date: Date) => {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);

  const end = new Date(date);
  end.setHours(23, 59, 59, 999);

  return { start, end };
};

const formatTime = (dateInput: Date | string | null): string => {
  if (!dateInput) {
    return '';
  }

  const date = new Date(dateInput);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
};

const getCounselorBaseName = (session: any): string => {
  const firstName = session?.counselor?.user?.firstName?.trim() || '';
  const lastName = session?.counselor?.user?.lastName?.trim() || '';
  const fullName = `${firstName} ${lastName}`.trim();
  if (fullName.length > 0) {
    return fullName;
  }
  return `Counselor #${session?.counselorId ?? '-'}`;
};

const formatCounselorDisplayName = (session: any): string => {
  const baseName = getCounselorBaseName(session);
  const roomName = session?.room?.roomName?.trim();
  return roomName ? `${baseName} (${roomName})` : baseName;
};

const normalizeCounselorName = (value: string): string =>
  value
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const toSlotPayload = (session: any) => ({
  sessionId: session.sessionId,
  time: formatTime(session.timeStart),
  available: session.status === 'available',
  counselor: formatCounselorDisplayName(session),
  counselorId: session.counselorId,
  sessionName: session.sessionName,
  location: session.room?.roomName || 'N/A',
  date: session.timeStart,
  day: session.timeStart ? new Date(session.timeStart).toISOString().slice(0, 10) : null,
  status: session.status
});

// Search available slots
export const searchSlots = async (req: Request, res: Response) => {
  try {
    const { date } = req.query;
    const parsedDate = date ? parseDateInput(date) : null;

    if (date && !parsedDate) {
      return res.status(400).json({
        success: false,
        message: 'Invalid date format'
      });
    }

    const dateFilter = parsedDate
      ? {
          timeStart: {
            gte: getDayRange(parsedDate).start,
            lte: getDayRange(parsedDate).end
          }
        }
      : {
          timeStart: {
            gte: new Date()
          }
        };

    const availableSlots = await prisma.session.findMany({
      where: { status: 'available', ...dateFilter },
      include: {
        room: true,
        counselor: { include: { user: { select: { firstName: true, lastName: true } } } }
      },
      orderBy: { timeStart: 'asc' }
    });

    const timeSlots = availableSlots.map(toSlotPayload);

    res.status(200).json({ success: true, data: timeSlots });
  } catch (error) {
    console.error('Error searching slots:', error);
    res.status(500).json({ success: false, message: 'Failed to search available slots' });
  }
};

// Get counselor schedule for today (or specific date)
export const getCounselorTodayAppointments = async (req: Request, res: Response) => {
  try {
    const { date, counselorId } = req.query;

    const targetDate = date ? parseDateInput(date) : new Date();
    if (!targetDate) {
      return res.status(400).json({
        success: false,
        message: 'Invalid date format'
      });
    }

    const parsedCounselorId =
      counselorId !== undefined && counselorId !== null
        ? Number(counselorId)
        : undefined;

    if (
      parsedCounselorId !== undefined &&
      (!Number.isInteger(parsedCounselorId) || parsedCounselorId <= 0)
    ) {
      return res.status(400).json({
        success: false,
        message: 'Invalid counselorId'
      });
    }

    const { start, end } = getDayRange(targetDate);

    const sessions = await prisma.session.findMany({
      where: {
        timeStart: {
          gte: start,
          lte: end
        },
        ...(parsedCounselorId ? { counselorId: parsedCounselorId } : {})
      },
      include: {
        room: true,
        counselor: {
          include: {
            user: {
              select: {
                firstName: true,
                lastName: true
              }
            }
          }
        }
      },
      orderBy: { timeStart: 'asc' }
    });

    res.status(200).json({
      success: true,
      data: sessions.map(toSlotPayload)
    });
  } catch (error) {
    console.error('Error getting counselor schedule:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get counselor schedule'
    });
  }
};

// Book a slot
export const bookSlot = async (req: AuthRequest, res: Response) => {
  try {
    const {
      sessionId,
      description,
      date,
      time,
      counselorName,
      counselorId,
      studentId,
      faculty,
      phone
    } = req.body;
    const client = req.client; // Pre-populated by middleware
    const userId = req.user?.userId;

    if (!client) {
      return res.status(401).json({
        success: false,
        message: 'Client authentication required'
      });
    }

    let selectedSession: any | null = null;

    if (sessionId) {
      selectedSession = await prisma.session.findFirst({
        where: {
          sessionId: Number(sessionId),
          status: 'available'
        },
        include: {
          room: true,
          counselor: {
            include: {
              user: {
                select: {
                  firstName: true,
                  lastName: true
                }
              }
            }
          }
        }
      });
    } else {
      const parsedDate = parseDateInput(date);
      const normalizedTime = normalizeTimeInput(time);
      if (!parsedDate || !normalizedTime) {
        return res.status(400).json({
          success: false,
          message: 'sessionId or valid date/time is required for booking'
        });
      }

      const { start, end } = getDayRange(parsedDate);
      const maybeCounselorId =
        counselorId !== undefined && counselorId !== null
          ? Number(counselorId)
          : undefined;

      const candidates = await prisma.session.findMany({
        where: {
          status: 'available',
          timeStart: {
            gte: start,
            lte: end
          },
          ...(maybeCounselorId && Number.isInteger(maybeCounselorId)
            ? { counselorId: maybeCounselorId }
            : {})
        },
        include: {
          room: true,
          counselor: {
            include: {
              user: {
                select: {
                  firstName: true,
                  lastName: true
                }
              }
            }
          }
        }
      });

      const byTime = candidates.filter((session: any) => {
        if (!session.timeStart) {
          return false;
        }
        return formatTime(session.timeStart) === normalizedTime;
      });

      const byCounselorName =
        typeof counselorName === 'string' && counselorName.trim().length > 0
          ? byTime.filter((session: any) => {
              const target = normalizeCounselorName(counselorName);
              const displayName = normalizeCounselorName(formatCounselorDisplayName(session));
              const baseName = normalizeCounselorName(getCounselorBaseName(session));
              return target === displayName || target === baseName;
            })
          : byTime;

      if (byCounselorName.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'No matching available session found for selected date/time'
        });
      }

      if (byCounselorName.length > 1) {
        return res.status(409).json({
          success: false,
          message: 'Multiple matching sessions found. Please provide sessionId.'
        });
      }

      selectedSession = byCounselorName[0];
    }

    if (!selectedSession) {
      return res.status(404).json({
        success: false,
        message: 'Session not found or no longer available'
      });
    }

    if (!selectedSession.timeStart) {
      return res.status(400).json({
        success: false,
        message: 'Selected session does not have a valid start time'
      });
    }

    // Enforce one active booking per client (matches frontend booking constraint)
    const existingActiveCase = await prisma.case.findFirst({
      where: {
        clientId: client.clientId,
        status: { not: 'cancelled' },
        sessions: {
          some: {
            timeStart: { gte: new Date() },
            status: { not: 'available' }
          }
        }
      },
      select: { caseId: true }
    });

    if (existingActiveCase) {
      return res.status(409).json({
        success: false,
        message: 'You already have an active appointment. Please cancel it before booking a new one.'
      });
    }

    // ATOMIC BOOKING: Use transaction to prevent race condition
    const result = await prisma.$transaction(async (tx: any) => {
      // First, atomically update session status if available
      const updatedSession = await tx.session.updateMany({
        where: {
          sessionId: selectedSession.sessionId,
          status: 'available'
        },
        data: {
          status: 'booked'
        }
      });

      // If no session was updated, it means it was already booked
      if (updatedSession.count === 0) {
        throw new Error('SESSION_NOT_AVAILABLE');
      }

      // Get the session details for case creation
      const session = await tx.session.findUnique({
        where: { sessionId: selectedSession.sessionId },
        include: {
          room: true,
          counselor: {
            include: {
              user: {
                select: {
                  firstName: true,
                  lastName: true
                }
              }
            }
          }
        }
      });

      if (!session) {
        throw new Error('SESSION_NOT_FOUND');
      }

      // Create a case for this booking
      const newCase = await tx.case.create({
        data: {
          clientId: client.clientId,
          counselorId: session.counselorId,
          status: 'booked',
        }
      });

      // Update session with caseId
      const finalSession = await tx.session.update({
        where: { sessionId: selectedSession.sessionId },
        data: {
          caseId: newCase.caseId
        },
        include: {
          room: true,
          counselor: {
            include: {
              user: {
                select: {
                  firstName: true,
                  lastName: true
                }
              }
            }
          }
        }
      });

      if (userId) {
        await tx.sessionHistory.create({
          data: {
            sessionId: finalSession.sessionId,
            action: 'booking_created',
            details: JSON.stringify({
              description: typeof description === 'string' ? description.trim() : null,
              studentId: typeof studentId === 'string' ? studentId.trim() : null,
              faculty: typeof faculty === 'string' ? faculty.trim() : null,
              phone: typeof phone === 'string' ? phone.trim() : null
            }),
            editedBy: userId
          }
        });
      }

      return { session: finalSession, case: newCase };
    });

    // Format response for frontend
    const sessionStart = result.session.timeStart ? new Date(result.session.timeStart) : null;
    const bookingResponse = {
      sessionId: result.session.sessionId,
      time: sessionStart ? formatTime(sessionStart) : normalizeTimeInput(time),
      counselor: formatCounselorDisplayName(result.session),
      sessionName: result.session.sessionName,
      location: result.session.room?.roomName || 'N/A',
      date:
        (typeof date === 'string' && date.trim().length > 0 ? date.trim() : undefined) ||
        (sessionStart
          ? sessionStart.toLocaleDateString('th-TH', {
              month: 'short',
              day: 'numeric',
              year: 'numeric'
            })
          : null),
      description:
        typeof description === 'string' && description.trim().length > 0
          ? description.trim()
          : 'General counseling session',
      caseId: result.case.caseId,
      counselorId: result.session.counselorId
    };

    res.status(200).json({
      success: true,
      message: 'Slot booked successfully',
      data: bookingResponse
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'SESSION_NOT_AVAILABLE') {
      return res.status(409).json({
        success: false,
        message: 'This slot was just booked by someone else. Please choose another time.'
      });
    }

    if (error instanceof Error && error.message === 'SESSION_NOT_FOUND') {
      return res.status(404).json({
        success: false,
        message: 'Session not found'
      });
    }

    console.error('Error booking slot:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to book slot'
    });
  }
};

// Get client booking history
export const getClientBookings = async (req: AuthRequest, res: Response) => {
  try {
    const client = req.client; // Pre-populated by middleware

    if (!client) {
      return res.status(401).json({
        success: false,
        message: 'client not authenticated'
      });
    }

    const bookings = await prisma.case.findMany({
      where: {
        clientId: client.clientId
      },
      include: {
        sessions: {
          include: {
            room: true,
            counselor: {
              include: {
                user: {
                  select: {
                    firstName: true,
                    lastName: true
                  }
                }
              }
            }
          }
        },
        counselor: {
          include: {
            user: {
              select: {
                firstName: true,
                lastName: true
              }
            }
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    // Transform to match frontend Appointment interface
    const appointments = bookings.map((booking: any) => {
      const session = booking.sessions[0]; // Get first session from case
      if (!session) return null;
      if (!session.timeStart) return null;

      const now = new Date();
      const sessionTime = new Date(session.timeStart);
      
      // Determine status based on session time and booking status
      let status: 'upcoming' | 'completed' | 'cancelled';
      if (booking.status === 'cancelled') {
        status = 'cancelled';
      } else if (sessionTime > now) {
        status = 'upcoming';
      } else {
        status = 'completed';
      }

      return {
        id: booking.caseId.toString(),
        caseId: booking.caseId,
        date: sessionTime.toLocaleDateString('th-TH', {
          day: 'numeric',
          month: 'short',
          year: 'numeric'
        }),
        time: sessionTime.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        }),
        counselor: formatCounselorDisplayName(session),
        status,
        notes: 'General counseling session',
        sessionId: session.sessionId,
        sessionName: session.sessionName,
        location: session.room?.roomName || 'N/A'
      };
    }).filter(Boolean); // Remove null entries

    res.status(200).json({
      success: true,
      data: appointments,
      hasExistingBooking: appointments.some((appointment: any) => appointment.status === 'upcoming')
    });
  } catch (error) {
    console.error('Error getting client bookings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve booking history'
    });
  }
};

// Cancel booking (with 24-hour validation)
export const cancelBooking = async (req: AuthRequest, res: Response) => {
  try {
    const body = (req as Request).body as { sessionId?: number | string };
    const sessionId = Number(body?.sessionId);
    const client = req.client; // Pre-populated by middleware

    if (!Number.isInteger(sessionId) || sessionId <= 0 || !client) {
      return res.status(400).json({
        success: false,
        message: 'Session ID and client authentication required'
      });
    }

    // Get the session
    const session = await prisma.session.findUnique({
      where: { sessionId },
      include: {
        case: true
      }
    });

    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found'
      });
    }

    // Check if this booking belongs to the authenticated client
    if (!session.case || session.case.clientId !== client.clientId) {
      return res.status(403).json({
        success: false,
        message: 'You can only cancel your own bookings'
      });
    }

    // Check 24-hour rule
    if (!session.timeStart) {
      return res.status(400).json({
        success: false,
        message: 'Session does not have a valid start time'
      });
    }

    const sessionTime = new Date(session.timeStart);
    const now = new Date();
    const hoursUntilSession = (sessionTime.getTime() - now.getTime()) / (1000 * 60 * 60);

    if (hoursUntilSession < 24) {
      return res.status(400).json({
        success: false,
        message: 'Cannot cancel bookings less than 24 hours before the session'
      });
    }

    // Use transaction to prevent race conditions
    await prisma.$transaction(async (tx: any) => {
      // Update case status
      await tx.case.update({
        where: { caseId: session.case!.caseId },
        data: { status: 'cancelled' }
      });

      // Update session back to available
      await tx.session.update({
        where: { sessionId },
        data: {
          status: 'available',
          caseId: null
        }
      });
    });

    res.status(200).json({
      success: true,
      message: 'Booking cancelled successfully',
      data: { sessionId }
    });
  } catch (error) {
    console.error('Error cancelling booking:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel booking'
    });
  }
};
