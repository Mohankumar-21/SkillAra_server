import mongoose from "mongoose";

import Tenant from "../models/Tenant.js";
import User from "../models/User.js";
import { getPlanById } from "../services/planService.js";
import { sendError } from "../utils/helper.js";
import { getRequestTenantId } from "../utils/requestTenant.js";

/**
 * Returns the current calendar month string "YYYY-MM" in UTC.
 */
function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

/**
 * Count documents for `model` matching `filter` where createdAt is within the current month.
 * Returns 0 if the model is not registered.
 */
async function countThisMonth(modelName, filter) {
  const Model = mongoose.connection.models[modelName];
  if (!Model) return 0;
  const start = new Date(`${currentMonth()}-01T00:00:00.000Z`);
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);
  return Model.countDocuments({ ...filter, createdAt: { $gte: start, $lt: end } });
}

/**
 * Middleware factory to enforce plan limits before a tenant action.
 *
 * Supported `resource` values:
 *   "users"                    — max total user accounts
 *   "courses"                  — max total courses
 *   "storage"                  — max storage used (MB)
 *   "live-sessions"            — liveClassesEnabled + maxLiveSessionsPerMonth
 *   "session-slots"            — reads req.body.sessionType:
 *                                  MENTORSHIP  → mentorshipEnabled + maxMentorshipSlotsPerMonth
 *                                  MOCK_INTERVIEW → mockInterviewsEnabled + maxMentorshipSlotsPerMonth
 *   "mentorship"               — mentorshipEnabled flag only
 *   "community"                — communityEnabled flag only
 *   "analytics"                — analyticsEnabled flag only
 *   "ai:<feature>"             — aiFeatures + per-feature + monthly credit cap
 *
 * Super Admins always bypass all checks.
 */
export function checkPlanLimits({ resource } = { resource: "users" }) {
  return async (req, res, next) => {
    try {
      // Super Admin bypasses all plan checks
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

      const f = plan.features || {};

      /* ------------------------------------------------------------------ *
       * users — total user accounts pooled across the tenant
       * ------------------------------------------------------------------ */
      if (resource === "users") {
        // Prefer maxStudents/maxInstructors granular caps if available, else fall back to maxUsers
        const maxUsers = Number(f.maxStudents ?? f.maxUsers ?? 0);
        const currentUsers = await User.countDocuments({ tenantId });
        if (currentUsers >= maxUsers) {
          return sendError(res, "PLAN_LIMIT_USERS", 403);
        }
      }

      /* ------------------------------------------------------------------ *
       * courses — total courses pooled across all instructors
       * ------------------------------------------------------------------ */
      if (resource === "courses") {
        const maxCourses = Number(f.maxCourses ?? 0);
        if (maxCourses === 0) return sendError(res, "PLAN_LIMIT_COURSES", 403);
        const CourseModel = mongoose.connection.models.Course;
        if (!CourseModel) return next();
        const currentCourses = await CourseModel.countDocuments({ tenantId });
        if (currentCourses >= maxCourses) {
          return sendError(res, "PLAN_LIMIT_COURSES", 403);
        }
      }

      /* ------------------------------------------------------------------ *
       * storage — tenant-level running total vs plan storageLimit (MB)
       * ------------------------------------------------------------------ */
      if (resource === "storage") {
        const limitMb = f.storageLimit != null ? Number(f.storageLimit) : null;
        if (limitMb !== null) {
          const usedMb = Number(tenant.storageUsedMb ?? 0);
          if (usedMb >= limitMb) {
            return sendError(res, "PLAN_LIMIT_STORAGE", 403);
          }
        }
        // null storageLimit = unlimited → pass
      }

      /* ------------------------------------------------------------------ *
       * live-sessions — feature flag + monthly session count
       * ------------------------------------------------------------------ */
      if (resource === "live-sessions") {
        if (!f.liveClassesEnabled) {
          return sendError(res, "PLAN_LIVE_CLASSES_DISABLED", 403);
        }
        const maxPerMonth = f.maxLiveSessionsPerMonth != null ? Number(f.maxLiveSessionsPerMonth) : null;
        if (maxPerMonth !== null) {
          const used = await countThisMonth("LiveSession", { tenantId });
          if (used >= maxPerMonth) {
            return sendError(res, "PLAN_LIMIT_LIVE_SESSIONS", 403);
          }
        }
      }

      /* ------------------------------------------------------------------ *
       * session-slots — gate on sessionType in request body
       * Expects validateBody to have run first so req.body.sessionType is clean.
       * ------------------------------------------------------------------ */
      if (resource === "session-slots") {
        const sessionType = req.body?.sessionType;

        if (sessionType === "MENTORSHIP") {
          if (!f.mentorshipEnabled) {
            return sendError(res, "PLAN_MENTORSHIP_DISABLED", 403);
          }
          const maxSlots = f.maxMentorshipSlotsPerMonth != null ? Number(f.maxMentorshipSlotsPerMonth) : null;
          if (maxSlots !== null) {
            const used = await countThisMonth("SessionSlot", { tenantId, sessionType: "MENTORSHIP" });
            if (used >= maxSlots) {
              return sendError(res, "PLAN_LIMIT_MENTORSHIP_SLOTS", 403);
            }
          }
        } else if (sessionType === "MOCK_INTERVIEW") {
          if (!f.mockInterviewsEnabled) {
            return sendError(res, "PLAN_MOCK_INTERVIEWS_DISABLED", 403);
          }
          // Mock interview slots share the same monthly cap pool as mentorship slots
          const maxSlots = f.maxMentorshipSlotsPerMonth != null ? Number(f.maxMentorshipSlotsPerMonth) : null;
          if (maxSlots !== null) {
            const usedMentorship = await countThisMonth("SessionSlot", { tenantId, sessionType: "MENTORSHIP" });
            const usedMock = await countThisMonth("SessionSlot", { tenantId, sessionType: "MOCK_INTERVIEW" });
            if (usedMentorship + usedMock >= maxSlots) {
              return sendError(res, "PLAN_LIMIT_MENTORSHIP_SLOTS", 403);
            }
          }
        }
        // Unknown sessionType → let the controller handle it
      }

      /* ------------------------------------------------------------------ *
       * mentorship — feature flag gate only (for profile / request creation)
       * ------------------------------------------------------------------ */
      if (resource === "mentorship") {
        if (!f.mentorshipEnabled) {
          return sendError(res, "PLAN_MENTORSHIP_DISABLED", 403);
        }
      }

      /* ------------------------------------------------------------------ *
       * community — feature flag gate for forum posting (reads are free)
       * ------------------------------------------------------------------ */
      if (resource === "community") {
        if (!f.communityEnabled) {
          return sendError(res, "PLAN_COMMUNITY_DISABLED", 403);
        }
      }

      /* ------------------------------------------------------------------ *
       * analytics — feature flag gate
       * ------------------------------------------------------------------ */
      if (resource === "analytics") {
        const enabled = Boolean(f.analyticsEnabled || f.analyticsAccess);
        if (!enabled) {
          return sendError(res, "PLAN_ANALYTICS_DISABLED", 403);
        }
      }

      /* ------------------------------------------------------------------ *
       * ai:<feature> — aiFeatures flag + per-feature + monthly credit cap
       * ------------------------------------------------------------------ */
      if (resource.startsWith("ai:")) {
        const aiFeature = resource.split(":")[1];

        if (!f.aiFeatures) {
          return sendError(res, "PLAN_AI_NOT_INCLUDED", 403);
        }

        if (aiFeature === "evaluation" && !f.evaluationEnabled) {
          return sendError(res, "PLAN_AI_EVALUATION", 403);
        }
        if (aiFeature === "summarization" && !f.summarizationEnabled) {
          return sendError(res, "PLAN_AI_SUMMARIZATION", 403);
        }
        if (aiFeature === "analytics" && !f.predictiveAnalyticsEnabled) {
          return sendError(res, "PLAN_AI_ANALYTICS", 403);
        }

        // Monthly credit cap: prefer aiCredits, fall back to maxAIRequests
        const maxAI = f.aiCredits != null ? Number(f.aiCredits) : Number(f.maxAIRequests ?? 0);
        if (maxAI > 0) {
          const month = currentMonth();
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

/**
 * Increment tenant storage usage after a successful upload.
 * `bytes` is the raw file size in bytes.
 * Safe to call fire-and-forget; errors are silently swallowed to avoid
 * failing a request that already succeeded.
 */
export async function incrementTenantStorage(tenantId, bytes) {
  if (!tenantId || !bytes || bytes <= 0) return;
  try {
    const mb = bytes / (1024 * 1024);
    await Tenant.findByIdAndUpdate(tenantId, { $inc: { storageUsedMb: mb } });
  } catch {
    // Non-fatal: tracking failure should not break uploads
  }
}

/**
 * Decrement tenant storage usage after a successful deletion.
 * `bytes` is the deleted file's size in bytes.
 */
export async function decrementTenantStorage(tenantId, bytes) {
  if (!tenantId || !bytes || bytes <= 0) return;
  try {
    const mb = bytes / (1024 * 1024);
    await Tenant.findByIdAndUpdate(tenantId, { $inc: { storageUsedMb: -mb }, $max: { storageUsedMb: 0 } });
  } catch {
    // Non-fatal
  }
}
