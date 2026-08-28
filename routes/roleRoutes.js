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
import { requireAuth, requireTenant, requirePermission } from "../middlewares/auth.js";
import { requireDb } from "../utils/db-state.js";
import { validateBody } from "../utils/validate.js";

const router = express.Router();

/**
 * { moduleId: [action, ...] }.
 *
 * Both arguments are required: in Zod 4 a single-argument z.record() reads that schema as
 * the KEY type, so z.record(z.array(z.string())) rejected every module id as an invalid key
 * and made all role create/update calls carrying permissions fail validation.
 */
const permissionsSchema = z.record(z.string(), z.array(z.string()));

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
  requireTenant,
  requirePermission("roles", "view"),
  getTenantPermissionModules
);

router.get(
  "/",
  requireDb,
  requireAuth,
  requireTenant,
  requirePermission("roles", "view"),
  listTenantRoles
);

router.get(
  "/:id",
  requireDb,
  requireAuth,
  requireTenant,
  requirePermission("roles", "view"),
  getTenantRole
);

router.post(
  "/",
  requireDb,
  requireAuth,
  requireTenant,
  requirePermission("roles", "create"),
  validateBody(createRoleSchema),
  createTenantRole
);

router.patch(
  "/:id",
  requireDb,
  requireAuth,
  requireTenant,
  requirePermission("roles", "edit"),
  validateBody(updateRoleSchema),
  updateTenantRole
);

router.delete(
  "/:id",
  requireDb,
  requireAuth,
  requireTenant,
  requirePermission("roles", "delete"),
  deleteTenantRole
);

export default router;
