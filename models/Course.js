import mongoose from "mongoose";

export const COURSE_STATUSES = ["DRAFT", "PUBLISHED", "ARCHIVED"];
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
courseSchema.index({ tenantId: 1, category: 1 });

/** Visible to learners only when published and not blocked by an admin. */
courseSchema.methods.isLive = function isLive() {
  return this.status === "PUBLISHED" && !this.moderation?.isBlocked;
};

const Course = mongoose.model("Course", courseSchema);
export default Course;
