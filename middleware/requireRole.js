import { sendError } from "../utils/helper.js";
import { normalizeRoleForDb } from "../utils/userRoleMap.js";
import { isTenantAdminUser } from "../utils/user.js";

function normalizeAllowedRole(role) {
  return normalizeRoleForDb(role) || String(role || "").toLowerCase();
}

function userDbRole(user) {
  return normalizeRoleForDb(user?.role) || String(user?.role || "").toLowerCase();
}

/** 403 unless req.user.role matches an allowed role (supports API names like TENANT_ADMIN, TUTOR). */
export function requireRole(...roles) {
  return (req, res, next) => {
    const user = req.user;
    if (!user) {
      return sendError(res, "GENERAL_FORBIDDEN", 403);
    }

    const allowed = roles.map(normalizeAllowedRole);

    if (allowed.some((r) => r === "superadmin" || r === "super_admin")) {
      const db = userDbRole(user);
      if (db === "superadmin" || db === "super_admin") {
        return next();
      }
    }

    if (allowed.includes("tenant_admin") && isTenantAdminUser(user)) {
      return next();
    }

    const dbRole = userDbRole(user);
    if (allowed.includes(dbRole)) {
      return next();
    }

    return sendError(res, "GENERAL_FORBIDDEN", 403);
  };
}
