import mongoose from "mongoose";

export const LOOKUP_STATUSES = ["active", "inactive"];

/**
 * Organization type master item (embedded on SuperAdmin).
 * `organizationCount` is computed at API time — not persisted here.
 */
export const embeddedOrganizationTypeSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    /** Exactly 3 alphanumeric characters (e.g. TRI, UNI). */
    code: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      minlength: 3,
      maxlength: 3,
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

/** @deprecated Prefer embeddedOrganizationTypeSchema for organization types. */
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

export default embeddedOrganizationTypeSchema;
