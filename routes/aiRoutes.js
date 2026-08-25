/**
 * TENANT-SCOPED ROUTES — REVIEW CHECKLIST
 * All database queries in this file MUST filter by req.tenantId (set via scopeTenant middleware).
 * Never trust tenant id from req.query, req.body, or req.params.
 */
import express from "express";
import { getAiTutorResponse, generateQuiz, summarizeContent, incrementAiUsage } from "../services/aiService.js";
import { aggregateCourseContent } from "../controllers/mockTestController.js";
import { requireAuth, requireTenant } from "../middlewares/auth.js";
import { checkPlanLimits } from "../middlewares/checkPlanLimits.js";
import Lesson from "../models/Lesson.js";
import Course from "../models/Course.js";
import Module from "../models/Module.js";
import Enrollment from "../models/Enrollment.js";
import { getActor, canModerateCourses } from "../utils/actor.js";
import { prepareResponseMsg, sendError } from "../utils/helper.js";

const router = express.Router();

router.post("/tutor", requireAuth, requireTenant, checkPlanLimits({ resource: "ai:tutor" }), async (req, res, next) => {
  try {
    const { query, lessonId } = req.body;
    let lessonContent = "";
    if (lessonId) {
      const lesson = await Lesson.findOne({ _id: lessonId, tenantId: req.tenantId });
      if (lesson) {
        const actor = getActor(req);
        
        // 1. Check if actor owns or moderates the course
        const course = await Course.findOne({ _id: lesson.courseId, tenantId: req.tenantId });
        const isOwner = course && String(course.instructorId) === String(actor?.id);
        let allowed = isOwner || canModerateCourses(actor);
        
        // 2. If not owner/moderator, check for ACTIVE or COMPLETED enrollment
        if (!allowed && course) {
          const enrolled = await Enrollment.exists({
            userId: actor.id,
            courseId: course._id,
            tenantId: req.tenantId,
            status: { $in: ["ACTIVE", "COMPLETED"] },
          });
          allowed = Boolean(enrolled);
        }
        
        if (!allowed) {
          return sendError(res, "LESSON_FORBIDDEN", 403);
        }
        
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
    const lesson = await Lesson.findOne({ _id: lessonId, tenantId: req.tenantId });

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
    const lesson = await Lesson.findOne({ _id: lessonId, tenantId: req.tenantId });

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

/**
 * POST /api/ai/course-summary — a short AI overview of a whole course (all lesson
 * content aggregated, same as the mock-test generator draws from), so a student can
 * get the gist before committing to enrol. Cached on the course document so repeat
 * views don't re-bill the AI provider; pass { regenerate: true } to force a refresh.
 */
router.post(
  "/course-summary",
  requireAuth,
  requireTenant,
  checkPlanLimits({ resource: "ai:summarization" }),
  async (req, res, next) => {
    try {
      const { courseId, regenerate } = req.body;
      const course = await Course.findOne({ _id: courseId, tenantId: req.tenantId });
      if (!course) return sendError(res, "COURSE_NOT_FOUND", 404);

      const actor = getActor(req);
      const isOwner = String(course.instructorId) === String(actor?.id);
      const isVisible = course.status === "PUBLISHED" && !course.moderation?.isBlocked;
      if (!isVisible && !isOwner && !canModerateCourses(actor)) {
        return sendError(res, "COURSE_NOT_FOUND", 404);
      }

      if (course.aiSummary && !regenerate) {
        return res.status(200).send(
          prepareResponseMsg(
            { summary: course.aiSummary, generatedAt: course.aiSummaryGeneratedAt, cached: true },
            true,
            "Summary fetched",
            200
          )
        );
      }

      const content = await aggregateCourseContent(courseId);
      if (!content) return sendError(res, "COURSE_NO_CONTENT", 400);

      const summary = await summarizeContent(content);
      course.aiSummary = summary;
      course.aiSummaryGeneratedAt = new Date();
      await course.save();
      await incrementAiUsage(req.tenantId);

      res.status(200).send(
        prepareResponseMsg(
          { summary, generatedAt: course.aiSummaryGeneratedAt, cached: false },
          true,
          "Summary generated",
          200
        )
      );
    } catch (error) {
      return next(error);
    }
  }
);

/**
 * POST /api/ai/module-summary — a short AI overview of one module's lessons, for the
 * in-course learning view. Same caching approach as course-summary. Visible to the
 * course's instructor/staff, or a student enrolled in the course.
 */
router.post(
  "/module-summary",
  requireAuth,
  requireTenant,
  checkPlanLimits({ resource: "ai:summarization" }),
  async (req, res, next) => {
    try {
      const { moduleId, regenerate } = req.body;
      const mod = await Module.findOne({ _id: moduleId, tenantId: req.tenantId });
      if (!mod) return sendError(res, "MODULE_NOT_FOUND", 404);

      const course = await Course.findOne({ _id: mod.courseId, tenantId: req.tenantId });
      if (!course) return sendError(res, "COURSE_NOT_FOUND", 404);

      const actor = getActor(req);
      const isOwner = String(course.instructorId) === String(actor?.id);
      let allowed = isOwner || canModerateCourses(actor);
      if (!allowed) {
        const enrolled = await Enrollment.exists({
          userId: actor.id,
          courseId: course._id,
          tenantId: req.tenantId,
          status: { $in: ["ACTIVE", "COMPLETED"] },
        });
        allowed = Boolean(enrolled);
      }
      if (!allowed) return sendError(res, "MODULE_NOT_FOUND", 404);

      if (mod.aiSummary && !regenerate) {
        return res.status(200).send(
          prepareResponseMsg(
            { summary: mod.aiSummary, generatedAt: mod.aiSummaryGeneratedAt, cached: true },
            true,
            "Summary fetched",
            200
          )
        );
      }

      const lessons = await Lesson.find({ moduleId, tenantId: req.tenantId })
        .select("title content")
        .limit(30);
      const content = lessons
        .map((l) => `${l.title}\n${l.content || ""}`)
        .join("\n\n")
        .slice(0, 12000);
      if (!content) return sendError(res, "COURSE_NO_CONTENT", 400);

      const summary = await summarizeContent(content);
      mod.aiSummary = summary;
      mod.aiSummaryGeneratedAt = new Date();
      await mod.save();
      await incrementAiUsage(req.tenantId);

      res.status(200).send(
        prepareResponseMsg(
          { summary, generatedAt: mod.aiSummaryGeneratedAt, cached: false },
          true,
          "Summary generated",
          200
        )
      );
    } catch (error) {
      return next(error);
    }
  }
);

export default router;
