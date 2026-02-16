import { Request, Response } from 'express';
import { prisma } from '../prisma';
import jwt from 'jsonwebtoken';
import axios from 'axios';

const JWT_SECRET = process.env.JWT_SECRET || 'secret-key-sud-yod';

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

    const token = jwt.sign(
      { userId: user.userId, role: user.roleName, cmuAccount: user.cmuAccount },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(200).json({ message: 'Login successful', token, user });
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
      'https://login.microsoftonline.com/cmu.ac.th/oauth2/v2.0/token',
      new URLSearchParams({
        client_id: process.env.CMU_CLIENT_ID!,
        client_secret: process.env.CMU_CLIENT_SECRET!,
        scope: 'openid profile email offline_access User.Read',
        redirect_uri: process.env.CMU_REDIRECT_URL!,
        grant_type: 'authorization_code',
        code: code as string,
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const accessToken = tokenResponse.data.access_token;

    // B. ดึงข้อมูล User Profile
    const userResponse = await axios.get('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const cmuData = userResponse.data; 
    const email = cmuData.mail || cmuData.userPrincipalName;

    let user = await prisma.user.findUnique({ 
        where: { cmuAccount: email },
        include: { clientProfile: true } // check ว่ามี profile หรือยัง
    });

    if (!user) {
      // 1. สร้าง User หลักก่อน
      user = await prisma.user.create({
        data: {
          cmuAccount: email,
          firstName: cmuData.givenName || 'Unknown',
          lastName: cmuData.surname || 'Unknown',
          roleName: 'client', 
        },
        include: { clientProfile: true } // create แล้ว return profile มาด้วย
      });
    }

    // 2. ถ้าเป็น client แต่ยังไม่มี Profile ในตาราง client ให้สร้างเพิ่ม
    if (user.roleName === 'client' && !user.clientProfile) {
        // ดึง client ID จาก email(รองรับทั้ง นศ. และบุคลากร)
        const clientIdFromEmail = email.split('@')[0]; 

        await prisma.client.create({
            data: {
                userId: user.userId, // ผูกกับ User ID ที่เพิ่งสร้าง
                clientId: clientIdFromEmail, // หรือใช้ cmuData.clientId ถ้ามี
                major: 'General',      // ใส่ค่า default ไปก่อน
                department: 'General' 
            }
        });
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