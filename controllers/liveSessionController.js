import LiveSession from "../models/LiveSession.js";
import Course from "../models/Course.js";
import Enrollment from "../models/Enrollment.js";
import { createMeeting } from "../services/liveSessionService.js";
import { prepareResponseMsg, sendError } from "../utils/helper.js";
import { getActor, canModerateCourses } from "../utils/actor.js";

function toPublicSession(doc, { includeMeeting = false } = {}) {
  const s = doc.toObject ? doc.toObject() : doc;
  const out = {
    id: s._id,
    courseId: s.courseId,
    instructorId: s.instructorId,
    title: s.title,
    description: s.description,
    scheduledStart: s.scheduledStart,
    scheduledEnd: s.scheduledEnd,
    status: s.status,
    recordingUrl: s.recordingUrl,
    created_on: s.created_on,
  };
  if (includeMeeting) out.meeting = s.meeting;
  return out;
}

async function assertCourseAccess(actor, course) {
  if (canModerateCourses(actor)) return true;
  return String(course.instructorId) === String(actor.id);
}

export async function createLiveSession(req, res, next) {
  try {
    const actor = getActor(req);
    const { courseId, title, description, scheduledStart, scheduledEnd } = req.body;

    const course = await Course.findOne({ _id: courseId, tenantId: req.tenantId });
    if (!course) return sendError(res, "COURSE_NOT_FOUND", 404);
    if (!(await assertCourseAccess(actor, course))) return sendError(res, "COURSE_FORBIDDEN", 403);

    const start = new Date(scheduledStart);
    const end = new Date(scheduledEnd);
    if (!(start < end)) return sendError(res, "SLOT_TIME_INVALID", 400);

    const meeting = createMeeting({ topic: title });

    const session = await LiveSession.create({
      tenantId: req.tenantId,
      courseId,
      instructorId: course.instructorId,
      title,
      description: description || "",
      scheduledStart: start,
      scheduledEnd: end,
      meeting,
    });

    return res
      .status(201)
      .send(
        prepareResponseMsg(
          { session: toPublicSession(session, { includeMeeting: true }) },
          true,
          "Live session scheduled",
          201
        )
      );
  } catch (err) {
    return next(err);
  }
}

/** GET /api/live-sessions — live sessions visible to the caller. Staff see every session
 *  in the tenant; instructors see sessions on courses they teach; students see sessions
 *  on courses they're enrolled in. Backs both staff oversight and the Live Sessions hub. */
export async function getAllLiveSessions(req, res, next) {
  try {
    const actor = getActor(req);
    const { status, courseId } = req.query;
    const filter = { tenantId: req.tenantId };

    if (canModerateCourses(actor)) {
      if (status) filter.status = status;
      if (courseId) filter.courseId = courseId;
    } else if (actor.isInstructor) {
      const courses = await Course.find({ tenantId: req.tenantId, instructorId: actor.id }).select("_id");
      const courseIds = courses.map((c) => c._id);
      filter.courseId = courseId ? courseIds.filter((id) => String(id) === courseId) : { $in: courseIds };
      if (status) filter.status = status;
    } else {
      const enrollments = await Enrollment.find({
        userId: actor.id,
        tenantId: req.tenantId,
        status: { $in: ["ACTIVE", "COMPLETED"] },
      }).select("courseId");
      const courseIds = enrollments.map((e) => e.courseId);
      filter.courseId = courseId ? courseIds.filter((id) => String(id) === courseId) : { $in: courseIds };
      if (status) filter.status = status;
    }

    const sessions = await LiveSession.find(filter)
      .populate("courseId", "title")
      .populate("instructorId", "name email")
      .sort({ scheduledStart: -1 })
      .limit(500);

    return res
      .status(200)
      .send(prepareResponseMsg(sessions.map((s) => toPublicSession(s)), true, "Live sessions fetched", 200));
  } catch (err) {
    return next(err);
  }
}

export async function listCourseLiveSessions(req, res, next) {
  try {
    const { courseId } = req.params;
    const course = await Course.findOne({ _id: courseId, tenantId: req.tenantId });
    if (!course) return sendError(res, "COURSE_NOT_FOUND", 404);

    const sessions = await LiveSession.find({ courseId, tenantId: req.tenantId }).sort({
      scheduledStart: -1,
    });

    return res
      .status(200)
      .send(prepareResponseMsg(sessions.map((s) => toPublicSession(s)), true, "Live sessions fetched", 200));
  } catch (err) {
    return next(err);
  }
}

/** GET /:id/join — enrollment-gated hand-off of the meeting room. */
export async function joinLiveSession(req, res, next) {
  try {
    const actor = getActor(req);
    const session = await LiveSession.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!session) return sendError(res, "LIVE_SESSION_NOT_FOUND", 404);
    if (session.status === "CANCELLED") return sendError(res, "LIVE_SESSION_CANCELLED", 409);

    const isHost = String(session.instructorId) === String(actor.id);
    if (!isHost && !canModerateCourses(actor)) {
      const enrolled = await Enrollment.exists({
        userId: actor.id,
        courseId: session.courseId,
        tenantId: req.tenantId,
        status: { $in: ["ACTIVE", "COMPLETED"] },
      });
      if (!enrolled) return sendError(res, "ENROLLMENT_REQUIRED", 403);
    }

    if (session.status === "SCHEDULED") {
      session.status = "LIVE";
      await session.save();
    }

    return res.status(200).send(
      prepareResponseMsg(
        { session: toPublicSession(session, { includeMeeting: true }), isHost },
        true,
        "Joining session",
        200
      )
    );
  } catch (err) {
    return next(err);
  }
}

export async function endLiveSession(req, res, next) {
  try {
    const actor = getActor(req);
    const session = await LiveSession.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!session) return sendError(res, "LIVE_SESSION_NOT_FOUND", 404);
    if (String(session.instructorId) !== String(actor.id) && !canModerateCourses(actor)) {
      return sendError(res, "GENERAL_FORBIDDEN", 403);
    }

    session.status = "ENDED";
    if (req.body?.recordingUrl) session.recordingUrl = req.body.recordingUrl;
    await session.save();

    return res.status(200).send(prepareResponseMsg({ session: toPublicSession(session) }, true, "Session ended", 200));
  } catch (err) {
    return next(err);
  }
}

export async function cancelLiveSession(req, res, next) {
  try {
    const actor = getActor(req);
    const session = await LiveSession.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!session) return sendError(res, "LIVE_SESSION_NOT_FOUND", 404);
    if (String(session.instructorId) !== String(actor.id) && !canModerateCourses(actor)) {
      return sendError(res, "GENERAL_FORBIDDEN", 403);
    }
    if (session.status === "ENDED" || session.status === "CANCELLED") {
      return sendError(res, "LIVE_SESSION_CANCELLED", 409);
    }

    session.status = "CANCELLED";
    session.cancelReason = req.body?.reason || "";
    await session.save();

    return res.status(200).send(prepareResponseMsg({ session: toPublicSession(session) }, true, "Session cancelled", 200));
  } catch (err) {
    return next(err);
  }
}
