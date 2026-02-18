import { Response } from 'express';
import { prisma } from '../prisma';
import { AuthRequest } from '../middleware/authMiddleware';
import axios from 'axios';

const normalizeStatus = (status: string): string => {
  const value = status.trim().toLowerCase();
  if (value === 'postponed') {
    return 'rescheduled';
  }
  return value;
};

const parseDetails = (details: string | null) => {
  if (!details) {
    return null;
  }

  try {
    return JSON.parse(details);
  } catch {
    return details;
  }
};

const sendAppointmentNotification = async (input: {
  email: string;
  fullName: string;
  caseId: number;
  status: string;
  reason?: string;
}) => {
  const message = `Dear ${input.fullName}, your appointment (case #${input.caseId}) status has been updated to "${input.status}"${input.reason ? ` (${input.reason})` : ''}.`;
  const webhookUrl = process.env.NOTIFICATION_WEBHOOK_URL;

  if (webhookUrl) {
    try {
      await axios.post(webhookUrl, {
        to: input.email,
        subject: 'Appointment Status Updated',
        message,
        caseId: input.caseId,
        status: input.status,
        reason: input.reason || null
      });
      return { channel: 'webhook', delivered: true, message };
    } catch (error) {
      console.error('Notification webhook error:', error);
    }
  }

  console.log(`[Notification] to=${input.email} case=${input.caseId} status=${input.status} message=${message}`);
  return { channel: 'console', delivered: true, message };
};

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

        // 3.2 มาร์กว่า Code ถูกใช้แล้ว
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

// API: Counselor edits case note and always writes audit into SessionHistory
export const editCaseNote = async (req: AuthRequest, res: Response) => {
  try {
    const sessionId = Number(req.params.sessionId);
    if (!Number.isInteger(sessionId) || sessionId <= 0) {
      return res.status(400).json({ success: false, message: 'Valid sessionId is required' });
    }

    const { counselorKeyword, counselorNote, counselorFollowup, moodScale, problemTags } = req.body;
    const counselorId = req.user?.userId;
    if (!counselorId) {
      return res.status(401).json({ success: false, message: 'Counselor authentication required' });
    }

    const hasUpdatableField = [
      counselorKeyword,
      counselorNote,
      counselorFollowup,
      moodScale,
      problemTags
    ].some((field) => field !== undefined);

    if (!hasUpdatableField) {
      return res.status(400).json({ success: false, message: 'At least one updatable field is required' });
    }

    if (moodScale !== undefined && moodScale !== null) {
      const score = Number(moodScale);
      if (!Number.isInteger(score) || score < 1 || score > 10) {
        return res.status(400).json({ success: false, message: 'moodScale must be an integer between 1 and 10' });
      }
    }

    if (problemTags !== undefined && !Array.isArray(problemTags)) {
      return res.status(400).json({ success: false, message: 'problemTags must be an array of strings' });
    }

    const cleanTags = Array.isArray(problemTags)
      ? Array.from(new Set(problemTags.map((tag: string) => tag.trim()).filter((tag: string) => tag.length > 0)))
      : undefined;

    const updatedSession = await prisma.$transaction(async (tx) => {
      const currentSession = await tx.session.findUnique({
        where: { sessionId },
        include: {
          problemTags: {
            select: {
              id: true,
              label: true
            }
          }
        }
      });

      if (!currentSession) {
        throw new Error('SESSION_NOT_FOUND');
      }

      if (currentSession.counselorId !== counselorId) {
        throw new Error('FORBIDDEN');
      }

      const updated = await tx.session.update({
        where: { sessionId },
        data: {
          counselorKeyword: counselorKeyword === undefined ? undefined : (counselorKeyword === null ? null : String(counselorKeyword).trim()),
          counselorNote: counselorNote === undefined ? undefined : (counselorNote === null ? null : String(counselorNote).trim()),
          counselorFollowup: counselorFollowup === undefined ? undefined : (counselorFollowup === null ? null : String(counselorFollowup).trim()),
          moodScale: moodScale === undefined ? undefined : (moodScale === null ? null : Number(moodScale)),
          problemTags: cleanTags
            ? {
                set: [],
                connectOrCreate: cleanTags.map((label: string) => ({
                  where: { label },
                  create: { label, isActive: true }
                }))
              }
            : undefined
        },
        include: {
          problemTags: {
            select: {
              id: true,
              label: true
            }
          }
        }
      });

      await tx.sessionHistory.create({
        data: {
          sessionId,
          action: 'edit_case_note',
          details: JSON.stringify({
            before: {
              counselorKeyword: currentSession.counselorKeyword,
              counselorNote: currentSession.counselorNote,
              counselorFollowup: currentSession.counselorFollowup,
              moodScale: currentSession.moodScale,
              problemTags: currentSession.problemTags.map((tag) => tag.label)
            },
            after: {
              counselorKeyword: updated.counselorKeyword,
              counselorNote: updated.counselorNote,
              counselorFollowup: updated.counselorFollowup,
              moodScale: updated.moodScale,
              problemTags: updated.problemTags.map((tag) => tag.label)
            }
          }),
          editedBy: counselorId
        }
      });

      return updated;
    });

    res.status(200).json({
      success: true,
      message: 'Case note updated successfully',
      data: {
        sessionId: updatedSession.sessionId,
        counselorKeyword: updatedSession.counselorKeyword,
        counselorNote: updatedSession.counselorNote,
        counselorFollowup: updatedSession.counselorFollowup,
        moodScale: updatedSession.moodScale,
        problemTags: updatedSession.problemTags.map((tag) => tag.label)
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'SESSION_NOT_FOUND') {
      return res.status(404).json({ success: false, message: 'Session not found' });
    }

    if (error instanceof Error && error.message === 'FORBIDDEN') {
      return res.status(403).json({ success: false, message: 'You can only edit your own session notes' });
    }

    console.error('Error editing case note:', error);
    res.status(500).json({ success: false, message: 'Failed to edit case note' });
  }
};

// API: Get audit trail for all session edits in a case
export const getCaseHistory = async (req: AuthRequest, res: Response) => {
  try {
    const caseId = Number(req.params.caseId);
    if (!Number.isInteger(caseId) || caseId <= 0) {
      return res.status(400).json({ success: false, message: 'Valid caseId is required' });
    }

    const counselorId = req.user?.userId;
    if (!counselorId) {
      return res.status(401).json({ success: false, message: 'Counselor authentication required' });
    }

    const selectedCase = await prisma.case.findUnique({
      where: { caseId },
      include: {
        sessions: {
          include: {
            histories: {
              orderBy: {
                timestamp: 'desc'
              }
            }
          }
        }
      }
    });

    if (!selectedCase) {
      return res.status(404).json({ success: false, message: 'Case not found' });
    }

    if (selectedCase.counselorId && selectedCase.counselorId !== counselorId) {
      return res.status(403).json({ success: false, message: 'You are not assigned to this case' });
    }

    const history = selectedCase.sessions
      .flatMap((session) =>
        session.histories.map((item) => ({
          id: item.id,
          sessionId: session.sessionId,
          sessionName: session.sessionName,
          action: item.action,
          editedBy: item.editedBy,
          timestamp: item.timestamp,
          details: parseDetails(item.details)
        }))
      )
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    res.status(200).json({
      success: true,
      data: {
        caseId: selectedCase.caseId,
        status: selectedCase.status,
        history
      }
    });
  } catch (error) {
    console.error('Error getting case history:', error);
    res.status(500).json({ success: false, message: 'Failed to get case history' });
  }
};

// API: Update appointment status and trigger notification for rescheduled/cancelled
export const updateAppointmentStatus = async (req: AuthRequest, res: Response) => {
  try {
    const caseId = Number(req.params.caseId);
    if (!Number.isInteger(caseId) || caseId <= 0) {
      return res.status(400).json({ success: false, message: 'Valid caseId is required' });
    }

    const rawStatus = req.body?.status;
    if (typeof rawStatus !== 'string' || rawStatus.trim().length === 0) {
      return res.status(400).json({ success: false, message: 'status is required' });
    }

    const nextStatus = normalizeStatus(rawStatus);
    const allowedStatuses = ['confirmed', 'rescheduled', 'cancelled'];
    if (!allowedStatuses.includes(nextStatus)) {
      return res.status(400).json({
        success: false,
        message: `status must be one of: ${allowedStatuses.join(', ')}`
      });
    }

    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : undefined;
    const counselorId = req.user?.userId;
    if (!counselorId) {
      return res.status(401).json({ success: false, message: 'Counselor authentication required' });
    }

    const result = await prisma.$transaction(async (tx) => {
      const currentCase = await tx.case.findUnique({
        where: { caseId },
        include: {
          client: {
            include: {
              user: {
                select: {
                  cmuAccount: true,
                  firstName: true,
                  lastName: true
                }
              }
            }
          },
          sessions: {
            include: {
              histories: {
                take: 1,
                orderBy: {
                  timestamp: 'desc'
                }
              }
            }
          }
        }
      });

      if (!currentCase) {
        throw new Error('CASE_NOT_FOUND');
      }

      if (currentCase.counselorId && currentCase.counselorId !== counselorId) {
        throw new Error('FORBIDDEN');
      }

      const updatedCase = await tx.case.update({
        where: { caseId },
        data: {
          status: nextStatus,
          counselorId: currentCase.counselorId || counselorId,
          confirmedAt: nextStatus === 'confirmed' ? new Date() : currentCase.confirmedAt
        }
      });

      if (nextStatus === 'cancelled') {
        await tx.session.updateMany({
          where: { caseId },
          data: {
            status: 'available',
            caseId: null
          }
        });
      }

      for (const session of currentCase.sessions) {
        await tx.sessionHistory.create({
          data: {
            sessionId: session.sessionId,
            action: 'appointment_status_updated',
            details: JSON.stringify({
              previousStatus: currentCase.status,
              newStatus: nextStatus,
              reason: reason || null
            }),
            editedBy: counselorId
          }
        });
      }

      return {
        updatedCase,
        clientEmail: currentCase.client.user.cmuAccount,
        clientName: `${currentCase.client.user.firstName} ${currentCase.client.user.lastName}`
      };
    });

    let notification: { channel: string; delivered: boolean; message: string } | null = null;
    if (nextStatus === 'rescheduled' || nextStatus === 'cancelled') {
      notification = await sendAppointmentNotification({
        email: result.clientEmail,
        fullName: result.clientName,
        caseId,
        status: nextStatus,
        reason
      });
    }

    res.status(200).json({
      success: true,
      message: 'Appointment status updated successfully',
      data: {
        caseId: result.updatedCase.caseId,
        status: result.updatedCase.status,
        confirmedAt: result.updatedCase.confirmedAt,
        notification
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'CASE_NOT_FOUND') {
      return res.status(404).json({ success: false, message: 'Case not found' });
    }

    if (error instanceof Error && error.message === 'FORBIDDEN') {
      return res.status(403).json({ success: false, message: 'You are not assigned to this case' });
    }

    console.error('Error updating appointment status:', error);
    res.status(500).json({ success: false, message: 'Failed to update appointment status' });
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

// API: Manage rooms (master data)
export const getRooms = async (req: AuthRequest, res: Response) => {
  try {
    const includeInactive = req.query.includeInactive === 'true';

    const rooms = await prisma.room.findMany({
      where: includeInactive ? undefined : { isActive: true },
      orderBy: { roomName: 'asc' }
    });

    res.status(200).json({ success: true, data: rooms });
  } catch (error) {
    console.error('Error getting rooms:', error);
    res.status(500).json({ success: false, message: 'Failed to get rooms' });
  }
};

export const createRoom = async (req: AuthRequest, res: Response) => {
  try {
    const roomName = typeof req.body?.roomName === 'string' ? req.body.roomName.trim() : '';
    if (!roomName) {
      return res.status(400).json({ success: false, message: 'roomName is required' });
    }

    const room = await prisma.room.create({
      data: {
        roomName,
        isActive: true
      }
    });

    res.status(201).json({ success: true, message: 'Room created successfully', data: room });
  } catch (error) {
    if ((error as any)?.code === 'P2002') {
      return res.status(409).json({ success: false, message: 'Room name already exists' });
    }

    console.error('Error creating room:', error);
    res.status(500).json({ success: false, message: 'Failed to create room' });
  }
};

export const updateRoom = async (req: AuthRequest, res: Response) => {
  try {
    const roomId = Number(req.params.roomId);
    if (!Number.isInteger(roomId) || roomId <= 0) {
      return res.status(400).json({ success: false, message: 'Valid roomId is required' });
    }

    const roomName = typeof req.body?.roomName === 'string' ? req.body.roomName.trim() : undefined;
    const isActive = req.body?.isActive;
    if (roomName === '' || (isActive !== undefined && typeof isActive !== 'boolean')) {
      return res.status(400).json({ success: false, message: 'Invalid payload' });
    }

    if (roomName === undefined && isActive === undefined) {
      return res.status(400).json({ success: false, message: 'At least one field is required' });
    }

    const room = await prisma.room.update({
      where: { roomId },
      data: {
        roomName,
        isActive
      }
    });

    res.status(200).json({ success: true, message: 'Room updated successfully', data: room });
  } catch (error) {
    if ((error as any)?.code === 'P2025') {
      return res.status(404).json({ success: false, message: 'Room not found' });
    }

    if ((error as any)?.code === 'P2002') {
      return res.status(409).json({ success: false, message: 'Room name already exists' });
    }

    console.error('Error updating room:', error);
    res.status(500).json({ success: false, message: 'Failed to update room' });
  }
};

export const softDeleteRoom = async (req: AuthRequest, res: Response) => {
  try {
    const roomId = Number(req.params.roomId);
    if (!Number.isInteger(roomId) || roomId <= 0) {
      return res.status(400).json({ success: false, message: 'Valid roomId is required' });
    }

    const room = await prisma.room.update({
      where: { roomId },
      data: { isActive: false }
    });

    res.status(200).json({ success: true, message: 'Room deactivated successfully', data: room });
  } catch (error) {
    if ((error as any)?.code === 'P2025') {
      return res.status(404).json({ success: false, message: 'Room not found' });
    }

    console.error('Error deleting room:', error);
    res.status(500).json({ success: false, message: 'Failed to delete room' });
  }
};

// API: Manage problem tags (master data)
export const getProblemTags = async (req: AuthRequest, res: Response) => {
  try {
    const includeInactive = req.query.includeInactive === 'true';

    const tags = await prisma.problemTag.findMany({
      where: includeInactive ? undefined : { isActive: true },
      orderBy: { label: 'asc' }
    });

    res.status(200).json({ success: true, data: tags });
  } catch (error) {
    console.error('Error getting problem tags:', error);
    res.status(500).json({ success: false, message: 'Failed to get problem tags' });
  }
};

export const createProblemTag = async (req: AuthRequest, res: Response) => {
  try {
    const label = typeof req.body?.label === 'string' ? req.body.label.trim() : '';
    if (!label) {
      return res.status(400).json({ success: false, message: 'label is required' });
    }

    const tag = await prisma.problemTag.create({
      data: {
        label,
        isActive: true
      }
    });

    res.status(201).json({ success: true, message: 'Tag created successfully', data: tag });
  } catch (error) {
    if ((error as any)?.code === 'P2002') {
      return res.status(409).json({ success: false, message: 'Tag label already exists' });
    }

    console.error('Error creating problem tag:', error);
    res.status(500).json({ success: false, message: 'Failed to create problem tag' });
  }
};

export const updateProblemTag = async (req: AuthRequest, res: Response) => {
  try {
    const tagId = Number(req.params.tagId);
    if (!Number.isInteger(tagId) || tagId <= 0) {
      return res.status(400).json({ success: false, message: 'Valid tagId is required' });
    }

    const label = typeof req.body?.label === 'string' ? req.body.label.trim() : undefined;
    const isActive = req.body?.isActive;
    if (label === '' || (isActive !== undefined && typeof isActive !== 'boolean')) {
      return res.status(400).json({ success: false, message: 'Invalid payload' });
    }

    if (label === undefined && isActive === undefined) {
      return res.status(400).json({ success: false, message: 'At least one field is required' });
    }

    const tag = await prisma.problemTag.update({
      where: { id: tagId },
      data: {
        label,
        isActive
      }
    });

    res.status(200).json({ success: true, message: 'Tag updated successfully', data: tag });
  } catch (error) {
    if ((error as any)?.code === 'P2025') {
      return res.status(404).json({ success: false, message: 'Tag not found' });
    }

    if ((error as any)?.code === 'P2002') {
      return res.status(409).json({ success: false, message: 'Tag label already exists' });
    }

    console.error('Error updating problem tag:', error);
    res.status(500).json({ success: false, message: 'Failed to update problem tag' });
  }
};

export const softDeleteProblemTag = async (req: AuthRequest, res: Response) => {
  try {
    const tagId = Number(req.params.tagId);
    if (!Number.isInteger(tagId) || tagId <= 0) {
      return res.status(400).json({ success: false, message: 'Valid tagId is required' });
    }

    const tag = await prisma.problemTag.update({
      where: { id: tagId },
      data: { isActive: false }
    });

    res.status(200).json({ success: true, message: 'Tag deactivated successfully', data: tag });
  } catch (error) {
    if ((error as any)?.code === 'P2025') {
      return res.status(404).json({ success: false, message: 'Tag not found' });
    }

    console.error('Error deleting problem tag:', error);
    res.status(500).json({ success: false, message: 'Failed to delete problem tag' });
  }
};