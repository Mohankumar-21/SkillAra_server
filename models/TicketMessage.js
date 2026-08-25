import mongoose from "mongoose";

export const TICKET_MESSAGE_SENDER_ROLES = ["STUDENT", "MENTOR"];

const ticketMessageSchema = new mongoose.Schema(
  {
    ticketId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MentorshipTicket",
      required: true,
      index: true,
    },
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    senderRole: { type: String, enum: TICKET_MESSAGE_SENDER_ROLES, required: true },
    body: { type: String, required: true, trim: true, maxlength: 4000 },
  },
  {
    timestamps: { createdAt: "created_on", updatedAt: "updated_on" },
    collection: "mentorship_ticket_messages",
  }
);

ticketMessageSchema.index({ ticketId: 1, created_on: 1 });

const TicketMessage = mongoose.model("TicketMessage", ticketMessageSchema);
export default TicketMessage;
