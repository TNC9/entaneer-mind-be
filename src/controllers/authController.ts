import { Request, Response } from 'express';
import { prisma } from '../prisma';
import jwt from 'jsonwebtoken';
import axios from 'axios';
import { AuthRequest } from '../middleware/authMiddleware';

const JWT_SECRET = process.env.JWT_SECRET as string;

// ------------------------------------------
// 1. REGISTER (สมัครสมาชิกแบบกรอกเอง)
// ------------------------------------------
export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const { 
      cmuAccount, firstName, lastName, roleName, phoneNum, 
      clientId, major, department 
    } = req.body;

    // เช็คซ้ำ
    const existingUser = await prisma.user.findUnique({ where: { cmuAccount } });
    if (existingUser) {
      res.status(400).json({ error: 'User already exists' });
      return; 
    }

    // สร้าง User พร้อม Profile
    const newUser = await prisma.user.create({
      data: {
        cmuAccount,
        firstName,
        lastName,
        roleName: roleName || 'client',
        phoneNum,
        clientProfile: (roleName === 'client' && clientId) ? {
          create: {
            clientId,
            major: major || 'General',
            department: department || 'General'
          }
        } : undefined
      },
      include: { clientProfile: true }
    });

    res.status(201).json({ message: 'User created successfully', user: newUser });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ------------------------------------------
// 2. LOGIN (แบบปกติ สำหรับทดสอบ)
// ------------------------------------------
export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { cmuAccount } = req.body;
    const user = await prisma.user.findUnique({
      where: { cmuAccount },
      include: { clientProfile: true, counselorProfile: true }
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    let hasActiveCase = false;
    if (user.roleName === 'client' && user.clientProfile) {
      const activeCase = await prisma.case.findFirst({
        where: {
          clientId: user.clientProfile.clientId,
          status: { in: ['waiting_confirmation', 'confirmed', 'in_progress'] }
        }
      });
      hasActiveCase = !!activeCase;
    }

    const token = jwt.sign(
      { userId: user.userId, role: user.roleName, cmuAccount: user.cmuAccount },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(200).json({ message: 'Login successful', token, user, hasActiveCase });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ------------------------------------------
// 3. CMU CALLBACK (สำหรับ Login มช.)
// ------------------------------------------
export const cmuCallback = async (req: Request, res: Response): Promise<void> => {
  try {
    const { code } = req.query;

    if (!code) {
      res.status(400).send('No code provided');
      return;
    }

    // A. แลก Code เป็น Access Token
    const tokenResponse = await axios.post(
      'https://login.microsoftonline.com/cf81f1df-de59-4c29-91da-a2dfd04aa751/oauth2/v2.0/token',
      new URLSearchParams({
        client_id: process.env.CMU_CLIENT_ID!,
        client_secret: process.env.CMU_CLIENT_SECRET!,
        scope: process.env.CMU_SCOPE!,
        redirect_uri: process.env.CMU_REDIRECT_URL!,
        grant_type: 'authorization_code',
        code: code as string,
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const accessToken = tokenResponse.data.access_token;

    // B. ดึงข้อมูล User Profile จาก API ของมช. โดยตรง
    const userResponse = await axios.get('https://api.cmu.ac.th/mis/cmuaccount/prod/v3/me/basicinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const cmuData = userResponse.data; 
    const email = cmuData.cmuitaccount;

// ---------------------------------------------------------
// 4. Logic ดึงข้อมูล เพศ, รหัสนศ, คณะ
// ---------------------------------------------------------
    
    // แปลงเพศ (Gender)
    const prename = (cmuData.prename_EN || cmuData.prename_id || '').toUpperCase();
    let gender = null;
    if (prename.includes('MR')) {
        gender = 'Male';
    } else if (prename.includes('MS') || prename.includes('MISS') || prename.includes('MRS')) {
        gender = 'Female';
    }

    // ดึงรหัสนศ, คณะ, สาขา
    const studentId = cmuData.student_id || null;
    const department = cmuData.organization_name_TH || null; 
    const major = cmuData.major || null; // ถ้ามช.ไม่ส่งมา ค่านี้จะเป็น null

    let user = await prisma.user.findUnique({ 
        where: { cmuAccount: email },
        include: { clientProfile: true } // check ว่ามี profile หรือยัง
    });

    // C. เซฟลง Database
    if (!user) {
      // สร้าง User ใหม่ พร้อมบันทึก Gender ลงตาราง User
      user = await prisma.user.create({
        data: {
          cmuAccount: email,
          firstName: cmuData.firstname_TH || 'Unknown',
          lastName: cmuData.lastname_TH || 'Unknown',
          gender: gender, // <--- เซฟเพศ
          roleName: 'client', 
        },
        include: { clientProfile: true }
      });
    } else {
       // ถ้ามี User อยู่แล้ว ให้อัปเดตเพศให้ตรงกับปัจจุบัน
       if (gender && user.gender !== gender) {
          await prisma.user.update({
              where: { userId: user.userId },
              data: { gender: gender }
          });
       }
    }

    // จัดการ Client Profile (บันทึก รหัสนศ, คณะ, สาขา ลงตาราง Client)
    if (user.roleName === 'client') {
        if (!user.clientProfile) {
            const clientIdToUse = studentId || email.split('@')[0]; 

            await prisma.client.create({
                data: {
                    userId: user.userId,
                    clientId: clientIdToUse, // <--- เซฟรหัสนศ.
                    major: major,            // <--- เซฟสาขา
                    department: department   // <--- เซฟคณะ
                }
            });
        } else {
            // อัปเดตข้อมูลคณะ/สาขาให้ล่าสุดเสมอ
            await prisma.client.update({
                where: { userId: user.userId },
                data: {
                    major: major || user.clientProfile.major,
                    department: department || user.clientProfile.department
                }
            });
        }
    }

    // D. สร้าง Token ของเราเอง
    const appToken = jwt.sign(
      { userId: user.userId, role: user.roleName, cmuAccount: user.cmuAccount },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    // E. ส่ง User กลับไปหน้าเว็บ Frontend พร้อม Token
    res.redirect(`http://localhost:3001/login-success?token=${appToken}`);

  } catch (error) {
    console.error('CMU Login Error:', error);
    res.status(500).send('Authentication Failed');
  }
};

// ------------------------------------------
// 4. GET ME (ดึงข้อมูลตัวเอง + เช็คว่ามี Case หรือยัง)
// ------------------------------------------
export const getMe = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { userId },
      include: { clientProfile: true, counselorProfile: true }
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // เช็คว่ามี Case ที่กำลังดำเนินการอยู่ไหม
    let hasActiveCase = false;
    if (user.roleName === 'client' && user.clientProfile) {
      const activeCase = await prisma.case.findFirst({
        where: {
          clientId: user.clientProfile.clientId,
          status: { in: ['waiting_confirmation', 'confirmed', 'in_progress'] }
        }
      });
      hasActiveCase = !!activeCase;
    }

    res.status(200).json({
      user,
      hasActiveCase // 👈 ตัวนี้แหละพระเอกของเรา!
    });
  } catch (error) {
    console.error('getMe error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};