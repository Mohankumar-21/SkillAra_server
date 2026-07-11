import { prepareResponseMsg, sendError } from "../utils/helper.js";
import {
  createPlan as createEmbeddedPlan,
  deactivatePlan as deactivateEmbeddedPlan,
  listPlans as listEmbeddedPlans,
  migrateLegacyPlansCollection,
  seedDefaultPlans,
  updatePlan as updateEmbeddedPlan,
} from "../services/planService.js";

export { seedDefaultPlans, migrateLegacyPlansCollection };

export const createPlan = async (req, res, next) => {
  try {
    const plan = await createEmbeddedPlan(req.body);
    return res.status(201).send(
      prepareResponseMsg({ plan }, true, "Plan created", 201)
    );
  } catch (err) {
    if (err?.code === 11000) {
      return sendError(res, "PLAN_NAME_EXISTS", 409);
    }
    return next(err);
  }
};

export const listPlans = async (req, res, next) => {
  try {
    const plans = await listEmbeddedPlans();
    return res.status(200).send(prepareResponseMsg(plans, true, "Plans fetched", 200));
  } catch (err) {
    return next(err);
  }
};

export const updatePlan = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updated = await updateEmbeddedPlan(id, req.body);
    if (!updated) {
      return sendError(res, "PLAN_NOT_FOUND", 404);
    }
    return res.status(200).send(prepareResponseMsg({ plan: updated }, true, "Plan updated", 200));
  } catch (err) {
    if (err?.code === 11000) {
      return sendError(res, "PLAN_NAME_EXISTS", 409);
    }
    return next(err);
  }
};

export const deactivatePlan = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updated = await deactivateEmbeddedPlan(id);
    if (!updated) {
      return sendError(res, "PLAN_NOT_FOUND", 404);
    }
    return res
      .status(200)
      .send(prepareResponseMsg({ plan: updated }, true, "Plan deactivated", 200));
  } catch (err) {
    return next(err);
  }
};
