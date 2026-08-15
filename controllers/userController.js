import User from "../models/User.js";
import Tenant from "../models/Tenant.js";
import { hashPassword, verifyPassword } from "../services/password.js";
import { prepareResponseMsg, sendError } from "../utils/helper.js";
import {
  toPublicUsers,
  isTenantAdminUser,
  isOrgAdminRole,
  resolveTenantAdminActor,
  employeeUserFilter,
  applyUserProfileFields,
} from "../utils/user.js";
import {
  invitationStatusToDb,
} from "../utils/userRoleMap.js";
import {
  isAssignableTenantRole,
  getTenantRoleById,
} from "../services/roleService.js";
import { writeAuditLog } from "../services/auditLog.js";
import { normalizeStatusForDb } from "../utils/userRoleMap.js";
import logger from "../core/logger.js";

async function syncTenantUserCount(tenantId) {
  const count = await User.countDocuments({ tenantId, status: "active" });
  await Tenant.updateOne({ _id: tenantId }, { $set: { user_count: count } });
}

async function resolveCreatableRole({ tenantId, roleId, actor }) {
  if (!roleId) {
    return { error: "ROLE_INVALID" };
  }

  const roleDoc = await getTenantRoleById(tenantId, roleId);
  if (!roleDoc || !isAssignableTenantRole(roleDoc)) {
    return { error: "ROLE_INVALID" };
  }

  const { isOwner, user: actorUser } = await resolveTenantAdminActor(actor, tenantId);

  if (isOrgAdminRole(roleDoc) && !isOwner) {
    logger.warn("[user:role-assign] Org admin blocked", {
      tenantId: String(tenantId),
      actorId: String(actor?._id || actor?.id || ""),
      actorEmail: actorUser?.email || actor?.email || "",
      actorIsTenantAdmin: actorUser?.isTenantAdmin,
      actorJwtRole: actor?.role || null,
      resolvedIsOwner: isOwner,
      targetRoleId: String(roleId),
      targetRoleSlug: roleDoc.slug,
      targetRoleName: roleDoc.name,
    });
    return { error: "USER_ORG_ADMIN_FORBIDDEN" };
  }

  if (process.env.NODE_ENV !== "production") {
    logger.info("[user:role-assign] Role assignment allowed", {
      tenantId: String(tenantId),
      actorId: String(actor?._id || actor?.id || ""),
      resolvedIsOwner: isOwner,
      targetRoleSlug: roleDoc.slug,
      targetRoleName: roleDoc.name,
      isOrgAdminTarget: isOrgAdminRole(roleDoc),
    });
  }

  return { roleDoc };
}

export async function registerStudent(req, res) {
  return sendError(res, "AUTH_REGISTRATION_CLOSED", 403);
}

export async function changePassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = req.user;

    const ok = await verifyPassword(currentPassword, user.passwordHash);
    if (!ok) {
      return sendError(res, "AUTH_PASSWORD_INCORRECT", 401);
    }

    const passwordHash = await hashPassword(newPassword);
    await User.updateOne(
      { _id: user._id },
      { $set: { passwordHash, isDefaultPassword: false } }
    );

    return res
      .status(200)
      .send(prepareResponseMsg({ ok: true }, true, "Password changed successfully", 200));
  } catch (err) {
    return next(err);
  }
}

export async function listUsers(req, res, next) {
  try {
    const { status, page = 1, limit = 20, search, roleId, departmentId } = req.query;
    const tenantId = req.tenantId;

    const filter = { ...employeeUserFilter(tenantId) };
    if (roleId && /^[0-9a-fA-F]{24}$/.test(String(roleId))) {
      filter.roleId = roleId;
    }
    if (departmentId && /^[0-9a-fA-F]{24}$/.test(String(departmentId))) {
      filter.departmentId = departmentId;
    }
    if (status) {
      filter.status = normalizeStatusForDb(status);
    }
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }

    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));
    const skip = (pageNum - 1) * limitNum;

    const [users, totalCount] = await Promise.all([
      User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum),
      User.countDocuments(filter),
    ]);

    const publicUsers = await toPublicUsers(users, tenantId);

    return res.status(200).send(
      prepareResponseMsg(
        publicUsers,
        true,
        "Users fetched successfully",
        200,
        limitNum,
        totalCount
      )
    );
  } catch (err) {
    return next(err);
  }
}

export async function createUser(req, res, next) {
  try {
    const { name, password, roleId, invitationStatus, phone, employeeId, departmentId, designationId, profilePhoto } = req.body;
    const email = String(req.body?.email || "")
      .trim()
      .toLowerCase();
    const tenantId = req.tenantId;

    const resolved = await resolveCreatableRole({ tenantId, roleId, actor: req.user });
    if (resolved.error) {
      if (resolved.error === "USER_ORG_ADMIN_FORBIDDEN") {
        logger.warn("[user:create] Blocked org admin assignment", {
          tenantId: String(tenantId),
          actorId: String(req.user?._id || req.user?.id || ""),
          actorJwtRole: req.user?.role || null,
          roleId: String(roleId),
        });
      }
      return sendError(res, resolved.error, resolved.error === "USER_ORG_ADMIN_FORBIDDEN" ? 403 : 400);
    }
    const roleDoc = resolved.roleDoc;

    const existing = await User.findOne({ email, tenantId });
    if (existing) {
      return sendError(res, "USER_EMAIL_EXISTS", 409);
    }

    const passwordHash = await hashPassword(password);
    const status = invitationStatusToDb(invitationStatus);

    const profileFields = {};
    const profileError = await applyUserProfileFields(profileFields, {
      phone,
      employeeId,
      departmentId,
      designationId,
      profilePhoto,
    }, tenantId);
    if (profileError) {
      return sendError(res, profileError, 400);
    }

    const user = await User.create({
      tenantId,
      name: name.trim(),
      email,
      passwordHash,
      roleId: roleDoc._id,
      status,
      isTenantAdmin: false,
      ...profileFields,
    });

    await syncTenantUserCount(tenantId);

    const [publicUser] = await toPublicUsers([user], tenantId);

    return res
      .status(201)
      .send(prepareResponseMsg({ user: publicUser }, true, "User created successfully", 201));
  } catch (err) {
    return next(err);
  }
}

export async function getUser(req, res, next) {
  try {
    const user = await User.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!user) {
      return sendError(res, "USER_NOT_FOUND", 404);
    }

    const [publicUser] = await toPublicUsers([user], req.tenantId);

    return res
      .status(200)
      .send(prepareResponseMsg({ user: publicUser }, true, "User fetched successfully", 200));
  } catch (err) {
    return next(err);
  }
}

export async function updateUser(req, res, next) {
  try {
    const target = await User.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!target) {
      return sendError(res, "USER_NOT_FOUND", 404);
    }

    const isAdmin = isTenantAdminUser(req.user) || req.user?.role === "SUPER_ADMIN";
    const isSelf = String(target._id) === String(req.user._id || req.user.id);

    if (!isAdmin && !isSelf) {
      return sendError(res, "GENERAL_FORBIDDEN", 403);
    }

    const updates = {};
    if (req.body.name !== undefined) updates.name = req.body.name.trim();

    if (isAdmin && req.body.roleId !== undefined) {
      const resolved = await resolveCreatableRole({
        tenantId: req.tenantId,
        roleId: req.body.roleId,
        actor: req.user,
      });
      if (resolved.error) {
        return sendError(res, resolved.error, resolved.error === "USER_ORG_ADMIN_FORBIDDEN" ? 403 : 400);
      }
      if (isTenantAdminUser(target)) {
        return sendError(res, "USER_OWNER_PROTECTED", 400);
      }
      updates.roleId = resolved.roleDoc._id;
      updates.isTenantAdmin = false;
    }

    if (req.body.password) {
      if (!isAdmin && !isSelf) {
        return sendError(res, "GENERAL_FORBIDDEN", 403);
      }
      updates.passwordHash = await hashPassword(req.body.password);
    }

    if (isAdmin || isSelf) {
      const profileError = await applyUserProfileFields(updates, req.body, req.tenantId);
      if (profileError) {
        return sendError(res, profileError, 400);
      }
    }

    const updated = await User.findByIdAndUpdate(target._id, { $set: updates }, { new: true });

    if (updates.roleId) {
      await writeAuditLog({
        actorId: req.user._id || req.user.id,
        actorType: "tenant_user",
        action: "user.role_changed",
        targetId: target._id,
        tenantId: req.tenantId,
        ip: req.ip,
        metadata: {
          fromRoleId: target.roleId ? String(target.roleId) : null,
          toRoleId: updates.roleId ? String(updates.roleId) : null,
        },
      });
    }

    const [publicUser] = await toPublicUsers([updated], req.tenantId);

    return res
      .status(200)
      .send(
        prepareResponseMsg({ user: publicUser }, true, "User updated successfully", 200)
      );
  } catch (err) {
    return next(err);
  }
}

export async function updateUserStatus(req, res, next) {
  try {
    const { status } = req.body;
    const dbStatus = normalizeStatusForDb(status);
    if (!["active", "disabled"].includes(dbStatus)) {
      return sendError(res, "USER_STATUS_INVALID", 400);
    }

    const target = await User.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!target) {
      return sendError(res, "USER_NOT_FOUND", 404);
    }

    if (isTenantAdminUser(target)) {
      return sendError(res, "USER_OWNER_PROTECTED", 400);
    }

    if (String(target._id) === String(req.user._id || req.user.id)) {
      return sendError(res, "USER_SELF_STATUS", 400);
    }

    const updated = await User.findByIdAndUpdate(
      target._id,
      { $set: { status: dbStatus } },
      { new: true }
    );

    await syncTenantUserCount(req.tenantId);

    const [publicUser] = await toPublicUsers([updated], req.tenantId);

    return res
      .status(200)
      .send(
        prepareResponseMsg({ user: publicUser }, true, "User status updated", 200)
      );
  } catch (err) {
    return next(err);
  }
}

export async function updateMyProfile(req, res, next) {
  try {
    const { phone, profilePhoto, name } = req.body;
    const updates = {};

    if (name !== undefined) updates.name = name.trim();
    if (phone !== undefined) updates.phone = phone.trim();
    if (profilePhoto !== undefined) updates.profilePhoto = profilePhoto;

    if (Object.keys(updates).length === 0) {
      return sendError(res, "USER_NO_FIELDS", 400);
    }

    const updated = await User.findByIdAndUpdate(req.user._id || req.user.id, { $set: updates }, { new: true });

    // Self-service profile response feeds the session, so include permissions like /me does.
    const [publicUser] = await toPublicUsers([updated], req.tenantId, {
      includePermissions: true,
    });

    return res
      .status(200)
      .send(prepareResponseMsg({ user: publicUser }, true, "Profile updated successfully", 200));
  } catch (err) {
    return next(err);
  }
}

export async function deleteUser(req, res, next) {
  try {
    const target = await User.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!target) {
      return sendError(res, "USER_NOT_FOUND", 404);
    }

    if (isTenantAdminUser(target)) {
      return sendError(res, "USER_OWNER_PROTECTED", 400);
    }

    if (String(target._id) === String(req.user._id || req.user.id)) {
      return sendError(res, "USER_SELF_DELETE", 400);
    }

    await User.deleteOne({ _id: target._id });
    await syncTenantUserCount(req.tenantId);

    await writeAuditLog({
      actorId: req.user._id || req.user.id,
      actorType: "tenant_user",
      action: "user.deleted",
      targetId: target._id,
      tenantId: req.tenantId,
      ip: req.ip,
      metadata: { email: target.email, roleId: target.roleId ? String(target.roleId) : null },
    });

    return res
      .status(200)
      .send(prepareResponseMsg({ ok: true }, true, "User deleted successfully", 200));
  } catch (err) {
    return next(err);
  }
}
