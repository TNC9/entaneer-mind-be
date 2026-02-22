import { Router } from "express";
import { authenticateToken, requireClient, requireCounselor } from "../middleware/authMiddleware";
import { getClientSessionHistory, cancelClientSession } from "../controllers/sessionController";

const router = Router();

/** Client: history + cancel */
router.get("/history", authenticateToken, requireClient, getClientSessionHistory);
router.post("/:sessionId/cancel", authenticateToken, requireClient, cancelClientSession);

/**
 * (Optional) keep room for counselor note routes etc.
 * If you already have old session routes, paste them here and we merge.
 */

export default router;