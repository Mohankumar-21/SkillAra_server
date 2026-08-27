import mongoose from "mongoose";
import dotenv from "dotenv";
import Tenant from "../models/Tenant.js";
import User from "../models/User.js";

dotenv.config();

/**
 * Migration Script: STUDENT -> LEARNER rename
 * 
 * Strategy: Dual-accept (Strategy B)
 * - We rename the role in Tenant.roles[] so the UI reflects "Learner" and uses the "learners" permission module.
 * - We update User documents that have role: "STUDENT" to "LEARNER" (if they are stored directly on the user).
 * - Existing tokens will continue to work since API guards were updated to accept both.
 */
async function runMigration() {
  console.log("Connecting to MongoDB...");
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  console.log("Connected.");

  try {
    console.log("--- 1. Migrating Tenant Roles ---");
    const tenants = await Tenant.find({ "roles.slug": "student" });
    console.log(`Found ${tenants.length} tenants with 'student' role slug.`);

    for (const tenant of tenants) {
      let modified = false;
      
      for (const role of tenant.roles) {
        // Rename the student role itself
        if (role.slug === "student") {
          role.slug = "learner";
          role.name = "Learner";
          role.legacyApiRole = "LEARNER";
          
          // Rename the module keys in this role's permissions
          if (role.permissions && role.permissions.students) {
            role.permissions.learners = role.permissions.students;
            delete role.permissions.students;
          }
          modified = true;
        }

        // Rename module keys in OTHER roles (e.g., teaching-assistant, mentor, org-admin)
        if (role.permissions && role.permissions.students) {
          role.permissions.learners = role.permissions.students;
          delete role.permissions.students;
          modified = true;
        }
      }

      if (modified) {
        tenant.markModified("roles");
        await tenant.save();
        console.log(`Updated roles for tenant: ${tenant.name || tenant._id}`);
      }
    }

    console.log("--- 2. Migrating User Documents ---");
    // Update any users directly mapped to the legacy STUDENT role
    const userResult = await User.updateMany(
      { role: "STUDENT" },
      { $set: { role: "LEARNER" } }
    );
    console.log(`Updated ${userResult.modifiedCount} users from STUDENT to LEARNER.`);

    console.log("Migration completed successfully.");
  } catch (error) {
    console.error("Migration failed:", error);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from MongoDB.");
  }
}

runMigration();
