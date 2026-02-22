import { Request, Response } from "express";
import { prisma } from "../prisma";
import type { AuthRequest } from "../middleware/authMiddleware";

const TIMES = ["09:00", "10:00", "11:00", "13:00", "14:00", "15:00"];
const DAYS_TH = ["จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์"];

function toBangkokDateTime(dateYYYYMMDD: string, timeHHmm: string): Date {
  // Create Date in Bangkok timezone (+07:00)
  return new Date(`${dateYYYYMMDD}T${timeHHmm}:00+07:00`);
}

function toYYYYMMDD(d: Date): string {
  // to ISO date based on Bangkok day boundary (safe for TH)
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find(p => p.type === "year")?.value ?? "1970";
  const m = parts.find(p => p.type === "month")?.value ?? "01";
  const day = parts.find(p => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${day}`;
}

function formatTimeHHmmBangkok(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);

  const hh = parts.find(p => p.type === "hour")?.value ?? "00";
  const mm = parts.find(p => p.type === "minute")?.value ?? "00";
  return `${hh}:${mm}`;
}

function weekRange(weekStartYYYYMMDD: string) {
  // weekStart should be Monday (YYYY-MM-DD)
  const start = new Date(`${weekStartYYYYMMDD}T00:00:00+07:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 5); // Saturday 00:00 (exclusive)
  return { start, end };
}

function caseCodeFromSession(sessionName: string | null, sessionId: number) {
  const yy = (sessionName ?? "").slice(0, 2) || "00";
  const num = String(sessionId).padStart(3, "0");
  return `CASE-${yy}-${num}`;
}

/* =========================================================
   ROOMS
   ========================================================= */

export async function listRooms(_req: Request, res: Response) {
  try {
    const rooms = await prisma.room.findMany({
      where: { isActive: true },
      orderBy: { roomId: "asc" },
      select: { roomId: true, roomName: true },
    });
    return res.json(
      rooms.map(r => ({ id: String(r.roomId), name: r.roomName }))
    );
  } catch (err) {
    console.error("listRooms error:", err);
    return res.status(500).json({ message: "Failed to load rooms" });
  }
}

export async function createRoom(req: AuthRequest, res: Response) {
  try {
    const roomName = String(req.body?.roomName ?? "").trim();
    if (!roomName) return res.status(400).json({ message: "roomName is required" });

    const created = await prisma.room.create({
      data: { roomName, isActive: true },
      select: { roomId: true, roomName: true },
    });

    return res.status(201).json({ id: String(created.roomId), name: created.roomName });
  } catch (err) {
    console.error("createRoom error:", err);
    return res.status(500).json({ message: "Failed to create room" });
  }
}

export async function deleteRoom(req: AuthRequest, res: Response) {
  try {
    const roomId = Number(req.params.roomId);
    if (!roomId || Number.isNaN(roomId)) return res.status(400).json({ message: "Invalid roomId" });

    // Soft delete (recommended)
    await prisma.room.update({
      where: { roomId },
      data: { isActive: false },
    });

    return res.json({ success: true });
  } catch (err) {
    console.error("deleteRoom error:", err);
    return res.status(500).json({ message: "Failed to delete room" });
  }
}

/* =========================================================
   SCHEDULE (WEEK)
   ========================================================= */

/**
 * GET /api/session-portal/schedule?roomId=1&weekStart=YYYY-MM-DD
 */
export async function getWeekSchedule(req: AuthRequest, res: Response) {
  try {
    const roomId = Number(req.query.roomId);
    const weekStart = String(req.query.weekStart ?? "");

    if (!roomId || Number.isNaN(roomId)) return res.status(400).json({ message: "Invalid roomId" });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) return res.status(400).json({ message: "Invalid weekStart" });

    const room = await prisma.room.findUnique({ where: { roomId } });
    if (!room || !room.isActive) return res.status(404).json({ message: "Room not found" });

    const { start, end } = weekRange(weekStart);

    const sessions = await prisma.session.findMany({
      where: {
        roomId,
        timeStart: { gte: start, lt: end },
      },
      include: {
        case: {
          include: {
            client: {
              include: { user: { select: { firstName: true, lastName: true } } },
            },
          },
        },
      },
      orderBy: [{ timeStart: "asc" }, { sessionId: "asc" }],
    });

    // Map sessions to blocks used by frontend (day/time)
    const blocks = sessions
      .filter(s => !!s.timeStart)
      .map(s => {
        const time = formatTimeHHmmBangkok(s.timeStart!);

        // day index from weekStart
        const dateStr = toYYYYMMDD(s.timeStart!);
        const startDate = new Date(`${weekStart}T00:00:00+07:00`);
        const curDate = new Date(`${dateStr}T00:00:00+07:00`);
        const dayIndex = Math.floor((curDate.getTime() - startDate.getTime()) / 86400000);

        const day = DAYS_TH[dayIndex] ?? "";

        const isBooked = (s.status || "").toLowerCase() === "booked" && !!s.caseId;

        const studentName =
          s.case?.client?.user
            ? `${s.case.client.user.firstName} ${s.case.client.user.lastName}`
            : (s.sessionName ?? "");

        return {
          sessionId: s.sessionId,
          day,
          date: dateStr,
          time,
          available: (s.status || "").toLowerCase() === "available" || isBooked,
          status: s.status,
          bookedBy: isBooked ? studentName : undefined,
          caseCode: isBooked ? caseCodeFromSession(s.sessionName ?? null, s.sessionId) : undefined,
        };
      });

    return res.json({
      roomId,
      roomName: room.roomName,
      weekStart,
      times: TIMES,
      days: DAYS_TH,
      blocks,
    });
  } catch (err) {
    console.error("getWeekSchedule error:", err);
    return res.status(500).json({ message: "Failed to load schedule" });
  }
}

/**
 * PUT /api/session-portal/slots/toggle
 * Body: { roomId, date:YYYY-MM-DD, time:"HH:mm" }
 *
 * - If slot not exist: create status="available" (sessionName=null)
 * - If status available <-> closed
 * - If booked: reject (use cancel)
 */
export async function toggleSlot(req: AuthRequest, res: Response) {
  try {
    const roomId = Number(req.body?.roomId);
    const date = String(req.body?.date ?? "");
    const time = String(req.body?.time ?? "");

    if (!roomId || Number.isNaN(roomId)) return res.status(400).json({ message: "Invalid roomId" });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ message: "Invalid date" });
    if (!/^\d{2}:\d{2}$/.test(time)) return res.status(400).json({ message: "Invalid time" });

    const timeStart = toBangkokDateTime(date, time);
    const timeEnd = new Date(timeStart);
    timeEnd.setHours(timeEnd.getHours() + 1);

    const existing = await prisma.session.findFirst({
      where: { roomId, timeStart },
      select: { sessionId: true, status: true, caseId: true },
    });

    // create if missing
    if (!existing) {
      const created = await prisma.session.create({
        data: {
          roomId,
          timeStart,
          timeEnd,
          status: "available",
          sessionName: null,
        },
        select: { sessionId: true, status: true },
      });

      return res.json({ success: true, sessionId: created.sessionId, status: created.status });
    }

    // booked slot cannot toggle
    if ((existing.status || "").toLowerCase() === "booked" && existing.caseId) {
      return res.status(409).json({ message: "Slot is booked. Cancel booking instead." });
    }

    const cur = (existing.status || "").toLowerCase();
    const nextStatus = cur === "available" ? "closed" : "available";

    const updated = await prisma.session.update({
      where: { sessionId: existing.sessionId },
      data: { status: nextStatus, sessionName: null, caseId: null },
      select: { sessionId: true, status: true },
    });

    // optional: record history
    if (req.user?.userId) {
      await prisma.sessionHistory.create({
        data: {
          sessionId: updated.sessionId,
          action: "PORTAL_SLOT_TOGGLED",
          details: JSON.stringify({ from: existing.status, to: updated.status, date, time, roomId }),
          editedBy: req.user.userId,
        },
      });
    }

    return res.json({ success: true, sessionId: updated.sessionId, status: updated.status });
  } catch (err) {
    console.error("toggleSlot error:", err);
    return res.status(500).json({ message: "Failed to toggle slot" });
  }
}

/**
 * POST /api/session-portal/slots/:sessionId/cancel
 * Cancels booked appointment and re-opens slot to available.
 */
export async function cancelBookedSlot(req: AuthRequest, res: Response) {
  try {
    const sessionId = Number(req.params.sessionId);
    if (!sessionId || Number.isNaN(sessionId)) return res.status(400).json({ message: "Invalid sessionId" });

    const s = await prisma.session.findUnique({
      where: { sessionId },
      include: {
        case: { include: { client: { include: { user: true } } } },
      },
    });

    if (!s) return res.status(404).json({ message: "Session not found" });

    const isBooked = (s.status || "").toLowerCase() === "booked" && !!s.caseId;
    if (!isBooked) return res.status(409).json({ message: "This slot is not booked" });

    const bookedName =
      s.case?.client?.user ? `${s.case.client.user.firstName} ${s.case.client.user.lastName}` : (s.sessionName ?? "");

    await prisma.session.update({
      where: { sessionId },
      data: {
        status: "available",
        caseId: null,
        sessionName: null,
        counselorKeyword: null,
        counselorNote: null,
        counselorFollowup: null,
        moodScale: null,
        problemTags: { set: [] },
      },
    });

    if (req.user?.userId) {
      await prisma.sessionHistory.create({
        data: {
          sessionId,
          action: "PORTAL_CANCELLED_BOOKING",
          details: JSON.stringify({
            bookedName,
            previousCaseId: s.caseId,
            previousStatus: s.status,
          }),
          editedBy: req.user.userId,
        },
      });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("cancelBookedSlot error:", err);
    return res.status(500).json({ message: "Failed to cancel booking" });
  }
}

/**
 * PUT /api/session-portal/week/bulk
 * Body: { roomId, weekStart, makeAvailable: boolean }
 * Sets all slots for Mon-Fri TIMES to available/closed (keeps booked slots as-is).
 */
export async function bulkWeek(req: AuthRequest, res: Response) {
  try {
    const roomId = Number(req.body?.roomId);
    const weekStart = String(req.body?.weekStart ?? "");
    const makeAvailable = !!req.body?.makeAvailable;

    if (!roomId || Number.isNaN(roomId)) return res.status(400).json({ message: "Invalid roomId" });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) return res.status(400).json({ message: "Invalid weekStart" });

    const { start } = weekRange(weekStart);

    const changes: number[] = [];

    for (let di = 0; di < 5; di++) {
      const day = new Date(start);
      day.setDate(day.getDate() + di);
      const dateStr = toYYYYMMDD(day);

      for (const time of TIMES) {
        const timeStart = toBangkokDateTime(dateStr, time);
        const timeEnd = new Date(timeStart);
        timeEnd.setHours(timeEnd.getHours() + 1);

        const existing = await prisma.session.findFirst({
          where: { roomId, timeStart },
          select: { sessionId: true, status: true, caseId: true },
        });

        if (!existing) {
          const created = await prisma.session.create({
            data: {
              roomId,
              timeStart,
              timeEnd,
              status: makeAvailable ? "available" : "closed",
              sessionName: null,
            },
            select: { sessionId: true },
          });
          changes.push(created.sessionId);
          continue;
        }

        const isBooked = (existing.status || "").toLowerCase() === "booked" && !!existing.caseId;
        if (isBooked) continue;

        const nextStatus = makeAvailable ? "available" : "closed";
        if ((existing.status || "").toLowerCase() === nextStatus) continue;

        await prisma.session.update({
          where: { sessionId: existing.sessionId },
          data: { status: nextStatus, sessionName: null, caseId: null },
        });
        changes.push(existing.sessionId);
      }
    }

    // optional history summary
    if (req.user?.userId && changes.length > 0) {
      await prisma.sessionHistory.create({
        data: {
          sessionId: changes[0], // just reference one session
          action: "PORTAL_BULK_WEEK",
          details: JSON.stringify({ roomId, weekStart, makeAvailable, changedCount: changes.length }),
          editedBy: req.user.userId,
        },
      });
    }

    return res.json({ success: true, changedCount: changes.length });
  } catch (err) {
    console.error("bulkWeek error:", err);
    return res.status(500).json({ message: "Failed to bulk update" });
  }
}