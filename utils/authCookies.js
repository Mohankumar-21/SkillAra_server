/** Refresh token cookie helpers — access tokens are never stored in cookies. */

export const TENANT_REFRESH_COOKIE = "refresh_token";
export const SUPERADMIN_REFRESH_COOKIE = "superadmin_refresh_token";

/**
 * Cookie Domain must match the browser host. A production value like
 * `.skillara.com` is rejected on localhost and silently drops the refresh
 * cookie — which breaks "Remember me" / session restore after refresh.
 */
export function refreshCookieOptions() {
  /**
   * SameSite=Strict never leaves the origin, so when the client and the API sit
   * on different registrable domains (frontend on *.vercel.app, API on
   * *.onrender.com) the browser stores the refresh cookie and then never sends
   * it back — login succeeds and the session dies on the next reload.
   *
   * Cross-site deploys therefore need "none". Keep "strict"/"lax" whenever the
   * two share a domain, where it still buys CSRF protection.
   */
  const isProd = process.env.NODE_ENV === "production";
  const sameSite = String(
    process.env.COOKIE_SAMESITE || (isProd ? "none" : "strict")
  ).trim().toLowerCase();
  // Browsers reject SameSite=None unless the cookie is also Secure.
  const secure = isProd || sameSite === "none";
  const configuredDomain = String(process.env.COOKIE_DOMAIN || "").trim();
  const useDomain =
    process.env.NODE_ENV === "production" &&
    configuredDomain.length > 0 &&
    !/localhost|127\.0\.0\.1/i.test(configuredDomain);

  return {
    httpOnly: true,
    secure,
    sameSite,
    path: "/",
    ...(useDomain ? { domain: configuredDomain } : {}),
  };
}

export function setRefreshCookie(res, cookieName, token, maxAgeSeconds) {
  const options = { ...refreshCookieOptions() };
  if (maxAgeSeconds != null) {
    options.maxAge = maxAgeSeconds * 1000;
  }
  res.cookie(cookieName, token, options);
}

export function clearRefreshCookie(res, cookieName) {
  res.clearCookie(cookieName, refreshCookieOptions());
}
