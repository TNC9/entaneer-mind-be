import { Router } from "express";
import {
  getProblemTags,
  createProblemTag
} from "../controllers/problemTagController";

import { authenticateToken } from "../middleware/authMiddleware";

const router = Router();

router.get("/", authenticateToken, getProblemTags);
router.post("/", authenticateToken, createProblemTag);

export default router;