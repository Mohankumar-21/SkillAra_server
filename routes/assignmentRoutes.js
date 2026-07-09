import express from "express";
import { evaluateSubmission, incrementAiUsage } from "../services/aiService.js";
import { requireAuth, requireTenant } from "../middlewares/auth.js";
import { checkPlanLimits } from "../middlewares/checkPlanLimits.js";
import Submission from "../models/Submission.js";
import Lesson from "../models/Lesson.js";
import { prepareResponseMsg } from "../utils/helper.js";

const router = express.Router();

// Submit an assignment and get AI evaluation
router.post("/submit", requireAuth, requireTenant, checkPlanLimits({ resource: "ai:evaluation" }), async (req, res) => {
  try {
    const { courseId, lessonId, content } = req.body;
    const studentId = req.user._id;
    const tenantId = req.tenant._id;

    // 1. Fetch lesson for context (assignment requirements)
    const lesson = await Lesson.findById(lessonId);
    if (!lesson) {
      return res.status(404).send(prepareResponseMsg({}, false, "Lesson not found", 404));
    }

    // 2. Perform AI Evaluation
    const evaluation = await evaluateSubmission(content, lesson.content);
    
    // 3. Save submission
    const submission = new Submission({
      courseId,
      lessonId,
      studentId,
      tenantId,
      content,
      aiFeedback: evaluation.feedback,
      aiScore: evaluation.score,
      status: "EVALUATED",
    });

    await submission.save();
    await incrementAiUsage(tenantId);

    // 4. Update UserProgress (optional, could be done via a service)
    const UserProgressModel = (await import("../models/UserProgress.js")).default;
    await UserProgressModel.findOneAndUpdate(
      { userId: studentId, courseId, tenantId },
      { 
        $push: { assignmentScores: { submissionId: submission._id, score: evaluation.score } } 
      },
      { upsert: true }
    );

    res.status(201).send(prepareResponseMsg(submission, true, "Assignment submitted and evaluated", 201));
  } catch (error) {
    console.error("Submission error:", error);
    res.status(500).send(prepareResponseMsg({}, false, error.message, 500));
  }
});

// Get submissions for a student
router.get("/my-submissions", requireAuth, requireTenant, async (req, res) => {
  try {
    const submissions = await Submission.find({ 
      studentId: req.user._id, 
      tenantId: req.tenant._id 
    }).sort({ createdAt: -1 });
    
    res.status(200).send(prepareResponseMsg(submissions, true, "Submissions fetched", 200));
  } catch (error) {
    res.status(500).send(prepareResponseMsg({}, false, error.message, 500));
  }
});

export default router;
