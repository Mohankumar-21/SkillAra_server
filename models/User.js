import mongoose from "mongoose";

export const USER_STATUSES = ["active", "invited", "disabled"];

const userSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },
    name: {
      type: String,
      trim: true,
      default: "",
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    phone: {
      type: String,
      trim: true,
      default: "",
    },
    passwordHash: {
      type: String,
      required: function requiredPasswordHash() {
        return this.status !== "invited";
      },
      default: "",
    },
    /** References Tenant.roles[]._id */
    roleId: {
      type: mongoose.Schema.Types.ObjectId,
      required: function requiredRoleId() {
        return this.status !== "invited";
      },
      default: null,
      index: true,
    },
    status: {
      type: String,
      enum: USER_STATUSES,
      default: "active",
      index: true,
    },
    isDefaultPassword: {
      type: Boolean,
      default: false,
    },
    /** Organization owner — excluded from employee/user listings. */
    isTenantAdmin: {
      type: Boolean,
      default: false,
      index: true,
    },
    employeeId: {
      type: String,
      trim: true,
      default: "",
    },
    departmentId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true,
    },
    profilePhoto: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: "User",
  }
);

userSchema.index({ tenantId: 1, email: 1 }, { unique: true });

const User = mongoose.model("User", userSchema);
export default User;
