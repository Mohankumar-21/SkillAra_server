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
import { requireAuth, requireRole, requireTenant } from "../middlewares/auth.js";
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

const STAFF = ["TENANT_ADMIN", "ORG_ADMIN"];
const MENTOR_CAPABLE = ["TUTOR", "TENANT_ADMIN", "ORG_ADMIN"];

router.post("/", requireDb, requireAuth, requireRole("LEARNER", "STUDENT"), requireTenant, validateBody(createTicketSchema), createTicket);

router.get("/queue", requireDb, requireAuth, requireRole(...MENTOR_CAPABLE), requireTenant, getQueue);
router.get("/mine", requireDb, requireAuth, requireTenant, getMyTickets);

/** Staff oversight — every ticket in the tenant, any mentor. */
router.get("/", requireDb, requireAuth, requireRole(...STAFF), requireTenant, getAllTickets);

router.get("/dashboard/mentor", requireDb, requireAuth, requireRole(...MENTOR_CAPABLE), requireTenant, getMentorDashboard);
router.get("/dashboard/admin", requireDb, requireAuth, requireRole(...STAFF), requireTenant, getAdminDashboard);

router.get("/:id", requireDb, requireAuth, requireTenant, getTicket);
router.patch("/:id/claim", requireDb, requireAuth, requireRole(...MENTOR_CAPABLE), requireTenant, claimTicket);
router.patch("/:id/assign", requireDb, requireAuth, requireRole(...STAFF), requireTenant, validateBody(assignSchema), assignTicket);
router.patch("/:id/close", requireDb, requireAuth, requireRole(...MENTOR_CAPABLE), requireTenant, validateBody(closeSchema), closeTicket);
router.patch("/:id/reopen", requireDb, requireAuth, requireRole(...MENTOR_CAPABLE), requireTenant, reopenTicket);

router.get("/:id/messages", requireDb, requireAuth, requireTenant, getMessages);
router.post("/:id/messages", requireDb, requireAuth, requireTenant, validateBody(messageSchema), postMessage);

router.get("/:id/sessions", requireDb, requireAuth, requireTenant, getTicketSessions);
router.post("/:id/sessions", requireDb, requireAuth, requireRole(...MENTOR_CAPABLE), requireTenant, validateBody(sessionSchema), createTicketSession);

export default router;
