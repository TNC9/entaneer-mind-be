import { Prisma } from "@prisma/client";
import { Request, Response } from "express";
import nodemailer from "nodemailer";
import { prisma } from "../prisma";
import type { AuthRequest } from "../middleware/authMiddleware";

/** Helpers */
function bangkokDayRangeUTC(dateYYYYMMDD: string): { start: Date; end: Date } {
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

function isUniqueConstraintError(err: unknown, fieldName: string): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (err.code !== "P2002") return false;

  const target = err.meta?.target;

  if (Array.isArray(target)) {
    return target.includes(fieldName);
  }

  if (typeof target === "string") {
    return target === fieldName;
  }

  return false;
}

async function getNextSessionToken(
  caseToken: string,
  tx: Prisma.TransactionClient
): Promise<string> {
  const rows = await tx.session.findMany({
    where: {
      sessionToken: {
        startsWith: `${caseToken}-`,
      },
    },
    select: {
      sessionToken: true,
    },
  });

  let maxSeq = 0;
  const regex = new RegExp(`^${caseToken}-(\\d+)$`);

  for (const row of rows) {
    const token = row.sessionToken ?? "";
    const match = token.match(regex);
    if (!match) continue;

    const seq = Number(match[1]);
    if (!Number.isNaN(seq) && seq > maxSeq) {
      maxSeq = seq;
    }
  }

  return `${caseToken}-${String(maxSeq + 1).padStart(3, "0")}`;
}

async function getOrGenerateQueueToken(
  caseId: number,
  tx: Prisma.TransactionClient
): Promise<string> {
  const currentCase = await tx.case.findUnique({
    where: { caseId },
    select: { queueToken: true },
  });

  if (currentCase?.queueToken) return currentCase.queueToken;

  const now = new Date();
  const thaiYear = now.getFullYear() + 543;
  const yearPrefix = thaiYear.toString().slice(-2);

  const lastCase = await tx.case.findFirst({
    where: { queueToken: { startsWith: yearPrefix } },
    orderBy: { queueToken: "desc" },
    select: { queueToken: true },
  });

  let nextNumber = 1;
  if (lastCase?.queueToken) {
    const lastNumber = parseInt(lastCase.queueToken.slice(2), 10);
    if (!Number.isNaN(lastNumber)) {
      nextNumber = lastNumber + 1;
    }
  }

  const newToken = `${yearPrefix}${nextNumber.toString().padStart(4, "0")}`;

  await tx.case.update({
    where: { caseId },
    data: { queueToken: newToken },
  });

  return newToken;
}

/**
 * GET /api/bookings/counselors
 * Return active rooms with assigned counselor name/email.
 * Also keeps roomName in the response.
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
        roomId: Number(roomId),
        timeStart: {
          gte: start,
          lt: end,
        },
        status: {
          not: 'closed',
        },
      },
      orderBy: {
        timeStart: 'asc',
      },
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
      },
    });

    const counselorName = room.counselor?.user
      ? `${room.counselor.user.firstName} ${room.counselor.user.lastName}`
      : null;

    const slots = sessions.map((session) => ({
      sessionId: session.sessionId,
      timeStart: session.timeStart,
      formattedTime: session.timeStart
        ? formatTimeHHmmBangkok(session.timeStart)
        : '',
      available: session.status === 'available',
      status: session.status,
      counselor: session.counselorId,
      counselorEmail: session.room?.counselor?.user?.cmuAccount ?? null,
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
 * Body: { sessionId, studentId?, phone?, description?, googleEventId? }
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
      studentId?: string;
      phone?: string;
      description?: string;
      googleEventId?: string | null;
    };

    if (!Number.isFinite(sessionId)) {
      return res.status(400).json({ message: "sessionId is required" });
    }

    if (studentId && !/^\d{9}$/.test(studentId)) {
      return res.status(400).json({ message: "studentId must be 9 digits" });
    }

    if (phone && !/^\d{10}$/.test(phone)) {
      return res.status(400).json({ message: "phone must be 10 digits" });
    }

    const user = await prisma.user.findUnique({
      where: { userId },
      include: { clientProfile: true },
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    let client = user.clientProfile;
    if (!client) {
      const newClientId =
        studentId && /^\d{9}$/.test(studentId) ? studentId : cmuAccount;

      client = await prisma.client.create({
        data: {
          userId: user.userId,
          clientId: newClientId,
        },
      });
    }

    if (phone && phone.trim() !== "" && (user.phoneNum || "") !== phone) {
      await prisma.user.update({
        where: { userId: user.userId },
        data: { phoneNum: phone },
      });
    }

    let activeCase = await prisma.case.findFirst({
      where: {
        clientId: client.clientId,
        status: { in: ["waiting_confirmation", "confirmed", "in_progress"] },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!activeCase) {
      activeCase = await prisma.case.create({
        data: {
          clientId: client.clientId,
          status: "waiting_confirmation",
        },
      });
    }

    const result = await prisma.$transaction(
      async (tx) => {
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
            counselor: {
              include: {
                user: true,
              },
            },
          },
        });

        if (!session || !session.timeStart) {
          return { ok: false as const, status: 404, message: "Session not found" };
        }

        if ((session.status || "").toLowerCase() !== "available") {
          return { ok: false as const, status: 409, message: "Session already booked" };
        }

        const caseToken = await getOrGenerateQueueToken(activeCase.caseId, tx);
        const sessionNameStr = client.clientId;
        const targetCounselorId =
          session.room?.counselorId ?? session.counselorId ?? null;

        let assignedSessionToken: string | null = null;
        let booked = false;

        for (let attempt = 0; attempt < 5; attempt++) {
          assignedSessionToken = await getNextSessionToken(caseToken, tx);

          try {
            const updated = await tx.session.updateMany({
              where: {
                sessionId,
                status: "available",
              },
              data: {
                status: "booked",
                sessionName: sessionNameStr,
                caseId: activeCase.caseId,
                sessionToken: assignedSessionToken,
                counselorId: targetCounselorId,
              },
            });

            if (updated.count === 1) {
              booked = true;
              break;
            }

            return {
              ok: false as const,
              status: 409,
              message: "Session already booked",
            };
          } catch (err) {
            if (isUniqueConstraintError(err, "sessionToken")) {
              assignedSessionToken = null;
              continue;
            }
            throw err;
          }
        }

        if (!booked || !assignedSessionToken) {
          return {
            ok: false as const,
            status: 500,
            message: "Could not allocate unique session token",
          };
        }

        if (targetCounselorId && !activeCase.counselorId) {
          await tx.case.update({
            where: { caseId: activeCase.caseId },
            data: { counselorId: targetCounselorId },
          });
        }

        const counselorName = session.room?.counselor?.user
          ? `${session.room.counselor.user.firstName} ${session.room.counselor.user.lastName}`
          : session.counselor?.user
            ? `${session.counselor.user.firstName} ${session.counselor.user.lastName}`
            : null;

        await tx.sessionHistory.create({
          data: {
            sessionId,
            action: "CLIENT_BOOKED",
            details: JSON.stringify({
              studentId: studentId ?? client.clientId,
              phone: phone ?? user.phoneNum ?? "",
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
          caseId: activeCase.caseId,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }
    );

    if (!result.ok) {
      return res.status(result.status).json({ message: result.message });
    }

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
  } catch (err: any) {
    console.error("bookSession error:", err);

    if (err?.message === "Session already booked") {
      return res.status(409).json({ message: "Session already booked" });
    }

    return res.status(500).json({
      message: err?.message || "Booking failed",
    });
  }
}