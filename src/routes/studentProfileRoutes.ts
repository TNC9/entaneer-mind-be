import express from 'express';
import { authenticateToken } from '../middleware/authMiddleware';
import { getStudentProfile, updateStudentProfile } from '../controllers/studentProfileController';

const router = express.Router();

// Student profile endpoints
router.get('/profile', authenticateToken, getStudentProfile);
router.put('/profile', authenticateToken, updateStudentProfile);

export default router;
