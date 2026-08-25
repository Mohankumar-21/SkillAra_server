import mongoose from "mongoose";
import MentorshipTicket from "../models/MentorshipTicket.js";
import TicketMessage from "../models/TicketMessage.js";
import MentorProfile from "../models/MentorProfile.js";
import BookableSlot from "../models/BookableSlot.js";
import Course from "../models/Course.js";
import { toPublicSlot } from "./bookingController.js";
import { createMeeting } from "../services/liveSessionService.js";
import {
  loadTicketForParticipant,
  postTicketMessage,
  toPublicMessage,
} from "../services/ticketChatService.js";
import { broadcastTicketMessage } from "../services/mentorshipChatSocket.js";
import { prepareResponseMsg, sendError } from "../utils/helper.js";
import { getActor, canModerateCourses } from "../utils/actor.js";
import { writeAuditLog } from "../services/auditLog.js";

function toPublicTicket(doc) {
  const t = doc.toObject ? doc.toObject() : doc;
  return {
    id: t._id,
    tenantId: t.tenantId,
    studentId: t.studentId,
    subject: t.subject,
    description: t.description,
    courseId: t.courseId,
    topicTags: t.topicTags,
    status: t.status,
    mentorId: t.mentorId,
    assignedAt: t.assignedAt,
    assignedBy: t.assignedBy,
    closedAt: t.closedAt,
    closedBy: t.closedBy,
    closeNote: t.closeNote,
    lastMessageAt: t.lastMessageAt,
    studentLastReadAt: t.studentLastReadAt,
    mentorLastReadAt: t.mentorLastReadAt,
    created_on: t.created_on,
  };
}

function isParticipant(ticket, actorId) {
  const isStudent = String(ticket.studentId?._id || ticket.studentId) === String(actorId);
  const isMentor = ticket.mentorId && String(ticket.mentorId?._id || ticket.mentorId) === String(actorId);
  return isStudent || isMentor;
}

/** POST / — a student raises a ticket. It starts unclaimed in the open queue. */
export async function createTicket(req, res, next) {
  try {
    const actor = getActor(req);
    const { subject, description, courseId, topicTags } = req.body;

    if (courseId) {
      const course = await Course.findOne({ _id: courseId, tenantId: req.tenantId });
      if (!course) return sendError(res, "COURSE_NOT_FOUND", 404);
    }

    const ticket = await MentorshipTicket.create({
      tenantId: req.tenantId,
      studentId: actor.id,
      subject,
      description: description || "",
      courseId: courseId || null,
      topicTags: topicTags || [],
    });

    await writeAuditLog({
      actorId: actor.id,
      actorType: "tenant_user",
      action: "mentorship_ticket.created",
      targetId: ticket._id,
      tenantId: req.tenantId,
      ip: req.ip,
      metadata: { subject },
    });

    return res.status(201).send(prepareResponseMsg({ ticket: toPublicTicket(ticket) }, true, "Ticket created", 201));
  } catch (err) {
    return next(err);
  }
}

/** GET /queue — open, unclaimed tickets any mentor can pick up, optionally filtered by topic. */
export async function getQueue(req, res, next) {
  try {
    const { topicTag } = req.query;
    const filter = { tenantId: req.tenantId, status: "OPEN" };
    if (topicTag) filter.topicTags = topicTag;

    const tickets = await MentorshipTicket.find(filter)
      .populate("studentId", "name email")
      .sort({ created_on: 1 })
      .limit(200);

    return res.status(200).send(prepareResponseMsg(tickets.map(toPublicTicket), true, "Queue fetched", 200));
  } catch (err) {
    return next(err);
  }
}

/** GET /mine — student sees tickets they raised; mentor sees tickets assigned to them. */
export async function getMyTickets(req, res, next) {
  try {
    const actor = getActor(req);
    const { status } = req.query;
    const filter = { tenantId: req.tenantId };
    if (actor.isStudent) filter.studentId = actor.id;
    else filter.mentorId = actor.id;
    if (status) filter.status = status;

    const tickets = await MentorshipTicket.find(filter)
      .populate("studentId", "name email")
      .populate("mentorId", "name email")
      .sort({ lastMessageAt: -1, created_on: -1 })
      .limit(200);

    return res.status(200).send(prepareResponseMsg(tickets.map(toPublicTicket), true, "Tickets fetched", 200));
  } catch (err) {
    return next(err);
  }
}

/** GET / — every ticket in the tenant, any status. Staff oversight only. */
export async function getAllTickets(req, res, next) {
  try {
    const { status, mentorId } = req.query;
    const filter = { tenantId: req.tenantId };
    if (status) filter.status = status;
    if (mentorId) filter.mentorId = mentorId;

    const tickets = await MentorshipTicket.find(filter)
      .populate("studentId", "name email")
      .populate("mentorId", "name email")
      .sort({ created_on: -1 })
      .limit(500);

    return res.status(200).send(prepareResponseMsg(tickets.map(toPublicTicket), true, "Tickets fetched", 200));
  } catch (err) {
    return next(err);
  }
}

export async function getTicket(req, res, next) {
  try {
    const actor = getActor(req);
    const ticket = await MentorshipTicket.findOne({ _id: req.params.id, tenantId: req.tenantId })
      .populate("studentId", "name email")
      .populate("mentorId", "name email")
      .populate("closedBy", "name email");
    if (!ticket) return sendError(res, "MENTORSHIP_TICKET_NOT_FOUND", 404);

    if (!isParticipant(ticket, actor.id) && !canModerateCourses(actor)) {
      return sendError(res, "MENTORSHIP_TICKET_NOT_FOUND", 404);
    }

    return res.status(200).send(prepareResponseMsg({ ticket: toPublicTicket(ticket) }, true, "Ticket fetched", 200));
  } catch (err) {
    return next(err);
  }
}

/** PATCH /:id/claim — a mentor picks up an open ticket. First to claim wins. */
export async function claimTicket(req, res, next) {
  try {
    const actor = getActor(req);
    const ticket = await MentorshipTicket.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!ticket) return sendError(res, "MENTORSHIP_TICKET_NOT_FOUND", 404);
    if (ticket.status !== "OPEN") return sendError(res, "MENTORSHIP_TICKET_NOT_OPEN", 409);

    ticket.mentorId = actor.id;
    ticket.status = "ASSIGNED";
    ticket.assignedAt = new Date();
    ticket.assignedBy = "MENTOR_CLAIM";
    ticket.assignedByUserId = null;
    await ticket.save();

    await writeAuditLog({
      actorId: actor.id,
      actorType: "tenant_user",
      action: "mentorship_ticket.claimed",
      targetId: ticket._id,
      tenantId: req.tenantId,
      ip: req.ip,
    });

    return res.status(200).send(prepareResponseMsg({ ticket: toPublicTicket(ticket) }, true, "Ticket claimed", 200));
  } catch (err) {
    return next(err);
  }
}

/** PATCH /:id/assign — staff force-assign or reassign to a specific mentor. */
export async function assignTicket(req, res, next) {
  try {
    const actor = getActor(req);
    const { mentorId } = req.body;
    const ticket = await MentorshipTicket.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!ticket) return sendError(res, "MENTORSHIP_TICKET_NOT_FOUND", 404);
    if (ticket.status === "CLOSED") return sendError(res, "MENTORSHIP_TICKET_CLOSED", 409);

    ticket.mentorId = mentorId;
    ticket.status = "ASSIGNED";
    ticket.assignedAt = new Date();
    ticket.assignedBy = "ADMIN";
    ticket.assignedByUserId = actor.id;
    await ticket.save();

    await writeAuditLog({
      actorId: actor.id,
      actorType: "tenant_user",
      action: "mentorship_ticket.assigned",
      targetId: ticket._id,
      tenantId: req.tenantId,
      ip: req.ip,
      metadata: { mentorId },
    });

    return res.status(200).send(prepareResponseMsg({ ticket: toPublicTicket(ticket) }, true, "Ticket assigned", 200));
  } catch (err) {
    return next(err);
  }
}

/** PATCH /:id/close — the assigned mentor (or staff) closes the ticket out. */
export async function closeTicket(req, res, next) {
  try {
    const actor = getActor(req);
    const { closeNote } = req.body;
    const ticket = await MentorshipTicket.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!ticket) return sendError(res, "MENTORSHIP_TICKET_NOT_FOUND", 404);

    const isAssignedMentor = ticket.mentorId && String(ticket.mentorId) === String(actor.id);
    if (!isAssignedMentor && !canModerateCourses(actor)) return sendError(res, "GENERAL_FORBIDDEN", 403);
    if (ticket.status === "CLOSED") return sendError(res, "MENTORSHIP_TICKET_CLOSED", 409);

    ticket.status = "CLOSED";
    ticket.closedAt = new Date();
    ticket.closedBy = actor.id;
    ticket.closeNote = closeNote || "";
    await ticket.save();

    await writeAuditLog({
      actorId: actor.id,
      actorType: "tenant_user",
      action: "mentorship_ticket.closed",
      targetId: ticket._id,
      tenantId: req.tenantId,
      ip: req.ip,
    });

    return res.status(200).send(prepareResponseMsg({ ticket: toPublicTicket(ticket) }, true, "Ticket closed", 200));
  } catch (err) {
    return next(err);
  }
}

/** PATCH /:id/reopen — staff or the original mentor reopens a closed ticket. */
export async function reopenTicket(req, res, next) {
  try {
    const actor = getActor(req);
    const ticket = await MentorshipTicket.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!ticket) return sendError(res, "MENTORSHIP_TICKET_NOT_FOUND", 404);

    const isAssignedMentor = ticket.mentorId && String(ticket.mentorId) === String(actor.id);
    if (!isAssignedMentor && !canModerateCourses(actor)) return sendError(res, "GENERAL_FORBIDDEN", 403);
    if (ticket.status !== "CLOSED") return sendError(res, "MENTORSHIP_TICKET_NOT_CLOSED", 409);

    ticket.status = "ASSIGNED";
    ticket.closedAt = null;
    ticket.closedBy = null;
    await ticket.save();

    await writeAuditLog({
      actorId: actor.id,
      actorType: "tenant_user",
      action: "mentorship_ticket.reopened",
      targetId: ticket._id,
      tenantId: req.tenantId,
      ip: req.ip,
    });

    return res.status(200).send(prepareResponseMsg({ ticket: toPublicTicket(ticket) }, true, "Ticket reopened", 200));
  } catch (err) {
    return next(err);
  }
}

/** GET /:id/messages — chat history. Also marks the caller's last-read timestamp. */
export async function getMessages(req, res, next) {
  try {
    const actor = getActor(req);
    const ticket = await MentorshipTicket.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!ticket) return sendError(res, "MENTORSHIP_TICKET_NOT_FOUND", 404);

    const isStudent = String(ticket.studentId) === String(actor.id);
    const isMentor = ticket.mentorId && String(ticket.mentorId) === String(actor.id);
    if (!isStudent && !isMentor && !canModerateCourses(actor)) {
      return sendError(res, "MENTORSHIP_TICKET_NOT_FOUND", 404);
    }

    if (isStudent) {
      ticket.studentLastReadAt = new Date();
      await ticket.save();
    } else if (isMentor) {
      ticket.mentorLastReadAt = new Date();
      await ticket.save();
    }

    const messages = await TicketMessage.find({ ticketId: ticket._id }).sort({ created_on: 1 }).limit(500);
    return res.status(200).send(prepareResponseMsg(messages.map(toPublicMessage), true, "Messages fetched", 200));
  } catch (err) {
    return next(err);
  }
}

/** POST /:id/messages — REST fallback for sending a chat message (the socket path is primary). */
export async function postMessage(req, res, next) {
  try {
    const actor = getActor(req);
    const { body } = req.body;
    const found = await loadTicketForParticipant(req.tenantId, actor.id, req.params.id);
    if (!found) return sendError(res, "MENTORSHIP_TICKET_NOT_FOUND", 404);

    let message;
    try {
      message = await postTicketMessage({ ticket: found.ticket, senderId: actor.id, senderRole: found.role, body });
    } catch (err) {
      if (err.code === "MENTORSHIP_TICKET_CLOSED") return sendError(res, "MENTORSHIP_TICKET_CLOSED", 409);
      throw err;
    }

    const payload = toPublicMessage(message);
    broadcastTicketMessage(found.ticket._id, payload);

    return res.status(201).send(prepareResponseMsg({ message: payload }, true, "Message sent", 201));
  } catch (err) {
    return next(err);
  }
}

/** POST /:id/sessions — the assigned mentor schedules a session directly against this ticket.
 *  Unlike the public browse/book flow, this creates a slot pre-booked to the ticket's student. */
export async function createTicketSession(req, res, next) {
  try {
    const actor = getActor(req);
    const { title, startTime, endTime } = req.body;
    const ticket = await MentorshipTicket.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!ticket) return sendError(res, "MENTORSHIP_TICKET_NOT_FOUND", 404);
    if (!ticket.mentorId || String(ticket.mentorId) !== String(actor.id)) {
      return sendError(res, "GENERAL_FORBIDDEN", 403);
    }
    if (ticket.status !== "ASSIGNED") return sendError(res, "MENTORSHIP_TICKET_NOT_ASSIGNED", 409);

    const start = new Date(startTime);
    const end = new Date(endTime);
    if (!(start < end)) return sendError(res, "SLOT_TIME_INVALID", 400);

    const meeting = createMeeting({ topic: title || ticket.subject });

    const slot = await BookableSlot.create({
      tenantId: req.tenantId,
      sessionType: "MENTORSHIP",
      hostId: actor.id,
      ticketId: ticket._id,
      title: title || ticket.subject,
      startTime: start,
      endTime: end,
      status: "BOOKED",
      studentId: ticket.studentId,
      bookedAt: new Date(),
      meeting,
    });

    return res.status(201).send(prepareResponseMsg({ slot: toPublicSlot(slot) }, true, "Session scheduled", 201));
  } catch (err) {
    return next(err);
  }
}

export async function getTicketSessions(req, res, next) {
  try {
    const actor = getActor(req);
    const ticket = await MentorshipTicket.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!ticket) return sendError(res, "MENTORSHIP_TICKET_NOT_FOUND", 404);
    if (!isParticipant(ticket, actor.id) && !canModerateCourses(actor)) {
      return sendError(res, "MENTORSHIP_TICKET_NOT_FOUND", 404);
    }

    const slots = await BookableSlot.find({ tenantId: req.tenantId, ticketId: ticket._id }).sort({ startTime: 1 });
    return res.status(200).send(prepareResponseMsg(slots.map(toPublicSlot), true, "Sessions fetched", 200));
  } catch (err) {
    return next(err);
  }
}

/** GET /dashboard/mentor — the signed-in mentor's queue snapshot. */
export async function getMentorDashboard(req, res, next) {
  try {
    const actor = getActor(req);

    const [assignedOpenCount, profile, recentTickets, upcomingSessions] = await Promise.all([
      MentorshipTicket.countDocuments({ tenantId: req.tenantId, mentorId: actor.id, status: "ASSIGNED" }),
      MentorProfile.findOne({ tenantId: req.tenantId, userId: actor.id }),
      MentorshipTicket.find({ tenantId: req.tenantId, mentorId: actor.id })
        .populate("studentId", "name email")
        .sort({ lastMessageAt: -1, created_on: -1 })
        .limit(5),
      BookableSlot.find({
        tenantId: req.tenantId,
        hostId: actor.id,
        sessionType: "MENTORSHIP",
        status: "BOOKED",
        startTime: { $gte: new Date() },
      })
        .populate("studentId", "name email")
        .sort({ startTime: 1 })
        .limit(5),
    ]);

    const tags = profile?.expertiseTags || [];
    const unclaimedFilter = { tenantId: req.tenantId, status: "OPEN" };
    if (tags.length) unclaimedFilter.topicTags = { $in: tags };
    const unclaimedMatchingCount = await MentorshipTicket.countDocuments(unclaimedFilter);

    return res.status(200).send(
      prepareResponseMsg(
        {
          assignedOpenCount,
          unclaimedMatchingCount,
          recentTickets: recentTickets.map(toPublicTicket),
          upcomingSessions: upcomingSessions.map(toPublicSlot),
        },
        true,
        "Mentor dashboard fetched",
        200
      )
    );
  } catch (err) {
    return next(err);
  }
}

/** GET /dashboard/admin — queue depth and per-mentor load, for the mentorship oversight page. */
export async function getAdminDashboard(req, res, next) {
  try {
    const tenantObjectId = new mongoose.Types.ObjectId(req.tenantId);

    const [openCount, assignedCount, closedCount, perMentor, oldestOpen] = await Promise.all([
      MentorshipTicket.countDocuments({ tenantId: req.tenantId, status: "OPEN" }),
      MentorshipTicket.countDocuments({ tenantId: req.tenantId, status: "ASSIGNED" }),
      MentorshipTicket.countDocuments({ tenantId: req.tenantId, status: "CLOSED" }),
      MentorshipTicket.aggregate([
        { $match: { tenantId: tenantObjectId, mentorId: { $ne: null } } },
        {
          $group: {
            _id: "$mentorId",
            openCount: { $sum: { $cond: [{ $eq: ["$status", "ASSIGNED"] }, 1, 0] } },
            closedCount: { $sum: { $cond: [{ $eq: ["$status", "CLOSED"] }, 1, 0] } },
            avgCloseMs: {
              $avg: {
                $cond: [{ $eq: ["$status", "CLOSED"] }, { $subtract: ["$closedAt", "$assignedAt"] }, null],
              },
            },
          },
        },
        { $lookup: { from: "User", localField: "_id", foreignField: "_id", as: "mentor" } },
        { $unwind: "$mentor" },
        {
          $project: {
            _id: 0,
            mentorId: "$_id",
            name: "$mentor.name",
            email: "$mentor.email",
            openCount: 1,
            closedCount: 1,
            avgCloseHours: { $divide: [{ $ifNull: ["$avgCloseMs", 0] }, 3600000] },
          },
        },
        { $sort: { openCount: -1 } },
      ]),
      MentorshipTicket.findOne({ tenantId: req.tenantId, status: "OPEN" }).sort({ created_on: 1 }),
    ]);

    return res.status(200).send(
      prepareResponseMsg(
        {
          queue: { open: openCount, assigned: assignedCount, closed: closedCount },
          perMentor,
          oldestOpenTicketAt: oldestOpen?.created_on || null,
        },
        true,
        "Admin dashboard fetched",
        200
      )
    );
  } catch (err) {
    return next(err);
  }
}
