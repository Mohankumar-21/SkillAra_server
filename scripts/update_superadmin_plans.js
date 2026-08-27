/**
 * scripts/update_superadmin_plans.js
 * 
 * Corrects the missing boolean feature flags inside the SuperAdmin's embedded plans array.
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
import SuperAdmin from "../models/SuperAdmin.js";

dotenv.config();

async function run() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error("No MONGO_URI found");
    process.exit(1);
  }

  try {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(uri);
    console.log("Connected.");

    const admin = await SuperAdmin.findOne({});
    if (!admin) {
      console.error("SuperAdmin not found!");
      process.exit(1);
    }

    let updated = false;

    for (const plan of admin.plans) {
      if (plan.name === "BASIC") {
        console.log("Updating BASIC plan in SuperAdmin...");
        plan.features.mockInterviewsEnabled = true;
        plan.features.mentorshipEnabled = true;
        plan.features.liveClassesEnabled = true;
        plan.features.communityEnabled = false;
        updated = true;
      }
      
      if (plan.name === "PREMIUM") {
        console.log("Updating PREMIUM plan in SuperAdmin...");
        plan.features.mockInterviewsEnabled = true;
        plan.features.mentorshipEnabled = true;
        plan.features.liveClassesEnabled = true;
        plan.features.communityEnabled = true;
        updated = true;
      }
    }

    if (updated) {
      // Need to tell Mongoose that the embedded array was modified
      admin.markModified("plans");
      await admin.save();
      console.log("Successfully saved SuperAdmin plans!");
    } else {
      console.log("No plans needed updating.");
    }

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

run();
