import MentorProfile from "../models/MentorProfile.js";
import MentorshipRequest from "../models/MentorshipRequest.js";
import { prepareResponseMsg, sendError } from "../utils/helper.js";
import { getActor, canModerateCourses } from "../utils/actor.js";

function toPublicProfile(doc) {
  const p = doc.toObject ? doc.toObject() : doc;
  return {
    id: p._id,
    userId: p.userId,
    bio: p.bio,
    expertiseTags: p.expertiseTags,
    yearsExperience: p.yearsExperience,
    isActive: p.isActive,
  };
}

function toPublicRequest(doc) {
  const r = doc.toObject ? doc.toObject() : doc;
  return {
    id: r._id,
    mentorId: r.mentorId,
    studentId: r.studentId,
    courseId: r.courseId,
    message: r.message,
    status: r.status,
    respondedAt: r.respondedAt,
    responseNote: r.responseNote,
    created_on: r.created_on,
  };
}

/** Create or edit the caller's own mentor listing. */
export async function upsertMentorProfile(req, res, next) {
  try {
    const actor = getActor(req);
    const { bio, expertiseTags, yearsExperience, isActive } = req.body;

    const profile = await MentorProfile.findOneAndUpdate(
      { userId: actor.id, tenantId: req.tenantId },
      {
        $set: {
          bio: bio ?? "",
          expertiseTags: expertiseTags ?? [],
          yearsExperience: yearsExperience ?? 0,
          isActive: isActive ?? true,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return res
      .status(200)
      .send(prepareResponseMsg({ profile: toPublicProfile(profile) }, true, "Mentor profile saved", 200));
  } catch (err) {
    return next(err);
  }
}

export async function listMentors(req, res, next) {
  try {
    const { expertise } = req.query;
    const filter = { tenantId: req.tenantId, isActive: true };
    if (expertise) filter.expertiseTags = expertise;

    const profiles = await MentorProfile.find(filter).populate("userId", "name email");
    const data = profiles.map((p) => ({ ...toPublicProfile(p), user: p.userId }));

    return res.status(200).send(prepareResponseMsg(data, true, "Mentors fetched", 200));
  } catch (err) {
    return next(err);
  }
}

export async function getMyMentorProfile(req, res, next) {
  try {
    const actor = getActor(req);
    const profile = await MentorProfile.findOne({ userId: actor.id, tenantId: req.tenantId });
    if (!profile) return sendError(res, "MENTOR_PROFILE_NOT_FOUND", 404);

    return res.status(200).send(prepareResponseMsg({ profile: toPublicProfile(profile) }, true, "Profile fetched", 200));
  } catch (err) {
    return next(err);
  }
}

/** A student asks a mentor to take them on — the actual meeting is scheduled separately via BookableSlot. */
export async function requestMentorship(req, res, next) {
  try {
    const actor = getActor(req);
    const { mentorId, courseId, message } = req.body;

    if (String(mentorId) === String(actor.id)) {
      return sendError(res, "MENTORSHIP_SELF_REQUEST", 400);
    }

    const mentor = await MentorProfile.findOne({ userId: mentorId, tenantId: req.tenantId, isActive: true });
    if (!mentor) return sendError(res, "MENTOR_PROFILE_NOT_FOUND", 404);

    const existing = await MentorshipRequest.findOne({
      tenantId: req.tenantId,
      mentorId,
      studentId: actor.id,
      status: "PENDING",
    });
    if (existing) return sendError(res, "MENTORSHIP_REQUEST_EXISTS", 409);

    const request = await MentorshipRequest.create({
      tenantId: req.tenantId,
      mentorId,
      studentId: actor.id,
      courseId: courseId || null,
      message: message || "",
    });

    return res
      .status(201)
      .send(prepareResponseMsg({ request: toPublicRequest(request) }, true, "Mentorship requested", 201));
  } catch (err) {
    return next(err);
  }
}

/** GET /api/mentorship/requests — every request in the tenant, any mentor. Staff oversight only. */
export async function getAllRequests(req, res, next) {
  try {
    const { status, mentorId } = req.query;
    const filter = { tenantId: req.tenantId };
    if (status) filter.status = status;
    if (mentorId) filter.mentorId = mentorId;

    const requests = await MentorshipRequest.find(filter)
      .populate("studentId", "name email")
      .populate("mentorId", "name email")
      .sort({ created_on: -1 })
      .limit(500);

    return res.status(200).send(prepareResponseMsg(requests.map(toPublicRequest), true, "Requests fetched", 200));
  } catch (err) {
    return next(err);
  }
}

/** Requests addressed to the caller as a mentor. */
export async function getIncomingRequests(req, res, next) {
  try {
    const actor = getActor(req);
    const { status } = req.query;
    const filter = { tenantId: req.tenantId, mentorId: actor.id };
    if (status) filter.status = status;

    const requests = await MentorshipRequest.find(filter)
      .populate("studentId", "name email")
      .sort({ created_on: -1 });

    return res.status(200).send(prepareResponseMsg(requests.map(toPublicRequest), true, "Requests fetched", 200));
  } catch (err) {
    return next(err);
  }
}

/** Requests the caller sent as a student. */
export async function getOutgoingRequests(req, res, next) {
  try {
    const actor = getActor(req);
    const requests = await MentorshipRequest.find({ tenantId: req.tenantId, studentId: actor.id })
      .populate("mentorId", "name email")
      .sort({ created_on: -1 });

    return res.status(200).send(prepareResponseMsg(requests.map(toPublicRequest), true, "Requests fetched", 200));
  } catch (err) {
    return next(err);
  }
}

export async function respondToRequest(req, res, next) {
  try {
    const actor = getActor(req);
    const request = await MentorshipRequest.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!request) return sendError(res, "MENTORSHIP_REQUEST_NOT_FOUND", 404);
    if (String(request.mentorId) !== String(actor.id) && !canModerateCourses(actor)) {
      return sendError(res, "GENERAL_FORBIDDEN", 403);
    }
    if (request.status !== "PENDING") return sendError(res, "MENTORSHIP_REQUEST_RESOLVED", 409);

    const { status, responseNote } = req.body;
    request.status = status;
    request.responseNote = responseNote || "";
    request.respondedAt = new Date();
    await request.save();

    return res
      .status(200)
      .send(prepareResponseMsg({ request: toPublicRequest(request) }, true, "Request updated", 200));
  } catch (err) {
    return next(err);
  }
}
