import mongoose from "mongoose";

const answerSchema = new mongoose.Schema(
  {
    questionIndex: { type: Number, required: true },
    selectedAnswer: { type: String, required: true },
    isCorrect: { type: Boolean, default: false },
  },
  { _id: false }
);

const mockTestAttemptSchema = new mongoose.Schema(
  {
    mockTestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MockTest",
      required: true,
      index: true,
    },
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
    answers: [answerSchema],
    score: { type: Number, required: true },
    maxScore: { type: Number, required: true },
    percentage: { type: Number, required: true },
    passed: { type: Boolean, default: false },
    startedAt: { type: Date, required: true },
    submittedAt: { type: Date, default: Date.now },
    durationTakenSeconds: { type: Number, default: 0 },
  },
  {
    timestamps: { createdAt: "created_on", updatedAt: "updated_on" },
    collection: "mock_test_attempts",
  }
);

mockTestAttemptSchema.index({ mockTestId: 1, userId: 1, submittedAt: -1 });

const MockTestAttempt = mongoose.model("MockTestAttempt", mockTestAttemptSchema);
export default MockTestAttempt;
