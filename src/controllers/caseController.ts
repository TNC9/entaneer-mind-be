import { Response } from 'express';
import { prisma } from '../prisma';
import { AuthRequest } from '../middleware/authMiddleware';

// API: กรอก Code เพื่อเปิด Case ใหม่
export const verifyCodeAndCreateCase = async (req: AuthRequest, res: Response) => {
  const { code } = req.body;
  const userId = req.user?.userId;

  try {
    // 1. หา User เพื่อเอา clientId
    const user = await prisma.user.findUnique({
      where: { userId },
      include: { clientProfile: true }
    });

    if (!user || !user.clientProfile) {
        return res.status(400).json({ error: 'Client profile not found' });
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
                clientId: user.clientProfile!.clientId,
                status: 'waiting_confirmation',
            }
        });

        // 3.2 มาร์คว่า Code ถูกใช้แล้ว
        await tx.registrationCode.update({
            where: { id: validCode.id },
            data: { 
                isUsed: true,
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

// ------------------------------------------
// API: สร้าง Queue Token (6X000N) และอัปเดตเวลารอ
// ------------------------------------------
export const generateQueueToken = async (req: AuthRequest, res: Response) => {
  try {
    const client = req.client;
    const { priority } = req.body; // รับค่าความเร่งด่วนมาจากหน้า PDPA

    if (!client) {
      return res.status(401).json({ success: false, message: 'Client not authenticated' });
    }

    // 1. หา Case ล่าสุดของเด็กคนนี้ที่เพิ่งเปิดไว้ (สถานะ waiting_confirmation)
    const currentCase = await prisma.case.findFirst({
      where: { 
        clientId: client.clientId, 
        status: 'waiting_confirmation' 
      },
      orderBy: { createdAt: 'desc' }
    });

    if (!currentCase) {
      return res.status(404).json({ success: false, message: 'No pending case found. Please verify code first.' });
    }

    // ถ้ามี Token อยู่แล้ว (เด็กอาจจะกด Refresh หน้าเว็บ) ให้คืนค่าเดิมกลับไป จะได้ไม่เปลืองคิว
    if (currentCase.queueToken) {
      return res.status(200).json({ success: true, token: currentCase.queueToken });
    }

    // 2. คำนวณหา Prefix ปีการศึกษา (6X)
    const now = new Date();
    let thaiYear = now.getFullYear() + 543; // แปลง ค.ศ. เป็น พ.ศ.
    
    // ถ้าอยู่ก่อนเดือนมิถุนายน (เดือน 0-4 คือ ม.ค.-พ.ค.) ให้นับเป็นปีการศึกษาของปีที่แล้ว
    if (now.getMonth() < 5) { 
      thaiYear -= 1;
    }
    
    // ตัดเอา 2 ตัวท้าย (เช่น 2568 -> "68")
    const yearPrefix = thaiYear.toString().slice(-2); 

    // 3. หา Token ล่าสุดของปีการศึกษานี้ใน Database
    const lastCase = await prisma.case.findFirst({
      where: {
        queueToken: { startsWith: yearPrefix }
      },
      orderBy: { queueToken: 'desc' }
    });

    // 4. คำนวณค่า N ถัดไป
    let nextNumber = 1;
    if (lastCase && lastCase.queueToken) {
      // ตัด "68" ออก เหลือแค่ "0001" แล้วแปลงเป็นตัวเลขเพื่อ +1
      const lastNumber = parseInt(lastCase.queueToken.slice(2), 10);
      nextNumber = lastNumber + 1;
    }

    // 5. ประกอบร่าง Token (6X + 000N) โดยเติมเลข 0 ให้ครบ 4 หลัก
    const paddedNumber = nextNumber.toString().padStart(4, '0');
    const newToken = `${yearPrefix}${paddedNumber}`; // เช่น "680001"

    // 6. บันทึก Token, Priority และเวลาเริ่มเข้าห้องรอ ลง Database
    const updatedCase = await prisma.case.update({
      where: { caseId: currentCase.caseId },
      data: { 
        queueToken: newToken,
        priority: priority || 'medium', // เซฟความเร่งด่วน
        waitingEnteredAt: new Date() // แสตมป์เวลาเริ่มรอ
      }
    });

    res.status(200).json({ 
      success: true, 
      token: newToken,
      priority: updatedCase.priority 
    });

  } catch (error) {
    console.error('Error generating token:', error);
    res.status(500).json({ success: false, message: 'Failed to generate token' });
  }
};