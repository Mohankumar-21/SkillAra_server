import { sendError } from "../utils/helper.js";
import { resolveRoleForActor, roleGrantsPermission } from "../services/roleService.js";

/**
 * Middleware to enforce the granular tenant permission matrix.
 *
 * This is the ONLY authorization gate for tenant routes — there is no parallel role-name
 * check to satisfy. Must run AFTER requireAuth and requireTenant. It resolves the caller's
 * tenant role from Tenant.roles[] and checks the granted actions for the module.
 *
 * @param {string} moduleId - The ID of the module (e.g. "courses", "forum")
 * @param {string} action - The required action (e.g. "create", "moderate")
 */
export function requirePermission(moduleId, action) {
  return async (req, res, next) => {
    try {
      // Super Admins bypass tenant granular permissions completely
      if (req.user?.type === "superadmin" || req.user?.role === "SUPER_ADMIN") {
        return next();
      }

      if (!req.tenantId || !req.user) {
        return sendError(res, "AUTH_REQUIRED", 401);
      }

      const role = req.role || (await resolveRoleForActor(req.user, req.tenantId));

      if (!role) {
        return res.status(403).json({
          error: "PERMISSION_DENIED",
          moduleId,
          action,
          message: "Role not found for user",
        });
      }

      const isGranted = roleGrantsPermission(role, moduleId, action);

      if (!isGranted) {
        return res.status(403).json({ 
          error: "PERMISSION_DENIED", 
          moduleId, 
          action,
          message: `Insufficient permissions to ${action} ${moduleId}` 
        });
      }

      // Stash role on req for potential use downstream (e.g., quiz visibility checks)
      req.role = role;
      
      next();
    } catch (err) {
      next(err);
    }
  };
}
