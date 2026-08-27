/**
 * TENANT-SCOPED ROUTES — REVIEW CHECKLIST
 * All database queries in this file MUST filter by req.tenantId (set via requireTenant).
 * Never trust tenant id from req.query, req.body, or req.params.
 *
 * Pipeline for writes: requireDb → authenticate → requireTenant → requireRole(...)
 * Public catalog reads use optionalAuthenticate so anonymous visitors still resolve a
 * tenant from the subdomain but only ever see published, unblocked courses.
 */
import express from "express";
import { z } from "zod";

import {
  listCourses,
  createCourse,
  getCourse,
  updateCourse,
  deleteCourse,
  publishCourse,
  unpublishCourse,
  blockCourse,
  unblockCourse,
  uploadCourseThumbnail,
  addModule,
  updateModule,
  deleteModule,
  reorderModules,
  addLesson,
  updateLesson,
  deleteLesson,
  reorderLessons,
  uploadLessonContent,
  createLessonUploadUrl,
  completeLessonUpload,
  addLessonAttachment,
  deleteLessonAttachment,
  getLessonPlaybackUrl,
  getEnrollableUsers,
} from "../controllers/courseController.js";
import { authenticate, optionalAuthenticate } from "../middleware/authenticate.js";
import { requireRole } from "../middleware/requireRole.js";
import { requireTenant, requirePermission } from "../middlewares/auth.js";
import { checkPlanLimits } from "../middlewares/checkPlanLimits.js";
import {
  uploadImage,
  uploadDocument,
  uploadMedia,
  withUpload,
  VIDEO_MIMES,
  AUDIO_MIMES,
  DOCUMENT_MIMES,
  IMAGE_MIMES,
} from "../middlewares/upload.js";
import { COURSE_LEVELS } from "../models/Course.js";
import { LESSON_TYPES } from "../models/Lesson.js";
import { sendError } from "../utils/helper.js";
import { validationMessageFromZod } from "../utils/errorMessages.js";
import { requireDb } from "../utils/db-state.js";

const router = express.Router();

/* ----------------------------- validation ----------------------------- */

function validateBody(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return sendError(res, "GENERAL_VALIDATION_FAILED", 400, {
        detail: validationMessageFromZod(parsed.error),
        issues: parsed.error.issues,
      });
    }
    req.body = parsed.data;
    return next();
  };
}

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "must be a valid id");

const createCourseSchema = z.object({
  title: z.string().trim().min(1).max(200),
  subtitle: z.string().trim().max(300).optional(),
  description: z.string().max(20000).optional(),
  category: z.string().trim().max(120).optional(),
  level: z.enum(COURSE_LEVELS).optional(),
  language: z.string().trim().max(20).optional(),
  price: z.coerce.number().min(0).max(10_000_000).optional(),
  currency: z.string().trim().length(3).optional(),
  tags: z.array(z.string().trim().max(50)).max(30).optional(),
  outcomes: z.array(z.string().trim().max(300)).max(30).optional(),
  requirements: z.array(z.string().trim().max(300)).max(30).optional(),
});

const updateCourseSchema = createCourseSchema
  .partial()
  // PUBLISHED is intentionally excluded — publishing goes through POST /:id/publish.
  .extend({ status: z.enum(["DRAFT", "ARCHIVED"]).optional() });

const moduleSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(2000).optional(),
  order: z.coerce.number().int().min(0).optional(),
});

const lessonSchema = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().max(100000).optional(),
  videoUrl: z.string().trim().max(2000).optional(),
  type: z.enum(LESSON_TYPES).optional(),
  order: z.coerce.number().int().min(0).optional(),
  duration: z.coerce.number().min(0).max(10000).optional(),
  isPreview: z.boolean().optional(),
  assignmentInstructions: z.string().max(20000).optional(),
});

const reorderModulesSchema = z.object({ moduleIds: z.array(objectId).min(1).max(500) });
const reorderLessonsSchema = z.object({ lessonIds: z.array(objectId).min(1).max(500) });
const blockSchema = z.object({ reason: z.string().trim().min(3).max(500) });

const uploadUrlSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  mimeType: z.enum([...VIDEO_MIMES, ...AUDIO_MIMES, ...DOCUMENT_MIMES, ...IMAGE_MIMES]),
  size: z.coerce.number().int().min(1).max(5 * 1024 * 1024 * 1024).optional(),
});

const completeUploadSchema = z.object({
  key: z.string().trim().min(1).max(1024),
  mimeType: z.string().trim().max(150).optional(),
});

/* ------------------------------ pipelines ------------------------------ */

/** Instructors and tenant staff who can author course content. */
const authoring = [
  requireDb,
  authenticate,
  requireTenant,
  requireRole("TENANT_ADMIN", "ORG_ADMIN", "TUTOR"),
];

/** Tenant staff only — moderation actions over other people's courses. */
const moderating = [requireDb, authenticate, requireTenant, requireRole("TENANT_ADMIN", "ORG_ADMIN")];

/** Anyone in the tenant, signed in or not. */
const browsing = [requireDb, optionalAuthenticate, requireTenant];

/** Signed-in learners (playback gating happens in the controller). */
const learning = [requireDb, authenticate, requireTenant];

/* ------------------------ lesson routes (literal-first) ------------------------ */

router.get("/lessons/:lessonId/play", ...learning, getLessonPlaybackUrl);

router.put("/lessons/:lessonId", ...authoring, validateBody(lessonSchema.partial()), updateLesson);
router.patch("/lessons/:lessonId", ...authoring, validateBody(lessonSchema.partial()), updateLesson);
router.delete("/lessons/:lessonId", ...authoring, deleteLesson);

router.post(
  "/lessons/:lessonId/content",
  ...authoring,
  checkPlanLimits({ resource: "storage" }),
  withUpload(uploadMedia.single("file")),
  uploadLessonContent
);
router.post(
  "/lessons/:lessonId/upload-url",
  ...authoring,
  checkPlanLimits({ resource: "storage" }),
  validateBody(uploadUrlSchema),
  createLessonUploadUrl
);
router.post(
  "/lessons/:lessonId/upload-complete",
  ...authoring,
  validateBody(completeUploadSchema),
  completeLessonUpload
);
router.post(
  "/lessons/:lessonId/attachments",
  ...authoring,
  checkPlanLimits({ resource: "storage" }),
  withUpload(uploadDocument.single("file")),
  addLessonAttachment
);
router.delete("/lessons/:lessonId/attachments/:attachmentId", ...authoring, deleteLessonAttachment);

/* ------------------------ module routes (literal-first) ------------------------ */

router.put(
  "/modules/:moduleId/lessons/reorder",
  ...authoring,
  validateBody(reorderLessonsSchema),
  reorderLessons
);
router.post("/modules/:moduleId/lessons", ...authoring, validateBody(lessonSchema), addLesson);
router.put("/modules/:moduleId", ...authoring, validateBody(moduleSchema.partial()), updateModule);
router.patch("/modules/:moduleId", ...authoring, validateBody(moduleSchema.partial()), updateModule);
router.delete("/modules/:moduleId", ...authoring, deleteModule);

/* ------------------------------ course routes ------------------------------ */

router.get("/", ...browsing, listCourses);

router.post(
  "/",
  ...authoring,
  checkPlanLimits({ resource: "courses" }),
  validateBody(createCourseSchema),
  createCourse
);

router.get("/:id", ...browsing, getCourse);
router.put("/:id", ...authoring, requirePermission("courses", "edit"), validateBody(updateCourseSchema), updateCourse);
router.patch("/:id", ...authoring, requirePermission("courses", "edit"), validateBody(updateCourseSchema), updateCourse);
router.delete("/:id", ...authoring, requirePermission("courses", "delete"), deleteCourse);

router.post("/:id/publish", ...authoring, requirePermission("courses", "publish"), publishCourse);
router.post("/:id/unpublish", ...authoring, requirePermission("courses", "publish"), unpublishCourse);
router.post("/:id/block", ...moderating, validateBody(blockSchema), blockCourse);
router.post("/:id/unblock", ...moderating, unblockCourse);

router.post(
  "/:id/thumbnail",
  ...authoring,
  checkPlanLimits({ resource: "storage" }),
  withUpload(uploadImage.single("file")),
  uploadCourseThumbnail
);

router.post("/:id/modules", ...authoring, validateBody(moduleSchema), addModule);
router.put("/:id/modules/reorder", ...authoring, validateBody(reorderModulesSchema), reorderModules);

export default router;
