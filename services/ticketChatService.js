import MentorshipTicket from "../models/MentorshipTicket.js";
import TicketMessage from "../models/TicketMessage.js";

/**
 * Loads a ticket and confirms `userId` is its student or assigned mentor within
 * `tenantId`. Used by both the REST chat endpoints and the mentorship-chat socket so
 * the two paths enforce identical access rules.
 */
export async function loadTicketForParticipant(tenantId, userId, ticketId) {
  const ticket = await MentorshipTicket.findOne({ _id: ticketId, tenantId });
  if (!ticket) return null;

  const isStudent = String(ticket.studentId) === String(userId);
  const isMentor = ticket.mentorId && String(ticket.mentorId) === String(userId);
  if (!isStudent && !isMentor) return null;

  return { ticket, role: isStudent ? "STUDENT" : "MENTOR" };
}

/**
 * Persists a chat message and bumps the ticket's lastMessageAt / the sender's
 * last-read timestamp. Throws a `MENTORSHIP_TICKET_CLOSED`-coded error if the ticket
 * is closed — closed tickets are read-only.
 */
export async function postTicketMessage({ ticket, senderId, senderRole, body }) {
  if (ticket.status === "CLOSED") {
    const err = new Error("Ticket is closed");
    err.code = "MENTORSHIP_TICKET_CLOSED";
    throw err;
  }

  const message = await TicketMessage.create({
    ticketId: ticket._id,
    tenantId: ticket.tenantId,
    senderId,
    senderRole,
    body,
  });

  ticket.lastMessageAt = message.created_on;
  if (senderRole === "STUDENT") ticket.studentLastReadAt = message.created_on;
  else ticket.mentorLastReadAt = message.created_on;
  await ticket.save();

  return message;
}

export function toPublicMessage(doc) {
  const m = doc.toObject ? doc.toObject() : doc;
  return {
    id: m._id,
    ticketId: m.ticketId,
    senderId: m.senderId,
    senderRole: m.senderRole,
    body: m.body,
    created_on: m.created_on,
  };
}
