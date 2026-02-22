import { Router } from "express";
import { authenticateToken, requireCounselor } from "../middleware/authMiddleware";
import {
  listProblemTags,
  createProblemTag,
  deleteProblemTag,
} from "../controllers/problemTagController";

const router = Router();

// anyone logged-in can read tags
router.get("/", authenticateToken, listProblemTags);

// counselor only: add/delete tags
router.post("/", authenticateToken, requireCounselor, createProblemTag);
router.delete("/:id", authenticateToken, requireCounselor, deleteProblemTag);

export default router;