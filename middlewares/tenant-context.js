import Tenant from "../models/Tenant.js";
import { resolveTenantFromRequest } from "../utils/resolve-tenant-request.js";

export async function tenantContext(req, res, next) {
  try {
    const { subdomain, tenant } = await resolveTenantFromRequest(req);
    req.tenantSubdomain = subdomain;
    req.tenant = tenant;
    return next();
  } catch (err) {
    return next(err);
  }
}
