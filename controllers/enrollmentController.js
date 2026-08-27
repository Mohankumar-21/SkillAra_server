import Enrollment from "../models/Enrollment.js";
import Course from "../models/Course.js";
import UserProgress from "../models/UserProgress.js";
import User from "../models/User.js";
import { prepareResponseMsg, sendError } from "../utils/helper.js";
import { getActor, canModerateCourses } from "../utils/actor.js";
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
    const actor = getActor(req);
    const userId = actor.id;
    const tenantId = req.tenantId;

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

    const isPaid = course.requiresPayment;
    const existing = await Enrollment.findOne({ userId, courseId });
    if (existing) {
        if (existing.status === "DROPPED") {
          existing.status = isPaid ? "PENDING_PAYMENT" : "ACTIVE";
          existing.enrolledAt = new Date();
          existing.completedAt = null;
          await existing.save();
          if (!isPaid) {
            await Course.updateOne({ _id: courseId }, { $inc: { "stats.enrolledCount": 1 } });
          }
          return res
            .status(200)
            .send(
              prepareResponseMsg(
                { enrollment: toPublicEnrollment(existing), paymentUrl: isPaid ? "https://sandbox.checkout.example.com/pay" : null },
                true,
                isPaid ? "Payment required to activate enrollment" : "Re-enrolled successfully",
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
      status: isPaid ? "PENDING_PAYMENT" : "ACTIVE",
    });

    if (!isPaid) {
      await UserProgress.findOneAndUpdate(
        { userId, courseId, tenantId },
        { $setOnInsert: { completedLessons: [], quizScores: [], assignmentScores: [] } },
        { upsert: true }
      );
      await Course.updateOne({ _id: courseId }, { $inc: { "stats.enrolledCount": 1 } });
    }

    return res
      .status(201)
      .send(
        prepareResponseMsg(
          { enrollment: toPublicEnrollment(enrollment), paymentUrl: isPaid ? "https://sandbox.checkout.example.com/pay" : null },
          true,
          isPaid ? "Payment required to activate enrollment" : "Enrolled successfully",
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
      userId: getActor(req).id,
      tenantId: req.tenantId,
      status: { $in: ["ACTIVE", "COMPLETED"] },
    })
      .populate("courseId", "title description thumbnail price status stats")
      .sort({ enrolledAt: -1 });

    const progressList = await UserProgress.find({
      userId: getActor(req).id,
      tenantId: req.tenantId,
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
    const course = await Course.findOne({ _id: courseId, tenantId: req.tenantId });
    if (!course) {
      return res.status(404).send(prepareResponseMsg({}, false, "Course not found", 404));
    }

    const actor = getActor(req);
    if (actor.isInstructor && String(course.instructorId) !== String(actor.id)) {
      return res.status(403).send(prepareResponseMsg({}, false, "Forbidden", 403));
    }

    const enrollments = await Enrollment.find({
      courseId,
      tenantId: req.tenantId,
      status: { $in: ["ACTIVE", "COMPLETED"] },
    })
      .populate("userId", "name email role")
      .sort({ enrolledAt: -1 });

    const progressList = await UserProgress.find({ courseId, tenantId: req.tenantId });
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
      tenantId: req.tenantId,
    });
    if (!enrollment) {
      return res.status(404).send(prepareResponseMsg({}, false, "Enrollment not found", 404));
    }

    const actor = getActor(req);
    const isOwner = String(enrollment.userId) === String(actor.id);
    let isCourseInstructor = false;
    if (!isOwner && !canModerateCourses(actor) && actor.isInstructor) {
      const course = await Course.findOne({ _id: enrollment.courseId, tenantId: req.tenantId }).select(
        "instructorId"
      );
      isCourseInstructor = Boolean(course && String(course.instructorId) === String(actor.id));
    }
    if (!isOwner && !canModerateCourses(actor) && !isCourseInstructor) {
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

/**
 * POST /api/enrollments/bulk
 * Enrol existing tenant users into a course in one action — the "admin adds students
 * and they are already enrolled" path, as opposed to learners enrolling themselves.
 *
 * Allowed for tenant staff, and for an instructor on their own course. Users who are
 * already enrolled are reported as skipped rather than failing the whole request, so
 * the action is safe to repeat.
 */
export async function bulkEnrollStudents(req, res, next) {
  try {
    const actor = getActor(req);
    const tenantId = req.tenantId;
    const { courseId, userIds } = req.body;

    const course = await Course.findOne({ _id: courseId, tenantId });
    if (!course) {
      return sendError(res, "COURSE_NOT_FOUND", 404);
    }

    const isOwner = String(course.instructorId) === String(actor.id);
    if (!canModerateCourses(actor) && !isOwner) {
      return sendError(res, "COURSE_FORBIDDEN", 403);
    }

    // Only users that genuinely belong to this tenant — never trust the id list alone.
    const users = await User.find({
      _id: { $in: userIds },
      tenantId,
      status: { $ne: "disabled" },
    }).select("_id name email");

    const foundIds = new Set(users.map((u) => String(u._id)));
    const notFound = userIds.filter((id) => !foundIds.has(String(id)));

    const existing = await Enrollment.find({
      courseId,
      tenantId,
      userId: { $in: users.map((u) => u._id) },
    }).select("userId status");
    const existingMap = new Map(existing.map((e) => [String(e.userId), e]));

    const enrolled = [];
    const reactivated = [];
    const skipped = [];

    for (const user of users) {
      const prior = existingMap.get(String(user._id));

      if (prior && prior.status !== "DROPPED") {
        skipped.push({ id: String(user._id), email: user.email });
        continue;
      }

      if (prior) {
        await Enrollment.updateOne(
          { _id: prior._id },
          { $set: { status: "ACTIVE", enrolledAt: new Date(), completedAt: null } }
        );
        reactivated.push({ id: String(user._id), email: user.email });
      } else {
        await Enrollment.create({
          userId: user._id,
          courseId,
          tenantId,
          status: "ACTIVE",
        });
        enrolled.push({ id: String(user._id), email: user.email });
      }

      await UserProgress.findOneAndUpdate(
        { userId: user._id, courseId, tenantId },
        { $setOnInsert: { completedLessons: [], quizScores: [], assignmentScores: [] } },
        { upsert: true }
      );
    }

    const added = enrolled.length + reactivated.length;
    if (added > 0) {
      await Course.updateOne({ _id: courseId }, { $inc: { "stats.enrolledCount": added } });
    }

    return res.status(200).send(
      prepareResponseMsg(
        { enrolled, reactivated, skipped, notFound, addedCount: added },
        true,
        added === 1 ? "1 student enrolled" : `${added} students enrolled`,
        200
      )
    );
  } catch (err) {
    return next(err);
  }
}
