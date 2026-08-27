import BookableSlot from "../models/BookableSlot.js";
import Course from "../models/Course.js";
import { createMeeting } from "../services/liveSessionService.js";
import { prepareResponseMsg, sendError } from "../utils/helper.js";
import { getActor, canModerateCourses } from "../utils/actor.js";
import { incrementFeatureUsage } from "../middlewares/checkPlanLimits.js";

export function toPublicSlot(doc) {
  const s = doc.toObject ? doc.toObject() : doc;
  return {
    id: s._id,
    tenantId: s.tenantId,
    sessionType: s.sessionType,
    hostId: s.hostId,
    courseId: s.courseId,
    ticketId: s.ticketId,
    title: s.title,
    startTime: s.startTime,
    endTime: s.endTime,
    status: s.status,
    studentId: s.studentId,
    bookedAt: s.bookedAt,
    meeting: s.status === "BOOKED" || s.status === "COMPLETED" ? s.meeting : undefined,
    feedback: s.feedback,
    created_on: s.created_on,
  };
}

export async function createSlot(req, res, next) {
  try {
    const actor = getActor(req);
    const { sessionType, courseId, title, startTime, endTime } = req.body;

    const start = new Date(startTime);
    const end = new Date(endTime);
    if (!(start < end)) {
      return sendError(res, "SLOT_TIME_INVALID", 400);
    }

    if (courseId) {
      const course = await Course.findOne({ _id: courseId, tenantId: req.tenantId });
      if (!course) return sendError(res, "COURSE_NOT_FOUND", 404);
      if (!canModerateCourses(actor) && String(course.instructorId) !== String(actor.id)) {
        return sendError(res, "COURSE_FORBIDDEN", 403);
      }
    }

    const slot = await BookableSlot.create({
      tenantId: req.tenantId,
      sessionType,
      hostId: actor.id,
      courseId: courseId || null,
      title: title || "",
      startTime: start,
      endTime: end,
      status: "OPEN",
    });

    await incrementFeatureUsage(req.tenantId, "MENTORSHIP_SLOT");

    return res
      .status(201)
      .send(prepareResponseMsg({ slot: toPublicSlot(slot) }, true, "Slot created", 201));
  } catch (err) {
    return next(err);
  }
}

/** GET /api/session-slots — browse open slots to book. */
export async function listOpenSlots(req, res, next) {
  try {
    const { sessionType, courseId, hostId } = req.query;
    const filter = { tenantId: req.tenantId, status: "OPEN", startTime: { $gte: new Date() } };
    if (sessionType) filter.sessionType = sessionType;
    if (courseId) filter.courseId = courseId;
    if (hostId) filter.hostId = hostId;

    const slots = await BookableSlot.find(filter)
      .populate("hostId", "name email")
      .sort({ startTime: 1 })
      .limit(200);

    return res
      .status(200)
      .send(prepareResponseMsg(slots.map(toPublicSlot), true, "Open slots fetched", 200));
  } catch (err) {
    return next(err);
  }
}

/** GET /api/session-slots/all — every slot in the tenant, any status. Staff oversight only. */
export async function getAllSlots(req, res, next) {
  try {
    const { sessionType, status, courseId, hostId } = req.query;
    const filter = { tenantId: req.tenantId };
    if (sessionType) filter.sessionType = sessionType;
    if (status) filter.status = status;
    if (courseId) filter.courseId = courseId;
    if (hostId) filter.hostId = hostId;

    const slots = await BookableSlot.find(filter)
      .populate("hostId", "name email")
      .populate("studentId", "name email")
      .sort({ startTime: -1 })
      .limit(500);

    return res.status(200).send(prepareResponseMsg(slots.map(toPublicSlot), true, "Slots fetched", 200));
  } catch (err) {
    return next(err);
  }
}

/** GET /api/session-slots/my — slots the actor hosts or has booked. */
export async function getMySlots(req, res, next) {
  try {
    const actor = getActor(req);
    const { sessionType } = req.query;
    const filter = {
      tenantId: req.tenantId,
      $or: [{ hostId: actor.id }, { studentId: actor.id }],
    };
    if (sessionType) filter.sessionType = sessionType;

    const slots = await BookableSlot.find(filter)
      .populate("hostId", "name email")
      .populate("studentId", "name email")
      .sort({ startTime: -1 })
      .limit(200);

    return res.status(200).send(prepareResponseMsg(slots.map(toPublicSlot), true, "Slots fetched", 200));
  } catch (err) {
    return next(err);
  }
}

export async function bookSlot(req, res, next) {
  try {
    const actor = getActor(req);
    const slot = await BookableSlot.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!slot) return sendError(res, "SLOT_NOT_FOUND", 404);

    if (slot.status !== "OPEN") return sendError(res, "SLOT_NOT_AVAILABLE", 409);
    if (String(slot.hostId) === String(actor.id)) return sendError(res, "SLOT_SELF_BOOK", 400);
    if (slot.startTime <= new Date()) return sendError(res, "SLOT_NOT_AVAILABLE", 409);

    const meeting = createMeeting({ topic: slot.title || slot.sessionType });

    slot.studentId = actor.id;
    slot.status = "BOOKED";
    slot.bookedAt = new Date();
    slot.meeting = meeting;
    await slot.save();

    return res.status(200).send(prepareResponseMsg({ slot: toPublicSlot(slot) }, true, "Slot booked", 200));
  } catch (err) {
    return next(err);
  }
}

export async function cancelSlot(req, res, next) {
  try {
    const actor = getActor(req);
    const slot = await BookableSlot.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!slot) return sendError(res, "SLOT_NOT_FOUND", 404);

    const isHost = String(slot.hostId) === String(actor.id);
    const isStudent = slot.studentId && String(slot.studentId) === String(actor.id);
    if (!isHost && !isStudent && !canModerateCourses(actor)) {
      return sendError(res, "GENERAL_FORBIDDEN", 403);
    }
    if (slot.status === "CANCELLED" || slot.status === "COMPLETED") {
      return sendError(res, "SLOT_NOT_AVAILABLE", 409);
    }

    slot.status = "CANCELLED";
    slot.cancelReason = req.body?.reason || "";
    slot.cancelledBy = actor.id;
    await slot.save();

    return res.status(200).send(prepareResponseMsg({ slot: toPublicSlot(slot) }, true, "Slot cancelled", 200));
  } catch (err) {
    return next(err);
  }
}

export async function completeSlot(req, res, next) {
  try {
    const actor = getActor(req);
    const slot = await BookableSlot.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!slot) return sendError(res, "SLOT_NOT_FOUND", 404);

    if (String(slot.hostId) !== String(actor.id) && !canModerateCourses(actor)) {
      return sendError(res, "GENERAL_FORBIDDEN", 403);
    }
    if (slot.status !== "BOOKED") return sendError(res, "SLOT_NOT_AVAILABLE", 409);

    slot.status = "COMPLETED";
    const { rating, notes, strengths, improvements } = req.body || {};
    if (rating || notes || strengths || improvements) {
      slot.feedback = {
        rating,
        notes: notes || "",
        strengths: strengths || [],
        improvements: improvements || [],
        givenBy: actor.id,
        givenAt: new Date(),
      };
    }
    await slot.save();

    return res.status(200).send(prepareResponseMsg({ slot: toPublicSlot(slot) }, true, "Slot marked complete", 200));
  } catch (err) {
    return next(err);
  }
}

export async function deleteSlot(req, res, next) {
  try {
    const actor = getActor(req);
    const slot = await BookableSlot.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!slot) return sendError(res, "SLOT_NOT_FOUND", 404);

    if (String(slot.hostId) !== String(actor.id) && !canModerateCourses(actor)) {
      return sendError(res, "GENERAL_FORBIDDEN", 403);
    }
    if (slot.status !== "OPEN") return sendError(res, "SLOT_NOT_AVAILABLE", 409);

    await slot.deleteOne();
    return res.status(200).send(prepareResponseMsg({ ok: true }, true, "Slot deleted", 200));
  } catch (err) {
    return next(err);
  }
}
