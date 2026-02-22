import { Request, Response } from "express";
import { prisma } from "../prisma";
import type { AuthRequest } from "../middleware/authMiddleware";

/**
 * GET /api/problem-tags
 * Return only active tags
 */
export async function listProblemTags(_req: Request, res: Response) {
  try {
    const tags = await prisma.problemTag.findMany({
      where: { isActive: true },
      orderBy: { label: "asc" },
      select: { id: true, label: true, isActive: true },
    });
    return res.json(tags);
  } catch (err) {
    console.error("listProblemTags error:", err);
    return res.status(500).json({ message: "Failed to load problem tags" });
  }
}

/**
 * POST /api/problem-tags
 * Body: { label: string }
 * Create new tag or reactivate existing
 */
export async function createProblemTag(req: AuthRequest, res: Response) {
  try {
    const labelRaw = String(req.body?.label ?? "").trim();
    if (!labelRaw) return res.status(400).json({ message: "label is required" });

    const existing = await prisma.problemTag.findUnique({ where: { label: labelRaw } });
    if (existing) {
      const updated = await prisma.problemTag.update({
        where: { id: existing.id },
        data: { isActive: true },
        select: { id: true, label: true, isActive: true },
      });
      return res.json(updated);
    }

    const created = await prisma.problemTag.create({
      data: { label: labelRaw, isActive: true },
      select: { id: true, label: true, isActive: true },
    });

    return res.status(201).json(created);
  } catch (err) {
    console.error("createProblemTag error:", err);
    return res.status(500).json({ message: "Failed to create tag" });
  }
}

/**
 * DELETE /api/problem-tags/:id
 * Soft delete (isActive=false)
 */
export async function deleteProblemTag(req: AuthRequest, res: Response) {
  try {
    const id = Number(req.params.id);
    if (!id || Number.isNaN(id)) return res.status(400).json({ message: "Invalid id" });

    await prisma.problemTag.update({
      where: { id },
      data: { isActive: false },
    });

    return res.json({ success: true });
  } catch (err) {
    console.error("deleteProblemTag error:", err);
    return res.status(500).json({ message: "Failed to delete tag" });
  }
}