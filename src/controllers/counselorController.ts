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

  if (minutes !== 0) return false;

  return hours >= 9 && hours <= 15;
};

/**
 * Queue token format example: 690001, 690002, ...
 * Uses Thai year last 2 digits as prefix.
 */
const generateCaseQueueToken = async (db: typeof prisma): Promise<string> => {
  const thaiYear = new Date().getFullYear() + 543;
  const prefix = String(thaiYear).slice(-2);

  const lastCase = await db.case.findFirst({
    where: {
      queueToken: {
        startsWith: prefix
      }
    },
    orderBy: {
      queueToken: 'desc'
    },
    select: {
      queueToken: true
    }
  });

  const lastRunning =
    lastCase?.queueToken && lastCase.queueToken.startsWith(prefix)
      ? parseInt(lastCase.queueToken.slice(2), 10)
      : 0;

  const nextRunning = Number.isNaN(lastRunning) ? 1 : lastRunning + 1;
  return `${prefix}${String(nextRunning).padStart(4, '0')}`;
};

// ==================== SLOT MANAGEMENT ====================

/**
 * Create available time slot for counselor (60 minutes)
 */
export const createSlot = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { timeStart, roomId, sessionName } = req.body;

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

    if (!timeStart) {
      return res.status(400).json({
        success: false,
        message: 'timeStart is required'
      });
    }

    const startTime = new Date(timeStart);
    if (isNaN(startTime.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid timeStart format. Use ISO 8601 format.'
      });
    }

    if (!isValidSessionTime(startTime)) {
      return res.status(400).json({
        success: false,
        message:
          'Sessions can only be created between 09:00 - 16:00. Sessions must start at the top of the hour (9:00, 10:00, 11:00, etc.). Last slot is 15:00 - 16:00.',
        allowedTimes: '09:00, 10:00, 11:00, 12:00, 13:00, 14:00, 15:00'
      });
    }

    if (startTime < new Date()) {
      return res.status(400).json({
        success: false,
        message: 'Cannot create slot in the past'
      });
    }

    const endTime = new Date(startTime.getTime() + 60 * 60 * 1000);

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

    const overlappingSlot = await prisma.session.findFirst({
      where: {
        counselorId: userId,
        OR: [
          {
            AND: [{ timeStart: { lte: startTime } }, { timeEnd: { gt: startTime } }]
          },
          {
            AND: [{ timeStart: { lt: endTime } }, { timeEnd: { gte: endTime } }]
          },
          {
            AND: [{ timeStart: { gte: startTime } }, { timeEnd: { lte: endTime } }]
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
        room: session.room
          ? {
              roomId: session.room.roomId,
              roomName: session.room.roomName
            }
          : null,
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

    const whereConditions: any = {
      counselorId: userId
    };

    if (status && typeof status === 'string') {
      whereConditions.status = status;
    }

    if (startDate || endDate) {
      whereConditions.timeStart = {};

      if (startDate) {
        const start = new Date(startDate as string);
        start.setHours(0, 0, 0, 0);
        if (!isNaN(start.getTime())) {
          whereConditions.timeStart.gte = start;
        }
      }

      if (endDate) {
        const end = new Date(endDate as string);
        end.setHours(23, 59, 59, 999);
        if (!isNaN(end.getTime())) {
          whereConditions.timeStart.lte = end;
        }
      }
    }

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

    const formattedSessions = sessions.map((session) => ({
      sessionId: session.sessionId,
      sessionName: session.sessionName,
      sessionToken: session.sessionToken,
      timeStart: session.timeStart,
      timeEnd: session.timeEnd,
      room: session.room
        ? {
            roomId: session.room.roomId,
            roomName: session.room.roomName
          }
        : null,
      status: session.status,
      duration: '60 minutes',
      createdAt: session.createdAt,
      problemTags: session.problemTags.map((tag) => tag.label),
      case: session.case
        ? {
            caseId: session.case.caseId,
            status: session.case.status,
            priority: session.case.priority,
            queueToken: session.case.queueToken,
            client: {
              clientId: session.case.client.clientId,
              name: `${session.case.client.user.firstName} ${session.case.client.user.lastName}`.trim(),
              cmuAccount: session.case.client.user.cmuAccount,
              major: session.case.client.major,
              department: session.case.client.department
            }
          }
        : null,
      counselorNote: session.counselorNote,
      counselorKeyword: session.counselorKeyword,
      moodScale: session.moodScale
    }));

    const stats = {
      total: sessions.length,
      available: sessions.filter((s) => s.status === 'available').length,
      booked: sessions.filter((s) => s.status === 'booked').length,
      completed: sessions.filter((s) => s.status === 'completed').length,
      cancelled: sessions.filter((s) => s.status === 'cancelled').length
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

    if (session.counselorId !== userId) {
      return res.status(403).json({
        success: false,
        message: 'You can only delete your own slots'
      });
    }

    if (session.status !== 'available') {
      return res.status(400).json({
        success: false,
        message: `Cannot delete slot with status: ${session.status}`,
        reason:
          session.status === 'booked'
            ? 'This slot is already booked by a client'
            : session.status === 'completed'
            ? 'This slot has been completed'
            : 'This slot cannot be deleted'
      });
    }

    if (session.timeStart && session.timeStart < new Date()) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete a slot that has already passed'
      });
    }

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

    const session = await prisma.session.findUnique({
      where: { sessionId }
    });

    if (!session) {
      return res.status(404).json({
        success: false,
        message: `Session with ID ${sessionId} not found`
      });
    }

    if (session.counselorId !== userId) {
      return res.status(403).json({
        success: false,
        message: 'You can only update your own slots'
      });
    }

    if (session.status !== 'available') {
      return res.status(400).json({
        success: false,
        message: `Cannot update slot with status: ${session.status}`
      });
    }

    const updateData: any = {};

    if (timeStart) {
      const newStartTime = new Date(timeStart);

      if (isNaN(newStartTime.getTime())) {
        return res.status(400).json({
          success: false,
          message: 'Invalid timeStart format'
        });
      }

      if (!isValidSessionTime(newStartTime)) {
        return res.status(400).json({
          success: false,
          message:
            'Sessions can only be scheduled between 09:00 - 16:00. Sessions must start at the top of the hour. Last slot is 15:00 - 16:00.',
          allowedTimes: '09:00, 10:00, 11:00, 12:00, 13:00, 14:00, 15:00'
        });
      }

      if (newStartTime < new Date()) {
        return res.status(400).json({
          success: false,
          message: 'Cannot set slot time in the past'
        });
      }

      const newEndTime = new Date(newStartTime.getTime() + 60 * 60 * 1000);

      const overlappingSlot = await prisma.session.findFirst({
        where: {
          counselorId: userId,
          sessionId: { not: sessionId },
          OR: [
            {
              AND: [{ timeStart: { lte: newStartTime } }, { timeEnd: { gt: newStartTime } }]
            },
            {
              AND: [{ timeStart: { lt: newEndTime } }, { timeEnd: { gte: newEndTime } }]
            },
            {
              AND: [{ timeStart: { gte: newStartTime } }, { timeEnd: { lte: newEndTime } }]
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

    if (sessionName !== undefined) {
      updateData.sessionName = sessionName;
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No fields to update'
      });
    }

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
        room: updatedSession.room
          ? {
              roomId: updatedSession.room.roomId,
              roomName: updatedSession.room.roomName
            }
          : null,
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

// ==================== WAITING CASE MANAGEMENT ====================

/**
 * Get waiting cases from Case table
 */
export const getWaitingCases = async (req: AuthRequest, res: Response) => {
  try {
    const counselorUserId = req.user?.userId;

    const counselor = await prisma.user.findUnique({
      where: { userId: counselorUserId }
    });

    if (!counselor || counselor.roleName !== 'counselor') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only counselors can view waiting cases.'
      });
    }

    const waitingCases = await prisma.case.findMany({
      where: {
        status: 'waiting_confirmation'
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
        }
      },
      orderBy: {
        createdAt: 'asc'
      }
    });

    const formattedCases = waitingCases.map((c) => ({
      caseId: c.caseId,
      status: c.status,
      priority: c.priority,
      queueToken: c.queueToken,
      waitingSince: c.waitingEnteredAt ?? c.createdAt,
      createdAt: c.createdAt,
      confirmedAt: c.confirmedAt,
      counselorId: c.counselorId,
      client: {
        clientId: c.client.clientId,
        name: `${c.client.user.firstName} ${c.client.user.lastName}`.trim(),
        cmuAccount: c.client.user.cmuAccount,
        phoneNum: c.client.user.phoneNum,
        major: c.client.major,
        department: c.client.department
      }
    }));

    return res.status(200).json({
      success: true,
      message: 'Waiting cases retrieved successfully',
      data: {
        total: formattedCases.length,
        cases: formattedCases
      }
    });
  } catch (error) {
    console.error('Error fetching waiting cases:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

/**
 * Confirm waiting case -> set status confirmed + confirmedAt + queueToken
 */
export const confirmWaitingCase = async (req: AuthRequest, res: Response) => {
  try {
    const counselorUserId = req.user?.userId;
    const caseId = parseInt(req.params.caseId);

    if (!counselorUserId || isNaN(caseId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid caseId'
      });
    }

    const counselor = await prisma.user.findUnique({
      where: { userId: counselorUserId }
    });

    if (!counselor || counselor.roleName !== 'counselor') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only counselors can confirm waiting cases.'
      });
    }

    const updatedCase = await prisma.$transaction(async (tx) => {
      const existingCase = await tx.case.findUnique({
        where: { caseId },
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
      });

      if (!existingCase) {
        throw new Error('CASE_NOT_FOUND');
      }

      if (existingCase.status !== 'waiting_confirmation') {
        throw new Error('CASE_NOT_WAITING');
      }

      const queueToken = existingCase.queueToken || (await generateCaseQueueToken(tx as any));

      return tx.case.update({
        where: { caseId },
        data: {
          status: 'confirmed',
          queueToken,
          confirmedAt: new Date(),
          counselorId: existingCase.counselorId ?? counselorUserId,
          waitingEnteredAt: existingCase.waitingEnteredAt ?? existingCase.createdAt
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
          }
        }
      });
    });

    return res.status(200).json({
      success: true,
      message: 'Case confirmed successfully',
      data: {
        caseId: updatedCase.caseId,
        status: updatedCase.status,
        queueToken: updatedCase.queueToken,
        confirmedAt: updatedCase.confirmedAt,
        counselorId: updatedCase.counselorId,
        client: {
          clientId: updatedCase.client.clientId,
          name: `${updatedCase.client.user.firstName} ${updatedCase.client.user.lastName}`.trim(),
          cmuAccount: updatedCase.client.user.cmuAccount,
          phoneNum: updatedCase.client.user.phoneNum
        }
      }
    });
  } catch (error) {
    console.error('Error confirming waiting case:', error);

    const msg = (error as Error).message;
    if (msg === 'CASE_NOT_FOUND') {
      return res.status(404).json({
        success: false,
        message: 'Case not found'
      });
    }

    if (msg === 'CASE_NOT_WAITING') {
      return res.status(400).json({
        success: false,
        message: 'Only waiting_confirmation cases can be confirmed'
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Internal server error'
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

    if (user.counselorProfile) {
      return res.status(400).json({
        success: false,
        message: `User ${user.firstName} ${user.lastName} is already a counselor`
      });
    }

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

    const counselor = await prisma.user.findUnique({
      where: { userId: counselorUserId }
    });

    if (!counselor || counselor.roleName !== 'counselor') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only counselors can view user list.'
      });
    }

    const whereConditions: any = {};
    if (role && typeof role === 'string') {
      whereConditions.roleName = role;
    }

    const users = await prisma.user.findMany({
      where: whereConditions,
      include: {
        clientProfile: {
          include: {
            cases: {
              select: {
                caseId: true,
                status: true,
                priority: true,
                createdAt: true,
                confirmedAt: true,
                queueToken: true
              },
              orderBy: {
                createdAt: 'desc'
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

    const formattedUsers = users.map((user) => {
      const waitingCase =
        user.clientProfile?.cases.find((c) => c.status === 'waiting_confirmation') ?? null;

      const baseData = {
        userId: user.userId,
        name: `${user.firstName} ${user.lastName}`.trim(),
        firstName: user.firstName,
        lastName: user.lastName,
        cmuAccount: user.cmuAccount,
        phoneNum: user.phoneNum,
        gender: user.gender,
        roleName: user.roleName,
        createdAt: user.createdAt,
        isConsentAccepted: user.isConsentAccepted,
        consentAcceptedAt: user.consentAcceptedAt,
        status:
          user.roleName === 'client' && waitingCase
            ? 'pending'
            : 'active',
        pendingCaseId: waitingCase?.caseId ?? null,
        pendingPriority: waitingCase?.priority ?? null
      };

      if (user.roleName === 'client' && user.clientProfile) {
        return {
          ...baseData,
          clientId: user.clientProfile.clientId,
          major: user.clientProfile.major,
          department: user.clientProfile.department,
          caseStats: {
            total: user.clientProfile.cases.length,
            active: user.clientProfile.cases.filter((c) =>
              ['waiting_confirmation', 'confirmed', 'in_progress'].includes(c.status)
            ).length,
            completed: user.clientProfile.cases.filter((c) => c.status === 'completed').length
          }
        };
      }

      if (user.roleName === 'counselor' && user.counselorProfile) {
        return {
          ...baseData,
          counselorNumber: user.counselorProfile.counselorNumber,
          sessionStats: {
            total: user.counselorProfile.sessions.length,
            available: user.counselorProfile.sessions.filter((s) => s.status === 'available').length,
            booked: user.counselorProfile.sessions.filter((s) => s.status === 'booked').length,
            completed: user.counselorProfile.sessions.filter((s) => s.status === 'completed').length
          }
        };
      }

      return baseData;
    });

    const summary = {
      total: users.length,
      byRole: {
        client: users.filter((u) => u.roleName === 'client').length,
        counselor: users.filter((u) => u.roleName === 'counselor').length
      },
      consentAccepted: users.filter((u) => u.isConsentAccepted).length,
      pending: formattedUsers.filter((u: any) => u.status === 'pending').length
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

    const counselor = await prisma.user.findUnique({
      where: { userId: counselorUserId }
    });

    if (!counselor || counselor.roleName !== 'counselor') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only counselors can update user roles.'
      });
    }

    if (!roleName || !['client', 'counselor'].includes(roleName)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid role. Must be either "client" or "counselor".'
      });
    }

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

    if (user.userId === counselorUserId) {
      return res.status(400).json({
        success: false,
        message: 'You cannot change your own role.'
      });
    }

    if (user.roleName === roleName) {
      return res.status(400).json({
        success: false,
        message: `User already has role: ${roleName}`
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      const previousRole = user.roleName;

      const updatedUser = await tx.user.update({
        where: { userId: parseInt(userId) },
        data: { roleName }
      });

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
            clientId
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
          await tx.case.updateMany({
            where: {
              clientId: user.clientProfile.clientId,
              status: { in: ['waiting_confirmation', 'confirmed', 'in_progress'] }
            },
            data: { status: 'cancelled' }
          });
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

    const counselor = await prisma.user.findUnique({
      where: { userId: counselorUserId }
    });

    if (!counselor || counselor.roleName !== 'counselor') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only counselors can view counselor list.'
      });
    }

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

    const formattedCounselors = counselors.map((counselor) => ({
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
        available: counselor.sessions.filter((s) => s.status === 'available').length,
        booked: counselor.sessions.filter((s) => s.status === 'booked').length,
        completed: counselor.sessions.filter((s) => s.status === 'completed').length
      },
      caseStats: {
        total: counselor.cases.length,
        active: counselor.cases.filter((c) =>
          ['waiting_confirmation', 'confirmed', 'in_progress'].includes(c.status)
        ).length,
        completed: counselor.cases.filter((c) => c.status === 'completed').length
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

    const counselor = await prisma.user.findUnique({
      where: { userId: counselorUserId }
    });

    if (!counselor || counselor.roleName !== 'counselor') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only counselors can access reports.'
      });
    }

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
        where: { timeStart: dateFilter },
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
    const appointmentSessions = sessions.filter((s) =>['booked', 'completed'].includes(s.status));

    const casesWithWait = cases.filter((c) => c.confirmedAt && c.createdAt);
    const averageWaitDays =
      casesWithWait.length > 0
        ? Math.round(
            casesWithWait.reduce((sum, c) => {
              const diff =
                new Date(c.confirmedAt!).getTime() - new Date(c.createdAt).getTime();
              return sum + diff / (1000 * 60 * 60 * 24);
            }, 0) / casesWithWait.length
          )
        : 0;

    const departmentCounts: Record<string, number> = {};
    cases.forEach((c) => {
      const dept = c.client.department || 'อื่นๆ';
      departmentCounts[dept] = (departmentCounts[dept] || 0) + 1;
    });

    const byDepartment = Object.entries(departmentCounts)
      .sort(([, a], [, b]) => b - a)
      .map(([department, count]) => ({ department, count }));

    const monthlyMap: Record<string, number> = {};
      appointmentSessions.forEach((s) => {
    const d = new Date(s.timeStart ?? s.createdAt);
    const key = d.toLocaleDateString('th-TH', { month: 'short' });
      monthlyMap[key] = (monthlyMap[key] || 0) + 1;
    });
    const monthlySessions = Object.entries(monthlyMap).map(([month, count]) => ({
      month,
      count
      }));

    const caseStats = {
      total: cases.length,
      byStatus: {
        waiting_confirmation: cases.filter((c) => c.status === 'waiting_confirmation').length,
        confirmed: cases.filter((c) => c.status === 'confirmed').length,
        in_progress: cases.filter((c) => c.status === 'in_progress').length,
        completed: cases.filter((c) => c.status === 'completed').length,
        cancelled: cases.filter((c) => c.status === 'cancelled').length
      },
      byPriority: {
        high: cases.filter((c) => c.priority === 'high').length,
        medium: cases.filter((c) => c.priority === 'medium').length,
        low: cases.filter((c) => c.priority === 'low').length
      },
      averageSessionsPerCase:
        cases.length > 0
          ? cases.reduce((sum, c) => sum + c.sessions.length, 0) / cases.length
          : 0
    };

    const sessionStats = {
      total: appointmentSessions.length, // only booked + completed
      byStatus: {
        available: sessions.filter((s) => s.status === 'available').length,
        booked: appointmentSessions.filter((s) => s.status === 'booked').length,
        completed: appointmentSessions.filter((s) => s.status === 'completed').length,
        cancelled: sessions.filter((s) => s.status === 'cancelled').length
      },
      withNotes: appointmentSessions.filter((s) => s.counselorNote).length,
      withMoodScale: appointmentSessions.filter((s) => s.moodScale !== null).length
    };

    const problemTagCounts: Record<string, number> = {};
      appointmentSessions.forEach((session) => {
        session.problemTags.forEach((tag) => {
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
        client: users.filter((u) => u.roleName === 'client').length,
        counselor: users.filter((u) => u.roleName === 'counselor').length
      },
      consentAccepted: users.filter((u) => u.isConsentAccepted).length
    };

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

    const counselorStats = counselorPerformance
      .map((c) => ({
        counselorId: c.userId,
        name: `${c.user.firstName} ${c.user.lastName}`,
        counselorNumber: c.counselorNumber,
        casesHandled: c.cases.length,
        sessionsCreated: c.sessions.length,
        sessionsCompleted: c.sessions.filter((s) => s.status === 'completed').length
      }))
      .sort((a, b) => b.casesHandled - a.casesHandled);

    res.status(200).json({
      success: true,
      message: 'Report generated successfully',
      data: {
        period: {
          from: start.toISOString(),
          to: end.toISOString()
        },
        summary: {
          totalSessions: sessionStats.total,
          completedSessions: sessionStats.byStatus.completed,
          cancelledSessions: sessionStats.byStatus.cancelled,
          newClients: userStats.byRole.client,
          averageWaitDays
        },
        topTags: topProblemTags.map((t) => ({ tag: t.label, count: t.count })),
        byDepartment,
        counselorWorkload: counselorStats.map((c) => ({
          name: c.name,
          sessions: c.sessionsCompleted
        })),
        monthlySessions,
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
 * Get list of registration tokens
 */
export const getTokenList = async (req: AuthRequest, res: Response) => {
  try {
    const counselorUserId = req.user?.userId;

    const counselor = await prisma.user.findUnique({
      where: { userId: counselorUserId }
    });

    if (!counselor || counselor.roleName !== 'counselor') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only counselors can view token list.'
      });
    }

    const registrationCodes = await prisma.registrationCode.findMany({
      orderBy: { code: 'asc' }
    });

    const tokens = registrationCodes.map((rc) => ({
      id: rc.id,
      token: rc.code,
      isUsed: rc.isUsed,
      usedAt: rc.usedAt ?? undefined
    }));

    res.status(200).json({
      success: true,
      message: 'Registration tokens retrieved successfully',
      data: {
        total: tokens.length,
        tokens
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

export const createToken = async (req: AuthRequest, res: Response) => {
  try {
    const counselorUserId = req.user?.userId;

    const counselor = await prisma.user.findUnique({
      where: { userId: counselorUserId }
    });

    if (!counselor || counselor.roleName !== 'counselor') {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    const { code } = req.body as { code: string };

    if (!code || typeof code !== 'string' || code.trim() === '') {
      return res.status(400).json({ success: false, message: 'code is required' });
    }

    const TOKEN_REGEX = /^TK-[A-Z0-9]{6}$/;
    if (!TOKEN_REGEX.test(code.trim())) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid token format. Expected TK-XXXXXX' });
    }

    const existing = await prisma.registrationCode.findUnique({
      where: { code: code.trim() }
    });

    if (existing) {
      return res.status(409).json({ success: false, message: 'Token นี้มีอยู่แล้วในระบบ' });
    }

    const newCode = await prisma.registrationCode.create({
      data: {
        code: code.trim(),
        isUsed: false,
        createdBy: counselor.cmuAccount ?? String(counselorUserId)
      }
    });

    return res.status(201).json({
      success: true,
      message: 'Token created successfully',
      data: { id: newCode.id, token: newCode.code, isUsed: newCode.isUsed }
    });
  } catch (error) {
    console.error('Error creating token:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const deleteToken = async (req: AuthRequest, res: Response) => {
  try {
    const counselorUserId = req.user?.userId;
    const id = parseInt(req.params.id);

    const counselor = await prisma.user.findUnique({
      where: { userId: counselorUserId }
    });

    if (!counselor || counselor.roleName !== 'counselor') {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: 'Invalid token id' });
    }

    const token = await prisma.registrationCode.findUnique({
      where: { id }
    });

    if (!token) {
      return res.status(404).json({ success: false, message: 'Token not found' });
    }

    if (token.isUsed) {
      return res.status(400).json({ success: false, message: 'Cannot delete a used token' });
    }

    await prisma.registrationCode.delete({
      where: { id }
    });

    return res.json({
      success: true,
      message: 'Token deleted successfully'
    });
  } catch (error) {
    console.error('deleteToken error:', error);
    return res.status(500).json({ success: false, message: 'Failed to delete token' });
  }
};

// ─────────────────────────────────────────────
// DELETE USER
// DELETE /api/counselor/users/:userId
// ─────────────────────────────────────────────
export const deleteUser = async (req: AuthRequest, res: Response) => {
  try {
    const counselorUserId = req.user?.userId;
    const { userId } = req.params;
    const targetId = parseInt(userId);

    if (!counselorUserId || isNaN(targetId)) {
      return res.status(400).json({ success: false, message: 'Invalid userId' });
    }

    if (targetId === counselorUserId) {
      return res.status(400).json({ success: false, message: 'Cannot delete yourself' });
    }

    const requester = await prisma.user.findUnique({
      where: { userId: counselorUserId }
    });

    if (!requester || requester.roleName !== 'counselor') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only counselors can delete users.'
      });
    }

    const user = await prisma.user.findUnique({
      where: { userId: targetId },
      include: {
        clientProfile: {
          include: {
            cases: {
              include: {
                sessions: {
                  select: {
                    sessionId: true,
                    status: true
                  }
                }
              }
            }
          }
        },
        counselorProfile: {
          include: {
            sessions: {
              select: {
                sessionId: true
              }
            },
            rooms: {
              select: {
                roomId: true
              }
            },
            cases: {
              select: {
                caseId: true
              }
            }
          }
        }
      }
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    await prisma.$transaction(async (tx) => {
      // delete histories edited by this user first
      await tx.sessionHistory.deleteMany({
        where: { editedBy: targetId }
      });

      // ===== Client cleanup =====
      if (user.clientProfile) {
        const caseIds = user.clientProfile.cases.map((c) => c.caseId);
        const sessionIds = Array.from(
          new Set(
            user.clientProfile!.cases.flatMap((c) => c.sessions.map((s) => s.sessionId))
          )
        );

        // reset sessions that belonged to the client's cases
        for (const sessionId of sessionIds) {
          await tx.session.update({
            where: { sessionId },
            data: {
              status: 'available',
              caseId: null,
              sessionName: null,
              sessionToken: null,
              counselorKeyword: null,
              counselorNote: null,
              counselorFollowup: null,
              moodScale: null,
              problemTags: { set: [] }
            }
          });
        }

        if (sessionIds.length > 0) {
          await tx.sessionHistory.deleteMany({
            where: { sessionId: { in: sessionIds } }
          });
        }

        if (caseIds.length > 0) {
          await tx.case.deleteMany({
            where: { caseId: { in: caseIds } }
          });
        }

        await tx.client.delete({
          where: { userId: targetId }
        });
      }

      // ===== Counselor cleanup =====
      if (user.counselorProfile) {
        const counselorSessionIds = user.counselorProfile.sessions.map((s) => s.sessionId);

        // detach counselor from cases first
        await tx.case.updateMany({
          where: { counselorId: targetId },
          data: { counselorId: null }
        });

        if (counselorSessionIds.length > 0) {
          await tx.sessionHistory.deleteMany({
            where: { sessionId: { in: counselorSessionIds } }
          });

          await tx.session.deleteMany({
            where: { sessionId: { in: counselorSessionIds } }
          });
        }

        await tx.room.deleteMany({
          where: { counselorId: targetId }
        });

        await tx.counselor.delete({
          where: { userId: targetId }
        });
      }

      // finally delete user
      await tx.user.delete({
        where: { userId: targetId }
      });
    });

    return res.json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    console.error('deleteUser error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete user'
    });
  }
};

// ─────────────────────────────────────────────
// ADD USER BY CMU ACCOUNT
// POST /api/counselor/users
// Body: { cmuAccount, roleName, counselorNumber? }
// ─────────────────────────────────────────────
export const addUserByCmuAccount = async (req: AuthRequest, res: Response) => {
  try {
    const {
      cmuAccount,
      roleName,
      counselorNumber,
      firstName,
      lastName,
      department,
      priority
    } = req.body as {
      cmuAccount: string;
      roleName: 'client' | 'counselor';
      counselorNumber?: string;
      firstName?: string;
      lastName?: string;
      department?: string;
      priority?: 'low' | 'medium' | 'high';
    };

    if (!cmuAccount?.trim()) {
      return res.status(400).json({ success: false, message: 'cmuAccount is required' });
    }

    if (!['client', 'counselor'].includes(roleName)) {
      return res.status(400).json({
        success: false,
        message: 'roleName must be client or counselor'
      });
    }

    if (!firstName?.trim()) {
      return res.status(400).json({ success: false, message: 'firstName is required' });
    }

    if (lastName === undefined || lastName === null) {
      return res.status(400).json({ success: false, message: 'lastName is required' });
    }

    if (roleName === 'client' && !department?.trim()) {
      return res.status(400).json({
        success: false,
        message: 'department is required for client'
      });
    }

    const email = cmuAccount.trim().toLowerCase();
    const localPart = email.split('@')[0];
    const normalizedPriority =
      priority && ['low', 'medium', 'high'].includes(priority) ? priority : 'medium';

    const txResult = await prisma.$transaction(async (tx) => {
      let user = await tx.user.findUnique({
        where: { cmuAccount: email },
        include: {
          clientProfile: true,
          counselorProfile: true
        }
      });

      if (user) {
        const updatedUser = await tx.user.update({
          where: { userId: user.userId },
          data: {
            firstName: firstName.trim(),
            lastName: String(lastName).trim(),
            cmuAccount: email,
            roleName,
            ...(roleName === 'client'
              ? {
                  isConsentAccepted: true,
                  consentAcceptedAt: user.consentAcceptedAt ?? new Date()
                }
              : {})
          },
          include: {
            clientProfile: true,
            counselorProfile: true
          }
        });

        if (roleName === 'client') {
          const clientProfile = updatedUser.clientProfile
            ? await tx.client.update({
                where: { userId: updatedUser.userId },
                data: {
                  department: department?.trim() || null
                }
              })
            : await tx.client.create({
                data: {
                  userId: updatedUser.userId,
                  clientId: localPart,
                  department: department?.trim() || null
                }
              });

          const latestActiveCase = await tx.case.findFirst({
            where: {
              clientId: clientProfile.clientId,
              status: {
                in: ['waiting_confirmation', 'confirmed', 'in_progress']
              }
            },
            orderBy: {
              createdAt: 'desc'
            }
          });

          if (latestActiveCase) {
            if (latestActiveCase.status === 'waiting_confirmation') {
              await tx.case.update({
                where: { caseId: latestActiveCase.caseId },
                data: {
                  status: 'confirmed',
                  priority: normalizedPriority,
                  confirmedAt: new Date(),
                  queueToken:
                    latestActiveCase.queueToken || (await generateCaseQueueToken(tx as any)),
                  waitingEnteredAt: latestActiveCase.waitingEnteredAt ?? latestActiveCase.createdAt
                }
              });
            }
          } else {
            await tx.case.create({
              data: {
                clientId: clientProfile.clientId,
                status: 'confirmed',
                priority: normalizedPriority,
                queueToken: await generateCaseQueueToken(tx as any),
                confirmedAt: new Date()
              }
            });
          }
        }

        if (roleName === 'counselor') {
          if (updatedUser.counselorProfile) {
            await tx.counselor.update({
              where: { userId: updatedUser.userId },
              data: {
                counselorNumber: counselorNumber || updatedUser.counselorProfile.counselorNumber || null
              }
            });
          } else {
            await tx.counselor.create({
              data: {
                userId: updatedUser.userId,
                counselorNumber: counselorNumber || null
              }
            });
          }
        }

        return { userId: updatedUser.userId, existed: true };
      }

      const createdUser = await tx.user.create({
        data: {
          cmuAccount: email,
          firstName: firstName.trim(),
          lastName: String(lastName).trim(),
          roleName,
          isConsentAccepted: roleName === 'client',
          consentAcceptedAt: roleName === 'client' ? new Date() : null
        }
      });

      if (roleName === 'client') {
        await tx.client.create({
          data: {
            userId: createdUser.userId,
            clientId: localPart,
            department: department?.trim() || null
          }
        });

        await tx.case.create({
          data: {
            clientId: localPart,
            status: 'confirmed',
            priority: normalizedPriority,
            queueToken: await generateCaseQueueToken(tx as any),
            confirmedAt: new Date()
          }
        });
      } else {
        await tx.counselor.create({
          data: {
            userId: createdUser.userId,
            counselorNumber: counselorNumber || null
          }
        });
      }

      return { userId: createdUser.userId, existed: false };
    });

    const result = await prisma.user.findUnique({
      where: { userId: txResult.userId },
      include: {
        clientProfile: true,
        counselorProfile: true
      }
    });

    return res.status(txResult.existed ? 200 : 201).json({
      success: true,
      message: txResult.existed
        ? 'User already exists, updated successfully'
        : 'User created successfully',
      data: result
    });
  } catch (error) {
    console.error('addUserByCmuAccount error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to add user'
    });
  }
};