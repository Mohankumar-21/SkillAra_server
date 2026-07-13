import logger from "../core/logger.js";
import { migrateLegacyTenantMasterData } from "../services/masterDataService.js";

/**
 * @deprecated Do not call on startup.
 * Legacy migration used to re-copy TenantMasterData into Tenant.departments on every
 * restart, which resurrected deleted departments. Defaults now seed only on tenant create.
 */
export async function migrateLegacyTenantMasterDataOnly() {
  logger.warn(
    "migrateLegacyTenantMasterDataOnly is deprecated and should not run on startup"
  );
  return migrateLegacyTenantMasterData();
}
