import mongoose from "mongoose";

const moduleSchema = new mongoose.Schema(
  {
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
      index: true,
    },
    /** Denormalized so module queries can be tenant-filtered without joining upward. */
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: "",
    },
    order: {
      type: Number,
      required: true,
    },
    lessons: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Lesson",
      },
    ],
  },
  {
    timestamps: { createdAt: "created_on", updatedAt: "updated_on" },
    collection: "Module",
  }
);

moduleSchema.index({ courseId: 1, order: 1 });

const Module = mongoose.model("Module", moduleSchema);
export default Module;
