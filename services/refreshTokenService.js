import RefreshToken from "../models/RefreshToken.js";
import {
  generateRefreshToken,
  getRefreshTtlSeconds,
  getSessionRefreshTtlSeconds,
  hashToken,
} from "../utils/tokens.js";

export async function createRefreshTokenRecord({
  userId,
  tenantId,
  userType,
  rememberMe = true,
}) {
  const rawToken = generateRefreshToken();
  const tokenHash = hashToken(rawToken);
  const persistent = rememberMe !== false;
  const ttlSeconds = persistent ? getRefreshTtlSeconds() : getSessionRefreshTtlSeconds();
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  await RefreshToken.create({
    tokenHash,
    userId,
    tenantId: tenantId ?? null,
    userType,
    expiresAt,
    rememberMe: persistent,
  });

  return rawToken;
}

export async function revokeAllRefreshTokens({ userId, userType }) {
  await RefreshToken.updateMany(
    { userId, userType, revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );
}

/**
 * Validate and rotate a refresh token.
 * Reuse of a revoked token revokes the entire session family for that user.
 */
export async function rotateRefreshToken(rawToken, userType) {
  const tokenHash = hashToken(rawToken);
  const record = await RefreshToken.findOne({ tokenHash, userType });

  if (!record) {
    return { ok: false, reason: "not_found" };
  }

  if (record.revokedAt) {
    await revokeAllRefreshTokens({ userId: record.userId, userType: record.userType });
    return { ok: false, reason: "reuse_detected" };
  }

  if (record.expiresAt < new Date()) {
    await RefreshToken.updateOne({ _id: record._id }, { $set: { revokedAt: new Date() } });
    return { ok: false, reason: "expired" };
  }

  await RefreshToken.updateOne({ _id: record._id }, { $set: { revokedAt: new Date() } });

  const newRawToken = await createRefreshTokenRecord({
    userId: record.userId,
    tenantId: record.tenantId,
    userType,
    rememberMe: record.rememberMe !== false,
  });

  return {
    ok: true,
    refreshToken: newRawToken,
    userId: record.userId,
    tenantId: record.tenantId,
    rememberMe: record.rememberMe !== false,
  };
}

export async function revokeRefreshToken(rawToken, userType) {
  const tokenHash = hashToken(rawToken);
  await RefreshToken.updateOne(
    { tokenHash, userType, revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );
}
