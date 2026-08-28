/**
 * TENANT-SCOPED CONTROLLER — REVIEW CHECKLIST
 * Every query below filters by req.tenantId (set by requireTenant/scopeTenant).
 * Tenant id is never read from req.query, req.body, or req.params.
 *
 * Authorization model:
 *   TUTOR         → full CRUD on courses where instructorId === actor.id
 *   TENANT_ADMIN  → read/moderate every course in the tenant, may unpublish/block
 *   ORG_ADMIN     → same reach as TENANT_ADMIN for moderation
 *   STUDENT/anon  → published, unblocked courses only
 */
import mongoose from "mongoose";

import Course from "../models/Course.js";
import Tenant from "../models/Tenant.js";
import User from "../models/User.js";
import Module from "../models/Module.js";
import Lesson from "../models/Lesson.js";
import Enrollment from "../models/Enrollment.js";
import logger from "../core/logger.js";
import { getActor, canModerateCourses } from "../utils/actor.js";
import { sendError, sendSuccess, prepareResponseMsg } from "../utils/helper.js";
import {
  buildCourseKey,
  deleteObject,
  deleteObjects,
  getSignedDownloadUrl,
  getSignedUploadUrl,
  headObject,
  isStorageConfigured,
  missingStorageConfig,
  keyBelongsToTenant,
  putObject,
  DOWNLOAD_URL_TTL_SECONDS,
} from "../services/storageService.js";
import { incrementTenantStorage, decrementTenantStorage } from "../middlewares/checkPlanLimits.js";
import { notifyUsers } from "../services/notificationService.js";
import { usersWithPermission } from "../services/roleService.js";

const isObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));

/* ------------------------------------------------------------------ *
 * Access helpers
 * ------------------------------------------------------------------ */

/**
 * True when this actor is the content reviewer the course is currently assigned to.
 *
 * A reviewer is usually neither an instructor nor an admin, so without this they would fail
 * every ownership check and could not open the draft they were asked to review.
 */
function isAssignedReviewer(course, actor) {
  const reviewerId = course?.review?.reviewerId;
  return Boolean(actor?.id && reviewerId && String(reviewerId) === String(actor.id));
}

/**
 * Load a course the actor is allowed to *modify*.
 * @returns {{course: import("mongoose").Document}|{error: string, status: number}}
 */
async function loadWritableCourse(courseId, tenantId, actor) {
  if (!isObjectId(courseId)) return { error: "COURSE_INVALID_ID", status: 400 };

  const course = await Course.findOne({ _id: courseId, tenantId });
  if (!course) return { error: "COURSE_NOT_FOUND", status: 404 };

  if (canModerateCourses(actor)) return { course };

  if (String(course.instructorId) !== String(actor.id)) {
    // 404 rather than 403 so instructors cannot probe for other instructors' course ids.
    return { error: "COURSE_NOT_FOUND", status: 404 };
  }

  if (course.moderation?.isBlocked) return { error: "COURSE_BLOCKED", status: 403 };

  return { course };
}

/** Load a course the actor is allowed to *read*, applying learner visibility rules. */
async function loadReadableCourse(courseId, tenantId, actor) {
  if (!isObjectId(courseId)) return { error: "COURSE_INVALID_ID", status: 400 };

  const course = await Course.findOne({ _id: courseId, tenantId });
  if (!course) return { error: "COURSE_NOT_FOUND", status: 404 };

  // Live courses are readable by anyone in the tenant, signed in or not.
  const isLive = course.status === "PUBLISHED" && !course.moderation?.isBlocked;
  if (isLive) return { course };

  // Everything below is unpublished or blocked: only staff, the owning instructor, and the
  // assigned content reviewer may see it. 404 rather than 403 so other instructors' drafts
  // cannot be probed for by id.
  if (canModerateCourses(actor)) return { course };
  if (String(course.instructorId) === String(actor?.id)) return { course };
  if (isAssignedReviewer(course, actor)) return { course };

  return { error: "COURSE_NOT_FOUND", status: 404 };
}

/** True when the actor may see lesson media for this course. */
async function hasCourseAccess(course, actor, tenantId) {
  if (!actor) return false;
  if (canModerateCourses(actor)) return true;
  if (String(course.instructorId) === String(actor.id)) return true;
  // A reviewer cannot judge content they are not allowed to open.
  if (isAssignedReviewer(course, actor)) return true;

  const enrollment = await Enrollment.findOne({
    userId: actor.id,
    courseId: course._id,
    tenantId,
    status: { $in: ["ACTIVE", "COMPLETED"] },
  }).select("_id");

  return Boolean(enrollment);
}

/* ------------------------------------------------------------------ *
 * Serialization
 * ------------------------------------------------------------------ */

/** Signed thumbnail URL, or null when storage is unconfigured / no thumbnail set. */
async function thumbnailUrlFor(course) {
  if (course.thumbnailKey && isStorageConfigured()) {
    try {
      return await getSignedDownloadUrl(course.thumbnailKey);
    } catch {
      return null;
    }
  }
  return course.thumbnail || null;
}

async function serializeCourse(course, { actor } = {}) {
  const doc = course.toObject ? course.toObject() : course;
  const canManage =
    canModerateCourses(actor) ||
    String(doc.instructorId?._id ?? doc.instructorId) === String(actor?.id) ||
    isAssignedReviewer(doc, actor);

  return {
    id: String(doc._id),
    tenantId: String(doc.tenantId),
    title: doc.title,
    subtitle: doc.subtitle || "",
    description: doc.description || "",
    category: doc.category || "",
    level: doc.level,
    language: doc.language,
    status: doc.status,
    publishedAt: doc.publishedAt,
    isLive: doc.status === "PUBLISHED" && !doc.moderation?.isBlocked,
    price: doc.price ?? 0,
    currency: doc.currency || "INR",
    tags: doc.tags || [],
    outcomes: doc.outcomes || [],
    requirements: doc.requirements || [],
    stats: doc.stats || {},
    aiSummary: doc.aiSummary || "",
    aiSummaryGeneratedAt: doc.aiSummaryGeneratedAt || null,
    thumbnailUrl: await thumbnailUrlFor(doc),
    instructor:
      doc.instructorId && typeof doc.instructorId === "object" && doc.instructorId.name !== undefined
        ? {
            id: String(doc.instructorId._id),
            name: doc.instructorId.name || "",
            email: doc.instructorId.email || "",
          }
        : { id: String(doc.instructorId), name: "", email: "" },
    // Block reasons are internal — only staff and the affected instructor see them.
    moderation: canManage
      ? {
          isBlocked: Boolean(doc.moderation?.isBlocked),
          reason: doc.moderation?.reason || "",
          blockedAt: doc.moderation?.blockedAt || null,
        }
      : { isBlocked: Boolean(doc.moderation?.isBlocked) },
    // Review state drives the instructor's publish button; learners never see it.
    ...(canManage ? { review: serializeReview(doc) } : {}),
    createdAt: doc.created_on,
    updatedAt: doc.updated_on,
  };
}

/**
 * Lesson shape sent to the client. `contentKey` is never exposed — media is fetched
 * through GET /lessons/:id/play, which re-checks enrollment and signs a fresh URL.
 */
function serializeLesson(lesson, { canManage, hasAccess }) {
  const doc = lesson.toObject ? lesson.toObject() : lesson;
  const unlocked = canManage || hasAccess || doc.isPreview;

  return {
    id: String(doc._id),
    moduleId: String(doc.moduleId),
    title: doc.title,
    type: doc.type,
    order: doc.order,
    duration: doc.duration ?? 0,
    isPreview: Boolean(doc.isPreview),
    hasContent: Boolean(doc.contentKey || doc.videoUrl),
    uploadStatus: doc.uploadStatus,
    mimeType: doc.mimeType || "",
    fileSize: doc.fileSize ?? 0,
    locked: !unlocked,
    // Text bodies and instructions are part of the paid content.
    content: unlocked ? doc.content || "" : "",
    assignmentInstructions: unlocked ? doc.assignmentInstructions || "" : "",
    videoUrl: unlocked ? doc.videoUrl || "" : "",
    attachments: unlocked
      ? (doc.attachments || []).map((a) => ({
          id: String(a._id),
          name: a.name,
          mimeType: a.mimeType,
          size: a.size,
        }))
      : [],
  };
}

/** Recompute denormalized lesson count and total duration for a course. */
async function refreshCourseStats(courseId, tenantId) {
  const [agg] = await Lesson.aggregate([
    { $match: { tenantId: new mongoose.Types.ObjectId(String(tenantId)), courseId: new mongoose.Types.ObjectId(String(courseId)) } },
    { $group: { _id: null, lessonCount: { $sum: 1 }, durationMinutes: { $sum: "$duration" } } },
  ]);

  await Course.updateOne(
    { _id: courseId, tenantId },
    {
      $set: {
        "stats.lessonCount": agg?.lessonCount ?? 0,
        "stats.durationMinutes": agg?.durationMinutes ?? 0,
      },
    }
  );
}

/** Short-circuits media routes when B2 is unconfigured, naming the missing vars in the log. */
function storageGuard(res) {
  const missing = missingStorageConfig();
  if (missing.length === 0) return false;

  logger.error(`[storage] not configured — missing env: ${missing.join(", ")}`);
  sendError(res, "STORAGE_NOT_CONFIGURED", 503);
  return true;
}

/* ------------------------------------------------------------------ *
 * Course CRUD
 * ------------------------------------------------------------------ */

export async function listCourses(req, res, next) {
  try {
    const actor = getActor(req);
    const tenantId = req.tenantId;
    const { search, category, level, tag, status, mine, instructorId } = req.query;

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));

    const filter = { tenantId };

    if (canModerateCourses(actor)) {
      if (status) filter.status = status;
    } else if (actor?.isInstructor) {
      // Own courses at any status, plus everyone else's live catalog.
      const ownFilter = { instructorId: actor.id, ...(status ? { status } : {}) };
      const liveFilter = {
        status: "PUBLISHED",
        "moderation.isBlocked": { $ne: true },
        ...(status && status !== "PUBLISHED" ? { _id: null } : {}),
      };
      filter.$or = [ownFilter, liveFilter];
    } else {
      filter.status = "PUBLISHED";
      filter["moderation.isBlocked"] = { $ne: true };
    }

    if (String(mine) === "true" && actor) filter.instructorId = actor.id;
    if (instructorId && isObjectId(instructorId) && canModerateCourses(actor)) {
      filter.instructorId = instructorId;
    }
    if (category) filter.category = category;
    if (level) filter.level = level;
    if (tag) filter.tags = tag;
    if (search) {
      const rx = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      const searchOr = [{ title: rx }, { subtitle: rx }, { description: rx }, { tags: rx }];
      // Preserve any visibility $or already applied.
      if (filter.$or) {
        filter.$and = [{ $or: filter.$or }, { $or: searchOr }];
        delete filter.$or;
      } else {
        filter.$or = searchOr;
      }
    }

    const [courses, totalCount] = await Promise.all([
      Course.find(filter)
        .populate("instructorId", "name email")
        .sort({ created_on: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Course.countDocuments(filter),
    ]);

    const data = await Promise.all(courses.map((c) => serializeCourse(c, { actor })));

    return res
      .status(200)
      .send(prepareResponseMsg(data, true, "Courses fetched successfully", 200, limit, totalCount));
  } catch (err) {
    return next(err);
  }
}

export async function getCourse(req, res, next) {
  try {
    const actor = getActor(req);
    const tenantId = req.tenantId;

    const result = await loadReadableCourse(req.params.id, tenantId, actor);
    if (result.error) return sendError(res, result.error, result.status);

    const course = await Course.findById(result.course._id).populate("instructorId", "name email");

    const canManage =
      canModerateCourses(actor) || String(course.instructorId?._id) === String(actor?.id);
    const hasAccess = canManage || (await hasCourseAccess(course, actor, tenantId));

    const modules = await Module.find({ courseId: course._id, tenantId }).sort({ order: 1 });
    const lessons = await Lesson.find({ courseId: course._id, tenantId }).sort({ order: 1 });

    const lessonsByModule = new Map();
    for (const lesson of lessons) {
      const key = String(lesson.moduleId);
      if (!lessonsByModule.has(key)) lessonsByModule.set(key, []);
      lessonsByModule.get(key).push(serializeLesson(lesson, { canManage, hasAccess }));
    }

    const payload = await serializeCourse(course, { actor });
    payload.canManage = canManage;
    payload.hasAccess = hasAccess;
    // The learner's own enrolment state, so the page can show "request pending" or
    // "declined" instead of offering the enrol button again.
    if (actor && !hasAccess) {
      const mine = await Enrollment.findOne({
        userId: actor.id,
        courseId: course._id,
        tenantId,
      }).select("status decisionNote requestedAt");
      payload.myEnrollment = mine
        ? {
            status: mine.status,
            decisionNote: mine.decisionNote || "",
            requestedAt: mine.requestedAt || null,
          }
        : null;
    }
    /** Paid courses are gated on staff approval rather than instant enrolment. */
    payload.needsApproval = Boolean(course.requiresPayment) || Number(course.price) > 0;
    payload.modules = modules.map((m) => ({
      id: String(m._id),
      title: m.title,
      description: m.description || "",
      order: m.order,
      lessons: lessonsByModule.get(String(m._id)) || [],
      aiSummary: m.aiSummary || "",
      aiSummaryGeneratedAt: m.aiSummaryGeneratedAt || null,
    }));

    return sendSuccess(res, "Course fetched successfully", payload);
  } catch (err) {
    return next(err);
  }
}

export async function createCourse(req, res, next) {
  try {
    const actor = getActor(req);
    if (!actor) return sendError(res, "GENERAL_UNAUTHORIZED", 401);

    const course = await Course.create({
      tenantId: req.tenantId,
      instructorId: actor.id,
      title: req.body.title,
      subtitle: req.body.subtitle,
      description: req.body.description,
      category: req.body.category,
      level: req.body.level,
      language: req.body.language,
      price: req.body.price,
      currency: req.body.currency,
      tags: req.body.tags,
      outcomes: req.body.outcomes,
      requirements: req.body.requirements,
      // New courses always start as drafts; publishing is a separate, validated action.
      status: "DRAFT",
      created_by: actor.id,
      updated_by: actor.id,
    });

    return sendSuccess(
      res,
      "Course created successfully",
      await serializeCourse(course, { actor }),
      201
    );
  } catch (err) {
    return next(err);
  }
}

const EDITABLE_COURSE_FIELDS = [
  "title",
  "subtitle",
  "description",
  "category",
  "level",
  "language",
  "price",
  "currency",
  "tags",
  "outcomes",
  "requirements",
];

export async function updateCourse(req, res, next) {
  try {
    const actor = getActor(req);
    const result = await loadWritableCourse(req.params.id, req.tenantId, actor);
    if (result.error) return sendError(res, result.error, result.status);

    const updates = { updated_by: actor.id };
    for (const key of EDITABLE_COURSE_FIELDS) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    // `status` is only accepted here for DRAFT <-> ARCHIVED moves; publishing goes
    // through /publish so the has-content check cannot be bypassed.
    if (req.body.status !== undefined && req.body.status !== "PUBLISHED") {
      updates.status = req.body.status;
      if (req.body.status === "DRAFT") updates.publishedAt = null;
    }

    const updated = await Course.findOneAndUpdate(
      { _id: result.course._id, tenantId: req.tenantId },
      { $set: updates },
      { new: true }
    ).populate("instructorId", "name email");

    return sendSuccess(res, "Course updated successfully", await serializeCourse(updated, { actor }));
  } catch (err) {
    return next(err);
  }
}

export async function publishCourse(req, res, next) {
  try {
    const actor = getActor(req);
    const result = await loadWritableCourse(req.params.id, req.tenantId, actor);
    if (result.error) return sendError(res, result.error, result.status);

    const course = result.course;
    if (course.moderation?.isBlocked) return sendError(res, "COURSE_BLOCKED", 403);

    const lessonCount = await Lesson.countDocuments({
      courseId: course._id,
      tenantId: req.tenantId,
    });
    if (lessonCount === 0) return sendError(res, "COURSE_EMPTY_CANNOT_PUBLISH", 422);

    // Content review is the gate on publishing — an approval must exist and be current.
    if (course.review?.status !== "APPROVED") {
      return sendError(res, "COURSE_REVIEW_REQUIRED", 422);
    }

    const updated = await Course.findOneAndUpdate(
      { _id: course._id, tenantId: req.tenantId },
      {
        $set: {
          status: "PUBLISHED",
          publishedAt: course.publishedAt || new Date(),
          updated_by: actor.id,
        },
      },
      { new: true }
    ).populate("instructorId", "name email");

    await notifyUsers({
      tenantId: req.tenantId,
      userIds: [course.review?.reviewerId, course.instructorId],
      type: "course.published",
      title: `Course published: ${course.title}`,
      message: "The approved course is now live in the catalog.",
      actorId: actor.id,
      actorName: await actorNameFor(actor.id),
      courseId: course._id,
      link: `/courses/${course._id}`,
    });

    return sendSuccess(res, "Course published", await serializeCourse(updated, { actor }));
  } catch (err) {
    return next(err);
  }
}

export async function unpublishCourse(req, res, next) {
  try {
    const actor = getActor(req);
    // Admins may unpublish any course in their tenant, which loadWritableCourse allows.
    const result = await loadWritableCourse(req.params.id, req.tenantId, actor);
    if (result.error && result.error !== "COURSE_BLOCKED") {
      return sendError(res, result.error, result.status);
    }

    const courseId = result.course?._id || req.params.id;
    // Approval is consumed by publishing: a course taken back to draft must be re-reviewed
    // before it can go live again, so an old approval can't cover later edits.
    const updated = await Course.findOneAndUpdate(
      { _id: courseId, tenantId: req.tenantId },
      {
        $set: {
          status: "DRAFT",
          publishedAt: null,
          updated_by: actor.id,
          "review.status": "NOT_SUBMITTED",
          "review.reviewerId": null,
          "review.submittedAt": null,
          "review.decidedAt": null,
          "review.note": "",
        },
        $push: {
          "review.history": {
            action: "reset",
            actorId: actor.id,
            actorName: await actorNameFor(actor.id),
            note: "Course unpublished - review reset.",
            at: new Date(),
          },
        },
      },
      { new: true }
    ).populate("instructorId", "name email");

    if (!updated) return sendError(res, "COURSE_NOT_FOUND", 404);

    return sendSuccess(res, "Course unpublished", await serializeCourse(updated, { actor }));
  } catch (err) {
    return next(err);
  }
}

/* ------------------------------------------------------------------ *
 * Content review
 * ------------------------------------------------------------------ */

async function actorNameFor(userId) {
  if (!userId) return "";
  const user = await User.findById(userId).select("name email");
  return user?.name || user?.email || "";
}

/**
 * Users whose tenant role grants courses:approve - the people an instructor may pick as
 * reviewer. Derived from the permission matrix, so a tenant that renames or clones the
 * Content Reviewer role keeps working without any code change here.
 */
async function eligibleReviewers(tenantId) {
  return usersWithPermission(tenantId, "courses", "approve");
}

function serializeReview(course) {
  const review = course.review || {};
  return {
    status: review.status || "NOT_SUBMITTED",
    reviewerId: review.reviewerId ? String(review.reviewerId) : null,
    submittedBy: review.submittedBy ? String(review.submittedBy) : null,
    submittedAt: review.submittedAt || null,
    decidedBy: review.decidedBy ? String(review.decidedBy) : null,
    decidedAt: review.decidedAt || null,
    note: review.note || "",
    canPublish: review.status === "APPROVED",
    history: (review.history || []).map((event) => ({
      action: event.action,
      actorId: event.actorId ? String(event.actorId) : null,
      actorName: event.actorName || "",
      note: event.note || "",
      at: event.at,
    })),
  };
}

/** GET /api/courses/reviewers - who the instructor can send a course to. */
export async function listCourseReviewers(req, res, next) {
  try {
    return sendSuccess(res, "Reviewers fetched", {
      reviewers: await eligibleReviewers(req.tenantId),
    });
  } catch (err) {
    return next(err);
  }
}

/** GET /api/courses/:id/review - current review state plus full history. */
export async function getCourseReview(req, res, next) {
  try {
    const actor = getActor(req);
    const result = await loadReadableCourse(req.params.id, req.tenantId, actor);
    if (result.error) return sendError(res, result.error, result.status);

    const course = result.course;
    const canSeeReview =
      canModerateCourses(actor) ||
      String(course.instructorId) === String(actor.id) ||
      isAssignedReviewer(course, actor);
    if (!canSeeReview) return sendError(res, "COURSE_NOT_FOUND", 404);

    return sendSuccess(res, "Review fetched", serializeReview(course));
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/courses/review-queue - courses waiting on this reviewer.
 * Moderators see every pending review in the tenant, not just their own assignments.
 */
export async function listReviewQueue(req, res, next) {
  try {
    const actor = getActor(req);
    // ?status=ALL gives moderators the whole review picture — pending, sent back, and
    // approved-but-unpublished — which is what the admin monitoring page needs.
    const wantAll = String(req.query.status || "").toUpperCase() === "ALL";
    const filter = { tenantId: req.tenantId };
    filter["review.status"] = wantAll
      ? { $in: ["PENDING", "CHANGES_REQUESTED", "APPROVED"] }
      : "PENDING";
    if (!canModerateCourses(actor)) filter["review.reviewerId"] = actor.id;

    const courses = await Course.find(filter)
      .sort({ "review.submittedAt": -1 })
      .limit(200)
      .populate("instructorId", "name email");

    return sendSuccess(res, "Review queue fetched", {
      courses: await Promise.all(courses.map((course) => serializeCourse(course, { actor }))),
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/courses/:id/submit-review - instructor sends the course to a content reviewer.
 * Allowed from NOT_SUBMITTED or CHANGES_REQUESTED; re-submitting a PENDING course conflicts
 * so a reviewer's queue cannot be spammed.
 */
export async function submitCourseForReview(req, res, next) {
  try {
    const actor = getActor(req);
    const result = await loadWritableCourse(req.params.id, req.tenantId, actor);
    if (result.error) return sendError(res, result.error, result.status);

    const course = result.course;
    if (course.status === "PUBLISHED") return sendError(res, "COURSE_ALREADY_PUBLISHED", 409);
    if (course.review?.status === "PENDING") return sendError(res, "COURSE_REVIEW_PENDING", 409);
    if (course.review?.status === "APPROVED") return sendError(res, "COURSE_REVIEW_APPROVED", 409);

    const lessonCount = await Lesson.countDocuments({
      courseId: course._id,
      tenantId: req.tenantId,
    });
    if (lessonCount === 0) return sendError(res, "COURSE_EMPTY_CANNOT_PUBLISH", 422);

    const { reviewerId, note = "" } = req.body;
    const reviewers = await eligibleReviewers(req.tenantId);
    if (reviewers.length === 0) return sendError(res, "COURSE_REVIEWER_UNAVAILABLE", 422);

    const reviewer = reviewers.find((r) => r.id === String(reviewerId));
    if (!reviewer) return sendError(res, "COURSE_REVIEWER_INVALID", 400);

    const actorName = await actorNameFor(actor.id);
    const now = new Date();

    const updated = await Course.findOneAndUpdate(
      { _id: course._id, tenantId: req.tenantId },
      {
        $set: {
          "review.status": "PENDING",
          "review.reviewerId": reviewer.id,
          "review.submittedBy": actor.id,
          "review.submittedAt": now,
          "review.decidedBy": null,
          "review.decidedAt": null,
          "review.note": note,
          updated_by: actor.id,
        },
        $push: {
          "review.history": {
            action: "submitted",
            actorId: actor.id,
            actorName,
            note,
            at: now,
          },
        },
      },
      { new: true }
    );

    await notifyUsers({
      tenantId: req.tenantId,
      userIds: [reviewer.id],
      type: "course.review.assigned",
      title: `Review requested: ${course.title}`,
      message: note
        ? `${actorName} assigned this course to you for review. Note: ${note}`
        : `${actorName} assigned this course to you for review.`,
      actorId: actor.id,
      actorName,
      courseId: course._id,
      link: `/admin/courses/${course._id}/review`,
    });

    return sendSuccess(res, "Course submitted for review", serializeReview(updated));
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/courses/:id/review/request-changes - reviewer sends the course back with input
 * (plagiarism findings, corrections). The note is mandatory: "changes requested" with no
 * explanation is not actionable for the instructor.
 */
export async function requestCourseChanges(req, res, next) {
  return decideReview(req, res, next, {
    action: "changes_requested",
    status: "CHANGES_REQUESTED",
    type: "course.review.changes_requested",
    titleFor: (course) => `Changes requested: ${course.title}`,
    messageFor: (actorName, note) => `${actorName} requested changes. ${note}`,
    successMessage: "Changes requested",
  });
}

/** POST /api/courses/:id/review/approve - reviewer signs the course off for publishing. */
export async function approveCourseReview(req, res, next) {
  return decideReview(req, res, next, {
    action: "approved",
    status: "APPROVED",
    type: "course.review.approved",
    titleFor: (course) => `Approved: ${course.title}`,
    messageFor: (actorName, note) =>
      note
        ? `${actorName} approved this course. You can publish it now. Note: ${note}`
        : `${actorName} approved this course. You can publish it now.`,
    successMessage: "Course approved",
  });
}

/**
 * Shared path for both reviewer decisions.
 *
 * The assigned reviewer decides; anyone who can moderate courses in the tenant may also
 * decide, so a review is never stuck behind an absent or deactivated reviewer.
 */
async function decideReview(req, res, next, config) {
  try {
    const actor = getActor(req);
    if (!isObjectId(req.params.id)) return sendError(res, "COURSE_INVALID_ID", 400);

    const course = await Course.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!course) return sendError(res, "COURSE_NOT_FOUND", 404);

    const isAssignedReviewer = String(course.review?.reviewerId || "") === String(actor.id);
    if (!isAssignedReviewer && !canModerateCourses(actor)) {
      return sendError(res, "COURSE_REVIEW_NOT_ASSIGNED", 403);
    }

    if (course.review?.status !== "PENDING") {
      return sendError(res, "COURSE_REVIEW_NOT_PENDING", 409);
    }

    const note = String(req.body.note || "").trim();
    const actorName = await actorNameFor(actor.id);
    const now = new Date();

    const updated = await Course.findOneAndUpdate(
      { _id: course._id, tenantId: req.tenantId },
      {
        $set: {
          "review.status": config.status,
          "review.decidedBy": actor.id,
          "review.decidedAt": now,
          "review.note": note,
          updated_by: actor.id,
        },
        $push: {
          "review.history": {
            action: config.action,
            actorId: actor.id,
            actorName,
            note,
            at: now,
          },
        },
      },
      { new: true }
    );

    await notifyUsers({
      tenantId: req.tenantId,
      userIds: [course.instructorId, course.review?.submittedBy],
      type: config.type,
      title: config.titleFor(course),
      message: config.messageFor(actorName, note),
      actorId: actor.id,
      actorName,
      courseId: course._id,
      link: `/instructor/courses/${course._id}`,
    });

    return sendSuccess(res, config.successMessage, serializeReview(updated));
  } catch (err) {
    return next(err);
  }
}

/** Soft delete - archived courses stay queryable for existing enrollments and reporting. */
export async function deleteCourse(req, res, next) {
  try {
    const actor = getActor(req);
    const result = await loadWritableCourse(req.params.id, req.tenantId, actor);
    if (result.error) return sendError(res, result.error, result.status);

    await Course.updateOne(
      { _id: result.course._id, tenantId: req.tenantId },
      { $set: { status: "ARCHIVED", publishedAt: null, updated_by: actor.id } }
    );

    return sendSuccess(res, "Course archived successfully", { id: String(result.course._id) });
  } catch (err) {
    return next(err);
  }
}

/* ------------------------------------------------------------------ *
 * Moderation (tenant admin / org admin)
 * ------------------------------------------------------------------ */

export async function blockCourse(req, res, next) {
  try {
    const actor = getActor(req);
    if (!canModerateCourses(actor)) return sendError(res, "GENERAL_FORBIDDEN", 403);

    const reason = String(req.body?.reason || "").trim();
    if (!reason) return sendError(res, "COURSE_BLOCK_REASON_REQUIRED", 400);

    const updated = await Course.findOneAndUpdate(
      { _id: req.params.id, tenantId: req.tenantId },
      {
        $set: {
          "moderation.isBlocked": true,
          "moderation.reason": reason,
          "moderation.blockedBy": actor.id,
          "moderation.blockedAt": new Date(),
          updated_by: actor.id,
        },
      },
      { new: true }
    ).populate("instructorId", "name email");

    if (!updated) return sendError(res, "COURSE_NOT_FOUND", 404);

    return sendSuccess(res, "Course blocked", await serializeCourse(updated, { actor }));
  } catch (err) {
    return next(err);
  }
}

export async function unblockCourse(req, res, next) {
  try {
    const actor = getActor(req);
    if (!canModerateCourses(actor)) return sendError(res, "GENERAL_FORBIDDEN", 403);

    const updated = await Course.findOneAndUpdate(
      { _id: req.params.id, tenantId: req.tenantId },
      {
        $set: {
          "moderation.isBlocked": false,
          "moderation.reason": "",
          "moderation.blockedBy": null,
          "moderation.blockedAt": null,
          updated_by: actor.id,
        },
      },
      { new: true }
    ).populate("instructorId", "name email");

    if (!updated) return sendError(res, "COURSE_NOT_FOUND", 404);

    return sendSuccess(res, "Course unblocked", await serializeCourse(updated, { actor }));
  } catch (err) {
    return next(err);
  }
}

/* ------------------------------------------------------------------ *
 * Thumbnail
 * ------------------------------------------------------------------ */

export async function uploadCourseThumbnail(req, res, next) {
  try {
    if (storageGuard(res)) return undefined;
    if (!req.file) return sendError(res, "UPLOAD_FILE_REQUIRED", 400);

    const actor = getActor(req);
    const result = await loadWritableCourse(req.params.id, req.tenantId, actor);
    if (result.error) return sendError(res, result.error, result.status);

    const course = result.course;
    const previousKey = course.thumbnailKey;

    const key = buildCourseKey({
      tenantId: req.tenantId,
      courseId: String(course._id),
      scope: "thumbnail",
      filename: req.file.originalname,
      mimeType: req.file.mimetype,
    });

    await putObject({ key, body: req.file.buffer, mimeType: req.file.mimetype });

    const updated = await Course.findOneAndUpdate(
      { _id: course._id, tenantId: req.tenantId },
      { $set: { thumbnailKey: key, thumbnail: "", updated_by: actor.id } },
      { new: true }
    ).populate("instructorId", "name email");

    if (previousKey && previousKey !== key) await deleteObject(previousKey);
    // Track storage usage for plan enforcement
    await incrementTenantStorage(req.tenantId, req.file.size);

    return sendSuccess(res, "Thumbnail updated", await serializeCourse(updated, { actor }), 201);
  } catch (err) {
    return next(err);
  }
}

/* ------------------------------------------------------------------ *
 * Modules
 * ------------------------------------------------------------------ */

export async function addModule(req, res, next) {
  try {
    const actor = getActor(req);
    const result = await loadWritableCourse(req.params.id, req.tenantId, actor);
    if (result.error) return sendError(res, result.error, result.status);

    const course = result.course;
    const order =
      req.body.order ?? (await Module.countDocuments({ courseId: course._id, tenantId: req.tenantId }));

    const module = await Module.create({
      courseId: course._id,
      tenantId: req.tenantId,
      title: req.body.title,
      description: req.body.description,
      order,
    });

    await Course.updateOne({ _id: course._id }, { $addToSet: { modules: module._id } });

    return sendSuccess(
      res,
      "Module added successfully",
      { id: String(module._id), title: module.title, description: module.description, order: module.order, lessons: [] },
      201
    );
  } catch (err) {
    return next(err);
  }
}

/** Resolve a module plus its parent course, enforcing tenant + ownership. */
async function loadWritableModule(moduleId, tenantId, actor) {
  if (!isObjectId(moduleId)) return { error: "MODULE_NOT_FOUND", status: 404 };

  const module = await Module.findOne({ _id: moduleId, tenantId });
  if (!module) return { error: "MODULE_NOT_FOUND", status: 404 };

  const result = await loadWritableCourse(module.courseId, tenantId, actor);
  if (result.error) return result;

  return { module, course: result.course };
}

export async function updateModule(req, res, next) {
  try {
    const actor = getActor(req);
    const result = await loadWritableModule(req.params.moduleId, req.tenantId, actor);
    if (result.error) return sendError(res, result.error, result.status);

    const updates = {};
    for (const key of ["title", "description", "order"]) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    const updated = await Module.findOneAndUpdate(
      { _id: result.module._id, tenantId: req.tenantId },
      { $set: updates },
      { new: true }
    );

    return sendSuccess(res, "Module updated successfully", {
      id: String(updated._id),
      title: updated.title,
      description: updated.description,
      order: updated.order,
    });
  } catch (err) {
    return next(err);
  }
}

export async function deleteModule(req, res, next) {
  try {
    const actor = getActor(req);
    const result = await loadWritableModule(req.params.moduleId, req.tenantId, actor);
    if (result.error) return sendError(res, result.error, result.status);

    const { module, course } = result;

    // Collect object keys before the documents disappear, then purge from B2.
    const lessons = await Lesson.find({ moduleId: module._id, tenantId: req.tenantId }).select(
      "contentKey attachments"
    );
    const keys = lessons.flatMap((l) => [
      l.contentKey,
      ...(l.attachments || []).map((a) => a.key),
    ]);

    await Lesson.deleteMany({ moduleId: module._id, tenantId: req.tenantId });
    await Course.updateOne({ _id: course._id }, { $pull: { modules: module._id } });
    await Module.deleteOne({ _id: module._id, tenantId: req.tenantId });

    await deleteObjects(keys);
    await refreshCourseStats(course._id, req.tenantId);

    return sendSuccess(res, "Module deleted successfully", { id: String(module._id) });
  } catch (err) {
    return next(err);
  }
}

export async function reorderModules(req, res, next) {
  try {
    const actor = getActor(req);
    const result = await loadWritableCourse(req.params.id, req.tenantId, actor);
    if (result.error) return sendError(res, result.error, result.status);

    const requested = (req.body.moduleIds || []).map(String);
    const existing = await Module.find({ courseId: result.course._id, tenantId: req.tenantId }).select("_id");
    const existingIds = existing.map((m) => String(m._id));

    // Reject partial lists — a missing id would leave stale order values behind.
    const sameSet =
      requested.length === existingIds.length &&
      new Set(requested).size === requested.length &&
      requested.every((id) => existingIds.includes(id));
    if (!sameSet) return sendError(res, "MODULE_ORDER_INVALID", 400);

    await Module.bulkWrite(
      requested.map((id, index) => ({
        updateOne: { filter: { _id: id, tenantId: req.tenantId }, update: { $set: { order: index } } },
      }))
    );

    return sendSuccess(res, "Modules reordered", { moduleIds: requested });
  } catch (err) {
    return next(err);
  }
}

/* ------------------------------------------------------------------ *
 * Lessons
 * ------------------------------------------------------------------ */

export async function addLesson(req, res, next) {
  try {
    const actor = getActor(req);
    const result = await loadWritableModule(req.params.moduleId, req.tenantId, actor);
    if (result.error) return sendError(res, result.error, result.status);

    const { module, course } = result;
    const order =
      req.body.order ?? (await Lesson.countDocuments({ moduleId: module._id, tenantId: req.tenantId }));

    const lesson = await Lesson.create({
      moduleId: module._id,
      courseId: course._id,
      tenantId: req.tenantId,
      title: req.body.title,
      content: req.body.content,
      videoUrl: req.body.videoUrl,
      type: req.body.type,
      order,
      duration: req.body.duration,
      isPreview: req.body.isPreview,
      assignmentInstructions: req.body.assignmentInstructions,
    });

    await Module.updateOne({ _id: module._id }, { $addToSet: { lessons: lesson._id } });
    await refreshCourseStats(course._id, req.tenantId);

    return sendSuccess(
      res,
      "Lesson added successfully",
      serializeLesson(lesson, { canManage: true, hasAccess: true }),
      201
    );
  } catch (err) {
    return next(err);
  }
}

async function loadWritableLesson(lessonId, tenantId, actor) {
  if (!isObjectId(lessonId)) return { error: "LESSON_NOT_FOUND", status: 404 };

  const lesson = await Lesson.findOne({ _id: lessonId, tenantId });
  if (!lesson) return { error: "LESSON_NOT_FOUND", status: 404 };

  const result = await loadWritableCourse(lesson.courseId, tenantId, actor);
  if (result.error) return result;

  return { lesson, course: result.course };
}

export async function updateLesson(req, res, next) {
  try {
    const actor = getActor(req);
    const result = await loadWritableLesson(req.params.lessonId, req.tenantId, actor);
    if (result.error) return sendError(res, result.error, result.status);

    const updates = {};
    for (const key of [
      "title",
      "content",
      "videoUrl",
      "type",
      "order",
      "duration",
      "isPreview",
      "assignmentInstructions",
    ]) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    const updated = await Lesson.findOneAndUpdate(
      { _id: result.lesson._id, tenantId: req.tenantId },
      { $set: updates },
      { new: true }
    );

    if (updates.duration !== undefined) {
      await refreshCourseStats(result.course._id, req.tenantId);
    }

    return sendSuccess(
      res,
      "Lesson updated successfully",
      serializeLesson(updated, { canManage: true, hasAccess: true })
    );
  } catch (err) {
    return next(err);
  }
}

export async function deleteLesson(req, res, next) {
  try {
    const actor = getActor(req);
    const result = await loadWritableLesson(req.params.lessonId, req.tenantId, actor);
    if (result.error) return sendError(res, result.error, result.status);

    const { lesson, course } = result;
    const keys = [lesson.contentKey, ...(lesson.attachments || []).map((a) => a.key)];

    await Module.updateOne({ _id: lesson.moduleId }, { $pull: { lessons: lesson._id } });
    await Lesson.deleteOne({ _id: lesson._id, tenantId: req.tenantId });

    await deleteObjects(keys);
    await refreshCourseStats(course._id, req.tenantId);

    return sendSuccess(res, "Lesson deleted successfully", { id: String(lesson._id) });
  } catch (err) {
    return next(err);
  }
}

export async function reorderLessons(req, res, next) {
  try {
    const actor = getActor(req);
    const result = await loadWritableModule(req.params.moduleId, req.tenantId, actor);
    if (result.error) return sendError(res, result.error, result.status);

    const requested = (req.body.lessonIds || []).map(String);
    const existing = await Lesson.find({ moduleId: result.module._id, tenantId: req.tenantId }).select("_id");
    const existingIds = existing.map((l) => String(l._id));

    const sameSet =
      requested.length === existingIds.length &&
      new Set(requested).size === requested.length &&
      requested.every((id) => existingIds.includes(id));
    if (!sameSet) return sendError(res, "LESSON_ORDER_INVALID", 400);

    await Lesson.bulkWrite(
      requested.map((id, index) => ({
        updateOne: { filter: { _id: id, tenantId: req.tenantId }, update: { $set: { order: index } } },
      }))
    );

    return sendSuccess(res, "Lessons reordered", { lessonIds: requested });
  } catch (err) {
    return next(err);
  }
}

/* ------------------------------------------------------------------ *
 * Lesson media
 * ------------------------------------------------------------------ */

/** Small files proxied through the server. Large video uses the presigned flow below. */
export async function uploadLessonContent(req, res, next) {
  try {
    if (storageGuard(res)) return undefined;
    if (!req.file) return sendError(res, "UPLOAD_FILE_REQUIRED", 400);

    const actor = getActor(req);
    const result = await loadWritableLesson(req.params.lessonId, req.tenantId, actor);
    if (result.error) return sendError(res, result.error, result.status);

    const { lesson, course } = result;
    const previousKey = lesson.contentKey;

    const key = buildCourseKey({
      tenantId: req.tenantId,
      courseId: String(course._id),
      scope: "lessons",
      lessonId: String(lesson._id),
      filename: req.file.originalname,
      mimeType: req.file.mimetype,
    });

    await putObject({ key, body: req.file.buffer, mimeType: req.file.mimetype });

    const updated = await Lesson.findOneAndUpdate(
      { _id: lesson._id, tenantId: req.tenantId },
      {
        $set: {
          contentKey: key,
          mimeType: req.file.mimetype,
          fileSize: req.file.size,
          uploadStatus: "READY",
          videoUrl: "",
        },
      },
      { new: true }
    );

    if (previousKey && previousKey !== key) await deleteObject(previousKey);
    // Track storage usage for plan enforcement
    await incrementTenantStorage(req.tenantId, req.file.size);

    return sendSuccess(
      res,
      "Lesson content uploaded",
      serializeLesson(updated, { canManage: true, hasAccess: true }),
      201
    );
  } catch (err) {
    return next(err);
  }
}

/**
 * Step 1 of the direct-upload flow: hand the browser a presigned PUT URL so a large
 * video never transits this server. The lesson is marked PENDING until confirmed.
 */
export async function createLessonUploadUrl(req, res, next) {
  try {
    if (storageGuard(res)) return undefined;

    const actor = getActor(req);
    const result = await loadWritableLesson(req.params.lessonId, req.tenantId, actor);
    if (result.error) return sendError(res, result.error, result.status);

    const { lesson, course } = result;
    const { filename, mimeType } = req.body;

    const key = buildCourseKey({
      tenantId: req.tenantId,
      courseId: String(course._id),
      scope: "lessons",
      lessonId: String(lesson._id),
      filename,
      mimeType,
    });

    const signed = await getSignedUploadUrl({ key, mimeType });

    await Lesson.updateOne(
      { _id: lesson._id, tenantId: req.tenantId },
      { $set: { uploadStatus: "PENDING" } }
    );

    return sendSuccess(res, "Upload URL created", { ...signed, expiresIn: 3600 }, 201);
  } catch (err) {
    return next(err);
  }
}

/** Step 2: verify the object actually landed in the bucket before trusting the key. */
export async function completeLessonUpload(req, res, next) {
  try {
    if (storageGuard(res)) return undefined;

    const actor = getActor(req);
    const result = await loadWritableLesson(req.params.lessonId, req.tenantId, actor);
    if (result.error) return sendError(res, result.error, result.status);

    const { lesson } = result;
    const key = String(req.body.key || "");

    // The key comes back from the client, so re-verify the tenant prefix and that it
    // belongs to this very lesson before writing it to the document.
    const expectedPrefix = `tenants/${req.tenantId}/courses/${lesson.courseId}/lessons/${lesson._id}/`;
    if (!keyBelongsToTenant(key, req.tenantId) || !key.startsWith(expectedPrefix)) {
      return sendError(res, "STORAGE_KEY_INVALID", 400);
    }

    const head = await headObject(key);
    if (!head.exists) {
      await Lesson.updateOne(
        { _id: lesson._id, tenantId: req.tenantId },
        { $set: { uploadStatus: "FAILED" } }
      );
      return sendError(res, "UPLOAD_NOT_COMPLETED", 409);
    }

    const previousKey = lesson.contentKey;
    const updated = await Lesson.findOneAndUpdate(
      { _id: lesson._id, tenantId: req.tenantId },
      {
        $set: {
          contentKey: key,
          mimeType: head.mimeType || req.body.mimeType || "",
          fileSize: head.size,
          uploadStatus: "READY",
          videoUrl: "",
        },
      },
      { new: true }
    );

    if (previousKey && previousKey !== key) await deleteObject(previousKey);
    // Track storage usage for plan enforcement (presigned path: size from B2 head)
    if (head.size) await incrementTenantStorage(req.tenantId, head.size);

    return sendSuccess(
      res,
      "Upload completed",
      serializeLesson(updated, { canManage: true, hasAccess: true })
    );
  } catch (err) {
    return next(err);
  }
}

export async function addLessonAttachment(req, res, next) {
  try {
    if (storageGuard(res)) return undefined;
    if (!req.file) return sendError(res, "UPLOAD_FILE_REQUIRED", 400);

    const actor = getActor(req);
    const result = await loadWritableLesson(req.params.lessonId, req.tenantId, actor);
    if (result.error) return sendError(res, result.error, result.status);

    const { lesson, course } = result;

    const key = buildCourseKey({
      tenantId: req.tenantId,
      courseId: String(course._id),
      scope: "attachments",
      filename: req.file.originalname,
      mimeType: req.file.mimetype,
    });

    await putObject({ key, body: req.file.buffer, mimeType: req.file.mimetype });

    const updated = await Lesson.findOneAndUpdate(
      { _id: lesson._id, tenantId: req.tenantId },
      {
        $push: {
          attachments: {
            name: req.file.originalname,
            key,
            mimeType: req.file.mimetype,
            size: req.file.size,
          },
        },
      },
      { new: true }
    );
    // Track storage usage for plan enforcement
    await incrementTenantStorage(req.tenantId, req.file.size);

    return sendSuccess(
      res,
      "Attachment added",
      serializeLesson(updated, { canManage: true, hasAccess: true }),
      201
    );
  } catch (err) {
    return next(err);
  }
}

export async function deleteLessonAttachment(req, res, next) {
  try {
    const actor = getActor(req);
    const result = await loadWritableLesson(req.params.lessonId, req.tenantId, actor);
    if (result.error) return sendError(res, result.error, result.status);

    const attachment = (result.lesson.attachments || []).find(
      (a) => String(a._id) === String(req.params.attachmentId)
    );
    if (!attachment) return sendError(res, "GENERAL_NOT_FOUND", 404);

    const updated = await Lesson.findOneAndUpdate(
      { _id: result.lesson._id, tenantId: req.tenantId },
      { $pull: { attachments: { _id: attachment._id } } },
      { new: true }
    );

    await deleteObject(attachment.key);

    return sendSuccess(
      res,
      "Attachment removed",
      serializeLesson(updated, { canManage: true, hasAccess: true })
    );
  } catch (err) {
    return next(err);
  }
}

/**
 * Signed playback/download URL for lesson media.
 * Gated on: preview lesson, active enrollment, course ownership, or admin.
 * Query: ?attachmentId=<id> to fetch an attachment instead of the main asset.
 */
export async function getLessonPlaybackUrl(req, res, next) {
  try {
    if (storageGuard(res)) return undefined;

    const actor = getActor(req);
    const tenantId = req.tenantId;

    if (!isObjectId(req.params.lessonId)) return sendError(res, "LESSON_NOT_FOUND", 404);

    const lesson = await Lesson.findOne({ _id: req.params.lessonId, tenantId });
    if (!lesson) return sendError(res, "LESSON_NOT_FOUND", 404);

    const course = await Course.findOne({ _id: lesson.courseId, tenantId });
    if (!course) return sendError(res, "COURSE_NOT_FOUND", 404);

    const canManage =
      canModerateCourses(actor) || String(course.instructorId) === String(actor?.id);

    if (!canManage) {
      if (course.moderation?.isBlocked) return sendError(res, "COURSE_BLOCKED", 403);
      if (course.status !== "PUBLISHED") return sendError(res, "COURSE_NOT_FOUND", 404);
      if (!lesson.isPreview && !(await hasCourseAccess(course, actor, tenantId))) {
        return sendError(res, "ENROLLMENT_REQUIRED", 403);
      }
    }

    let key = lesson.contentKey;
    let downloadFilename;

    if (req.query.attachmentId) {
      const attachment = (lesson.attachments || []).find(
        (a) => String(a._id) === String(req.query.attachmentId)
      );
      if (!attachment) return sendError(res, "GENERAL_NOT_FOUND", 404);
      key = attachment.key;
      downloadFilename = attachment.name;
    }

    if (!key) return sendError(res, "LESSON_NO_CONTENT", 404);
    if (!keyBelongsToTenant(key, tenantId)) return sendError(res, "STORAGE_KEY_INVALID", 400);

    const url = await getSignedDownloadUrl(key, { downloadFilename });

    return sendSuccess(res, "Playback URL created", {
      url,
      expiresIn: DOWNLOAD_URL_TTL_SECONDS,
      expiresAt: new Date(Date.now() + DOWNLOAD_URL_TTL_SECONDS * 1000).toISOString(),
      mimeType: lesson.mimeType || "",
    });
  } catch (err) {
    return next(err);
  }
}

export async function getEnrollableUsers(req, res, next) {
  try {
    const { id: courseId } = req.params;
    
    const course = await Course.findOne({ _id: courseId, tenantId: req.tenantId });
    if (!course) {
      return res.status(404).send(prepareResponseMsg({}, false, "Course not found", 404));
    }

    const tenant = await Tenant.findById(req.tenantId).select("roles");
    const studentRoleIds = (tenant?.roles || [])
      .filter((r) => String(r.legacyApiRole || "").toUpperCase() === "STUDENT")
      .map((r) => r._id);

    if (studentRoleIds.length === 0) {
      return res.status(200).send(prepareResponseMsg([], true, "Students fetched successfully", 200));
    }

    const filter = { tenantId: req.tenantId, roleId: { $in: studentRoleIds }, status: { $ne: "disabled" } };
    
    const users = await User.find(filter).select("_id name email").sort({ name: 1 }).limit(500);
    const data = users.map((u) => ({ id: u._id, name: u.name, email: u.email }));

    return res.status(200).send(prepareResponseMsg(data, true, "Enrollable users fetched successfully", 200));
  } catch (err) {
    return next(err);
  }
}
