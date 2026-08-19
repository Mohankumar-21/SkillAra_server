// File: d:/V_personel/projects/SkillAra/SkillAra_server/routes/analyticsRoutes.js
import express from "express";
import { requireAuth } from "../middlewares/auth.js";
import { requireAnalyticsAccess } from "../middlewares/requireAnalyticsAccess.js";
import { getUserGrowth, getRevenueStats, getCoursePopularity } from "../controllers/analyticsController.js";

const router = express.Router();

// All analytics endpoints are protected by authentication and analytics permission
router.use(requireAuth, requireAnalyticsAccess);

router.get("/user-growth", getUserGrowth); // query: interval, startDate, endDate
router.get("/revenue", getRevenueStats); // query: interval, startDate, endDate
router.get("/course-popularity", getCoursePopularity); // query: limit

export default router;
