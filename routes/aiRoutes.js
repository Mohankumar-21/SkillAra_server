import express from "express";
import { getAiTutorResponse, generateQuiz, summarizeContent, incrementAiUsage } from "../services/aiService.js";
import { requireAuth, requireTenant } from "../middlewares/auth.js";
import { checkPlanLimits } from "../middlewares/checkPlanLimits.js";
import Lesson from "../models/Lesson.js";
import { prepareResponseMsg } from "../utils/helper.js";

const router = express.Router();

// AI Tutor - Get a response to a query
router.post("/tutor", requireAuth, requireTenant, checkPlanLimits({ resource: "ai:tutor" }), async (req, res) => {
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
    await incrementAiUsage(req.tenant._id);
    res.status(200).send(prepareResponseMsg({ response }, true, "AI response generated", 200));
  } catch (error) {
    res.status(500).send(prepareResponseMsg({}, false, error.message, 500));
  }
});

// AI Quiz Generator - Generate a quiz based on lesson content
router.post("/generate-quiz", requireAuth, requireTenant, checkPlanLimits({ resource: "ai:quiz" }), async (req, res) => {
  try {
    const { lessonId, questionCount } = req.body;
    const lesson = await Lesson.findById(lessonId);
    
    if (!lesson) {
      return res.status(404).send(prepareResponseMsg({}, false, "Lesson not found", 404));
    }

    const quiz = await generateQuiz(lesson.content, questionCount);
    await incrementAiUsage(req.tenant._id);
    res.status(200).send(prepareResponseMsg(quiz, true, "Quiz generated", 200));
  } catch (error) {
    res.status(500).send(prepareResponseMsg({}, false, error.message, 500));
  }
});

// AI Summarizer - Summarize lesson content
router.post("/summarize", requireAuth, requireTenant, checkPlanLimits({ resource: "ai:summarization" }), async (req, res) => {
  try {
    const { lessonId } = req.body;
    const lesson = await Lesson.findById(lessonId);
    
    if (!lesson) {
      return res.status(404).send(prepareResponseMsg({}, false, "Lesson not found", 404));
    }

    const summary = await summarizeContent(lesson.content);
    await incrementAiUsage(req.tenant._id);
    res.status(200).send(prepareResponseMsg({ summary }, true, "Summary generated", 200));
  } catch (error) {
    res.status(500).send(prepareResponseMsg({}, false, error.message, 500));
  }
});

export default router;
