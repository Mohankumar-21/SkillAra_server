import mongoose from "mongoose";

export const TICKET_STATUSES = ["OPEN", "ASSIGNED", "CLOSED"];
export const TICKET_ASSIGNED_BY = ["MENTOR_CLAIM", "ADMIN"];

/**
 * A student's request for help, tracked as a ticket rather than a one-shot mentor
 * request: it sits in an open queue until a mentor claims it (or staff force-assigns
 * it), then the mentor and student chat and schedule sessions against this ticket
 * until it's closed.
 */
const mentorshipTicketSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    subject: { type: String, required: true, trim: true, maxlength: 150 },
    description: { type: String, default: "", maxlength: 4000 },
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      default: null,
    },
    topicTags: { type: [String], default: [] },
    status: {
      type: String,
      enum: TICKET_STATUSES,
      default: "OPEN",
      index: true,
    },
    mentorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    assignedAt: { type: Date, default: null },
    assignedBy: { type: String, enum: TICKET_ASSIGNED_BY, default: null },
    assignedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    closedAt: { type: Date, default: null },
    closedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    closeNote: { type: String, default: "", maxlength: 2000 },
    lastMessageAt: { type: Date, default: null },
    studentLastReadAt: { type: Date, default: null },
    mentorLastReadAt: { type: Date, default: null },
  },
  {
    timestamps: { createdAt: "created_on", updatedAt: "updated_on" },
    collection: "mentorship_tickets",
  }
);

mentorshipTicketSchema.index({ tenantId: 1, status: 1, topicTags: 1 });
mentorshipTicketSchema.index({ tenantId: 1, mentorId: 1, status: 1 });
mentorshipTicketSchema.index({ tenantId: 1, studentId: 1, status: 1 });

const MentorshipTicket = mongoose.model("MentorshipTicket", mentorshipTicketSchema);
export default MentorshipTicket;
