// File: d:/V_personel/projects/SkillAra/SkillAra_server/controllers/analyticsController.js
import { sendError, prepareResponseMsg } from "../utils/helper.js";
import { getUserGrowthPipeline, getRevenuePipeline, getCoursePopularityPipeline } from "../services/analyticsService.js";
import User from "../models/User.js";
import Subscription from "../models/Subscription.js";
import Enrollment from "../models/Enrollment.js";
import Course from "../models/Course.js";

// Helper to execute aggregation and send response
async function runAggregation(res, model, pipeline) {
  try {
    const data = await model.aggregate(pipeline);
    return res.status(200).send(prepareResponseMsg(data, true, "Analytics data retrieved", 200));
  } catch (err) {
    return sendError(res, "ANALYTICS_AGGREGATION_ERROR", 500);
  }
}

export async function getUserGrowth(req, res) {
  const tenantId = req.tenantId;
  const { interval, startDate, endDate } = req.query; // interval: daily|weekly|monthly|quarterly|half-yearly|yearly|custom
  const pipeline = getUserGrowthPipeline({ tenantId, interval, startDate, endDate });
  return runAggregation(res, User, pipeline);
}

export async function getRevenueStats(req, res) {
  const tenantId = req.tenantId;
  const { interval, startDate, endDate } = req.query;
  const pipeline = getRevenuePipeline({ tenantId, interval, startDate, endDate });
  return runAggregation(res, Subscription, pipeline);
}

export async function getCoursePopularity(req, res) {
  const tenantId = req.tenantId;
  const { limit = 10 } = req.query;
  const pipeline = getCoursePopularityPipeline({ tenantId, limit });
  return runAggregation(res, Enrollment, pipeline);
}
