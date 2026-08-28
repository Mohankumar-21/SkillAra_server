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

/**
 * Client-routing hint derived from what a role can actually do.
 *
 * The tenant UI still routes on the legacy bucket (ProtectedRoute roles={[...]}), so every
 * role needs one. It is DERIVED, never accepted from request input: a caller who can create
 * roles must not be able to hand themselves a privilege tier. TENANT_ADMIN is deliberately
 * unreachable here — organization ownership comes from isOwnerRole alone.
 */
export function deriveLegacyApiRole(permissions) {
  const can = (moduleId, action) => {
    const actions = permissions?.[moduleId];
    return Array.isArray(actions) && actions.includes(action);
  };

  if (
    can("users", "manage") ||
    can("users", "create") ||
    can("roles", "create") ||
    can("org-settings", "manage")
  ) {
    return "ORG_ADMIN";
  }

  if (
    can("courses", "create") ||
    can("courses", "edit") ||
    can("courses", "approve") ||
    can("lessons", "create") ||
    can("quizzes", "create") ||
    can("mock-tests", "create") ||
    can("live-sessions", "create") ||
    can("mentorship", "claim") ||
    can("forum", "moderate")
  ) {
    return "TUTOR";
  }

  return "STUDENT";
}

const LEGACY_API_TO_DB_ROLE = {
  TENANT_ADMIN: "tenant_admin",
  ORG_ADMIN: "org_admin",
  TUTOR: "instructor",
  STUDENT: "student",
};

export function legacyDbRoleFor(legacyApiRole) {
  return LEGACY_API_TO_DB_ROLE[legacyApiRole] || "student";
}

export function getPermissionModules(scope) {
  return scope === "platform" ? PLATFORM_PERMISSION_MODULES : TENANT_PERMISSION_MODULES;
}

function findRoleBySlug(roles, slug) {
  return roles.find((r) => r.slug === slug && r.status === "active");
}

/**
 * Last-resort lookup for tokens that carry only a role string.
 *
 * Matches both spellings because the two live side by side: `legacyRole` is the db form
 * ("instructor") and `legacyApiRole` the API form ("TUTOR"), and callers pass whichever
 * their token happens to hold. Only used when roleId is absent.
 */
function findRoleByLegacy(roles, legacyRole) {
  if (!legacyRole) return null;
  const lower = String(legacyRole).toLowerCase();
  const upper = String(legacyRole).toUpperCase().replace(/-/g, "_");
  return roles.find(
    (r) => r.status === "active" && (r.legacyRole === lower || r.legacyApiRole === upper)
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

/**
 * Bring a tenant's seeded system roles back in line with TENANT_ROLE_SEEDS.
 *
 * Needed because every tenant route is now gated by requirePermission(): a tenant
 * provisioned before a catalog change would be missing the actions its role is meant
 * to have. Only `roleType: "system"` roles are touched — operator-created custom roles
 * and any status changes made in the admin UI are left alone.
 */
export async function syncSystemRolePermissions(tenantId) {
  const tenant = await Tenant.findById(tenantId).select("roles");
  if (!tenant) return 0;

  let changed = 0;
  for (const seed of TENANT_ROLE_SEEDS) {
    const role = tenant.roles.find((r) => r.slug === seed.slug);
    if (!role) continue;

    // Metadata drift counts as a change too: a seed whose permissions already match but
    // whose legacyApiRole moved (Support and Content Reviewer became staff) would otherwise
    // be updated in memory and never saved.
    const next = {
      permissions: seed.permissions,
      protected: seed.protected,
      isOwnerRole: Boolean(seed.isOwnerRole),
      legacyRole: seed.legacyRole || null,
      legacyApiRole: seed.legacyApiRole || null,
      roleType: "system",
    };

    let roleChanged = false;
    for (const [key, value] of Object.entries(next)) {
      if (JSON.stringify(role[key] ?? null) !== JSON.stringify(value ?? null)) {
        role[key] = value;
        roleChanged = true;
      }
    }
    if (roleChanged) changed += 1;
  }

  if (changed > 0) await tenant.save();
  return changed;
}

/**
 * Re-derive legacyApiRole/legacyRole on custom roles from their permission map.
 *
 * Custom roles created before this became derived were all stamped STUDENT regardless of
 * what they could do, which broke client routing for staff-shaped custom roles.
 */
export async function resyncCustomRoleLegacyHints(tenantId) {
  const tenant = await Tenant.findById(tenantId).select("roles");
  if (!tenant) return 0;

  const seededSlugs = new Set(TENANT_ROLE_SEEDS.map((seed) => seed.slug));

  let changed = 0;
  for (const role of tenant.roles) {
    // Anything that is not a shipped seed is operator-defined, whatever roleType says.
    // Older builds stamped custom roles as "system", which stranded them without a hint.
    if (seededSlugs.has(role.slug) || role.isOwnerRole) continue;

    const legacyApiRole = deriveLegacyApiRole(role.permissions);
    const legacyRole = legacyDbRoleFor(legacyApiRole);

    if (
      role.roleType !== "custom" ||
      role.legacyApiRole !== legacyApiRole ||
      role.legacyRole !== legacyRole
    ) {
      role.roleType = "custom";
      role.legacyApiRole = legacyApiRole;
      role.legacyRole = legacyRole;
      changed += 1;
    }
  }

  if (changed > 0) await tenant.save();
  return changed;
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
  const tenant = await Tenant.findById(tenantId).select("roles");
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
  if (!user) return "LEARNER";
  const role = await resolveTenantRoleForUser({
    tenantId: user.tenantId,
    roleId: user.roleId,
    isTenantAdmin: user.isTenantAdmin,
  });
  if (role?.isOwnerRole || user.isTenantAdmin) return "TENANT_ADMIN";
  if (role?.legacyApiRole) return role.legacyApiRole;
  if (role?.legacyRole) return normalizeRoleForApi(role.legacyRole);
  // Roles created before the hint was derived have neither field stored.
  if (role?.permissions) return deriveLegacyApiRole(role.permissions);
  return "LEARNER";
}

/**
 * Resolve the acting user's role from whatever shape req.user happens to be.
 *
 * req.user is built by one of three middlewares and they do not agree: authenticate()
 * yields token claims, authenticateLegacy() can yield a full Mongoose User document, and
 * older tokens carry only a role string. Rather than trust any of them to carry roleId,
 * fall back to reading it from the user row — a missing roleId used to surface as
 * "Role not found for user" on every single permission-gated route.
 */
export async function resolveRoleForActor(actor, tenantId) {
  if (!actor || !tenantId) return null;

  let roleId = actor.roleId || null;
  let isTenantAdmin = actor.isTenantAdmin;

  if (!roleId) {
    const id = actor.id || actor._id;
    if (id) {
      const dbUser = await User.findById(id).select("roleId isTenantAdmin");
      roleId = dbUser?.roleId || null;
      if (isTenantAdmin === undefined) isTenantAdmin = dbUser?.isTenantAdmin;
    }
  }

  return resolveTenantRoleForUser({
    tenantId,
    roleId,
    legacyRole: actor.role,
    isTenantAdmin,
  });
}

export async function resolveTenantRoleForUser({ tenantId, roleId, legacyRole, isTenantAdmin }) {
  // Runs on every permission-gated request — project to roles only.
  const tenant = await Tenant.findById(tenantId).select("roles");
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

/**
 * Everyone in the tenant whose role grants `moduleId:action`.
 *
 * Lets features address people by what they are allowed to do rather than by role name, so
 * renamed or cloned roles keep working — used for "who can review a course" and "who can
 * approve an enrolment request".
 */
export async function usersWithPermission(tenantId, moduleId, action) {
  const tenant = await Tenant.findById(tenantId).select("roles");
  if (!tenant) return [];

  const roleIds = (tenant.roles || [])
    .filter((role) => role.status === "active" && roleGrantsPermission(role, moduleId, action))
    .map((role) => role._id);
  if (roleIds.length === 0) return [];

  const roleNameById = new Map((tenant.roles || []).map((r) => [String(r._id), r.name]));

  const users = await User.find({
    tenantId,
    roleId: { $in: roleIds },
    status: { $ne: "disabled" },
  }).select("name email roleId");

  return users.map((user) => ({
    id: String(user._id),
    name: user.name || "",
    email: user.email,
    roleId: String(user.roleId),
    roleName: roleNameById.get(String(user.roleId)) || "",
  }));
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
