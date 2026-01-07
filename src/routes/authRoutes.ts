import { Router } from "express";
import { register } from "../controllers/authController";

const router = Router();

// สร้าง URL: POST /api/auth/register
router.post("/register", register);

export default router;
