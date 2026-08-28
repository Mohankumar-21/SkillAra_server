/**
 * Bring every tenant's roles in line with data/permissionCatalog.js, and print the
 * resulting permission matrix so you can see exactly what each role can do.
 *
 * The same sync runs automatically on server boot (utils/backfillRoles.js). Use this when
 * you want it now — after editing the catalog, or to check what a tenant actually holds —
 * without restarting the API.
 *
 *   node scripts/syncTenantRoles.js            # sync every tenant, then print the matrix
 *   node scripts/syncTenantRoles.js --dry-run  # report drift, change nothing
 *   node scripts/syncTenantRoles.js --tenant acme-bootcamp
 */
import mongoose from "mongoose";
import dotenv from "dotenv";

import Tenant from "../models/Tenant.js";
import User from "../models/User.js";
import {
  seedTenantRoles,
  syncSystemRolePermissions,
  resyncCustomRoleLegacyHints,
  roleGrantsPermission,
} from "../services/roleService.js";
import { TENANT_ROLE_SEEDS } from "../data/permissionCatalog.js";

dotenv.config();

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const tenantArg = args.includes("--tenant") ? args[args.indexOf("--tenant") + 1] : null;

/**
 * The permissions the API actually enforces, mirroring the requirePermission() calls in
 * routes/. Kept here so the printout shows real reach rather than every catalog checkbox.
 */
const ENFORCED = [
  ["courses", "view", "browse the catalog"],
  ["courses", "create", "create a course"],
  ["courses", "edit", "edit a course"],
  ["courses", "delete", "archive a course"],
  ["courses", "submit", "submit for content review"],
  ["courses", "approve", "decide a content review"],
  ["courses", "moderate", "block / unblock a live course"],
  ["courses", "publish", "publish a course"],
  ["course-modules", "create", "add modules"],
  ["course-modules", "edit", "edit modules"],
  ["course-modules", "delete", "delete modules"],
  ["lessons", "create", "add lessons"],
  ["lessons", "edit", "edit lessons and upload media"],
  ["lessons", "delete", "delete lessons"],
  ["quizzes", "create", "create quizzes"],
  ["quizzes", "publish", "publish quizzes"],
  ["quizzes", "attempt", "take a quiz"],
  ["mock-tests", "create", "create mock tests"],
  ["mock-tests", "publish", "publish mock tests"],
  ["mock-tests", "attempt", "take a mock test"],
  ["live-sessions", "create", "schedule a live session"],
  ["live-sessions", "manage", "end / cancel a live session"],
  ["mentorship", "view", "see mentorship"],
  ["mentorship", "create", "raise a ticket / book a slot"],
  ["mentorship", "host", "open a bookable slot, be a mentor"],
  ["mentorship", "claim", "claim tickets, mentor dashboard"],
  ["mentorship", "assign", "assign tickets"],
  ["mentorship", "close", "close / reopen tickets"],
  ["mentorship", "delete", "delete a slot"],
  ["mentorship", "manage", "all tickets, admin dashboard"],
  ["learners", "view", "see enrolled students"],
  ["learners", "assign", "bulk-enrol students"],
  ["forum", "moderate", "moderate the forum"],
  ["users", "view", "see users"],
  ["users", "create", "add users"],
  ["users", "edit", "edit users"],
  ["users", "delete", "delete users"],
  ["roles", "view", "see roles"],
  ["roles", "create", "create roles"],
  ["roles", "edit", "edit roles"],
  ["analytics", "view", "analytics"],
  ["org-settings", "view", "see master data"],
  ["org-settings", "edit", "edit master data"],
  ["branding", "edit", "upload the org logo"],
];

const pad = (value, width) => String(value).padEnd(width);

async function run() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is not set");
  await mongoose.connect(process.env.MONGO_URI);

  const filter = tenantArg ? { subdomain: tenantArg } : {};
  const tenants = await Tenant.find(filter).select("_id name subdomain");
  if (tenants.length === 0) {
    console.log(tenantArg ? `No tenant with subdomain "${tenantArg}".` : "No tenants found.");
    await mongoose.disconnect();
    return;
  }

  const seededSlugs = new Set(TENANT_ROLE_SEEDS.map((s) => s.slug));

  for (const summary of tenants) {
    console.log(`\n${"=".repeat(100)}\n${summary.name} (${summary.subdomain})\n${"=".repeat(100)}`);

    if (!dryRun) {
      await seedTenantRoles(summary._id);
      const systemChanged = await syncSystemRolePermissions(summary._id);
      const customChanged = await resyncCustomRoleLegacyHints(summary._id);
      console.log(`synced: ${systemChanged} system role(s), ${customChanged} custom role(s)\n`);
    }

    const tenant = await Tenant.findById(summary._id).select("roles");
    const roles = tenant.roles.filter((r) => r.status === "active");

    // Header
    console.log(pad("CAN…", 40) + roles.map((r) => pad(r.slug.slice(0, 11), 13)).join(""));
    console.log("-".repeat(40 + roles.length * 13));

    for (const [moduleId, action, label] of ENFORCED) {
      const cells = roles.map((role) => {
        const granted = role.isOwnerRole || roleGrantsPermission(role, moduleId, action);
        return pad(granted ? "yes" : "-", 13);
      });
      console.log(pad(label, 40) + cells.join(""));
    }

    // Who is actually assigned to what.
    const counts = await User.aggregate([
      { $match: { tenantId: summary._id } },
      { $group: { _id: "$roleId", n: { $sum: 1 } } },
    ]);
    const byRole = new Map(counts.map((c) => [String(c._id), c.n]));

    console.log("\n" + pad("ROLE", 24) + pad("TYPE", 9) + pad("CLIENT TIER", 14) + "USERS");
    for (const role of roles) {
      const orphan = !seededSlugs.has(role.slug) && role.roleType !== "custom" ? "  (was mis-typed as system)" : "";
      console.log(
        pad(role.slug, 24) +
          pad(role.roleType, 9) +
          pad(role.legacyApiRole || "(none)", 14) +
          (byRole.get(String(role._id)) || 0) +
          orphan
      );
    }

    const stranded = await User.countDocuments({ tenantId: summary._id, roleId: null });
    if (stranded > 0) {
      console.log(`\n!! ${stranded} user(s) in this tenant have no roleId — they will be denied everything.`);
    }
  }

  console.log(dryRun ? "\nDry run — nothing was written.\n" : "\nDone.\n");
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
