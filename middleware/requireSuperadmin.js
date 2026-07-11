import { sendError } from "../utils/helper.js";

/** 403 unless the authenticated principal is a platform superadmin. */
export function requireSuperadmin(req, res, next) {
  if (req.user?.type !== "superadmin") {
    return sendError(res, "GENERAL_FORBIDDEN", 403);
  }
  return next();
}
