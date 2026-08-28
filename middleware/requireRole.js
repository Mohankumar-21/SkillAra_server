import { sendError } from "../utils/helper.js";

const PLATFORM_ROLES = new Set(["SUPER_ADMIN", "SUPERADMIN"]);

function normalize(role) {
  return String(role || "")
    .trim()
    .toUpperCase()
    .replace(/-/g, "_");
}

/**
 * 403 unless the caller is a platform (super admin) principal.
 *
 * Tenant authorization never goes through here. Tenant routes are gated by
 * requirePermission(moduleId, action) against Tenant.roles[].permissions, and organization
 * ownership by requireOwner. Super admins are a different principal entirely — they live in
 * the SuperAdmin collection, not Tenant.roles[] — which is why they keep a role check.
 *
 * Passing a tenant role name throws at route-definition time (module load), so the old
 * "four hardcoded buckets" path cannot be reintroduced by accident.
 */
export function requireRole(...roles) {
  const allowed = roles.map(normalize);
  const invalid = allowed.filter((r) => !PLATFORM_ROLES.has(r));
  if (invalid.length) {
    throw new Error(
      `requireRole() only guards platform principals; received ${invalid.join(", ")}. ` +
        "Use requirePermission(moduleId, action) for tenant routes, or requireOwner for organization ownership."
    );
  }

  return (req, res, next) => {
    const user = req.user;
    if (!user) {
      return sendError(res, "GENERAL_FORBIDDEN", 403);
    }

    if (user.type === "superadmin" || PLATFORM_ROLES.has(normalize(user.role))) {
      return next();
    }

    return sendError(res, "GENERAL_FORBIDDEN", 403);
  };
}
