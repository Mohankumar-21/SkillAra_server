/**
 * scripts/sync_plans.js
 * 
 * Synchronizes the plans collection with proper features
 * and renames legacy plan names (BASIC -> STARTER, PREMIUM -> PROFESSIONAL).
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
import Plan from "../models/Plan.js";
import Tenant from "../models/Tenant.js";
import { getPlatformRoleCatalogAdmin } from "../services/roleService.js";

dotenv.config();

const PLANS = [
  {
    name: "FREE",
    price: 0,
    billingCycle: "monthly",
    features: {
      maxStudents: 25,
      maxInstructors: 2,
      maxUsers: 27,
      maxCourses: 5,
      storageLimit: 1024,
      aiCredits: 50,
      maxAIRequests: 50,
      liveClassesEnabled: false,
      certificatesEnabled: false,
      communityEnabled: false,
      analyticsEnabled: false,
      analyticsAccess: false,
      mentorshipEnabled: false,
      mockInterviewsEnabled: false,
      maxLiveSessionsPerMonth: 0,
      maxMentorshipSlotsPerMonth: 0,
      aiFeatures: true,
      aiTier: "BASIC",
      evaluationEnabled: false,
      summarizationEnabled: true,
      predictiveAnalyticsEnabled: false,
      prioritySupport: false,
    },
    isActive: true,
  },
  {
    name: "STARTER",
    price: 29,
    billingCycle: "monthly",
    features: {
      maxStudents: 100,
      maxInstructors: 10,
      maxUsers: 110,
      maxCourses: 25,
      storageLimit: 25600, // 25 GB
      aiCredits: 500,
      maxAIRequests: 500,
      liveClassesEnabled: true,
      certificatesEnabled: true,
      communityEnabled: false,
      analyticsEnabled: true,
      analyticsAccess: true,
      mentorshipEnabled: true,
      mockInterviewsEnabled: true,
      maxLiveSessionsPerMonth: 10,
      maxMentorshipSlotsPerMonth: 20,
      aiFeatures: true,
      aiTier: "BASIC",
      evaluationEnabled: true,
      summarizationEnabled: true,
      predictiveAnalyticsEnabled: false,
      prioritySupport: false,
    },
    isActive: true,
  },
  {
    name: "PROFESSIONAL",
    price: 99,
    billingCycle: "monthly",
    features: {
      maxStudents: 500,
      maxInstructors: 50,
      maxUsers: 550,
      maxCourses: 100,
      storageLimit: 102400, // 100 GB
      aiCredits: 5000,
      maxAIRequests: 5000,
      liveClassesEnabled: true,
      certificatesEnabled: true,
      communityEnabled: true,
      analyticsEnabled: true,
      analyticsAccess: true,
      mentorshipEnabled: true,
      mockInterviewsEnabled: true,
      maxLiveSessionsPerMonth: 50,
      maxMentorshipSlotsPerMonth: 100,
      aiFeatures: true,
      aiTier: "ADVANCED",
      evaluationEnabled: true,
      summarizationEnabled: true,
      predictiveAnalyticsEnabled: true,
      prioritySupport: true,
    },
    isActive: true,
  },
  {
    name: "ENTERPRISE",
    price: 0,
    billingCycle: "monthly",
    features: {
      maxStudents: null,
      maxInstructors: null,
      maxUsers: null,
      maxCourses: null,
      storageLimit: null,
      aiCredits: null,
      maxAIRequests: null,
      liveClassesEnabled: true,
      certificatesEnabled: true,
      communityEnabled: true,
      analyticsEnabled: true,
      analyticsAccess: true,
      mentorshipEnabled: true,
      mockInterviewsEnabled: true,
      maxLiveSessionsPerMonth: null,
      maxMentorshipSlotsPerMonth: null,
      aiFeatures: true,
      aiTier: "PRO",
      evaluationEnabled: true,
      summarizationEnabled: true,
      predictiveAnalyticsEnabled: true,
      prioritySupport: true,
    },
    isActive: true,
  },
];

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

    // Migration: Rename legacy plan names in DB
    await Plan.updateMany({ name: "BASIC" }, { $set: { name: "STARTER" } });
    await Plan.updateMany({ name: "PREMIUM" }, { $set: { name: "PROFESSIONAL" } });

    await Tenant.updateMany({ plan: "BASIC" }, { $set: { plan: "STARTER" } });
    await Tenant.updateMany({ plan: "PREMIUM" }, { $set: { plan: "PROFESSIONAL" } });

    for (const p of PLANS) {
      const existing = await Plan.findOne({ name: p.name });
      if (existing) {
        console.log(`Updating existing plan: ${p.name}`);
        existing.price = p.price;
        existing.billingCycle = p.billingCycle;
        existing.features = p.features;
        existing.isActive = true;
        await existing.save();
      } else {
        console.log(`Creating new plan: ${p.name}`);
        await Plan.create(p);
      }
    }

    // Sync embedded catalog admin plans
    const admin = await getPlatformRoleCatalogAdmin();
    if (admin) {
      if (!Array.isArray(admin.plans)) admin.plans = [];
      for (const p of admin.plans) {
        if (p.name === "BASIC") p.name = "STARTER";
        if (p.name === "PREMIUM") p.name = "PROFESSIONAL";
      }
      for (const seed of PLANS) {
        const idx = admin.plans.findIndex((p) => p.name === seed.name);
        if (idx >= 0) {
          admin.plans[idx].price = seed.price;
          admin.plans[idx].features = seed.features;
          admin.plans[idx].isActive = true;
        } else {
          admin.plans.push(seed);
        }
      }
      await admin.save();
      console.log("Synced SuperAdmin catalog plans!");
    }

    console.log("Plan sync & migration complete! Plans are now: FREE, STARTER, PROFESSIONAL, ENTERPRISE");
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

run();
