import mongoose from "mongoose";
import embeddedRoleSchema from "./embeddedRole.js";
import embeddedPlanSchema from "./embeddedPlan.js";
import embeddedLookupSchema from "./embeddedLookup.js";

export const SUPERADMIN_STATUSES = ["active", "disabled"];

/** Legacy platform config doc — migrated into the primary super admin account on startup. */
export const LEGACY_PLATFORM_CONFIG_EMAIL = "__platform_config__@skillara.internal";

const superAdminSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    passwordHash: {
      type: String,
      required: true,
    },
    mfaEnabled: {
      type: Boolean,
      default: false,
    },
    mfaSecret: {
      type: String,
      default: "",
      select: false,
    },
    status: {
      type: String,
      enum: SUPERADMIN_STATUSES,
      default: "active",
      index: true,
    },
    /** Platform roles and permissions catalog — stored on the primary super admin account. */
    roles: {
      type: [embeddedRoleSchema],
      default: () => [],
    },
    /** Subscription plans catalog — Tenant.planId references plans[]._id */
    plans: {
      type: [embeddedPlanSchema],
      default: () => [],
    },
    /** Organization type master — Tenant.orgTypeId references organizationTypes[]._id */
    organizationTypes: {
      type: [embeddedLookupSchema],
      default: () => [],
    },
    /** References roles[]._id on the primary super admin's roles array. */
    roleId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true,
    },
    lastLoginAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: "SuperAdmin",
  }
);

const SuperAdmin = mongoose.model("SuperAdmin", superAdminSchema);
export default SuperAdmin;
