import mongoose from "mongoose";
import dotenv from "dotenv";
import Tenant from "../models/Tenant.js";
import User from "../models/User.js";
import Plan from "../models/Plan.js";
import { hashPassword } from "../services/password.js";
import { seedNewTenantDefaults } from "../services/tenantSeedService.js";
import { getTenantRoleBySlug } from "../services/roleService.js";

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

    const sub = "acme-bootcamp";
    let tenant = await Tenant.findOne({ $or: [{ subdomain: sub }, { sub_domain: sub }] });

    if (!tenant) {
      console.log(`Creating tenant '${sub}'...`);
      const freePlan = await Plan.findOne({ name: "FREE" });

      tenant = await Tenant.create({
        name: "ACME Bootcamp",
        subdomain: sub,
        sub_domain: sub,
        domain: `${sub}.localhost`,
        email: "admin@acme-bootcamp.com",
        status: "active",
        plan: freePlan?.name || "FREE",
        planId: freePlan?._id,
        subscriptionStatus: "ACTIVE",
        user_count: 1,
      });
      console.log("Tenant created:", tenant._id);
    } else {
      console.log("Tenant already exists:", tenant._id);
    }

    await seedNewTenantDefaults(tenant._id);
    const ownerRole = await getTenantRoleBySlug(tenant._id, "organization-owner");

    const adminEmail = "admin@acme-bootcamp.com";
    let adminUser = await User.findOne({ email: adminEmail, tenantId: tenant._id });
    if (!adminUser) {
      const passwordHash = await hashPassword("ChangeMe#12345");
      adminUser = await User.create({
        tenantId: tenant._id,
        name: "ACME Admin",
        email: adminEmail,
        passwordHash,
        roleId: ownerRole?._id,
        status: "active",
        isTenantAdmin: true,
      });
      console.log("Created Admin User:", adminUser.email);
    } else {
      console.log("Admin User already exists:", adminUser.email);
    }

    console.log("Demo tenant setup complete!");
    process.exit(0);
  } catch (err) {
    console.error("Error creating demo tenant:", err);
    process.exit(1);
  }
}

run();
