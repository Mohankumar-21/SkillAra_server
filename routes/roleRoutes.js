import express from "express";
import { z } from "zod";
import {
  createTenantRole,
  deleteTenantRole,
  getTenantPermissionModules,
  getTenantRole,
  listTenantRoles,
  updateTenantRole,
} from "../controllers/roleController.js";
import { requireAuth, requireRole, requireTenant } from "../middlewares/auth.js";
import { requireDb } from "../utils/db-state.js";
import { validateBody } from "../utils/validate.js";

const router = express.Router();

const permissionsSchema = z.record(z.array(z.string()));

const createRoleSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).optional(),
  status: z.enum(["active", "inactive"]).optional(),
  permissions: permissionsSchema.optional(),
});

const updateRoleSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    description: z.string().trim().max(500).optional(),
    status: z.enum(["active", "inactive"]).optional(),
    permissions: permissionsSchema.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: "No fields to update" });

router.get(
  "/permission-modules",
  requireDb,
  requireAuth,
  requireRole("TENANT_ADMIN", "ORG_ADMIN"),
  requireTenant,
  getTenantPermissionModules
);

router.get(
  "/",
  requireDb,
  requireAuth,
  requireRole("TENANT_ADMIN", "ORG_ADMIN"),
  requireTenant,
  listTenantRoles
);

router.get(
  "/:id",
  requireDb,
  requireAuth,
  requireRole("TENANT_ADMIN", "ORG_ADMIN"),
  requireTenant,
  getTenantRole
);

router.post(
  "/",
  requireDb,
  requireAuth,
  requireRole("TENANT_ADMIN", "ORG_ADMIN"),
  requireTenant,
  validateBody(createRoleSchema),
  createTenantRole
);

router.patch(
  "/:id",
  requireDb,
  requireAuth,
  requireRole("TENANT_ADMIN", "ORG_ADMIN"),
  requireTenant,
  validateBody(updateRoleSchema),
  updateTenantRole
);

router.delete(
  "/:id",
  requireDb,
  requireAuth,
  requireRole("TENANT_ADMIN", "ORG_ADMIN"),
  requireTenant,
  deleteTenantRole
);

export default router;
