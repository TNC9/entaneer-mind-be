import { Response } from 'express';
import { prisma } from '../prisma';
import { AuthRequest } from '../middleware/authMiddleware';


// ==================== HELPER FUNCTIONS ====================

/**
 * Validate if session time is within allowed hours (09:00 - 16:00)
 * Last slot: 15:00 - 16:00
 * Sessions must start at the top of each hour (9:00, 10:00, 11:00, etc.)
 */
const isValidSessionTime = (timeStart: Date): boolean => {
  const hours = timeStart.getUTCHours(); // UTC time
  const minutes = timeStart.getUTCMinutes(); // UTC time
  
  // Must start at the top of the hour (minutes = 0)
  if (minutes !== 0) return false;
  
  // Must be between 9:00 and 15:00 (last slot ends at 16:00)
  return hours >= 9 && hours <= 15;
};

// ==================== SLOT MANAGEMENT ====================

/**
 * Create available time slot for counselor (60 minutes, 15:00-16:00 only)
 */
export const createSlot = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { timeStart, roomId, sessionName } = req.body;

    // Validate counselor role
    const user = await prisma.user.findUnique({
      where: { userId },
      include: { counselorProfile: true }
    });

    if (!user || user.roleName !== 'counselor') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only counselors can create slots.'
      });
    }

    // Validate required fields
    if (!timeStart) {
      return res.status(400).json({
        success: false,
        message: 'timeStart is required'
      });
    }

    // Parse and validate time
    const startTime = new Date(timeStart);
    if (isNaN(startTime.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid timeStart format. Use ISO 8601 format.'
      });
    }

    // Validate session time (09:00 - 16:00, last slot 15:00-16:00)
    if (!isValidSessionTime(startTime)) {
      return res.status(400).json({
        success: false,
        message: 'Sessions can only be created between 09:00 - 16:00. Sessions must start at the top of the hour (9:00, 10:00, 11:00, etc.). Last slot is 15:00 - 16:00.',
        allowedTimes: '09:00, 10:00, 11:00, 12:00, 13:00, 14:00, 15:00'
      });
    }

    // Check if time is in the past
    if (startTime < new Date()) {
      return res.status(400).json({
        success: false,
        message: 'Cannot create slot in the past'
      });
    }

    // Calculate end time (60 minutes from start)
    const endTime = new Date(startTime.getTime() + 60 * 60 * 1000);

    // Validate room if provided
    if (roomId) {
      const room = await prisma.room.findUnique({
        where: { roomId: parseInt(roomId) }
      });

      if (!room) {
        return res.status(404).json({
          success: false,
          message: `Room with ID ${roomId} not found`
        });
      }

      if (!room.isActive) {
        return res.status(400).json({
          success: false,
          message: `Room ${room.roomName} is not active`
        });
      }
    }

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
      return res.status(409).json({
        success: false,
        message: 'Time slot conflicts with existing slot',
        conflictingSlot: {
          sessionId: overlappingSlot.sessionId,
          timeStart: overlappingSlot.timeStart,
          timeEnd: overlappingSlot.timeEnd
        }
      });
    }

    // Create the session slot
    const session = await prisma.session.create({
      data: {
        sessionName: sessionName || 'Available Slot',
        timeStart: startTime,
        timeEnd: endTime,
        roomId: roomId ? parseInt(roomId) : null,
        status: 'available',
        counselorId: userId,
        caseId: null
      },
      include: {
        room: true
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
        room: session.room ? {
          roomId: session.room.roomId,
          roomName: session.room.roomName
        } : null,
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
};

/**
 * Get counselor's own schedule
 */
export const getCounselorSchedule = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { status, startDate, endDate } = req.query;

    // Validate counselor role
    const user = await prisma.user.findUnique({
      where: { userId },
      include: { counselorProfile: true }
    });

    if (!user || user.roleName !== 'counselor') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only counselors can view schedule.'
      });
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

    // Fetch sessions with related case and client info
    const sessions = await prisma.session.findMany({
      where: whereConditions,
      include: {
        room: true,
        case: {
          include: {
            client: {
              include: {
                user: {
                  select: {
                    firstName: true,
                    lastName: true,
                    cmuAccount: true,
                    phoneNum: true
                  }
                }
              }
            }
          }
        },
        problemTags: true
      },
      orderBy: {
        timeStart: 'asc'
      }
    });

    // Format response
    const formattedSessions = sessions.map(session => ({
      sessionId: session.sessionId,
      sessionName: session.sessionName,
      sessionToken: session.sessionToken,
      timeStart: session.timeStart,
      timeEnd: session.timeEnd,
      room: session.room ? {
        roomId: session.room.roomId,
        roomName: session.room.roomName
      } : null,
      status: session.status,
      duration: '60 minutes',
      createdAt: session.createdAt,
      problemTags: session.problemTags.map(tag => tag.label),
      case: session.case ? {
        caseId: session.case.caseId,
        status: session.case.status,
        priority: session.case.priority,
        queueToken: session.case.queueToken,
        client: {
          clientId: session.case.client.clientId,
          name: `${session.case.client.user.firstName} ${session.case.client.user.lastName}`,
          cmuAccount: session.case.client.user.cmuAccount,
          major: session.case.client.major,
          department: session.case.client.department
        }
      } : null,
      counselorNote: session.counselorNote,
      counselorKeyword: session.counselorKeyword,
      moodScale: session.moodScale
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
          cmuAccount: user.cmuAccount,
          counselorNumber: user.counselorProfile?.counselorNumber
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
};

/**
 * Delete an available time slot
 */
export const deleteSlot = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const sessionId = parseInt(req.params.sessionId);

    // Validate counselor role
    const user = await prisma.user.findUnique({
      where: { userId },
      include: { counselorProfile: true }
    });

    if (!user || user.roleName !== 'counselor') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only counselors can delete slots.'
      });
    }

    if (isNaN(sessionId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid sessionId'
      });
    }

    // Check if session exists
    const session = await prisma.session.findUnique({
      where: { sessionId },
      include: {
        case: {
          include: {
            client: {
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
      return res.status(404).json({
        success: false,
        message: `Session with ID ${sessionId} not found`
      });
    }

    // Check ownership
    if (session.counselorId !== userId) {
      return res.status(403).json({
        success: false,
        message: 'You can only delete your own slots'
      });
    }

    // Check if session is available
    if (session.status !== 'available') {
      return res.status(400).json({
        success: false,
        message: `Cannot delete slot with status: ${session.status}`,
        reason: session.status === 'booked' 
          ? 'This slot is already booked by a client'
          : session.status === 'completed'
          ? 'This slot has been completed'
          : 'This slot cannot be deleted'
      });
    }

    // Check if slot is in the past
    if (session.timeStart && session.timeStart < new Date()) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete a slot that has already passed'
      });
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
        timeEnd: session.timeEnd
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
};

/**
 * Update an available time slot
 */
export const updateSlot = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const sessionId = parseInt(req.params.sessionId);
    const { timeStart, roomId, sessionName } = req.body;

    // Validate counselor role
    const user = await prisma.user.findUnique({
      where: { userId },
      include: { counselorProfile: true }
    });

    if (!user || user.roleName !== 'counselor') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only counselors can update slots.'
      });
    }

    if (isNaN(sessionId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid sessionId'
      });
    }

    // Check if session exists
    const session = await prisma.session.findUnique({
      where: { sessionId }
    });

    if (!session) {
      return res.status(404).json({
        success: false,
        message: `Session with ID ${sessionId} not found`
      });
    }

    // Check ownership
    if (session.counselorId !== userId) {
      return res.status(403).json({
        success: false,
        message: 'You can only update your own slots'
      });
    }

    // Check if session is available
    if (session.status !== 'available') {
      return res.status(400).json({
        success: false,
        message: `Cannot update slot with status: ${session.status}`
      });
    }

    // Prepare update data
    const updateData: any = {};

    // Update time if provided
    if (timeStart) {
      const newStartTime = new Date(timeStart);
      
      if (isNaN(newStartTime.getTime())) {
        return res.status(400).json({
          success: false,
          message: 'Invalid timeStart format'
        });
      }

      // Validate session time (09:00 - 16:00, last slot 15:00-16:00)
      if (!isValidSessionTime(newStartTime)) {
        return res.status(400).json({
          success: false,
          message: 'Sessions can only be scheduled between 09:00 - 16:00. Sessions must start at the top of the hour. Last slot is 15:00 - 16:00.',
          allowedTimes: '09:00, 10:00, 11:00, 12:00, 13:00, 14:00, 15:00'
        });
      }

      if (newStartTime < new Date()) {
        return res.status(400).json({
          success: false,
          message: 'Cannot set slot time in the past'
        });
      }

      // Check for overlaps
      const newEndTime = new Date(newStartTime.getTime() + 60 * 60 * 1000);
      
      const overlappingSlot = await prisma.session.findFirst({
        where: {
          counselorId: userId,
          sessionId: { not: sessionId },
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
        return res.status(409).json({
          success: false,
          message: 'New time conflicts with existing slot'
        });
      }

      updateData.timeStart = newStartTime;
      updateData.timeEnd = newEndTime;
    }

    // Update room if provided
    if (roomId !== undefined) {
      if (roomId) {
        const room = await prisma.room.findUnique({
          where: { roomId: parseInt(roomId) }
        });

        if (!room) {
          return res.status(404).json({
            success: false,
            message: `Room with ID ${roomId} not found`
          });
        }

        if (!room.isActive) {
          return res.status(400).json({
            success: false,
            message: `Room ${room.roomName} is not active`
          });
        }

        updateData.roomId = parseInt(roomId);
      } else {
        updateData.roomId = null;
      }
    }

    // Update sessionName if provided
    if (sessionName !== undefined) {
      updateData.sessionName = sessionName;
    }

    // Check if there's anything to update
    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No fields to update'
      });
    }

    // Update the session
    const updatedSession = await prisma.session.update({
      where: { sessionId },
      data: updateData,
      include: { room: true }
    });

    res.status(200).json({
      success: true,
      message: 'Time slot updated successfully',
      data: {
        sessionId: updatedSession.sessionId,
        sessionName: updatedSession.sessionName,
        timeStart: updatedSession.timeStart,
        timeEnd: updatedSession.timeEnd,
        room: updatedSession.room ? {
          roomId: updatedSession.room.roomId,
          roomName: updatedSession.room.roomName
        } : null,
        status: updatedSession.status,
        duration: '60 minutes'
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
};

// ==================== USER MANAGEMENT ====================

/**
 * Promote a user to counselor role
 */
export const promoteUser = async (req: AuthRequest, res: Response) => {
  try {
    const counselorUserId = req.user?.userId;
    const { userId, counselorNumber } = req.body;

    // Validate counselor role
    const counselor = await prisma.user.findUnique({
      where: { userId: counselorUserId },
      include: { counselorProfile: true }
    });

    if (!counselor || counselor.roleName !== 'counselor') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only counselors can promote users.'
      });
    }

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'userId is required'
      });
    }

    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { userId: parseInt(userId) },
      include: { counselorProfile: true }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: `User with ID ${userId} not found`
      });
    }

    // Check if already a counselor
    if (user.counselorProfile) {
      return res.status(400).json({
        success: false,
        message: `User ${user.firstName} ${user.lastName} is already a counselor`
      });
    }

    // Perform promotion
    const result = await prisma.$transaction(async (tx) => {
      const updatedUser = await tx.user.update({
        where: { userId: parseInt(userId) },
        data: { roleName: 'counselor' }
      });

      const counselorProfile = await tx.counselor.create({
        data: {
          userId: parseInt(userId),
          counselorNumber: counselorNumber || null
        }
      });

      return { updatedUser, counselorProfile };
    });

    res.status(200).json({
      success: true,
      message: 'User successfully promoted to counselor',
      data: {
        userId: result.updatedUser.userId,
        name: `${result.updatedUser.firstName} ${result.updatedUser.lastName}`,
        previousRole: user.roleName,
        newRole: result.updatedUser.roleName,
        counselorNumber: result.counselorProfile.counselorNumber,
        promotedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Error promoting user:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
    });
  }
};

/**
 * Get list of all users
 */
export const getAllUsers = async (req: AuthRequest, res: Response) => {
  try {
    const counselorUserId = req.user?.userId;
    const { role } = req.query;

    // Validate counselor role
    const counselor = await prisma.user.findUnique({
      where: { userId: counselorUserId }
    });

    if (!counselor || counselor.roleName !== 'counselor') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only counselors can view user list.'
      });
    }

    // Build filter
    const whereConditions: any = {};
    if (role && typeof role === 'string') {
      whereConditions.roleName = role;
    }

    // Fetch users
    const users = await prisma.user.findMany({
      where: whereConditions,
      include: {
        clientProfile: {
          include: {
            cases: {
              select: {
                caseId: true,
                status: true
              }
            }
          }
        },
        counselorProfile: {
          include: {
            sessions: {
              select: {
                sessionId: true,
                status: true
              }
            }
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    // Format response
    const formattedUsers = users.map(user => {
      const baseData = {
        userId: user.userId,
        name: `${user.firstName} ${user.lastName}`,
        firstName: user.firstName,
        lastName: user.lastName,
        cmuAccount: user.cmuAccount,
        phoneNum: user.phoneNum,
        gender: user.gender,
        roleName: user.roleName,
        createdAt: user.createdAt,
        isConsentAccepted: user.isConsentAccepted,
        consentAcceptedAt: user.consentAcceptedAt
      };

      if (user.roleName === 'client' && user.clientProfile) {
        return {
          ...baseData,
          clientId: user.clientProfile.clientId,
          major: user.clientProfile.major,
          department: user.clientProfile.department,
          caseStats: {
            total: user.clientProfile.cases.length,
            active: user.clientProfile.cases.filter(c => 
              ['waiting_confirmation', 'confirmed', 'in_progress'].includes(c.status)
            ).length,
            completed: user.clientProfile.cases.filter(c => c.status === 'completed').length
          }
        };
      }

      if (user.roleName === 'counselor' && user.counselorProfile) {
        return {
          ...baseData,
          counselorNumber: user.counselorProfile.counselorNumber,
          sessionStats: {
            total: user.counselorProfile.sessions.length,
            available: user.counselorProfile.sessions.filter(s => s.status === 'available').length,
            booked: user.counselorProfile.sessions.filter(s => s.status === 'booked').length,
            completed: user.counselorProfile.sessions.filter(s => s.status === 'completed').length
          }
        };
      }

      return baseData;
    });

    // Summary stats
    const summary = {
      total: users.length,
      byRole: {
        client: users.filter(u => u.roleName === 'client').length,
        counselor: users.filter(u => u.roleName === 'counselor').length
      },
      consentAccepted: users.filter(u => u.isConsentAccepted).length
    };

    res.status(200).json({
      success: true,
      message: 'Users retrieved successfully',
      data: {
        summary,
        users: formattedUsers
      }
    });

  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
    });
  }
};

/**
 * Update user role
 */
export const updateUserRole = async (req: AuthRequest, res: Response) => {
  try {
    const counselorUserId = req.user?.userId;
    const { userId } = req.params;
    const { roleName, counselorNumber } = req.body;

    // Validate counselor role
    const counselor = await prisma.user.findUnique({
      where: { userId: counselorUserId }
    });

    if (!counselor || counselor.roleName !== 'counselor') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only counselors can update user roles.'
      });
    }

    // Validate role
    if (!roleName || !['client', 'counselor'].includes(roleName)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid role. Must be either "client" or "counselor".'
      });
    }

    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { userId: parseInt(userId) },
      include: {
        clientProfile: true,
        counselorProfile: true
      }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: `User with ID ${userId} not found`
      });
    }

    // Prevent self-modification
    if (user.userId === counselorUserId) {
      return res.status(400).json({
        success: false,
        message: 'You cannot change your own role.'
      });
    }

    // Check if already has role
    if (user.roleName === roleName) {
      return res.status(400).json({
        success: false,
        message: `User already has role: ${roleName}`
      });
    }

    // Perform role update
    const result = await prisma.$transaction(async (tx) => {
      const previousRole = user.roleName;

      const updatedUser = await tx.user.update({
        where: { userId: parseInt(userId) },
        data: { roleName }
      });

      // Handle profile changes
      if (roleName === 'counselor' && !user.counselorProfile) {
        await tx.counselor.create({
          data: {
            userId: parseInt(userId),
            counselorNumber: counselorNumber || null
          }
        });
      } else if (roleName === 'client' && user.counselorProfile) {
        const activeSessions = await tx.session.count({
          where: {
            counselorId: parseInt(userId),
            status: { in: ['available', 'booked'] }
          }
        });

        if (activeSessions > 0) {
          throw new Error('Cannot demote counselor with active sessions');
        }

        await tx.counselor.delete({
          where: { userId: parseInt(userId) }
        });
      }

      if (roleName === 'client' && !user.clientProfile) {
        const clientId = `C${Date.now()}${user.userId}`;
        await tx.client.create({
          data: {
            userId: parseInt(userId),
            clientId: clientId
          }
        });
      } else if (roleName === 'counselor' && user.clientProfile) {
        const activeCases = await tx.case.count({
          where: {
            clientId: user.clientProfile.clientId,
            status: { in: ['waiting_confirmation', 'confirmed', 'in_progress'] }
          }
        });

        if (activeCases > 0) {
          throw new Error('Cannot change role of client with active cases');
        }

        await tx.client.delete({
          where: { userId: parseInt(userId) }
        });
      }

      return { updatedUser, previousRole };
    });

    res.status(200).json({
      success: true,
      message: 'User role updated successfully',
      data: {
        userId: result.updatedUser.userId,
        name: `${result.updatedUser.firstName} ${result.updatedUser.lastName}`,
        previousRole: result.previousRole,
        newRole: result.updatedUser.roleName
      }
    });

  } catch (error) {
    console.error('Error updating user role:', error);
    
    if ((error as Error).message.includes('active')) {
      return res.status(400).json({
        success: false,
        message: (error as Error).message
      });
    }

    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
    });
  }
};

/**
 * Get list of all counselors
 */
export const getAllCounselors = async (req: AuthRequest, res: Response) => {
  try {
    const counselorUserId = req.user?.userId;

    // Validate counselor role
    const counselor = await prisma.user.findUnique({
      where: { userId: counselorUserId }
    });

    if (!counselor || counselor.roleName !== 'counselor') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only counselors can view counselor list.'
      });
    }

    // Fetch all counselors
    const counselors = await prisma.counselor.findMany({
      include: {
        user: {
          select: {
            userId: true,
            cmuAccount: true,
            firstName: true,
            lastName: true,
            phoneNum: true,
            gender: true,
            createdAt: true
          }
        },
        sessions: {
          select: {
            sessionId: true,
            status: true
          }
        },
        cases: {
          select: {
            caseId: true,
            status: true
          }
        }
      }
    });

    // Format response
    const formattedCounselors = counselors.map(counselor => ({
      userId: counselor.user.userId,
      name: `${counselor.user.firstName} ${counselor.user.lastName}`,
      firstName: counselor.user.firstName,
      lastName: counselor.user.lastName,
      cmuAccount: counselor.user.cmuAccount,
      phoneNum: counselor.user.phoneNum,
      gender: counselor.user.gender,
      counselorNumber: counselor.counselorNumber,
      joinedAt: counselor.user.createdAt,
      sessionStats: {
        total: counselor.sessions.length,
        available: counselor.sessions.filter(s => s.status === 'available').length,
        booked: counselor.sessions.filter(s => s.status === 'booked').length,
        completed: counselor.sessions.filter(s => s.status === 'completed').length
      },
      caseStats: {
        total: counselor.cases.length,
        active: counselor.cases.filter(c => 
          ['waiting_confirmation', 'confirmed', 'in_progress'].includes(c.status)
        ).length,
        completed: counselor.cases.filter(c => c.status === 'completed').length
      }
    }));

    res.status(200).json({
      success: true,
      message: 'Counselors retrieved successfully',
      data: {
        totalCounselors: counselors.length,
        counselors: formattedCounselors
      }
    });

  } catch (error) {
    console.error('Error fetching counselors:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
    });
  }
};

// ==================== REPORT & ANALYTICS ====================

/**
 * Get full report with statistics
 */
export const getFullReport = async (req: AuthRequest, res: Response) => {
  try {
    const counselorUserId = req.user?.userId;
    const { startDate, endDate } = req.query;

    // Validate counselor role
    const counselor = await prisma.user.findUnique({
      where: { userId: counselorUserId }
    });

    if (!counselor || counselor.roleName !== 'counselor') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only counselors can access reports.'
      });
    }

    // Validate dates
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'startDate and endDate are required'
      });
    }

    const start = new Date(startDate as string);
    const end = new Date(endDate as string);
    end.setHours(23, 59, 59, 999);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid date format'
      });
    }

    const dateFilter = { gte: start, lte: end };

    // Fetch data
    const [cases, sessions, users] = await Promise.all([
      prisma.case.findMany({
        where: { createdAt: dateFilter },
        include: {
          client: { include: { user: true } },
          counselor: { include: { user: true } },
          sessions: { include: { problemTags: true } }
        }
      }),
      prisma.session.findMany({
        where: { createdAt: dateFilter },
        include: {
          problemTags: true,
          counselor: { include: { user: true } }
        }
      }),
      prisma.user.findMany({
        where: { createdAt: dateFilter },
        select: {
          userId: true,
          roleName: true,
          createdAt: true,
          isConsentAccepted: true
        }
      })
    ]);

    // Calculate stats
    const caseStats = {
      total: cases.length,
      byStatus: {
        waiting_confirmation: cases.filter(c => c.status === 'waiting_confirmation').length,
        confirmed: cases.filter(c => c.status === 'confirmed').length,
        in_progress: cases.filter(c => c.status === 'in_progress').length,
        completed: cases.filter(c => c.status === 'completed').length,
        cancelled: cases.filter(c => c.status === 'cancelled').length
      },
      byPriority: {
        high: cases.filter(c => c.priority === 'high').length,
        medium: cases.filter(c => c.priority === 'medium').length,
        low: cases.filter(c => c.priority === 'low').length
      },
      averageSessionsPerCase: cases.length > 0 
        ? cases.reduce((sum, c) => sum + c.sessions.length, 0) / cases.length 
        : 0
    };

    const sessionStats = {
      total: sessions.length,
      byStatus: {
        available: sessions.filter(s => s.status === 'available').length,
        booked: sessions.filter(s => s.status === 'booked').length,
        completed: sessions.filter(s => s.status === 'completed').length,
        cancelled: sessions.filter(s => s.status === 'cancelled').length
      },
      withNotes: sessions.filter(s => s.counselorNote).length,
      withMoodScale: sessions.filter(s => s.moodScale !== null).length
    };

    // Problem tags
    const problemTagCounts: Record<string, number> = {};
    sessions.forEach(session => {
      session.problemTags.forEach(tag => {
        problemTagCounts[tag.label] = (problemTagCounts[tag.label] || 0) + 1;
      });
    });

    const topProblemTags = Object.entries(problemTagCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([label, count]) => ({ label, count }));

    const userStats = {
      newUsers: users.length,
      byRole: {
        client: users.filter(u => u.roleName === 'client').length,
        counselor: users.filter(u => u.roleName === 'counselor').length
      },
      consentAccepted: users.filter(u => u.isConsentAccepted).length
    };

    // Counselor performance
    const counselorPerformance = await prisma.counselor.findMany({
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true
          }
        },
        cases: {
          where: { createdAt: dateFilter }
        },
        sessions: {
          where: { createdAt: dateFilter }
        }
      }
    });

    const counselorStats = counselorPerformance.map(c => ({
      counselorId: c.userId,
      name: `${c.user.firstName} ${c.user.lastName}`,
      counselorNumber: c.counselorNumber,
      casesHandled: c.cases.length,
      sessionsCreated: c.sessions.length,
      sessionsCompleted: c.sessions.filter(s => s.status === 'completed').length
    })).sort((a, b) => b.casesHandled - a.casesHandled);

    res.status(200).json({
      success: true,
      message: 'Report generated successfully',
      data: {
        reportPeriod: {
          startDate: start.toISOString(),
          endDate: end.toISOString()
        },
        caseStats,
        sessionStats,
        userStats,
        topProblemTags,
        counselorStats,
        generatedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Error generating report:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
    });
  }
};

/**
 * Get list of queue tokens
 */
export const getTokenList = async (req: AuthRequest, res: Response) => {
  try {
    const counselorUserId = req.user?.userId;
    const { sort = 'asc' } = req.query;

    // Validate counselor role
    const counselor = await prisma.user.findUnique({
      where: { userId: counselorUserId }
    });

    if (!counselor || counselor.roleName !== 'counselor') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only counselors can view token list.'
      });
    }

    // Validate sort
    if (sort !== 'asc' && sort !== 'desc') {
      return res.status(400).json({
        success: false,
        message: 'Invalid sort parameter. Use "asc" or "desc".'
      });
    }

    // Fetch cases with tokens
    const casesWithTokens = await prisma.case.findMany({
      where: {
        queueToken: { not: null }
      },
      include: {
        client: {
          include: {
            user: {
              select: {
                firstName: true,
                lastName: true,
                cmuAccount: true,
                phoneNum: true
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
        },
        sessions: {
          select: {
            sessionId: true,
            status: true,
            timeStart: true
          }
        }
      },
      orderBy: {
        queueToken: sort as 'asc' | 'desc'
      }
    });

    // Format response
    const formattedTokens = casesWithTokens.map(caseItem => ({
      caseId: caseItem.caseId,
      queueToken: caseItem.queueToken,
      status: caseItem.status,
      priority: caseItem.priority,
      createdAt: caseItem.createdAt,
      confirmedAt: caseItem.confirmedAt,
      waitingEnteredAt: caseItem.waitingEnteredAt,
      homeEnteredAt: caseItem.homeEnteredAt,
      client: {
        clientId: caseItem.client.clientId,
        name: `${caseItem.client.user.firstName} ${caseItem.client.user.lastName}`,
        cmuAccount: caseItem.client.user.cmuAccount,
        phoneNum: caseItem.client.user.phoneNum,
        major: caseItem.client.major,
        department: caseItem.client.department
      },
      counselor: caseItem.counselor ? {
        counselorId: caseItem.counselor.userId,
        name: `${caseItem.counselor.user.firstName} ${caseItem.counselor.user.lastName}`
      } : null,
      sessionCount: caseItem.sessions.length,
      upcomingSessions: caseItem.sessions.filter(s => 
        s.status === 'booked' && s.timeStart && s.timeStart > new Date()
      ).length
    }));

    // Stats
    const stats = {
      total: casesWithTokens.length,
      byStatus: {
        waiting_confirmation: casesWithTokens.filter(c => c.status === 'waiting_confirmation').length,
        confirmed: casesWithTokens.filter(c => c.status === 'confirmed').length,
        in_progress: casesWithTokens.filter(c => c.status === 'in_progress').length,
        completed: casesWithTokens.filter(c => c.status === 'completed').length
      },
      byPriority: {
        high: casesWithTokens.filter(c => c.priority === 'high').length,
        medium: casesWithTokens.filter(c => c.priority === 'medium').length,
        low: casesWithTokens.filter(c => c.priority === 'low').length
      }
    };

    res.status(200).json({
      success: true,
      message: 'Queue tokens retrieved successfully',
      data: {
        sortOrder: sort,
        stats,
        tokens: formattedTokens
      }
    });

  } catch (error) {
    console.error('Error fetching tokens:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
    });
  }
};
