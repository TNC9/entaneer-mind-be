import express from 'express';
import { authenticateToken, requireClient } from '../middleware/authMiddleware';
import { validateProfileUpdate } from '../middleware/validationMiddleware';
import { getclientProfile, updateclientProfile } from '../controllers/clientProfileController';

const router = express.Router();

// client-only routes
router.get('/profile', authenticateToken, requireClient, getclientProfile);
router.put('/profile', authenticateToken, requireClient, validateProfileUpdate, updateclientProfile);

export default router;
