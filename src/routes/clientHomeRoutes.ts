import { Router } from "express";
import { authenticateToken } from "../middleware/authMiddleware";
import { getClientHomeSummary } from "../controllers/clientHomeController";

const router = Router();

router.get("/", authenticateToken, getClientHomeSummary);

export default router;