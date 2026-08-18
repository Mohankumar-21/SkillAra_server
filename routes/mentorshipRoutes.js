/**
 * TENANT-SCOPED ROUTES — REVIEW CHECKLIST
 * All database queries in this file MUST filter by req.tenantId (set via scopeTenant middleware).
 * Never trust tenant id from req.query, req.body, or req.params.
 */
import express from "express";
import { z } from "zod";
import {
  upsertMentorProfile,
  listMentors,
  getMyMentorProfile,
  requestMentorship,
  getAllRequests,
  getIncomingRequests,
  getOutgoingRequests,
  respondToRequest,
} from "../controllers/mentorshipController.js";
import { requireAuth, requireRole, requireTenant } from "../middlewares/auth.js";
import { prepareResponseMsg } from "../utils/helper.js";
import { requireDb } from "../utils/db-state.js";

const router = express.Router();

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid id");

const profileSchema = z.object({
  bio: z.string().max(2000).optional(),
  expertiseTags: z.array(z.string().trim().max(40)).max(20).optional(),
  yearsExperience: z.number().min(0).max(80).optional(),
  isActive: z.boolean().optional(),
});

const requestSchema = z.object({
  mentorId: objectId,
  courseId: objectId.optional(),
  message: z.string().max(2000).optional(),
});

const respondSchema = z.object({
  status: z.enum(["ACCEPTED", "REJECTED"]),
  responseNote: z.string().max(1000).optional(),
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

router.post("/requests", requireDb, requireAuth, requireRole("STUDENT"), requireTenant, validateBody(requestSchema), requestMentorship);

/** Staff oversight — every mentorship request in the tenant, any mentor. */
router.get(
  "/requests",
  requireDb,
  requireAuth,
  requireRole("TENANT_ADMIN", "ORG_ADMIN"),
  requireTenant,
  getAllRequests
);

router.get(
  "/requests/incoming",
  requireDb,
  requireAuth,
  requireRole("TENANT_ADMIN", "ORG_ADMIN", "TUTOR"),
  requireTenant,
  getIncomingRequests
);
router.get("/requests/outgoing", requireDb, requireAuth, requireTenant, getOutgoingRequests);
router.patch(
  "/requests/:id/respond",
  requireDb,
  requireAuth,
  requireRole("TENANT_ADMIN", "ORG_ADMIN", "TUTOR"),
  requireTenant,
  validateBody(respondSchema),
  respondToRequest
);

export default router;
