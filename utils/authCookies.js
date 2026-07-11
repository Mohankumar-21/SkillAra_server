/** Refresh token cookie helpers — access tokens are never stored in cookies. */

export const TENANT_REFRESH_COOKIE = "refresh_token";
export const SUPERADMIN_REFRESH_COOKIE = "superadmin_refresh_token";

export function refreshCookieOptions() {
  const secure = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure,
    sameSite: "strict",
    path: "/",
    domain: process.env.COOKIE_DOMAIN || undefined,
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
