import SuperAdmin from "../models/SuperAdmin.js";
import { hashPassword } from "../services/password.js";
import { seedPlatformRoles, getPlatformSuperAdminRole } from "../services/roleService.js";

const DEFAULT_EMAIL = "tech.skillara@gmail.com";
const DEFAULT_PASSWORD = "Abc@123";

export async function seedSuperAdmin() {
  const email = (process.env.DEFAULT_SUPER_ADMIN_EMAIL || DEFAULT_EMAIL).toLowerCase().trim();
  const password = process.env.DEFAULT_SUPER_ADMIN_PASSWORD || DEFAULT_PASSWORD;

  let existing = await SuperAdmin.findOne({ email });
  if (!existing) {
    const passwordHash = await hashPassword(password);
    existing = await SuperAdmin.create({
      email,
      passwordHash,
      status: "active",
      mfaEnabled: false,
      roles: [],
    });
  }

  await seedPlatformRoles();
  const superAdminRole = await getPlatformSuperAdminRole();

  if (superAdminRole && !existing.roleId) {
    existing.roleId = superAdminRole._id;
    await existing.save();
  }
}
