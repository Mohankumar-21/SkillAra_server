import express from "express";
import { z } from "zod";

import {
  createTenantWithAdmin,
  resetTenantAdminPassword,
} from "../controllers/superadminTenantController.js";
import {
  createPlatformRole,
  deletePlatformRole,
  getPlatformPermissionModules,
  getPlatformRole,
  listPlatformRoles,
  seedTenantRolesForTenant,
  updatePlatformRole,
} from "../controllers/roleController.js";
import {
  createOrganizationType,
  deleteOrganizationType,
  listOrganizationTypes,
  updateOrganizationType,
} from "../controllers/platformMasterController.js";
import { authenticate } from "../middleware/authenticate.js";
import { requireSuperadmin } from "../middleware/requireSuperadmin.js";
import { requireDb } from "../utils/db-state.js";
import { validateBody } from "../utils/validate.js";
import { sendError } from "../utils/helper.js";

const router = express.Router();

const brandingSchema = z
  .object({
    welcome_message: z.string().optional(),
    primary_color: z.string().optional(),
    secondary_color: z.string().optional(),
  })
  .optional();

const adminSchema = z
  .object({
    name: z.string().trim().optional(),
    email: z.string().email().optional(),
    phone: z.string().optional(),
    role: z.string().optional(),
  })
  .optional();

const createTenantSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  tenant_name: z.string().trim().min(2).max(80).optional(),
  subdomain: z
    .string()
    .trim()
    .toLowerCase()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/)
    .optional(),
  sub_domain: z
    .string()
    .trim()
    .toLowerCase()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/)
    .optional(),
  domain: z.string().trim().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  org_type: z.string().optional(),
  orgType: z.string().optional(),
  orgTypeId: z.string().regex(/^[0-9a-fA-F]{24}$/).optional(),
  industry: z.string().optional(),
  website: z.string().optional(),
  country: z.string().optional(),
  timezone: z.string().optional(),
  currency: z.string().optional(),
  logo: z.any().optional(),
  branding: brandingSchema,
  plan: z.string().trim().optional(),
  planId: z.string().regex(/^[0-9a-fA-F]{24}$/).optional(),
  status: z.boolean().optional(),
  owner_first: z.string().optional(),
  owner_last: z.string().optional(),
  owner_phone: z.string().optional(),
  adminEmail: z
    .string()
    .email()
    .transform((v) => v.toLowerCase().trim())
    .optional(),
  admin: adminSchema,
});

function validateTenantIdParam(req, res, next) {
  if (!/^[0-9a-fA-F]{24}$/.test(req.params.tenantId)) {
    return sendError(res, "TENANT_INVALID_ID", 400);
  }
  return next();
}

router.post(
  "/tenants",
  requireDb,
  authenticate,
  requireSuperadmin,
  validateBody(createTenantSchema),
  createTenantWithAdmin
);

router.post(
  "/tenants/:tenantId/reset-admin-password",
  requireDb,
  authenticate,
  requireSuperadmin,
  validateTenantIdParam,
  resetTenantAdminPassword
);

const platformRoleCreateSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).optional(),
  status: z.enum(["active", "inactive"]).optional(),
  permissions: z.record(z.array(z.string())).optional(),
});

const platformRoleUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    description: z.string().trim().max(500).optional(),
    status: z.enum(["active", "inactive"]).optional(),
    permissions: z.record(z.array(z.string())).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: "No fields to update" });

router.get("/roles/permission-modules", requireDb, authenticate, requireSuperadmin, getPlatformPermissionModules);
router.get("/roles", requireDb, authenticate, requireSuperadmin, listPlatformRoles);
router.get("/roles/:id", requireDb, authenticate, requireSuperadmin, getPlatformRole);
router.post(
  "/roles",
  requireDb,
  authenticate,
  requireSuperadmin,
  validateBody(platformRoleCreateSchema),
  createPlatformRole
);
router.patch(
  "/roles/:id",
  requireDb,
  authenticate,
  requireSuperadmin,
  validateBody(platformRoleUpdateSchema),
  updatePlatformRole
);
router.delete("/roles/:id", requireDb, authenticate, requireSuperadmin, deletePlatformRole);
router.post(
  "/tenants/:tenantId/seed-roles",
  requireDb,
  authenticate,
  requireSuperadmin,
  validateTenantIdParam,
  seedTenantRolesForTenant
);

const organizationTypeSchema = z.object({
  name: z.string().trim().min(2).max(120),
  code: z.string().trim().max(80).optional(),
  description: z.string().trim().max(500).optional(),
  status: z.enum(["active", "inactive"]).optional(),
  sortOrder: z.number().int().min(0).optional(),
});

const organizationTypeUpdateSchema = organizationTypeSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0, { message: "No fields to update" });

function validateObjectIdParam(req, res, next) {
  if (!/^[0-9a-fA-F]{24}$/.test(req.params.id)) {
    return sendError(res, "ORG_TYPE_INVALID_ID", 400);
  }
  return next();
}

router.get("/organization-types", requireDb, authenticate, requireSuperadmin, listOrganizationTypes);
router.post(
  "/organization-types",
  requireDb,
  authenticate,
  requireSuperadmin,
  validateBody(organizationTypeSchema),
  createOrganizationType
);
router.patch(
  "/organization-types/:id",
  requireDb,
  authenticate,
  requireSuperadmin,
  validateObjectIdParam,
  validateBody(organizationTypeUpdateSchema),
  updateOrganizationType
);
router.delete(
  "/organization-types/:id",
  requireDb,
  authenticate,
  requireSuperadmin,
  validateObjectIdParam,
  deleteOrganizationType
);

export default router;
