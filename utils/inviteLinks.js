/**
 * Build tenant workspace signup URL for invite completion.
 */
export function buildInviteSignupUrl(subdomain, inviteToken) {
  const encodedToken = encodeURIComponent(inviteToken);
  const rootDomain = (process.env.ROOT_DOMAIN || "localhost").toLowerCase();
  const clientPort = process.env.CLIENT_APP_PORT || "5173";

  if (rootDomain === "localhost") {
    const base = process.env.CLIENT_APP_URL || `http://${subdomain}.localhost:${clientPort}`;
    const origin = base.includes("://")
      ? base.replace(/\/$/, "")
      : `http://${subdomain}.localhost:${clientPort}`;
    return `${origin}/register?inviteToken=${encodedToken}`;
  }

  const protocol = process.env.CLIENT_APP_PROTOCOL || "https";
  const host = `${subdomain}.${rootDomain}`;
  return `${protocol}://${host}/register?inviteToken=${encodedToken}`;
}
