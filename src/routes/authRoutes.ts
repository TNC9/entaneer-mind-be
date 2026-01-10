import { Router } from "express";
import { register, login } from "../controllers/authController";

const router = Router();

// สร้าง URL: POST /api/auth/register
router.post("/register", register);

// * เพิ่มเส้นทาง Login (เพื่อขอ Token)
router.post("/login", login);

export default router;
