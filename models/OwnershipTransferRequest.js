import mongoose from "mongoose";

export const OWNERSHIP_REQUEST_STATUSES = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"];

export const PREVIOUS_OWNER_ROLE = "ORG_ADMIN";

const ownershipTransferRequestSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    targetUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    previousOwnerNewRole: {
      type: String,
      default: "ORG_ADMIN",
    },
    reason: { type: String, default: "", maxlength: 500 },
    status: {
      type: String,
      enum: OWNERSHIP_REQUEST_STATUSES,
      default: "PENDING",
      index: true,
    },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
    reviewNote: { type: String, default: "", maxlength: 500 },
    appliedPreviousOwnerNewRole: { type: String, default: null },
  },
  { timestamps: { createdAt: "created_on", updatedAt: "updated_on" }, collection: "OwnershipTransferRequest" }
);

ownershipTransferRequestSchema.index(
  { tenantId: 1, status: 1 },
  { partialFilterExpression: { status: "PENDING" }, unique: true }
);

const OwnershipTransferRequest = mongoose.model(
  "OwnershipTransferRequest",
  ownershipTransferRequestSchema
);

export default OwnershipTransferRequest;
