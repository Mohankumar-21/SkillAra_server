// File: d:/V_personel/projects/SkillAra/SkillAra_server/controllers/studentDashboardController.js
import StudentAnalytics from "../models/StudentAnalytics.js";
import Enrollment from "../models/Enrollment.js";
import MentorshipTicket from "../models/MentorshipTicket.js";
import BookableSlot from "../models/BookableSlot.js";
import LiveSession from "../models/LiveSession.js";
import MockTest from "../models/MockTest.js";
import MockTestAttempt from "../models/MockTestAttempt.js";
import { sendError } from "../utils/helper.js";

const SESSION_TYPE_LABEL = { MOCK_INTERVIEW: "Mock interview", MENTORSHIP: "Mentorship", LIVE_SESSION: "Live session" };

/** Mentorship/session/mock-test tiles for the student dashboard — kept in its own
 *  function so the analytics-missing default path and the normal path share it. */
async function getExtras(tenantId, studentId) {
  const enrollments = await Enrollment.find({
    tenantId,
    userId: studentId,
    status: { $in: ["ACTIVE", "COMPLETED"] },
  }).select("courseId");
  const courseIds = enrollments.map((e) => e.courseId);

  const [openTicketsCount, upcomingSlots, upcomingLive, attemptedIds] = await Promise.all([
    MentorshipTicket.countDocuments({ tenantId, studentId, status: { $ne: "CLOSED" } }),
    BookableSlot.find({ tenantId, studentId, status: "BOOKED", startTime: { $gte: new Date() } })
      .select("title startTime sessionType")
      .sort({ startTime: 1 })
      .limit(3),
    LiveSession.find({
      tenantId,
      courseId: { $in: courseIds },
      status: { $in: ["SCHEDULED", "LIVE"] },
      scheduledStart: { $gte: new Date() },
    })
      .select("title scheduledStart courseId")
      .populate("courseId", "title")
      .sort({ scheduledStart: 1 })
      .limit(3),
    MockTestAttempt.distinct("mockTestId", { tenantId, userId: studentId }),
  ]);

  const unattemptedMockTestsCount = await MockTest.countDocuments({
    tenantId,
    courseId: { $in: courseIds },
    status: "PUBLISHED",
    _id: { $nin: attemptedIds },
  });

  const upcomingSessions = [
    ...upcomingSlots.map((s) => ({
      id: s._id,
      title: s.title || SESSION_TYPE_LABEL[s.sessionType],
      at: s.startTime,
      type: s.sessionType,
    })),
    ...upcomingLive.map((s) => ({
      id: s._id,
      title: s.title,
      at: s.scheduledStart,
      type: "LIVE_SESSION",
      courseTitle: s.courseId?.title,
    })),
  ]
    .sort((a, b) => new Date(a.at) - new Date(b.at))
    .slice(0, 3);

  return { openTicketsCount, upcomingSessions, unattemptedMockTestsCount };
}

/**
 * GET /student/dashboard
 * Returns progress summary for the logged‑in student.
 * The analytics are pre‑computed by the nightly cron job and stored in the
 * `StudentAnalytics` collection. If no document exists yet, we return an empty
 * structure with zeros so the frontend can render gracefully.
 */
export async function getStudentProgress(req, res) {
  try {
    const tenantId = req.tenantId; // set by requireTenant middleware earlier
    const studentId = req.user?.id || req.user?._id || req.userId; // fallback identifiers

    if (!tenantId || !studentId) {
      return sendError(res, "GENERAL_BAD_REQUEST", 400);
    }

    const extras = await getExtras(tenantId, studentId);

    const analytics = await StudentAnalytics.findOne({ tenantId, studentId }).lean();
    if (!analytics) {
      // Return defaults if analytics not yet computed
      return res.json({
        totalEnrollments: 0,
        completedCourses: 0,
        overallProgress: 0,
        averageQuizScore: 0,
        weakTopics: [],
        progressPerCourse: [],
        ...extras,
      });
    }

    // Strip internal fields
    const {
      totalEnrollments,
      completedCourses,
      overallProgress,
      averageQuizScore,
      weakTopics,
      progressPerCourse,
    } = analytics;
    return res.json({
      totalEnrollments,
      completedCourses,
      overallProgress,
      averageQuizScore,
      weakTopics,
      progressPerCourse,
      ...extras,
    });
  } catch (err) {
    console.error(err);
    return sendError(res, "GENERAL_SERVER_ERROR", 500);
  }
}
