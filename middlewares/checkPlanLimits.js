import mongoose from "mongoose";

import Tenant from "../models/Tenant.js";
import User from "../models/User.js";
import { getPlanById } from "../services/planService.js";
import { sendError } from "../utils/helper.js";
import { getRequestTenantId } from "../utils/requestTenant.js";

/**
 * Middleware factory to enforce plan limits before a tenant action.
 */
export function checkPlanLimits({ resource } = { resource: "users" }) {
  return async (req, res, next) => {
    try {
      if (req.user?.role === "SUPER_ADMIN") return next();

      const tenantId = getRequestTenantId(req);
      if (!tenantId) {
        return sendError(res, "AUTH_TENANT_REQUIRED", 400);
      }

      const tenant = await Tenant.findById(tenantId);
      if (!tenant) {
        return sendError(res, "TENANT_NOT_FOUND", 404);
      }

      if (!tenant.planId) {
        return sendError(res, "PLAN_LIMIT_EXCEEDED", 403);
      }

      const plan = await getPlanById(tenant.planId);
      if (!plan || plan.isActive !== true) {
        return sendError(res, "PLAN_LIMIT_EXCEEDED", 403);
      }

      if (resource === "users") {
        const maxUsers = Number(plan.features?.maxUsers ?? 0);
        const currentUsers = await User.countDocuments({ tenantId });

        if (currentUsers >= maxUsers) {
          return sendError(res, "PLAN_LIMIT_USERS", 403);
        }
      }

      if (resource === "courses") {
        const maxCourses = Number(plan.features?.maxCourses ?? 0);
        const CourseModel = mongoose.connection.models.Course;
        if (!CourseModel) return next();

        const currentCourses = await CourseModel.countDocuments({ tenantId });
        if (currentCourses >= maxCourses) {
          return sendError(res, "PLAN_LIMIT_COURSES", 403);
        }
      }

      if (resource.startsWith("ai:")) {
        const aiFeature = resource.split(":")[1];

        if (!plan.features?.aiFeatures) {
          return sendError(res, "PLAN_AI_NOT_INCLUDED", 403);
        }

        if (aiFeature === "evaluation" && !plan.features?.evaluationEnabled) {
          return sendError(res, "PLAN_AI_EVALUATION", 403);
        }
        if (aiFeature === "summarization" && !plan.features?.summarizationEnabled) {
          return sendError(res, "PLAN_AI_SUMMARIZATION", 403);
        }
        if (aiFeature === "analytics" && !plan.features?.predictiveAnalyticsEnabled) {
          return sendError(res, "PLAN_AI_ANALYTICS", 403);
        }

        const maxAI = Number(plan.features?.maxAIRequests ?? 0);
        if (maxAI > 0) {
          const month = new Date().toISOString().slice(0, 7);
          const AIUsageModel = mongoose.connection.models.AIUsage;
          if (AIUsageModel) {
            const usage = await AIUsageModel.findOne({ tenantId, month });
            if (usage && usage.requestCount >= maxAI) {
              return sendError(res, "PLAN_AI_MONTHLY_LIMIT", 403);
            }
          }
        }
      }

      return next();
    } catch (err) {
      return next(err);
    }
  };
}
