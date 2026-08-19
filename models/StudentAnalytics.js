// File: d:/V_personel/projects/SkillAra/SkillAra_server/models/StudentAnalytics.js
import mongoose from "mongoose";

const StudentAnalyticsSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true, ref: "Tenant" },
  studentId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true, ref: "User" },
  totalEnrollments: { type: Number, default: 0 },
  completedCourses: { type: Number, default: 0 },
  overallProgress: { type: Number, default: 0 }, // 0‑100 percentage
  averageQuizScore: { type: Number, default: 0 }, // 0‑100 percentage
  weakTopics: [{ topicId: { type: mongoose.Schema.Types.ObjectId, ref: "Lesson" }, avgScore: Number }],
  progressPerCourse: [{ courseId: { type: mongoose.Schema.Types.ObjectId, ref: "Course" }, progressPercentage: Number }],
  updatedAt: { type: Date, default: Date.now },
});

export default mongoose.model("StudentAnalytics", StudentAnalyticsSchema);
