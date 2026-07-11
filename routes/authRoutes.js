import express from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";

import User from "../models/User.js";
import Session from "../models/Session.js";
import { resolveTenantFromRequest } from "../utils/resolve-tenant-request.js";
import { verifyPassword } from "../services/password.js";
import {
  getAccessTtlSeconds,
  getRefreshTtlSeconds,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "../services/jwt.js";
import { sha256 } from "../services/security.js";
import { prepareResponseMsg, sendError } from "../utils/helper.js";
import { requireAuth } from "../middlewares/auth.js";
import { requireDb } from "../utils/db-state.js";
import { validationMessageFromZod } from "../utils/errorMessages.js";
import { validateBody } from "../utils/validate.js";
import { changePassword } from "../controllers/userController.js";
import { toPublicUser } from "../utils/user.js";

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 60_000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false },
});

const loginSchema = z.object({
  email: z
    .string()
    .email()
    .transform((v) => v.toLowerCase().trim()),
  password: z.string().min(6).max(200),
});

const registerSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z
    .string()
    .email()
    .transform((v) => v.toLowerCase().trim()),
  password: z.string().min(6).max(200),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(6).max(200),
  newPassword: z.string().min(6).max(200),
});

function cookieOptions(req) {
  const secure = process.env.NODE_ENV === "production";
  const sameSite = secure ? "none" : "lax";
  const domain = process.env.COOKIE_DOMAIN || undefined;
  return {
    httpOnly: true,
    secure,
    sameSite,
    path: "/",
    domain,
  };
}

function setAuthCookies(req, res, { accessToken, refreshToken }) {
  res.cookie("access_token", accessToken, {
    ...cookieOptions(req),
    maxAge: getAccessTtlSeconds() * 1000,
  });
  res.cookie("refresh_token", refreshToken, {
    ...cookieOptions(req),
    maxAge: getRefreshTtlSeconds() * 1000,
  });
}

function clearAuthCookies(req, res) {
  res.clearCookie("access_token", cookieOptions(req));
  res.clearCookie("refresh_token", cookieOptions(req));
}

function requireActiveTenant(req, res, next) {
  if (!req.tenant) {
    return sendError(res, "AUTH_TENANT_REQUIRED", 400);
  }
  if (!req.tenant.status) {
    return sendError(res, "AUTH_TENANT_INACTIVE", 403);
  }
  return next();
}

router.post(
  "/register",
  requireDb,
  (_req, res) => sendError(res, "AUTH_REGISTRATION_CLOSED", 403)
);

router.post(
  "/change-password",
  requireDb,
  requireAuth,
  validateBody(changePasswordSchema),
  changePassword
);

router.post("/admin/login", requireDb, loginLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, "GENERAL_VALIDATION_FAILED", 400, {
      issues: parsed.error.issues,
      detail: validationMessageFromZod(parsed.error),
    });
  }

  const { email, password } = parsed.data;
  const user = await User.findOne({ email, role: "SUPER_ADMIN" });
  if (!user) {
    return sendError(res, "AUTH_INVALID_CREDENTIALS", 401);
  }

  if (user.lockUntil && user.lockUntil > new Date()) {
    return sendError(res, "AUTH_ACCOUNT_LOCKED", 423);
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    const nextAttempts = (user.failedLoginAttempts || 0) + 1;
    const lockAfter = Number(process.env.LOCK_AFTER_ATTEMPTS || 5);
    const lockMinutes = Number(process.env.LOCK_MINUTES || 15);
    const lockUntil =
      nextAttempts >= lockAfter ? new Date(Date.now() + lockMinutes * 60_000) : null;
    await User.updateOne(
      { _id: user._id },
      { $set: { lockUntil }, $inc: { failedLoginAttempts: 1 } }
    );
    return sendError(res, "AUTH_INVALID_CREDENTIALS", 401);
  }

  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        failedLoginAttempts: 0,
        lockUntil: null,
        lastLoginAt: new Date(),
        lastLoginIp: req.ip,
        lastLoginUserAgent: req.get("user-agent") || "",
      },
    }
  );

  const sessionId = new Session({
    userId: user._id,
    tenantId: null,
    refreshTokenHash: "temp",
    ip: req.ip,
    userAgent: req.get("user-agent") || "",
    expiresAt: new Date(Date.now() + getRefreshTtlSeconds() * 1000),
  });
  await sessionId.save();

  const accessToken = signAccessToken({ sub: String(user._id), role: user.role, tenantId: null });
  const refreshToken = signRefreshToken({ sub: String(user._id), sid: String(sessionId._id) });

  await Session.updateOne(
    { _id: sessionId._id },
    { $set: { refreshTokenHash: sha256(refreshToken) } }
  );

  setAuthCookies(req, res, { accessToken, refreshToken });
  return res
    .status(200)
    .send(
      prepareResponseMsg(
        {
          user: toPublicUser(user),
          accessToken,
          refreshToken,
        },
        true,
        "Logged in",
        200
      )
    );
});

const portalHintSchema = z.object({
  email: z
    .string()
    .email()
    .transform((v) => v.toLowerCase().trim()),
});

const ADMIN_PORTAL_ROLES = new Set(["TENANT_ADMIN", "ORG_ADMIN"]);
const WORKSPACE_ROLES = new Set(["TENANT_ADMIN", "ORG_ADMIN", "TUTOR", "STUDENT"]);

function portalForRole(role) {
  return ADMIN_PORTAL_ROLES.has(role) ? "admin" : "learning";
}

async function resolveActiveTenant(req, res) {
  const { subdomain, tenant } = await resolveTenantFromRequest(req);

  if (!subdomain) {
    sendError(res, "AUTH_TENANT_WORKSPACE_REQUIRED", 400);
    return null;
  }

  if (!tenant) {
    sendError(res, "TENANT_NOT_FOUND", 404, { subdomain });
    return null;
  }

  if (tenant.status === false) {
    sendError(res, "AUTH_TENANT_INACTIVE", 403);
    return null;
  }

  req.tenant = tenant;
  return tenant;
}

async function authenticateTenantUser(req, res, { allowedRoles }) {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, "GENERAL_VALIDATION_FAILED", 400, {
      issues: parsed.error.issues,
      detail: validationMessageFromZod(parsed.error),
    });
    return null;
  }

  const { email, password } = parsed.data;
  const user = await User.findOne({ email, tenantId: req.tenant._id });
  if (!user) {
    sendError(res, "AUTH_INVALID_CREDENTIALS", 401);
    return null;
  }

  if (!allowedRoles.has(user.role)) {
    sendError(res, "AUTH_TENANT_PANEL_DENIED", 403);
    return null;
  }

  if (user.status === "DISABLED") {
    sendError(res, "AUTH_ACCOUNT_DISABLED", 403);
    return null;
  }

  if (user.invitationStatus === "BLOCKED") {
    sendError(res, "AUTH_ACCOUNT_BLOCKED", 403);
    return null;
  }

  if (user.lockUntil && user.lockUntil > new Date()) {
    sendError(res, "AUTH_ACCOUNT_LOCKED", 423);
    return null;
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    const nextAttempts = (user.failedLoginAttempts || 0) + 1;
    const lockAfter = Number(process.env.LOCK_AFTER_ATTEMPTS || 5);
    const lockMinutes = Number(process.env.LOCK_MINUTES || 15);
    const lockUntil =
      nextAttempts >= lockAfter ? new Date(Date.now() + lockMinutes * 60_000) : null;
    await User.updateOne(
      { _id: user._id },
      { $set: { lockUntil }, $inc: { failedLoginAttempts: 1 } }
    );
    sendError(res, "AUTH_INVALID_CREDENTIALS", 401);
    return null;
  }

  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        failedLoginAttempts: 0,
        lockUntil: null,
        lastLoginAt: new Date(),
        lastLoginIp: req.ip,
        lastLoginUserAgent: req.get("user-agent") || "",
        ...(user.invitationStatus === "PENDING" ? { invitationStatus: "ACCEPTED" } : {}),
      },
    }
  );

  const session = await Session.create({
    userId: user._id,
    tenantId: req.tenant._id,
    refreshTokenHash: "temp",
    ip: req.ip,
    userAgent: req.get("user-agent") || "",
    expiresAt: new Date(Date.now() + getRefreshTtlSeconds() * 1000),
  });

  const accessToken = signAccessToken({
    sub: String(user._id),
    role: user.role,
    tenantId: String(req.tenant._id),
  });
  const refreshToken = signRefreshToken({ sub: String(user._id), sid: String(session._id) });
  await Session.updateOne(
    { _id: session._id },
    { $set: { refreshTokenHash: sha256(refreshToken) } }
  );

  setAuthCookies(req, res, { accessToken, refreshToken });
  return res.status(200).send(
    prepareResponseMsg(
      {
        user: toPublicUser(user),
        accessToken,
        refreshToken,
        portal: portalForRole(user.role),
      },
      true,
      "Logged in",
      200
    )
  );
}

router.post("/workspace/portal-hint", requireDb, loginLimiter, async (req, res) => {
  const parsed = portalHintSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, "GENERAL_VALIDATION_FAILED", 400, {
      issues: parsed.error.issues,
      detail: validationMessageFromZod(parsed.error),
    });
  }

  const tenant = await resolveActiveTenant(req, res);
  if (!tenant) return undefined;

  const user = await User.findOne({
    email: parsed.data.email,
    tenantId: tenant._id,
  }).select("role");

  if (!user || !WORKSPACE_ROLES.has(user.role)) {
    return res.status(200).send(
      prepareResponseMsg({ portal: null }, true, "OK", 200)
    );
  }

  return res.status(200).send(
    prepareResponseMsg({ portal: portalForRole(user.role) }, true, "OK", 200)
  );
});

router.post("/workspace/login", requireDb, loginLimiter, async (req, res) => {
  const tenant = await resolveActiveTenant(req, res);
  if (!tenant) return undefined;
  return authenticateTenantUser(req, res, { allowedRoles: WORKSPACE_ROLES });
});

router.post("/tenant/login", requireDb, loginLimiter, async (req, res) => {
  const tenant = await resolveActiveTenant(req, res);
  if (!tenant) return undefined;
  return authenticateTenantUser(req, res, { allowedRoles: ADMIN_PORTAL_ROLES });
});

router.post("/refresh", requireDb, async (req, res) => {
  const token = req.body?.refreshToken || req.cookies?.refresh_token;
  if (!token) return sendError(res, "GENERAL_UNAUTHORIZED", 401);

  let decoded;
  try {
    decoded = verifyRefreshToken(token);
  } catch {
    clearAuthCookies(req, res);
    return sendError(res, "AUTH_SESSION_EXPIRED", 401);
  }

  const session = await Session.findById(decoded.sid);
  if (!session || session.revokedAt || session.expiresAt < new Date()) {
    clearAuthCookies(req, res);
    return sendError(res, "AUTH_SESSION_EXPIRED", 401);
  }

  if (session.refreshTokenHash !== sha256(token)) {
    await Session.updateOne(
      { _id: session._id },
      { $set: { revokedAt: new Date(), revokedReason: "token_mismatch" } }
    );
    clearAuthCookies(req, res);
    return sendError(res, "AUTH_SESSION_EXPIRED", 401);
  }

  const user = await User.findById(session.userId);
  if (!user || user.status !== "ACTIVE") {
    clearAuthCookies(req, res);
    return sendError(res, "AUTH_SESSION_EXPIRED", 401);
  }

  const accessToken = signAccessToken({
    sub: String(user._id),
    role: user.role,
    tenantId: user.role === "SUPER_ADMIN" ? null : String(user.tenantId),
  });

  // rotate refresh token
  const refreshToken = signRefreshToken({ sub: String(user._id), sid: String(session._id) });
  await Session.updateOne(
    { _id: session._id },
    { $set: { refreshTokenHash: sha256(refreshToken) } }
  );

  setAuthCookies(req, res, { accessToken, refreshToken });
  return res
    .status(200)
    .send(prepareResponseMsg({ accessToken, refreshToken }, true, "Refreshed", 200));
});

router.post("/logout", requireDb, async (req, res) => {
  const token = req.body?.refreshToken || req.cookies?.refresh_token;
  if (token) {
    try {
      const decoded = verifyRefreshToken(token);
      await Session.updateOne(
        { _id: decoded.sid },
        { $set: { revokedAt: new Date(), revokedReason: "logout" } }
      );
    } catch {
      // ignore
    }
  }
  clearAuthCookies(req, res);
  return res.status(200).send(prepareResponseMsg({ ok: true }, true, "Logged out", 200));
});

router.post("/logout-all", requireDb, requireAuth, async (req, res) => {
  await Session.updateMany(
    { userId: req.user._id, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: "logout_all" } }
  );
  clearAuthCookies(req, res);
  return res
    .status(200)
    .send(prepareResponseMsg({ ok: true }, true, "Logged out from all devices", 200));
});

router.get("/me", requireDb, requireAuth, async (req, res) => {
  return res.status(200).send(
    prepareResponseMsg(toPublicUser(req.user), true, "OK", 200)
  );
});

export default router;
