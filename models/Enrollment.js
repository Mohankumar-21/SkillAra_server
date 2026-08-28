import mongoose from "mongoose";

const enrollmentSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
      index: true,
    },
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },
    /**
     * Free courses enrol straight to ACTIVE. Paid courses go to PENDING_APPROVAL and stay
     * there until a member of staff approves the request — only ACTIVE and COMPLETED ever
     * grant access to lesson content.
     *
     * PENDING_PAYMENT is the retired status from the sandbox-checkout stub; it is still
     * accepted so existing rows load, and is treated as pending everywhere.
     */
    status: {
      type: String,
      enum: ["ACTIVE", "COMPLETED", "DROPPED", "PENDING_APPROVAL", "REJECTED", "PENDING_PAYMENT"],
      default: "ACTIVE",
      index: true,
    },
    enrolledAt: {
      type: Date,
      default: Date.now,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    /** Set when the learner asks for access to a paid course. */
    requestedAt: { type: Date, default: null },
    /** Learner's note with the request, and the staff note on the decision. */
    requestNote: { type: String, default: "", trim: true },
    decisionNote: { type: String, default: "", trim: true },
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    decidedAt: { type: Date, default: null },
    /** True when staff enrolled this learner directly rather than approving a request. */
    grantedByStaff: { type: Boolean, default: false },
  },
  {
    timestamps: { createdAt: "created_on", updatedAt: "updated_on" },
    collection: "enrollments",
  }
);

enrollmentSchema.index({ userId: 1, courseId: 1 }, { unique: true });
/** Staff queue: pending access requests in this tenant, oldest first. */
enrollmentSchema.index({ tenantId: 1, status: 1, requestedAt: 1 });

/** Statuses that mean "waiting on a staff decision". */
export const PENDING_STATUSES = ["PENDING_APPROVAL", "PENDING_PAYMENT"];
/** Statuses that grant access to course content. */
export const ACCESS_STATUSES = ["ACTIVE", "COMPLETED"];

const Enrollment = mongoose.model("Enrollment", enrollmentSchema);
export default Enrollment;
