// File: d:/V_personel/projects/SkillAra/SkillAra_server/routes/studentDashboardRoutes.js
import express from "express";
import { requireAuth, requireTenant } from "../middlewares/auth.js";
import { getStudentProgress } from "../controllers/studentDashboardController.js";

const router = express.Router();

// Protect all student dashboard routes
router.use(requireAuth);
router.use(requireTenant);

// GET /student/dashboard - returns progress and weak area data for the logged‑in student
router.get("/", getStudentProgress);

export default router;
