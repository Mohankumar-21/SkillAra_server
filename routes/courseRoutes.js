/**
 * TENANT-SCOPED ROUTES — REVIEW CHECKLIST
 * All database queries in this file MUST filter by req.tenantId (set via scopeTenant middleware).
 * Never trust tenant id from req.query, req.body, or req.params.
 */
import express from "express";
import { z } from "zod";
import {
  listCourses,
  createCourse,
  getCourse,
  updateCourse,
  deleteCourse,
  addModule,
  updateModule,
  deleteModule,
  addLesson,
  updateLesson,
  deleteLesson,
  uploadFile,
} from "../controllers/courseController.js";
import { requireAuth, requireRole, requireTenant, optionalAuth } from "../middlewares/auth.js";
import { checkPlanLimits } from "../middlewares/checkPlanLimits.js";
import { upload, handleUploadError } from "../middlewares/upload.js";
import { prepareResponseMsg } from "../utils/helper.js";
import { requireDb } from "../utils/db-state.js";

const router = express.Router();

const createCourseSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5000).optional(),
  thumbnail: z.string().optional(),
  price: z.number().min(0).optional(),
  tags: z.array(z.string()).optional(),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).optional(),
});

const updateCourseSchema = createCourseSchema.partial();

const moduleSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(2000).optional(),
  order: z.number().int().min(0),
});

const lessonSchema = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().optional(),
  videoUrl: z.string().optional(),
  type: z.enum(["VIDEO", "TEXT", "QUIZ", "ASSIGNMENT"]).optional(),
  order: z.number().int().min(0),
  duration: z.number().min(0).optional(),
  assignmentInstructions: z.string().optional(),
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

router.get("/", requireDb, optionalAuth, requireTenant, listCourses);

router.post(
  "/",
  requireDb,
  requireAuth,
  requireRole("TENANT_ADMIN", "TUTOR"),
  requireTenant,
  checkPlanLimits({ resource: "courses" }),
  validateBody(createCourseSchema),
  createCourse
);

router.post(
  "/upload",
  requireDb,
  requireAuth,
  requireRole("TENANT_ADMIN", "TUTOR"),
  requireTenant,
  upload.single("file"),
  handleUploadError,
  uploadFile
);

router.get("/:id", requireDb, optionalAuth, requireTenant, getCourse);

router.put(
  "/:id",
  requireDb,
  requireAuth,
  requireRole("TENANT_ADMIN", "TUTOR"),
  requireTenant,
  validateBody(updateCourseSchema),
  updateCourse
);

router.delete(
  "/:id",
  requireDb,
  requireAuth,
  requireRole("TENANT_ADMIN", "TUTOR"),
  requireTenant,
  deleteCourse
);

router.post(
  "/:id/modules",
  requireDb,
  requireAuth,
  requireRole("TENANT_ADMIN", "TUTOR"),
  requireTenant,
  validateBody(moduleSchema),
  addModule
);

router.put(
  "/modules/:moduleId",
  requireDb,
  requireAuth,
  requireRole("TENANT_ADMIN", "TUTOR"),
  requireTenant,
  validateBody(moduleSchema.partial()),
  updateModule
);

router.delete(
  "/modules/:moduleId",
  requireDb,
  requireAuth,
  requireRole("TENANT_ADMIN", "TUTOR"),
  requireTenant,
  deleteModule
);

router.post(
  "/modules/:moduleId/lessons",
  requireDb,
  requireAuth,
  requireRole("TENANT_ADMIN", "TUTOR"),
  requireTenant,
  validateBody(lessonSchema),
  addLesson
);

router.put(
  "/lessons/:lessonId",
  requireDb,
  requireAuth,
  requireRole("TENANT_ADMIN", "TUTOR"),
  requireTenant,
  updateLesson
);

router.delete(
  "/lessons/:lessonId",
  requireDb,
  requireAuth,
  requireRole("TENANT_ADMIN", "TUTOR"),
  requireTenant,
  deleteLesson
);

export default router;
