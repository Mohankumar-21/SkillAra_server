/**
 * TENANT-SCOPED ROUTES — REVIEW CHECKLIST
 * All database queries in this file MUST filter by req.tenantId (set via scopeTenant middleware).
 * Never trust tenant id from req.query, req.body, or req.params.
 */
import express from "express";
import {
  getCourseProgress,
  getMyProgress,
  markLessonComplete,
} from "../controllers/progressController.js";
import { requireAuth, requireTenant } from "../middlewares/auth.js";
import { requireDb } from "../utils/db-state.js";

const router = express.Router();

router.get("/my", requireDb, requireAuth, requireTenant, getMyProgress);

router.get("/course/:courseId", requireDb, requireAuth, requireTenant, getCourseProgress);

router.post(
  "/lessons/:lessonId/complete",
  requireDb,
  requireAuth,
  requireTenant,
  markLessonComplete
);

export default router;
