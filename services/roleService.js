import Tenant from "../models/Tenant.js";
import SuperAdmin, { LEGACY_PLATFORM_CONFIG_EMAIL } from "../models/SuperAdmin.js";
import User from "../models/User.js";
import logger from "../core/logger.js";
import {
  PLATFORM_PERMISSION_MODULES,
  PLATFORM_ROLE_SEEDS,
  TENANT_PERMISSION_MODULES,
  TENANT_ROLE_SEEDS,
} from "../data/permissionCatalog.js";
import { normalizeRoleForApi } from "../utils/userRoleMap.js";

export function normalizeRoleForApiResponse(role) {
  if (!role) return null;
  const doc = role.toObject ? role.toObject() : role;
  const usersAssigned = doc.usersAssigned ?? doc.userCount ?? 0;
  return {
    id: String(doc._id),
    _id: doc._id,
    slug: doc.slug,
    name: doc.name,
    description: doc.description || "",
    permissions: doc.permissions || {},
    roleType: doc.roleType,
    protected: Boolean(doc.protected),
    isOwnerRole: Boolean(doc.isOwnerRole),
    legacyRole: doc.legacyRole || null,
    legacyApiRole: doc.legacyApiRole || null,
    apiRole: doc.legacyApiRole || null,
    status: doc.status,
    usersAssigned,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export function getPermissionModules(scope) {
  return scope === "platform" ? PLATFORM_PERMISSION_MODULES : TENANT_PERMISSION_MODULES;
}

function findRoleBySlug(roles, slug) {
  return roles.find((r) => r.slug === slug && r.status === "active");
}

function findRoleByLegacy(roles, legacyRole) {
  if (!legacyRole) return null;
  return roles.find(
    (r) => r.legacyRole === String(legacyRole).toLowerCase() && r.status === "active"
  );
}

function findRoleById(roles, roleId) {
  if (!roleId) return null;
  return roles.find((r) => String(r._id) === String(roleId) && r.status === "active");
}

function isRealSuperAdminDoc(doc) {
  return doc && doc.email !== LEGACY_PLATFORM_CONFIG_EMAIL && Boolean(doc.passwordHash);
}

/** Primary super admin account — platform roles catalog lives on this document's roles[] array. */
export async function getPlatformRoleCatalogAdmin() {
  const admin = await SuperAdmin.findOne({
    email: { $ne: LEGACY_PLATFORM_CONFIG_EMAIL },
  }).sort({ createdAt: 1 });

  if (!isRealSuperAdminDoc(admin)) return null;
  if (!Array.isArray(admin.roles)) admin.roles = [];
  return admin;
}

/**
 * Move roles from the legacy __platform_config__ document into the first real super admin,
 * remap roleId references, then delete the config record.
 */
export async function migrateLegacyPlatformConfigDocument() {
  const legacy = await SuperAdmin.findOne({
    $or: [{ email: LEGACY_PLATFORM_CONFIG_EMAIL }, { isPlatformConfig: true }],
  });
  if (!legacy) return false;

  const primary = await SuperAdmin.findOne({
    _id: { $ne: legacy._id },
    email: { $ne: LEGACY_PLATFORM_CONFIG_EMAIL },
  }).sort({ createdAt: 1 });

  if (!primary || !isRealSuperAdminDoc(primary)) {
    logger.warn("Legacy platform config found but no primary super admin to migrate roles into");
    return false;
  }

  if (!Array.isArray(primary.roles)) primary.roles = [];

  const idMap = new Map();
  for (const role of legacy.roles || []) {
    const plain = role.toObject ? role.toObject() : role;
    let target = primary.roles.find((r) => r.slug === plain.slug);
    if (!target) {
      primary.roles.push({
        slug: plain.slug,
        name: plain.name,
        description: plain.description,
        permissions: plain.permissions,
        roleType: plain.roleType,
        protected: plain.protected,
        isOwnerRole: Boolean(plain.isOwnerRole),
        legacyRole: plain.legacyRole,
        legacyApiRole: plain.legacyApiRole,
        status: plain.status || "active",
      });
      target = primary.roles[primary.roles.length - 1];
    }
    idMap.set(String(plain._id), target._id);
  }

  await primary.save();

  const admins = await SuperAdmin.find({
    _id: { $ne: legacy._id },
    email: { $ne: LEGACY_PLATFORM_CONFIG_EMAIL },
  });

  for (const admin of admins) {
    if (!admin.roleId) continue;
    const mapped = idMap.get(String(admin.roleId));
    if (mapped && String(mapped) !== String(admin.roleId)) {
      admin.roleId = mapped;
      await admin.save();
    }
  }

  await SuperAdmin.deleteOne({ _id: legacy._id });
  logger.info(`Migrated platform roles into super admin ${primary.email} and removed legacy config document`);
  return true;
}

export async function seedPlatformRoles() {
  await migrateLegacyPlatformConfigDocument();

  const admin = await getPlatformRoleCatalogAdmin();
  if (!admin) return [];

  let changed = false;
  for (const seed of PLATFORM_ROLE_SEEDS) {
    if (!findRoleBySlug(admin.roles, seed.slug)) {
      admin.roles.push({
        slug: seed.slug,
        name: seed.name,
        description: seed.description,
        permissions: seed.permissions,
        roleType: seed.roleType,
        protected: seed.protected,
        isOwnerRole: false,
        status: "active",
      });
      changed = true;
    }
  }

  if (changed) await admin.save();
  return admin.roles;
}

export async function seedTenantRoles(tenantId, { session } = {}) {
  const query = Tenant.findById(tenantId);
  if (session) query.session(session);
  const tenant = await query;
  if (!tenant) return [];

  let changed = false;
  for (const seed of TENANT_ROLE_SEEDS) {
    if (!findRoleBySlug(tenant.roles, seed.slug)) {
      tenant.roles.push({
        slug: seed.slug,
        name: seed.name,
        description: seed.description,
        permissions: seed.permissions,
        roleType: seed.roleType,
        protected: seed.protected,
        isOwnerRole: Boolean(seed.isOwnerRole),
        legacyRole: seed.legacyRole || null,
        legacyApiRole: seed.legacyApiRole || null,
        status: "active",
      });
      changed = true;
    }
  }

  if (changed) await tenant.save(session ? { session } : undefined);
  return tenant.roles;
}

export async function getTenantRoles(tenantId, { session } = {}) {
  const query = Tenant.findById(tenantId).select("roles");
  if (session) query.session(session);
  const tenant = await query;
  return tenant?.roles || [];
}

export async function getTenantRoleBySlug(tenantId, slug, { session } = {}) {
  const roles = await getTenantRoles(tenantId, { session });
  return findRoleBySlug(roles, slug) || null;
}

export async function getTenantRoleByLegacy(tenantId, legacyRole) {
  const roles = await getTenantRoles(tenantId);
  return findRoleByLegacy(roles, legacyRole);
}

export async function getTenantRoleById(tenantId, roleId) {
  const tenant = await Tenant.findById(tenantId);
  if (!tenant) return null;
  return tenant.roles.id(roleId) || findRoleById(tenant.roles, roleId);
}

export async function getPlatformSuperAdminRole() {
  const admin = await getPlatformRoleCatalogAdmin();
  if (!admin) return null;
  return findRoleBySlug(admin.roles, "super-admin");
}

export async function getPlatformRoleById(roleId) {
  const admin = await getPlatformRoleCatalogAdmin();
  if (!admin) return null;
  return admin.roles.id(roleId) || findRoleById(admin.roles, roleId);
}

export function isAssignableTenantRole(role) {
  if (!role || role.status !== "active") return false;
  if (role.isOwnerRole || role.slug === "organization-owner") return false;
  return true;
}

export async function getAccessTokenRoleForUser(user) {
  if (!user) return "STUDENT";
  const role = await resolveTenantRoleForUser({
    tenantId: user.tenantId,
    roleId: user.roleId,
    isTenantAdmin: user.isTenantAdmin,
  });
  if (role?.legacyApiRole) return role.legacyApiRole;
  if (role?.legacyRole) return normalizeRoleForApi(role.legacyRole);
  if (user.isTenantAdmin) return "TENANT_ADMIN";
  return "STUDENT";
}

export async function resolveTenantRoleForUser({ tenantId, roleId, legacyRole, isTenantAdmin }) {
  const tenant = await Tenant.findById(tenantId);
  if (!tenant) return null;

  if (roleId) {
    const byId = tenant.roles.id(roleId) || findRoleById(tenant.roles, roleId);
    if (byId?.status === "active") return byId;
  }
  if (isTenantAdmin) {
    return findRoleBySlug(tenant.roles, "organization-owner");
  }
  if (legacyRole) {
    return findRoleByLegacy(tenant.roles, legacyRole);
  }
  return null;
}

export async function attachRoleCounts(tenantId, roles) {
  const ids = roles.map((r) => r._id);
  const counts = await User.aggregate([
    { $match: { tenantId, roleId: { $in: ids } } },
    { $group: { _id: "$roleId", count: { $sum: 1 } } },
  ]);
  const map = new Map(counts.map((c) => [String(c._id), c.count]));
  return roles.map((role) => ({
    ...normalizeRoleForApiResponse(role),
    usersAssigned: map.get(String(role._id)) || 0,
  }));
}

export async function attachPlatformRoleCounts(roles) {
  const ids = roles.map((r) => r._id);
  const counts = await SuperAdmin.aggregate([
    {
      $match: {
        email: { $ne: LEGACY_PLATFORM_CONFIG_EMAIL },
        roleId: { $in: ids },
      },
    },
    { $group: { _id: "$roleId", count: { $sum: 1 } } },
  ]);
  const map = new Map(counts.map((c) => [String(c._id), c.count]));
  return roles.map((role) => ({
    ...normalizeRoleForApiResponse(role),
    usersAssigned: map.get(String(role._id)) || 0,
  }));
}

export function roleGrantsPermission(role, moduleId, action) {
  if (!role?.permissions) return false;
  const actions = role.permissions[moduleId];
  return Array.isArray(actions) && actions.includes(action);
}

export function applyRoleToUser(user, role) {
  if (!role) return user;
  user.roleId = role._id;
  user.isTenantAdmin = Boolean(role.isOwnerRole);
  return user;
}

/** @deprecated Use applyRoleToUser */
export function syncUserLegacyRoleFromRole(user, role) {
  return applyRoleToUser(user, role);
}

export function publicRoleFromUser(user, role) {
  const apiRole = role?.legacyApiRole || (role?.legacyRole ? normalizeRoleForApi(role.legacyRole) : null);
  return {
    roleId: role?._id ? String(role._id) : user?.roleId ? String(user.roleId) : null,
    role: apiRole,
    roleSlug: role?.slug || null,
    roleName: role?.name || null,
    permissions: role?.permissions || {},
    isTenantAdmin: Boolean(user?.isTenantAdmin),
  };
}
