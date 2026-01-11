import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken, AuthRequest } from '../middleware/authMiddleware';

const router = Router();
const prisma = new PrismaClient();

/**
 * POST /api/admin/promote
 * Promote a user to counselor role
 * @requires Authentication & Admin role
 */
router.post('/api/admin/promote', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const adminUserId = req.user?.userId;
    const { userId, counselorNumber } = req.body;

    // Validate admin role
    const admin = await prisma.user.findUnique({
      where: { userId: adminUserId },
      include: { adminProfile: true }
    });

    if (!admin || admin.roleName !== 'admin') {
      res.status(403).json({
        success: false,
        message: 'Access denied. Only admins can promote users.'
      });
      return;
    }

    // Validate required fields
    if (!userId) {
      res.status(400).json({
        success: false,
        message: 'userId is required'
      });
      return;
    }

    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { userId: parseInt(userId) },
      include: { counselorProfile: true }
    });

    if (!user) {
      res.status(404).json({
        success: false,
        message: `User with ID ${userId} not found`
      });
      return;
    }

    // Check if user is already a counselor
    if (user.counselorProfile) {
      res.status(400).json({
        success: false,
        message: `User ${user.firstName} ${user.lastName} is already a counselor`,
        user: {
          userId: user.userId,
          name: `${user.firstName} ${user.lastName}`,
          cmuAccount: user.cmuAccount,
          currentRole: user.roleName
        }
      });
      return;
    }

    // Perform promotion in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // Update user role to counselor
      const updatedUser = await tx.user.update({
        where: { userId: parseInt(userId) },
        data: { roleName: 'counselor' }
      });

      // Create counselor profile
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
        cmuAccount: result.updatedUser.cmuAccount,
        previousRole: user.roleName,
        newRole: result.updatedUser.roleName,
        counselorNumber: result.counselorProfile.counselorNumber,
        promotedBy: {
          adminId: admin.userId,
          adminName: `${admin.firstName} ${admin.lastName}`
        },
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
});

/**
 * GET /api/admin/counselors
 * Get list of all counselors
 * @requires Authentication & Admin role
 */
router.get('/api/admin/counselors', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const adminUserId = req.user?.userId;

    // Validate admin role
    const admin = await prisma.user.findUnique({
      where: { userId: adminUserId }
    });

    if (!admin || admin.roleName !== 'admin') {
      res.status(403).json({
        success: false,
        message: 'Access denied. Only admins can view counselor list.'
      });
      return;
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
            createdAt: true
          }
        },
        sessions: {
          select: {
            sessionId: true,
            status: true
          }
        }
      }
    });

    // Format response with statistics
    const formattedCounselors = counselors.map(counselor => {
      const sessionStats = {
        total: counselor.sessions.length,
        available: counselor.sessions.filter(s => s.status === 'available').length,
        booked: counselor.sessions.filter(s => s.status === 'booked').length,
        completed: counselor.sessions.filter(s => s.status === 'completed').length
      };

      return {
        userId: counselor.user.userId,
        name: `${counselor.user.firstName} ${counselor.user.lastName}`,
        cmuAccount: counselor.user.cmuAccount,
        phoneNum: counselor.user.phoneNum,
        counselorNumber: counselor.counselorNumber,
        joinedAt: counselor.user.createdAt,
        sessionStats
      };
    });

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
});

/**
 * DELETE /api/admin/demote/:userId
 * Demote a counselor back to student/user role
 * @requires Authentication & Admin role
 */
router.delete('/api/admin/demote/:userId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const adminUserId = req.user?.userId;
    const { userId } = req.params;

    // Validate admin role
    const admin = await prisma.user.findUnique({
      where: { userId: adminUserId }
    });

    if (!admin || admin.roleName !== 'admin') {
      res.status(403).json({
        success: false,
        message: 'Access denied. Only admins can demote users.'
      });
      return;
    }

    // Check if user exists and is a counselor
    const user = await prisma.user.findUnique({
      where: { userId: parseInt(userId) },
      include: { 
        counselorProfile: true,
        studentProfile: true
      }
    });

    if (!user) {
      res.status(404).json({
        success: false,
        message: `User with ID ${userId} not found`
      });
      return;
    }

    if (!user.counselorProfile) {
      res.status(400).json({
        success: false,
        message: `User ${user.firstName} ${user.lastName} is not a counselor`
      });
      return;
    }

    // Check if counselor has active sessions
    const activeSessions = await prisma.session.count({
      where: {
        counselorId: parseInt(userId),
        status: {
          in: ['available', 'booked']
        }
      }
    });

    if (activeSessions > 0) {
      res.status(400).json({
        success: false,
        message: 'Cannot demote counselor with active or booked sessions',
        activeSessionsCount: activeSessions
      });
      return;
    }

    // Perform demotion in a transaction
    await prisma.$transaction(async (tx) => {
      // Delete counselor profile
      await tx.counselor.delete({
        where: { userId: parseInt(userId) }
      });

      // Update user role back to student (or default role)
      const newRole = user.studentProfile ? 'student' : 'user';
      await tx.user.update({
        where: { userId: parseInt(userId) },
        data: { roleName: newRole }
      });
    });

    res.status(200).json({
      success: true,
      message: 'Counselor successfully demoted',
      data: {
        userId: user.userId,
        name: `${user.firstName} ${user.lastName}`,
        previousRole: 'counselor',
        newRole: user.studentProfile ? 'student' : 'user',
        demotedBy: {
          adminId: admin.userId,
          adminName: `${admin.firstName} ${admin.lastName}`
        }
      }
    });

  } catch (error) {
    console.error('Error demoting user:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
    });
  }
});

export default router;