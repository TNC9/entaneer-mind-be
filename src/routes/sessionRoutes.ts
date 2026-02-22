import { Router } from "express";
import {
  authenticateToken,
  requireClient,
  requireCounselor,
} from "../middleware/authMiddleware";

import {
  // client
  getClientSessionHistory,
  cancelClientSession,

  // counselor
  counselorRecords,
  getCaseNote,
  updateCaseNote,

  // ✅ case code lookup
  getCaseNoteByCode,
} from "../controllers/sessionController";

const router = Router();

/* ---------- client ---------- */
router.get("/history", authenticateToken, requireClient, getClientSessionHistory);
router.post("/:sessionId/cancel", authenticateToken, requireClient, cancelClientSession);

/* ---------- counselor ---------- */
router.get("/counselor/records", authenticateToken, requireCounselor, counselorRecords);
router.get("/:sessionId/case-note", authenticateToken, requireCounselor, getCaseNote);
router.put("/:sessionId/case-note", authenticateToken, requireCounselor, updateCaseNote);

/* ---------- counselor: lookup by Case Code ---------- */
router.get(
  "/case-note/by-code/:caseCode",
  authenticateToken,
  requireCounselor,
  getCaseNoteByCode
);

export default router;