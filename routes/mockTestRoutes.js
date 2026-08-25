/**
 * TENANT-SCOPED ROUTES — REVIEW CHECKLIST
 * All database queries in this file MUST filter by req.tenantId (set via scopeTenant middleware).
 * Never trust tenant id from req.query, req.body, or req.params.
 */
import express from "express";
import { z } from "zod";
import {
  createMockTest,
  generateAndSaveMockTest,
  getAllMockTests,
  getMockTestsByCourse,
  getMockTestById,
  startMockTestAttempt,
  submitMockTest,
  getMyMockTestAttempts,
  publishMockTest,
} from "../controllers/mockTestController.js";
import { requireAuth, requireRole, requireTenant } from "../middlewares/auth.js";
import { checkPlanLimits } from "../middlewares/checkPlanLimits.js";
import { prepareResponseMsg } from "../utils/helper.js";
import { requireDb } from "../utils/db-state.js";

const router = express.Router();

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid id");

const questionSchema = z.object({
  question: z.string().min(1),
  options: z.array(z.string().min(1)).min(2),
  correctAnswer: z.string().min(1),
  explanation: z.string().optional(),
});

const createSchema = z.object({
  courseId: objectId,
  title: z.string().trim().min(1).max(200),
  description: z.string().max(2000).optional(),
  questions: z.array(questionSchema).min(1),
  durationMinutes: z.number().int().min(1).max(300).optional(),
  passingScore: z.number().min(0).max(100).optional(),
  status: z.enum(["DRAFT", "PUBLISHED"]).optional(),
});

const generateSchema = z.object({
  courseId: objectId,
  title: z.string().trim().min(1).max(200).optional(),
  questionCount: z.number().int().min(1).max(50).optional(),
  durationMinutes: z.number().int().min(1).max(300).optional(),
  passingScore: z.number().min(0).max(100).optional(),
  status: z.enum(["DRAFT", "PUBLISHED"]).optional(),
});

const submitSchema = z.object({
  startedAt: z.string().min(1),
  answers: z
    .array(
      z.object({
        questionIndex: z.number().int().min(0),
        selectedAnswer: z.string().min(1),
      })
    )
    .min(1),
});

function validateBody(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .send(prepareResponseMsg({ issues: parsed.error.issues }, false, "Validation failed", 400));
    }
    req.body = parsed.data;
    return next();
  };
}

router.post(
  "/",
  requireDb,
  requireAuth,
  requireRole("TENANT_ADMIN", "ORG_ADMIN", "TUTOR"),
  requireTenant,
  validateBody(createSchema),
  createMockTest
);

router.post(
  "/generate",
  requireDb,
  requireAuth,
  requireRole("TENANT_ADMIN", "ORG_ADMIN", "TUTOR"),
  requireTenant,
  checkPlanLimits({ resource: "ai:quiz" }),
  validateBody(generateSchema),
  generateAndSaveMockTest
);

/** Role-scoped: staff see every test, instructors see their own courses' tests, students
 *  see published tests on courses they're enrolled in. Backs the Mock Tests hub. */
router.get("/", requireDb, requireAuth, requireTenant, getAllMockTests);

router.get("/course/:courseId", requireDb, requireAuth, requireTenant, getMockTestsByCourse);

router.get("/:id", requireDb, requireAuth, requireTenant, getMockTestById);

router.post("/:id/start", requireDb, requireAuth, requireRole("STUDENT"), requireTenant, startMockTestAttempt);

router.post(
  "/:id/submit",
  requireDb,
  requireAuth,
  requireRole("STUDENT"),
  requireTenant,
  validateBody(submitSchema),
  submitMockTest
);

router.get("/:id/attempts", requireDb, requireAuth, requireTenant, getMyMockTestAttempts);

router.patch(
  "/:id/publish",
  requireDb,
  requireAuth,
  requireRole("TENANT_ADMIN", "ORG_ADMIN", "TUTOR"),
  requireTenant,
  publishMockTest
);

export default router;
