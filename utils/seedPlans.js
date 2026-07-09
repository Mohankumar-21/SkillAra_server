import Plan from "../models/Plan.js";

const DEFAULT_PLANS = [
  {
    name: "FREE",
    price: 0,
    billingCycle: "monthly",
    features: {
      maxUsers: 25,
      maxCourses: 5,
      maxAIRequests: 50,
      storageLimit: 512,
      aiFeatures: true,
      aiTier: "BASIC",
      evaluationEnabled: false,
      summarizationEnabled: true,
      predictiveAnalyticsEnabled: false,
      analyticsAccess: false,
      prioritySupport: false,
    },
    isActive: true,
  },
  {
    name: "BASIC",
    price: 29,
    billingCycle: "monthly",
    features: {
      maxUsers: 100,
      maxCourses: 25,
      maxAIRequests: 500,
      storageLimit: 2048,
      aiFeatures: true,
      aiTier: "BASIC",
      evaluationEnabled: true,
      summarizationEnabled: true,
      predictiveAnalyticsEnabled: false,
      analyticsAccess: true,
      prioritySupport: false,
    },
    isActive: true,
  },
  {
    name: "PREMIUM",
    price: 99,
    billingCycle: "monthly",
    features: {
      maxUsers: 500,
      maxCourses: 100,
      maxAIRequests: 5000,
      storageLimit: 10240,
      aiFeatures: true,
      aiTier: "ADVANCED",
      evaluationEnabled: true,
      summarizationEnabled: true,
      predictiveAnalyticsEnabled: true,
      analyticsAccess: true,
      prioritySupport: true,
    },
    isActive: true,
  },
];

export async function seedDefaultPlans() {
  for (const plan of DEFAULT_PLANS) {
    const exists = await Plan.findOne({ name: plan.name });
    if (!exists) {
      await Plan.create(plan);
    }
  }
}
