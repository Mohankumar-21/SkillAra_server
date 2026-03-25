import Tenant from "../models/Tenant.js";
import { extractSubdomain } from "../utils/tenant.js";
import { isDbReady } from "../utils/db-state.js";

const RESERVED = new Set(["www", "admin", "api"]);

export async function tenantContext(req, res, next) {
  try {
    const rootDomain = process.env.ROOT_DOMAIN || "";
    const subdomain = extractSubdomain(req.hostname, rootDomain);

    req.tenant = null;
    req.tenantSubdomain = subdomain;

    if (!subdomain || RESERVED.has(subdomain)) return next();
    if (!isDbReady()) return next();

    const tenant = await Tenant.findOne({ sub_domain: subdomain });
    req.tenant = tenant || null;

    return next();
  } catch (err) {
    return next(err);
  }
}
