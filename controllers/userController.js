import User from "../models/User.js";
import Tenant from "../models/Tenant.js";
import { hashPassword, verifyPassword } from "../services/password.js";
import { prepareResponseMsg } from "../utils/helper.js";
import { toPublicUser } from "../utils/user.js";

async function syncTenantUserCount(tenantId) {
  const count = await User.countDocuments({ tenantId, status: "ACTIVE" });
  await Tenant.updateOne({ _id: tenantId }, { $set: { user_count: count } });
}

export async function registerStudent(req, res, next) {
  try {
    const { name, email, password } = req.body;
    const tenant = req.tenant;

    const existing = await User.findOne({ email, tenantId: tenant._id });
    if (existing) {
      return res.status(409).send(prepareResponseMsg({}, false, "Email already registered", 409));
    }

    const passwordHash = await hashPassword(password);
    const user = await User.create({
      tenantId: tenant._id,
      name: name.trim(),
      email,
      passwordHash,
      role: "STUDENT",
      status: "ACTIVE",
    });

    await syncTenantUserCount(tenant._id);

    return res
      .status(201)
      .send(prepareResponseMsg({ user: toPublicUser(user) }, true, "Registration successful", 201));
  } catch (err) {
    return next(err);
  }
}

export async function changePassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = req.user;

    const ok = await verifyPassword(currentPassword, user.passwordHash);
    if (!ok) {
      return res
        .status(401)
        .send(prepareResponseMsg({}, false, "Current password is incorrect", 401));
    }

    const passwordHash = await hashPassword(newPassword);
    await User.updateOne({ _id: user._id }, { $set: { passwordHash } });

    return res
      .status(200)
      .send(prepareResponseMsg({ ok: true }, true, "Password changed successfully", 200));
  } catch (err) {
    return next(err);
  }
}

export async function listUsers(req, res, next) {
  try {
    const { role, status, page = 1, limit = 20, search } = req.query;
    const tenantId = req.tenant._id;

    const filter = { tenantId };
    if (role) filter.role = role;
    if (status) filter.status = status;
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
      User.find(filter).sort({ created_on: -1 }).skip(skip).limit(limitNum),
      User.countDocuments(filter),
    ]);

    return res.status(200).send(
      prepareResponseMsg(
        users.map(toPublicUser),
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
    const { name, email, password, role } = req.body;
    const tenantId = req.tenant._id;

    if (!["TUTOR", "STUDENT"].includes(role)) {
      return res
        .status(400)
        .send(prepareResponseMsg({}, false, "Role must be TUTOR or STUDENT", 400));
    }

    const existing = await User.findOne({ email, tenantId });
    if (existing) {
      return res.status(409).send(prepareResponseMsg({}, false, "Email already exists", 409));
    }

    const passwordHash = await hashPassword(password);
    const user = await User.create({
      tenantId,
      name: name.trim(),
      email,
      passwordHash,
      role,
      status: "ACTIVE",
    });

    await syncTenantUserCount(tenantId);

    return res
      .status(201)
      .send(prepareResponseMsg({ user: toPublicUser(user) }, true, "User created successfully", 201));
  } catch (err) {
    return next(err);
  }
}

export async function getUser(req, res, next) {
  try {
    const user = await User.findOne({ _id: req.params.id, tenantId: req.tenant._id });
    if (!user) {
      return res.status(404).send(prepareResponseMsg({}, false, "User not found", 404));
    }

    return res
      .status(200)
      .send(prepareResponseMsg({ user: toPublicUser(user) }, true, "User fetched successfully", 200));
  } catch (err) {
    return next(err);
  }
}

export async function updateUser(req, res, next) {
  try {
    const target = await User.findOne({ _id: req.params.id, tenantId: req.tenant._id });
    if (!target) {
      return res.status(404).send(prepareResponseMsg({}, false, "User not found", 404));
    }

    const isAdmin = req.user.role === "TENANT_ADMIN";
    const isSelf = String(target._id) === String(req.user._id);

    if (!isAdmin && !isSelf) {
      return res.status(403).send(prepareResponseMsg({}, false, "Forbidden", 403));
    }

    const updates = {};
    if (req.body.name !== undefined) updates.name = req.body.name.trim();

    if (isAdmin) {
      if (req.body.role !== undefined) {
        if (!["TUTOR", "STUDENT"].includes(req.body.role)) {
          return res
            .status(400)
            .send(prepareResponseMsg({}, false, "Role must be TUTOR or STUDENT", 400));
        }
        if (target.role === "TENANT_ADMIN") {
          return res
            .status(400)
            .send(prepareResponseMsg({}, false, "Cannot change TENANT_ADMIN role", 400));
        }
        updates.role = req.body.role;
      }
    }

    if (req.body.password) {
      if (!isAdmin && !isSelf) {
        return res.status(403).send(prepareResponseMsg({}, false, "Forbidden", 403));
      }
      updates.passwordHash = await hashPassword(req.body.password);
    }

    const updated = await User.findByIdAndUpdate(target._id, { $set: updates }, { new: true });

    return res
      .status(200)
      .send(
        prepareResponseMsg({ user: toPublicUser(updated) }, true, "User updated successfully", 200)
      );
  } catch (err) {
    return next(err);
  }
}

export async function updateUserStatus(req, res, next) {
  try {
    const { status } = req.body;
    if (!["ACTIVE", "DISABLED"].includes(status)) {
      return res
        .status(400)
        .send(prepareResponseMsg({}, false, "Status must be ACTIVE or DISABLED", 400));
    }

    const target = await User.findOne({ _id: req.params.id, tenantId: req.tenant._id });
    if (!target) {
      return res.status(404).send(prepareResponseMsg({}, false, "User not found", 404));
    }

    if (target.role === "TENANT_ADMIN") {
      return res
        .status(400)
        .send(prepareResponseMsg({}, false, "Cannot disable TENANT_ADMIN", 400));
    }

    if (String(target._id) === String(req.user._id)) {
      return res
        .status(400)
        .send(prepareResponseMsg({}, false, "Cannot change your own status", 400));
    }

    const updated = await User.findByIdAndUpdate(
      target._id,
      { $set: { status } },
      { new: true }
    );

    await syncTenantUserCount(req.tenant._id);

    return res
      .status(200)
      .send(
        prepareResponseMsg({ user: toPublicUser(updated) }, true, "User status updated", 200)
      );
  } catch (err) {
    return next(err);
  }
}

export async function deleteUser(req, res, next) {
  try {
    const target = await User.findOne({ _id: req.params.id, tenantId: req.tenant._id });
    if (!target) {
      return res.status(404).send(prepareResponseMsg({}, false, "User not found", 404));
    }

    if (target.role === "TENANT_ADMIN") {
      return res
        .status(400)
        .send(prepareResponseMsg({}, false, "Cannot delete TENANT_ADMIN", 400));
    }

    if (String(target._id) === String(req.user._id)) {
      return res.status(400).send(prepareResponseMsg({}, false, "Cannot delete yourself", 400));
    }

    await User.updateOne({ _id: target._id }, { $set: { status: "DISABLED" } });
    await syncTenantUserCount(req.tenant._id);

    return res
      .status(200)
      .send(prepareResponseMsg({ ok: true }, true, "User disabled successfully", 200));
  } catch (err) {
    return next(err);
  }
}
