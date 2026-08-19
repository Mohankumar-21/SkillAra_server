// File: d:/V_personel/projects/SkillAra/SkillAra_server/controllers/studentDashboardController.js
import StudentAnalytics from "../models/StudentAnalytics.js";
import { sendError } from "../utils/helper.js";

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
    });
  } catch (err) {
    console.error(err);
    return sendError(res, "GENERAL_SERVER_ERROR", 500);
  }
}
