import mongoose from "mongoose";

/**
 * In-app notification addressed to exactly one tenant user.
 *
 * One row per recipient (fan-out on write) rather than one row per event, so the unread
 * count and the "mark read" flow stay a single indexed query per user.
 */
export const NOTIFICATION_TYPES = [
  "course.review.assigned",
  "course.review.submitted",
  "course.review.changes_requested",
  "course.review.approved",
  "course.published",
  "enrollment.requested",
  "enrollment.approved",
  "enrollment.rejected",
  "enrollment.granted",
];

const notificationSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },
    /** Recipient. */
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: NOTIFICATION_TYPES,
      required: true,
    },
    title: { type: String, required: true, trim: true },
    message: { type: String, default: "", trim: true },
    /** Who caused the event. Null for system-generated notifications. */
    actorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    actorName: { type: String, default: "" },
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      default: null,
    },
    /** Client-side route the notification points at, e.g. /instructor/courses/:id. */
    link: { type: String, default: "" },
    readAt: { type: Date, default: null },
  },
  {
    timestamps: { createdAt: "created_on", updatedAt: "updated_on" },
    collection: "Notification",
  }
);

/** Inbox listing: this user's notifications, newest first. */
notificationSchema.index({ tenantId: 1, userId: 1, created_on: -1 });
/** Unread badge count. */
notificationSchema.index({ tenantId: 1, userId: 1, readAt: 1 });

const Notification = mongoose.model("Notification", notificationSchema);
export default Notification;
