import Tenant from "../models/Tenant.js";
import { extractSubdomainFromRequest } from "../utils/resolve-tenant-request.js";
import { sendError } from "../utils/helper.js";
import { isDbReady } from "../utils/db-state.js";

/**
 * Subdomain-based tenant resolution for auth and tenant-scoped routes.
 * Attaches req.resolvedTenant — never trust tenant id from body/query/params.
 */
export async function resolveTenantFromSubdomain(req, res, next) {
  const subdomain = extractSubdomainFromRequest(req);
  if (!subdomain) {
    return sendError(res, "AUTH_TENANT_WORKSPACE_REQUIRED", 400);
  }

  if (!isDbReady()) {
    return sendError(res, "GENERAL_SERVICE_UNAVAILABLE", 503);
  }

  let tenant = await Tenant.findOne({ subdomain });
  if (!tenant) {
    tenant = await Tenant.findOne({ sub_domain: subdomain });
  }
  if (!tenant) {
    return sendError(res, "TENANT_NOT_FOUND", 404, { subdomain });
  }

  if (
    tenant.subscriptionStatus === "TRIAL" &&
    tenant.subscriptionEndDate &&
    new Date() > new Date(tenant.subscriptionEndDate)
  ) {
    tenant.subscriptionStatus = "EXPIRED";
    await Tenant.updateOne({ _id: tenant._id }, { $set: { subscriptionStatus: "EXPIRED" } });
  }

  if (tenant.status === "suspended" || tenant.status === false || tenant.subscriptionStatus === "EXPIRED") {
    return sendError(res, "AUTH_TENANT_INACTIVE", 403, {
      detail:
        tenant.subscriptionStatus === "EXPIRED"
          ? "Organization trial period has expired. Please upgrade your subscription plan to continue."
          : "Organization is inactive.",
    });
  }

  req.resolvedTenant = tenant;
  req.tenant = tenant;
  return next();
}
