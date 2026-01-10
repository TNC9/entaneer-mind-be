import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Search available slots
export const searchSlots = async (req: Request, res: Response) => {
  try {
    const { date } = req.query;
    
    let dateFilter = {};
    if (date) {
      const targetDate = new Date(date as string);
      const startOfDay = new Date(targetDate.setHours(0, 0, 0, 0));
      const endOfDay = new Date(targetDate.setHours(23, 59, 59, 999));
      
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
export const bookSlot = async (req: Request, res: Response) => {
  try {
    const { sessionId, description, date } = req.body;
    const studentId = (req as any).user.studentId;

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: 'Session ID is required'
      });
    }

    // Check if session exists and is available
    const session = await prisma.session.findUnique({
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
      return res.status(404).json({
        success: false,
        message: 'Session not found'
      });
    }

    if (session.status !== 'available') {
      return res.status(400).json({
        success: false,
        message: 'Session is not available for booking'
      });
    }

    // Get student information
    const student = await prisma.student.findUnique({
      where: { studentId }
    });

    if (!student) {
      return res.status(404).json({
        success: false,
        message: 'Student not found'
      });
    }

    // Create a case for this booking with description
    const newCase = await prisma.case.create({
      data: {
        studentId,
        counselorId: session.counselorId,
        status: 'booked',
        topic: description || 'General counseling session'
      }
    });

    // Update session status and link to case
    const updatedSession = await prisma.session.update({
      where: { sessionId },
      data: {
        status: 'booked',
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

    // Format response for frontend
    const bookingResponse = {
      sessionId: updatedSession.sessionId,
      time: new Date(updatedSession.timeStart).toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: false 
      }),
      counselor: `${updatedSession.counselor?.user.firstName} ${updatedSession.counselor?.user.lastName}`,
      sessionName: updatedSession.sessionName,
      location: updatedSession.location,
      date: date || new Date(updatedSession.timeStart).toLocaleDateString('th-TH', {
        month: 'short', 
        day: 'numeric', 
        year: 'numeric'
      }),
      description: description || 'General counseling session',
      caseId: newCase.caseId
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
export const getStudentBookings = async (req: Request, res: Response) => {
  try {
    const studentId = (req as any).user.studentId;

    const bookings = await prisma.case.findMany({
      where: {
        studentId
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
export const cancelBooking = async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.body;
    const studentId = (req as any).user.studentId;

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: 'Session ID is required'
      });
    }

    // Get session with case information
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

    // Verify this booking belongs to the student
    if (!session.case || session.case.studentId !== studentId) {
      return res.status(403).json({
        success: false,
        message: 'You can only cancel your own bookings'
      });
    }

    // Check if cancellation is at least 24 hours before the session
    const now = new Date();
    const sessionTime = new Date(session.timeStart);
    const timeDiff = sessionTime.getTime() - now.getTime();
    const hoursDiff = timeDiff / (1000 * 60 * 60);

    if (hoursDiff < 24) {
      return res.status(400).json({
        success: false,
        message: 'Bookings can only be cancelled at least 24 hours before the session time'
      });
    }

    // Update session status back to available and remove case association
    const updatedSession = await prisma.session.update({
      where: { sessionId },
      data: {
        status: 'available',
        caseId: null
      }
    });

    // Update case status
    await prisma.case.update({
      where: { caseId: session.case.caseId },
      data: {
        status: 'cancelled'
      }
    });

    res.status(200).json({
      success: true,
      message: 'Booking cancelled successfully',
      data: updatedSession
    });
  } catch (error) {
    console.error('Error cancelling booking:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel booking'
    });
  }
};
