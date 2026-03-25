import mongoose from "mongoose";

// Future-ready payment structure (no payment gateway implemented yet).
const subscriptionSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    planId: { type: mongoose.Schema.Types.ObjectId, ref: "Plan", required: true, index: true },
    paymentStatus: { type: String, required: true, index: true }, // e.g. "PENDING", "PAID", "FAILED"
    amount: { type: Number, required: true, min: 0 },
    transactionId: { type: String, default: "", index: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
  },
  { timestamps: true, collection: "subscriptions" }
);

subscriptionSchema.index({ tenantId: 1, planId: 1 });

const Subscription = mongoose.model("Subscription", subscriptionSchema);
export default Subscription;

