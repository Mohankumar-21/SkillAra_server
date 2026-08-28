/**
 * TENANT-SCOPED ROUTES — REVIEW CHECKLIST
 * All database queries in this file MUST filter by req.tenantId (set via requireTenant).
 * Never trust tenant id from req.query, req.body, or req.params.
 *
 * These endpoints are deliberately NOT behind requirePermission("notifications", ...).
 * A notification inbox is self-scoped — the controller filters on the caller's own id —
 * so gating it on a permission would only let a role be configured out of its own inbox.
 */
import express from "express";
import {
  listNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
} from "../controllers/notificationController.js";
import { requireAuth, requireTenant } from "../middlewares/auth.js";
import { requireDb } from "../utils/db-state.js";

const router = express.Router();

router.get("/", requireDb, requireAuth, requireTenant, listNotifications);
router.get("/unread-count", requireDb, requireAuth, requireTenant, getUnreadCount);
router.post("/read-all", requireDb, requireAuth, requireTenant, markAllNotificationsRead);
router.patch("/:id/read", requireDb, requireAuth, requireTenant, markNotificationRead);

export default router;
