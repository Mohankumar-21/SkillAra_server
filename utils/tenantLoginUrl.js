/** Build tenant workspace login URL for welcome emails. */
export function buildTenantLoginUrl(subdomain) {
  const sub = String(subdomain || "").trim().toLowerCase();
  const root = process.env.ROOT_DOMAIN || "skillara.com";
  const protocol = process.env.CLIENT_APP_PROTOCOL || "http";
  const port = process.env.CLIENT_APP_PORT || "5173";

  if (process.env.NODE_ENV === "production") {
    return `${protocol}://${sub}.${root}/login`;
  }

  if (root.includes("localhost")) {
    return `${protocol}://${sub}.${root}/login`;
  }

  return `${protocol}://${sub}.localhost:${port}/login`;
}
