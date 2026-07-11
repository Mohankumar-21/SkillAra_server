import mongoose from "mongoose";

export const INVITATION_STATUSES = ["PENDING", "ACCEPTED", "BLOCKED"];

const auditLogSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", default: null, index: true },
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    actorRole: { type: String, default: "" },
    action: { type: String, required: true, index: true },
    resourceType: { type: String, default: "" },
    resourceId: { type: mongoose.Schema.Types.ObjectId, default: null },
    metadata: { type: Object, default: {} },
    ip: { type: String, default: "" },
  },
  { timestamps: { createdAt: "created_on", updatedAt: false }, collection: "AuditLog" }
);

const AuditLog = mongoose.model("AuditLog", auditLogSchema);
export default AuditLog;
