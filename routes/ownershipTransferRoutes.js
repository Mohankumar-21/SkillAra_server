/**
 * TENANT-SCOPED ROUTES — REVIEW CHECKLIST
 * All database queries in this file MUST filter by req.tenantId (set via scopeTenant middleware).
 * Never trust tenant id from req.query, req.body, or req.params.
 */
import express from "express";
import { z } from "zod";
import {
  createOwnershipTransferRequest,
  listEligibleOwnershipTargets,
  listMyOwnershipTransferRequests,
  cancelOwnershipTransferRequest,
  listOwnershipTransferRequests,
  approveOwnershipTransferRequest,
  rejectOwnershipTransferRequest,
} from "../controllers/ownershipTransferController.js";
import { requireAuth, requireOwner, requireRole, requireTenant } from "../middlewares/auth.js";
import { requireDb } from "../utils/db-state.js";
import { prepareResponseMsg } from "../utils/helper.js";

const router = express.Router();

const createSchema = z.object({
  targetUserId: z.string().min(1),
  reason: z.string().max(500).optional(),
});

const approveSchema = z.object({
  reviewNote: z.string().max(500).optional(),
});

const rejectSchema = z.object({
  reviewNote: z.string().trim().min(1).max(500),
});

function validate(schema) {
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

router.get(
  "/",
  requireDb,
  requireAuth,
  requireRole("SUPER_ADMIN"),
  listOwnershipTransferRequests
);

router.get(
  "/eligible-targets",
  requireDb,
  requireAuth,
  requireTenant,
  requireOwner,
  listEligibleOwnershipTargets
);

router.get(
  "/my",
  requireDb,
  requireAuth,
  requireTenant,
  requireOwner,
  listMyOwnershipTransferRequests
);

router.post(
  "/",
  requireDb,
  requireAuth,
  requireTenant,
  requireOwner,
  validate(createSchema),
  createOwnershipTransferRequest
);

router.post(
  "/:id/cancel",
  requireDb,
  requireAuth,
  requireTenant,
  requireOwner,
  cancelOwnershipTransferRequest
);

router.post(
  "/:id/approve",
  requireDb,
  requireAuth,
  requireRole("SUPER_ADMIN"),
  validate(approveSchema),
  approveOwnershipTransferRequest
);

router.post(
  "/:id/reject",
  requireDb,
  requireAuth,
  requireRole("SUPER_ADMIN"),
  validate(rejectSchema),
  rejectOwnershipTransferRequest
);

export default router;
