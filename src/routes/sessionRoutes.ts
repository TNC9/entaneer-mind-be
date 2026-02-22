import { Router } from "express";
import { addProblemTagsToSession } from "../controllers/sessionController";
import { authenticateToken } from "../middleware/authMiddleware";

const router = Router();

router.post(
  "/:sessionId/problem-tags",
  authenticateToken,
  addProblemTagsToSession
);

export default router;