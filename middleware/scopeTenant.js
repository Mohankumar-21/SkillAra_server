import { sendError } from "../utils/helper.js";

/**
 * Sets req.tenantId from the verified access token only.
 * NEVER read tenant id from req.query, req.body, or req.params.
 */
export function scopeTenant(req, res, next) {
  const tenantId = req.user?.tenantId;
  if (!tenantId) {
    return sendError(res, "GENERAL_FORBIDDEN", 403);
  }
  req.tenantId = tenantId;
  return next();
}
