import mongoose from "mongoose";

export const SLOT_SESSION_TYPES = ["MOCK_INTERVIEW", "MENTORSHIP"];
export const SLOT_STATUSES = ["OPEN", "BOOKED", "COMPLETED", "CANCELLED"];

/**
 * A single bookable time slot published by an instructor/mentor and claimed by a student.
 * Mock interviews and mentorship sessions are the same scheduling primitive — a host
 * offers time, a student books it, both get a meeting room — so they share this model
 * instead of duplicating the booking flow per feature.
 */
const feedbackSchema = new mongoose.Schema(
  {
    rating: { type: Number, min: 1, max: 5 },
    notes: { type: String, default: "" },
    strengths: [String],
    improvements: [String],
    givenBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    givenAt: { type: Date },
  },
  { _id: false }
);

const meetingSchema = new mongoose.Schema(
  {
    provider: { type: String, enum: ["webrtc", "jitsi"], default: "webrtc" },
    roomId: { type: String },
    jitsiFallbackUrl: { type: String },
  },
  { _id: false }
);

const bookableSlotSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },
    sessionType: {
      type: String,
      enum: SLOT_SESSION_TYPES,
      required: true,
      index: true,
    },
    hostId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      default: null,
      index: true,
    },
    ticketId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MentorshipTicket",
      default: null,
      index: true,
    },
    title: { type: String, trim: true, default: "" },
    startTime: { type: Date, required: true, index: true },
    endTime: { type: Date, required: true },
    status: {
      type: String,
      enum: SLOT_STATUSES,
      default: "OPEN",
      index: true,
    },
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    bookedAt: { type: Date, default: null },
    cancelReason: { type: String, default: "" },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    meeting: { type: meetingSchema, default: () => ({}) },
    feedback: { type: feedbackSchema, default: null },
  },
  {
    timestamps: { createdAt: "created_on", updatedAt: "updated_on" },
    collection: "bookable_slots",
  }
);

bookableSlotSchema.index({ tenantId: 1, sessionType: 1, status: 1, startTime: 1 });
bookableSlotSchema.index({ tenantId: 1, hostId: 1, startTime: 1 });
bookableSlotSchema.index({ tenantId: 1, studentId: 1, startTime: 1 });

const BookableSlot = mongoose.model("BookableSlot", bookableSlotSchema);
export default BookableSlot;
