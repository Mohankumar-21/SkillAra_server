// File: d:/V_personel/projects/SkillAra/SkillAra_server/routes/analyticsRoutes.js
import express from "express";
import { requireAuth } from "../middlewares/auth.js";
import { requireTenant, requirePermission } from "../middlewares/auth.js";
import { checkPlanLimits } from "../middlewares/checkPlanLimits.js";
import { getUserGrowth, getRevenueStats, getCoursePopularity } from "../controllers/analyticsController.js";

const router = express.Router();

// All analytics endpoints are protected by authentication, plan gating, and analytics RBAC permission.
// Order: authenticate → tenant resolution → plan check (analyticsEnabled) → RBAC (specific analytics action)
router.use(
  requireAuth,
  requireTenant,
  checkPlanLimits({ resource: "analytics" }),
  requirePermission("analytics", "view")
);

router.get("/user-growth", getUserGrowth); // query: interval, startDate, endDate
router.get("/revenue", getRevenueStats); // query: interval, startDate, endDate
router.get("/course-popularity", getCoursePopularity); // query: limit

export default router;
