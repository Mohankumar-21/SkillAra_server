import MockTest from "../models/MockTest.js";
import MockTestAttempt from "../models/MockTestAttempt.js";
import Course from "../models/Course.js";
import Module from "../models/Module.js";
import Lesson from "../models/Lesson.js";
import Enrollment from "../models/Enrollment.js";
import UserProgress from "../models/UserProgress.js";
import { generateQuiz, incrementAiUsage } from "../services/aiService.js";
import { prepareResponseMsg, sendError } from "../utils/helper.js";
import { getActor, canModerateCourses } from "../utils/actor.js";

function normalizeAiQuestions(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw?.questions && Array.isArray(raw.questions)) return raw.questions;
  if (raw?.quiz && Array.isArray(raw.quiz)) return raw.quiz;
  return [];
}

function sanitizeForStudent(doc) {
  const t = doc.toObject ? doc.toObject() : doc;
  return {
    id: t._id,
    courseId: t.courseId,
    title: t.title,
    description: t.description,
    questions: t.questions.map((q) => ({ question: q.question, options: q.options })),
    durationMinutes: t.durationMinutes,
    passingScore: t.passingScore,
    status: t.status,
    source: t.source,
  };
}

function sanitizeForStaff(doc) {
  const t = doc.toObject ? doc.toObject() : doc;
  return {
    id: t._id,
    courseId: t.courseId,
    title: t.title,
    description: t.description,
    questions: t.questions,
    durationMinutes: t.durationMinutes,
    passingScore: t.passingScore,
    status: t.status,
    source: t.source,
    createdBy: t.createdBy,
    created_on: t.created_on,
  };
}

async function resolveCourseContext(courseId, tenantId) {
  return Course.findOne({ _id: courseId, tenantId });
}

async function assertCourseAccess(actor, course) {
  if (canModerateCourses(actor)) return true;
  return String(course.instructorId) === String(actor.id);
}

function gradeMockTest(questions, answers) {
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

async function aggregateCourseContent(courseId) {
  const modules = await Module.find({ courseId }).select("_id");
  const lessons = await Lesson.find({ moduleId: { $in: modules.map((m) => m._id) } })
    .select("title content")
    .limit(30);
  return lessons.map((l) => `${l.title}\n${l.content || ""}`).join("\n\n").slice(0, 12000);
}

export async function createMockTest(req, res, next) {
  try {
    const actor = getActor(req);
    const { courseId, title, description, questions, durationMinutes, passingScore, status } =
      req.body;

    const course = await resolveCourseContext(courseId, req.tenantId);
    if (!course) return sendError(res, "COURSE_NOT_FOUND", 404);
    if (!(await assertCourseAccess(actor, course))) return sendError(res, "COURSE_FORBIDDEN", 403);

    const mockTest = await MockTest.create({
      courseId,
      tenantId: req.tenantId,
      title,
      description: description || "",
      questions,
      durationMinutes: durationMinutes || 30,
      passingScore: passingScore ?? 60,
      status: status || "DRAFT",
      source: "MANUAL",
      createdBy: actor.id,
    });

    return res
      .status(201)
      .send(
        prepareResponseMsg(
          { mockTest: sanitizeForStaff(mockTest) },
          true,
          "Mock test created successfully",
          201
        )
      );
  } catch (err) {
    return next(err);
  }
}

export async function generateAndSaveMockTest(req, res, next) {
  try {
    const actor = getActor(req);
    const { courseId, title, questionCount, durationMinutes, passingScore, status } = req.body;

    const course = await resolveCourseContext(courseId, req.tenantId);
    if (!course) return sendError(res, "COURSE_NOT_FOUND", 404);
    if (!(await assertCourseAccess(actor, course))) return sendError(res, "COURSE_FORBIDDEN", 403);

    const content = await aggregateCourseContent(courseId);
    if (!content) {
      return sendError(res, "MOCK_TEST_NO_CONTENT", 400);
    }

    const raw = await generateQuiz(content, questionCount || 10);
    const questions = normalizeAiQuestions(raw);
    if (!questions.length) {
      return sendError(res, "AI_SERVICE_ERROR", 500);
    }

    await incrementAiUsage(req.tenantId);

    const mockTest = await MockTest.create({
      courseId,
      tenantId: req.tenantId,
      title: title || `Mock Test: ${course.title}`,
      questions,
      durationMinutes: durationMinutes || 30,
      passingScore: passingScore ?? 60,
      status: status || "PUBLISHED",
      source: "AI",
      createdBy: actor.id,
    });

    return res
      .status(201)
      .send(
        prepareResponseMsg(
          { mockTest: sanitizeForStaff(mockTest) },
          true,
          "Mock test generated and saved",
          201
        )
      );
  } catch (err) {
    return next(err);
  }
}

export async function getMockTestsByCourse(req, res, next) {
  try {
    const { courseId } = req.params;
    const actor = getActor(req);

    const course = await resolveCourseContext(courseId, req.tenantId);
    if (!course) return sendError(res, "COURSE_NOT_FOUND", 404);

    const isStaff = canModerateCourses(actor) || String(course.instructorId) === String(actor.id);
    const filter = { courseId, tenantId: req.tenantId };
    if (!isStaff) filter.status = "PUBLISHED";

    const mockTests = await MockTest.find(filter).sort({ created_on: -1 });
    const data = mockTests.map(isStaff ? sanitizeForStaff : sanitizeForStudent);

    return res.status(200).send(prepareResponseMsg(data, true, "Mock tests fetched", 200));
  } catch (err) {
    return next(err);
  }
}

/** GET /api/mock-tests — every mock test in the tenant, across all courses. Staff oversight only. */
export async function getAllMockTests(req, res, next) {
  try {
    const { status, courseId } = req.query;
    const filter = { tenantId: req.tenantId };
    if (status) filter.status = status;
    if (courseId) filter.courseId = courseId;

    const mockTests = await MockTest.find(filter)
      .populate("courseId", "title")
      .sort({ created_on: -1 })
      .limit(500);

    return res
      .status(200)
      .send(prepareResponseMsg(mockTests.map(sanitizeForStaff), true, "Mock tests fetched", 200));
  } catch (err) {
    return next(err);
  }
}

export async function getMockTestById(req, res, next) {
  try {
    const mockTest = await MockTest.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!mockTest) return sendError(res, "MOCK_TEST_NOT_FOUND", 404);

    const actor = getActor(req);
    const course = await Course.findById(mockTest.courseId).select("instructorId");
    const isStaff =
      canModerateCourses(actor) || String(course?.instructorId) === String(actor.id);

    if (!isStaff && mockTest.status !== "PUBLISHED") {
      return sendError(res, "MOCK_TEST_NOT_FOUND", 404);
    }

    const data = isStaff ? sanitizeForStaff(mockTest) : sanitizeForStudent(mockTest);
    return res.status(200).send(prepareResponseMsg({ mockTest: data }, true, "Mock test fetched", 200));
  } catch (err) {
    return next(err);
  }
}

/** POST /:id/start — hands back a server-stamped start time the client must echo on submit. */
export async function startMockTestAttempt(req, res, next) {
  try {
    const mockTest = await MockTest.findOne({
      _id: req.params.id,
      tenantId: req.tenantId,
      status: "PUBLISHED",
    });
    if (!mockTest) return sendError(res, "MOCK_TEST_NOT_FOUND", 404);

    const enrollment = await Enrollment.findOne({
      userId: getActor(req).id,
      courseId: mockTest.courseId,
      tenantId: req.tenantId,
      status: { $in: ["ACTIVE", "COMPLETED"] },
    });
    if (!enrollment) return sendError(res, "ENROLLMENT_REQUIRED", 403);

    return res.status(200).send(
      prepareResponseMsg(
        { startedAt: new Date().toISOString(), durationMinutes: mockTest.durationMinutes },
        true,
        "Attempt started",
        200
      )
    );
  } catch (err) {
    return next(err);
  }
}

export async function submitMockTest(req, res, next) {
  try {
    const mockTest = await MockTest.findOne({
      _id: req.params.id,
      tenantId: req.tenantId,
      status: "PUBLISHED",
    });
    if (!mockTest) return sendError(res, "MOCK_TEST_NOT_FOUND", 404);

    const actor = getActor(req);
    const enrollment = await Enrollment.findOne({
      userId: actor.id,
      courseId: mockTest.courseId,
      tenantId: req.tenantId,
      status: { $in: ["ACTIVE", "COMPLETED"] },
    });
    if (!enrollment) return sendError(res, "ENROLLMENT_REQUIRED", 403);

    const { answers, startedAt } = req.body;
    const startedAtDate = new Date(startedAt);
    const submittedAt = new Date();
    const durationTakenSeconds = Math.max(
      0,
      Math.round((submittedAt.getTime() - startedAtDate.getTime()) / 1000)
    );

    // Generous grace window (2 min) over the stated limit — a hard client-trusted clock
    // can't be relied on for exact enforcement, only for catching obviously stale attempts.
    const maxAllowedSeconds = mockTest.durationMinutes * 60 + 120;
    if (!Number.isFinite(startedAtDate.getTime()) || durationTakenSeconds > maxAllowedSeconds) {
      return sendError(res, "MOCK_TEST_TIME_EXPIRED", 400);
    }

    const { graded, score, maxScore, percentage } = gradeMockTest(mockTest.questions, answers);
    const passed = percentage >= mockTest.passingScore;

    const attempt = await MockTestAttempt.create({
      mockTestId: mockTest._id,
      userId: actor.id,
      courseId: mockTest.courseId,
      tenantId: req.tenantId,
      answers: graded,
      score,
      maxScore,
      percentage,
      passed,
      startedAt: startedAtDate,
      submittedAt,
      durationTakenSeconds,
    });

    await UserProgress.findOneAndUpdate(
      { userId: actor.id, courseId: mockTest.courseId, tenantId: req.tenantId },
      { $setOnInsert: { completedLessons: [], quizScores: [], assignmentScores: [] } },
      { upsert: true }
    );

    const results = graded.map((a) => ({
      questionIndex: a.questionIndex,
      selectedAnswer: a.selectedAnswer,
      isCorrect: a.isCorrect,
      correctAnswer: mockTest.questions[a.questionIndex]?.correctAnswer,
      explanation: mockTest.questions[a.questionIndex]?.explanation || "",
    }));

    return res.status(201).send(
      prepareResponseMsg(
        { attemptId: attempt._id, score, maxScore, percentage, passed, durationTakenSeconds, results },
        true,
        "Mock test submitted",
        201
      )
    );
  } catch (err) {
    return next(err);
  }
}

export async function getMyMockTestAttempts(req, res, next) {
  try {
    const filter = { mockTestId: req.params.id, tenantId: req.tenantId };
    if (req.user.role === "STUDENT") filter.userId = getActor(req).id;

    const attempts = await MockTestAttempt.find(filter)
      .populate("userId", "name email")
      .sort({ submittedAt: -1 });

    return res.status(200).send(prepareResponseMsg(attempts, true, "Attempts fetched", 200));
  } catch (err) {
    return next(err);
  }
}

export async function publishMockTest(req, res, next) {
  try {
    const mockTest = await MockTest.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!mockTest) return sendError(res, "MOCK_TEST_NOT_FOUND", 404);

    const actor = getActor(req);
    const course = await Course.findById(mockTest.courseId).select("instructorId");
    if (!(await assertCourseAccess(actor, course))) return sendError(res, "COURSE_FORBIDDEN", 403);

    mockTest.status = "PUBLISHED";
    await mockTest.save();

    return res
      .status(200)
      .send(prepareResponseMsg({ mockTest: sanitizeForStaff(mockTest) }, true, "Mock test published", 200));
  } catch (err) {
    return next(err);
  }
}
