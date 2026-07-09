import express from "express";
import { z } from "zod";
import {
  enrollInCourse,
  getMyEnrollments,
  getCourseEnrollments,
  dropEnrollment,
} from "../controllers/enrollmentController.js";
import { requireAuth, requireRole, requireTenant } from "../middlewares/auth.js";
import { prepareResponseMsg } from "../utils/helper.js";
import { requireDb } from "../utils/db-state.js";

const router = express.Router();

const enrollSchema = z.object({
  courseId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid courseId"),
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

router.post(
  "/",
  requireDb,
  requireAuth,
  requireRole("STUDENT"),
  requireTenant,
  validateBody(enrollSchema),
  enrollInCourse
);

router.get("/my", requireDb, requireAuth, requireTenant, getMyEnrollments);

router.get(
  "/course/:courseId",
  requireDb,
  requireAuth,
  requireRole("TENANT_ADMIN", "TUTOR"),
  requireTenant,
  getCourseEnrollments
);

router.delete("/:id", requireDb, requireAuth, requireTenant, dropEnrollment);

export default router;
