import { Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/authMiddleware';

const prisma = new PrismaClient();

// API: กรอก Code เพื่อเปิด Case ใหม่
export const verifyCodeAndCreateCase = async (req: AuthRequest, res: Response) => {
  const { code } = req.body;
  const userId = req.user?.userId;

  try {
    // 1. หา User เพื่อเอา studentId
    const user = await prisma.user.findUnique({
      where: { userId },
      include: { studentProfile: true }
    });

    if (!user || !user.studentProfile) {
        return res.status(400).json({ error: 'Student profile not found' });
    }

    // 2. ตรวจสอบ Code ในตาราง RegistrationCode
    const validCode = await prisma.registrationCode.findUnique({
      where: { code: code }
    });

    if (!validCode) return res.status(404).json({ error: 'Invalid code' });
    if (validCode.isUsed) return res.status(400).json({ error: 'Code already used' });

    // 3. เริ่ม Transaction (ทำพร้อมกัน: สร้าง Case + ตัด Code ทิ้ง)
    await prisma.$transaction(async (tx) => {
        // 3.1 สร้าง Case ใหม่ (สถานะ waiting_confirmation)
        await tx.case.create({
            data: {
                studentId: user.studentProfile!.studentId,
                status: 'waiting_confirmation',
                topic: 'New Registration' 
            }
        });

        // 3.2 มาร์คว่า Code ถูกใช้แล้ว
        await tx.registrationCode.update({
            where: { id: validCode.id },
            data: { 
                isUsed: true,
                usedBy: user.studentProfile!.studentId,
                usedAt: new Date()
            }
        });
    });

    res.json({ success: true, message: 'Case created, waiting for approval' });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};