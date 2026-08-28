/**
 * TENANT-SCOPED ROUTES — REVIEW CHECKLIST
 * All database queries in this file MUST filter by req.tenantId (set via scopeTenant middleware).
 * Never trust tenant id from req.query, req.body, or req.params.
 */
import express from "express";
import { z } from "zod";
import {
  createTicket,
  getQueue,
  getMyTickets,
  getAllTickets,
  getTicket,
  claimTicket,
  assignTicket,
  closeTicket,
  reopenTicket,
  getMessages,
  postMessage,
  createTicketSession,
  getTicketSessions,
  getMentorDashboard,
  getAdminDashboard,
} from "../controllers/mentorshipTicketController.js";
import { requireAuth, requirePermission, requireTenant } from "../middlewares/auth.js";
import { prepareResponseMsg } from "../utils/helper.js";
import { requireDb } from "../utils/db-state.js";

const router = express.Router();

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid id");

const createTicketSchema = z.object({
  subject: z.string().trim().min(1).max(150),
  description: z.string().max(4000).optional(),
  courseId: objectId.optional(),
  topicTags: z.array(z.string().trim().max(40)).max(10).optional(),
});

const assignSchema = z.object({ mentorId: objectId });
const closeSchema = z.object({ closeNote: z.string().max(2000).optional() });
const messageSchema = z.object({ body: z.string().trim().min(1).max(4000) });
const sessionSchema = z.object({
  title: z.string().max(150).optional(),
  startTime: z.string().datetime().or(z.string().min(1)),
  endTime: z.string().datetime().or(z.string().min(1)),
});

function validateBody(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .send(prepareResponseMsg({ issues: parsed.error.issues }, false, "Validation failed", 400));
    }
    req.body = parsed.data;
    return next();
  };
}

router.post("/", requireDb, requireAuth, requireTenant, requirePermission("mentorship", "create"), validateBody(createTicketSchema), createTicket);

router.get("/queue", requireDb, requireAuth, requireTenant, requirePermission("mentorship", "claim"), getQueue);
router.get("/mine", requireDb, requireAuth, requireTenant, getMyTickets);

/** Staff oversight — every ticket in the tenant, any mentor. */
router.get("/", requireDb, requireAuth, requireTenant, requirePermission("mentorship", "manage"), getAllTickets);

router.get("/dashboard/mentor", requireDb, requireAuth, requireTenant, requirePermission("mentorship", "claim"), getMentorDashboard);
router.get("/dashboard/admin", requireDb, requireAuth, requireTenant, requirePermission("mentorship", "manage"), getAdminDashboard);

router.get("/:id", requireDb, requireAuth, requireTenant, getTicket);
router.patch("/:id/claim", requireDb, requireAuth, requireTenant, requirePermission("mentorship", "claim"), claimTicket);
router.patch("/:id/assign", requireDb, requireAuth, requireTenant, requirePermission("mentorship", "assign"), validateBody(assignSchema), assignTicket);
router.patch("/:id/close", requireDb, requireAuth, requireTenant, requirePermission("mentorship", "close"), validateBody(closeSchema), closeTicket);
router.patch("/:id/reopen", requireDb, requireAuth, requireTenant, requirePermission("mentorship", "close"), reopenTicket);

router.get("/:id/messages", requireDb, requireAuth, requireTenant, getMessages);
router.post("/:id/messages", requireDb, requireAuth, requireTenant, validateBody(messageSchema), postMessage);

router.get("/:id/sessions", requireDb, requireAuth, requireTenant, getTicketSessions);
router.post("/:id/sessions", requireDb, requireAuth, requireTenant, requirePermission("mentorship", "claim"), validateBody(sessionSchema), createTicketSession);

export default router;
