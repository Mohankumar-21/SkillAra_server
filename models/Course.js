import mongoose from "mongoose";

export const COURSE_STATUSES = ["DRAFT", "PUBLISHED", "ARCHIVED"];

/**
 * Content-review lifecycle, independent of `status`.
 *
 *   NOT_SUBMITTED ──submit──▶ PENDING ──approve──▶ APPROVED ──publish──▶ (approval consumed)
 *                                │
 *                                └─request changes──▶ CHANGES_REQUESTED ──submit──▶ PENDING
 *
 * A course can only be published from APPROVED. Unpublishing resets the course to
 * NOT_SUBMITTED so the next publish goes through review again.
 */
export const COURSE_REVIEW_STATUSES = [
  "NOT_SUBMITTED",
  "PENDING",
  "CHANGES_REQUESTED",
  "APPROVED",
];

export const COURSE_REVIEW_ACTIONS = ["submitted", "changes_requested", "approved", "reset"];
export const COURSE_LEVELS = ["BEGINNER", "INTERMEDIATE", "ADVANCED", "ALL_LEVELS"];

/**
 * Moderation is kept separate from `status` on purpose: an admin blocking a course
 * must not destroy the instructor's own draft/published intent. A blocked course is
 * hidden from learners regardless of status, and the instructor cannot self-publish
 * out of it.
 */
const moderationSchema = new mongoose.Schema(
  {
    isBlocked: { type: Boolean, default: false },
    reason: { type: String, default: "" },
    blockedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
    blockedAt: { type: Date, default: null },
  },
  { _id: false }
);

/** Append-only audit trail of every review decision on a course. */
const reviewEventSchema = new mongoose.Schema(
  {
    action: { type: String, enum: COURSE_REVIEW_ACTIONS, required: true },
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    actorName: { type: String, default: "" },
    note: { type: String, default: "", trim: true },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const reviewSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: COURSE_REVIEW_STATUSES,
      default: "NOT_SUBMITTED",
    },
    /** Content reviewer the instructor assigned this course to. */
    reviewerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    submittedAt: { type: Date, default: null },
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    decidedAt: { type: Date, default: null },
    /** Most recent reviewer note — plagiarism findings, requested changes, or approval remarks. */
    note: { type: String, default: "", trim: true },
    history: { type: [reviewEventSchema], default: () => [] },
  },
  { _id: false }
);

const courseSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    subtitle: {
      type: String,
      trim: true,
      default: "",
    },
    description: {
      type: String,
      default: "",
    },
    instructorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    category: {
      type: String,
      trim: true,
      default: "",
      index: true,
    },
    level: {
      type: String,
      enum: COURSE_LEVELS,
      default: "ALL_LEVELS",
    },
    language: {
      type: String,
      trim: true,
      default: "en",
    },
    /** Public URL is never stored — only the private B2 object key. */
    thumbnailKey: {
      type: String,
      default: "",
    },
    /** Legacy/external thumbnail URL. New uploads populate thumbnailKey instead. */
    thumbnail: {
      type: String,
      default: "",
    },
    status: {
      type: String,
      enum: COURSE_STATUSES,
      default: "DRAFT",
      index: true,
    },
    publishedAt: {
      type: Date,
      default: null,
    },
    moderation: {
      type: moderationSchema,
      default: () => ({}),
    },
    review: {
      type: reviewSchema,
      default: () => ({}),
    },
    modules: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Module",
      },
    ],
    stats: {
      enrolledCount: { type: Number, default: 0 },
      lessonCount: { type: Number, default: 0 },
      durationMinutes: { type: Number, default: 0 },
      rating: { type: Number, default: 0 },
      reviewCount: { type: Number, default: 0 },
    },
    price: {
      type: Number,
      default: 0,
      min: 0,
    },
    currency: {
      type: String,
      trim: true,
      uppercase: true,
      default: "INR",
    },
    requiresPayment: {
      type: Boolean,
      default: false,
    },
    tags: [String],
    outcomes: [String],
    requirements: [String],
    /** AI-generated short overview of the course content, cached so it isn't
     *  regenerated (and re-billed) on every page view — see routes/aiRoutes.js. */
    aiSummary: { type: String, default: "" },
    aiSummaryGeneratedAt: { type: Date, default: null },
    created_by: { type: String, default: "system" },
    updated_by: { type: String, default: "system" },
  },
  {
    timestamps: { createdAt: "created_on", updatedAt: "updated_on" },
    collection: "Course",
  }
);

/** Catalog browsing: tenant → published → newest first. */
courseSchema.index({ tenantId: 1, status: 1, created_on: -1 });
/** "My courses" for an instructor. */
courseSchema.index({ tenantId: 1, instructorId: 1, created_on: -1 });
/** A reviewer's queue: courses assigned to them, newest submission first. */
courseSchema.index({ tenantId: 1, "review.reviewerId": 1, "review.status": 1, "review.submittedAt": -1 });
courseSchema.index({ tenantId: 1, category: 1 });

/** Visible to learners only when published and not blocked by an admin. */
courseSchema.methods.isLive = function isLive() {
  return this.status === "PUBLISHED" && !this.moderation?.isBlocked;
};

const Course = mongoose.model("Course", courseSchema);
export default Course;
