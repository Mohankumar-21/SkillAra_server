import express from "express";
import { z } from "zod";

import { createPlan, deactivatePlan, listPlans, updatePlan } from "../controllers/planController.js";
import { prepareResponseMsg } from "../utils/helper.js";
import { requireDb } from "../utils/db-state.js";
import { requireAuth, requireRole } from "../middlewares/auth.js";

const router = express.Router();

const PLAN_NAMES = ["FREE", "BASIC", "PREMIUM", "ENTERPRISE"];
const BILLING_CYCLES = ["monthly", "yearly"];

const featuresSchema = z.object({
  maxUsers: z.number().int().min(0),
  maxCourses: z.number().int().min(0),
  storageLimit: z.number().int().min(0),
  aiFeatures: z.boolean(),
  analyticsAccess: z.boolean(),
  prioritySupport: z.boolean(),
});

const planCreateSchema = z.object({
  name: z.string().trim().toUpperCase().refine((v) => PLAN_NAMES.includes(v), "Invalid plan name"),
  price: z.number().nonnegative(),
  billingCycle: z.enum(BILLING_CYCLES),
  features: featuresSchema,
  isActive: z.boolean().optional().default(true),
});

const planUpdateSchema = planCreateSchema.partial().extend({
  name: planCreateSchema.shape.name.optional(),
  price: planCreateSchema.shape.price.optional(),
  billingCycle: planCreateSchema.shape.billingCycle.optional(),
  features: planCreateSchema.shape.features.optional(),
  isActive: planCreateSchema.shape.isActive.optional(),
});

function validateBody(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).send(
        prepareResponseMsg(
          { issues: parsed.error.issues },
          false,
          "Validation failed",
          400
        )
      );
    }
    req.body = parsed.data;
    return next();
  };
}

const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/);

router.get("/", requireDb, listPlans); // GET /api/plans

router.post(
  "/",
  requireDb,
  requireAuth,
  requireRole("SUPER_ADMIN"),
  validateBody(planCreateSchema),
  createPlan
); // POST /api/plans

router.put(
  "/:id",
  requireDb,
  requireAuth,
  requireRole("SUPER_ADMIN"),
  (req, res, next) => {
    const parsed = objectIdSchema.safeParse(req.params.id);
    if (!parsed.success) {
      return res.status(400).send(prepareResponseMsg({}, false, "Invalid plan id", 400));
    }
    return next();
  },
  validateBody(planUpdateSchema),
  updatePlan
); // PUT /api/plans/:id

router.patch(
  "/:id/deactivate",
  requireDb,
  requireAuth,
  requireRole("SUPER_ADMIN"),
  (req, res, next) => {
    const parsed = objectIdSchema.safeParse(req.params.id);
    if (!parsed.success) {
      return res.status(400).send(prepareResponseMsg({}, false, "Invalid plan id", 400));
    }
    return next();
  },
  deactivatePlan
); // PATCH /api/plans/:id/deactivate

export default router;

