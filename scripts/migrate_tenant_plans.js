/**
 * scripts/migrate_tenant_plans.js
 * 
 * Backfills planId for legacy/trial tenants so that plan features
 * correctly resolve across the platform.
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
import Tenant from "../models/Tenant.js";
import { listPlans } from "../services/planService.js";
import { getPlatformRoleCatalogAdmin } from "../services/roleService.js";

// Load environment variables correctly
dotenv.config();

async function run() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error("No MONGO_URI found in environment variables.");
    process.exit(1);
  }

  try {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(uri);
    console.log("Connected.");

    // Fetch master plans
    const plans = await listPlans();
    if (!plans || plans.length === 0) {
      console.error("No plans found in the system catalog! Cannot migrate tenants.");
      process.exit(1);
    }
    
    console.log(`Found ${plans.length} active plans in the catalog.`);

    const tenants = await Tenant.find({});
    console.log(`Analyzing ${tenants.length} tenants...`);

    let updatedCount = 0;

    for (const tenant of tenants) {
      const planName = String(tenant.plan || "FREE").trim().toUpperCase();
      
      // If planId is missing or doesn't match the string plan
      if (!tenant.planId) {
        const matchingPlan = plans.find(p => p.name === planName) || plans.find(p => p.name === "FREE");
        
        if (matchingPlan) {
          console.log(`- Updating tenant '${tenant.name}' (assigning planId for ${matchingPlan.name})`);
          tenant.planId = matchingPlan._id;
          
          // Also sync subscriptionStatus if missing
          if (!tenant.subscriptionStatus) {
            tenant.subscriptionStatus = matchingPlan.name === "FREE" ? "TRIAL" : "ACTIVE";
          }
          
          await tenant.save();
          updatedCount++;
        } else {
          console.warn(`- WARNING: No matching plan found for tenant '${tenant.name}' (Plan: ${planName})`);
        }
      }
    }

    console.log(`\nMigration complete! Updated ${updatedCount} tenants.`);
    process.exit(0);
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  }
}

run();
