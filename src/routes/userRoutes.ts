import express from 'express';
import { authenticateToken } from '../middleware/authMiddleware';
import { getMe } from '../controllers/userController';

const router = express.Router();

// เส้นทาง: /api/users/me
// ต้องมี Token แนบมาด้วย ถึงจะเข้าได้
router.get('/me', authenticateToken, getMe);

export default router;