import Tenant from "../models/Tenant.js";
import User from "../models/User.js";
import { attachMasterLabelsToUsers, validateMasterDataRef } from "../services/masterDataService.js";
import { normalizeRoleForApi, normalizeStatusForApi } from "./userRoleMap.js";

function normalizeApiRole(role) {
  return String(role || "")
    .trim()
    .toUpperCase()
    .replace(/-/g, "_");
}

function isOwnerRoleDoc(roleDoc) {
  if (!roleDoc) return false;
  if (roleDoc.isOwnerRole === true) return true;
  return String(roleDoc.slug || "").toLowerCase() === "organization-owner";
}

/** True when the embedded role document is Organization Admin. */
export function isOrgAdminRole(roleDoc) {
  if (!roleDoc) return false;
  const slug = String(roleDoc.slug || "").toLowerCase();
  if (slug === "org-admin" || slug === "org_admin") return true;
  if (normalizeApiRole(roleDoc.legacyApiRole) === "ORG_ADMIN") return true;
  return String(roleDoc.name || "").trim().toLowerCase() === "organization admin";
}

export function isTenantAdminUser(user, roleDoc = null) {
  if (!user) return false;
  const doc = user.toObject ? user.toObject() : user;
  if (doc.isTenantAdmin === true) return true;
  if (isOwnerRoleDoc(roleDoc)) return true;
  if (normalizeApiRole(doc.role) === "TENANT_ADMIN") return true;
  return false;
}

/**
 * Resolve whether the acting user is the organization owner using DB + embedded role + JWT claim.
 */
export async function resolveTenantAdminActor(actor, tenantId) {
  if (!actor) return { user: null, isOwner: false, roleDoc: null };

  const id = actor._id || actor.id;
  let dbUser = actor;

  if (id) {
    const loaded = await User.findById(id).select("isTenantAdmin roleId tenantId email");
    if (loaded) dbUser = loaded;
  }

  let roleDoc = null;
  if (dbUser?.roleId && tenantId) {
    const tenant = await Tenant.findById(tenantId).select("roles");
    roleDoc =
      tenant?.roles?.id(dbUser.roleId) ||
      (tenant?.roles || []).find((r) => String(r._id) === String(dbUser.roleId)) ||
      null;
  }

  const isOwner =
    isTenantAdminUser(dbUser, roleDoc) || normalizeApiRole(actor.role) === "TENANT_ADMIN";

  return { user: dbUser, isOwner, roleDoc };
}

/** Mongo filter: tenant employees only (excludes organization owner). */
export function employeeUserFilter(tenantId) {
  return {
    tenantId,
    isTenantAdmin: { $ne: true },
  };
}

export function getRoleLabel(roleName, isTenantAdmin = false) {
  if (isTenantAdmin) return "Organization Owner";
  return roleName || "—";
}

export function userHasDefaultPassword(user) {
  if (!user) return false;
  const doc = user.toObject ? user.toObject() : user;
  if (doc.isDefaultPassword === true) return true;
  if (doc.mustChangePassword === true) return true;
  return false;
}

export function toPublicUser(user, ctx = null) {
  if (!user) return null;
  const doc = user.toObject ? user.toObject() : user;
  const isDefaultPassword = userHasDefaultPassword(doc);
  const roleDoc = doc.roleId ? ctx?.roleMap?.get(String(doc.roleId)) : null;
  const ownerFromRole = isOwnerRoleDoc(roleDoc);
  const isTenantAdmin =
    doc.isTenantAdmin === true ||
    ownerFromRole ||
    normalizeApiRole(doc.role) === "TENANT_ADMIN";
  const apiRole = isTenantAdmin
    ? "TENANT_ADMIN"
    : roleDoc?.legacyApiRole ||
      (roleDoc?.legacyRole ? normalizeRoleForApi(roleDoc.legacyRole) : null) ||
      null;
  const apiStatus = normalizeStatusForApi(doc.status);
  const roleLabel = roleDoc?.name || (isTenantAdmin ? "Organization Owner" : "—");

  const departmentDoc = doc.departmentId ? ctx?.masterMap?.get(String(doc.departmentId)) : null;
  const designationDoc = doc.designationId ? ctx?.masterMap?.get(String(doc.designationId)) : null;

  return {
    id: doc._id,
    name: doc.name || "",
    email: doc.email,
    role: apiRole,
    roleId: doc.roleId ? String(doc.roleId) : null,
    roleLabel,
    roleName: roleDoc?.name || (isTenantAdmin ? "Organization Owner" : null),
    roleSlug: roleDoc?.slug || (isTenantAdmin ? "organization-owner" : null),
    isOwnerRole: Boolean(ownerFromRole || isTenantAdmin),
    status: apiStatus,
    tenantId: doc.tenantId,
    phone: doc.phone || "",
    employeeId: doc.employeeId || "",
    departmentId: doc.departmentId ? String(doc.departmentId) : null,
    designationId: doc.designationId ? String(doc.designationId) : null,
    department: departmentDoc?.name || null,
    designation: designationDoc?.name || null,
    profilePhoto: doc.profilePhoto || "",
    isDefaultPassword,
    isTenantAdmin,
    createdAt: doc.createdAt,
  };
}

export async function toPublicUsers(users, tenantId) {
  const tenant = await Tenant.findById(tenantId).select("roles");
  const roleMap = new Map((tenant?.roles || []).map((r) => [String(r._id), r]));
  const { map: masterMap } = await attachMasterLabelsToUsers(users, tenantId);
  const ctx = { roleMap, masterMap };
  return users.map((u) => toPublicUser(u, ctx));
}

const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/;

export async function applyUserProfileFields(updates, body, tenantId) {
  if (body.phone !== undefined) updates.phone = String(body.phone).trim();
  if (body.employeeId !== undefined) updates.employeeId = String(body.employeeId).trim();
  if (body.profilePhoto !== undefined) updates.profilePhoto = String(body.profilePhoto);

  if (body.departmentId !== undefined) {
    if (!body.departmentId) {
      updates.departmentId = null;
    } else if (OBJECT_ID_RE.test(String(body.departmentId))) {
      const check = await validateMasterDataRef(tenantId, "department", body.departmentId);
      if (check.error) return check.error;
      updates.departmentId = check.doc._id;
    } else {
      return "MASTER_DATA_NOT_FOUND";
    }
  }

  if (body.designationId !== undefined) {
    if (!body.designationId) {
      updates.designationId = null;
    } else if (OBJECT_ID_RE.test(String(body.designationId))) {
      const check = await validateMasterDataRef(tenantId, "designation", body.designationId);
      if (check.error) return check.error;
      updates.designationId = check.doc._id;
    } else {
      return "MASTER_DATA_NOT_FOUND";
    }
  }

  return null;
}

export { validateMasterDataRef };
