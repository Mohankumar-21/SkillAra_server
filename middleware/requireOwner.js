import { sendError } from "../utils/helper.js";
import { resolveRoleForActor } from "../services/roleService.js";

/**
 * 403 unless the caller holds their tenant's owner role.
 *
 * Organization ownership is the one capability that is NOT expressible as a permission —
 * it is singular per tenant and gates transferring the organization itself. Everything else
 * goes through requirePermission(). Resolution is by the role document's isOwnerRole flag,
 * not by a JWT role string, so a minted role can never claim ownership.
 *
 * Must run after requireAuth and requireTenant.
 */
export function requireOwner(req, res, next) {
  Promise.resolve()
    .then(async () => {
      if (!req.user || !req.tenantId) {
        return sendError(res, "AUTH_REQUIRED", 401);
      }

      const role = await resolveRoleForActor(req.user, req.tenantId);

      if (!role?.isOwnerRole) {
        return sendError(res, "GENERAL_FORBIDDEN", 403);
      }

      req.role = role;
      return next();
    })
    .catch(next);
}
