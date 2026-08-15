import mongoose from "mongoose";

export const LESSON_TYPES = ["VIDEO", "TEXT", "PDF", "QUIZ", "ASSIGNMENT"];
export const UPLOAD_STATUSES = ["NONE", "PENDING", "READY", "FAILED"];

/**
 * Attachments and lesson media are addressed by private B2 object key. Playback and
 * download always go through a freshly signed URL, so nothing here is directly
 * fetchable even if the document leaks.
 */
const attachmentSchema = new mongoose.Schema(
  {
    name: { type: String, default: "" },
    key: { type: String, required: true },
    mimeType: { type: String, default: "" },
    size: { type: Number, default: 0 },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const lessonSchema = new mongoose.Schema(
  {
    moduleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Module",
      required: true,
      index: true,
    },
    /** Denormalized so lesson queries can be tenant-filtered without joining upward. */
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
    title: {
      type: String,
      required: true,
      trim: true,
    },
    content: {
      type: String, // Markdown or rich text
      default: "",
    },
    assignmentInstructions: {
      type: String,
      default: "",
    },
    /** Private B2 key for the primary video/PDF asset. */
    contentKey: {
      type: String,
      default: "",
    },
    mimeType: {
      type: String,
      default: "",
    },
    fileSize: {
      type: Number,
      default: 0,
    },
    /**
     * PENDING while a presigned direct upload is in flight; READY once the object
     * has been confirmed present in the bucket.
     */
    uploadStatus: {
      type: String,
      enum: UPLOAD_STATUSES,
      default: "NONE",
    },
    /** Legacy/external video URL for lessons not backed by B2. */
    videoUrl: {
      type: String,
      default: "",
    },
    type: {
      type: String,
      enum: LESSON_TYPES,
      default: "TEXT",
    },
    order: {
      type: Number,
      required: true,
    },
    duration: {
      type: Number, // minutes
      default: 0,
    },
    /** Free preview lessons are playable without an enrollment. */
    isPreview: {
      type: Boolean,
      default: false,
    },
    attachments: {
      type: [attachmentSchema],
      default: () => [],
    },
  },
  {
    timestamps: { createdAt: "created_on", updatedAt: "updated_on" },
    collection: "Lesson",
  }
);

lessonSchema.index({ moduleId: 1, order: 1 });
lessonSchema.index({ tenantId: 1, courseId: 1 });

const Lesson = mongoose.model("Lesson", lessonSchema);
export default Lesson;
