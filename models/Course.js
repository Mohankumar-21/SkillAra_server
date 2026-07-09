import mongoose from "mongoose";

const courseSchema = new mongoose.Schema(
  {
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
    instructorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    thumbnail: {
      type: String,
      default: "",
    },
    status: {
      type: String,
      enum: ["DRAFT", "PUBLISHED", "ARCHIVED"],
      default: "DRAFT",
    },
    modules: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Module",
      },
    ],
    stats: {
      enrolledCount: { type: Number, default: 0 },
      rating: { type: Number, default: 0 },
      reviewCount: { type: Number, default: 0 },
    },
    price: {
      type: Number,
      default: 0,
    },
    tags: [String],
    created_by: { type: String, default: "system" },
    updated_by: { type: String, default: "system" },
  },
  {
    timestamps: { createdAt: "created_on", updatedAt: "updated_on" },
    collection: "Course",
  }
);

const Course = mongoose.model("Course", courseSchema);
export default Course;
