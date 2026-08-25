/**
 * TENANT-SCOPED ROUTES — REVIEW CHECKLIST
 * All database queries in this file MUST filter by req.tenantId (set via scopeTenant middleware).
 * Never trust tenant id from req.query, req.body, or req.params.
 *
 * The request/accept-reject flow that used to live here (MentorshipRequest) has been
 * replaced by the ticket-based flow in mentorshipTicketRoutes.js. This file now only
 * covers the mentor directory: a mentor's self-service profile, and browsing mentors.
 */
import express from "express";
import { z } from "zod";
import { upsertMentorProfile, listMentors, getMyMentorProfile } from "../controllers/mentorshipController.js";
import { requireAuth, requireRole, requireTenant } from "../middlewares/auth.js";
import { checkPlanLimits } from "../middlewares/checkPlanLimits.js";
import { prepareResponseMsg } from "../utils/helper.js";
import { requireDb } from "../utils/db-state.js";

const router = express.Router();

const profileSchema = z.object({
  bio: z.string().max(2000).optional(),
  expertiseTags: z.array(z.string().trim().max(40)).max(20).optional(),
  yearsExperience: z.number().min(0).max(80).optional(),
  isActive: z.boolean().optional(),
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

router.put(
  "/profile",
  requireDb,
  requireAuth,
  requireRole("TENANT_ADMIN", "ORG_ADMIN", "TUTOR"),
  requireTenant,
  checkPlanLimits({ resource: "mentorship" }),
  validateBody(profileSchema),
  upsertMentorProfile
);
router.get(
  "/profile/me",
  requireDb,
  requireAuth,
  requireRole("TENANT_ADMIN", "ORG_ADMIN", "TUTOR"),
  requireTenant,
  getMyMentorProfile
);

router.get("/mentors", requireDb, requireAuth, requireTenant, listMentors);

export default router;
