/**
 * scripts/fix_tenant_plans_superadmin.js
 * 
 * Fixes tenants to use the correct plans from the SuperAdmin catalog.
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
import Tenant from "../models/Tenant.js";
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

    // Fetch the SuperAdmin document which holds the real active plans
    const admin = await SuperAdmin.findOne({});
    if (!admin) {
      console.error("SuperAdmin not found!");
      process.exit(1);
    }

    const plans = admin.plans || [];
    const starterPlan = plans.find(p => p.name === "STARTER");
    const proPlan = plans.find(p => p.name === "PROFESSIONAL");

    if (!starterPlan) {
      console.error("STARTER plan not found in SuperAdmin catalog!");
      process.exit(1);
    }

    const tenants = await Tenant.find({});
    let updatedCount = 0;

    for (const t of tenants) {
      let needsUpdate = false;
      const currentPlan = (t.plan || "").toUpperCase();

      if (currentPlan === "BASIC" || currentPlan === "STARTER") {
        t.plan = "STARTER";
        t.planId = starterPlan._id;
        needsUpdate = true;
      } else if (currentPlan === "PREMIUM" || currentPlan === "PROFESSIONAL") {
        if (proPlan) {
          t.plan = "PROFESSIONAL";
          t.planId = proPlan._id;
          needsUpdate = true;
        }
      }

      if (needsUpdate) {
        await t.save();
        console.log(`Updated tenant '${t.name}' -> mapped to ${t.plan} plan (ID: ${t.planId})`);
        updatedCount++;
      }
    }

    console.log(`\nSuccessfully linked ${updatedCount} tenants to the active SuperAdmin plans.`);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

run();
