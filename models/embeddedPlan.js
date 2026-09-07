import mongoose from "mongoose";

export const BILLING_CYCLES = ["monthly", "yearly"];
export const PLAN_NAMES = ["FREE", "STARTER", "PROFESSIONAL", "ENTERPRISE"];

/** Embedded subscription plan — stored on the primary SuperAdmin.plans array. */
export const embeddedPlanSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      enum: PLAN_NAMES,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    billingCycle: {
      type: String,
      required: true,
      enum: BILLING_CYCLES,
    },
    features: {
      maxStudents: { type: Number, default: null },
      maxInstructors: { type: Number, default: null },
      maxUsers: { type: Number, default: null },
      maxCourses: { type: Number, default: null },
      storageLimit: { type: Number, default: null }, // In MB
      aiCredits: { type: Number, default: null },
      maxAIRequests: { type: Number, default: null },
      liveClassesEnabled: { type: Boolean, default: false },
      certificatesEnabled: { type: Boolean, default: false },
      communityEnabled: { type: Boolean, default: false },
      analyticsEnabled: { type: Boolean, default: false },
      analyticsAccess: { type: Boolean, default: false },
      mentorshipEnabled: { type: Boolean, default: false },
      mockInterviewsEnabled: { type: Boolean, default: false },
      maxLiveSessionsPerMonth: { type: Number, default: null },
      maxMentorshipSlotsPerMonth: { type: Number, default: null },
      aiFeatures: { type: Boolean, default: false },
      aiTier: {
        type: String,
        enum: ["BASIC", "ADVANCED", "PRO"],
        default: "BASIC",
      },
      evaluationEnabled: { type: Boolean, default: false },
      summarizationEnabled: { type: Boolean, default: false },
      predictiveAnalyticsEnabled: { type: Boolean, default: false },
      prioritySupport: { type: Boolean, default: false },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

export default embeddedPlanSchema;
