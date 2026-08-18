import mongoose from "mongoose";

const moderationSchema = new mongoose.Schema(
  {
    isHidden: { type: Boolean, default: false },
    reason: { type: String, default: "" },
    by: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    at: { type: Date, default: null },
  },
  { _id: false }
);

const answerSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },
    questionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Question",
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    body: { type: String, required: true, maxlength: 10000 },
    isAccepted: { type: Boolean, default: false },
    voteScore: { type: Number, default: 0 },
    moderation: { type: moderationSchema, default: () => ({}) },
  },
  {
    timestamps: { createdAt: "created_on", updatedAt: "updated_on" },
    collection: "forum_answers",
  }
);

answerSchema.index({ questionId: 1, created_on: 1 });

const Answer = mongoose.model("Answer", answerSchema);
export default Answer;
