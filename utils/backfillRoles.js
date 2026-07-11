import Tenant from "../models/Tenant.js";
import User from "../models/User.js";
import SuperAdmin, { LEGACY_PLATFORM_CONFIG_EMAIL } from "../models/SuperAdmin.js";
import logger from "../core/logger.js";
import {
  getPlatformSuperAdminRole,
  resolveTenantRoleForUser,
  seedPlatformRoles,
  seedTenantRoles,
} from "../services/roleService.js";

/** Seed embedded roles, backfill roleId on users, and remove legacy role field. */
export async function backfillRolesAndPermissions() {
  await seedPlatformRoles();
  const superAdminRole = await getPlatformSuperAdminRole();
  if (superAdminRole) {
    const saResult = await SuperAdmin.updateMany(
      {
        email: { $ne: LEGACY_PLATFORM_CONFIG_EMAIL },
        $or: [{ roleId: null }, { roleId: { $exists: false } }],
      },
      { $set: { roleId: superAdminRole._id } }
    );
    if (saResult.modifiedCount > 0) {
      logger.info(`Backfilled roleId on ${saResult.modifiedCount} superadmin(s)`);
    }
  }

  const tenants = await Tenant.find({}).select("_id");
  let userUpdates = 0;

  for (const tenant of tenants) {
    await seedTenantRoles(tenant._id);

    const users = await User.find({ tenantId: tenant._id });

    for (const user of users) {
      let role = null;
      if (user.roleId) {
        role = await resolveTenantRoleForUser({
          tenantId: tenant._id,
          roleId: user.roleId,
          isTenantAdmin: user.isTenantAdmin,
        });
      }
      if (!role) {
        role = await resolveTenantRoleForUser({
          tenantId: tenant._id,
          legacyRole: user.role,
          isTenantAdmin: user.isTenantAdmin,
        });
      }
      if (!role) continue;

      await User.updateOne(
        { _id: user._id },
        {
          $set: {
            roleId: role._id,
            isTenantAdmin: Boolean(role.isOwnerRole || user.isTenantAdmin),
          },
          $unset: { role: "" },
        }
      );
      userUpdates += 1;
    }
  }

  if (userUpdates > 0) {
    logger.info(`Backfilled roleId on ${userUpdates} tenant user(s)`);
  }
}
