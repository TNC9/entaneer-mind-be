import express from 'express';
import { authenticateToken, requireStudent } from '../middleware/authMiddleware';
import { validateProfileUpdate } from '../middleware/validationMiddleware';
import { getStudentProfile, updateStudentProfile } from '../controllers/studentProfileController';

const router = express.Router();

// Student-only routes
router.get('/profile', authenticateToken, requireStudent, getStudentProfile);
router.put('/profile', authenticateToken, requireStudent, validateProfileUpdate, updateStudentProfile);

export default router;
