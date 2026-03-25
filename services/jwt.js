import jwt from "jsonwebtoken";

const ACCESS_TTL_SECONDS = 15 * 60; // 15 minutes
const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

export function getTokenConfig() {
  const accessSecret = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET;
  const refreshSecret = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET;
  if (!accessSecret || !refreshSecret) {
    throw Object.assign(new Error("JWT secrets are not configured"), { status: 500 });
  }
  return { accessSecret, refreshSecret };
}

export function signAccessToken(payload) {
  const { accessSecret } = getTokenConfig();
  return jwt.sign(payload, accessSecret, { expiresIn: ACCESS_TTL_SECONDS });
}

export function signRefreshToken(payload) {
  const { refreshSecret } = getTokenConfig();
  return jwt.sign(payload, refreshSecret, { expiresIn: REFRESH_TTL_SECONDS });
}

export function verifyAccessToken(token) {
  const { accessSecret } = getTokenConfig();
  return jwt.verify(token, accessSecret);
}

export function verifyRefreshToken(token) {
  const { refreshSecret } = getTokenConfig();
  return jwt.verify(token, refreshSecret);
}

export function getAccessTtlSeconds() {
  return ACCESS_TTL_SECONDS;
}

export function getRefreshTtlSeconds() {
  return REFRESH_TTL_SECONDS;
}
