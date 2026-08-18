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

const questionSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },
    /** Optional — a question can be general forum discussion or scoped to one course. */
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      default: null,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 300 },
    body: { type: String, required: true, maxlength: 10000 },
    tags: { type: [String], default: [] },
    status: { type: String, enum: ["OPEN", "CLOSED"], default: "OPEN", index: true },
    viewCount: { type: Number, default: 0 },
    answerCount: { type: Number, default: 0 },
    voteScore: { type: Number, default: 0 },
    acceptedAnswerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Answer",
      default: null,
    },
    moderation: { type: moderationSchema, default: () => ({}) },
  },
  {
    timestamps: { createdAt: "created_on", updatedAt: "updated_on" },
    collection: "forum_questions",
  }
);

questionSchema.index({ tenantId: 1, courseId: 1, created_on: -1 });
questionSchema.index({ tenantId: 1, tags: 1 });
questionSchema.index({ title: "text", body: "text" });

const Question = mongoose.model("Question", questionSchema);
export default Question;
