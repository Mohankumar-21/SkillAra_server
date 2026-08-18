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

/**
 * A mock test is a full, timed test scoped to a course rather than a single lesson —
 * the same shape as Quiz, minus the lesson tie, plus a hard time limit.
 */
const mockTestSchema = new mongoose.Schema(
  {
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
    description: { type: String, default: "" },
    questions: {
      type: [questionSchema],
      validate: [(v) => v.length > 0, "Mock test must have at least one question"],
    },
    durationMinutes: { type: Number, required: true, min: 1, default: 30 },
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
    collection: "mock_tests",
  }
);

mockTestSchema.index({ courseId: 1, status: 1 });

const MockTest = mongoose.model("MockTest", mockTestSchema);
export default MockTest;
