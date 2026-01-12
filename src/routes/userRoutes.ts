import express from 'express';
import { authenticateToken } from '../middleware/authMiddleware';
import { getMe, acceptConsent } from '../controllers/userController';

const router = express.Router();

// เส้นทาง: /api/users/me
router.get('/me', authenticateToken, getMe);

// 2. เพิ่มเส้นทางใหม่สำหรับกดปุ่มยอมรับ Consent
router.post('/accept-consent', authenticateToken, acceptConsent);

export default router;