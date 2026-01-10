import { Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/authMiddleware'; // import จากไฟล์ที่คุณมี

const prisma = new PrismaClient();

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
        studentProfile: true,   // เอาข้อมูลนักศึกษามาด้วย
        counselorProfile: true, // เอาข้อมูลอาจารย์มาด้วย
        adminProfile: true      
      }
    });

    if (!user) return res.status(404).json({ message: 'User not found' });
    
    // ส่งข้อมูลกลับไปให้ Frontend (ตัด password หรือ hash ออกถ้ามี)
    const { pswHash, ...userData } = user; 
    res.json(userData);

  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
};