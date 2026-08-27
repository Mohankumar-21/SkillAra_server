/**
 * scripts/sync_plans.js
 * 
 * Synchronizes the plans collection with proper features
 * to ensure all boolean flags (liveClassesEnabled, mentorshipEnabled, etc.)
 * are explicitly present and correctly populated for existing plans.
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
import Plan from "../models/Plan.js";

dotenv.config();

// Define correct features for the exact plan names defined in the Plan schema
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
    name: "BASIC", // Matches DB schema enum
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
    name: "PREMIUM", // Matches DB schema enum
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
  }
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

    for (const p of PLANS) {
      const existing = await Plan.findOne({ name: p.name });
      if (existing) {
        console.log(`Updating existing plan: ${p.name}`);
        existing.features = p.features;
        await existing.save();
      } else {
        console.log(`Creating new plan: ${p.name}`);
        await Plan.create(p);
      }
    }

    console.log("Plan sync complete!");
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

run();
