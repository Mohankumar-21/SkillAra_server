import { sendError } from "../utils/helper.js";
import { resolveTenantRoleForUser, roleGrantsPermission } from "../services/roleService.js";

/**
 * Middleware to enforce the granular tenant permission matrix.
 * 
 * Must run AFTER requireAuth and requireTenant, and alongside (not instead of) requireRole.
 * It dynamically resolves the user's tenant role and checks the granted actions for the module.
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

      const role = await resolveTenantRoleForUser({
        tenantId: req.tenantId,
        roleId: req.user.roleId,
        legacyRole: req.user.role, // For tokens carrying the legacy role string
        isTenantAdmin: req.user.isTenantAdmin,
      });

      if (!role) {
        return res.status(403).json({ 
          error: "PERMISSION_DENIED", 
          moduleId, 
          action,
          message: `Role not found for user` 
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
