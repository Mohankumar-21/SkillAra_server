/**
 * Repair tenant → plan links.
 *
 * Plans live embedded on the primary super admin (`SuperAdmin.plans[]`), and `Tenant.planId`
 * points at one of them. A tenant whose planId no longer resolves fails *every* plan-gated
 * check in middlewares/checkPlanLimits.js — course creation, mentorship, live sessions —
 * with PLAN_LIMIT_EXCEEDED, which reads like a permission problem but is not one.
 *
 *   node scripts/repairTenantPlans.js --report
 *   node scripts/repairTenantPlans.js --repair                       # relink dangling planIds by plan name
 *   node scripts/repairTenantPlans.js --set <subdomain> <PLAN_NAME>  # move one tenant onto a plan
 */
import mongoose from "mongoose";
import dotenv from "dotenv";

import Tenant from "../models/Tenant.js";
import SuperAdmin, { LEGACY_PLATFORM_CONFIG_EMAIL } from "../models/SuperAdmin.js";
import { getPlanById } from "../services/planService.js";

dotenv.config();

const args = process.argv.slice(2);
const mode = args.includes("--repair") ? "repair" : args.includes("--set") ? "set" : "report";
const setSubdomain = args[args.indexOf("--set") + 1];
const setPlanName = args[args.indexOf("--set") + 2];

const FLAGS = [
  "liveClassesEnabled",
  "communityEnabled",
  "analyticsEnabled",
  "mentorshipEnabled",
  "mockInterviewsEnabled",
  "aiFeatures",
];

async function planCatalog() {
  const admin = await SuperAdmin.findOne({ email: { $ne: LEGACY_PLATFORM_CONFIG_EMAIL } }).sort({
    createdAt: 1,
  });
  return admin?.plans || [];
}

async function describe(tenant, plans) {
  const plan = tenant.planId ? await getPlanById(tenant.planId) : null;
  const resolved = Boolean(plan && plan.isActive === true);
  const byName = plans.find((p) => p.name === (plan?.name || tenant.plan));
  const f = plan?.features || {};
  return { plan, resolved, byName, features: f };
}

async function run() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is not set");
  await mongoose.connect(process.env.MONGO_URI);

  const plans = await planCatalog();
  console.log(`Plan catalog: ${plans.map((p) => p.name).join(", ") || "(empty)"}\n`);

  if (mode === "set") {
    const tenant = await Tenant.findOne({ subdomain: setSubdomain });
    if (!tenant) throw new Error(`No tenant with subdomain "${setSubdomain}"`);
    const target = plans.find((p) => p.name === setPlanName);
    if (!target) throw new Error(`No plan named "${setPlanName}"`);

    tenant.planId = target._id;
    tenant.plan = target.name;
    await tenant.save();
    console.log(`${tenant.subdomain} → ${target.name}`);
    const f = target.features || {};
    console.log("  " + FLAGS.map((k) => `${k}=${JSON.stringify(f[k])}`).join("  "));
    await mongoose.disconnect();
    return;
  }

  for (const tenant of await Tenant.find({}).select("name subdomain plan planId")) {
    const { plan, resolved, byName, features } = await describe(tenant, plans);

    if (resolved) {
      console.log(`ok      ${tenant.subdomain.padEnd(16)} ${plan.name}`);
      console.log("        " + FLAGS.map((k) => `${k}=${JSON.stringify(features[k])}`).join("  "));
      continue;
    }

    console.log(`BROKEN  ${tenant.subdomain.padEnd(16)} planId=${tenant.planId} does not resolve (plan field says "${tenant.plan}")`);

    if (mode === "repair") {
      if (!byName) {
        console.log(`        no plan named "${tenant.plan}" in the catalog — set one explicitly with --set`);
        continue;
      }
      tenant.planId = byName._id;
      await Tenant.updateOne({ _id: tenant._id }, { $set: { planId: byName._id, plan: byName.name } });
      console.log(`        relinked → ${byName.name}`);
    }
  }

  console.log(mode === "report" ? "\nReport only — nothing was written.\n" : "\nDone.\n");
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
