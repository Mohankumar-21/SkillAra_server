/** Tenant workspace URLs — where a workspace lives, and its login page. */

/**
 * Subdomain routing only works when the client app is itself served from the
 * root domain (ROOT_DOMAIN=skillara.com with the client at skillara.com).
 *
 * A bare hosting URL has no wildcard below its own host: the *.vercel.app
 * certificate covers exactly one label, so the edge serves no certificate at
 * all for <sub>.<app>.vercel.app and the TLS handshake fails. Those deploys
 * serve every workspace from one origin and select by ?tenant= instead.
 */
export function hasWildcardRootDomain() {
  const client = String(process.env.CLIENT_APP_URL || "").trim();
  const root = String(process.env.ROOT_DOMAIN || "").trim().toLowerCase();
  if (!root || !client) return false;

  try {
    const host = new URL(client).hostname.toLowerCase();
    return host === root || host.endsWith(`.${root}`);
  } catch {
    // unparseable CLIENT_APP_URL — fall back to the query form
    return false;
  }
}

/** Build tenant workspace login URL for welcome emails. */
export function buildTenantLoginUrl(subdomain) {
  const sub = String(subdomain || "").trim().toLowerCase();
  const root = (process.env.ROOT_DOMAIN || "skillara.com").toLowerCase();
  const protocol = process.env.CLIENT_APP_PROTOCOL || "http";
  const port = process.env.CLIENT_APP_PORT || "5173";
  const client = String(process.env.CLIENT_APP_URL || "").trim().replace(/\/+$/, "");

  if (hasWildcardRootDomain()) {
    return `${protocol}://${sub}.${root}/login`;
  }

  if (root.includes("localhost")) {
    return `${protocol}://${sub}.${root}/login`;
  }

  if (process.env.NODE_ENV !== "production") {
    return `${protocol}://${sub}.localhost:${port}/login`;
  }

  if (client) {
    return `${client}/login?tenant=${encodeURIComponent(sub)}`;
  }

  return `${protocol}://${sub}.${root}/login`;
}
