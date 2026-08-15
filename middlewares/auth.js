/**
 * Backward-compatible auth exports.
 * New code should import from ../middleware/authenticate.js and siblings directly.
 */
export {
  authenticate,
  optionalAuthenticate,
  authenticateLegacy as requireAuth,
  optionalAuthenticateLegacy as optionalAuth,
} from "../middleware/authenticate.js";
export { requireRole } from "../middleware/requireRole.js";
export { requireTenantUser } from "../middleware/requireTenantUser.js";
export { requireSuperadmin } from "../middleware/requireSuperadmin.js";
export { scopeTenant } from "../middleware/scopeTenant.js";
import { sendError } from "../utils/helper.js";
import { getRequestTenantId } from "../utils/requestTenant.js";

/**
 * Ensures req.tenantId is set from the JWT tenant _id when authenticated.
 * Subdomain resolution (req.tenant) is only used for unauthenticated entry points.
 * New tenant-scoped routes should use authenticate + scopeTenant.
 */
export function requireTenant(req, res, next) {
  if (req.user?.type === "superadmin" || req.user?.role === "SUPER_ADMIN") {
    const tenantId = getRequestTenantId(req);
    if (tenantId) {
      req.tenantId = tenantId;
    }
    return next();
  }

  const tokenTenantId =
    req.user?.type === "tenant_user"
      ? req.user.tenantId
      : req.user?.tenantId != null
        ? String(req.user.tenantId)
        : null;

  if (tokenTenantId) {
    req.tenantId = tokenTenantId;
    if (req.tenant && String(req.tenant._id) !== tokenTenantId) {
      return sendError(res, "GENERAL_FORBIDDEN", 403);
    }
    return next();
  }

  const tenantId = getRequestTenantId(req);
  if (!tenantId) {
    return sendError(res, "AUTH_TENANT_REQUIRED", 400);
  }

  req.tenantId = tenantId;
  return next();
}
