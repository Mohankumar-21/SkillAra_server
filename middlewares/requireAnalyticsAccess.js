// File: d:/V_personel/projects/SkillAra/SkillAra_server/middlewares/requireAnalyticsAccess.js
/**
 * Middleware to enforce analytics access permission.
 * Expects that authentication middleware has already populated req.user.
 * Checks if the user has the "analytics" permission with "view" action.
 */
export function requireAnalyticsAccess(req, res, next) {
  try {
    const permissions = req.user?.permissions || {};
    const analyticsActions = permissions["analytics"] || [];
    if (analyticsActions.includes("view")) {
      return next();
    }
    // Fallback: check for a direct flag on the user (e.g., analyticsAccess) for legacy plans
    if (req.user?.analyticsAccess) {
      return next();
    }
    const { sendError } = require("../utils/helper.js");
    return sendError(res, "FORBIDDEN_ANALYTICS_ACCESS", 403);
  } catch (err) {
    const { sendError } = require("../utils/helper.js");
    return sendError(res, "ANALYTICS_MIDDLEWARE_ERROR", 500);
  }
}
