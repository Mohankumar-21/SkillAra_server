import Enrollment from "../models/Enrollment.js";
import Course from "../models/Course.js";
import UserProgress from "../models/UserProgress.js";
import { prepareResponseMsg } from "../utils/helper.js";
import { getCourseLessonCount } from "../utils/progress.js";

function toPublicEnrollment(doc, extras = {}) {
  const e = doc.toObject ? doc.toObject() : doc;
  return {
    id: e._id,
    userId: e.userId,
    courseId: e.courseId,
    tenantId: e.tenantId,
    status: e.status,
    enrolledAt: e.enrolledAt,
    completedAt: e.completedAt,
    created_on: e.created_on,
    ...extras,
  };
}

export async function enrollInCourse(req, res, next) {
  try {
    const { courseId } = req.body;
    const userId = req.user._id;
    const tenantId = req.tenant._id;

    const course = await Course.findOne({
      _id: courseId,
      tenantId,
      status: "PUBLISHED",
    });
    if (!course) {
      return res
        .status(404)
        .send(prepareResponseMsg({}, false, "Course not found or not published", 404));
    }

    if (course.price > 0) {
      return res
        .status(402)
        .send(prepareResponseMsg({}, false, "Payment required for this course", 402));
    }

    const existing = await Enrollment.findOne({ userId, courseId });
    if (existing) {
      if (existing.status === "DROPPED") {
        existing.status = "ACTIVE";
        existing.enrolledAt = new Date();
        existing.completedAt = null;
        await existing.save();
        await Course.updateOne({ _id: courseId }, { $inc: { "stats.enrolledCount": 1 } });
        return res
          .status(200)
          .send(
            prepareResponseMsg(
              { enrollment: toPublicEnrollment(existing) },
              true,
              "Re-enrolled successfully",
              200
            )
          );
      }
      return res
        .status(409)
        .send(prepareResponseMsg({}, false, "Already enrolled in this course", 409));
    }

    const enrollment = await Enrollment.create({
      userId,
      courseId,
      tenantId,
      status: "ACTIVE",
    });

    await UserProgress.findOneAndUpdate(
      { userId, courseId, tenantId },
      { $setOnInsert: { completedLessons: [], quizScores: [], assignmentScores: [] } },
      { upsert: true }
    );

    await Course.updateOne({ _id: courseId }, { $inc: { "stats.enrolledCount": 1 } });

    return res
      .status(201)
      .send(
        prepareResponseMsg(
          { enrollment: toPublicEnrollment(enrollment) },
          true,
          "Enrolled successfully",
          201
        )
      );
  } catch (err) {
    return next(err);
  }
}

export async function getMyEnrollments(req, res, next) {
  try {
    const enrollments = await Enrollment.find({
      userId: req.user._id,
      tenantId: req.tenant._id,
      status: { $in: ["ACTIVE", "COMPLETED"] },
    })
      .populate("courseId", "title description thumbnail price status stats")
      .sort({ enrolledAt: -1 });

    const progressList = await UserProgress.find({
      userId: req.user._id,
      tenantId: req.tenant._id,
    });

    const progressMap = Object.fromEntries(
      progressList.map((p) => [String(p.courseId), p.overallMasery || 0])
    );

    const data = enrollments.map((e) =>
      toPublicEnrollment(e, {
        course: e.courseId,
        mastery: progressMap[String(e.courseId?._id || e.courseId)] || 0,
      })
    );

    return res
      .status(200)
      .send(prepareResponseMsg(data, true, "Enrollments fetched successfully", 200));
  } catch (err) {
    return next(err);
  }
}

export async function getCourseEnrollments(req, res, next) {
  try {
    const { courseId } = req.params;
    const course = await Course.findOne({ _id: courseId, tenantId: req.tenant._id });
    if (!course) {
      return res.status(404).send(prepareResponseMsg({}, false, "Course not found", 404));
    }

    const isTutor = req.user.role === "TUTOR";
    if (isTutor && String(course.instructorId) !== String(req.user._id)) {
      return res.status(403).send(prepareResponseMsg({}, false, "Forbidden", 403));
    }

    const enrollments = await Enrollment.find({
      courseId,
      tenantId: req.tenant._id,
      status: { $in: ["ACTIVE", "COMPLETED"] },
    })
      .populate("userId", "name email role")
      .sort({ enrolledAt: -1 });

    const progressList = await UserProgress.find({ courseId, tenantId: req.tenant._id });
    const progressMap = Object.fromEntries(
      progressList.map((p) => [String(p.userId), p])
    );

    const data = enrollments.map((e) => {
      const progress = progressMap[String(e.userId?._id || e.userId)];
      return toPublicEnrollment(e, {
        user: e.userId,
        mastery: progress?.overallMasery || 0,
        completedLessons: progress?.completedLessons?.length || 0,
      });
    });

    return res
      .status(200)
      .send(prepareResponseMsg(data, true, "Course enrollments fetched", 200));
  } catch (err) {
    return next(err);
  }
}

export async function dropEnrollment(req, res, next) {
  try {
    const enrollment = await Enrollment.findOne({
      _id: req.params.id,
      tenantId: req.tenant._id,
    });
    if (!enrollment) {
      return res.status(404).send(prepareResponseMsg({}, false, "Enrollment not found", 404));
    }

    const isOwner = String(enrollment.userId) === String(req.user._id);
    const isAdmin = req.user.role === "TENANT_ADMIN";
    if (!isOwner && !isAdmin) {
      return res.status(403).send(prepareResponseMsg({}, false, "Forbidden", 403));
    }

    if (enrollment.status === "DROPPED") {
      return res.status(400).send(prepareResponseMsg({}, false, "Already dropped", 400));
    }

    enrollment.status = "DROPPED";
    await enrollment.save();
    await Course.updateOne(
      { _id: enrollment.courseId, "stats.enrolledCount": { $gt: 0 } },
      { $inc: { "stats.enrolledCount": -1 } }
    );

    return res
      .status(200)
      .send(prepareResponseMsg({ ok: true }, true, "Enrollment dropped", 200));
  } catch (err) {
    return next(err);
  }
}
