// File: d:/V_personel/projects/SkillAra/SkillAra_server/cron/studentAnalyticsCron.js
import cron from "node-cron";
import Tenant from "../models/Tenant.js";
import Enrollment from "../models/Enrollment.js";
import { computeAndStoreStudentAnalytics } from "../services/studentAnalyticsService.js";
import logger from "../core/logger.js";

// Schedule: 2 AM server time daily (0 2 * * *)
cron.schedule("0 2 * * *", async () => {
  try {
    logger.info("[StudentAnalyticsCron] Starting nightly aggregation");
    const tenants = await Tenant.find({ status: "active" }).select("_id");
    for (const tenant of tenants) {
      const tenantId = tenant._id.toString();
      // Get distinct student IDs (userId) from enrollments for this tenant
      const studentIds = await Enrollment.distinct("userId", { tenantId });
      for (const studentId of studentIds) {
        await computeAndStoreStudentAnalytics(studentId, tenantId);
      }
    }
    logger.info("[StudentAnalyticsCron] Completed nightly aggregation");
  } catch (err) {
    logger.error("[StudentAnalyticsCron] Error during aggregation", err);
  }
});

export default null; // Module has side‑effects only
