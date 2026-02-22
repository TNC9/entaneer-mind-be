import { Request, Response } from "express";
import { prisma } from "../prisma";

/**
 * POST /api/sessions/:sessionId/problem-tags
 */
export const addProblemTagsToSession = async (req: Request, res: Response) => {
  const sessionId = Number(req.params.sessionId);
  const { tagIds } = req.body; // number[]

  if (!Array.isArray(tagIds)) {
    return res.status(400).json({ error: "tagIds must be an array" });
  }

  try {
    const session = await prisma.session.update({
      where: { sessionId },
      data: {
        problemTags: {
          connect: tagIds.map((id: number) => ({ id }))
        }
      },
      include: { problemTags: true }
    });

    res.json(session);
  } catch (error) {
    res.status(500).json({ error: "Failed to attach problem tags" });
  }
};