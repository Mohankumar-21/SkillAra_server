import UserProgress from "../models/UserProgress.js";
import Enrollment from "../models/Enrollment.js";
import Module from "../models/Module.js";
import Lesson from "../models/Lesson.js";
import { prepareResponseMsg } from "../utils/helper.js";
import { getCourseLessonCount, recalculateMastery } from "../utils/progress.js";

async function requireEnrollment(userId, courseId, tenantId) {
  return Enrollment.findOne({
    userId,
    courseId,
    tenantId,
    status: { $in: ["ACTIVE", "COMPLETED"] },
  });
}

export async function getCourseProgress(req, res, next) {
  try {
    const { courseId } = req.params;
    const userId = req.user._id;
    const tenantId = req.tenantId;

    const enrollment = await requireEnrollment(userId, courseId, tenantId);
    if (!enrollment && req.user.role === "STUDENT") {
      return res.status(403).send(prepareResponseMsg({}, false, "Not enrolled in this course", 403));
    }

    const targetUserId =
      req.user.role === "TENANT_ADMIN" || req.user.role === "TUTOR"
        ? req.query.userId || userId
        : userId;

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
    const progressList = await UserProgress.find({
      userId: req.user._id,
      tenantId: req.tenantId,
    }).sort({ updatedAt: -1 });

    const enrollments = await Enrollment.find({
      userId: req.user._id,
      tenantId: req.tenantId,
      status: { $in: ["ACTIVE", "COMPLETED"] },
    }).populate("courseId", "title thumbnail");

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
    const userId = req.user._id;
    const tenantId = req.tenantId;

    const lesson = await Lesson.findById(lessonId);
    if (!lesson) {
      return res.status(404).send(prepareResponseMsg({}, false, "Lesson not found", 404));
    }

    const module = await Module.findById(lesson.moduleId);
    if (!module) {
      return res.status(404).send(prepareResponseMsg({}, false, "Module not found", 404));
    }

    const courseId = module.courseId;
    const enrollment = await requireEnrollment(userId, courseId, tenantId);
    if (!enrollment) {
      return res.status(403).send(prepareResponseMsg({}, false, "Not enrolled in this course", 403));
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
    if (progress.completedLessons.length >= totalLessons && totalLessons > 0) {
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
