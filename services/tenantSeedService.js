import { seedTenantMasterData } from "./masterDataService.js";
import { seedTenantRoles } from "./roleService.js";

/** Seed default tenant roles and master data (departments, designations, …) into embedded arrays. */
export async function seedNewTenantDefaults(tenantId, { session } = {}) {
  await seedTenantRoles(tenantId, { session });
  await seedTenantMasterData(tenantId, { session });
}
