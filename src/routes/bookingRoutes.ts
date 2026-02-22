import { Router } from "express";
import { listCounselors, listSessions, bookSession } from "../controllers/bookingController";
import { authenticateToken, requireClient } from "../middleware/authMiddleware"; 
// ^ adjust path/name to your actual middleware file

const router = Router();

// Client should be the one booking
router.get("/counselors", authenticateToken, requireClient, listCounselors);
router.get("/sessions", authenticateToken, requireClient, listSessions);
router.post("/book", authenticateToken, requireClient, bookSession);

export default router;