import mongoose from "mongoose";

export const MENTORSHIP_STATUSES = ["PENDING", "ACCEPTED", "REJECTED", "COMPLETED"];

/**
 * The ask itself ("will you mentor me") is tracked separately from the actual meeting
 * time — once accepted, the mentor publishes BookableSlot(s) (sessionType=MENTORSHIP)
 * that the student books, reusing the same scheduling flow as mock interviews.
 */
const mentorshipRequestSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },
    mentorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      default: null,
    },
    message: { type: String, default: "", maxlength: 2000 },
    status: {
      type: String,
      enum: MENTORSHIP_STATUSES,
      default: "PENDING",
      index: true,
    },
    respondedAt: { type: Date, default: null },
    responseNote: { type: String, default: "" },
  },
  {
    timestamps: { createdAt: "created_on", updatedAt: "updated_on" },
    collection: "mentorship_requests",
  }
);

mentorshipRequestSchema.index({ tenantId: 1, mentorId: 1, status: 1 });
mentorshipRequestSchema.index({ tenantId: 1, studentId: 1, status: 1 });

const MentorshipRequest = mongoose.model("MentorshipRequest", mentorshipRequestSchema);
export default MentorshipRequest;
