import express from 'express';
import { authenticateToken, requireClient, requireCounselor } from '../middleware/authMiddleware';
import {
  verifyCodeAndCreateCase,
  generateQueueToken,
  editCaseNote,
  getCaseHistory,
  updateAppointmentStatus,
  getRooms,
  createRoom,
  updateRoom,
  softDeleteRoom,
  getProblemTags,
  createProblemTag,
  updateProblemTag,
  softDeleteProblemTag
} from '../controllers/caseController';

const router = express.Router();

// เส้นทาง: /api/cases/verify-code
router.post('/verify-code', authenticateToken, verifyCodeAndCreateCase);

// เส้นทาง: /api/cases/generate-token (สำหรับขอคิว 6X000N)
router.post('/generate-token', authenticateToken, requireClient, generateQueueToken);

// Case management + history
router.put('/sessions/:sessionId/note', authenticateToken, requireCounselor, editCaseNote);
router.get('/:caseId/history', authenticateToken, requireCounselor, getCaseHistory);
router.patch('/:caseId/appointment-status', authenticateToken, requireCounselor, updateAppointmentStatus);

// Master data: rooms
router.get('/master/rooms', authenticateToken, requireCounselor, getRooms);
router.post('/master/rooms', authenticateToken, requireCounselor, createRoom);
router.put('/master/rooms/:roomId', authenticateToken, requireCounselor, updateRoom);
router.delete('/master/rooms/:roomId', authenticateToken, requireCounselor, softDeleteRoom);

// Master data: problem tags
router.get('/master/tags', authenticateToken, requireCounselor, getProblemTags);
router.post('/master/tags', authenticateToken, requireCounselor, createProblemTag);
router.put('/master/tags/:tagId', authenticateToken, requireCounselor, updateProblemTag);
router.delete('/master/tags/:tagId', authenticateToken, requireCounselor, softDeleteProblemTag);

export default router;