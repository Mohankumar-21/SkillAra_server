/**
 * TENANT-SCOPED ROUTES — REVIEW CHECKLIST
 * All database queries in this file MUST filter by req.tenantId (set via scopeTenant middleware).
 * Never trust tenant id from req.query, req.body, or req.params.
 */
import express from "express";
import { z } from "zod";
import {
  createQuestion,
  listQuestions,
  getQuestion,
  deleteQuestion,
  createAnswer,
  deleteAnswer,
  acceptAnswer,
  voteQuestion,
  voteAnswer,
  moderateQuestion,
  moderateAnswer,
} from "../controllers/forumController.js";
import { requireAuth, requirePermission, requireTenant } from "../middlewares/auth.js";
import { checkPlanLimits } from "../middlewares/checkPlanLimits.js";
import { prepareResponseMsg } from "../utils/helper.js";
import { requireDb } from "../utils/db-state.js";

const router = express.Router();

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid id");

const questionSchema = z.object({
  courseId: objectId.optional(),
  title: z.string().trim().min(5).max(300),
  body: z.string().trim().min(5).max(10000),
  tags: z.array(z.string().trim().max(40)).max(10).optional(),
});

const answerSchema = z.object({
  body: z.string().trim().min(1).max(10000),
});

const voteSchema = z.object({
  value: z.union([z.literal(1), z.literal(-1)]),
});

const moderateSchema = z.object({
  isHidden: z.boolean(),
  reason: z.string().max(500).optional(),
});

function validateBody(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .send(prepareResponseMsg({ issues: parsed.error.issues }, false, "Validation failed", 400));
    }
    req.body = parsed.data;
    return next();
  };
}

router.post("/questions", requireDb, requireAuth, requireTenant, checkPlanLimits({ resource: "community" }), validateBody(questionSchema), createQuestion);
router.get("/questions", requireDb, requireAuth, requireTenant, listQuestions);
router.get("/questions/:id", requireDb, requireAuth, requireTenant, getQuestion);
router.delete("/questions/:id", requireDb, requireAuth, requireTenant, deleteQuestion);
router.post("/questions/:id/vote", requireDb, requireAuth, requireTenant, validateBody(voteSchema), voteQuestion);
router.patch(
  "/questions/:id/moderate",
  requireDb,
  requireAuth,
  requireTenant,
  requirePermission("forum", "moderate"),
  validateBody(moderateSchema),
  moderateQuestion
);

router.post("/questions/:id/answers", requireDb, requireAuth, requireTenant, checkPlanLimits({ resource: "community" }), validateBody(answerSchema), createAnswer);
router.delete("/answers/:id", requireDb, requireAuth, requireTenant, deleteAnswer);
router.post("/answers/:id/accept", requireDb, requireAuth, requireTenant, acceptAnswer);
router.post("/answers/:id/vote", requireDb, requireAuth, requireTenant, validateBody(voteSchema), voteAnswer);
router.patch(
  "/answers/:id/moderate",
  requireDb,
  requireAuth,
  requireTenant,
  requirePermission("forum", "moderate"),
  validateBody(moderateSchema),
  moderateAnswer
);

export default router;
