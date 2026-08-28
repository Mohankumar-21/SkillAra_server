import Tenant from "../models/Tenant.js";
import User from "../models/User.js";
import SuperAdmin, { LEGACY_PLATFORM_CONFIG_EMAIL } from "../models/SuperAdmin.js";
import logger from "../core/logger.js";
import {
  getPlatformSuperAdminRole,
  resolveTenantRoleForUser,
  resyncCustomRoleLegacyHints,
  seedPlatformRoles,
  seedTenantRoles,
  syncSystemRolePermissions,
} from "../services/roleService.js";

/**
 * Backfill roleId on users/superadmins and bring every tenant's roles up to date.
 *
 * Since all tenant routes are gated by requirePermission(), a tenant provisioned before a
 * catalog change would be missing actions its seeded roles are meant to have — so system
 * role permission maps are re-synced here on every boot.
 */
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
  let roleUpdates = 0;
  let hintUpdates = 0;

  for (const tenant of tenants) {
    // Add any newly seeded roles, refresh system role permissions, then re-derive the
    // client-routing hint on custom roles (they were all stamped STUDENT before it was derived).
    await seedTenantRoles(tenant._id);
    roleUpdates += await syncSystemRolePermissions(tenant._id);
    hintUpdates += await resyncCustomRoleLegacyHints(tenant._id);

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

  if (roleUpdates > 0) {
    logger.info(`Re-synced permissions on ${roleUpdates} system role(s)`);
  }
  if (hintUpdates > 0) {
    logger.info(`Re-derived legacy role hint on ${hintUpdates} custom role(s)`);
  }
  if (userUpdates > 0) {
    logger.info(`Backfilled roleId on ${userUpdates} tenant user(s)`);
  }
}
