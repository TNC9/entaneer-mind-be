import { Request, Response } from 'express';
import { prisma } from '../prisma';
import { AuthRequest } from '../middleware/authMiddleware';

// Search available slots
export const searchSlots = async (req: Request, res: Response) => {
  try {
    const { date } = req.query;
    
    let dateFilter = {};
    if (date) {
      // Create separate Date objects to avoid mutation
      const targetDate = new Date(date as string);
      const startOfDay = new Date(targetDate);
      startOfDay.setHours(0, 0, 0, 0);
      
      const endOfDay = new Date(targetDate);
      endOfDay.setHours(23, 59, 59, 999);
      
      dateFilter = {
        timeStart: {
          gte: startOfDay,
          lte: endOfDay
        }
      };
    } else {
      dateFilter = {
        timeStart: {
          gte: new Date()
        }
      };
    }

    const availableSlots = await prisma.session.findMany({
      where: {
        status: 'available',
        ...dateFilter
      },
      include: {
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
        timeStart: 'asc'
      }
    });

    // Transform to match frontend TimeSlot interface
    const timeSlots = availableSlots.map((slot: any) => ({
      sessionId: slot.sessionId,
      time: new Date(slot.timeStart).toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: false 
      }),
      available: slot.status === 'available',
      counselor: `${slot.counselor?.user.firstName} ${slot.counselor?.user.lastName}`,
      sessionName: slot.sessionName,
      location: slot.location,
      timeStart: slot.timeStart,
      timeEnd: slot.timeEnd
    }));

    res.status(200).json({
      success: true,
      data: timeSlots
    });
  } catch (error) {
    console.error('Error searching slots:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search available slots'
    });
  }
};

// Book a slot
export const bookSlot = async (req: AuthRequest, res: Response) => {
  try {
    const { sessionId, description, date } = req.body;
    const userId = req.user?.userId;

    if (!sessionId || !userId) {
      return res.status(400).json({
        success: false,
        message: 'Session ID and user authentication required'
      });
    }

    // Get student information from userId
    const student = await prisma.student.findUnique({
      where: { userId }
    });

    if (!student) {
      return res.status(404).json({
        success: false,
        message: 'Student not found'
      });
    }

    // ATOMIC BOOKING: Use transaction to prevent race condition
    const result = await prisma.$transaction(async (tx: any) => {
      // First, atomically update session status if available
      const updatedSession = await tx.session.updateMany({
        where: {
          sessionId,
          status: 'available'
        },
        data: {
          status: 'booked'
        }
      });

      // If no session was updated, it means it was already booked
      if (updatedSession.count === 0) {
        throw new Error('Session is no longer available');
      }

      // Get the session details for case creation
      const session = await tx.session.findUnique({
        where: { sessionId },
        include: {
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
        throw new Error('Session not found');
      }

      // Create a case for this booking
      const newCase = await tx.case.create({
        data: {
          studentId: student.studentId,
          counselorId: session.counselorId,
          status: 'booked',
          topic: description || 'General counseling session'
        }
      });

      // Update session with caseId
      const finalSession = await tx.session.update({
        where: { sessionId },
        data: {
          caseId: newCase.caseId
        },
        include: {
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

      return { session: finalSession, case: newCase };
    });

    // Format response for frontend
    const bookingResponse = {
      sessionId: result.session.sessionId,
      time: new Date(result.session.timeStart).toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: false 
      }),
      counselor: `${result.session.counselor?.user.firstName} ${result.session.counselor?.user.lastName}`,
      sessionName: result.session.sessionName,
      location: result.session.location,
      date: date || new Date(result.session.timeStart).toLocaleDateString('th-TH', {
        month: 'short', 
        day: 'numeric', 
        year: 'numeric'
      }),
      description: description || 'General counseling session',
      caseId: result.case.caseId
    };

    res.status(200).json({
      success: true,
      message: 'Slot booked successfully',
      data: bookingResponse
    });
  } catch (error) {
    console.error('Error booking slot:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to book slot'
    });
  }
};

// Get student booking history
export const getStudentBookings = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    // Get student from userId
    const student = await prisma.student.findUnique({
      where: { userId }
    });

    if (!student) {
      return res.status(404).json({
        success: false,
        message: 'Student not found'
      });
    }

    const bookings = await prisma.case.findMany({
      where: {
        studentId: student.studentId
      },
      include: {
        sessions: {
          include: {
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
        counselor: `${session.counselor?.user.firstName} ${session.counselor?.user.lastName}`,
        status,
        notes: booking.topic || 'General counseling session',
        sessionId: session.sessionId,
        sessionName: session.sessionName,
        location: session.location
      };
    }).filter(Boolean); // Remove null entries

    res.status(200).json({
      success: true,
      data: appointments
    });
  } catch (error) {
    console.error('Error getting student bookings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve booking history'
    });
  }
};

// Cancel booking (with 24-hour validation)
export const cancelBooking = async (req: AuthRequest, res: Response) => {
  try {
    const { sessionId } = req.body;
    const userId = req.user?.userId;

    if (!sessionId || !userId) {
      return res.status(400).json({
        success: false,
        message: 'Session ID and user authentication required'
      });
    }

    // Get student from userId
    const student = await prisma.student.findUnique({
      where: { userId }
    });

    if (!student) {
      return res.status(404).json({
        success: false,
        message: 'Student not found'
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

    // Check if this booking belongs to the authenticated student
    if (!session.case || session.case.studentId !== student.studentId) {
      return res.status(403).json({
        success: false,
        message: 'You can only cancel your own bookings'
      });
    }

    // Check 24-hour rule
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
