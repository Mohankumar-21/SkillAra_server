import mongoose from "mongoose";

const questionSchema = new mongoose.Schema(
  {
    question: { type: String, required: true },
    options: [{ type: String, required: true }],
    correctAnswer: { type: String, required: true },
    explanation: { type: String, default: "" },
  },
  { _id: false }
);

const quizSchema = new mongoose.Schema(
  {
    lessonId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lesson",
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
    title: { type: String, required: true, trim: true },
    questions: {
      type: [questionSchema],
      validate: [(v) => v.length > 0, "Quiz must have at least one question"],
    },
    timeLimitMinutes: { type: Number, default: 0 },
    passingScore: { type: Number, default: 60, min: 0, max: 100 },
    source: { type: String, enum: ["MANUAL", "AI"], default: "MANUAL" },
    status: { type: String, enum: ["DRAFT", "PUBLISHED"], default: "DRAFT" },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  {
    timestamps: { createdAt: "created_on", updatedAt: "updated_on" },
    collection: "quizzes",
  }
);

quizSchema.index({ lessonId: 1, status: 1 });

const Quiz = mongoose.model("Quiz", quizSchema);
export default Quiz;
