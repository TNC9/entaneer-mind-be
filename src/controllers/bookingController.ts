import { Request, Response } from "express";
import nodemailer from "nodemailer";
import { prisma } from "../prisma";
import type { AuthRequest } from "../middleware/authMiddleware";

/** Helpers */
function bangkokDayRangeUTC(dateYYYYMMDD: string): { start: Date; end: Date } {
  // Interpret date as Bangkok local day
  // Start: 00:00+07:00, End: next day 00:00+07:00
  const start = new Date(`${dateYYYYMMDD}T00:00:00+07:00`);
  const end = new Date(`${dateYYYYMMDD}T00:00:00+07:00`);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function formatTimeHHmmBangkok(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Bangkok",
  }).formatToParts(date);

  const hh = parts.find((p) => p.type === "hour")?.value ?? "00";
  const mm = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${hh}:${mm}`;
}

function buildMailer() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) return null;

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

/**
 * GET /api/bookings/counselors
 * Return active rooms with assigned counselor name.
 */
export async function listCounselors(_req: Request, res: Response) {
  try {
    const rooms = await prisma.room.findMany({
      where: { isActive: true },
      orderBy: { roomId: "asc" },
      include: {
        counselor: {
          include: {
            user: {
              select: {
                firstName: true,
                lastName: true,
                cmuAccount: true,
              },
            },
          },
        },
      },
    });

    return res.json(
      rooms.map((room) => ({
        roomId: room.roomId,
        roomName: room.roomName,
        counselorName: room.counselor?.user
          ? `${room.counselor.user.firstName} ${room.counselor.user.lastName}`
          : null,
        counselorEmail: room.counselor?.user?.cmuAccount ?? null,
      }))
    );
  } catch (err) {
    console.error("listCounselors error:", err);
    return res.status(500).json({ message: "Failed to load counselors" });
  }
}

/**
 * GET /api/bookings/sessions?roomId=1&date=YYYY-MM-DD
 * Return slots (available or not) for selected room and day.
 */
export async function listSessions(req: Request, res: Response) {
  try {
    const date = String(req.query.date ?? "");
    const roomId = Number(req.query.roomId);

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ message: "Invalid date (YYYY-MM-DD required)" });
    }
    if (!Number.isFinite(roomId)) {
      return res.status(400).json({ message: "Invalid roomId" });
    }

    const room = await prisma.room.findUnique({
      where: { roomId },
      include: {
        counselor: {
          include: {
            user: {
              select: {
                firstName: true,
                lastName: true,
                cmuAccount: true,
              },
            },
          },
        },
      },
    });

    if (!room || !room.isActive) {
      return res.status(404).json({ message: "Room not found" });
    }

    const { start, end } = bangkokDayRangeUTC(date);

    const sessions = await prisma.session.findMany({
      where: {
        roomId,
        timeStart: { gte: start, lt: end },
      },
      orderBy: [{ timeStart: "asc" }, { sessionId: "asc" }],
      include: {
        counselor: { include: { user: true } },
      },
    });

    const counselorName = room.counselor?.user
      ? `${room.counselor.user.firstName} ${room.counselor.user.lastName}`
      : null;

    const slots = sessions
      .filter((s) => !!s.timeStart)
      .map((s) => ({
        sessionId: s.sessionId,
        timeStart: s.timeStart!.toISOString(),
        time: formatTimeHHmmBangkok(s.timeStart!),
        available: (s.status || "").toLowerCase() === "available",
        counselor: counselorName ?? room.roomName,
        counselorEmail:
          s.counselor?.user?.cmuAccount ??
          room.counselor?.user?.cmuAccount ??
          null,
      }));

    return res.json({
      date,
      roomId,
      roomName: room.roomName,
      counselorName,
      slots,
    });
  } catch (err) {
    console.error("listSessions error:", err);
    return res.status(500).json({ message: "Failed to load sessions" });
  }
}

/**
 * POST /api/bookings/book
 * Body: { sessionId, studentId, phone, description?, googleEventId? }
 *
 * Requires authenticateToken + requireClient in routes so req.user exists.
 */
export async function bookSession(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    const cmuAccount = req.user?.cmuAccount;

    if (!userId || !cmuAccount) {
      return res.status(401).json({ message: "Unauthorized (missing cmuAccount)" });
    }

    const { sessionId, studentId, phone, description, googleEventId } = req.body as {
      sessionId: number;
      studentId: string;
      phone: string;
      description?: string;
      googleEventId?: string | null;
    };

    if (!Number.isFinite(sessionId)) {
      return res.status(400).json({ message: "sessionId is required" });
    }
    if (!studentId || !/^\d{9}$/.test(studentId)) {
      return res.status(400).json({ message: "studentId must be 9 digits" });
    }
    if (!phone || !/^\d{10}$/.test(phone)) {
      return res.status(400).json({ message: "phone must be 10 digits" });
    }

    // Load user + client profile
    const user = await prisma.user.findUnique({
      where: { userId },
      include: { clientProfile: true },
    });
    if (!user) return res.status(404).json({ message: "User not found" });

    // Ensure client profile exists and matches studentId
    let client = user.clientProfile;
    if (!client) {
      client = await prisma.client.create({
        data: {
          userId: user.userId,
          clientId: studentId,
        },
      });
    } else if (client.clientId !== studentId) {
      return res.status(400).json({
        message: "studentId does not match your client profile",
      });
    }

    // Save phone into User.phoneNum (optional)
    if ((user.phoneNum || "") !== phone) {
      await prisma.user.update({
        where: { userId: user.userId },
        data: { phoneNum: phone },
      });
    }

    // Find latest case for this client, create if none
    let latestCase = await prisma.case.findFirst({
      where: { clientId: client.clientId },
      orderBy: { createdAt: "desc" },
    });

    if (!latestCase) {
      latestCase = await prisma.case.create({
        data: {
          clientId: client.clientId,
          // status/priority defaults
        },
      });
    }

    // Transaction: reserve the session atomically + history record
    const result = await prisma.$transaction(async (tx) => {
      const session = await tx.session.findUnique({
        where: { sessionId },
        include: {
          room: {
            include: {
              counselor: {
                include: {
                  user: true,
                },
              },
            },
          },
          counselor: { include: { user: true } },
        },
      });

      if (!session || !session.timeStart) {
        return { ok: false as const, status: 404, message: "Session not found" };
      }

      //  --- รันเลข Token ---
      const caseToken = await getOrGenerateQueueToken(latestCase.caseId, tx);
      const sessionCount = await tx.session.count({
        where: { caseId: latestCase.caseId }
      });
      const sessionToken = `${caseToken}-${(sessionCount + 1).toString().padStart(3, "0")}`;

      // Atomic conditional update to prevent double booking
      const updated = await tx.session.updateMany({
        where: { sessionId, status: "available" },
        data: {
          status: "booked",
          sessionName: studentId,
          caseId: latestCase.caseId,
          sessionToken: sessionToken,
        },
      });

      if (updated.count !== 1) {
        return { ok: false as const, status: 409, message: "Session already booked" };
      }

      const counselorName =
        session.room?.counselor?.user
          ? `${session.room.counselor.user.firstName} ${session.room.counselor.user.lastName}`
          : null;

      // ✅ Store what the user typed (description) in history details
      await tx.sessionHistory.create({
        data: {
          sessionId,
          action: "CLIENT_BOOKED",
          details: JSON.stringify({
            studentId,
            phone,
            description: description ?? "",
            googleEventId: googleEventId ?? null,
            roomName: session.room?.roomName ?? null,
            counselorName,
            timeStart: session.timeStart.toISOString(),
          }),
          editedBy: user.userId,
        },
      });

      return {
        ok: true as const,
        roomName: session.room?.roomName ?? "ห้อง",
        counselorName,
        counselorEmail:
          session.counselor?.user?.cmuAccount ??
          session.room?.counselor?.user?.cmuAccount ??
          null,
        timeStartISO: session.timeStart.toISOString(),
        timeHHmm: formatTimeHHmmBangkok(session.timeStart),
        caseId: latestCase.caseId,
      };
    });

    if (!result.ok) {
      return res.status(result.status).json({ message: result.message });
    }

    // Optional email to client (only if SMTP env exists)
    const mailer = buildMailer();
    if (mailer) {
      const from = process.env.MAIL_FROM ?? process.env.SMTP_USER!;
      const to = cmuAccount;

      const subject = "ยืนยันคำขอจองคิวรับคำปรึกษา (Entaneer Mind)";
      const text = [
        `เราได้รับคำขอจองคิวของคุณแล้ว`,
        ``,
        `ผู้ให้คำปรึกษา: ${result.counselorName ?? "-"}`,
        `ห้อง: ${result.roomName}`,
        `วันเวลา: ${result.timeHHmm} น.`,
        `Case ID: ${result.caseId}`,
        ``,
        `เรื่องที่ต้องการปรึกษา: ${description ?? "-"}`,
        ``,
        `หมายเหตุ: ระบบจะอัปเดตสถานะเมื่อผู้ให้คำปรึกษายืนยัน`,
      ].join("\n");

      mailer.sendMail({ from, to, subject, text }).catch((e) => {
        console.error("Mail error:", e);
      });
    }

    return res.json({
      message: "Booked successfully",
      caseId: result.caseId,
      sessionId,
      timeStart: result.timeStartISO,
      counselorName: result.counselorName,
      roomName: result.roomName,
    });
  } catch (err) {
    console.error("bookSession error:", err);
    return res.status(500).json({ message: "Booking failed" });
  }
}

async function getOrGenerateQueueToken(caseId: number, tx: any) {
  const currentCase = await tx.case.findUnique({ where: { caseId } });
  if (currentCase.queueToken) return currentCase.queueToken;

  const now = new Date();
  const thaiYear = now.getFullYear() + 543;
  const yearPrefix = thaiYear.toString().slice(-2);

  const lastCase = await tx.case.findFirst({
    where: { queueToken: { startsWith: yearPrefix } },
    orderBy: { queueToken: "desc" },
  });

  let nextNumber = 1;
  if (lastCase && lastCase.queueToken) {
    const lastNumber = parseInt(lastCase.queueToken.slice(2), 10);
    nextNumber = lastNumber + 1;
  }
  const newToken = `${yearPrefix}${nextNumber.toString().padStart(4, "0")}`;

  await tx.case.update({
    where: { caseId },
    data: { queueToken: newToken },
  });

  return newToken;
}