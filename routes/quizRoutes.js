import express from "express";
import { z } from "zod";
import {
  createQuiz,
  generateAndSaveQuiz,
  getQuizByLesson,
  getQuizById,
  submitQuiz,
  getMyAttempts,
  publishQuiz,
} from "../controllers/quizController.js";
import { requireAuth, requireRole, requireTenant } from "../middlewares/auth.js";
import { checkPlanLimits } from "../middlewares/checkPlanLimits.js";
import { prepareResponseMsg } from "../utils/helper.js";
import { requireDb } from "../utils/db-state.js";

const router = express.Router();

const questionSchema = z.object({
  question: z.string().min(1),
  options: z.array(z.string().min(1)).min(2),
  correctAnswer: z.string().min(1),
  explanation: z.string().optional(),
});

const createQuizSchema = z.object({
  lessonId: z.string().regex(/^[0-9a-fA-F]{24}$/),
  title: z.string().trim().min(1).max(200),
  questions: z.array(questionSchema).min(1),
  timeLimitMinutes: z.number().int().min(0).optional(),
  passingScore: z.number().min(0).max(100).optional(),
  status: z.enum(["DRAFT", "PUBLISHED"]).optional(),
});

const generateQuizSchema = z.object({
  lessonId: z.string().regex(/^[0-9a-fA-F]{24}$/),
  questionCount: z.number().int().min(1).max(20).optional(),
  title: z.string().trim().min(1).max(200).optional(),
  passingScore: z.number().min(0).max(100).optional(),
  status: z.enum(["DRAFT", "PUBLISHED"]).optional(),
});

const submitSchema = z.object({
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
        .send(
          prepareResponseMsg({ issues: parsed.error.issues }, false, "Validation failed", 400)
        );
    }
    req.body = parsed.data;
    return next();
  };
}

router.post(
  "/",
  requireDb,
  requireAuth,
  requireRole("TENANT_ADMIN", "TUTOR"),
  requireTenant,
  validateBody(createQuizSchema),
  createQuiz
);

router.post(
  "/generate",
  requireDb,
  requireAuth,
  requireRole("TENANT_ADMIN", "TUTOR"),
  requireTenant,
  checkPlanLimits({ resource: "ai:quiz" }),
  validateBody(generateQuizSchema),
  generateAndSaveQuiz
);

router.get(
  "/lesson/:lessonId",
  requireDb,
  requireAuth,
  requireTenant,
  getQuizByLesson
);

router.get("/:id", requireDb, requireAuth, requireTenant, getQuizById);

router.post(
  "/:id/submit",
  requireDb,
  requireAuth,
  requireRole("STUDENT"),
  requireTenant,
  validateBody(submitSchema),
  submitQuiz
);

router.get("/:id/attempts", requireDb, requireAuth, requireTenant, getMyAttempts);

router.patch(
  "/:id/publish",
  requireDb,
  requireAuth,
  requireRole("TENANT_ADMIN", "TUTOR"),
  requireTenant,
  publishQuiz
);

export default router;
