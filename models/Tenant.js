import mongoose from "mongoose";
import embeddedRoleSchema from "./embeddedRole.js";
import { embeddedLookupSchema } from "./embeddedLookup.js";

export const TENANT_STATUSES = ["active", "suspended"];
export const SUBSCRIPTION_STATUSES = ["ACTIVE", "TRIAL", "EXPIRED"];

const brandingSchema = new mongoose.Schema(
  {
    welcome_message: { type: String, default: "" },
    primary_color: { type: String, default: "#4F46E5" },
    secondary_color: { type: String, default: "#7C3AED" },
  },
  { _id: false }
);

const tenantSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    subdomain: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    domain: {
      type: String,
      trim: true,
      default: "",
    },
    email: {
      type: String,
      lowercase: true,
      trim: true,
      default: "",
    },
    phone: { type: String, trim: true, default: "" },
    /** References SuperAdmin.organizationTypes[]._id on the primary platform catalog admin. */
    orgTypeId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true,
    },
    industry: { type: String, trim: true, default: "" },
    website: { type: String, trim: true, default: "" },
    country: { type: String, trim: true, default: "" },
    timezone: { type: String, trim: true, default: "" },
    currency: { type: String, trim: true, default: "" },
    logo: { type: mongoose.Schema.Types.Mixed, default: null },
    branding: { type: brandingSchema, default: () => ({}) },
    plan: {
      type: String,
      default: "trial",
      trim: true,
    },
    planId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true,
    },
    subscriptionStatus: {
      type: String,
      enum: SUBSCRIPTION_STATUSES,
      default: "TRIAL",
    },
    subscriptionStartDate: { type: Date, default: null },
    subscriptionEndDate: { type: Date, default: null },
    user_count: { type: Number, default: 1, min: 0 },
    status: {
      type: String,
      enum: TENANT_STATUSES,
      default: "active",
      index: true,
    },
    /** Tenant-scoped roles and permissions (embedded). User.roleId references roles[]._id */
    roles: {
      type: [embeddedRoleSchema],
      default: () => [],
    },
    /** User.departmentId references departments[]._id */
    departments: {
      type: [embeddedLookupSchema],
      default: () => [],
    },
    /** User.designationId references designations[]._id */
    designations: {
      type: [embeddedLookupSchema],
      default: () => [],
    },
    /** Prevents tenant master data defaults from being re-seeded after initial provisioning. */
    masterDataInitialized: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: true },
    collection: "Tenant",
  }
);

tenantSchema.index({ email: 1 }, { unique: true, sparse: true });

const Tenant = mongoose.model("Tenant", tenantSchema);
export default Tenant;
