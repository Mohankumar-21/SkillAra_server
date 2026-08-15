/**
 * Resolve the authoritative tenant MongoDB _id for the current request.
 * Prefer JWT tenant_id over subdomain-resolved tenant (never use tenant name).
 */
export function getRequestTenantId(req) {
  if (req.tenantId) return String(req.tenantId);

  if (req.user?.type === "superadmin" || req.user?.role === "SUPER_ADMIN") {
    const customId = req.query?.tenantId || req.headers?.["x-tenant-id"];
    if (customId) return String(customId);
  }

  const fromUser =
    req.user?.type === "tenant_user"
      ? req.user.tenantId
      : req.user?.tenantId != null
        ? req.user.tenantId
        : null;
  if (fromUser) return String(fromUser);

  if (req.resolvedTenant?._id) return String(req.resolvedTenant._id);
  if (req.tenant?._id) return String(req.tenant._id);

  return null;
}
