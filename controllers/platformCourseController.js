/**
 * PLATFORM-SCOPE CONTROLLER — superadmin only.
 *
 * Unlike controllers/courseController.js, these handlers deliberately query across
 * tenants. Every route that reaches them must be behind authenticate + requireSuperadmin.
 * Tenant filtering is opt-in via ?tenantId= rather than enforced.
 */
import mongoose from "mongoose";

import Course from "../models/Course.js";
import Tenant from "../models/Tenant.js";
import { getActor } from "../utils/actor.js";
import { sendError, sendSuccess, prepareResponseMsg } from "../utils/helper.js";
import { isStorageConfigured, getSignedDownloadUrl } from "../services/storageService.js";

const isObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));

async function thumbnailUrlFor(course) {
  if (course.thumbnailKey && isStorageConfigured()) {
    try {
      return await getSignedDownloadUrl(course.thumbnailKey);
    } catch {
      return null;
    }
  }
  return course.thumbnail || null;
}

function serialize(course, tenantMap) {
  const tenant = tenantMap.get(String(course.tenantId));
  return {
    id: String(course._id),
    title: course.title,
    subtitle: course.subtitle || "",
    category: course.category || "",
    level: course.level,
    status: course.status,
    price: course.price ?? 0,
    currency: course.currency || "INR",
    publishedAt: course.publishedAt,
    stats: course.stats || {},
    moderation: {
      isBlocked: Boolean(course.moderation?.isBlocked),
      reason: course.moderation?.reason || "",
      blockedAt: course.moderation?.blockedAt || null,
    },
    instructor: course.instructorId?.name
      ? { id: String(course.instructorId._id), name: course.instructorId.name, email: course.instructorId.email }
      : { id: String(course.instructorId), name: "", email: "" },
    tenant: tenant
      ? { id: String(tenant._id), name: tenant.name, subdomain: tenant.subdomain }
      : { id: String(course.tenantId), name: "", subdomain: "" },
    createdAt: course.created_on,
    updatedAt: course.updated_on,
  };
}

/** GET /api/superadmin/courses — cross-tenant catalog with filters and pagination. */
export async function listPlatformCourses(req, res, next) {
  try {
    const { search, status, tenantId, blocked } = req.query;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));

    const filter = {};
    if (status) filter.status = status;
    if (tenantId && isObjectId(tenantId)) filter.tenantId = tenantId;
    if (blocked === "true") filter["moderation.isBlocked"] = true;
    if (blocked === "false") filter["moderation.isBlocked"] = { $ne: true };
    if (search) {
      const rx = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [{ title: rx }, { subtitle: rx }, { category: rx }];
    }

    const [courses, totalCount] = await Promise.all([
      Course.find(filter)
        .populate("instructorId", "name email")
        .sort({ created_on: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Course.countDocuments(filter),
    ]);

    const tenantIds = [...new Set(courses.map((c) => String(c.tenantId)))];
    const tenants = await Tenant.find({ _id: { $in: tenantIds } }).select("name subdomain");
    const tenantMap = new Map(tenants.map((t) => [String(t._id), t]));

    const data = await Promise.all(
      courses.map(async (course) => ({
        ...serialize(course, tenantMap),
        thumbnailUrl: await thumbnailUrlFor(course),
      }))
    );

    return res
      .status(200)
      .send(prepareResponseMsg(data, true, "Courses fetched successfully", 200, limit, totalCount));
  } catch (err) {
    return next(err);
  }
}

/** GET /api/superadmin/courses/stats — headline counts for the platform dashboard. */
export async function getPlatformCourseStats(req, res, next) {
  try {
    const [byStatus, blocked, perTenant] = await Promise.all([
      Course.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
      Course.countDocuments({ "moderation.isBlocked": true }),
      Course.aggregate([
        { $group: { _id: "$tenantId", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 5 },
      ]),
    ]);

    const tenants = await Tenant.find({ _id: { $in: perTenant.map((p) => p._id) } }).select(
      "name subdomain"
    );
    const tenantMap = new Map(tenants.map((t) => [String(t._id), t]));

    const statusCounts = byStatus.reduce((acc, row) => ({ ...acc, [row._id]: row.count }), {});

    return sendSuccess(res, "Course stats fetched", {
      total: Object.values(statusCounts).reduce((a, b) => a + b, 0),
      draft: statusCounts.DRAFT || 0,
      published: statusCounts.PUBLISHED || 0,
      archived: statusCounts.ARCHIVED || 0,
      blocked,
      topTenants: perTenant.map((row) => ({
        tenantId: String(row._id),
        name: tenantMap.get(String(row._id))?.name || "",
        subdomain: tenantMap.get(String(row._id))?.subdomain || "",
        courseCount: row.count,
      })),
    });
  } catch (err) {
    return next(err);
  }
}

/** POST /api/superadmin/courses/:id/block — platform-level takedown, any tenant. */
export async function blockPlatformCourse(req, res, next) {
  try {
    const actor = getActor(req);
    const reason = String(req.body?.reason || "").trim();
    if (!reason) return sendError(res, "COURSE_BLOCK_REASON_REQUIRED", 400);
    if (!isObjectId(req.params.id)) return sendError(res, "COURSE_INVALID_ID", 400);

    const updated = await Course.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          "moderation.isBlocked": true,
          "moderation.reason": reason,
          "moderation.blockedBy": actor.id,
          "moderation.blockedAt": new Date(),
          updated_by: actor.id,
        },
      },
      { new: true }
    ).populate("instructorId", "name email");

    if (!updated) return sendError(res, "COURSE_NOT_FOUND", 404);

    const tenant = await Tenant.findById(updated.tenantId).select("name subdomain");
    return sendSuccess(
      res,
      "Course blocked",
      serialize(updated, new Map([[String(updated.tenantId), tenant]]))
    );
  } catch (err) {
    return next(err);
  }
}

/** POST /api/superadmin/courses/:id/unblock */
export async function unblockPlatformCourse(req, res, next) {
  try {
    const actor = getActor(req);
    if (!isObjectId(req.params.id)) return sendError(res, "COURSE_INVALID_ID", 400);

    const updated = await Course.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          "moderation.isBlocked": false,
          "moderation.reason": "",
          "moderation.blockedBy": null,
          "moderation.blockedAt": null,
          updated_by: actor.id,
        },
      },
      { new: true }
    ).populate("instructorId", "name email");

    if (!updated) return sendError(res, "COURSE_NOT_FOUND", 404);

    const tenant = await Tenant.findById(updated.tenantId).select("name subdomain");
    return sendSuccess(
      res,
      "Course unblocked",
      serialize(updated, new Map([[String(updated.tenantId), tenant]]))
    );
  } catch (err) {
    return next(err);
  }
}

/** POST /api/superadmin/courses/:id/unpublish — force a course back to draft. */
export async function unpublishPlatformCourse(req, res, next) {
  try {
    const actor = getActor(req);
    if (!isObjectId(req.params.id)) return sendError(res, "COURSE_INVALID_ID", 400);

    const updated = await Course.findByIdAndUpdate(
      req.params.id,
      { $set: { status: "DRAFT", publishedAt: null, updated_by: actor.id } },
      { new: true }
    ).populate("instructorId", "name email");

    if (!updated) return sendError(res, "COURSE_NOT_FOUND", 404);

    const tenant = await Tenant.findById(updated.tenantId).select("name subdomain");
    return sendSuccess(
      res,
      "Course unpublished",
      serialize(updated, new Map([[String(updated.tenantId), tenant]]))
    );
  } catch (err) {
    return next(err);
  }
}
