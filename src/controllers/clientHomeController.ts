import { Response } from "express";
import { prisma } from "../prisma";
import type { AuthRequest } from "../middleware/authMiddleware";

function formatThaiDate(date: Date): string {
  return new Intl.DateTimeFormat("th-TH", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Bangkok",
  }).format(date);
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

export const getClientHomeSummary = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const user = await prisma.user.findUnique({
      where: { userId },
      include: {
        clientProfile: true,
      },
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const counselorCount = await prisma.counselor.count();

    if (!user.clientProfile) {
      return res.json({
        upcomingAppointments: [],
        completedCount: 0,
        counselorCount,
      });
    }

    const clientId = user.clientProfile.clientId;
    const now = new Date();

    const allBookedSessions = await prisma.session.findMany({
      where: {
        case: {
          clientId,
        },
        caseId: { not: null },
        status: "booked",
        timeStart: { not: null },
      },
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
      },
      orderBy: {
        timeStart: "asc",
      },
    });

    const upcomingAppointments = allBookedSessions
      .filter((s) => s.timeStart && s.timeStart >= now)
      .map((s) => {
        const sessionCounselorName = s.counselor?.user
          ? `${s.counselor.user.firstName} ${s.counselor.user.lastName}`
          : null;

        const roomCounselorName = s.room?.counselor?.user
          ? `${s.room.counselor.user.firstName} ${s.room.counselor.user.lastName}`
          : null;

        const counselorName =
          sessionCounselorName ??
          roomCounselorName ??
          "ผู้ให้คำปรึกษา";

        const roomName = s.room?.roomName ? `(${s.room.roomName})` : "";

        return {
          id: String(s.sessionId),
          date: formatThaiDate(s.timeStart!),
          time: formatTimeHHmmBangkok(s.timeStart!),
          counselor: `${counselorName}${roomName ? ` ${roomName}` : ""}`,
        };
      });

    const completedCount = allBookedSessions.filter(
      (s) => s.timeStart && s.timeStart < now
    ).length;

    return res.json({
      upcomingAppointments,
      completedCount,
      counselorCount,
    });
  } catch (error) {
    console.error("getClientHomeSummary error:", error);
    return res.status(500).json({ message: "Failed to load client home summary" });
  }
};