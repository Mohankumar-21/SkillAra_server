import express from "express";
import { createTenant, listTenants, getTenant, updateTenant, updateTenantStatus, resolveTenant, checkTenantSubdomain } from "../controllers/tenantController.js";
import { body, validationResult } from "express-validator";
import { prepareResponseMsg, sendError } from "../utils/helper.js";
import { requireDb } from "../utils/db-state.js";
import { requireAuth, requireRole } from "../middlewares/auth.js";
import { z } from "zod";
import User from "../models/User.js";
import { validationMessageFromZod } from "../utils/errorMessages.js";
const tenantRouter = express.Router();

tenantRouter.get(
  "/",
  requireDb,
  requireAuth,
  requireRole("SUPER_ADMIN"),
  listTenants
); // GET /tenants

tenantRouter.get("/resolve", requireDb, resolveTenant); // GET /tenants/resolve (based on subdomain)

tenantRouter.get("/check/:subdomain", requireDb, checkTenantSubdomain); // Public workspace lookup

const findWorkspaceSchema = z.object({
  email: z.string().email().transform((v) => v.toLowerCase().trim()),
});

tenantRouter.post("/workspace/find", requireDb, async (req, res) => {
  const parsed = findWorkspaceSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, "GENERAL_VALIDATION_FAILED", 400, {
      issues: parsed.error.issues,
      detail: validationMessageFromZod(parsed.error),
    });
  }

  const users = await User.find({ email: parsed.data.email }).populate("tenantId", "name subdomain sub_domain status");
  
  const workspaces = users
    .filter(u => u.tenantId && u.tenantId.status === "active" && u.status === "active")
    .map(u => {
      const sub = u.tenantId.subdomain || u.tenantId.sub_domain;
      const url = `http://${sub}.localhost:5173`; 
      return {
        name: u.tenantId.name,
        subdomain: sub,
        url,
      };
    });

  return res.status(200).send(
    prepareResponseMsg({ workspaces }, true, "OK", 200)
  );
});
tenantRouter.post(
  "/",
  requireDb,
  requireAuth,
  requireRole("SUPER_ADMIN"),
  [
    body("tenant_name").isString().trim().isLength({ min: 2, max: 80 }),
    body("domain").isString().trim().isLength({ min: 3, max: 255 }),
    body("sub_domain")
      .isString()
      .trim()
      .isLength({ min: 2, max: 40 })
      .matches(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/),
    body("email").isEmail().toLowerCase().trim(),
    body("planId")
      .isString()
      .trim()
      .notEmpty()
      .matches(/^[0-9a-fA-F]{24}$/)
      .withMessage("Invalid planId"),
    body("status").optional().isBoolean(),
  ],
  (req, res, next) => {
    const errors = validationResult(req);
    if (errors.isEmpty()) return next();

    return sendError(res, "GENERAL_VALIDATION_FAILED", 400, { errors: errors.array() });
  },
  createTenant
); // POST /tenants

tenantRouter.get(
  "/:id",
  requireDb,
  requireAuth,
  requireRole("SUPER_ADMIN"),
  (req, res, next) => {
    if (!/^[0-9a-fA-F]{24}$/.test(req.params.id)) {
      return sendError(res, "TENANT_INVALID_ID", 400);
    }
    return next();
  },
  getTenant
);

tenantRouter.patch(
  "/:id/status",
  requireDb,
  requireAuth,
  requireRole("SUPER_ADMIN"),
  (req, res, next) => {
    if (!/^[0-9a-fA-F]{24}$/.test(req.params.id)) {
      return sendError(res, "TENANT_INVALID_ID", 400);
    }
    return next();
  },
  [body("status").isBoolean()],
  (req, res, next) => {
    const errors = validationResult(req);
    if (errors.isEmpty()) return next();
    return sendError(res, "GENERAL_VALIDATION_FAILED", 400, { errors: errors.array() });
  },
  updateTenantStatus
);

tenantRouter.patch(
  "/:id",
  requireDb,
  requireAuth,
  requireRole("SUPER_ADMIN"),
  (req, res, next) => {
    if (!/^[0-9a-fA-F]{24}$/.test(req.params.id)) {
      return sendError(res, "TENANT_INVALID_ID", 400);
    }
    return next();
  },
  [
    body("tenant_name").optional().isString().trim().isLength({ min: 2, max: 80 }),
    body("email").optional().isEmail().toLowerCase().trim(),
    body("planId").optional().matches(/^[0-9a-fA-F]{24}$/),
    body("status").optional().isBoolean(),
    body("subscriptionStatus").optional().isIn(["ACTIVE", "EXPIRED", "TRIAL"]),
  ],
  (req, res, next) => {
    const errors = validationResult(req);
    if (errors.isEmpty()) return next();
    return sendError(res, "GENERAL_VALIDATION_FAILED", 400, { errors: errors.array() });
  },
  updateTenant
);

export default tenantRouter;
