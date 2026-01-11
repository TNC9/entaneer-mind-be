import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken, AuthRequest } from '../middleware/authMiddleware';

const router = Router();
const prisma = new PrismaClient();

/**
 * POST /api/slots
 * Create available time slot for counselor (60 minutes)
 * @requires Authentication & Counselor role
 */
router.post('/api/slots', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { timeStart, location, sessionName } = req.body;

    // Validate counselor role
    const user = await prisma.user.findUnique({
      where: { userId },
      include: { counselorProfile: true }
    });

    if (!user || user.roleName !== 'counselor') {
      res.status(403).json({
        success: false,
        message: 'Access denied. Only counselors can create slots.'
      });
      return;
    }

    // Validate required fields
    if (!timeStart) {
      res.status(400).json({
        success: false,
        message: 'timeStart is required'
      });
      return;
    }

    // Parse and validate time
    const startTime = new Date(timeStart);
    if (isNaN(startTime.getTime())) {
      res.status(400).json({
        success: false,
        message: 'Invalid timeStart format. Use ISO 8601 format.'
      });
      return;
    }

    // Check if time is in the past
    if (startTime < new Date()) {
      res.status(400).json({
        success: false,
        message: 'Cannot create slot in the past'
      });
      return;
    }

    // Calculate end time (60 minutes from start)
    const endTime = new Date(startTime.getTime() + 60 * 60 * 1000);

    // Check for overlapping slots
    const overlappingSlot = await prisma.session.findFirst({
      where: {
        counselorId: userId,
        OR: [
          {
            AND: [
              { timeStart: { lte: startTime } },
              { timeEnd: { gt: startTime } }
            ]
          },
          {
            AND: [
              { timeStart: { lt: endTime } },
              { timeEnd: { gte: endTime } }
            ]
          },
          {
            AND: [
              { timeStart: { gte: startTime } },
              { timeEnd: { lte: endTime } }
            ]
          }
        ]
      }
    });

    if (overlappingSlot) {
      res.status(409).json({
        success: false,
        message: 'Time slot conflicts with existing slot',
        conflictingSlot: {
          sessionId: overlappingSlot.sessionId,
          timeStart: overlappingSlot.timeStart,
          timeEnd: overlappingSlot.timeEnd
        }
      });
      return;
    }

    // Create the session slot
    const session = await prisma.session.create({
      data: {
        sessionName: sessionName || 'Available Slot',
        timeStart: startTime,
        timeEnd: endTime,
        location: location || null,
        status: 'available',
        counselorId: userId,
        caseId: null
      }
    });

    res.status(201).json({
      success: true,
      message: 'Time slot created successfully',
      data: {
        sessionId: session.sessionId,
        sessionName: session.sessionName,
        timeStart: session.timeStart,
        timeEnd: session.timeEnd,
        location: session.location,
        status: session.status,
        duration: '60 minutes'
      }
    });

  } catch (error) {
    console.error('Error creating slot:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
    });
  }
});

/**
 * GET /api/counselor/schedule
 * Get counselor's own schedule
 * @requires Authentication & Counselor role
 */
router.get('/api/counselor/schedule', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { status, startDate, endDate } = req.query;

    // Validate counselor role
    const user = await prisma.user.findUnique({
      where: { userId },
      include: { counselorProfile: true }
    });

    if (!user || user.roleName !== 'counselor') {
      res.status(403).json({
        success: false,
        message: 'Access denied. Only counselors can view schedule.'
      });
      return;
    }

    // Build filter conditions
    const whereConditions: any = {
      counselorId: userId
    };

    // Filter by status if provided
    if (status && typeof status === 'string') {
      whereConditions.status = status;
    }

    // Filter by date range if provided
    if (startDate || endDate) {
      whereConditions.timeStart = {};
      
      if (startDate) {
        const start = new Date(startDate as string);
        if (!isNaN(start.getTime())) {
          whereConditions.timeStart.gte = start;
        }
      }
      
      if (endDate) {
        const end = new Date(endDate as string);
        if (!isNaN(end.getTime())) {
          whereConditions.timeStart.lte = end;
        }
      }
    }

    // Fetch sessions with related case and student info
    const sessions = await prisma.session.findMany({
      where: whereConditions,
      include: {
        case: {
          include: {
            student: {
              include: {
                user: {
                  select: {
                    firstName: true,
                    lastName: true,
                    cmuAccount: true
                  }
                }
              }
            }
          }
        }
      },
      orderBy: {
        timeStart: 'asc'
      }
    });

    // Format response
    const formattedSessions = sessions.map(session => ({
      sessionId: session.sessionId,
      sessionName: session.sessionName,
      timeStart: session.timeStart,
      timeEnd: session.timeEnd,
      location: session.location,
      status: session.status,
      duration: '60 minutes',
      createdAt: session.createdAt,
      case: session.case ? {
        caseId: session.case.caseId,
        topic: session.case.topic,
        status: session.case.status,
        student: {
          studentId: session.case.student.studentId,
          name: `${session.case.student.user.firstName} ${session.case.student.user.lastName}`,
          cmuAccount: session.case.student.user.cmuAccount
        }
      } : null
    }));

    // Calculate statistics
    const stats = {
      total: sessions.length,
      available: sessions.filter(s => s.status === 'available').length,
      booked: sessions.filter(s => s.status === 'booked').length,
      completed: sessions.filter(s => s.status === 'completed').length,
      cancelled: sessions.filter(s => s.status === 'cancelled').length
    };

    res.status(200).json({
      success: true,
      message: 'Schedule retrieved successfully',
      data: {
        counselor: {
          userId: user.userId,
          name: `${user.firstName} ${user.lastName}`,
          cmuAccount: user.cmuAccount
        },
        stats,
        sessions: formattedSessions
      }
    });

  } catch (error) {
    console.error('Error fetching schedule:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
    });
  }
});

/**
 * DELETE /api/slots/:sessionId
 * Delete an available time slot (only if not booked)
 * @requires Authentication & Counselor role
 */
router.delete('/api/slots/:sessionId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const sessionId = parseInt(req.params.sessionId);

    // Validate counselor role
    const user = await prisma.user.findUnique({
      where: { userId },
      include: { counselorProfile: true }
    });

    if (!user || user.roleName !== 'counselor') {
      res.status(403).json({
        success: false,
        message: 'Access denied. Only counselors can delete slots.'
      });
      return;
    }

    // Validate sessionId
    if (isNaN(sessionId)) {
      res.status(400).json({
        success: false,
        message: 'Invalid sessionId'
      });
      return;
    }

    // Check if session exists
    const session = await prisma.session.findUnique({
      where: { sessionId },
      include: {
        case: {
          include: {
            student: {
              include: {
                user: {
                  select: {
                    firstName: true,
                    lastName: true,
                    cmuAccount: true
                  }
                }
              }
            }
          }
        }
      }
    });

    if (!session) {
      res.status(404).json({
        success: false,
        message: `Session with ID ${sessionId} not found`
      });
      return;
    }

    // Check if this session belongs to the counselor
    if (session.counselorId !== userId) {
      res.status(403).json({
        success: false,
        message: 'You can only delete your own slots',
        sessionOwner: session.counselorId,
        yourId: userId
      });
      return;
    }

    // Check if session is available (not booked)
    if (session.status !== 'available') {
      res.status(400).json({
        success: false,
        message: `Cannot delete slot with status: ${session.status}`,
        reason: session.status === 'booked' 
          ? 'This slot is already booked by a student'
          : session.status === 'completed'
          ? 'This slot has been completed'
          : 'This slot cannot be deleted',
        session: {
          sessionId: session.sessionId,
          status: session.status,
          timeStart: session.timeStart,
          timeEnd: session.timeEnd,
          bookedBy: session.case ? {
            studentName: `${session.case.student.user.firstName} ${session.case.student.user.lastName}`,
            cmuAccount: session.case.student.user.cmuAccount
          } : null
        }
      });
      return;
    }

    // Check if slot is in the past
    if (session.timeStart < new Date()) {
      res.status(400).json({
        success: false,
        message: 'Cannot delete a slot that has already passed',
        slotTime: session.timeStart
      });
      return;
    }

    // Delete the session
    await prisma.session.delete({
      where: { sessionId }
    });

    res.status(200).json({
      success: true,
      message: 'Time slot deleted successfully',
      deletedSlot: {
        sessionId: session.sessionId,
        sessionName: session.sessionName,
        timeStart: session.timeStart,
        timeEnd: session.timeEnd,
        location: session.location,
        deletedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Error deleting slot:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
    });
  }
});

/**
 * PATCH /api/slots/:sessionId
 * Update an available time slot (only if not booked)
 * @requires Authentication & Counselor role
 */
router.patch('/api/slots/:sessionId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const sessionId = parseInt(req.params.sessionId);
    const { timeStart, location, sessionName } = req.body;

    // Validate counselor role
    const user = await prisma.user.findUnique({
      where: { userId },
      include: { counselorProfile: true }
    });

    if (!user || user.roleName !== 'counselor') {
      res.status(403).json({
        success: false,
        message: 'Access denied. Only counselors can update slots.'
      });
      return;
    }

    // Validate sessionId
    if (isNaN(sessionId)) {
      res.status(400).json({
        success: false,
        message: 'Invalid sessionId'
      });
      return;
    }

    // Check if session exists
    const session = await prisma.session.findUnique({
      where: { sessionId }
    });

    if (!session) {
      res.status(404).json({
        success: false,
        message: `Session with ID ${sessionId} not found`
      });
      return;
    }

    // Check ownership
    if (session.counselorId !== userId) {
      res.status(403).json({
        success: false,
        message: 'You can only update your own slots'
      });
      return;
    }

    // Check if session is available
    if (session.status !== 'available') {
      res.status(400).json({
        success: false,
        message: `Cannot update slot with status: ${session.status}. Only available slots can be updated.`
      });
      return;
    }

    // Prepare update data
    const updateData: any = {};

    // Update time if provided
    if (timeStart) {
      const newStartTime = new Date(timeStart);
      
      if (isNaN(newStartTime.getTime())) {
        res.status(400).json({
          success: false,
          message: 'Invalid timeStart format'
        });
        return;
      }

      if (newStartTime < new Date()) {
        res.status(400).json({
          success: false,
          message: 'Cannot set slot time in the past'
        });
        return;
      }

      // Check for overlaps with other slots (excluding current slot)
      const newEndTime = new Date(newStartTime.getTime() + 60 * 60 * 1000);
      
      const overlappingSlot = await prisma.session.findFirst({
        where: {
          counselorId: userId,
          sessionId: { not: sessionId }, // Exclude current slot
          OR: [
            {
              AND: [
                { timeStart: { lte: newStartTime } },
                { timeEnd: { gt: newStartTime } }
              ]
            },
            {
              AND: [
                { timeStart: { lt: newEndTime } },
                { timeEnd: { gte: newEndTime } }
              ]
            },
            {
              AND: [
                { timeStart: { gte: newStartTime } },
                { timeEnd: { lte: newEndTime } }
              ]
            }
          ]
        }
      });

      if (overlappingSlot) {
        res.status(409).json({
          success: false,
          message: 'New time conflicts with existing slot',
          conflictingSlot: {
            sessionId: overlappingSlot.sessionId,
            timeStart: overlappingSlot.timeStart,
            timeEnd: overlappingSlot.timeEnd
          }
        });
        return;
      }

      updateData.timeStart = newStartTime;
      updateData.timeEnd = newEndTime;
    }

    // Update location if provided
    if (location !== undefined) {
      updateData.location = location;
    }

    // Update sessionName if provided
    if (sessionName !== undefined) {
      updateData.sessionName = sessionName;
    }

    // Check if there's anything to update
    if (Object.keys(updateData).length === 0) {
      res.status(400).json({
        success: false,
        message: 'No fields to update. Provide timeStart, location, or sessionName.'
      });
      return;
    }

    // Update the session
    const updatedSession = await prisma.session.update({
      where: { sessionId },
      data: updateData
    });

    res.status(200).json({
      success: true,
      message: 'Time slot updated successfully',
      data: {
        sessionId: updatedSession.sessionId,
        sessionName: updatedSession.sessionName,
        timeStart: updatedSession.timeStart,
        timeEnd: updatedSession.timeEnd,
        location: updatedSession.location,
        status: updatedSession.status,
        duration: '60 minutes',
        updatedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Error updating slot:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
    });
  }
});

export default router;