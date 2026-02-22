import { Request, Response } from "express";
import { prisma } from "../prisma";

/**
 * GET /api/problem-tags
 */
export const getProblemTags = async (req: Request, res: Response) => {
  try {
    const tags = await prisma.problemTag.findMany({
      where: { isActive: true },
      orderBy: { label: "asc" }
    });
    res.json(tags);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch problem tags" });
  }
};

/**
 * POST /api/problem-tags
 */
export const createProblemTag = async (req: Request, res: Response) => {
  const { label } = req.body;

  if (!label) {
    return res.status(400).json({ error: "Label is required" });
  }

  try {
    const tag = await prisma.problemTag.create({
      data: { label }
    });
    res.status(201).json(tag);
  } catch (error) {
    res.status(400).json({ error: "Tag already exists" });
  }
};