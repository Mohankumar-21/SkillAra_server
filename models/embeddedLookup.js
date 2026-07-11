import mongoose from "mongoose";

export const LOOKUP_STATUSES = ["active", "inactive"];

/** Embedded lookup item — platform master data (e.g. organization types). */
export const embeddedLookupSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    code: {
      type: String,
      default: "",
      trim: true,
      lowercase: true,
    },
    description: {
      type: String,
      default: "",
      trim: true,
    },
    status: {
      type: String,
      enum: LOOKUP_STATUSES,
      default: "active",
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

export default embeddedLookupSchema;
