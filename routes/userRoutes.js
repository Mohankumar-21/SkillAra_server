/**
 * TENANT-SCOPED ROUTES — REVIEW CHECKLIST
 * All database queries in this file MUST filter by req.tenantId (set via scopeTenant middleware).
 * Never trust tenant id from req.query, req.body, or req.params.
 */
import express from "express";
import { z } from "zod";
import {
  listUsers,
  createUser,
  getUser,
  updateUser,
  updateUserStatus,
  deleteUser,
  updateMyProfile,
} from "../controllers/userController.js";
import { requireAuth, requireRole, requireTenant } from "../middlewares/auth.js";
import { isTenantAdminUser } from "../utils/user.js";
import { checkPlanLimits } from "../middlewares/checkPlanLimits.js";
import { sendError } from "../utils/helper.js";
import { validateBody } from "../utils/validate.js";
import { requireDb } from "../utils/db-state.js";

const router = express.Router();

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/);

const createUserSchema = z.object({
    name: z.string().trim().min(1).max(100),
    email: z
      .string()
      .email()
      .transform((v) => v.toLowerCase().trim()),
    password: z.string().min(6).max(200),
    roleId: objectId,
    invitationStatus: z.enum(["PENDING", "ACCEPTED"]).optional(),
    phone: z.string().trim().max(30).optional(),
    employeeId: z.string().trim().max(50).optional(),
    departmentId: objectId.nullable().optional(),
    designationId: objectId.nullable().optional(),
    profilePhoto: z.string().max(500_000).optional(),
  });

const updateUserSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    roleId: objectId.optional(),
    password: z.string().min(6).max(200).optional(),
    phone: z.string().trim().max(30).optional(),
    employeeId: z.string().trim().max(50).optional(),
    departmentId: objectId.nullable().optional(),
    designationId: objectId.nullable().optional(),
    profilePhoto: z.string().max(500_000).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: "No fields to update" });

const statusSchema = z.object({
  status: z.enum(["ACTIVE", "DISABLED"]),
});

const profileSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  phone: z.string().trim().max(30).optional(),
  profilePhoto: z.string().max(500_000).optional(),
});

function validate(schema) {
  return validateBody(schema);
}

function canAccessUser(req, res, next) {
  if (isTenantAdminUser(req.user) || req.user?.role === "ORG_ADMIN") {
    return next();
  }
  if (String(req.params.id) === String(req.user._id || req.user.id)) return next();
  return sendError(res, "GENERAL_FORBIDDEN", 403);
}

router.get(
  "/",
  requireDb,
  requireAuth,
  requireRole("TENANT_ADMIN", "ORG_ADMIN"),
  requireTenant,
  listUsers
);

router.patch(
  "/me/profile",
  requireDb,
  requireAuth,
  requireTenant,
  validate(profileSchema),
  updateMyProfile
);

router.post(
  "/",
  requireDb,
  requireAuth,
  requireRole("TENANT_ADMIN", "ORG_ADMIN"),
  requireTenant,
  checkPlanLimits({ resource: "users" }),
  validate(createUserSchema),
  createUser
);

router.get("/:id", requireDb, requireAuth, requireTenant, canAccessUser, getUser);

router.put(
  "/:id",
  requireDb,
  requireAuth,
  requireTenant,
  validate(updateUserSchema),
  updateUser
);

router.patch(
  "/:id/status",
  requireDb,
  requireAuth,
  requireRole("TENANT_ADMIN", "ORG_ADMIN"),
  requireTenant,
  validate(statusSchema),
  updateUserStatus
);

router.delete(
  "/:id",
  requireDb,
  requireAuth,
  requireRole("TENANT_ADMIN", "ORG_ADMIN"),
  requireTenant,
  deleteUser
);

export default router;
