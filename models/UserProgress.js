import mongoose from "mongoose";

const userProgressSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
      index: true,
    },
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },
    completedLessons: [
      {
        lessonId: mongoose.Schema.Types.ObjectId,
        timestamp: { type: Date, default: Date.now },
      },
    ],
    quizScores: [
      {
        lessonId: mongoose.Schema.Types.ObjectId,
        score: Number,
        maxScore: Number,
        timestamp: { type: Date, default: Date.now },
      },
    ],
    assignmentScores: [
      {
        submissionId: mongoose.Schema.Types.ObjectId,
        score: Number,
        timestamp: { type: Date, default: Date.now },
      },
    ],
    overallMasery: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
    collection: "user_progress",
  }
);

userProgressSchema.index({ userId: 1, courseId: 1 }, { unique: true });

const UserProgress = mongoose.model("UserProgress", userProgressSchema);
export default UserProgress;
