import express from 'express';
import { authenticateToken, requireCounselor } from '../middleware/authMiddleware';
import {
  // Slot Management
  createSlot,
  getCounselorSchedule,
  deleteSlot,
  updateSlot,

  // Waiting Case Management
  getWaitingCases,
  confirmWaitingCase,

  // User Management
  promoteUser,
  getAllUsers,
  updateUserRole,
  getAllCounselors,
  deleteUser,
  addUserByCmuAccount,

  // Report & Analytics
  getFullReport,
  getTokenList,
  createToken,
  deleteToken
} from '../controllers/counselorController';

const router = express.Router();

// ==================== SLOT MANAGEMENT ====================

router.post('/api/slots', authenticateToken, requireCounselor, createSlot);
router.get('/api/counselor/schedule', authenticateToken, requireCounselor, getCounselorSchedule);
router.delete('/api/slots/:sessionId', authenticateToken, requireCounselor, deleteSlot);
router.patch('/api/slots/:sessionId', authenticateToken, requireCounselor, updateSlot);

// ==================== WAITING CASE MANAGEMENT ====================

router.get('/api/counselor/waiting-cases', authenticateToken, requireCounselor, getWaitingCases);
router.post('/api/counselor/cases/:caseId/confirm', authenticateToken, requireCounselor, confirmWaitingCase);

// ==================== USER MANAGEMENT ====================

router.post('/api/counselor/promote', authenticateToken, requireCounselor, promoteUser);
router.get('/api/counselor/users', authenticateToken, requireCounselor, getAllUsers);
router.patch('/api/counselor/users/:userId/role', authenticateToken, requireCounselor, updateUserRole);
router.get('/api/counselor/counselors', authenticateToken, requireCounselor, getAllCounselors);
router.post('/api/counselor/users', authenticateToken, requireCounselor, addUserByCmuAccount);
router.delete('/api/counselor/users/:userId', authenticateToken, requireCounselor, deleteUser);

// ==================== REPORT & ANALYTICS ====================

router.get('/api/counselor/report', authenticateToken, requireCounselor, getFullReport);
router.get('/api/counselor/tokens', authenticateToken, requireCounselor, getTokenList);
router.post('/api/counselor/tokens', authenticateToken, requireCounselor, createToken);
router.delete('/api/counselor/tokens/:id', authenticateToken, requireCounselor, deleteToken);

export default router;