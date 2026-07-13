/** Refresh token cookie helpers — access tokens are never stored in cookies. */

export const TENANT_REFRESH_COOKIE = "refresh_token";
export const SUPERADMIN_REFRESH_COOKIE = "superadmin_refresh_token";

/**
 * Cookie Domain must match the browser host. A production value like
 * `.skillara.com` is rejected on localhost and silently drops the refresh
 * cookie — which breaks "Remember me" / session restore after refresh.
 */
export function refreshCookieOptions() {
  const secure = process.env.NODE_ENV === "production";
  const configuredDomain = String(process.env.COOKIE_DOMAIN || "").trim();
  const useDomain =
    process.env.NODE_ENV === "production" &&
    configuredDomain.length > 0 &&
    !/localhost|127\.0\.0\.1/i.test(configuredDomain);

  return {
    httpOnly: true,
    secure,
    sameSite: "strict",
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
