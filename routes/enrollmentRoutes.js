/**
 * TENANT-SCOPED ROUTES — REVIEW CHECKLIST
 * All database queries in this file MUST filter by req.tenantId (set via scopeTenant middleware).
 * Never trust tenant id from req.query, req.body, or req.params.
 */
import express from "express";
import { z } from "zod";
import {
  enrollInCourse,
  getMyEnrollments,
  getCourseEnrollments,
  dropEnrollment,
  bulkEnrollStudents,
} from "../controllers/enrollmentController.js";
import { requireAuth, requireRole, requireTenant } from "../middlewares/auth.js";
import { prepareResponseMsg } from "../utils/helper.js";
import { requireDb } from "../utils/db-state.js";

const router = express.Router();

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid id");

const enrollSchema = z.object({
  courseId: objectId,
});

const bulkEnrollSchema = z.object({
  courseId: objectId,
  userIds: z.array(objectId).min(1).max(500),
});

function validateBody(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .send(
          prepareResponseMsg({ issues: parsed.error.issues }, false, "Validation failed", 400)
        );
    }
    req.body = parsed.data;
    return next();
  };
}

/** Path 1 — a learner enrols themselves. */
router.post(
  "/",
  requireDb,
  requireAuth,
  requireTenant,
  validateBody(enrollSchema),
  enrollInCourse
);

/** Path 2 — staff or the course's instructor enrol students they have added. */
router.post(
  "/bulk",
  requireDb,
  requireAuth,
  requireRole("TENANT_ADMIN", "ORG_ADMIN", "TUTOR"),
  requireTenant,
  validateBody(bulkEnrollSchema),
  bulkEnrollStudents
);

router.get("/my", requireDb, requireAuth, requireTenant, getMyEnrollments);

router.get(
  "/course/:courseId",
  requireDb,
  requireAuth,
  requireRole("TENANT_ADMIN", "ORG_ADMIN", "TUTOR"),
  requireTenant,
  getCourseEnrollments
);

router.delete("/:id", requireDb, requireAuth, requireTenant, dropEnrollment);

export default router;
