/**
 * TENANT-SCOPED ROUTES — REVIEW CHECKLIST
 * All database queries in this file MUST filter by req.tenantId (set via scopeTenant middleware).
 * Never trust tenant id from req.query, req.body, or req.params.
 */
import express from "express";
import { evaluateSubmission, incrementAiUsage } from "../services/aiService.js";
import { requireAuth, requireTenant } from "../middlewares/auth.js";
import { checkPlanLimits } from "../middlewares/checkPlanLimits.js";
import Submission from "../models/Submission.js";
import Lesson from "../models/Lesson.js";
import { prepareResponseMsg, sendError } from "../utils/helper.js";

const router = express.Router();

router.post("/submit", requireAuth, requireTenant, checkPlanLimits({ resource: "ai:evaluation" }), async (req, res, next) => {
  try {
    const { courseId, lessonId, content } = req.body;
    const studentId = req.user._id;
    const tenantId = req.tenantId;

    const lesson = await Lesson.findById(lessonId);
    if (!lesson) {
      return sendError(res, "LESSON_NOT_FOUND", 404);
    }

    const evaluation = await evaluateSubmission(content, lesson.content);

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

    const UserProgressModel = (await import("../models/UserProgress.js")).default;
    await UserProgressModel.findOneAndUpdate(
      { userId: studentId, courseId, tenantId },
      {
        $push: { assignmentScores: { submissionId: submission._id, score: evaluation.score } },
      },
      { upsert: true }
    );

    res.status(201).send(prepareResponseMsg(submission, true, "Assignment submitted and evaluated", 201));
  } catch (error) {
    return next(error);
  }
});

router.get("/my-submissions", requireAuth, requireTenant, async (req, res, next) => {
  try {
    const submissions = await Submission.find({
      studentId: req.user._id,
      tenantId: req.tenantId,
    }).sort({ createdAt: -1 });

    res.status(200).send(prepareResponseMsg(submissions, true, "Submissions fetched", 200));
  } catch (error) {
    return next(error);
  }
});

export default router;
