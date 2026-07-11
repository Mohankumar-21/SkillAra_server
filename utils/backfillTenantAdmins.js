import User from "../models/User.js";
import logger from "../core/logger.js";

/** Set isTenantAdmin on existing organization owners created before the flag existed. */
export async function backfillTenantAdmins() {
  const result = await User.updateMany(
    {
      isTenantAdmin: true,
    },
    { $set: { isTenantAdmin: true } }
  );

  const legacyOwners = await User.updateMany(
    {
      role: { $in: ["tenant_admin", "TENANT_ADMIN"] },
      isTenantAdmin: { $ne: true },
    },
    { $set: { isTenantAdmin: true }, $unset: { role: "" } }
  );

  const total = (result.modifiedCount || 0) + (legacyOwners.modifiedCount || 0);
  if (total > 0) {
    logger.info(`Backfilled isTenantAdmin on ${total} organization owner(s)`);
  }
}
