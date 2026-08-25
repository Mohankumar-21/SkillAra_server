import Plan from "../models/Plan.js";
import logger from "../core/logger.js";
import { getPlatformRoleCatalogAdmin } from "./roleService.js";

export function normalizePlanForApi(plan) {
  if (!plan) return null;
  const doc = plan.toObject ? plan.toObject() : plan;
  return {
    ...doc,
    id: String(doc._id),
    _id: doc._id,
  };
}

function findPlanById(plans, planId) {
  if (!planId) return null;
  return plans.find((p) => String(p._id) === String(planId));
}

function findPlanByName(plans, name) {
  if (!name) return null;
  const upper = String(name).trim().toUpperCase();
  return plans.find((p) => p.name === upper && p.isActive !== false);
}

async function getCatalogAdmin() {
  const admin = await getPlatformRoleCatalogAdmin();
  if (!admin) return null;
  if (!Array.isArray(admin.plans)) admin.plans = [];
  return admin;
}

export async function listPlans({ activeOnly = false } = {}) {
  const admin = await getCatalogAdmin();
  if (!admin) return [];

  let plans = admin.plans;
  if (activeOnly) plans = plans.filter((p) => p.isActive !== false);
  return plans.map((p) => normalizePlanForApi(p)).sort((a, b) => {
    const order = { FREE: 0, STARTER: 1, PROFESSIONAL: 2, ENTERPRISE: 3 };
    return (order[a.name] ?? 99) - (order[b.name] ?? 99);
  });
}

export async function getPlanById(planId) {
  const admin = await getCatalogAdmin();
  if (!admin || !planId) return null;
  const plan = findPlanById(admin.plans, planId);
  if (!plan || plan.isActive === false) return null;
  return plan;
}

export async function getPlanByIdIncludingInactive(planId) {
  const admin = await getCatalogAdmin();
  if (!admin || !planId) return null;
  return findPlanById(admin.plans, planId);
}

export async function createPlan(data) {
  const admin = await getCatalogAdmin();
  if (!admin) throw new Error("Platform catalog admin not found");

  const name = String(data.name || "").trim().toUpperCase();
  if (admin.plans.some((p) => p.name === name)) {
    const err = new Error("Plan name exists");
    err.code = 11000;
    throw err;
  }

  admin.plans.push({
    name,
    price: data.price,
    billingCycle: data.billingCycle,
    features: data.features,
    isActive: data.isActive !== false,
  });
  await admin.save();
  const created = admin.plans[admin.plans.length - 1];
  return normalizePlanForApi(created);
}

export async function updatePlan(planId, data) {
  const admin = await getCatalogAdmin();
  if (!admin) throw new Error("Platform catalog admin not found");

  const plan = findPlanById(admin.plans, planId);
  if (!plan) return null;

  if (data.name !== undefined) {
    const name = String(data.name).trim().toUpperCase();
    if (admin.plans.some((p) => p.name === name && String(p._id) !== String(planId))) {
      const err = new Error("Plan name exists");
      err.code = 11000;
      throw err;
    }
    plan.name = name;
  }
  if (data.price !== undefined) plan.price = data.price;
  if (data.billingCycle !== undefined) plan.billingCycle = data.billingCycle;
  if (data.features !== undefined) plan.features = { ...plan.features?.toObject?.(), ...data.features };
  if (data.isActive !== undefined) plan.isActive = data.isActive;

  await admin.save();
  return normalizePlanForApi(plan);
}

export async function deactivatePlan(planId) {
  return updatePlan(planId, { isActive: false });
}

const DEFAULT_PLANS = [
  {
    name: "FREE",
    price: 0,
    billingCycle: "monthly",
    features: {
      maxStudents: 25,
      maxInstructors: 2,
      maxUsers: 27,
      maxCourses: 5,
      storageLimit: 1024, // 1 GB
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
      maxStudents: null, // Unlimited
      maxInstructors: null,
      maxUsers: null,
      maxCourses: null,
      storageLimit: null, // Unlimited
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

export async function seedDefaultPlans() {
  const admin = await getCatalogAdmin();
  if (!admin) return;

  let changed = false;
  for (const seed of DEFAULT_PLANS) {
    const exists = findPlanByName(admin.plans, seed.name);
    if (!exists) {
      admin.plans.push(seed);
      changed = true;
    }
  }
  if (changed) await admin.save();
}

/** Copy legacy `plans` collection documents into SuperAdmin.plans, preserving _id for tenant.planId refs. */
export async function migrateLegacyPlansCollection() {
  const admin = await getCatalogAdmin();
  if (!admin) return false;

  let legacyPlans = [];
  try {
    legacyPlans = await Plan.find({}).lean();
  } catch {
    return false;
  }
  if (!legacyPlans.length) return false;

  let changed = false;
  for (const legacy of legacyPlans) {
    const byId = findPlanById(admin.plans, legacy._id);
    const byName = findPlanByName(admin.plans, legacy.name);
    if (byId || byName) continue;

    admin.plans.push({
      _id: legacy._id,
      name: legacy.name,
      price: legacy.price,
      billingCycle: legacy.billingCycle,
      features: legacy.features,
      isActive: legacy.isActive !== false,
      createdAt: legacy.createdAt,
      updatedAt: legacy.updatedAt,
    });
    changed = true;
  }

  if (changed) {
    await admin.save();
    logger.info(`Migrated ${legacyPlans.length} legacy plan(s) into SuperAdmin.plans`);
  }
  return changed;
}

export async function buildPlanNameMap() {
  const plans = await listPlans();
  return new Map(plans.map((p) => [String(p._id || p.id), p.name]));
}

export async function resolvePlanName(planId) {
  if (!planId) return null;
  const plan = await getPlanByIdIncludingInactive(planId);
  return plan?.name || null;
}
