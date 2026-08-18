import mongoose from "mongoose";

export const VOTE_TARGET_TYPES = ["QUESTION", "ANSWER"];

const voteSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    targetType: { type: String, enum: VOTE_TARGET_TYPES, required: true },
    targetId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    value: { type: Number, enum: [1, -1], required: true },
  },
  {
    timestamps: { createdAt: "created_on", updatedAt: "updated_on" },
    collection: "forum_votes",
  }
);

/** One vote per user per target — re-voting updates this record instead of inserting another. */
voteSchema.index({ userId: 1, targetType: 1, targetId: 1 }, { unique: true });

const Vote = mongoose.model("Vote", voteSchema);
export default Vote;
