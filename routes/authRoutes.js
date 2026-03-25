import express from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";

import User from "../models/User.js";
import Session from "../models/Session.js";
import { verifyPassword } from "../services/password.js";
import {
  getAccessTtlSeconds,
  getRefreshTtlSeconds,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "../services/jwt.js";
import { sha256 } from "../services/security.js";
import { prepareResponseMsg } from "../utils/helper.js";
import { requireAuth } from "../middlewares/auth.js";
import { requireDb } from "../utils/db-state.js";

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 60_000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
});

const loginSchema = z.object({
  email: z
    .string()
    .email()
    .transform((v) => v.toLowerCase().trim()),
  password: z.string().min(6).max(200),
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

router.post("/admin/login", requireDb, loginLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .send(prepareResponseMsg({ issues: parsed.error.issues }, false, "Validation failed", 400));
  }

  const { email, password } = parsed.data;
  const user = await User.findOne({ email, role: "SUPER_ADMIN" });
  if (!user) {
    return res.status(401).send(prepareResponseMsg({}, false, "Invalid credentials", 401));
  }

  if (user.lockUntil && user.lockUntil > new Date()) {
    return res.status(423).send(prepareResponseMsg({}, false, "Account temporarily locked", 423));
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
    return res.status(401).send(prepareResponseMsg({}, false, "Invalid credentials", 401));
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
        { user: { id: user._id, email: user.email, role: user.role } },
        true,
        "Logged in",
        200
      )
    );
});

router.post("/tenant/login", requireDb, loginLimiter, async (req, res) => {
  if (!req.tenant) {
    return res.status(400).send(prepareResponseMsg({}, false, "Tenant context required", 400));
  }

  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .send(prepareResponseMsg({ issues: parsed.error.issues }, false, "Validation failed", 400));
  }

  const { email, password } = parsed.data;
  const user = await User.findOne({ email, tenantId: req.tenant._id });
  if (!user) return res.status(401).send(prepareResponseMsg({}, false, "Invalid credentials", 401));

  if (user.lockUntil && user.lockUntil > new Date()) {
    return res.status(423).send(prepareResponseMsg({}, false, "Account temporarily locked", 423));
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
    return res.status(401).send(prepareResponseMsg({}, false, "Invalid credentials", 401));
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
  return res
    .status(200)
    .send(
      prepareResponseMsg(
        { user: { id: user._id, email: user.email, role: user.role } },
        true,
        "Logged in",
        200
      )
    );
});

router.post("/refresh", requireDb, async (req, res) => {
  const token = req.cookies?.refresh_token;
  if (!token) return res.status(401).send(prepareResponseMsg({}, false, "Unauthorized", 401));

  let decoded;
  try {
    decoded = verifyRefreshToken(token);
  } catch {
    clearAuthCookies(req, res);
    return res.status(401).send(prepareResponseMsg({}, false, "Unauthorized", 401));
  }

  const session = await Session.findById(decoded.sid);
  if (!session || session.revokedAt || session.expiresAt < new Date()) {
    clearAuthCookies(req, res);
    return res.status(401).send(prepareResponseMsg({}, false, "Unauthorized", 401));
  }

  if (session.refreshTokenHash !== sha256(token)) {
    await Session.updateOne(
      { _id: session._id },
      { $set: { revokedAt: new Date(), revokedReason: "token_mismatch" } }
    );
    clearAuthCookies(req, res);
    return res.status(401).send(prepareResponseMsg({}, false, "Unauthorized", 401));
  }

  const user = await User.findById(session.userId);
  if (!user || user.status !== "ACTIVE") {
    clearAuthCookies(req, res);
    return res.status(401).send(prepareResponseMsg({}, false, "Unauthorized", 401));
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
  return res.status(200).send(prepareResponseMsg({ ok: true }, true, "Refreshed", 200));
});

router.post("/logout", requireDb, async (req, res) => {
  const token = req.cookies?.refresh_token;
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
    prepareResponseMsg(
      {
        id: req.user._id,
        email: req.user.email,
        role: req.user.role,
        tenantId: req.user.tenantId,
      },
      true,
      "OK",
      200
    )
  );
});

export default router;
