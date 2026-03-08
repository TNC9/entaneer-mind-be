import express from 'express';
import { authenticateToken, requireCounselor } from '../middleware/authMiddleware';
import {
  // Slot Management
  createSlot,
  getCounselorSchedule,
  deleteSlot,
  updateSlot,
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
  createToken
} from '../controllers/counselorController';

const router = express.Router();

// ==================== SLOT MANAGEMENT ====================

// Create available time slot (09:00 - 16:00, last slot 15:00-16:00)
router.post('/api/slots', authenticateToken, requireCounselor, createSlot);

// Get counselor's own schedule
router.get('/api/counselor/schedule', authenticateToken, requireCounselor, getCounselorSchedule);

// Delete an available time slot
router.delete('/api/slots/:sessionId', authenticateToken, requireCounselor, deleteSlot);

// Update an available time slot
router.patch('/api/slots/:sessionId', authenticateToken, requireCounselor, updateSlot);

// ==================== USER MANAGEMENT ====================

// Promote user to counselor role
router.post('/api/counselor/promote', authenticateToken, requireCounselor, promoteUser);

// Get all users (with optional role filter)
router.get('/api/counselor/users', authenticateToken, requireCounselor, getAllUsers);

// Update user role
router.patch('/api/counselor/users/:userId/role', authenticateToken, requireCounselor, updateUserRole);

// Get all counselors
router.get('/api/counselor/counselors', authenticateToken, requireCounselor, getAllCounselors);

// Add user by CMU account (counselor shortcut)
router.post('/api/counselor/users', authenticateToken, requireCounselor, addUserByCmuAccount);

// Delete user
router.delete('/api/counselor/users/:userId', authenticateToken, requireCounselor, deleteUser);

// ==================== REPORT & ANALYTICS ====================

// Get full report with date range
router.get('/api/counselor/report', authenticateToken, requireCounselor, getFullReport);

// Get queue token list (sortable)
router.get('/api/counselor/tokens', authenticateToken, requireCounselor, getTokenList);
router.post('/api/counselor/tokens', authenticateToken, requireCounselor, createToken);

export default router;