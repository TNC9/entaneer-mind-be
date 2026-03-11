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

function hasText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function shouldAutoCompleteCaseNote(input: {
  moodScale: number;
  sessionSummary: string;
  interventions: string;
  followUp: string;
  selectedTagIds: number[];
}): boolean {
  return (
    Number.isFinite(input.moodScale) &&
    input.moodScale >= 1 &&
    input.moodScale <= 5 &&
    hasText(input.sessionSummary) &&
    hasText(input.interventions) &&
    hasText(input.followUp) &&
    Array.isArray(input.selectedTagIds) &&
    input.selectedTagIds.length > 0
  );
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
  return d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Pull client's latest booking text from CLIENT_BOOKED history */
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
 * Client history derived from SessionHistory actions
 */
export async function getClientSessionHistory(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.userId;
    const clientId = req.user?.clientId;

    if (!userId || !clientId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const booked = await prisma.sessionHistory.findMany({
      where: {
        editedBy: userId,
        action: "CLIENT_BOOKED",
      },
      orderBy: { timestamp: "desc" },
      include: {
        session: {
          include: {
            room: {
              include: {
                counselor: {
                  include: {
                    user: {
                      select: {
                        firstName: true,
                        lastName: true,
                      },
                    },
                  },
                },
              },
            },
            counselor: {
              include: {
                user: {
                  select: {
                    firstName: true,
                    lastName: true,
                  },
                },
              },
            },
            case: {
              select: {
                clientId: true,
              },
            },
          },
        },
      },
    });

    const validBooked = booked.filter((h) => !!h.session);

    if (validBooked.length === 0) {
      return res.json({ appointments: [] });
    }

    const sessionIds = [...new Set(validBooked.map((h) => h.sessionId))];

    const allCancels = await prisma.sessionHistory.findMany({
      where: {
        sessionId: { in: sessionIds },
        action: { in: ["CLIENT_CANCELLED", "PORTAL_CANCELLED_BOOKING"] },
      },
      orderBy: { timestamp: "desc" },
      select: {
        sessionId: true,
        details: true,
        timestamp: true,
      },
    });

    const cancelMap = new Map<number, Array<{ timestamp: Date; details: string | null }>>();
    for (const c of allCancels) {
      if (!cancelMap.has(c.sessionId)) cancelMap.set(c.sessionId, []);
      cancelMap.get(c.sessionId)!.push({
        timestamp: c.timestamp,
        details: c.details,
      });
    }

    const appointments = validBooked.map((h) => {
      const s = h.session!;
      const bookedDetails = safeJsonParse(h.details) ?? {};
      const cancelsForSession = cancelMap.get(s.sessionId) ?? [];

      const latestCancelAfterThisBooking = cancelsForSession.find(
        (c) => new Date(c.timestamp).getTime() > new Date(h.timestamp).getTime()
      );

      const cancelledDetails = latestCancelAfterThisBooking
        ? safeJsonParse(latestCancelAfterThisBooking.details) ?? {}
        : {};

      const normalizedStatus = (s.status || "").toLowerCase();

      const isCurrentlyBookedByClient =
        normalizedStatus === "booked" &&
        !!s.caseId &&
        s.case?.clientId === clientId;

      const isCompleted =
        normalizedStatus === "completed" ||
        !!s.counselorNote ||
        !!s.counselorKeyword ||
        !!s.counselorFollowup ||
        s.moodScale !== null;

      const isCancelled =
        !isCurrentlyBookedByClient &&
        !isCompleted &&
        (
          normalizedStatus === "cancelled" ||
          !!latestCancelAfterThisBooking
        );

      let status: "upcoming" | "completed" | "cancelled" = "completed";

      if (isCurrentlyBookedByClient) {
        status = "upcoming";
      } else if (isCompleted) {
        status = "completed";
      } else if (isCancelled) {
        status = "cancelled";
      }

      const counselorName =
        s.counselor?.user
          ? `${s.counselor.user.firstName} ${s.counselor.user.lastName}`
          : s.room?.counselor?.user
            ? `${s.room.counselor.user.firstName} ${s.room.counselor.user.lastName}`
            : null;

      const roomName = s.room?.roomName ?? "ห้อง";

      return {
        id: String(s.sessionId),
        sessionId: s.sessionId,
        timeStart: s.timeStart ? s.timeStart.toISOString() : null,
        counselor: counselorName ?? roomName,
        counselorName,
        roomName,
        status,
        notes: inferClientNotes(h.details) || "—",
        sessionToken:
          bookedDetails.sessionToken ??
          cancelledDetails.sessionToken ??
          s.sessionToken ??
          null,
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

    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    if (!session.caseId || session.case?.clientId !== clientId) {
      return res.status(403).json({ message: "You cannot cancel this session" });
    }

    const latestBookedHistory = await prisma.sessionHistory.findFirst({
      where: { sessionId, action: "CLIENT_BOOKED" },
      orderBy: { timestamp: "desc" },
      select: { details: true },
    });

    const latestBookedDetails = safeJsonParse(latestBookedHistory?.details) ?? {};

    await prisma.session.update({
      where: { sessionId },
      data: {
        status: "available",
        caseId: null,
        sessionName: null,
        sessionToken: null,
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
        details: JSON.stringify({
          message: "cancelled by client",
          description:
            typeof latestBookedDetails.description === "string"
              ? latestBookedDetails.description
              : "",
          sessionToken:
            session.sessionToken ??
            latestBookedDetails.sessionToken ??
            null,
        }),
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
    if (!counselorId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const sessions = await prisma.session.findMany({
      where: {
        counselorId,
        caseId: { not: null },
      },
      orderBy: [{ timeStart: "desc" }, { sessionId: "desc" }],
      include: {
        room: true,
        problemTags: {
          where: { isActive: true },
          select: { id: true, label: true },
        },
        case: {
          include: {
            client: {
              include: {
                user: {
                  select: {
                    firstName: true,
                    lastName: true,
                    isConsentAccepted: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    const mapped = await Promise.all(
      sessions.map(async (s) => {
        const studentId = s.case?.client?.clientId ?? s.sessionName ?? "";
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
 */
export async function getCaseNote(req: AuthRequest, res: Response) {
  try {
    const counselorId = req.user?.counselorId;
    if (!counselorId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const sessionId = Number(req.params.sessionId);
    if (!sessionId || Number.isNaN(sessionId)) {
      return res.status(400).json({ message: "Invalid sessionId" });
    }

    const s = await prisma.session.findUnique({
      where: { sessionId },
      include: {
        room: true,
        problemTags: {
          where: { isActive: true },
          select: { id: true, label: true },
        },
        case: {
          include: {
            client: {
              include: {
                user: {
                  select: {
                    firstName: true,
                    lastName: true,
                    isConsentAccepted: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!s) {
      return res.status(404).json({ message: "Session not found" });
    }
    if (!s.caseId) {
      return res.status(404).json({ message: "Case note not found for this session" });
    }
    if (s.counselorId !== counselorId) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const studentId = s.case?.client?.clientId ?? s.sessionName ?? "";
    const studentName = s.case?.client?.user
      ? `${s.case.client.user.firstName} ${s.case.client.user.lastName}`
      : "";

    const caseCode = s.sessionToken || "N/A";
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
 */
export async function updateCaseNote(req: AuthRequest, res: Response) {
  try {
    const counselorId = req.user?.counselorId;
    const editorUserId = req.user?.userId;

    if (!counselorId || !editorUserId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const sessionId = Number(req.params.sessionId);
    if (!sessionId || Number.isNaN(sessionId)) {
      return res.status(400).json({ message: "Invalid sessionId" });
    }

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

    if (!s) {
      return res.status(404).json({ message: "Session not found" });
    }
    if (!s.caseId) {
      return res.status(404).json({ message: "Case note not found for this session" });
    }
    if (s.counselorId !== counselorId) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const tagIds = (selectedTagIds ?? [])
      .map(Number)
      .filter((n) => Number.isFinite(n));

    const validTags = await prisma.problemTag.findMany({
      where: { id: { in: tagIds }, isActive: true },
      select: { id: true },
    });
    const validTagIds = validTags.map((t) => t.id);

    const normalizedSummary = (sessionSummary ?? "").trim();
    const normalizedInterventions = (interventions ?? "").trim();
    const normalizedFollowUp = (followUp ?? "").trim();

    const autoCompleted = shouldAutoCompleteCaseNote({
      moodScale: ms,
      sessionSummary: normalizedSummary,
      interventions: normalizedInterventions,
      followUp: normalizedFollowUp,
      selectedTagIds: validTagIds,
    });

    // If all fields are filled -> completed automatically
    // If markCompleted is true -> also completed
    // Otherwise keep current status (do not force available/booked changes here)
    const nextStatus =
      autoCompleted || markCompleted === true
        ? "completed"
        : s.status;

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
      counselorKeyword: normalizedSummary,
      counselorNote: normalizedInterventions,
      counselorFollowup: normalizedFollowUp,
      tagIds: [...validTagIds].sort(),
      status: nextStatus,
      autoCompleted,
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
      status: updated.status,
      autoCompleted,
      moodScale: updated.moodScale,
      selectedTags: updated.problemTags.map((t) => t.label),
    });
  } catch (err) {
    console.error("updateCaseNote error:", err);
    return res.status(500).json({ message: "Failed to update case note" });
  }
}

/**
 * GET /api/sessions/case-note/by-code/:caseCode
 */
export async function getCaseNoteByCode(req: AuthRequest, res: Response) {
  try {
    const counselorId = req.user?.counselorId;
    if (!counselorId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const code = String(req.params.caseCode || "").trim();

    const s = await prisma.session.findUnique({
      where: { sessionToken: code },
      include: {
        room: true,
        problemTags: {
          where: { isActive: true },
          select: { id: true, label: true },
        },
        case: {
          include: {
            client: {
              include: {
                user: {
                  select: {
                    firstName: true,
                    lastName: true,
                    isConsentAccepted: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!s) {
      return res.status(404).json({ message: "Session not found" });
    }
    if (!s.caseId) {
      return res.status(404).json({ message: "Case note not found for this session" });
    }
    if (s.counselorId !== counselorId) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const studentId = s.case?.client?.clientId ?? s.sessionName ?? "";
    const studentName = s.case?.client?.user
      ? `${s.case.client.user.firstName} ${s.case.client.user.lastName}`
      : "";
    const clientText = await getClientBookingText(s.sessionId);

    return res.json({
      id: String(s.sessionId),
      sessionId: s.sessionId,
      caseCode: s.sessionToken,
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
    console.error("getCaseNoteByCode error:", err);
    return res.status(500).json({ message: "Failed to load case note" });
  }
}

/**
 * GET /api/sessions/case-note/by-client/:clientId
 * Returns all case notes for this counselor + this clientId
 */
export async function getCaseNotesByClientId(req: AuthRequest, res: Response) {
  try {
    const counselorId = req.user?.counselorId;
    if (!counselorId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const clientId = String(req.params.clientId || "").trim();
    if (!clientId) {
      return res.status(400).json({ message: "clientId is required" });
    }

    const sessions = await prisma.session.findMany({
      where: {
        counselorId,
        caseId: { not: null },
        case: {
          is: {
            clientId,
          },
        },
      },
      orderBy: [{ timeStart: "desc" }, { sessionId: "desc" }],
      include: {
        room: true,
        problemTags: {
          where: { isActive: true },
          select: { id: true, label: true },
        },
        case: {
          include: {
            client: {
              include: {
                user: {
                  select: {
                    firstName: true,
                    lastName: true,
                    isConsentAccepted: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (sessions.length === 0) {
      return res.status(404).json({ message: "No case notes found for this clientId" });
    }

    const mapped = await Promise.all(
      sessions.map(async (s) => {
        const studentId = s.case?.client?.clientId ?? s.sessionName ?? "";
        const studentName = s.case?.client?.user
          ? `${s.case.client.user.firstName} ${s.case.client.user.lastName}`
          : "";
        const clientText = await getClientBookingText(s.sessionId);

        return {
          id: String(s.sessionId),
          sessionId: s.sessionId,
          caseCode: s.sessionToken || "N/A",
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
    console.error("getCaseNotesByClientId error:", err);
    return res.status(500).json({ message: "Failed to load case notes" });
  }
}

/**
 * GET /api/sessions/:sessionId/edit-history
 * Return list of COUNSELOR_NOTE_UPDATED events for this session
 */
export async function getSessionEditHistory(req: AuthRequest, res: Response) {
  try {
    const counselorId = req.user?.counselorId;
    if (!counselorId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const sessionId = Number(req.params.sessionId);
    if (!sessionId || Number.isNaN(sessionId)) {
      return res.status(400).json({ message: "Invalid sessionId" });
    }

    const session = await prisma.session.findUnique({
      where: { sessionId },
      select: { counselorId: true, caseId: true },
    });

    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }
    if (!session.caseId) {
      return res.status(404).json({ message: "Case note not found for this session" });
    }
    if (session.counselorId !== counselorId) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const histories = await prisma.sessionHistory.findMany({
      where: {
        sessionId,
        action: "COUNSELOR_NOTE_UPDATED",
      },
      orderBy: { timestamp: "desc" },
      select: {
        id: true,
        timestamp: true,
        details: true,
        editedBy: true,
      },
    });

    const editorIds = Array.from(
      new Set(
        histories
          .map((h) => h.editedBy)
          .filter((id): id is number => typeof id === "number")
      )
    );

    const editors = editorIds.length
      ? await prisma.user.findMany({
          where: { userId: { in: editorIds } },
          select: { userId: true, firstName: true, lastName: true },
        })
      : [];

    const editorMap = new Map(
      editors.map((u) => [u.userId, `${u.firstName} ${u.lastName}`])
    );

    const result = histories.map((h) => {
      const details = safeJsonParse(h.details) ?? {};
      return {
        historyId: h.id,
        timestamp: h.timestamp,
        editorName: editorMap.get(h.editedBy) ?? "Unknown",
        before: details.before ?? null,
        after: details.after ?? null,
      };
    });

    return res.json({ sessionId, history: result });
  } catch (err) {
    console.error("getSessionEditHistory error:", err);
    return res.status(500).json({ message: "Failed to load history" });
  }
}