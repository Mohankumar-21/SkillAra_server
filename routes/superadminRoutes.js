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
  updatePlatformRole,
} from "../controllers/roleController.js";
import {
  listPlatformCourses,
  getPlatformCourseStats,
  blockPlatformCourse,
  unblockPlatformCourse,
  unpublishPlatformCourse,
} from "../controllers/platformCourseController.js";
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
    welcome_message: z.string().max(250).optional(),
    primary_color: z.string().regex(/^#([0-9A-Fa-f]{6})$/).optional(),
    secondary_color: z.string().regex(/^#([0-9A-Fa-f]{6})$/).optional(),
  })
  .optional();

const adminSchema = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    email: z.string().email().optional(),
    phone: z.string().trim().max(20).optional(),
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
    .min(3)
    .max(15)
    .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/)
    .optional(),
  sub_domain: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(15)
    .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/)
    .optional(),
  domain: z.string().trim().optional(),
  email: z.string().email().optional(),
  phone: z.string().trim().min(7).max(20).optional(),
  org_type: z.string().optional(),
  orgType: z.string().optional(),
  orgTypeId: z.string().regex(/^[0-9a-fA-F]{24}$/).optional(),
  industry: z.string().trim().max(80).optional(),
  website: z.string().trim().max(200).optional(),
  country: z.string().trim().min(2).max(2).optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
  currency: z.string().trim().min(3).max(3).optional(),
  logo: z.any().optional(),
  branding: brandingSchema,
  plan: z.string().trim().optional(),
  planId: z.string().regex(/^[0-9a-fA-F]{24}$/).optional(),
  status: z.boolean().optional(),
  owner_first: z.string().trim().min(2).max(50).optional(),
  owner_last: z.string().trim().min(1).max(50).optional(),
  owner_phone: z.string().trim().max(20).optional(),
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
  permissions: z.record(z.string(), z.array(z.string())).optional(),
});

const platformRoleUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    description: z.string().trim().max(500).optional(),
    status: z.enum(["active", "inactive"]).optional(),
    permissions: z.record(z.string(), z.array(z.string())).optional(),
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

const organizationTypeSchema = z.object({
  name: z.string().trim().min(2).max(120),
  code: z.preprocess(
    (v) => {
      if (v === "" || v == null) return undefined;
      return String(v).trim().toUpperCase();
    },
    z.string().regex(/^[A-Z0-9]{3}$/, "Code must be exactly 3 characters").optional()
  ),
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

/* ------------------------------ course oversight ------------------------------
 * Cross-tenant catalog visibility and platform-level takedown. Handlers in
 * platformCourseController.js query without a tenant filter, so requireSuperadmin
 * on every route here is the only thing keeping that scope safe.
 * ---------------------------------------------------------------------------- */

const blockCourseSchema = z.object({ reason: z.string().trim().min(3).max(500) });

router.get("/courses", requireDb, authenticate, requireSuperadmin, listPlatformCourses);
router.get("/courses/stats", requireDb, authenticate, requireSuperadmin, getPlatformCourseStats);
router.post(
  "/courses/:id/block",
  requireDb,
  authenticate,
  requireSuperadmin,
  validateObjectIdParam,
  validateBody(blockCourseSchema),
  blockPlatformCourse
);
router.post(
  "/courses/:id/unblock",
  requireDb,
  authenticate,
  requireSuperadmin,
  validateObjectIdParam,
  unblockPlatformCourse
);
router.post(
  "/courses/:id/unpublish",
  requireDb,
  authenticate,
  requireSuperadmin,
  validateObjectIdParam,
  unpublishPlatformCourse
);

export default router;
