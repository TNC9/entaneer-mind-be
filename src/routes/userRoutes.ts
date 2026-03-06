import express from 'express';
import { authenticateToken } from '../middleware/authMiddleware';
import { listUsers, getMe, acceptConsent } from '../controllers/userController';

const router = express.Router();

// เส้นทาง: /api/users?role=counselor
router.get('/', authenticateToken, listUsers);

// เส้นทาง: /api/users/me
router.get('/me', authenticateToken, getMe);

// เส้นทาง: /api/users/accept-consent
router.post('/accept-consent', authenticateToken, acceptConsent);

export default router;

