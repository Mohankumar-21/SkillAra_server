/**
 * TENANT-SCOPED ROUTES — REVIEW CHECKLIST
 * All database queries in this file MUST filter by req.tenantId (set via scopeTenant middleware).
 * Never trust tenant id from req.query, req.body, or req.params.
 */
import express from "express";
import { z } from "zod";
import {
  createLiveSession,
  getAllLiveSessions,
  listCourseLiveSessions,
  joinLiveSession,
  endLiveSession,
  cancelLiveSession,
} from "../controllers/liveSessionController.js";
import { requireAuth, requireRole, requireTenant } from "../middlewares/auth.js";
import { checkPlanLimits } from "../middlewares/checkPlanLimits.js";
import { prepareResponseMsg } from "../utils/helper.js";
import { requireDb } from "../utils/db-state.js";

const router = express.Router();

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid id");

const createSchema = z.object({
  courseId: objectId,
  title: z.string().trim().min(1).max(200),
  description: z.string().max(2000).optional(),
  scheduledStart: z.string().min(1),
  scheduledEnd: z.string().min(1),
});

const endSchema = z.object({
  recordingUrl: z.string().url().max(2000).optional(),
});

const cancelSchema = z.object({
  reason: z.string().max(500).optional(),
});

function validateBody(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .send(prepareResponseMsg({ issues: parsed.error.issues }, false, "Validation failed", 400));
    }
    req.body = parsed.data;
    return next();
  };
}

router.post(
  "/",
  requireDb,
  requireAuth,
  requireRole("TENANT_ADMIN", "ORG_ADMIN", "TUTOR"),
  requireTenant,
  checkPlanLimits({ resource: "live-sessions" }),
  validateBody(createSchema),
  createLiveSession
);

/** Role-scoped: staff see every session, instructors see their own courses' sessions,
 *  students see sessions on courses they're enrolled in. Backs the Live Sessions hub. */
router.get("/", requireDb, requireAuth, requireTenant, getAllLiveSessions);

router.get("/course/:courseId", requireDb, requireAuth, requireTenant, listCourseLiveSessions);

router.get("/:id/join", requireDb, requireAuth, requireTenant, joinLiveSession);

router.patch(
  "/:id/end",
  requireDb,
  requireAuth,
  requireRole("TENANT_ADMIN", "ORG_ADMIN", "TUTOR"),
  requireTenant,
  validateBody(endSchema),
  endLiveSession
);

router.patch(
  "/:id/cancel",
  requireDb,
  requireAuth,
  requireRole("TENANT_ADMIN", "ORG_ADMIN", "TUTOR"),
  requireTenant,
  validateBody(cancelSchema),
  cancelLiveSession
);

export default router;
