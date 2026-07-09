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

  // acme.localhost → acme (local subdomain dev)
  if (host.endsWith(".localhost")) {
    const sub = host.slice(0, -".localhost".length);
    return sub && !sub.includes(".") ? sub : null;
  }

  const root = normalizeHost(rootDomain);
  if (!root) {
    // Fallback: take first label if host has 3+ parts (a.b.c)
    const parts = host.split(".");
    return parts.length >= 3 ? parts[0] : null;
  }

  if (host === root) return null;
  if (!host.endsWith(`.${root}`)) return null;

  const prefix = host.slice(0, -(root.length + 1)); // remove ".root"
  if (!prefix) return null;

  // If multi-level subdomain like a.b.root, take left-most label as tenant key
  const tenantKey = prefix.split(".")[0];
  return tenantKey || null;
}
