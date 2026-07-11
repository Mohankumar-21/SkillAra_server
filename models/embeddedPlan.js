import mongoose from "mongoose";

export const BILLING_CYCLES = ["monthly", "yearly"];
export const PLAN_NAMES = ["FREE", "BASIC", "PREMIUM", "ENTERPRISE"];

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
      maxUsers: { type: Number, required: true, min: 0 },
      maxCourses: { type: Number, required: true, min: 0 },
      maxAIRequests: { type: Number, required: true, default: 0 },
      storageLimit: { type: Number, required: true, min: 0 },
      aiFeatures: { type: Boolean, required: true, default: false },
      aiTier: {
        type: String,
        enum: ["BASIC", "ADVANCED", "PRO"],
        default: "BASIC",
      },
      evaluationEnabled: { type: Boolean, default: false },
      summarizationEnabled: { type: Boolean, default: false },
      predictiveAnalyticsEnabled: { type: Boolean, default: false },
      analyticsAccess: { type: Boolean, required: true, default: false },
      prioritySupport: { type: Boolean, required: true, default: false },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

export default embeddedPlanSchema;
