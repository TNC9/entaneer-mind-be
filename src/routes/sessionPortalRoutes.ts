import { Router } from "express";
import { authenticateToken, requireCounselor } from "../middleware/authMiddleware";
import {
  listRooms,
  createRoom,
  deleteRoom,
  getWeekSchedule,
  toggleSlot,
  cancelBookedSlot,
  bulkWeek,
} from "../controllers/sessionPortalController";

const router = Router();

// counselor-only portal
router.get("/rooms", authenticateToken, requireCounselor, listRooms);
router.post("/rooms", authenticateToken, requireCounselor, createRoom);
router.delete("/rooms/:roomId", authenticateToken, requireCounselor, deleteRoom);

router.get("/schedule", authenticateToken, requireCounselor, getWeekSchedule);
router.put("/slots/toggle", authenticateToken, requireCounselor, toggleSlot);
router.post("/slots/:sessionId/cancel", authenticateToken, requireCounselor, cancelBookedSlot);

router.put("/week/bulk", authenticateToken, requireCounselor, bulkWeek);

export default router;