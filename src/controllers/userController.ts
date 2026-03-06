import { Request, Response } from 'express';
import { prisma } from '../prisma';
import { AuthRequest } from '../middleware/authMiddleware';

// NEW
export const listUsers = async (req: Request, res: Response) => {
  try {
    const role = String(req.query.role ?? '').trim();

    const where = role
      ? {
          roleName: {
            equals: role,
            mode: 'insensitive' as const,
          },
        }
      : undefined;

    const users = await prisma.user.findMany({
      where,
      select: {
        userId: true,
        firstName: true,
        lastName: true,
        roleName: true,
      },
      orderBy: {
        userId: 'asc',
      },
    });

    return res.json({ users });
  } catch (error) {
    console.error('listUsers error:', error);
    return res.status(500).json({ error: 'Failed to load users' });
  }
};

// Get Current User Profile
export const getMe = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ error: 'User ID not found in token' });
    }

    const user = await prisma.user.findUnique({
      where: { userId: userId },
      include: {
        clientProfile: {
          include: {
            cases: {
              include: {
                client: {
                  include: { user: true }
                },
                sessions: {
                  include: { problemTags: true }
                }
              }
            }
          }
        },
        counselorProfile: true,
      }
    });

    if (!user) return res.status(404).json({ message: 'User not found' });

    let flowStatus = 'normal';

    if (user.roleName === 'client') {
      if (!user.isConsentAccepted) {
        flowStatus = 'require_consent';
      } else if (!user.clientProfile?.cases || user.clientProfile.cases.length === 0) {
        flowStatus = 'require_token';
      } else {
        const cases = user.clientProfile.cases;
        const isWaiting = cases.some((c: any) => c.status === 'waiting_confirmation');

        if (isWaiting) {
          flowStatus = 'waiting_approval';
        }
      }
    }

    const safeUser = {
      ...user,
      clientProfile: user.clientProfile ? {
        ...user.clientProfile,
        cases: user.clientProfile.cases?.map((c: any) => ({
          ...c,
          sessions: c.sessions?.map((s: any) => ({
            ...s,
            problemTags: s.problemTags?.map((t: any) => t.label) || []
          })) || []
        })) || []
      } : null
    };

    res.json({
      ...safeUser,
      flowStatus
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

export const acceptConsent = async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;
  try {
    await prisma.user.update({
      where: { userId },
      data: {
        isConsentAccepted: true,
        consentAcceptedAt: new Date()
      }
    });
    res.json({ success: true, message: 'Consent accepted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update consent' });
  }
};