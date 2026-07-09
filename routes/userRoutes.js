import express from "express";
import { z } from "zod";
import {
  listUsers,
  createUser,
  getUser,
  updateUser,
  updateUserStatus,
  deleteUser,
} from "../controllers/userController.js";
import { requireAuth, requireRole, requireTenant } from "../middlewares/auth.js";
import { checkPlanLimits } from "../middlewares/checkPlanLimits.js";
import { prepareResponseMsg } from "../utils/helper.js";
import { requireDb } from "../utils/db-state.js";

const router = express.Router();

const createUserSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z
    .string()
    .email()
    .transform((v) => v.toLowerCase().trim()),
  password: z.string().min(6).max(200),
  role: z.enum(["TUTOR", "STUDENT"]),
});

const updateUserSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    role: z.enum(["TUTOR", "STUDENT"]).optional(),
    password: z.string().min(6).max(200).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: "No fields to update" });

const statusSchema = z.object({
  status: z.enum(["ACTIVE", "DISABLED"]),
});

function validate(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .send(
          prepareResponseMsg({ issues: parsed.error.issues }, false, "Validation failed", 400)
        );
    }
    req.body = parsed.data;
    return next();
  };
}

function canAccessUser(req, res, next) {
  if (req.user.role === "TENANT_ADMIN") return next();
  if (String(req.params.id) === String(req.user._id)) return next();
  return res.status(403).send(prepareResponseMsg({}, false, "Forbidden", 403));
}

router.get(
  "/",
  requireDb,
  requireAuth,
  requireRole("TENANT_ADMIN"),
  requireTenant,
  listUsers
);

router.post(
  "/",
  requireDb,
  requireAuth,
  requireRole("TENANT_ADMIN"),
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
  requireRole("TENANT_ADMIN"),
  requireTenant,
  validate(statusSchema),
  updateUserStatus
);

router.delete(
  "/:id",
  requireDb,
  requireAuth,
  requireRole("TENANT_ADMIN"),
  requireTenant,
  deleteUser
);

export default router;
