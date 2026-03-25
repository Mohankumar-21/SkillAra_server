import mongoose from "mongoose";

const BILLING_CYCLES = ["monthly", "yearly"];
const PLAN_NAMES = ["FREE", "BASIC", "PREMIUM", "ENTERPRISE"];

const planSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      index: true,
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
      storageLimit: { type: Number, required: true, min: 0 }, // MB
      aiFeatures: { type: Boolean, required: true, default: false },
      analyticsAccess: { type: Boolean, required: true, default: false },
      prioritySupport: { type: Boolean, required: true, default: false },
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true,
    collection: "plans",
  }
);

// Extra explicit index (in addition to `unique: true`) for clarity.
planSchema.index({ name: 1 }, { unique: true });

const Plan = mongoose.model("Plan", planSchema);
export default Plan;

