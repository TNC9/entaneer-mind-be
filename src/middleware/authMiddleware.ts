import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'secret-key-sud-yod';

// ประกาศ Type เพิ่มเติมเพื่อให้ Express รู้จัก user ใน req
export interface AuthRequest extends Request {
  user?: any;
}

export const authenticateToken = (req: AuthRequest, res: Response, next: NextFunction): void => {
  // รับ Token จาก Header (Bearer TOKEN_HERE)
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    res.status(401).json({ error: 'Access denied (No token provided)' });
    return;
  }

  jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
    if (err) {
      res.status(403).json({ error: 'Invalid token' });
      return;
    }
    
    // ถ้า Token ถูกต้อง ให้แปะข้อมูล user ใส่ req แล้วปล่อยผ่าน
    req.user = user;
    next();
  });
};