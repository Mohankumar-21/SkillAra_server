import mongoose from "mongoose";
const tenantSchema = new mongoose.Schema(
  {
    tenant_name: {
      type: String,
      required: true,
      unique: true,
    },
    domain: {
      type: String,
      required: true,
      unique: true,
    },
    sub_domain: {
      type: String,
      required: true,
      unique: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
    },
    status: {
      type: Boolean,
      default: true,
    },
    logo: {
      type: Object,
      default: {
        status: false,
        mime_type: "",
        image_name: "no-data",
        image_blob: "",
      },
    },
    branding: {
      welcome_message: { type: String, default: "", maxlength: 250 },
      primary_color: { type: String, default: "#4F46E5" },
      secondary_color: { type: String, default: "#7C3AED" },
    },
    user_count: {
      type: Number,
      default: 0,
    },
    planId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Plan",
      default: null,
      index: true,
    },
    subscriptionStatus: {
      type: String,
      enum: ["ACTIVE", "EXPIRED", "TRIAL"],
      default: "TRIAL",
      index: true,
    },
    subscriptionStartDate: {
      type: Date,
      default: null,
    },
    subscriptionEndDate: {
      type: Date,
      default: null,
    },
    created_by: {
      type: String,
      default: "system", // or "admin"
    },
    updated_by: {
      type: String,
      default: "system",
    },
  },
  {
    timestamps: { createdAt: "created_on", updatedAt: "updated_on" },
    collection: "Tenant",
  }
);
const Tenant = mongoose.model("Tenant", tenantSchema);
export default Tenant;
