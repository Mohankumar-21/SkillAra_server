import express from "express";
import { z } from "zod";

import SuperAdmin from "../models/SuperAdmin.js";
import { verifyPassword } from "../services/password.js";
import { verifyTotpCode } from "../services/mfa.js";
import {
  createRefreshTokenRecord,
  revokeRefreshToken,
  rotateRefreshToken,
} from "../services/refreshTokenService.js";
import {
  getRefreshTtlSeconds,
  signAccessToken,
  signMfaChallengeToken,
  verifyMfaChallengeToken,
} from "../utils/tokens.js";
import {
  clearRefreshCookie,
  setRefreshCookie,
  SUPERADMIN_REFRESH_COOKIE,
} from "../utils/authCookies.js";
import { prepareResponseMsg, sendError } from "../utils/helper.js";
import { requireDb } from "../utils/db-state.js";
import { validationMessageFromZod } from "../utils/errorMessages.js";
import { superadminLoginLimiter } from "../middleware/rateLimiter.js";
import { authenticate } from "../middleware/authenticate.js";
import { requireSuperadmin } from "../middleware/requireSuperadmin.js";
import { writeAuditLog } from "../services/auditLog.js";

const router = express.Router();

const loginSchema = z.object({
  email: z
    .string()
    .email()
    .transform((v) => v.toLowerCase().trim()),
  password: z.string().min(6).max(200),
  rememberMe: z.boolean().optional().default(true),
});

const verifyMfaSchema = z.object({
  mfaToken: z.string().min(10),
  code: z.string().min(6).max(8),
  rememberMe: z.boolean().optional().default(true),
});

function refreshCookieMaxAge(rememberMe) {
  return rememberMe !== false ? getRefreshTtlSeconds() : null;
}

function invalidCredentials(res) {
  return sendError(res, "AUTH_INVALID_CREDENTIALS", 401);
}

function toPublicSuperAdmin(admin) {
  if (!admin) return null;
  const doc = admin.toObject ? admin.toObject() : admin;
  return {
    id: doc._id,
    email: doc.email,
    role: "superadmin",
    mfaEnabled: Boolean(doc.mfaEnabled),
    status: doc.status,
    lastLoginAt: doc.lastLoginAt,
    createdAt: doc.createdAt,
  };
}

async function issueSuperadminSession(req, res, admin, rememberMe = true) {
  await SuperAdmin.updateOne({ _id: admin._id }, { $set: { lastLoginAt: new Date() } });

  const accessToken = signAccessToken({
    sub: String(admin._id),
    role: "superadmin",
    type: "superadmin",
  });

  const refreshToken = await createRefreshTokenRecord({
    userId: admin._id,
    tenantId: null,
    userType: "superadmin",
    rememberMe,
  });

  setRefreshCookie(
    res,
    SUPERADMIN_REFRESH_COOKIE,
    refreshToken,
    refreshCookieMaxAge(rememberMe)
  );

  await writeAuditLog({
    actorId: admin._id,
    actorType: "superadmin",
    action: "superadmin.login",
    ip: req.ip,
  });

  return res.status(200).send(
    prepareResponseMsg(
      {
        accessToken,
        user: toPublicSuperAdmin(admin),
      },
      true,
      "Logged in",
      200
    )
  );
}

/**
 * POST /api/superadmin/auth/login
 * When MFA is enabled, returns mfaRequired + mfaToken instead of session tokens.
 */
router.post("/login", requireDb, superadminLoginLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, "GENERAL_VALIDATION_FAILED", 400, {
      issues: parsed.error.issues,
      detail: validationMessageFromZod(parsed.error),
    });
  }

  const { email, password, rememberMe } = parsed.data;
  const admin = await SuperAdmin.findOne({ email }).select("+mfaSecret");
  if (!admin) {
    return invalidCredentials(res);
  }

  if (admin.status !== "active") {
    return invalidCredentials(res);
  }

  const passwordOk = await verifyPassword(password, admin.passwordHash);
  if (!passwordOk) {
    return invalidCredentials(res);
  }

  if (admin.mfaEnabled) {
    const mfaToken = signMfaChallengeToken({ sub: String(admin._id) });
    return res.status(200).send(
      prepareResponseMsg(
        { mfaRequired: true, mfaToken },
        true,
        "MFA verification required",
        200
      )
    );
  }

  return issueSuperadminSession(req, res, admin, rememberMe);
});

/**
 * POST /api/superadmin/auth/verify-mfa
 * Second step after login when mfaEnabled is true.
 */
router.post("/verify-mfa", requireDb, superadminLoginLimiter, async (req, res) => {
  const parsed = verifyMfaSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, "GENERAL_VALIDATION_FAILED", 400, {
      issues: parsed.error.issues,
      detail: validationMessageFromZod(parsed.error),
    });
  }

  let challenge;
  try {
    challenge = verifyMfaChallengeToken(parsed.data.mfaToken);
  } catch {
    return sendError(res, "AUTH_MFA_INVALID", 401);
  }

  const admin = await SuperAdmin.findById(challenge.sub).select("+mfaSecret");
  if (!admin || admin.status !== "active" || !admin.mfaEnabled) {
    return sendError(res, "AUTH_MFA_INVALID", 401);
  }

  const codeValid = await verifyTotpCode(admin.mfaSecret, parsed.data.code);
  if (!codeValid) {
    return sendError(res, "AUTH_MFA_INVALID", 401);
  }

  return issueSuperadminSession(req, res, admin, parsed.data.rememberMe);
});

router.post("/refresh", requireDb, async (req, res) => {
  const rawToken = req.cookies?.[SUPERADMIN_REFRESH_COOKIE];
  if (!rawToken) {
    clearRefreshCookie(res, SUPERADMIN_REFRESH_COOKIE);
    return sendError(res, "AUTH_SESSION_EXPIRED", 401);
  }

  const rotation = await rotateRefreshToken(rawToken, "superadmin");
  if (!rotation.ok) {
    clearRefreshCookie(res, SUPERADMIN_REFRESH_COOKIE);
    return sendError(res, "AUTH_SESSION_EXPIRED", 401);
  }

  const admin = await SuperAdmin.findById(rotation.userId);
  if (!admin || admin.status !== "active") {
    clearRefreshCookie(res, SUPERADMIN_REFRESH_COOKIE);
    return sendError(res, "AUTH_SESSION_EXPIRED", 401);
  }

  const accessToken = signAccessToken({
    sub: String(admin._id),
    role: "superadmin",
    type: "superadmin",
  });

  setRefreshCookie(
    res,
    SUPERADMIN_REFRESH_COOKIE,
    rotation.refreshToken,
    refreshCookieMaxAge(rotation.rememberMe)
  );

  return res.status(200).send(
    prepareResponseMsg({ accessToken }, true, "Refreshed", 200)
  );
});

router.post("/logout", requireDb, async (req, res) => {
  const rawToken = req.cookies?.[SUPERADMIN_REFRESH_COOKIE];
  if (rawToken) {
    await revokeRefreshToken(rawToken, "superadmin");
  }
  clearRefreshCookie(res, SUPERADMIN_REFRESH_COOKIE);
  return res.status(200).send(prepareResponseMsg({ ok: true }, true, "Logged out", 200));
});

router.get("/me", requireDb, authenticate, requireSuperadmin, async (req, res) => {
  const admin = await SuperAdmin.findById(req.user.id);
  if (!admin || admin.status !== "active") {
    return sendError(res, "GENERAL_UNAUTHORIZED", 401);
  }
  return res.status(200).send(
    prepareResponseMsg({ user: toPublicSuperAdmin(admin) }, true, "OK", 200)
  );
});

export default router;
