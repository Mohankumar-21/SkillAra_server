import mongoose from "mongoose";

const aiUsageSchema = new mongoose.Schema(
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
    requestCount: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
    collection: "ai_usage",
  }
);

aiUsageSchema.index({ tenantId: 1, month: 1 }, { unique: true });

const AIUsage = mongoose.model("AIUsage", aiUsageSchema);
export default AIUsage;
