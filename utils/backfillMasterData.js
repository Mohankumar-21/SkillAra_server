import Tenant from "../models/Tenant.js";
import logger from "../core/logger.js";
import {
  migrateLegacyTenantMasterData,
  seedTenantMasterData,
} from "../services/masterDataService.js";

/** Migrate legacy master data collection and seed defaults for all tenants. */
export async function backfillTenantMasterData() {
  await migrateLegacyTenantMasterData();

  const tenants = await Tenant.find({}).select("_id");
  for (const tenant of tenants) {
    await seedTenantMasterData(tenant._id);
  }
  if (tenants.length > 0) {
    logger.info(`Ensured embedded master data for ${tenants.length} tenant(s)`);
  }
}
