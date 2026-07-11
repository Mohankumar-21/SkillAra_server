import mongoose from "mongoose";

export const ROLE_TYPES = ["system", "custom"];
export const ROLE_STATUSES = ["active", "inactive"];

/** Embedded role subdocument — stored on Tenant.roles and platform SuperAdmin config. */
export const embeddedRoleSchema = new mongoose.Schema(
  {
    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: "",
      trim: true,
    },
    permissions: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    roleType: {
      type: String,
      enum: ROLE_TYPES,
      default: "custom",
    },
    protected: {
      type: Boolean,
      default: false,
    },
    isOwnerRole: {
      type: Boolean,
      default: false,
    },
    legacyRole: {
      type: String,
      default: null,
      trim: true,
    },
    legacyApiRole: {
      type: String,
      default: null,
      trim: true,
    },
    status: {
      type: String,
      enum: ROLE_STATUSES,
      default: "active",
    },
  },
  { timestamps: true }
);

export default embeddedRoleSchema;
