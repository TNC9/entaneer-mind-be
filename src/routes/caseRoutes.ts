import express from 'express';
import { authenticateToken } from '../middleware/authMiddleware';
import { verifyCodeAndCreateCase } from '../controllers/caseController'; // ต้องแน่ใจว่าสร้าง Controller นี้แล้ว

const router = express.Router();

// เส้นทาง: /api/cases/verify-code
router.post('/verify-code', authenticateToken, verifyCodeAndCreateCase);

export default router;