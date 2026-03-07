import { prisma } from "../prisma";

export async function cleanupExpiredSessions() {
  const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

  const now = new Date();
  const bangkokNowMs = now.getTime() + BANGKOK_OFFSET_MS;
  const bangkokNow = new Date(bangkokNowMs);

  const bangkokStartOfTodayUtc = new Date(
    Date.UTC(
      bangkokNow.getUTCFullYear(),
      bangkokNow.getUTCMonth(),
      bangkokNow.getUTCDate(),
      0, 0, 0, 0
    ) - BANGKOK_OFFSET_MS
  );

  const targets = await prisma.session.findMany({
    where: {
      timeStart: {
        lt: bangkokStartOfTodayUtc,
      },
      status: {
        in: ["available", "closed", "cancelled"],
      },
      caseId: null,
    },
    select: {
      sessionId: true,
      timeStart: true,
      status: true,
    },
  });

  if (targets.length === 0) {
    return {
      deletedCount: 0,
      deletedSessionIds: [],
      cutoffBangkokStartOfTodayUtc: bangkokStartOfTodayUtc.toISOString(),
      message: "No expired available/closed sessions to delete.",
    };
  }

  const sessionIds = targets.map((t) => t.sessionId);

  const result = await prisma.$transaction(async (tx) => {
    await tx.sessionHistory.deleteMany({
      where: {
        sessionId: {
          in: sessionIds,
        },
      },
    });

    const deletedSessions = await tx.session.deleteMany({
      where: {
        sessionId: {
          in: sessionIds,
        },
      },
    });

    return deletedSessions;
  });

  return {
    deletedCount: result.count,
    deletedSessionIds: sessionIds,
    cutoffBangkokStartOfTodayUtc: bangkokStartOfTodayUtc.toISOString(),
  };
}