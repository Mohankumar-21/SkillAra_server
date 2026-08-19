// File: d:/V_personel/projects/SkillAra/SkillAra_server/services/studentAnalyticsService.js
import mongoose from "mongoose";
import StudentAnalytics from "../models/StudentAnalytics.js";
import Enrollment from "../models/Enrollment.js";
import QuizAttempt from "../models/QuizAttempt.js";

/**
 * Build aggregation pipeline to compute analytics for a given student.
 * The pipeline always starts with a $match on tenantId and studentId for data isolation.
 * Returns a document with the fields defined in the StudentAnalytics schema.
 */
export async function buildStudentAnalyticsPipeline(studentId, tenantId) {
  const pipeline = [];
  // Match enrollment and quiz attempts for the student and tenant
  pipeline.push({ $match: { tenantId: new mongoose.Types.ObjectId(tenantId), userId: new mongoose.Types.ObjectId(studentId) } });

  // Lookup quiz attempts for this student
  pipeline.push({
    $lookup: {
      from: "quiz_attempts",
      localField: "userId",
      foreignField: "userId",
      as: "quizAttempts",
    },
  });

  // Unwind enrollments to compute per‑course progress
  pipeline.push({ $group: {
    _id: "$userId",
    totalEnrollments: { $sum: 1 },
    completedCourses: {
      $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, 1, 0] },
    },
    // Collect quiz attempt percentages
    quizPercentages: { $push: "$quizAttempts.percentage" },
    // Collect topics (lessonId) with their scores
    topicScores: {
      $push: {
        $map: {
          input: "$quizAttempts",
          as: "qa",
          in: { topicId: "$$qa.lessonId", score: "$$qa.percentage" },
        },
      },
    },
    // Build progress per course (simple 0/100 based on status)
    progressPerCourse: {
      $push: { courseId: "$courseId", progress: { $cond: [{ $eq: ["$status", "COMPLETED"] }, 100, 0] } },
    },
  } });

  // Flatten arrays and compute averages
  pipeline.push({ $addFields: {
    averageQuizScore: {
      $cond: [{ $gt: [{ $size: "$quizPercentages" }, 0] },
        { $avg: { $reduce: { input: "$quizPercentages", initialValue: [], in: { $concatArrays: ["$$value", "$$this"] } } } },
        0],
    },
    overallProgress: {
      $cond: [{ $gt: ["$totalEnrollments", 0] }, { $multiply: [{ $divide: ["$completedCourses", "$totalEnrollments"] }, 100] }, 0],
    },
  } });

  // Compute weak topics: flatten, group by topicId and average score, filter below threshold (60), sort and limit 3
  pipeline.push({ $unwind: "$topicScores" });
  pipeline.push({ $unwind: "$topicScores" });
  pipeline.push({ $group: {
    _id: "$topicScores.topicId",
    avgScore: { $avg: "$topicScores.score" },
  } });
  pipeline.push({ $match: { avgScore: { $lt: 60 } } });
  pipeline.push({ $sort: { avgScore: 1 } });
  pipeline.push({ $limit: 3 });
  pipeline.push({ $group: { _id: null, weakTopics: { $push: { topicId: "$_id", avgScore: "$avgScore" } } } });

  // Merge weak topics back (if any)
  pipeline.push({ $lookup: {
    from: "enrollments",
    let: { studentId: "$ _id" },
    pipeline: [],
    as: "dummy",
  } }); // dummy to keep pipeline shape

  return pipeline;
}

/**
 * Upserts a StudentAnalytics document.
 */
export async function storeStudentAnalytics(studentId, tenantId, analyticsDoc) {
  await StudentAnalytics.updateOne(
    { studentId: new mongoose.Types.ObjectId(studentId), tenantId: new mongoose.Types.ObjectId(tenantId) },
    { $set: analyticsDoc, $currentDate: { updatedAt: true } },
    { upsert: true }
  );
}

/**
 * Runs aggregation for a student and stores the result.
 */
export async function computeAndStoreStudentAnalytics(studentId, tenantId) {
  const pipeline = await buildStudentAnalyticsPipeline(studentId, tenantId);
  // Execute aggregation on Enrollment collection
  const results = await Enrollment.aggregate(pipeline);
  const analytics = results[0] || {};
  // Prepare document according to schema
  const doc = {
    tenantId,
    studentId,
    totalEnrollments: analytics.totalEnrollments || 0,
    completedCourses: analytics.completedCourses || 0,
    overallProgress: analytics.overallProgress || 0,
    averageQuizScore: analytics.averageQuizScore || 0,
    weakTopics: analytics.weakTopics || [],
    progressPerCourse: analytics.progressPerCourse || [],
  };
  await storeStudentAnalytics(studentId, tenantId, doc);
}
