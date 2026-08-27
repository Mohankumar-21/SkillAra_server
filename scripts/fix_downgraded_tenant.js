/**
 * scripts/fix_downgraded_tenant.js
 * 
 * Fixes any tenant that was accidentally downgraded to the FREE plan ID.
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
import Tenant from "../models/Tenant.js";
import Plan from "../models/Plan.js";

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

    // The user's tenant probably has plan: 'STARTER' now because of the second script.
    // Let's find the BASIC plan document.
    const basicPlan = await Plan.findOne({ name: "BASIC" });
    if (!basicPlan) {
      console.error("BASIC plan not found in database.");
      process.exit(1);
    }
    console.log(`Found BASIC plan with ID: ${basicPlan._id}`);

    const tenants = await Tenant.find({});
    let updatedCount = 0;

    for (const t of tenants) {
      // If the tenant plan string indicates they should be on Basic/Starter
      // but their planId doesn't match the BASIC plan ID...
      if ((t.plan === "STARTER" || t.plan === "BASIC") && String(t.planId) !== String(basicPlan._id)) {
        console.log(`Fixing tenant '${t.name}' (current plan string: ${t.plan}) - Assigning correct BASIC plan ID...`);
        t.planId = basicPlan._id;
        t.plan = "BASIC"; // Ensure string matches too
        await t.save();
        updatedCount++;
      }
    }

    console.log(`\nFixed ${updatedCount} tenants. You are now truly on the BASIC plan!`);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

run();
