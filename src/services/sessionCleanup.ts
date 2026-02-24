// src/services/sessionCleanup.service.ts
import { prisma } from "../prisma";

/**
 * Delete expired sessions based on SESSION DATE (timeStart), not createdAt.
 *
 * Rules:
 * - delete if session timeStart is before "today" (Bangkok timezone)
 * - only status = "available" or "closed"
 * - only unbooked sessions (caseId = null) for safety
 */
export async function cleanupExpiredSessions() {
  // Bangkok is UTC+7 (no DST)
  const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

  // Convert "now" to Bangkok clock, then compute Bangkok midnight, then convert back to UTC Date
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

  // (Optional) Fetch IDs first so you can log which sessions were deleted
  const targets = await prisma.session.findMany({
    where: {
      timeStart: {
        lt: bangkokStartOfTodayUtc,
      },
      status: {
        in: ["available", "closed"],
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

  const result = await prisma.session.deleteMany({
    where: {
      sessionId: {
        in: targets.map((t) => t.sessionId),
      },
    },
  });

  return {
    deletedCount: result.count,
    deletedSessionIds: targets.map((t) => t.sessionId),
    cutoffBangkokStartOfTodayUtc: bangkokStartOfTodayUtc.toISOString(),
  };
}