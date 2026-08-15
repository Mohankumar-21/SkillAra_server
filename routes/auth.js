import express from "express";
import { z } from "zod";

import logger from "../core/logger.js";
import User from "../models/User.js";
import Tenant from "../models/Tenant.js";
import { verifyPassword, hashPassword } from "../services/password.js";
import {
  createRefreshTokenRecord,
  revokeRefreshToken,
  rotateRefreshToken,
} from "../services/refreshTokenService.js";
import {
  getRefreshTtlSeconds,
  signAccessToken,
  verifyInviteToken,
} from "../utils/tokens.js";
import {
  clearRefreshCookie,
  setRefreshCookie,
  TENANT_REFRESH_COOKIE,
} from "../utils/authCookies.js";
import { prepareResponseMsg, sendError } from "../utils/helper.js";
import { requireDb } from "../utils/db-state.js";
import { validationMessageFromZod } from "../utils/errorMessages.js";
import { tenantLoginLimiter } from "../middleware/rateLimiter.js";
import { resolveTenantFromSubdomain } from "../middleware/resolveTenantFromSubdomain.js";
import { authenticate } from "../middleware/authenticate.js";
import { requireTenantUser } from "../middleware/requireTenantUser.js";
import { toPublicUsers, userHasDefaultPassword } from "../utils/user.js";
import { getAccessTokenRoleForUser, getTenantRoleBySlug } from "../services/roleService.js";

const router = express.Router();

const loginSchema = z.object({
  email: z
    .string()
    .email()
    .transform((v) => v.toLowerCase().trim()),
  password: z
    .string()
    .min(6)
    .max(200)
    .transform((v) => v.trim()),
});

const registerSchema = z.object({
  inviteToken: z.string().min(10),
  password: z.string().min(6).max(200),
});

const signupSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z
    .string()
    .email()
    .transform((v) => v.toLowerCase().trim()),
  password: z.string().min(8).max(200),
});

const setInitialPasswordSchema = z.object({
  currentPassword: z.string().min(6).max(200),
  newPassword: z.string().min(8).max(200),
});

function invalidCredentials(res) {
  return sendError(res, "AUTH_INVALID_CREDENTIALS", 401);
}

/**
 * POST /api/auth/login
 * Access token in JSON body; refresh token in httpOnly cookie only.
 */
router.post("/login", requireDb, tenantLoginLimiter, resolveTenantFromSubdomain, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, "GENERAL_VALIDATION_FAILED", 400, {
      issues: parsed.error.issues,
      detail: validationMessageFromZod(parsed.error),
    });
  }

  const { email, password } = parsed.data;
  const user = await User.findOne({ email, tenantId: req.resolvedTenant._id });
  if (!user) {
    if (process.env.NODE_ENV !== "production") {
      logger.warn("[auth:login] No user for tenant/email", {
        email,
        subdomain: req.resolvedTenant?.subdomain,
        tenantId: String(req.resolvedTenant?._id),
      });
    }
    return invalidCredentials(res);
  }

  if (user.status === "disabled" || user.status === "DISABLED") {
    return invalidCredentials(res);
  }

  if (user.status === "invited" || user.status === "INVITED") {
    return sendError(res, "AUTH_INVITE_PENDING", 403);
  }

  if (!user.passwordHash) {
    if (process.env.NODE_ENV !== "production") {
      logger.warn("[auth:login] User has no password hash", { email, userId: String(user._id) });
    }
    return invalidCredentials(res);
  }

  const passwordOk = await verifyPassword(password, user.passwordHash);
  if (!passwordOk) {
    if (process.env.NODE_ENV !== "production") {
      logger.warn("[auth:login] Password mismatch", {
        email,
        subdomain: req.resolvedTenant?.subdomain,
      });
    }
    return invalidCredentials(res);
  }

  const accessToken = signAccessToken({
    sub: String(user._id),
    tenant_id: String(req.resolvedTenant._id),
    role: await getAccessTokenRoleForUser(user),
    type: "tenant_user",
  });

  const refreshToken = await createRefreshTokenRecord({
    userId: user._id,
    tenantId: req.resolvedTenant._id,
    userType: "tenant_user",
  });

  setRefreshCookie(res, TENANT_REFRESH_COOKIE, refreshToken, getRefreshTtlSeconds());

  const [publicUser] = await toPublicUsers([user], req.resolvedTenant._id, {
    includePermissions: true,
  });

  return res.status(200).send(
    prepareResponseMsg(
      {
        accessToken,
        user: publicUser,
        isDefaultPassword: userHasDefaultPassword(user),
      },
      true,
      userHasDefaultPassword(user) ? "Set a new password to continue" : "Logged in",
      200
    )
  );
});

/**
 * POST /api/auth/refresh
 * Rotates refresh token; reissues access token in JSON body.
 */
router.post("/refresh", requireDb, async (req, res) => {
  const rawToken = req.cookies?.[TENANT_REFRESH_COOKIE];
  if (!rawToken) {
    clearRefreshCookie(res, TENANT_REFRESH_COOKIE);
    return sendError(res, "AUTH_SESSION_EXPIRED", 401);
  }

  const rotation = await rotateRefreshToken(rawToken, "tenant_user");
  if (!rotation.ok) {
    clearRefreshCookie(res, TENANT_REFRESH_COOKIE);
    return sendError(res, "AUTH_SESSION_EXPIRED", 401);
  }

  const user = await User.findById(rotation.userId);
  if (!user || user.status !== "active") {
    clearRefreshCookie(res, TENANT_REFRESH_COOKIE);
    return sendError(res, "AUTH_SESSION_EXPIRED", 401);
  }

  const accessToken = signAccessToken({
    sub: String(user._id),
    tenant_id: String(user.tenantId),
    role: await getAccessTokenRoleForUser(user),
    type: "tenant_user",
  });

  setRefreshCookie(res, TENANT_REFRESH_COOKIE, rotation.refreshToken, getRefreshTtlSeconds());

  return res.status(200).send(
    prepareResponseMsg({ accessToken }, true, "Refreshed", 200)
  );
});

/**
 * POST /api/auth/logout
 */
router.post("/logout", requireDb, async (req, res) => {
  const rawToken = req.cookies?.[TENANT_REFRESH_COOKIE];
  if (rawToken) {
    await revokeRefreshToken(rawToken, "tenant_user");
  }
  clearRefreshCookie(res, TENANT_REFRESH_COOKIE);
  return res.status(200).send(prepareResponseMsg({ ok: true }, true, "Logged out", 200));
});

/**
 * POST /api/auth/register
 * Invite-only — completes signup for users created with status `invited`.
 */
router.post("/register", requireDb, tenantLoginLimiter, async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, "GENERAL_VALIDATION_FAILED", 400, {
      issues: parsed.error.issues,
      detail: validationMessageFromZod(parsed.error),
    });
  }

  let inviteClaims;
  try {
    inviteClaims = verifyInviteToken(parsed.data.inviteToken);
  } catch {
    return sendError(res, "AUTH_INVITE_INVALID", 400);
  }

  const user = await User.findOne({
    _id: inviteClaims.sub,
    tenantId: inviteClaims.tenant_id,
    status: "invited",
  });

  if (!user) {
    return sendError(res, "AUTH_INVITE_INVALID", 400);
  }

  user.passwordHash = await hashPassword(parsed.data.password);
  user.status = "active";
  user.isDefaultPassword = false;
  await user.save();

  const [publicUser] = await toPublicUsers([user], user.tenantId, { includePermissions: true });

  return res.status(200).send(
    prepareResponseMsg(
      { user: publicUser },
      true,
      "Registration complete. You can now log in.",
      200
    )
  );
});

/**
 * POST /api/auth/signup
 * Open self-registration for learners on a tenant subdomain.
 *
 * This is the second of two enrolment paths. Students who sign up here land with the
 * Student role and enrol themselves in courses; students an admin adds are created
 * (and optionally auto-enrolled) through /api/users and /api/enrollments/bulk instead.
 *
 * The role is hard-coded to "student" — this endpoint can never mint staff accounts,
 * regardless of what the request body contains.
 */
router.post(
  "/signup",
  requireDb,
  tenantLoginLimiter,
  resolveTenantFromSubdomain,
  async (req, res) => {
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(res, "GENERAL_VALIDATION_FAILED", 400, {
        issues: parsed.error.issues,
        detail: validationMessageFromZod(parsed.error),
      });
    }

    const tenant = req.resolvedTenant;
    if (!tenant) {
      return sendError(res, "AUTH_TENANT_WORKSPACE_REQUIRED", 400);
    }
    if (tenant.status !== "active") {
      return sendError(res, "AUTH_TENANT_INACTIVE", 403);
    }
    if (tenant.allowStudentSignup === false) {
      return sendError(res, "AUTH_REGISTRATION_CLOSED", 403);
    }

    const { name, email, password } = parsed.data;

    const existing = await User.findOne({ tenantId: tenant._id, email });
    if (existing) {
      // An invited-but-unclaimed account must finish via the invite link, otherwise
      // anyone knowing the address could take it over.
      if (existing.status === "invited") {
        return sendError(res, "AUTH_INVITE_PENDING", 409);
      }
      return sendError(res, "USER_EMAIL_EXISTS", 409);
    }

    const studentRole = await getTenantRoleBySlug(tenant._id, "student");
    if (!studentRole) {
      logger.error(`[auth:signup] tenant ${tenant._id} has no student role seeded`);
      return sendError(res, "GENERAL_SERVICE_UNAVAILABLE", 503);
    }

    const user = await User.create({
      tenantId: tenant._id,
      name,
      email,
      passwordHash: await hashPassword(password),
      roleId: studentRole._id,
      status: "active",
      isDefaultPassword: false,
      isTenantAdmin: false,
    });

    await Tenant.updateOne({ _id: tenant._id }, { $inc: { user_count: 1 } });

    // Sign the new learner straight in — no second login step after signing up.
    const accessToken = signAccessToken({
      sub: String(user._id),
      tenant_id: String(tenant._id),
      role: await getAccessTokenRoleForUser(user),
      type: "tenant_user",
    });

    const refreshToken = await createRefreshTokenRecord({
      userId: user._id,
      tenantId: tenant._id,
      userType: "tenant_user",
    });
    setRefreshCookie(res, TENANT_REFRESH_COOKIE, refreshToken, getRefreshTtlSeconds());

    const [publicUser] = await toPublicUsers([user], tenant._id, { includePermissions: true });

    return res
      .status(201)
      .send(
        prepareResponseMsg({ accessToken, user: publicUser }, true, "Welcome to SkillAra", 201)
      );
  }
);

router.get("/me", requireDb, authenticate, requireTenantUser, async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user || user.status !== "active") {
    return sendError(res, "GENERAL_UNAUTHORIZED", 401);
  }
  const [publicUser] = await toPublicUsers([user], user.tenantId, { includePermissions: true });
  return res.status(200).send(prepareResponseMsg({ user: publicUser }, true, "OK", 200));
});

/**
 * POST /api/auth/set-initial-password
 * First-login password change after temporary admin password.
 */
router.post("/set-initial-password", requireDb, authenticate, requireTenantUser, async (req, res) => {
  const parsed = setInitialPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, "GENERAL_VALIDATION_FAILED", 400, {
      issues: parsed.error.issues,
      detail: validationMessageFromZod(parsed.error),
    });
  }

  const user = await User.findById(req.user.id);
  if (!user || user.status !== "active") {
    return sendError(res, "GENERAL_UNAUTHORIZED", 401);
  }

  if (!userHasDefaultPassword(user)) {
    return sendError(res, "GENERAL_FORBIDDEN", 403, {
      detail: "Password change is not required for this account.",
    });
  }

  const currentOk = await verifyPassword(parsed.data.currentPassword, user.passwordHash);
  if (!currentOk) {
    return sendError(res, "AUTH_PASSWORD_INCORRECT", 401);
  }

  if (parsed.data.currentPassword === parsed.data.newPassword) {
    return sendError(res, "GENERAL_VALIDATION_FAILED", 400, {
      detail: "New password must be different from the temporary password.",
    });
  }

  user.passwordHash = await hashPassword(parsed.data.newPassword);
  user.isDefaultPassword = false;
  await user.save();

  const [publicUser] = await toPublicUsers([user], user.tenantId, { includePermissions: true });

  return res.status(200).send(
    prepareResponseMsg(
      { user: publicUser, ok: true },
      true,
      "Password updated successfully",
      200
    )
  );
});

export default router;
