/**
 * TENANT-SCOPED ROUTES — REVIEW CHECKLIST
 * All database queries in this file MUST filter by req.tenantId (set via requireTenant).
 * Never trust tenant id from req.query, req.body, or req.params.
 *
 * Pipeline for writes: requireDb → authenticate → requireTenant → requirePermission(...)
 * Authorization is the tenant permission matrix only — there are no hardcoded role names here.
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
  listCourseReviewers,
  getCourseReview,
  submitCourseForReview,
  listReviewQueue,
  requestCourseChanges,
  approveCourseReview,
} from "../controllers/courseController.js";
import { authenticate, optionalAuthenticate } from "../middleware/authenticate.js";
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

const submitReviewSchema = z.object({
  reviewerId: objectId,
  note: z.string().trim().max(2000).optional(),
});
/** A "changes requested" with no explanation is not actionable, so the note is required. */
const requestChangesSchema = z.object({ note: z.string().trim().min(3).max(2000) });
const approveSchema = z.object({ note: z.string().trim().max(2000).optional() });

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

/**
 * Signed-in tenant context. Every authoring route appends its own requirePermission(...)
 * so the permission matrix — not a role name — decides who may touch each resource.
 */
const authoring = [requireDb, authenticate, requireTenant];

/** Deciding a submitted content review — the Content Reviewer's job. */
const reviewing = [requireDb, authenticate, requireTenant, requirePermission("courses", "approve")];

/**
 * Taking a live course down. Deliberately a different permission from `approve`: a content
 * reviewer signs work off before it ships, an admin pulls it after it has shipped, and one
 * does not imply the other.
 */
const moderating = [requireDb, authenticate, requireTenant, requirePermission("courses", "moderate")];

/** Anyone in the tenant, signed in or not. */
const browsing = [requireDb, optionalAuthenticate, requireTenant];

/** Signed-in learners (playback gating happens in the controller). */
const learning = [requireDb, authenticate, requireTenant];

/* ------------------------ lesson routes (literal-first) ------------------------ */

router.get("/lessons/:lessonId/play", ...learning, getLessonPlaybackUrl);

router.put("/lessons/:lessonId", ...authoring, requirePermission("lessons", "edit"), validateBody(lessonSchema.partial()), updateLesson);
router.patch("/lessons/:lessonId", ...authoring, requirePermission("lessons", "edit"), validateBody(lessonSchema.partial()), updateLesson);
router.delete("/lessons/:lessonId", ...authoring, requirePermission("lessons", "delete"), deleteLesson);

router.post(
  "/lessons/:lessonId/content",
  ...authoring,
  requirePermission("lessons", "edit"),
  checkPlanLimits({ resource: "storage" }),
  withUpload(uploadMedia.single("file")),
  uploadLessonContent
);
router.post(
  "/lessons/:lessonId/upload-url",
  ...authoring,
  requirePermission("lessons", "edit"),
  checkPlanLimits({ resource: "storage" }),
  validateBody(uploadUrlSchema),
  createLessonUploadUrl
);
router.post(
  "/lessons/:lessonId/upload-complete",
  ...authoring,
  requirePermission("lessons", "edit"),
  validateBody(completeUploadSchema),
  completeLessonUpload
);
router.post(
  "/lessons/:lessonId/attachments",
  ...authoring,
  requirePermission("lessons", "edit"),
  checkPlanLimits({ resource: "storage" }),
  withUpload(uploadDocument.single("file")),
  addLessonAttachment
);
router.delete(
  "/lessons/:lessonId/attachments/:attachmentId",
  ...authoring,
  requirePermission("lessons", "edit"),
  deleteLessonAttachment
);

/* ------------------------ module routes (literal-first) ------------------------ */

router.put(
  "/modules/:moduleId/lessons/reorder",
  ...authoring,
  requirePermission("lessons", "edit"),
  validateBody(reorderLessonsSchema),
  reorderLessons
);
router.post(
  "/modules/:moduleId/lessons",
  ...authoring,
  requirePermission("lessons", "create"),
  validateBody(lessonSchema),
  addLesson
);
router.put("/modules/:moduleId", ...authoring, requirePermission("course-modules", "edit"), validateBody(moduleSchema.partial()), updateModule);
router.patch("/modules/:moduleId", ...authoring, requirePermission("course-modules", "edit"), validateBody(moduleSchema.partial()), updateModule);
router.delete("/modules/:moduleId", ...authoring, requirePermission("course-modules", "delete"), deleteModule);

/* ------------------------------ review routes (literal-first) ------------------------------ */

/** Who this instructor can send a course to — anyone whose role grants courses:approve. */
router.get("/reviewers", ...authoring, requirePermission("courses", "submit"), listCourseReviewers);

/** A content reviewer's inbox — courses submitted to them and still pending. */
router.get("/review-queue", ...authoring, requirePermission("courses", "approve"), listReviewQueue);

/* ------------------------------ course routes ------------------------------ */

router.get("/", ...browsing, listCourses);

router.post(
  "/",
  ...authoring,
  requirePermission("courses", "create"),
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
router.get("/:id/review", ...authoring, getCourseReview);
router.post(
  "/:id/submit-review",
  ...authoring,
  requirePermission("courses", "submit"),
  validateBody(submitReviewSchema),
  submitCourseForReview
);
router.post(
  "/:id/review/request-changes",
  ...reviewing,
  validateBody(requestChangesSchema),
  requestCourseChanges
);
router.post("/:id/review/approve", ...reviewing, validateBody(approveSchema), approveCourseReview);

router.post("/:id/block", ...moderating, validateBody(blockSchema), blockCourse);
router.post("/:id/unblock", ...moderating, unblockCourse);

router.post(
  "/:id/thumbnail",
  ...authoring,
  requirePermission("courses", "edit"),
  checkPlanLimits({ resource: "storage" }),
  withUpload(uploadImage.single("file")),
  uploadCourseThumbnail
);

router.post("/:id/modules", ...authoring, requirePermission("course-modules", "create"), validateBody(moduleSchema), addModule);
router.put("/:id/modules/reorder", ...authoring, requirePermission("course-modules", "edit"), validateBody(reorderModulesSchema), reorderModules);

export default router;
