import Quiz from "../models/Quiz.js";
import QuizAttempt from "../models/QuizAttempt.js";
import Lesson from "../models/Lesson.js";
import Module from "../models/Module.js";
import Course from "../models/Course.js";
import Enrollment from "../models/Enrollment.js";
import UserProgress from "../models/UserProgress.js";
import { generateQuiz, incrementAiUsage } from "../services/aiService.js";
import { prepareResponseMsg } from "../utils/helper.js";
import { getActor } from "../utils/actor.js";
import { recalculateMastery } from "../utils/progress.js";

function normalizeAiQuestions(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw?.questions && Array.isArray(raw.questions)) return raw.questions;
  if (raw?.quiz && Array.isArray(raw.quiz)) return raw.quiz;
  return [];
}

function sanitizeQuizForStudent(quiz) {
  const doc = quiz.toObject ? quiz.toObject() : quiz;
  return {
    id: doc._id,
    lessonId: doc.lessonId,
    courseId: doc.courseId,
    title: doc.title,
    questions: doc.questions.map((q) => ({
      question: q.question,
      options: q.options,
    })),
    timeLimitMinutes: doc.timeLimitMinutes,
    passingScore: doc.passingScore,
    status: doc.status,
    source: doc.source,
  };
}

function sanitizeQuizForInstructor(quiz) {
  const doc = quiz.toObject ? quiz.toObject() : quiz;
  return {
    id: doc._id,
    lessonId: doc.lessonId,
    courseId: doc.courseId,
    title: doc.title,
    questions: doc.questions,
    timeLimitMinutes: doc.timeLimitMinutes,
    passingScore: doc.passingScore,
    status: doc.status,
    source: doc.source,
    createdBy: doc.createdBy,
    created_on: doc.created_on,
  };
}

async function resolveLessonContext(lessonId, tenantId) {
  const lesson = await Lesson.findById(lessonId);
  if (!lesson) return null;

  const module = await Module.findById(lesson.moduleId);
  if (!module) return null;

  const course = await Course.findOne({ _id: module.courseId, tenantId });
  if (!course) return null;

  return { lesson, module, course };
}

function gradeQuiz(questions, answers) {
  const graded = answers.map((a) => {
    const q = questions[a.questionIndex];
    const isCorrect = q && a.selectedAnswer === q.correctAnswer;
    return { ...a, isCorrect: Boolean(isCorrect) };
  });
  const correct = graded.filter((a) => a.isCorrect).length;
  const maxScore = questions.length;
  const score = correct;
  const percentage = maxScore ? Math.round((score / maxScore) * 100) : 0;
  return { graded, score, maxScore, percentage };
}

export async function createQuiz(req, res, next) {
  try {
    const { lessonId, title, questions, timeLimitMinutes, passingScore, status } = req.body;
    const ctx = await resolveLessonContext(lessonId, req.tenantId);
    if (!ctx) {
      return res.status(404).send(prepareResponseMsg({}, false, "Lesson not found", 404));
    }

    const quiz = await Quiz.create({
      lessonId,
      courseId: ctx.course._id,
      tenantId: req.tenantId,
      title,
      questions,
      timeLimitMinutes: timeLimitMinutes || 0,
      passingScore: passingScore ?? 60,
      status: status || "DRAFT",
      source: "MANUAL",
      createdBy: getActor(req).id,
    });

    return res
      .status(201)
      .send(
        prepareResponseMsg(
          { quiz: sanitizeQuizForInstructor(quiz) },
          true,
          "Quiz created successfully",
          201
        )
      );
  } catch (err) {
    return next(err);
  }
}

export async function generateAndSaveQuiz(req, res, next) {
  try {
    const { lessonId, questionCount, title, passingScore, status } = req.body;
    const ctx = await resolveLessonContext(lessonId, req.tenantId);
    if (!ctx) {
      return res.status(404).send(prepareResponseMsg({}, false, "Lesson not found", 404));
    }

    const raw = await generateQuiz(ctx.lesson.content, questionCount || 5);
    const questions = normalizeAiQuestions(raw);
    if (!questions.length) {
      return res
        .status(500)
        .send(prepareResponseMsg({}, false, "Failed to generate quiz questions", 500));
    }

    await incrementAiUsage(req.tenantId);

    const quiz = await Quiz.create({
      lessonId,
      courseId: ctx.course._id,
      tenantId: req.tenantId,
      title: title || `Quiz: ${ctx.lesson.title}`,
      questions,
      passingScore: passingScore ?? 60,
      status: status || "PUBLISHED",
      source: "AI",
      createdBy: getActor(req).id,
    });

    return res
      .status(201)
      .send(
        prepareResponseMsg(
          { quiz: sanitizeQuizForInstructor(quiz) },
          true,
          "Quiz generated and saved",
          201
        )
      );
  } catch (err) {
    return next(err);
  }
}

export async function getQuizByLesson(req, res, next) {
  try {
    const { lessonId } = req.params;
    const quiz = await Quiz.findOne({
      lessonId,
      tenantId: req.tenantId,
      status: "PUBLISHED",
    }).sort({ created_on: -1 });

    if (!quiz) {
      return res.status(404).send(prepareResponseMsg({}, false, "Quiz not found", 404));
    }

    const isInstructor = ["TENANT_ADMIN", "TUTOR"].includes(req.user.role);
    const data = isInstructor ? sanitizeQuizForInstructor(quiz) : sanitizeQuizForStudent(quiz);

    return res.status(200).send(prepareResponseMsg({ quiz: data }, true, "Quiz fetched", 200));
  } catch (err) {
    return next(err);
  }
}

export async function getQuizById(req, res, next) {
  try {
    const quiz = await Quiz.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!quiz) {
      return res.status(404).send(prepareResponseMsg({}, false, "Quiz not found", 404));
    }

    const isInstructor = ["TENANT_ADMIN", "TUTOR"].includes(req.user.role);
    const data = isInstructor ? sanitizeQuizForInstructor(quiz) : sanitizeQuizForStudent(quiz);

    return res.status(200).send(prepareResponseMsg({ quiz: data }, true, "Quiz fetched", 200));
  } catch (err) {
    return next(err);
  }
}

export async function submitQuiz(req, res, next) {
  try {
    const quiz = await Quiz.findOne({
      _id: req.params.id,
      tenantId: req.tenantId,
      status: "PUBLISHED",
    });
    if (!quiz) {
      return res.status(404).send(prepareResponseMsg({}, false, "Quiz not found", 404));
    }

    const enrollment = await Enrollment.findOne({
      userId: getActor(req).id,
      courseId: quiz.courseId,
      tenantId: req.tenantId,
      status: { $in: ["ACTIVE", "COMPLETED"] },
    });
    if (!enrollment) {
      return res.status(403).send(prepareResponseMsg({}, false, "Not enrolled in this course", 403));
    }

    const { answers } = req.body;
    const { graded, score, maxScore, percentage } = gradeQuiz(quiz.questions, answers);
    const passed = percentage >= quiz.passingScore;

    const attempt = await QuizAttempt.create({
      quizId: quiz._id,
      userId: getActor(req).id,
      courseId: quiz.courseId,
      lessonId: quiz.lessonId,
      tenantId: req.tenantId,
      answers: graded,
      score,
      maxScore,
      percentage,
      passed,
    });

    let progress = await UserProgress.findOne({
      userId: getActor(req).id,
      courseId: quiz.courseId,
      tenantId: req.tenantId,
    });
    if (!progress) {
      progress = await UserProgress.create({
        userId: getActor(req).id,
        courseId: quiz.courseId,
        tenantId: req.tenantId,
        completedLessons: [],
        quizScores: [],
        assignmentScores: [],
      });
    }

    progress.quizScores.push({
      lessonId: quiz.lessonId,
      score: percentage,
      maxScore: 100,
      timestamp: new Date(),
    });

    if (passed) {
      const alreadyDone = progress.completedLessons.some(
        (cl) => String(cl.lessonId) === String(quiz.lessonId)
      );
      if (!alreadyDone) {
        progress.completedLessons.push({ lessonId: quiz.lessonId, timestamp: new Date() });
      }
    }

    await recalculateMastery(progress, quiz.courseId);
    await progress.save();

    const results = graded.map((a) => ({
      questionIndex: a.questionIndex,
      selectedAnswer: a.selectedAnswer,
      isCorrect: a.isCorrect,
      correctAnswer: quiz.questions[a.questionIndex]?.correctAnswer,
      explanation: quiz.questions[a.questionIndex]?.explanation || "",
    }));

    return res.status(201).send(
      prepareResponseMsg(
        {
          attemptId: attempt._id,
          score,
          maxScore,
          percentage,
          passed,
          results,
        },
        true,
        "Quiz submitted",
        201
      )
    );
  } catch (err) {
    return next(err);
  }
}

export async function getMyAttempts(req, res, next) {
  try {
    const filter = {
      quizId: req.params.id,
      tenantId: req.tenantId,
    };

    if (req.user.role === "STUDENT") {
      filter.userId = getActor(req).id;
    }

    const attempts = await QuizAttempt.find(filter)
      .populate("userId", "name email")
      .sort({ submittedAt: -1 });

    return res.status(200).send(prepareResponseMsg(attempts, true, "Attempts fetched", 200));
  } catch (err) {
    return next(err);
  }
}

export async function publishQuiz(req, res, next) {
  try {
    const quiz = await Quiz.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!quiz) {
      return res.status(404).send(prepareResponseMsg({}, false, "Quiz not found", 404));
    }

    quiz.status = "PUBLISHED";
    await quiz.save();

    return res
      .status(200)
      .send(
        prepareResponseMsg(
          { quiz: sanitizeQuizForInstructor(quiz) },
          true,
          "Quiz published",
          200
        )
      );
  } catch (err) {
    return next(err);
  }
}
