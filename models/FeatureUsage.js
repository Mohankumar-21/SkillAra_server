import mongoose from "mongoose";

const featureUsageSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },
    month: {
      type: String, // YYYY-MM
      required: true,
      index: true,
    },
    feature: {
      type: String,
      required: true,
      enum: ["LIVE_SESSION", "MENTORSHIP_SLOT"],
      index: true,
    },
    usageCount: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
    collection: "feature_usage",
  }
);

featureUsageSchema.index({ tenantId: 1, month: 1, feature: 1 }, { unique: true });

const FeatureUsage = mongoose.model("FeatureUsage", featureUsageSchema);
export default FeatureUsage;
