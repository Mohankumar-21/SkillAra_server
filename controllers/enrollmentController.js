import mongoose from "mongoose";

import Enrollment, { ACCESS_STATUSES, PENDING_STATUSES } from "../models/Enrollment.js";
import Course from "../models/Course.js";
import UserProgress from "../models/UserProgress.js";
import User from "../models/User.js";
import { prepareResponseMsg, sendError } from "../utils/helper.js";
import { getActor, canModerateCourses } from "../utils/actor.js";
import { getCourseLessonCount } from "../utils/progress.js";
import { notifyUsers } from "../services/notificationService.js";
import { usersWithPermission } from "../services/roleService.js";

const isObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));

/** A course is free unless it is explicitly marked as requiring payment. */
function requiresApproval(course) {
  return Boolean(course.requiresPayment) || Number(course.price) > 0;
}

/**
 * Who may decide access requests: anyone granted learners:assign, plus the course's own
 * instructor. Derived from the permission matrix, so custom roles work without a code change.
 */
async function approversFor(tenantId, course) {
  const staff = await usersWithPermission(tenantId, "learners", "assign");
  const ids = staff.map((u) => u.id);
  if (course?.instructorId) ids.push(String(course.instructorId));
  return [...new Set(ids)];
}

async function activateEnrollment(enrollment, { userId, courseId, tenantId }) {
  await UserProgress.findOneAndUpdate(
    { userId, courseId, tenantId },
    { $setOnInsert: { completedLessons: [], quizScores: [], assignmentScores: [] } },
    { upsert: true }
  );
  await Course.updateOne({ _id: courseId }, { $inc: { "stats.enrolledCount": 1 } });
  return enrollment;
}

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

    const needsApproval = requiresApproval(course);
    const nextStatus = needsApproval ? "PENDING_APPROVAL" : "ACTIVE";
    const now = new Date();
    const requestNote = String(req.body.note || "").trim().slice(0, 1000);

    const existing = await Enrollment.findOne({ userId, courseId });
    if (existing) {
      if (ACCESS_STATUSES.includes(existing.status)) {
        return res
          .status(409)
          .send(prepareResponseMsg({}, false, "Already enrolled in this course", 409));
      }
      if (PENDING_STATUSES.includes(existing.status)) {
        return res
          .status(409)
          .send(
            prepareResponseMsg({}, false, "Your access request is already awaiting approval", 409)
          );
      }

      // DROPPED or REJECTED — let them ask again.
      existing.status = nextStatus;
      existing.enrolledAt = now;
      existing.completedAt = null;
      existing.decidedBy = null;
      existing.decidedAt = null;
      existing.decisionNote = "";
      existing.requestedAt = needsApproval ? now : null;
      existing.requestNote = needsApproval ? requestNote : "";
      await existing.save();

      if (!needsApproval) await activateEnrollment(existing, { userId, courseId, tenantId });
      else await notifyApprovers(req, course, actor, requestNote);

      return res.status(200).send(
        prepareResponseMsg(
          { enrollment: toPublicEnrollment(existing) },
          true,
          needsApproval ? "Access requested — an admin will review it" : "Re-enrolled successfully",
          200
        )
      );
    }

    const enrollment = await Enrollment.create({
      userId,
      courseId,
      tenantId,
      status: nextStatus,
      requestedAt: needsApproval ? now : null,
      requestNote: needsApproval ? requestNote : "",
    });

    if (needsApproval) {
      await notifyApprovers(req, course, actor, requestNote);
    } else {
      await activateEnrollment(enrollment, { userId, courseId, tenantId });
    }

    return res.status(201).send(
      prepareResponseMsg(
        { enrollment: toPublicEnrollment(enrollment) },
        true,
        needsApproval ? "Access requested — an admin will review it" : "Enrolled successfully",
        201
      )
    );
  } catch (err) {
    return next(err);
  }
}

async function notifyApprovers(req, course, actor, note) {
  const learner = await User.findById(actor.id).select("name email");
  const learnerName = learner?.name || learner?.email || "A learner";
  await notifyUsers({
    tenantId: req.tenantId,
    userIds: await approversFor(req.tenantId, course),
    type: "enrollment.requested",
    title: `Access requested: ${course.title}`,
    message: note
      ? `${learnerName} asked for access to this paid course. Note: ${note}`
      : `${learnerName} asked for access to this paid course.`,
    actorId: actor.id,
    actorName: learnerName,
    courseId: course._id,
    link: "/admin/enrollment-requests",
  });
}

/**
 * GET /api/enrollments/requests — the staff queue of pending access requests.
 * Defaults to pending; pass ?status=ALL to see decided ones too.
 */
export async function listEnrollmentRequests(req, res, next) {
  try {
    const filter = { tenantId: req.tenantId };
    filter.status =
      String(req.query.status || "").toUpperCase() === "ALL"
        ? { $in: [...PENDING_STATUSES, "ACTIVE", "REJECTED"] }
        : { $in: PENDING_STATUSES };

    const requests = await Enrollment.find(filter)
      .populate("userId", "name email")
      .populate("courseId", "title price currency requiresPayment thumbnail")
      .sort({ requestedAt: -1, created_on: -1 })
      .limit(500);

    return res.status(200).send(
      prepareResponseMsg(
        {
          requests: requests.map((r) =>
            toPublicEnrollment(r, {
              learner: r.userId
                ? { id: String(r.userId._id), name: r.userId.name || "", email: r.userId.email }
                : null,
              course: r.courseId
                ? {
                    id: String(r.courseId._id),
                    title: r.courseId.title,
                    price: r.courseId.price ?? 0,
                    currency: r.courseId.currency || "INR",
                  }
                : null,
              requestNote: r.requestNote || "",
              decisionNote: r.decisionNote || "",
              requestedAt: r.requestedAt,
              decidedAt: r.decidedAt,
            })
          ),
        },
        true,
        "Enrollment requests fetched",
        200
      )
    );
  } catch (err) {
    return next(err);
  }
}

/** POST /api/enrollments/requests/:id/approve|reject */
export async function decideEnrollmentRequest(req, res, next) {
  try {
    const approve = req.path.endsWith("/approve");
    const actor = getActor(req);
    if (!isObjectId(req.params.id)) return sendError(res, "ENROLLMENT_NOT_FOUND", 404);

    const enrollment = await Enrollment.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!enrollment) return sendError(res, "ENROLLMENT_NOT_FOUND", 404);
    if (!PENDING_STATUSES.includes(enrollment.status)) {
      return sendError(res, "ENROLLMENT_NOT_PENDING", 409);
    }

    const note = String(req.body.note || "").trim().slice(0, 1000);
    const course = await Course.findById(enrollment.courseId).select("title instructorId");

    enrollment.status = approve ? "ACTIVE" : "REJECTED";
    enrollment.decidedBy = actor.id;
    enrollment.decidedAt = new Date();
    enrollment.decisionNote = note;
    if (approve) enrollment.enrolledAt = new Date();
    await enrollment.save();

    if (approve) {
      await activateEnrollment(enrollment, {
        userId: enrollment.userId,
        courseId: enrollment.courseId,
        tenantId: req.tenantId,
      });
    }

    const deciderName = (await User.findById(actor.id).select("name email"))?.name || "An admin";
    await notifyUsers({
      tenantId: req.tenantId,
      userIds: [enrollment.userId],
      type: approve ? "enrollment.approved" : "enrollment.rejected",
      title: approve
        ? `Access approved: ${course?.title || "your course"}`
        : `Access declined: ${course?.title || "your course"}`,
      message: approve
        ? note || "You can start the course now."
        : note || "Your request was not approved.",
      actorId: actor.id,
      actorName: deciderName,
      courseId: enrollment.courseId,
      link: approve ? `/learn/${enrollment.courseId}` : `/courses/${enrollment.courseId}`,
    });

    return res
      .status(200)
      .send(
        prepareResponseMsg(
          { enrollment: toPublicEnrollment(enrollment) },
          true,
          approve ? "Access approved" : "Request declined",
          200
        )
      );
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/enrollments/user/:userId — every course one learner is on, for the admin user
 * panel. Includes pending and declined rows so staff can see the whole picture, not just
 * what is currently active.
 */
export async function getUserEnrollments(req, res, next) {
  try {
    if (!isObjectId(req.params.userId)) return sendError(res, "USER_NOT_FOUND", 404);

    const enrollments = await Enrollment.find({
      userId: req.params.userId,
      tenantId: req.tenantId,
      status: { $ne: "DROPPED" },
    })
      .populate("courseId", "title price currency status")
      .sort({ enrolledAt: -1 });

    return res.status(200).send(
      prepareResponseMsg(
        {
          enrollments: enrollments.map((e) =>
            toPublicEnrollment(e, {
              course: e.courseId
                ? {
                    id: String(e.courseId._id),
                    title: e.courseId.title,
                    price: e.courseId.price ?? 0,
                    currency: e.courseId.currency || "INR",
                    status: e.courseId.status,
                  }
                : null,
              grantedByStaff: Boolean(e.grantedByStaff),
              decisionNote: e.decisionNote || "",
            })
          ),
        },
        true,
        "Enrollments fetched",
        200
      )
    );
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/enrollments/grant — staff give one learner access to one course directly,
 * without waiting for them to ask. Used from the admin user detail panel.
 */
export async function grantCourseAccess(req, res, next) {
  try {
    const actor = getActor(req);
    const { userId, courseId } = req.body;

    const course = await Course.findOne({ _id: courseId, tenantId: req.tenantId });
    if (!course) return sendError(res, "COURSE_NOT_FOUND", 404);

    const learner = await User.findOne({ _id: userId, tenantId: req.tenantId }).select("name email");
    if (!learner) return sendError(res, "USER_NOT_FOUND", 404);

    const existing = await Enrollment.findOne({ userId, courseId });
    if (existing && ACCESS_STATUSES.includes(existing.status)) {
      return sendError(res, "ENROLLMENT_ALREADY_ACTIVE", 409);
    }

    const now = new Date();
    const enrollment = existing || new Enrollment({ userId, courseId, tenantId: req.tenantId });
    enrollment.status = "ACTIVE";
    enrollment.enrolledAt = now;
    enrollment.completedAt = null;
    enrollment.decidedBy = actor.id;
    enrollment.decidedAt = now;
    enrollment.grantedByStaff = true;
    await enrollment.save();

    await activateEnrollment(enrollment, {
      userId,
      courseId,
      tenantId: req.tenantId,
    });

    const granterName = (await User.findById(actor.id).select("name email"))?.name || "An admin";
    await notifyUsers({
      tenantId: req.tenantId,
      userIds: [userId],
      type: "enrollment.granted",
      title: `You've been given access to ${course.title}`,
      message: `${granterName} enrolled you in this course.`,
      actorId: actor.id,
      actorName: granterName,
      courseId: course._id,
      link: `/learn/${course._id}`,
    });

    return res
      .status(201)
      .send(
        prepareResponseMsg({ enrollment: toPublicEnrollment(enrollment) }, true, "Access granted", 201)
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
