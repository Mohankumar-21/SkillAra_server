import mongoose from "mongoose";
import OwnershipTransferRequest, { PREVIOUS_OWNER_ROLE } from "../models/OwnershipTransferRequest.js";
import User from "../models/User.js";
import Tenant from "../models/Tenant.js";
import Session from "../models/Session.js";
import { prepareResponseMsg, sendError } from "../utils/helper.js";
import { getActor } from "../utils/actor.js";
import { toPublicUser, isTenantAdminUser } from "../utils/user.js";
import { getTenantRoleBySlug } from "../services/roleService.js";
import { auditFromRequest } from "../services/auditService.js";
import { normalizeTenantForApi } from "../utils/tenantMapper.js";

function normalizePopulatedTenant(tenantDoc) {
  if (!tenantDoc || typeof tenantDoc !== "object") return tenantDoc;
  return normalizeTenantForApi(tenantDoc);
}

async function isEligibleOwnershipTarget(user, tenantId) {
  if (!user) return false;
  const orgAdminRole = await getTenantRoleBySlug(tenantId, "org-admin");
  if (!orgAdminRole) return false;
  const status = String(user.status || "").toLowerCase();
  return String(user.roleId) === String(orgAdminRole._id) && status === "active";
}

export async function listEligibleOwnershipTargets(req, res, next) {
  try {
    if (!isTenantAdminUser(req.user)) {
      return sendError(res, "GENERAL_FORBIDDEN", 403);
    }

    const orgAdminRole = await getTenantRoleBySlug(req.tenantId, "org-admin");
    if (!orgAdminRole) {
      return res.status(200).send(
        prepareResponseMsg({ users: [] }, true, "Eligible ownership targets fetched", 200)
      );
    }

    const users = await User.find({
      tenantId: req.tenantId,
      roleId: orgAdminRole._id,
      status: "active",
    }).sort({ name: 1 });

    const tenant = await Tenant.findById(req.tenantId).select("roles");
    const roleMap = new Map((tenant?.roles || []).map((r) => [String(r._id), r]));

    return res.status(200).send(
      prepareResponseMsg(
        { users: users.map((u) => toPublicUser(u, { roleMap })) },
        true,
        "Eligible ownership targets fetched",
        200
      )
    );
  } catch (err) {
    return next(err);
  }
}

function toPublicRequest(doc, extras = {}) {
  if (!doc) return null;
  const d = doc.toObject ? doc.toObject() : doc;
  return {
    id: d._id,
    tenantId: d.tenantId,
    requestedBy: d.requestedBy,
    targetUserId: d.targetUserId,
    previousOwnerNewRole: d.previousOwnerNewRole,
    appliedPreviousOwnerNewRole: d.appliedPreviousOwnerNewRole || null,
    reason: d.reason || "",
    status: d.status,
    reviewedBy: d.reviewedBy,
    reviewedAt: d.reviewedAt,
    reviewNote: d.reviewNote || "",
    created_on: d.created_on,
    updated_on: d.updated_on,
    ...extras,
  };
}

async function revokeUserSessions(userIds, reason) {
  const now = new Date();
  await Session.updateMany(
    { userId: { $in: userIds }, revokedAt: null },
    { $set: { revokedAt: now, revokedReason: reason } }
  );
}

export async function createOwnershipTransferRequest(req, res, next) {
  try {
    if (!isTenantAdminUser(req.user)) {
      return sendError(res, "OWNERSHIP_FORBIDDEN", 403);
    }

    const { targetUserId, reason = "" } = req.body;

    if (String(targetUserId) === String(getActor(req).id)) {
      return sendError(res, "OWNERSHIP_SELF", 400);
    }

    const pending = await OwnershipTransferRequest.findOne({
      tenantId: req.tenantId,
      status: "PENDING",
    });
    if (pending) {
      return sendError(res, "OWNERSHIP_PENDING_EXISTS", 409);
    }

    const target = await User.findOne({
      _id: targetUserId,
      tenantId: req.tenantId,
    });
    if (!target || !(await isEligibleOwnershipTarget(target, req.tenantId))) {
      return sendError(res, "OWNERSHIP_TARGET_INELIGIBLE", 404);
    }

    const request = await OwnershipTransferRequest.create({
      tenantId: req.tenantId,
      requestedBy: getActor(req).id,
      targetUserId: target._id,
      previousOwnerNewRole: PREVIOUS_OWNER_ROLE,
      reason: reason.trim(),
      status: "PENDING",
    });

    await auditFromRequest(req, {
      action: "ownership.transfer.requested",
      resourceType: "OwnershipTransferRequest",
      resourceId: request._id,
      metadata: {
        targetUserId: target._id,
        targetEmail: target.email,
        targetName: target.name,
        previousOwnerNewRole: PREVIOUS_OWNER_ROLE,
      },
    });

    const populated = await OwnershipTransferRequest.findById(request._id)
      .populate("requestedBy", "name email")
      .populate("targetUserId", "name email role")
      .populate("tenantId", "name subdomain");

    return res.status(201).send(
      prepareResponseMsg(
        {
          request: toPublicRequest(populated, {
            tenant: normalizePopulatedTenant(populated.tenantId),
            currentOwner: toPublicUser(populated.requestedBy),
            targetUser: toPublicUser(populated.targetUserId),
          }),
        },
        true,
        "Ownership transfer request submitted for platform approval",
        201
      )
    );
  } catch (err) {
    return next(err);
  }
}

export async function listMyOwnershipTransferRequests(req, res, next) {
  try {
    if (!isTenantAdminUser(req.user)) {
      return sendError(res, "GENERAL_FORBIDDEN", 403);
    }

    const requests = await OwnershipTransferRequest.find({ tenantId: req.tenantId })
      .sort({ created_on: -1 })
      .populate("requestedBy", "name email")
      .populate("targetUserId", "name email role")
      .populate("reviewedBy", "name email")
      .limit(20);

    return res.status(200).send(
      prepareResponseMsg(
        {
          requests: requests.map((r) =>
            toPublicRequest(r, {
              currentOwner: toPublicUser(r.requestedBy),
              targetUser: toPublicUser(r.targetUserId),
              reviewer: r.reviewedBy ? toPublicUser(r.reviewedBy) : null,
            })
          ),
        },
        true,
        "Requests fetched successfully",
        200
      )
    );
  } catch (err) {
    return next(err);
  }
}

export async function cancelOwnershipTransferRequest(req, res, next) {
  try {
    const request = await OwnershipTransferRequest.findOne({
      _id: req.params.id,
      tenantId: req.tenantId,
      requestedBy: getActor(req).id,
      status: "PENDING",
    });

    if (!request) {
      return sendError(res, "OWNERSHIP_REQUEST_NOT_FOUND", 404);
    }

    request.status = "CANCELLED";
    await request.save();

    await auditFromRequest(req, {
      action: "ownership.transfer.cancelled",
      resourceType: "OwnershipTransferRequest",
      resourceId: request._id,
      metadata: { targetUserId: request.targetUserId },
    });

    return res
      .status(200)
      .send(prepareResponseMsg({ request: toPublicRequest(request) }, true, "Request cancelled", 200));
  } catch (err) {
    return next(err);
  }
}

export async function listOwnershipTransferRequests(req, res, next) {
  try {
    const { status } = req.query;
    const filter = {};
    if (status) filter.status = status;

    const requests = await OwnershipTransferRequest.find(filter)
      .sort({ created_on: -1 })
      .populate("tenantId", "name subdomain email status")
      .populate("requestedBy", "name email role")
      .populate("targetUserId", "name email role")
      .populate("reviewedBy", "name email")
      .limit(100);

    return res.status(200).send(
      prepareResponseMsg(
        {
          requests: requests.map((r) =>
            toPublicRequest(r, {
              tenant: normalizePopulatedTenant(r.tenantId),
              currentOwner: toPublicUser(r.requestedBy),
              targetUser: toPublicUser(r.targetUserId),
              reviewer: r.reviewedBy ? toPublicUser(r.reviewedBy) : null,
            })
          ),
        },
        true,
        "Ownership transfer requests fetched",
        200
      )
    );
  } catch (err) {
    return next(err);
  }
}

export async function approveOwnershipTransferRequest(req, res, next) {
  const session = await mongoose.startSession();
  try {
    const { reviewNote = "" } = req.body;

    const request = await OwnershipTransferRequest.findById(req.params.id).session(session);
    if (!request || request.status !== "PENDING") {
      await session.endSession();
      return sendError(res, "OWNERSHIP_REQUEST_NOT_FOUND", 404);
    }

    const ownerRole = await getTenantRoleBySlug(request.tenantId, "organization-owner");
    const orgAdminRole = await getTenantRoleBySlug(request.tenantId, "org-admin");
    if (!ownerRole || !orgAdminRole) {
      await session.endSession();
      return sendError(res, "ROLE_INVALID", 500);
    }

    const [currentOwner, target, tenant] = await Promise.all([
      User.findById(request.requestedBy).session(session),
      User.findById(request.targetUserId).session(session),
      Tenant.findById(request.tenantId).session(session),
    ]);

    if (!tenant || tenant.status === false) {
      await session.endSession();
      return sendError(res, "OWNERSHIP_ORG_INACTIVE", 400);
    }

    if (!currentOwner || !isTenantAdminUser(currentOwner)) {
      await session.endSession();
      return sendError(res, "OWNERSHIP_OWNER_INVALID", 400);
    }

    if (!target || String(target.tenantId) !== String(request.tenantId)) {
      await session.endSession();
      return sendError(res, "OWNERSHIP_TARGET_INELIGIBLE", 400);
    }

    if (!(await isEligibleOwnershipTarget(target, request.tenantId))) {
      await session.endSession();
      return sendError(res, "OWNERSHIP_TARGET_INVALID", 400);
    }

    const runApproval = async (txSession) => {
      const opts = txSession ? { session: txSession } : {};
      await User.updateOne(
        { _id: currentOwner._id },
        {
          $set: {
            roleId: orgAdminRole._id,
            isTenantAdmin: false,
            status: "active",
          },
        },
        opts
      );
      await User.updateOne(
        { _id: target._id },
        {
          $set: {
            roleId: ownerRole._id,
            isTenantAdmin: true,
            status: "active",
          },
        },
        opts
      );

      request.status = "APPROVED";
      request.reviewedBy = getActor(req).id;
      request.reviewedAt = new Date();
      request.reviewNote = reviewNote.trim();
      request.appliedPreviousOwnerNewRole = PREVIOUS_OWNER_ROLE;
      await request.save(opts);
    };

    try {
      await session.withTransaction(() => runApproval(session));
    } catch (txErr) {
      if (txErr?.message?.includes("Transaction") || txErr?.code === 20) {
        await runApproval(null);
      } else {
        throw txErr;
      }
    }

    await session.endSession();

    await revokeUserSessions([currentOwner._id, target._id], "ownership_transfer");

    const [previousOwner, newOwner] = await Promise.all([
      User.findById(currentOwner._id),
      User.findById(target._id),
    ]);

    const tenantDoc = await Tenant.findById(request.tenantId).select("roles");
    const roleMap = new Map((tenantDoc?.roles || []).map((r) => [String(r._id), r]));

    await auditFromRequest(req, {
      tenantId: request.tenantId,
      action: "ownership.transfer.approved",
      resourceType: "OwnershipTransferRequest",
      resourceId: request._id,
      metadata: {
        previousOwnerId: previousOwner._id,
        previousOwnerEmail: previousOwner.email,
        newOwnerId: newOwner._id,
        newOwnerEmail: newOwner.email,
        previousOwnerNewRole: PREVIOUS_OWNER_ROLE,
      },
    });

    return res.status(200).send(
      prepareResponseMsg(
        {
          request: toPublicRequest(request),
          previousOwner: toPublicUser(previousOwner, { roleMap }),
          newOwner: toPublicUser(newOwner, { roleMap }),
        },
        true,
        "Ownership transfer approved and applied",
        200
      )
    );
  } catch (err) {
    await session.endSession();
    return next(err);
  }
}

export async function rejectOwnershipTransferRequest(req, res, next) {
  try {
    const { reviewNote = "" } = req.body;
    if (!reviewNote.trim()) {
      return sendError(res, "OWNERSHIP_REJECT_REASON_REQUIRED", 400);
    }

    const request = await OwnershipTransferRequest.findOne({
      _id: req.params.id,
      status: "PENDING",
    });

    if (!request) {
      return sendError(res, "OWNERSHIP_REQUEST_NOT_FOUND", 404);
    }

    request.status = "REJECTED";
    request.reviewedBy = getActor(req).id;
    request.reviewedAt = new Date();
    request.reviewNote = reviewNote.trim();
    await request.save();

    await auditFromRequest(req, {
      tenantId: request.tenantId,
      action: "ownership.transfer.rejected",
      resourceType: "OwnershipTransferRequest",
      resourceId: request._id,
      metadata: { reviewNote: reviewNote.trim(), targetUserId: request.targetUserId },
    });

    return res
      .status(200)
      .send(prepareResponseMsg({ request: toPublicRequest(request) }, true, "Request rejected", 200));
  } catch (err) {
    return next(err);
  }
}
