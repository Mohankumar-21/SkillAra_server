import AuditLog from "../models/AuditLog.js";

/**
 * Structured audit log for security-sensitive actions.
 */
export async function writeAuditLog({
  actorId,
  actorType,
  action,
  targetId = null,
  tenantId = null,
  ip = "",
  metadata = {},
}) {
  try {
    await AuditLog.create({
      actorId,
      actorType,
      actorRole: actorType,
      action,
      resourceType: metadata.resourceType || "",
      resourceId: targetId,
      tenantId,
      metadata,
      ip,
    });
  } catch (err) {
    // Audit failures must not break primary request flow.
    console.error("[audit] failed to write log", err.message);
  }
}
