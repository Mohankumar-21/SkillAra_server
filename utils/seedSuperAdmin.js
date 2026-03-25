import mongoose from "mongoose";

import User from "../models/User.js";
import { hashPassword } from "../services/password.js";

const LEGACY_DEFAULT_EMAIL = "superadmin";
const DEFAULT_EMAIL = "superadmin@skillara.com";
const DEFAULT_PASSWORD = "Abc@123";

export async function seedSuperAdmin() {
  // Don't attempt seeding if Mongo is not connected.
  if (mongoose.connection.readyState !== 1) return;

  const email = (process.env.DEFAULT_SUPER_ADMIN_EMAIL || DEFAULT_EMAIL).toLowerCase().trim();
  const password = process.env.DEFAULT_SUPER_ADMIN_PASSWORD || DEFAULT_PASSWORD;

  // Migrate legacy non-email super admin identifier to a real email.
  if (email === DEFAULT_EMAIL) {
    const legacy = await User.findOne({ email: LEGACY_DEFAULT_EMAIL, role: "SUPER_ADMIN" });
    if (legacy) {
      const existingDefault = await User.findOne({ email: DEFAULT_EMAIL, role: "SUPER_ADMIN" });
      if (!existingDefault) {
        legacy.email = DEFAULT_EMAIL;
        await legacy.save();
      }
    }
  }

  const existing = await User.findOne({ email, role: "SUPER_ADMIN" });
  if (existing) return;

  const passwordHash = await hashPassword(password);
  await User.create({
    tenantId: null,
    name: "Super Admin",
    email,
    passwordHash,
    role: "SUPER_ADMIN",
    status: "ACTIVE",
  });
}

