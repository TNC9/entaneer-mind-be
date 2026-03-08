import { Router } from "express";
import { register, login, getMe } from "../controllers/authController";
import { authenticateToken } from "../middleware/authMiddleware";

const router = Router();

// สร้าง URL: POST /api/auth/register
router.post("/register", register);

// เพิ่มเส้นทาง Login (เพื่อขอ Token)
router.post("/login", login);

// เส้นทางสำหรับให้ Frontend โหลดข้อมูลตัวเองและสถานะ Case
router.get("/me", authenticateToken, getMe);

export default router;
