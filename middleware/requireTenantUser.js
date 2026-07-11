import { sendError } from "../utils/helper.js";

/** 403 unless the authenticated principal is a tenant user with a tenantId. */
export function requireTenantUser(req, res, next) {
  if (req.user?.type !== "tenant_user" || !req.user?.tenantId) {
    return sendError(res, "GENERAL_FORBIDDEN", 403);
  }
  return next();
}
