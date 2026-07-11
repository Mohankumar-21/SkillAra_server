/**
 * TENANT-SCOPED ROUTES — REVIEW CHECKLIST
 * All database queries in this file MUST filter by req.tenantId (set via scopeTenant middleware).
 * Never trust tenant id from req.query, req.body, or req.params.
 */
import express from "express";
import { getAiTutorResponse, generateQuiz, summarizeContent, incrementAiUsage } from "../services/aiService.js";
import { requireAuth, requireTenant } from "../middlewares/auth.js";
import { checkPlanLimits } from "../middlewares/checkPlanLimits.js";
import Lesson from "../models/Lesson.js";
import { prepareResponseMsg, sendError } from "../utils/helper.js";

const router = express.Router();

router.post("/tutor", requireAuth, requireTenant, checkPlanLimits({ resource: "ai:tutor" }), async (req, res, next) => {
  try {
    const { query, lessonId } = req.body;
    let lessonContent = "";
    if (lessonId) {
      const lesson = await Lesson.findById(lessonId);
      if (lesson) {
        lessonContent = lesson.content;
      }
    }

    const response = await getAiTutorResponse(query, lessonContent);
    await incrementAiUsage(req.tenantId);
    res.status(200).send(prepareResponseMsg({ response }, true, "AI response generated", 200));
  } catch (error) {
    return next(error);
  }
});

router.post("/generate-quiz", requireAuth, requireTenant, checkPlanLimits({ resource: "ai:quiz" }), async (req, res, next) => {
  try {
    const { lessonId, questionCount } = req.body;
    const lesson = await Lesson.findById(lessonId);

    if (!lesson) {
      return sendError(res, "LESSON_NOT_FOUND", 404);
    }

    const quiz = await generateQuiz(lesson.content, questionCount);
    await incrementAiUsage(req.tenantId);
    res.status(200).send(prepareResponseMsg(quiz, true, "Quiz generated", 200));
  } catch (error) {
    return next(error);
  }
});

router.post("/summarize", requireAuth, requireTenant, checkPlanLimits({ resource: "ai:summarization" }), async (req, res, next) => {
  try {
    const { lessonId } = req.body;
    const lesson = await Lesson.findById(lessonId);

    if (!lesson) {
      return sendError(res, "LESSON_NOT_FOUND", 404);
    }

    const summary = await summarizeContent(lesson.content);
    await incrementAiUsage(req.tenantId);
    res.status(200).send(prepareResponseMsg({ summary }, true, "Summary generated", 200));
  } catch (error) {
    return next(error);
  }
});

export default router;
