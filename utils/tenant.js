const PLATFORM_SUFFIXES = [
  "vercel.app",
  "onrender.com",
  "netlify.app",
  "azurewebsites.net",
  "herokuapp.com",
  "railway.app",
  "fly.dev",
  "github.io",
];

export function normalizeHost(hostname = "") {
  // hostname may include port if derived from headers; Express req.hostname should not,
  // but keep this defensive for proxy headers.
  return String(hostname).trim().toLowerCase().split(":")[0];
}

export function extractSubdomain(hostname, rootDomain) {
  const host = normalizeHost(hostname);
  if (!host) return null;

  // acme.localhost → tenant acme (local subdomain dev)
  if (host.endsWith(".localhost")) {
    const sub = host.slice(0, -".localhost".length);
    if (sub && !sub.includes(".")) return sub;
    return null;
  }

  // localhost or raw IP does not represent tenant subdomain
  if (host === "localhost" || host === "127.0.0.1" || /^[0-9.]+$/.test(host)) return null;

  const root = normalizeHost(rootDomain);
  if (root) {
    if (host === root) return null;
    if (host.endsWith(`.${root}`)) {
      const prefix = host.slice(0, -(root.length + 1)); // remove ".root"
      if (!prefix) return null;
      const tenantKey = prefix.split(".")[0];
      return tenantKey || null;
    }
    return null;
  }

  for (const suffix of PLATFORM_SUFFIXES) {
    if (host.endsWith(`.${suffix}`)) {
      const prefix = host.slice(0, -(suffix.length + 1));
      if (!prefix.includes(".")) return null;
      const sub = prefix.split(".")[0];
      return sub || null;
    }
  }

  // Fallback: take first label if host has 3+ parts (a.b.c)
  const parts = host.split(".");
  return parts.length >= 3 ? parts[0] : null;
}
