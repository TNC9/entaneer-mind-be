import { Response } from "express";
import { prisma } from "../prisma";
import type { AuthRequest } from "../middleware/authMiddleware";

/* ---------------- helpers ---------------- */

function safeJsonParse(input: string | null | undefined): any {
  if (!input) return null;
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

function inferClientNotes(details: string | null | undefined): string {
  const obj = safeJsonParse(details);
  if (obj && typeof obj === "object") {
    if (typeof obj.description === "string") return obj.description;
    if (typeof obj.notes === "string") return obj.notes;
  }
  if (details && details.trim()) return details.trim();
  return "";
}

function formatDateISO(d: Date | null): string {
  if (!d) return "";
  return d.toISOString().split("T")[0];
}

function formatTimeHHmm(d: Date | null): string {
  if (!d) return "";
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** Pull client's booking text from CLIENT_BOOKED history */
async function getClientBookingText(sessionId: number) {
  const h = await prisma.sessionHistory.findFirst({
    where: { sessionId, action: "CLIENT_BOOKED" },
    orderBy: { timestamp: "desc" },
    select: { details: true },
  });
  return inferClientNotes(h?.details);
}

/* =========================================================
   CLIENT SIDE (History + Cancel)
   ========================================================= */

/**
 * GET /api/sessions/history
 * Client history derived from SessionHistory actions (CLIENT_BOOKED/CLIENT_CANCELLED)
 */
export async function getClientSessionHistory(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    const clientId = req.user?.clientId;

    if (!userId || !clientId) return res.status(401).json({ message: "Unauthorized" });

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

    const sessionIds = booked.map((h) => h.sessionId);
    if (sessionIds.length === 0) return res.json({ appointments: [] });

    const cancelled = await prisma.sessionHistory.findMany({
      where: {
        editedBy: userId,
        action: "CLIENT_CANCELLED",
        sessionId: { in: sessionIds },
      },
      orderBy: { timestamp: "desc" },
      select: { sessionId: true, timestamp: true },
    });

    const cancelledSet = new Set<number>();
    for (const c of cancelled) cancelledSet.add(c.sessionId);

    const appointments = booked.map((h) => {
      const s = h.session;
      const timeStart = s?.timeStart ? s.timeStart.toISOString() : null;

      const isCurrentlyBookedByClient =
        !!s?.caseId && s?.case?.clientId === clientId && (s.status || "").toLowerCase() !== "available";

      let status: "upcoming" | "completed" | "cancelled" = "completed";
      if (isCurrentlyBookedByClient) status = "upcoming";
      else if (cancelledSet.has(s.sessionId)) status = "cancelled";

      return {
        id: String(s.sessionId),
        sessionId: s.sessionId,
        timeStart,
        counselor: s?.room?.roomName ?? "ห้อง",
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
 * Reset session back to available + unlink booking fields
 */
export async function cancelClientSession(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    const clientId = req.user?.clientId;
    const sessionId = Number(req.params.sessionId);

    if (!userId || !clientId) return res.status(401).json({ message: "Unauthorized" });
    if (!sessionId || Number.isNaN(sessionId)) return res.status(400).json({ message: "Invalid sessionId" });

    const session = await prisma.session.findUnique({
      where: { sessionId },
      include: { case: { select: { clientId: true } } },
    });

    if (!session) return res.status(404).json({ message: "Session not found" });

    if (!session.caseId || session.case?.clientId !== clientId) {
      return res.status(403).json({ message: "You cannot cancel this session" });
    }

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

/* =========================================================
   COUNSELOR SIDE (Case Note System)
   ========================================================= */

/**
 * GET /api/sessions/counselor/records
 * Returns sessions for this counselor mapped to your CaseNote UI
 */
export async function counselorRecords(req: AuthRequest, res: Response) {
  try {
    const counselorId = req.user?.counselorId;
    if (!counselorId) return res.status(401).json({ message: "Unauthorized" });

    const sessions = await prisma.session.findMany({
      where: { counselorId },
      orderBy: [{ timeStart: "desc" }, { sessionId: "desc" }],
      include: {
        room: true,
        problemTags: { where: { isActive: true }, select: { id: true, label: true } },
        case: {
          include: {
            client: {
              include: {
                user: { select: { firstName: true, lastName: true, isConsentAccepted: true } },
              },
            },
          },
        },
      },
    });

    const mapped = await Promise.all(
      sessions.map(async (s) => {
        const studentId = s.sessionName ?? s.case?.client?.clientId ?? "";
        const studentName = s.case?.client?.user
          ? `${s.case.client.user.firstName} ${s.case.client.user.lastName}`
          : "";

        const caseCode = s.sessionToken || "N/A";
        const clientText = await getClientBookingText(s.sessionId);

        return {
          id: String(s.sessionId),
          sessionId: s.sessionId,
          caseCode,
          studentId,
          studentName,
          department: s.case?.client?.department ?? "",
          sessionDate: formatDateISO(s.timeStart),
          sessionTime: formatTimeHHmm(s.timeStart),
          moodScale: s.moodScale ?? 3,
          selectedTags: s.problemTags.map((t) => t.label),
          sessionSummary: s.counselorKeyword ?? "",
          interventions: s.counselorNote ?? "",
          followUp: s.counselorFollowup ?? "",
          consentSigned: !!s.case?.client?.user?.isConsentAccepted,
          clientText,
        };
      })
    );

    return res.json(mapped);
  } catch (err) {
    console.error("counselorRecords error:", err);
    return res.status(500).json({ message: "Failed to load counselor records" });
  }
}

/**
 * GET /api/sessions/:sessionId/case-note
 * Auto-fill: caseCode + studentName + date + time from Session table
 */
export async function getCaseNote(req: AuthRequest, res: Response) {
  try {
    const counselorId = req.user?.counselorId;
    if (!counselorId) return res.status(401).json({ message: "Unauthorized" });

    const sessionId = Number(req.params.sessionId);
    if (!sessionId || Number.isNaN(sessionId)) return res.status(400).json({ message: "Invalid sessionId" });

    const s = await prisma.session.findUnique({
      where: { sessionId },
      include: {
        room: true,
        problemTags: { where: { isActive: true }, select: { id: true, label: true } },
        case: {
          include: {
            client: {
              include: {
                user: { select: { firstName: true, lastName: true, isConsentAccepted: true } },
              },
            },
          },
        },
      },
    });

    if (!s) return res.status(404).json({ message: "Session not found" });
    if (s.counselorId !== counselorId) return res.status(403).json({ message: "Forbidden" });

    const studentId = s.sessionName ?? s.case?.client?.clientId ?? "";
    const studentName = s.case?.client?.user
      ? `${s.case.client.user.firstName} ${s.case.client.user.lastName}`
      : "";

    const caseCode = s.sessionToken || "N/A";;
    const clientText = await getClientBookingText(s.sessionId);

    return res.json({
      id: String(s.sessionId),
      sessionId: s.sessionId,
      caseCode,
      studentId,
      studentName,
      department: s.case?.client?.department ?? "",
      sessionDate: formatDateISO(s.timeStart),
      sessionTime: formatTimeHHmm(s.timeStart),
      moodScale: s.moodScale ?? 3,
      selectedTags: s.problemTags.map((t) => t.label),
      sessionSummary: s.counselorKeyword ?? "",
      interventions: s.counselorNote ?? "",
      followUp: s.counselorFollowup ?? "",
      consentSigned: !!s.case?.client?.user?.isConsentAccepted,
      clientText,
    });
  } catch (err) {
    console.error("getCaseNote error:", err);
    return res.status(500).json({ message: "Failed to load case note" });
  }
}

/**
 * PUT /api/sessions/:sessionId/case-note
 * Body:
 * {
 *   moodScale: 1..5,
 *   sessionSummary: string,
 *   interventions: string,
 *   followUp: string,
 *   selectedTagIds: number[],
 *   markCompleted?: boolean
 * }
 */
export async function updateCaseNote(req: AuthRequest, res: Response) {
  try {
    const counselorId = req.user?.counselorId;
    const editorUserId = req.user?.userId;
    if (!counselorId || !editorUserId) return res.status(401).json({ message: "Unauthorized" });

    const sessionId = Number(req.params.sessionId);
    if (!sessionId || Number.isNaN(sessionId)) return res.status(400).json({ message: "Invalid sessionId" });

    const {
      moodScale,
      sessionSummary,
      interventions,
      followUp,
      selectedTagIds,
      markCompleted,
    } = req.body as {
      moodScale: number;
      sessionSummary: string;
      interventions: string;
      followUp: string;
      selectedTagIds: number[];
      markCompleted?: boolean;
    };

    const ms = Number(moodScale);
    if (Number.isNaN(ms) || ms < 1 || ms > 5) {
      return res.status(400).json({ message: "moodScale must be 1-5" });
    }

    const s = await prisma.session.findUnique({
      where: { sessionId },
      include: { problemTags: { select: { id: true } } },
    });

    if (!s) return res.status(404).json({ message: "Session not found" });
    if (s.counselorId !== counselorId) return res.status(403).json({ message: "Forbidden" });

    const tagIds = (selectedTagIds ?? [])
      .map(Number)
      .filter((n) => Number.isFinite(n));

    // validate tags exist and active
    const validTags = await prisma.problemTag.findMany({
      where: { id: { in: tagIds }, isActive: true },
      select: { id: true },
    });
    const validTagIds = validTags.map((t) => t.id);

    const before = {
      moodScale: s.moodScale ?? null,
      counselorKeyword: s.counselorKeyword ?? "",
      counselorNote: s.counselorNote ?? "",
      counselorFollowup: s.counselorFollowup ?? "",
      tagIds: s.problemTags.map((t) => t.id).sort(),
      status: s.status,
    };

    const after = {
      moodScale: ms,
      counselorKeyword: sessionSummary ?? "",
      counselorNote: interventions ?? "",
      counselorFollowup: followUp ?? "",
      tagIds: validTagIds.sort(),
      status: markCompleted ? "completed" : s.status,
    };

    const updated = await prisma.session.update({
      where: { sessionId },
      data: {
        moodScale: after.moodScale,
        counselorKeyword: after.counselorKeyword,
        counselorNote: after.counselorNote,
        counselorFollowup: after.counselorFollowup,
        status: after.status,
        problemTags: {
          set: after.tagIds.map((id) => ({ id })),
        },
      },
      include: {
        problemTags: { select: { id: true, label: true } },
      },
    });

    await prisma.sessionHistory.create({
      data: {
        sessionId,
        action: "COUNSELOR_NOTE_UPDATED",
        editedBy: editorUserId,
        details: JSON.stringify({ before, after }),
      },
    });

    return res.json({
      success: true,
      sessionId,
      moodScale: updated.moodScale,
      selectedTags: updated.problemTags.map((t) => t.label),
    });
  } catch (err) {
    console.error("updateCaseNote error:", err);
    return res.status(500).json({ message: "Failed to update case note" });
  }
}

// GET /api/sessions/case-note/by-code/:caseCode
export async function getCaseNoteByCode(req: AuthRequest, res: Response) {
  try {
    const counselorId = req.user?.counselorId;
    if (!counselorId) return res.status(401).json({ message: "Unauthorized" });

    const code = String(req.params.caseCode || "").trim(); // เช่น "690001-001"

    // ค้นหาจาก sessionToken ตรงๆ ได้เลย!
    const s = await prisma.session.findUnique({
      where: { sessionToken: code }, 
      include: {
        room: true,
        problemTags: { where: { isActive: true }, select: { id: true, label: true } },
        case: {
          include: {
            client: {
              include: { user: { select: { firstName: true, lastName: true, isConsentAccepted: true } } },
            },
          },
        },
      },
    });

    if (!s) return res.status(404).json({ message: "Session not found" });
    if (s.counselorId !== counselorId) return res.status(403).json({ message: "Forbidden" });

    const studentId = s.sessionName ?? s.case?.client?.clientId ?? "";
    const clientText = await getClientBookingText(s.sessionId);
    const timeStart = s.timeStart ? new Date(s.timeStart) : null;
    const sessionDate = timeStart ? timeStart.toISOString().split("T")[0] : "";
    const sessionTime = timeStart
      ? timeStart.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false })
      : "";

    const studentName = s.case?.client?.user
      ? `${s.case.client.user.firstName} ${s.case.client.user.lastName}`
      : "";

    return res.json({
      id: String(s.sessionId),
      sessionId: s.sessionId,
      caseCode: s.sessionToken,
      studentId,
      studentName,
      department: s.case?.client?.department ?? "",
      sessionDate,
      sessionTime,
      moodScale: s.moodScale ?? 3,
      selectedTags: s.problemTags.map((t) => t.label),
      sessionSummary: s.counselorKeyword ?? "",
      interventions: s.counselorNote ?? "",
      followUp: s.counselorFollowup ?? "",
      consentSigned: !!s.case?.client?.user?.isConsentAccepted,
      clientText,
    });
  } catch (err) {
    console.error("getCaseNoteByCode error:", err);
    return res.status(500).json({ message: "Failed to load case note" });
  }
}