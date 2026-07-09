import Tenant from "../models/Tenant.js";
import { extractSubdomain, normalizeHost } from "./tenant.js";
import { isDbReady } from "./db-state.js";

const RESERVED = new Set(["www", "admin", "api"]);

export function resolveRequestHostname(req) {
  const forwarded = req.get("x-forwarded-host");
  if (forwarded) return normalizeHost(forwarded);

  if (req.hostname && req.hostname !== "localhost" && req.hostname !== "127.0.0.1") {
    return req.hostname;
  }

  const origin = req.get("origin");
  if (origin) {
    try {
      return normalizeHost(new URL(origin).hostname);
    } catch {
      // ignore
    }
  }

  const referer = req.get("referer");
  if (referer) {
    try {
      return normalizeHost(new URL(referer).hostname);
    } catch {
      // ignore
    }
  }

  return req.hostname;
}

export function extractSubdomainFromRequest(req) {
  const rootDomain = process.env.ROOT_DOMAIN || "";
  const hostname = resolveRequestHostname(req);
  let subdomain = extractSubdomain(hostname, rootDomain);

  if (!subdomain) {
    const raw =
      req.get("x-tenant-subdomain") ||
      req.body?.subdomain ||
      req.query?.tenant ||
      process.env.DEV_TENANT_SUBDOMAIN ||
      "";
    subdomain = String(raw).trim().toLowerCase() || null;
  }

  if (subdomain && RESERVED.has(subdomain)) return null;
  return subdomain;
}

export async function resolveTenantFromRequest(req) {
  const subdomain = extractSubdomainFromRequest(req);
  if (!subdomain) return { subdomain: null, tenant: null };
  if (!isDbReady()) return { subdomain, tenant: null };

  const tenant = await Tenant.findOne({ sub_domain: subdomain });
  return { subdomain, tenant };
}
