/**
 * One-time cleanup: stop old default departments from resurfacing.
 * - Drops legacy TenantMasterData docs (source of re-add on migrate)
 * - Removes retired default department names from Tenant.departments
 *
 * Run: node scripts/pruneRetiredDepartments.js
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import connectToDb from "../config/db.js";
import Tenant from "../models/Tenant.js";
import TenantMasterData from "../models/TenantMasterData.js";
import { DEFAULT_DEPARTMENT_SEEDS } from "../data/masterDataCatalog.js";

dotenv.config();

const RETIRED_DEFAULT_DEPARTMENTS = [
  "Operations",
  "Finance",
  "Human Resources",
  "Marketing",
  "General",
];

async function main() {
  await connectToDb();

  const retiredSet = new Set(RETIRED_DEFAULT_DEPARTMENTS.map((n) => n.toLowerCase()));
  const keepSet = new Set(
    DEFAULT_DEPARTMENT_SEEDS.map((seed) =>
      String(typeof seed === "string" ? seed : seed.name || "")
        .trim()
        .toLowerCase()
    )
  );

  let legacyDeleted = 0;
  try {
    const legacyResult = await TenantMasterData.deleteMany({
      category: "department",
      name: { $in: RETIRED_DEFAULT_DEPARTMENTS },
    });
    legacyDeleted = legacyResult.deletedCount || 0;
  } catch (err) {
    console.warn("Legacy TenantMasterData cleanup skipped:", err.message);
  }

  const tenants = await Tenant.find({}).select("_id name subdomain departments");
  let tenantUpdates = 0;
  let removedItems = 0;

  for (const tenant of tenants) {
    const before = Array.isArray(tenant.departments) ? tenant.departments.length : 0;
    tenant.departments = (tenant.departments || []).filter((d) => {
      const name = String(d.name || "").trim().toLowerCase();
      return !retiredSet.has(name);
    });
    const after = tenant.departments.length;
    if (after !== before) {
      await tenant.save();
      tenantUpdates += 1;
      removedItems += before - after;
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        keptDefaults: DEFAULT_DEPARTMENT_SEEDS,
        removedDefaults: RETIRED_DEFAULT_DEPARTMENTS,
        legacyDeleted,
        tenantsUpdated: tenantUpdates,
        departmentRowsRemoved: removedItems,
        note: `Custom departments outside ${[...keepSet].join(", ")} were left alone unless they matched a retired default name.`,
      },
      null,
      2
    )
  );

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
