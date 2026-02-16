import express from 'express';
import { authenticateToken, requireClient } from '../middleware/authMiddleware';
import { verifyCodeAndCreateCase, generateQueueToken } from '../controllers/caseController';

const router = express.Router();

// เส้นทาง: /api/cases/verify-code
router.post('/verify-code', authenticateToken, verifyCodeAndCreateCase);

// เส้นทาง: /api/cases/generate-token (สำหรับขอคิว 6X000N)
router.post('/generate-token', authenticateToken, requireClient, generateQueueToken);

export default router;