import Tenant from "../models/Tenant.js";
import SuperAdmin, { LEGACY_PLATFORM_CONFIG_EMAIL } from "../models/SuperAdmin.js";
import User from "../models/User.js";
import { prepareResponseMsg, sendError } from "../utils/helper.js";
import {
  attachPlatformRoleCounts,
  attachRoleCounts,
  getPermissionModules,
  getPlatformRoleCatalogAdmin,
  getPlatformRoleById,
  getTenantRoleById,
  normalizeRoleForApiResponse,
  deriveLegacyApiRole,
  legacyDbRoleFor,
} from "../services/roleService.js";
import { writeAuditLog } from "../services/auditLog.js";

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function sanitizePermissions(permissions, modules) {
  if (!permissions || typeof permissions !== "object") return {};
  const allowed = new Map(modules.map((m) => [m.id, new Set(m.actions)]));
  const next = {};
  for (const [moduleId, actions] of Object.entries(permissions)) {
    const validActions = allowed.get(moduleId);
    if (!validActions || !Array.isArray(actions)) continue;
    const filtered = actions.filter((a) => validActions.has(a));
    if (filtered.length) next[moduleId] = filtered;
  }
  return next;
}

export async function listTenantRoles(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const tenant = await Tenant.findById(tenantId);
    const roles = tenant?.roles?.filter((r) => r.status !== "deleted") || [];
    const payload = await attachRoleCounts(tenantId, roles);
    return res
      .status(200)
      .send(prepareResponseMsg({ roles: payload }, true, "Roles fetched successfully", 200));
  } catch (err) {
    return next(err);
  }
}

export async function getTenantPermissionModules(req, res, next) {
  try {
    return res.status(200).send(
      prepareResponseMsg({ modules: getPermissionModules("tenant") }, true, "Permission modules fetched", 200)
    );
  } catch (err) {
    return next(err);
  }
}

export async function getTenantRole(req, res, next) {
  try {
    const role = await getTenantRoleById(req.tenantId, req.params.id);
    if (!role || role.status === "deleted") return sendError(res, "ROLE_NOT_FOUND", 404);
    const [normalized] = await attachRoleCounts(req.tenantId, [role]);
    return res
      .status(200)
      .send(prepareResponseMsg({ role: normalized }, true, "Role fetched successfully", 200));
  } catch (err) {
    return next(err);
  }
}

export async function createTenantRole(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const name = String(req.body.name || "").trim();
    const description = String(req.body.description || "").trim();
    const status = req.body.status === "inactive" ? "inactive" : "active";
    const modules = getPermissionModules("tenant");
    const permissions = sanitizePermissions(req.body.permissions, modules);
    // Derived from the permission map, never from request input — see deriveLegacyApiRole.
    const legacyApiRole = deriveLegacyApiRole(permissions);
    const legacyRole = legacyDbRoleFor(legacyApiRole);

    if (!name || name.length < 2) return sendError(res, "ROLE_NAME_INVALID", 400);

    const tenant = await Tenant.findById(tenantId);
    if (!tenant) return sendError(res, "TENANT_NOT_FOUND", 404);

    const baseSlug = slugify(name);
    let slug = baseSlug;
    let suffix = 1;
    while (tenant.roles.some((r) => r.slug === slug)) {
      slug = `${baseSlug}-${suffix++}`;
    }

    tenant.roles.push({
      slug,
      name,
      description,
      permissions,
      roleType: "custom",
      protected: false,
      isOwnerRole: false,
      legacyRole,
      legacyApiRole,
      status,
    });
    await tenant.save();
    const role = tenant.roles[tenant.roles.length - 1];

    await writeAuditLog({
      actorId: req.user._id || req.user.id,
      actorType: "tenant_user",
      action: "role.created",
      targetId: role._id,
      tenantId,
      ip: req.ip,
      metadata: { name: role.name, slug: role.slug },
    });

    return res
      .status(201)
      .send(prepareResponseMsg({ role: normalizeRoleForApiResponse(role) }, true, "Role created successfully", 201));
  } catch (err) {
    return next(err);
  }
}

export async function updateTenantRole(req, res, next) {
  try {
    const tenant = await Tenant.findById(req.tenantId);
    if (!tenant) return sendError(res, "TENANT_NOT_FOUND", 404);

    const role = tenant.roles.id(req.params.id);
    if (!role || role.status === "deleted") return sendError(res, "ROLE_NOT_FOUND", 404);
    if (role.isOwnerRole) return sendError(res, "ROLE_OWNER_PROTECTED", 400);

    const modules = getPermissionModules("tenant");

    if (!role.protected && req.body.name !== undefined) {
      const name = String(req.body.name).trim();
      if (!name || name.length < 2) return sendError(res, "ROLE_NAME_INVALID", 400);
      role.name = name;
    }
    if (!role.protected && req.body.description !== undefined) {
      role.description = String(req.body.description).trim();
    }
    if (req.body.status !== undefined) {
      role.status = req.body.status === "inactive" ? "inactive" : "active";
    }
    if (req.body.permissions !== undefined) {
      role.permissions = sanitizePermissions(req.body.permissions, modules);
      // Protected system roles keep their seeded hint; custom roles re-derive theirs.
      if (!role.protected) {
        role.legacyApiRole = deriveLegacyApiRole(role.permissions);
        role.legacyRole = legacyDbRoleFor(role.legacyApiRole);
      }
    }

    await tenant.save();

    return res
      .status(200)
      .send(prepareResponseMsg({ role: normalizeRoleForApiResponse(role) }, true, "Role updated successfully", 200));
  } catch (err) {
    return next(err);
  }
}

export async function deleteTenantRole(req, res, next) {
  try {
    const tenant = await Tenant.findById(req.tenantId);
    if (!tenant) return sendError(res, "TENANT_NOT_FOUND", 404);

    const role = tenant.roles.id(req.params.id);
    if (!role || role.status === "deleted") return sendError(res, "ROLE_NOT_FOUND", 404);
    if (role.protected || role.isOwnerRole) return sendError(res, "ROLE_PROTECTED", 400);

    const assigned = await User.countDocuments({ tenantId: req.tenantId, roleId: role._id });
    if (assigned > 0) return sendError(res, "ROLE_IN_USE", 409);

    role.deleteOne();
    await tenant.save();

    return res.status(200).send(prepareResponseMsg({ ok: true }, true, "Role deleted successfully", 200));
  } catch (err) {
    return next(err);
  }
}

export async function listPlatformRoles(req, res, next) {
  try {
    const admin = await getPlatformRoleCatalogAdmin();
    if (!admin) return sendError(res, "GENERAL_NOT_FOUND", 404);
    const roles = admin.roles.filter((r) => r.status !== "deleted");
    const payload = await attachPlatformRoleCounts(roles);
    return res.status(200).send(prepareResponseMsg({ roles: payload }, true, "Platform roles fetched", 200));
  } catch (err) {
    return next(err);
  }
}

export async function getPlatformPermissionModules(req, res, next) {
  try {
    return res.status(200).send(
      prepareResponseMsg({ modules: getPermissionModules("platform") }, true, "Permission modules fetched", 200)
    );
  } catch (err) {
    return next(err);
  }
}

export async function getPlatformRole(req, res, next) {
  try {
    const role = await getPlatformRoleById(req.params.id);
    if (!role || role.status === "deleted") return sendError(res, "ROLE_NOT_FOUND", 404);
    const [normalized] = await attachPlatformRoleCounts([role]);
    return res.status(200).send(prepareResponseMsg({ role: normalized }, true, "Role fetched successfully", 200));
  } catch (err) {
    return next(err);
  }
}

export async function createPlatformRole(req, res, next) {
  try {
    const name = String(req.body.name || "").trim();
    const description = String(req.body.description || "").trim();
    const status = req.body.status === "inactive" ? "inactive" : "active";
    const modules = getPermissionModules("platform");
    const permissions = sanitizePermissions(req.body.permissions, modules);

    if (!name || name.length < 2) return sendError(res, "ROLE_NAME_INVALID", 400);

    const admin = await getPlatformRoleCatalogAdmin();
    if (!admin) return sendError(res, "GENERAL_NOT_FOUND", 404);

    const baseSlug = slugify(name);
    let slug = baseSlug;
    let suffix = 1;
    while (admin.roles.some((r) => r.slug === slug)) {
      slug = `${baseSlug}-${suffix++}`;
    }

    admin.roles.push({
      slug,
      name,
      description,
      permissions,
      roleType: "custom",
      protected: false,
      isOwnerRole: false,
      status,
    });
    await admin.save();
    const role = admin.roles[admin.roles.length - 1];

    return res
      .status(201)
      .send(prepareResponseMsg({ role: normalizeRoleForApiResponse(role) }, true, "Platform role created", 201));
  } catch (err) {
    return next(err);
  }
}

export async function updatePlatformRole(req, res, next) {
  try {
    const admin = await getPlatformRoleCatalogAdmin();
    if (!admin) return sendError(res, "GENERAL_NOT_FOUND", 404);

    const role = admin.roles.id(req.params.id);
    if (!role || role.status === "deleted") return sendError(res, "ROLE_NOT_FOUND", 404);

    const modules = getPermissionModules("platform");

    if (!role.protected && req.body.name !== undefined) {
      const name = String(req.body.name).trim();
      if (!name || name.length < 2) return sendError(res, "ROLE_NAME_INVALID", 400);
      role.name = name;
    }
    if (!role.protected && req.body.description !== undefined) {
      role.description = String(req.body.description).trim();
    }
    if (req.body.status !== undefined) {
      role.status = req.body.status === "inactive" ? "inactive" : "active";
    }
    if (req.body.permissions !== undefined) {
      role.permissions = sanitizePermissions(req.body.permissions, modules);
    }

    await admin.save();

    return res
      .status(200)
      .send(prepareResponseMsg({ role: normalizeRoleForApiResponse(role) }, true, "Platform role updated", 200));
  } catch (err) {
    return next(err);
  }
}

export async function deletePlatformRole(req, res, next) {
  try {
    const admin = await getPlatformRoleCatalogAdmin();
    if (!admin) return sendError(res, "GENERAL_NOT_FOUND", 404);

    const role = admin.roles.id(req.params.id);
    if (!role || role.status === "deleted") return sendError(res, "ROLE_NOT_FOUND", 404);
    if (role.protected) return sendError(res, "ROLE_PROTECTED", 400);

    const assigned = await SuperAdmin.countDocuments({
      email: { $ne: LEGACY_PLATFORM_CONFIG_EMAIL },
      roleId: role._id,
    });
    if (assigned > 0) return sendError(res, "ROLE_IN_USE", 409);

    role.deleteOne();
    await admin.save();

    return res.status(200).send(prepareResponseMsg({ ok: true }, true, "Platform role deleted", 200));
  } catch (err) {
    return next(err);
  }
}
