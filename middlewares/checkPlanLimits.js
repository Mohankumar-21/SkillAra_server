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
        const CourseModel = mongoose.connection.models.Course;
        if (!CourseModel) return next();

        const currentCourses = await CourseModel.countDocuments({ tenantId: tenant._id });
        if (currentCourses >= maxCourses) {
          return res.status(403).send(prepareResponseMsg({}, false, LIMIT_EXCEEDED_MESSAGE, 403));
        }
      }

      if (resource.startsWith("ai:")) {
        const aiFeature = resource.split(":")[1]; // tutor, evaluation, summarization, analytics
        
        // 1. Check if AI features are enabled at all
        if (!plan.features?.aiFeatures) {
          return res.status(403).send(prepareResponseMsg({}, false, "AI features not included in your plan", 403));
        }

        // 2. Check specific feature flag if applicable
        if (aiFeature === "evaluation" && !plan.features?.evaluationEnabled) {
          return res.status(403).send(prepareResponseMsg({}, false, "AI Evaluation not included in your plan", 403));
        }
        if (aiFeature === "summarization" && !plan.features?.summarizationEnabled) {
          return res.status(403).send(prepareResponseMsg({}, false, "Content Summarization not included in your plan", 403));
        }
        if (aiFeature === "analytics" && !plan.features?.predictiveAnalyticsEnabled) {
          return res.status(403).send(prepareResponseMsg({}, false, "Predictive Analytics not included in your plan", 403));
        }

        // 3. Check monthly request limit
        const maxAI = Number(plan.features?.maxAIRequests ?? 0);
        if (maxAI > 0) { // 0 might mean unlimited for enterprise? or 0 means none. 
                         // Let's assume > 0 is a limit.
          const month = new Date().toISOString().slice(0, 7);
          const AIUsageModel = mongoose.connection.models.AIUsage;
          if (AIUsageModel) {
            const usage = await AIUsageModel.findOne({ tenantId: tenant._id, month });
            if (usage && usage.requestCount >= maxAI) {
              return res.status(403).send(prepareResponseMsg({}, false, "Monthly AI request limit reached", 403));
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

