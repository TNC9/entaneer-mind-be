// src/controllers/bookingController.ts
import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import nodemailer from "nodemailer";

const prisma = new PrismaClient();

// If you already have auth middleware that sets req.user, use it.
// Otherwise, for dev you can pass header: x-cmu-account: someone@cmu.ac.th
type AuthedRequest = Request & {
  user?: {
    userId?: number;
    cmuAccount?: string;
    email?: string;
  };
};

function getCmuAccount(req: AuthedRequest): string | null {
  return (
    req.user?.cmuAccount ||
    req.user?.email ||
    (req.headers["x-cmu-account"] as string | undefined) ||
    null
  );
}

function formatTimeHHmmBangkok(date: Date): string {
  // Thailand has no DST; using Intl timezone is safe here
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

function bangkokDayRangeUTC(dateYYYYMMDD: string): { start: Date; end: Date } {
  // Interpret date as Bangkok local day
  // Start: 00:00+07:00, End: next day 00:00+07:00
  const start = new Date(`${dateYYYYMMDD}T00:00:00+07:00`);
  const end = new Date(`${dateYYYYMMDD}T00:00:00+07:00`);
  end.setDate(end.getDate() + 1);
  return { start, end };
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

export async function listCounselors(req: Request, res: Response) {
  try {
    const rooms = await prisma.room.findMany({
      where: { isActive: true },
      orderBy: { roomId: "asc" },
    });

    // Try to find a representative counselor email per room from existing sessions
    const reps = await prisma.session.findMany({
      where: {
        roomId: { in: rooms.map((r) => r.roomId) },
        counselorId: { not: null },
      },
      distinct: ["roomId"],
      select: {
        roomId: true,
        counselor: {
          select: {
            user: { select: { cmuAccount: true, firstName: true, lastName: true } },
          },
        },
      },
    });

    const repMap = new Map<number, string | null>();
    for (const r of reps) {
      repMap.set(r.roomId ?? -1, r.counselor?.user?.cmuAccount ?? null);
    }

    res.json(
      rooms.map((room) => ({
        roomId: room.roomId,
        roomName: room.roomName, // ex. "พี่ป๊อป (ห้อง 1)"
        counselorEmail: repMap.get(room.roomId) ?? null,
      }))
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to load counselors" });
  }
}

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

    const { start, end } = bangkokDayRangeUTC(date);

    const room = await prisma.room.findUnique({ where: { roomId } });
    if (!room || !room.isActive) {
      return res.status(404).json({ message: "Room not found" });
    }

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

    const slots = sessions
      .filter((s) => !!s.timeStart) // just in case
      .map((s) => ({
        sessionId: s.sessionId,
        timeStart: s.timeStart!.toISOString(),
        time: formatTimeHHmmBangkok(s.timeStart!),
        available: s.status === "available",
        counselor: room.roomName,
        counselorEmail: s.counselor?.user?.cmuAccount ?? null,
      }));

    res.json({
      date,
      roomId,
      roomName: room.roomName,
      slots,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to load sessions" });
  }
}

export async function bookSession(req: AuthedRequest, res: Response) {
  try {
    const cmuAccount = getCmuAccount(req);
    if (!cmuAccount) {
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

    const user = await prisma.user.findUnique({
      where: { cmuAccount },
      include: { clientProfile: true },
    });

    if (!user) {
      return res.status(404).json({ message: "User not found (cmuAccount)" });
    }

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

    // Save phone to User
    if (user.phoneNum !== phone) {
      await prisma.user.update({
        where: { userId: user.userId },
        data: { phoneNum: phone },
      });
    }

    // Find latest case for this client, or create one if none
    let latestCase = await prisma.case.findFirst({
      where: { clientId: client.clientId },
      orderBy: { createdAt: "desc" },
    });

    if (!latestCase) {
      latestCase = await prisma.case.create({
        data: {
          clientId: client.clientId,
          // status/priority defaults apply
        },
      });
    }

    // Transaction: reserve session if still available + write history
    const txResult = await prisma.$transaction(async (tx) => {
      const session = await tx.session.findUnique({
        where: { sessionId },
        include: {
          room: true,
          counselor: { include: { user: true } },
        },
      });

      if (!session || !session.timeStart) {
        return { ok: false as const, status: 404, message: "Session not found" };
      }

      // Atomic conditional update (prevents double-book)
      const updated = await tx.session.updateMany({
        where: { sessionId, status: "available" },
        data: {
          status: "booked",
          sessionName: studentId,
          caseId: latestCase.caseId,
          // moodScale: (cannot copy from Case; Case has no moodScale in your schema)
        },
      });

      if (updated.count !== 1) {
        return { ok: false as const, status: 409, message: "Session already booked" };
      }

      await tx.sessionHistory.create({
        data: {
          sessionId,
          action: "BOOKING_REQUEST",
          details: JSON.stringify({
            studentId,
            phone,
            description: description ?? "",
            googleEventId: googleEventId ?? null,
            bookedAt: new Date().toISOString(),
          }),
          editedBy: user.userId,
        },
      });

      const roomName = session.room?.roomName ?? `Room ${session.roomId ?? ""}`;
      const timeStr = formatTimeHHmmBangkok(session.timeStart);

      return {
        ok: true as const,
        roomName,
        counselorEmail: session.counselor?.user?.cmuAccount ?? null,
        timeStartISO: session.timeStart.toISOString(),
        timeHHmm: timeStr,
        caseId: latestCase.caseId,
      };
    });

    if (!txResult.ok) {
      return res.status(txResult.status).json({ message: txResult.message });
    }

    // Email client confirmation (from CMU account via SMTP)
    const mailer = buildMailer();
    if (mailer) {
      const from = process.env.MAIL_FROM ?? process.env.SMTP_USER!;
      const to = cmuAccount.includes("@") ? cmuAccount : `${cmuAccount}@cmu.ac.th`;

      const subject = "ยืนยันคำขอจองคิวรับคำปรึกษา (Entaneer Mind)";
      const text = [
        `เราได้รับคำขอจองคิวของคุณแล้ว`,
        ``,
        `ห้อง/ผู้ให้คำปรึกษา: ${txResult.roomName}`,
        `เวลา: ${txResult.timeHHmm} น.`,
        `Case ID: ${txResult.caseId}`,
        ``,
        `หมายเหตุ: ระบบจะอัปเดตสถานะเมื่อผู้ให้คำปรึกษายืนยัน`,
      ].join("\n");

      // Don't fail booking if mail fails
      mailer.sendMail({ from, to, subject, text }).catch((e: unknown) => {
        console.error("Mail error:", e);
      });
    }

    return res.json({
      message: "Booked successfully",
      caseId: txResult.caseId,
      timeStart: txResult.timeStartISO,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Booking failed" });
  }
}