import { Response } from "express";
import { prisma } from "../prisma";
import type { AuthRequest } from "../middleware/authMiddleware";

// helpers
function safeJsonParse(input: string | null | undefined): any {
  if (!input) return null;
  try { return JSON.parse(input); } catch { return null; }
}

function inferClientNotes(details: string | null | undefined): string | undefined {
  const obj = safeJsonParse(details);
  if (obj && typeof obj === "object") {
    if (typeof obj.description === "string") return obj.description;
    if (typeof obj.notes === "string") return obj.notes;
  }
  // fallback: if it wasn't JSON, treat it as plain text
  if (details && details.trim()) return details.trim();
  return undefined;
}

function mapStatus(input: string | null | undefined): "upcoming" | "completed" | "cancelled" {
  const s = (input || "").toLowerCase().trim();
  if (s === "completed" || s === "done") return "completed";
  // everything booked-ish is upcoming from client view
  return "upcoming";
}

/**
 * GET /api/sessions/history
 * Client session history derived from SessionHistory (CLIENT_BOOKED + CLIENT_CANCELLED)
 */
export async function getClientSessionHistory(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    const clientId = req.user?.clientId;

    if (!userId || !clientId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    // 1) get all CLIENT_BOOKED histories for this user
    const booked = await prisma.sessionHistory.findMany({
      where: { editedBy: userId, action: "CLIENT_BOOKED" },
      orderBy: { timestamp: "desc" },
      include: {
        session: {
          include: {
            room: true,
            case: { select: { clientId: true } },
          },
        },
      },
    });

    const sessionIds = booked.map(h => h.sessionId);
    if (sessionIds.length === 0) {
      return res.json({ appointments: [] });
    }

    // 2) latest cancel history per session (for this user)
    const cancelled = await prisma.sessionHistory.findMany({
      where: {
        editedBy: userId,
        action: "CLIENT_CANCELLED",
        sessionId: { in: sessionIds },
      },
      orderBy: { timestamp: "desc" },
    });

    const cancelledMap = new Map<number, Date>(); // sessionId -> latest cancel timestamp
    for (const c of cancelled) {
      if (!cancelledMap.has(c.sessionId)) cancelledMap.set(c.sessionId, c.timestamp);
    }

    // 3) Build response
    const appointments = booked.map((h) => {
      const s = h.session;
      const roomName = s?.room?.roomName || "ห้อง";
      const timeStart = s?.timeStart ? s.timeStart.toISOString() : null;

      // Determine if currently booked by this same client
      const isCurrentlyBookedByClient =
        !!s?.caseId && s?.case?.clientId === clientId && (s.status || "").toLowerCase() !== "available";

      let status: "upcoming" | "completed" | "cancelled";
      if (isCurrentlyBookedByClient) {
        status = mapStatus(s.status);
      } else {
        // if not currently booked, but has cancel history => cancelled
        status = cancelledMap.has(s.sessionId) ? "cancelled" : "completed";
      }

      return {
        id: String(s.sessionId),
        sessionId: s.sessionId,
        timeStart,
        counselor: roomName,
        status,
        notes: inferClientNotes(h.details) || "—",
      };
    });

    return res.json({ appointments });
  } catch (err) {
    console.error("getClientSessionHistory error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
}

/**
 * POST /api/sessions/:sessionId/cancel
 * Make slot available again and unlink from case
 */
export async function cancelClientSession(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    const clientId = req.user?.clientId;
    const sessionId = Number(req.params.sessionId);

    if (!userId || !clientId) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    if (!sessionId || Number.isNaN(sessionId)) {
      return res.status(400).json({ message: "Invalid sessionId" });
    }

    const session = await prisma.session.findUnique({
      where: { sessionId },
      include: { case: { select: { clientId: true } } },
    });

    if (!session) return res.status(404).json({ message: "Session not found" });

    // must belong to the client currently
    if (!session.caseId || session.case?.clientId !== clientId) {
      return res.status(403).json({ message: "You cannot cancel this session" });
    }

    // update session back to available and remove booking fields
    await prisma.session.update({
      where: { sessionId },
      data: {
        status: "available",
        caseId: null,
        sessionName: null,
        // optional: clear fields that came from booking
        counselorKeyword: null,
        counselorNote: null,
        counselorFollowup: null,
        moodScale: null,
      },
    });

    await prisma.sessionHistory.create({
      data: {
        sessionId,
        action: "CLIENT_CANCELLED",
        details: "cancelled by client",
        editedBy: userId,
      },
    });

    return res.json({ success: true });
  } catch (err) {
    console.error("cancelClientSession error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
}