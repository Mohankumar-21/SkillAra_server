/**
 * TENANT-SCOPED ROUTES — REVIEW CHECKLIST
 * All database queries in this file MUST filter by req.tenantId (set via scopeTenant middleware).
 * Never trust tenant id from req.query, req.body, or req.params.
 */
import express from "express";
import { z } from "zod";
import {
  createSlot,
  listOpenSlots,
  getAllSlots,
  getMySlots,
  bookSlot,
  cancelSlot,
  completeSlot,
  deleteSlot,
} from "../controllers/bookingController.js";
import { requireAuth, requireRole, requireTenant } from "../middlewares/auth.js";
import { checkPlanLimits } from "../middlewares/checkPlanLimits.js";
import { prepareResponseMsg } from "../utils/helper.js";
import { requireDb } from "../utils/db-state.js";

const router = express.Router();

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid id");

const createSlotSchema = z.object({
  sessionType: z.enum(["MOCK_INTERVIEW", "MENTORSHIP"]),
  courseId: objectId.optional(),
  title: z.string().trim().max(200).optional(),
  startTime: z.string().min(1),
  endTime: z.string().min(1),
});

const cancelSchema = z.object({
  reason: z.string().max(500).optional(),
});

const completeSchema = z.object({
  rating: z.number().min(1).max(5).optional(),
  notes: z.string().max(2000).optional(),
  strengths: z.array(z.string().max(200)).optional(),
  improvements: z.array(z.string().max(200)).optional(),
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

router.post(
  "/",
  requireDb,
  requireAuth,
  requireRole("TENANT_ADMIN", "ORG_ADMIN", "TUTOR"),
  requireTenant,
  validateBody(createSlotSchema),
  checkPlanLimits({ resource: "session-slots" }),
  createSlot
);

router.get("/", requireDb, requireAuth, requireTenant, listOpenSlots);

/** Staff oversight — every slot in the tenant, any host, any status. */
router.get(
  "/all",
  requireDb,
  requireAuth,
  requireRole("TENANT_ADMIN", "ORG_ADMIN"),
  requireTenant,
  getAllSlots
);

router.get("/my", requireDb, requireAuth, requireTenant, getMySlots);

router.post("/:id/book", requireDb, requireAuth, requireRole("STUDENT"), requireTenant, bookSlot);

router.post("/:id/cancel", requireDb, requireAuth, requireTenant, validateBody(cancelSchema), cancelSlot);

router.post(
  "/:id/complete",
  requireDb,
  requireAuth,
  requireRole("TENANT_ADMIN", "ORG_ADMIN", "TUTOR"),
  requireTenant,
  validateBody(completeSchema),
  completeSlot
);

router.delete(
  "/:id",
  requireDb,
  requireAuth,
  requireRole("TENANT_ADMIN", "ORG_ADMIN", "TUTOR"),
  requireTenant,
  deleteSlot
);

export default router;
