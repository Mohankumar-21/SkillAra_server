/**
 * TENANT-SCOPED ROUTES — REVIEW CHECKLIST
 * All database queries in this file MUST filter by req.tenantId (set via scopeTenant middleware).
 * Never trust tenant id from req.query, req.body, or req.params.
 */
import express from "express";
import { z } from "zod";

import { inviteUser } from "../controllers/tenantAdminController.js";
import { authenticate } from "../middleware/authenticate.js";
import { requireTenantUser } from "../middleware/requireTenantUser.js";
import { scopeTenant } from "../middleware/scopeTenant.js";
import { requireRole } from "../middleware/requireRole.js";
import { requireDb } from "../utils/db-state.js";
import { validateBody } from "../utils/validate.js";

const router = express.Router();

const inviteUserSchema = z.object({
  email: z
    .string()
    .email()
    .transform((v) => v.toLowerCase().trim()),
  roleId: z.string().regex(/^[0-9a-fA-F]{24}$/),
});

router.post(
  "/invite-user",
  requireDb,
  authenticate,
  requireTenantUser,
  scopeTenant,
  requireRole("tenant_admin"),
  validateBody(inviteUserSchema),
  inviteUser
);

export default router;
