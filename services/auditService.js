import AuditLog from "../models/AuditLog.js";

export async function writeAuditLog({
  tenantId = null,
  actorId = null,
  actorRole = "",
  action,
  resourceType = "",
  resourceId = null,
  metadata = {},
  ip = "",
}) {
  return AuditLog.create({
    tenantId,
    actorId,
    actorRole,
    action,
    resourceType,
    resourceId,
    metadata,
    ip,
  });
}

export function auditFromRequest(req, payload) {
  return writeAuditLog({
    tenantId: req.user?.tenantId ?? req.tenantId ?? req.resolvedTenant?._id ?? req.tenant?._id ?? null,
    actorId: req.user?._id || null,
    actorRole: req.user?.role || "",
    ip: req.ip || "",
    ...payload,
  });
}
