import Notification from "../models/Notification.js";
import logger from "../core/logger.js";

/**
 * Fan a single event out to its recipients.
 *
 * Notifications are a side effect of an action that has already succeeded, so a failure
 * here must never fail the request that triggered it — it is logged and swallowed.
 * Duplicate and self-addressed recipients are dropped.
 *
 * @param {object} event
 * @param {string|import("mongoose").Types.ObjectId} event.tenantId
 * @param {Array<string|import("mongoose").Types.ObjectId|null|undefined>} event.userIds recipients
 * @param {string} event.type one of NOTIFICATION_TYPES
 * @param {string} event.title
 * @param {string} [event.message]
 * @param {string} [event.actorId] excluded from recipients — nobody notifies themselves
 * @param {string} [event.actorName]
 * @param {string} [event.courseId]
 * @param {string} [event.link]
 * @returns {Promise<number>} how many notifications were written
 */
export async function notifyUsers({
  tenantId,
  userIds = [],
  type,
  title,
  message = "",
  actorId = null,
  actorName = "",
  courseId = null,
  link = "",
}) {
  try {
    const recipients = [
      ...new Set(
        userIds
          .filter(Boolean)
          .map(String)
          .filter((id) => !actorId || id !== String(actorId))
      ),
    ];
    if (recipients.length === 0) return 0;

    const docs = recipients.map((userId) => ({
      tenantId,
      userId,
      type,
      title,
      message,
      actorId,
      actorName,
      courseId,
      link,
    }));

    await Notification.insertMany(docs, { ordered: false });
    return docs.length;
  } catch (err) {
    logger.error(`Failed to write ${type} notification: ${err.message}`);
    return 0;
  }
}

export function serializeNotification(doc) {
  const n = doc.toObject ? doc.toObject() : doc;
  return {
    id: String(n._id),
    type: n.type,
    title: n.title,
    message: n.message || "",
    actorId: n.actorId ? String(n.actorId) : null,
    actorName: n.actorName || "",
    courseId: n.courseId ? String(n.courseId) : null,
    link: n.link || "",
    isRead: Boolean(n.readAt),
    readAt: n.readAt || null,
    createdAt: n.created_on,
  };
}
