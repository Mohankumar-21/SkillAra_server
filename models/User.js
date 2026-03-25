import mongoose from "mongoose";

export const ROLES = ["SUPER_ADMIN", "TENANT_ADMIN", "TUTOR", "STUDENT"];

const userSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", default: null, index: true },

    name: { type: String, trim: true, default: "" },
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    passwordHash: { type: String, required: true },

    role: { type: String, enum: ROLES, required: true, index: true },

    status: { type: String, enum: ["ACTIVE", "DISABLED"], default: "ACTIVE", index: true },

    failedLoginAttempts: { type: Number, default: 0 },
    lockUntil: { type: Date, default: null },

    lastLoginAt: { type: Date, default: null },
    lastLoginIp: { type: String, default: "" },
    lastLoginUserAgent: { type: String, default: "" },
  },
  { timestamps: { createdAt: "created_on", updatedAt: "updated_on" }, collection: "User" }
);

userSchema.index({ email: 1, tenantId: 1 }, { unique: true, sparse: true });

const User = mongoose.model("User", userSchema);
export default User;
