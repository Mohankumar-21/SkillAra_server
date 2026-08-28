/**
 * TENANT-SCOPED CONTROLLER — REVIEW CHECKLIST
 * Every query filters by req.tenantId AND the caller's own id. A notification is personal;
 * there is no endpoint that reads another user's inbox.
 */
import mongoose from "mongoose";

import Notification from "../models/Notification.js";
import { getActor } from "../utils/actor.js";
import { sendError, sendSuccess } from "../utils/helper.js";
import { serializeNotification } from "../services/notificationService.js";

const isObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));

/** Scope every notification query to this tenant AND this caller. */
function ownScope(req, actor) {
  return { tenantId: req.tenantId, userId: actor.id };
}

/** GET /api/notifications?unreadOnly=true&page=1&limit=20 */
export async function listNotifications(req, res, next) {
  try {
    const actor = getActor(req);
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));

    const filter = ownScope(req, actor);
    if (String(req.query.unreadOnly) === "true") filter.readAt = null;

    const [items, totalCount, unreadCount] = await Promise.all([
      Notification.find(filter)
        .sort({ created_on: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Notification.countDocuments(filter),
      Notification.countDocuments({ ...ownScope(req, actor), readAt: null }),
    ]);

    return sendSuccess(res, "Notifications fetched", {
      notifications: items.map(serializeNotification),
      page,
      limit,
      totalCount,
      unreadCount,
    });
  } catch (err) {
    return next(err);
  }
}

/** GET /api/notifications/unread-count — backs the header badge. */
export async function getUnreadCount(req, res, next) {
  try {
    const actor = getActor(req);
    const unreadCount = await Notification.countDocuments({
      ...ownScope(req, actor),
      readAt: null,
    });
    return sendSuccess(res, "Unread count fetched", { unreadCount });
  } catch (err) {
    return next(err);
  }
}

/** PATCH /api/notifications/:id/read */
export async function markNotificationRead(req, res, next) {
  try {
    const actor = getActor(req);
    if (!isObjectId(req.params.id)) return sendError(res, "NOTIFICATION_NOT_FOUND", 404);

    const updated = await Notification.findOneAndUpdate(
      { _id: req.params.id, ...ownScope(req, actor) },
      { $set: { readAt: new Date() } },
      { new: true }
    );
    if (!updated) return sendError(res, "NOTIFICATION_NOT_FOUND", 404);

    return sendSuccess(res, "Notification marked as read", serializeNotification(updated));
  } catch (err) {
    return next(err);
  }
}

/** POST /api/notifications/read-all */
export async function markAllNotificationsRead(req, res, next) {
  try {
    const actor = getActor(req);
    const result = await Notification.updateMany(
      { ...ownScope(req, actor), readAt: null },
      { $set: { readAt: new Date() } }
    );
    return sendSuccess(res, "All notifications marked as read", {
      updated: result.modifiedCount || 0,
    });
  } catch (err) {
    return next(err);
  }
}
