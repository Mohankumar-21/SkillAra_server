import mongoose from "mongoose";

export const LIVE_SESSION_STATUSES = ["SCHEDULED", "LIVE", "ENDED", "CANCELLED"];

const meetingSchema = new mongoose.Schema(
  {
    provider: { type: String, enum: ["webrtc", "jitsi"], default: "webrtc" },
    roomId: { type: String },
    jitsiFallbackUrl: { type: String },
  },
  { _id: false }
);

const liveSessionSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
      index: true,
    },
    instructorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    scheduledStart: { type: Date, required: true, index: true },
    scheduledEnd: { type: Date, required: true },
    status: {
      type: String,
      enum: LIVE_SESSION_STATUSES,
      default: "SCHEDULED",
      index: true,
    },
    meeting: { type: meetingSchema, default: () => ({}) },
    recordingUrl: { type: String, default: "" },
    cancelReason: { type: String, default: "" },
  },
  {
    timestamps: { createdAt: "created_on", updatedAt: "updated_on" },
    collection: "live_sessions",
  }
);

liveSessionSchema.index({ tenantId: 1, courseId: 1, scheduledStart: -1 });

const LiveSession = mongoose.model("LiveSession", liveSessionSchema);
export default LiveSession;
