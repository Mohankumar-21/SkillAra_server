import UserProgress from "../models/UserProgress.js";
import Enrollment from "../models/Enrollment.js";
import Course from "../models/Course.js";
import Module from "../models/Module.js";
import Lesson from "../models/Lesson.js";
import { prepareResponseMsg, sendError } from "../utils/helper.js";
import { getActor, canModerateCourses } from "../utils/actor.js";
import { getCourseLessonCount, recalculateMastery } from "../utils/progress.js";

async function findEnrollment(userId, courseId, tenantId) {
  return Enrollment.findOne({
    userId,
    courseId,
    tenantId,
    status: { $in: ["ACTIVE", "COMPLETED"] },
  });
}

/**
 * Decide whether the actor may track progress on this course.
 *
 * Instructors reviewing their own course — and admins moderating one — have no
 * enrollment, so a strict enrollment check locked them out of their own content.
 * They are allowed through in "preview" mode: progress is still recorded against
 * their own user id, but the caller can label it so it is not mistaken for a real
 * learner record.
 *
 * @returns {{allowed: boolean, isPreview: boolean}}
 */
async function resolveProgressAccess(actor, courseId, tenantId) {
  const enrollment = await findEnrollment(actor.id, courseId, tenantId);
  if (enrollment) return { allowed: true, isPreview: false };

  const course = await Course.findOne({ _id: courseId, tenantId }).select("instructorId");
  if (!course) return { allowed: false, isPreview: false };

  const canPreview =
    canModerateCourses(actor) || String(course.instructorId) === String(actor.id);

  return { allowed: canPreview, isPreview: canPreview };
}

export async function getCourseProgress(req, res, next) {
  try {
    const { courseId } = req.params;
    const actor = getActor(req);
    const tenantId = req.tenantId;

    const access = await resolveProgressAccess(actor, courseId, tenantId);
    if (!access.allowed) {
      return sendError(res, "ENROLLMENT_REQUIRED", 403);
    }

    // Staff and the course's own instructor may inspect a specific learner's progress.
    const canViewOthers = canModerateCourses(actor) || actor.isInstructor;
    const targetUserId = canViewOthers ? req.query.userId || actor.id : actor.id;

    const progress = await UserProgress.findOne({
      userId: targetUserId,
      courseId,
      tenantId,
    });

    const totalLessons = await getCourseLessonCount(courseId);
    const completedCount = progress?.completedLessons?.length || 0;

    return res.status(200).send(
      prepareResponseMsg(
        {
          courseId,
          userId: targetUserId,
          isPreview: access.isPreview,
          completedLessons: progress?.completedLessons || [],
          quizScores: progress?.quizScores || [],
          assignmentScores: progress?.assignmentScores || [],
          mastery: progress?.overallMasery || 0,
          totalLessons,
          completedCount,
        },
        true,
        "Progress fetched successfully",
        200
      )
    );
  } catch (err) {
    return next(err);
  }
}

export async function getMyProgress(req, res, next) {
  try {
    const actor = getActor(req);

    const progressList = await UserProgress.find({
      userId: actor.id,
      tenantId: req.tenantId,
    }).sort({ updatedAt: -1 });

    const enrollments = await Enrollment.find({
      userId: actor.id,
      tenantId: req.tenantId,
      status: { $in: ["ACTIVE", "COMPLETED"] },
    }).populate("courseId", "title thumbnail thumbnailKey");

    const progressMap = Object.fromEntries(
      progressList.map((p) => [String(p.courseId), p])
    );

    const data = await Promise.all(
      enrollments.map(async (e) => {
        const courseId = e.courseId?._id || e.courseId;
        const progress = progressMap[String(courseId)];
        const totalLessons = await getCourseLessonCount(courseId);
        return {
          courseId,
          course: e.courseId,
          enrollmentStatus: e.status,
          mastery: progress?.overallMasery || 0,
          completedCount: progress?.completedLessons?.length || 0,
          totalLessons,
        };
      })
    );

    return res
      .status(200)
      .send(prepareResponseMsg(data, true, "Progress summary fetched", 200));
  } catch (err) {
    return next(err);
  }
}

export async function markLessonComplete(req, res, next) {
  try {
    const { lessonId } = req.params;
    const actor = getActor(req);
    const userId = actor.id;
    const tenantId = req.tenantId;

    const lesson = await Lesson.findOne({ _id: lessonId, tenantId });
    if (!lesson) {
      return sendError(res, "LESSON_NOT_FOUND", 404);
    }

    // courseId is denormalized onto Lesson; fall back to the module for older rows.
    let courseId = lesson.courseId;
    if (!courseId) {
      const module = await Module.findById(lesson.moduleId);
      if (!module) return sendError(res, "MODULE_NOT_FOUND", 404);
      courseId = module.courseId;
    }

    const access = await resolveProgressAccess(actor, courseId, tenantId);
    if (!access.allowed) {
      return sendError(res, "ENROLLMENT_REQUIRED", 403);
    }

    let progress = await UserProgress.findOne({ userId, courseId, tenantId });
    if (!progress) {
      progress = await UserProgress.create({
        userId,
        courseId,
        tenantId,
        completedLessons: [],
        quizScores: [],
        assignmentScores: [],
      });
    }

    const alreadyDone = progress.completedLessons.some(
      (cl) => String(cl.lessonId) === String(lessonId)
    );
    if (!alreadyDone) {
      progress.completedLessons.push({ lessonId, timestamp: new Date() });
    }

    await recalculateMastery(progress, courseId);
    await progress.save();

    const totalLessons = await getCourseLessonCount(courseId);

    // Only a real enrollment can be flipped to COMPLETED — an instructor walking their
    // own course must not create or complete an enrollment record.
    if (
      !access.isPreview &&
      progress.completedLessons.length >= totalLessons &&
      totalLessons > 0
    ) {
      await Enrollment.updateOne(
        { userId, courseId, tenantId },
        { $set: { status: "COMPLETED", completedAt: new Date() } }
      );
    }

    return res.status(200).send(
      prepareResponseMsg(
        {
          lessonId,
          courseId,
          isPreview: access.isPreview,
          mastery: progress.overallMasery,
          completedCount: progress.completedLessons.length,
          totalLessons,
        },
        true,
        alreadyDone ? "Lesson already completed" : "Lesson marked complete",
        200
      )
    );
  } catch (err) {
    return next(err);
  }
}
