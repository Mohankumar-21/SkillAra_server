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
  listEnrollmentRequests,
  decideEnrollmentRequest,
  grantCourseAccess,
  getUserEnrollments,
} from "../controllers/enrollmentController.js";
import { requireAuth, requirePermission, requireTenant } from "../middlewares/auth.js";
import { prepareResponseMsg } from "../utils/helper.js";
import { requireDb } from "../utils/db-state.js";

const router = express.Router();

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid id");

const enrollSchema = z.object({
  courseId: objectId,
  /** Optional message from the learner when a paid course needs approval. */
  note: z.string().trim().max(1000).optional(),
});

const decisionSchema = z.object({ note: z.string().trim().max(1000).optional() });

const grantSchema = z.object({ userId: objectId, courseId: objectId });

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

/**
 * Path 1 — a learner enrols themselves.
 * Free course: active immediately. Paid course: recorded as a request for staff to approve.
 */
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
  requireTenant,
  requirePermission("learners", "assign"),
  validateBody(bulkEnrollSchema),
  bulkEnrollStudents
);

router.get("/my", requireDb, requireAuth, requireTenant, getMyEnrollments);

/* --------------------- paid-course access requests (staff) --------------------- */

router.get(
  "/requests",
  requireDb,
  requireAuth,
  requireTenant,
  requirePermission("learners", "assign"),
  listEnrollmentRequests
);

router.post(
  "/requests/:id/approve",
  requireDb,
  requireAuth,
  requireTenant,
  requirePermission("learners", "assign"),
  validateBody(decisionSchema),
  decideEnrollmentRequest
);

router.post(
  "/requests/:id/reject",
  requireDb,
  requireAuth,
  requireTenant,
  requirePermission("learners", "assign"),
  validateBody(decisionSchema),
  decideEnrollmentRequest
);

/** Staff view of one learner's course access, for the admin user panel. */
router.get(
  "/user/:userId",
  requireDb,
  requireAuth,
  requireTenant,
  requirePermission("learners", "view"),
  getUserEnrollments
);

/** Staff give one learner access to one course directly, without a request. */
router.post(
  "/grant",
  requireDb,
  requireAuth,
  requireTenant,
  requirePermission("learners", "assign"),
  validateBody(grantSchema),
  grantCourseAccess
);

router.get(
  "/course/:courseId",
  requireDb,
  requireAuth,
  requireTenant,
  requirePermission("learners", "view"),
  getCourseEnrollments
);

router.delete("/:id", requireDb, requireAuth, requireTenant, dropEnrollment);

export default router;
