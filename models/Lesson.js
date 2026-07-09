import mongoose from "mongoose";

const lessonSchema = new mongoose.Schema(
  {
    moduleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Module",
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    content: {
      type: String, // Markdownd or rich text content
      default: "",
    },
    assignmentInstructions: {
      type: String,
      default: "",
    },
    videoUrl: {
      type: String,
      default: "",
    },
    type: {
      type: String,
      enum: ["VIDEO", "TEXT", "QUIZ", "ASSIGNMENT"],
      default: "TEXT",
    },
    order: {
      type: Number,
      required: true,
    },
    duration: {
      type: Number, // In minutes
      default: 0,
    },
    attachments: [
      {
        name: String,
        url: String,
        type: String,
      },
    ],
  },
  {
    timestamps: { createdAt: "created_on", updatedAt: "updated_on" },
    collection: "Lesson",
  }
);

const Lesson = mongoose.model("Lesson", lessonSchema);
export default Lesson;
