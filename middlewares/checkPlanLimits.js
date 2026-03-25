import mongoose from "mongoose";

import Plan from "../models/Plan.js";
import User from "../models/User.js";
import { prepareResponseMsg } from "../utils/helper.js";

const LIMIT_EXCEEDED_MESSAGE = "Plan limit exceeded. Upgrade required.";

/**
 * Middleware factory to enforce plan limits before a tenant action.
 *
 * Usage examples (future endpoints):
 *   router.post("/users", checkPlanLimits({ resource: "users" }), ...)
 *   router.post("/courses", checkPlanLimits({ resource: "courses" }), ...)
 */
export function checkPlanLimits({ resource } = { resource: "users" }) {
  return async (req, res, next) => {
    try {
      // Let super admin bypass tenant limits.
      if (req.user?.role === "SUPER_ADMIN") return next();

      const tenant = req.tenant;
      if (!tenant) {
        return res.status(400).send(
          prepareResponseMsg({}, false, "Tenant context required", 400)
        );
      }

      if (!tenant.planId) {
        return res.status(403).send(prepareResponseMsg({}, false, LIMIT_EXCEEDED_MESSAGE, 403));
      }

      const plan = await Plan.findById(tenant.planId);
      if (!plan || plan.isActive !== true) {
        return res.status(403).send(prepareResponseMsg({}, false, LIMIT_EXCEEDED_MESSAGE, 403));
      }

      if (resource === "users") {
        const maxUsers = Number(plan.features?.maxUsers ?? 0);
        const currentUsers = await User.countDocuments({ tenantId: tenant._id });

        if (currentUsers >= maxUsers) {
          return res.status(403).send(
            prepareResponseMsg({}, false, LIMIT_EXCEEDED_MESSAGE, 403)
          );
        }
      }

      if (resource === "courses") {
        const maxCourses = Number(plan.features?.maxCourses ?? 0);

        // Course model may not exist yet in this codebase.
        const CourseModel = mongoose.connection.models.Course;
        if (!CourseModel) return next();

        const currentCourses = await CourseModel.countDocuments({ tenantId: tenant._id });
        if (currentCourses >= maxCourses) {
          return res.status(403).send(
            prepareResponseMsg({}, false, LIMIT_EXCEEDED_MESSAGE, 403)
          );
        }
      }

      return next();
    } catch (err) {
      return next(err);
    }
  };
}

