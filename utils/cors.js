/** Allow local dev origins including tenant subdomains (e.g. acme.localhost:5174). */
function isDevLocalOrigin(origin) {
  try {
    const { hostname, protocol } = new URL(origin);
    if (protocol !== "http:" && protocol !== "https:") return false;
    if (hostname === "localhost" || hostname === "127.0.0.1") return true;
    if (hostname.endsWith(".localhost")) return true;
    if (/^192\.168\.\d+\.\d+$/.test(hostname)) return true;
    if (/^10\.\d+\.\d+\.\d+$/.test(hostname)) return true;
    return false;
  } catch {
    return false;
  }
}

export function corsOrigin(origin, callback) {
  const list = (process.env.CORS_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!origin) return callback(null, true);

  if (process.env.NODE_ENV === "production") {
    if (list.length === 0) {
      return callback(new Error("CORS_ORIGINS must be set in production"));
    }
    if (list.includes(origin)) return callback(null, true);
    return callback(new Error("CORS blocked"));
  }

  if (list.length > 0 && list.includes(origin)) return callback(null, true);
  if (isDevLocalOrigin(origin)) return callback(null, true);

  return callback(new Error("CORS blocked"));
}
