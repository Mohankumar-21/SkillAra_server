import express from "express";
import { createTenant, listTenants, resolveTenant } from "../controllers/tenantController.js";
import { body, validationResult } from "express-validator";
import { prepareResponseMsg } from "../utils/helper.js";
import { getMessage } from "../core/message.js";
import { requireDb } from "../utils/db-state.js";
import { requireAuth, requireRole } from "../middlewares/auth.js";
const tenantRouter = express.Router();

tenantRouter.get(
  "/",
  requireDb,
  requireAuth,
  requireRole("SUPER_ADMIN"),
  listTenants
); // GET /tenants

tenantRouter.get("/resolve", requireDb, resolveTenant); // GET /tenants/resolve (based on subdomain)

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
    body("email").isEmail().normalizeEmail(),
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

    const resp = prepareResponseMsg({ errors: errors.array() }, false, getMessage(150), 400);
    return res.status(400).send(resp);
  },
  createTenant
); // POST /tenants

export default tenantRouter;
