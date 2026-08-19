// File: d:/V_personel/projects/SkillAra/SkillAra_server/services/analyticsService.js
/**
 * Pipeline builders for admin analytics endpoints.
 * All pipelines start with a $match on tenantId for data isolation.
 */

export function getUserGrowthPipeline({ tenantId, interval, startDate, endDate }) {
  const match = { tenantId };
  if (startDate && endDate) {
    match.createdAt = { $gte: new Date(startDate), $lte: new Date(endDate) };
  }

  const groupId = (() => {
    switch (interval) {
      case "daily":
        return { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } };
      case "weekly":
        return { $dateToString: { format: "%Y-%U", date: "$createdAt" } }; // week number
      case "monthly":
        return { $dateToString: { format: "%Y-%m", date: "$createdAt" } };
      case "quarterly":
        return { $concat: [
          { $substr: [{ $year: "$createdAt" }, 0, 4] }, "-Q",
          { $ceil: { $divide: [{ $month: "$createdAt" }, 3] } }
        ] };
      case "half-yearly":
        return { $concat: [
          { $substr: [{ $year: "$createdAt" }, 0, 4] }, "-H",
          { $cond: [{ $lte: [{ $month: "$createdAt" }, 6] }, "1", "2"] }
        ] };
      case "yearly":
        return { $dateToString: { format: "%Y", date: "$createdAt" } };
      case "custom":
        // custom range handled by match dates, no grouping needed
        return null;
      default:
        // default to daily if unspecified
        return { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } };
    }
  })();

  const pipeline = [{ $match: match }];
  if (groupId) {
    pipeline.push({ $group: { _id: groupId, count: { $sum: 1 } } });
    pipeline.push({ $sort: { _id: 1 } });
  }
  return pipeline;
}

export function getRevenuePipeline({ tenantId, interval, startDate, endDate }) {
  const match = { tenantId, paymentStatus: "PAID" };
  if (startDate && endDate) {
    match.createdAt = { $gte: new Date(startDate), $lte: new Date(endDate) };
  }

  const groupId = (() => {
    switch (interval) {
      case "daily":
        return { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } };
      case "weekly":
        return { $dateToString: { format: "%Y-%U", date: "$createdAt" } };
      case "monthly":
        return { $dateToString: { format: "%Y-%m", date: "$createdAt" } };
      case "quarterly":
        return { $concat: [
          { $substr: [{ $year: "$createdAt" }, 0, 4] }, "-Q",
          { $ceil: { $divide: [{ $month: "$createdAt" }, 3] } }
        ] };
      case "half-yearly":
        return { $concat: [
          { $substr: [{ $year: "$createdAt" }, 0, 4] }, "-H",
          { $cond: [{ $lte: [{ $month: "$createdAt" }, 6] }, "1", "2"] }
        ] };
      case "yearly":
        return { $dateToString: { format: "%Y", date: "$createdAt" } };
      case "custom":
        return null;
      default:
        return { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } };
    }
  })();

  const pipeline = [{ $match: match }];
  if (groupId) {
    pipeline.push({ $group: { _id: groupId, totalRevenue: { $sum: "$amount" } } });
    pipeline.push({ $sort: { _id: 1 } });
  } else {
    // fallback total revenue without grouping
    pipeline.push({ $group: { _id: null, totalRevenue: { $sum: "$amount" } } });
  }
  return pipeline;
}

export function getCoursePopularityPipeline({ tenantId, limit }) {
  // Compute enrollment count and completion rate per course
  const pipeline = [
    { $match: { tenantId } },
    {
      $lookup: {
        from: "enrollments",
        localField: "_id",
        foreignField: "courseId",
        as: "enrollments"
      }
    },
    {
      $addFields: {
        enrollmentCount: { $size: "$enrollments" },
        completedCount: {
          $size: {
            $filter: {
              input: "$enrollments",
              as: "e",
              cond: { $eq: ["$$e.status", "COMPLETED"] }
            }
          }
        }
      }
    },
    {
      $addFields: {
        completionRate: {
          $cond: [{ $gt: ["$enrollmentCount", 0] }, { $divide: ["$completedCount", "$enrollmentCount"] }, 0]
        },
        popularityScore: {
          $add: [
            { $multiply: ["$enrollmentCount", 0.7] },
            { $multiply: ["$completionRate", 0.3] }
          ]
        }
      }
    },
    { $project: { name: 1, popularityScore: 1, enrollmentCount: 1, completionRate: 1 } },
    { $sort: { popularityScore: -1 } },
    { $limit: Number(limit) }
  ];
  return pipeline;
}
