import mongoose from "mongoose";

const mentorProfileSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },
    bio: { type: String, default: "", maxlength: 2000 },
    expertiseTags: { type: [String], default: [] },
    yearsExperience: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: { createdAt: "created_on", updatedAt: "updated_on" },
    collection: "mentor_profiles",
  }
);

mentorProfileSchema.index({ tenantId: 1, userId: 1 }, { unique: true });
mentorProfileSchema.index({ tenantId: 1, expertiseTags: 1, isActive: 1 });

const MentorProfile = mongoose.model("MentorProfile", mentorProfileSchema);
export default MentorProfile;
