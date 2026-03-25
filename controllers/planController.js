import Plan from "../models/Plan.js";
import { prepareResponseMsg } from "../utils/helper.js";

export const createPlan = async (req, res, next) => {
  try {
    const data = req.body;
    const plan = await Plan.create(data);

    return res.status(201).send(
      prepareResponseMsg({ plan }, true, "Plan created", 201)
    );
  } catch (err) {
    // Duplicate key = unique plan name.
    if (err?.code === 11000) {
      return res
        .status(409)
        .send(prepareResponseMsg({}, false, "Plan name already exists", 409));
    }
    return next(err);
  }
};

export const listPlans = async (req, res, next) => {
  try {
    const plans = await Plan.find({}).sort({ createdAt: -1 });
    return res.status(200).send(prepareResponseMsg(plans, true, "Plans fetched", 200));
  } catch (err) {
    return next(err);
  }
};

export const updatePlan = async (req, res, next) => {
  try {
    const { id } = req.params;
    const data = req.body;
    const updated = await Plan.findByIdAndUpdate(id, data, {
      new: true,
      runValidators: true,
    });

    if (!updated) {
      return res.status(404).send(prepareResponseMsg({}, false, "Plan not found", 404));
    }

    return res.status(200).send(prepareResponseMsg({ plan: updated }, true, "Plan updated", 200));
  } catch (err) {
    if (err?.code === 11000) {
      return res
        .status(409)
        .send(prepareResponseMsg({}, false, "Plan name already exists", 409));
    }
    return next(err);
  }
};

export const deactivatePlan = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updated = await Plan.findByIdAndUpdate(
      id,
      { isActive: false },
      { new: true }
    );

    if (!updated) {
      return res.status(404).send(prepareResponseMsg({}, false, "Plan not found", 404));
    }

    return res
      .status(200)
      .send(prepareResponseMsg({ plan: updated }, true, "Plan deactivated", 200));
  } catch (err) {
    return next(err);
  }
};

