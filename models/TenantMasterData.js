import mongoose from "mongoose";

/** @deprecated Legacy collection — migrated into Tenant.departments / Tenant.designations on startup. */

export const MASTER_DATA_STATUSES = ["active", "inactive"];

const tenantMasterDataSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },
    category: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    code: {
      type: String,
      trim: true,
      default: "",
    },
    description: {
      type: String,
      trim: true,
      default: "",
    },
    status: {
      type: String,
      enum: MASTER_DATA_STATUSES,
      default: "active",
      index: true,
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
    collection: "TenantMasterData",
  }
);

tenantMasterDataSchema.index({ tenantId: 1, category: 1, name: 1 }, { unique: true });

const TenantMasterData = mongoose.model("TenantMasterData", tenantMasterDataSchema);
export default TenantMasterData;
