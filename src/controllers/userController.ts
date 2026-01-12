import { Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/authMiddleware'; 

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
        // เข้าไปเอาข้อมูล cases ใน studentProfile ด้วย
        studentProfile: {
          include: {
            cases: true 
          }
        },   
        counselorProfile: true, 
        adminProfile: true      
      }
    });

    if (!user) return res.status(404).json({ message: 'User not found' });
    
    // เพิ่ม Logic เช็คสถานะ (Flow Status)
    let flowStatus = 'normal'; 

    if (user.roleName === 'student') {
       // ด่านที่ 1: เช็คว่ายอมรับ PDPA หรือยัง?
       if (!user.isConsentAccepted) {
          flowStatus = 'require_consent'; // ให้ Frontend เด้ง Modal PDPA ขึ้นมาก่อน
       }
       // ด่านที่ 2: เช็คว่ามี Case หรือยัง (กรอก Code หรือยัง)
       else if (user.studentProfile?.cases.length === 0) {
          flowStatus = 'require_token';
       } 
       // ด่านที่ 3: เช็คสถานะการรออนุมัติ
       else {
          const cases = user.studentProfile?.cases || [];
          const isWaiting = cases.some((c: any) => c.status === 'waiting_confirmation');
          
          if (isWaiting) {
             flowStatus = 'waiting_approval';
          }
       }
    }

    // ตัด password ทิ้ง และส่งข้อมูลกลับไปพร้อม flowStatus
    const { pswHash, ...userData } = user; 
    
    // ส่ง flowStatus กลับไปบอก Frontend
    res.json({ 
      ...userData, 
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
