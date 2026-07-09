import mongoose from "mongoose";

const submissionSchema = new mongoose.Schema(
  {
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
      index: true,
    },
    lessonId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lesson",
      required: true,
      index: true,
    },
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },
    content: {
      type: String,
      required: true,
    },
    aiFeedback: {
      type: String,
    },
    aiScore: {
      type: Number,
      min: 0,
      max: 100,
    },
    status: {
      type: String,
      enum: ["SUBMITTED", "EVALUATED", "REJECTED"],
      default: "SUBMITTED",
    },
  },
  {
    timestamps: true,
    collection: "submissions",
  }
);

const Submission = mongoose.model("Submission", submissionSchema);
export default Submission;
