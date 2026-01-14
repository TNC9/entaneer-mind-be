import { Response } from 'express';
import { prisma } from '../prisma';
import { AuthRequest } from '../middleware/authMiddleware'; 

// Get Current User Profile
export const getMe = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
        return res.status(401).json({ error: 'User ID not found in token' });
    }

    // 1. ดึงข้อมูลแบบ Deep Include
    const user = await prisma.user.findUnique({
      where: { userId: userId },
      include: {
        studentProfile: {
          include: {
            cases: {
              // แนบข้อมูล Student และ User (ชื่อ-สกุล) มาใน Case ด้วย
              include: {
                 student: {
                    include: { user: true } 
                 },
                 sessions: {
                    // ดึง Tags มาด้วย (เดี๋ยวเอาไปแปลงร่างข้างล่าง)
                    include: { problemTags: true }
                 }
              }
            } 
          }
        },   
        counselorProfile: true, 
        adminProfile: true      
      }
    });

    if (!user) return res.status(404).json({ message: 'User not found' });
    
    // 2. Logic เช็คสถานะ (Flow Status)
    let flowStatus = 'normal'; 

    if (user.roleName === 'student') {
       if (!user.isConsentAccepted) {
          flowStatus = 'require_consent';
       }
       else if (!user.studentProfile?.cases || user.studentProfile.cases.length === 0) {
          flowStatus = 'require_token';
       } 
       else {
          const cases = user.studentProfile.cases;
          const isWaiting = cases.some((c: any) => c.status === 'waiting_confirmation');
          
          if (isWaiting) {
             flowStatus = 'waiting_approval';
          }
       }
    }

    // 3. ส่วนแปลงร่างข้อมูล (Transform Data)
    // แปลงจาก Database Structure -> Frontend Friendly Structure
    const safeUser = {
        ...user,
        pswHash: undefined, // ลบ Password ทิ้งเพื่อความปลอดภัย
        studentProfile: user.studentProfile ? {
            ...user.studentProfile,
            cases: user.studentProfile.cases.map((c: any) => ({
                ...c,
                // แปลง Session แต่ละอัน
                sessions: c.sessions.map((s: any) => ({
                    ...s,
                    // แปลงร่าง: ดึงแค่ label ออกมาใส่ Array
                    // จาก [{label: "เครียด"}, {label: "การเรียน"}] -> ["เครียด", "การเรียน"]
                    problemTags: s.problemTags.map((t: any) => t.label)
                }))
            }))
        } : null
    };
    
    // ส่งข้อมูลที่แปลงแล้ว (safeUser) พร้อม flowStatus กลับไปให้ Frontend
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