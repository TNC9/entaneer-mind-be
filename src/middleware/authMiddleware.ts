import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../prisma';

const JWT_SECRET = process.env.JWT_SECRET || 'secret-key-sud-yod';

export interface AuthenticatedUser {
  userId: number;
  cmuAccount: string;
  roleName: 'client' | 'counselor';
  clientId?: string;
  counselorId?: number;
}

export interface AuthRequest extends Request {
  user?: AuthenticatedUser;
  client?: any; // Populated for client routes
  counselor?: any; // Populated for counselor routes
}

export const authenticateToken = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      res.status(401).json({ 
        success: false,
        message: 'Access denied - No token provided' 
      });
      return;
    }

    const payload = jwt.verify(token, JWT_SECRET) as any;
    
    // Validate user exists in database
    const user = await prisma.user.findUnique({
      where: { userId: payload.userId },
      select: {
        userId: true,
        cmuAccount: true,
        roleName: true,
        firstName: true,
        lastName: true
      }
    });

    if (!user) {
      res.status(403).json({ 
        success: false,
        message: 'Invalid token - User not found' 
      });
      return;
    }

    // Populate role-specific data
    let authenticatedUser: AuthenticatedUser = {
      userId: user.userId,
      cmuAccount: user.cmuAccount,
      roleName: user.roleName as 'client' | 'counselor'
    };

    // Add client data if applicable
    if (user.roleName === 'client') {
      const clientData = await prisma.client.findUnique({
        where: { userId: user.userId },
        select: { clientId: true, major: true, department: true }
      });
      if (clientData) {
        authenticatedUser.clientId = clientData.clientId;
        req.client = clientData;
      }
    }

    // Add counselor data if applicable
    if (user.roleName === 'counselor') {
      const counselor = await prisma.counselor.findUnique({
        where: { userId: user.userId },
        select: { counselorNumber: true }
      });
      if (counselor) {
        authenticatedUser.counselorId = user.userId; // Use userId as counselorId
        req.counselor = counselor;
      }
    }

    req.user = authenticatedUser;
    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      res.status(403).json({ 
        success: false,
        message: 'Invalid token - Malformed or expired' 
      });
    } else {
      console.error('Auth middleware error:', error);
      res.status(500).json({ 
        success: false,
        message: 'Authentication service error' 
      });
    }
  }
};

// Role-based middleware
export const requireRole = (roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.roleName)) {
      res.status(403).json({ 
        success: false,
        message: 'Access denied - Insufficient permissions' 
      });
      return;
    }
    next();
  };
};

// client-only middleware
export const requireClient = requireRole(['client']);

// Counselor-only middleware  
export const requireCounselor = requireRole(['counselor']);