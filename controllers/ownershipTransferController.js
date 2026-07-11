import mongoose from "mongoose";
import OwnershipTransferRequest, { PREVIOUS_OWNER_ROLE } from "../models/OwnershipTransferRequest.js";
import User from "../models/User.js";
import Tenant from "../models/Tenant.js";
import Session from "../models/Session.js";
import { prepareResponseMsg } from "../utils/helper.js";
import { toPublicUser } from "../utils/user.js";
import { auditFromRequest } from "../services/auditService.js";

function isEligibleOwnershipTarget(user) {
  if (!user) return false;
  return (
    user.role === "ORG_ADMIN" &&
    user.status === "ACTIVE" &&
    user.invitationStatus === "ACCEPTED"
  );
}

export async function listEligibleOwnershipTargets(req, res, next) {
  try {
    if (req.user.role !== "TENANT_ADMIN") {
      return res.status(403).send(prepareResponseMsg({}, false, "Forbidden", 403));
    }

    const users = await User.find({
      tenantId: req.tenant._id,
      role: "ORG_ADMIN",
      status: "ACTIVE",
      invitationStatus: "ACCEPTED",
    }).sort({ name: 1 });

    return res.status(200).send(
      prepareResponseMsg(
        { users: users.map(toPublicUser) },
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
    if (req.user.role !== "TENANT_ADMIN") {
      return res
        .status(403)
        .send(prepareResponseMsg({}, false, "Only the organization owner can request ownership transfer", 403));
    }

    const { targetUserId, reason = "" } = req.body;

    if (String(targetUserId) === String(req.user._id)) {
      return res.status(400).send(prepareResponseMsg({}, false, "Cannot transfer ownership to yourself", 400));
    }

    const pending = await OwnershipTransferRequest.findOne({
      tenantId: req.tenant._id,
      status: "PENDING",
    });
    if (pending) {
      return res
        .status(409)
        .send(
          prepareResponseMsg(
            {},
            false,
            "A pending ownership transfer request already exists for this organization",
            409
          )
        );
    }

    const target = await User.findOne({
      _id: targetUserId,
      tenantId: req.tenant._id,
    });
    if (!isEligibleOwnershipTarget(target)) {
      return res.status(404).send(
        prepareResponseMsg(
          {},
          false,
          "Only active Organization Admins who have accepted their invitation can become owner",
          404
        )
      );
    }

    const request = await OwnershipTransferRequest.create({
      tenantId: req.tenant._id,
      requestedBy: req.user._id,
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
      .populate("tenantId", "tenant_name sub_domain");

    return res.status(201).send(
      prepareResponseMsg(
        {
          request: toPublicRequest(populated, {
            tenant: populated.tenantId,
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
    if (req.user.role !== "TENANT_ADMIN") {
      return res.status(403).send(prepareResponseMsg({}, false, "Forbidden", 403));
    }

    const requests = await OwnershipTransferRequest.find({ tenantId: req.tenant._id })
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
      tenantId: req.tenant._id,
      requestedBy: req.user._id,
      status: "PENDING",
    });

    if (!request) {
      return res
        .status(404)
        .send(prepareResponseMsg({}, false, "Pending request not found", 404));
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
      .populate("tenantId", "tenant_name sub_domain email status")
      .populate("requestedBy", "name email role")
      .populate("targetUserId", "name email role")
      .populate("reviewedBy", "name email")
      .limit(100);

    return res.status(200).send(
      prepareResponseMsg(
        {
          requests: requests.map((r) =>
            toPublicRequest(r, {
              tenant: r.tenantId,
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
      return res
        .status(404)
        .send(prepareResponseMsg({}, false, "Pending request not found", 404));
    }

    const appliedRole = PREVIOUS_OWNER_ROLE;

    const [currentOwner, target, tenant] = await Promise.all([
      User.findById(request.requestedBy).session(session),
      User.findById(request.targetUserId).session(session),
      Tenant.findById(request.tenantId).session(session),
    ]);

    if (!tenant || tenant.status === false) {
      await session.endSession();
      return res
        .status(400)
        .send(prepareResponseMsg({}, false, "Organization is inactive", 400));
    }

    if (!currentOwner || currentOwner.role !== "TENANT_ADMIN") {
      await session.endSession();
      return res
        .status(400)
        .send(prepareResponseMsg({}, false, "Current owner is no longer valid", 400));
    }

    if (!target || String(target.tenantId) !== String(request.tenantId)) {
      await session.endSession();
      return res
        .status(400)
        .send(prepareResponseMsg({}, false, "Target user is no longer eligible", 400));
    }

    if (!isEligibleOwnershipTarget(target)) {
      await session.endSession();
      return res
        .status(400)
        .send(
          prepareResponseMsg(
            {},
            false,
            "Target must be an active Organization Admin with accepted invitation",
            400
          )
        );
    }

    const runApproval = async (session) => {
      const opts = session ? { session } : {};
      await User.updateOne(
        { _id: currentOwner._id },
        { $set: { role: appliedRole, status: "ACTIVE", invitationStatus: "ACCEPTED" } },
        opts
      );
      await User.updateOne(
        { _id: target._id },
        { $set: { role: "TENANT_ADMIN", status: "ACTIVE", invitationStatus: "ACCEPTED" } },
        opts
      );

      request.status = "APPROVED";
      request.reviewedBy = req.user._id;
      request.reviewedAt = new Date();
      request.reviewNote = reviewNote.trim();
      request.appliedPreviousOwnerNewRole = appliedRole;
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
        previousOwnerNewRole: appliedRole,
      },
    });

    return res.status(200).send(
      prepareResponseMsg(
        {
          request: toPublicRequest(request),
          previousOwner: toPublicUser(previousOwner),
          newOwner: toPublicUser(newOwner),
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
      return res
        .status(400)
        .send(prepareResponseMsg({}, false, "Rejection reason is required", 400));
    }

    const request = await OwnershipTransferRequest.findOne({
      _id: req.params.id,
      status: "PENDING",
    });

    if (!request) {
      return res
        .status(404)
        .send(prepareResponseMsg({}, false, "Pending request not found", 404));
    }

    request.status = "REJECTED";
    request.reviewedBy = req.user._id;
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
