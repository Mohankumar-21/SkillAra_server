import User from "../models/User.js";
import SuperAdmin, { LEGACY_PLATFORM_CONFIG_EMAIL } from "../models/SuperAdmin.js";
import { verifyAccessToken as verifyNewAccessToken } from "../utils/tokens.js";
import { verifyAccessToken as verifyLegacyAccessToken } from "../services/jwt.js";
import { sendError } from "../utils/helper.js";

function claimsToUser(decoded) {
  return {
    id: String(decoded.sub),
    tenantId: decoded.tenant_id ? String(decoded.tenant_id) : null,
    role: decoded.role,
    type: decoded.type,
  };
}

async function validateNewTokenClaims(decoded) {
  if (decoded.type === "tenant_user") {
    const user = await User.findById(decoded.sub).select("status tenantId role");
    if (!user || user.status !== "active") return false;
    if (String(user.tenantId) !== String(decoded.tenant_id)) return false;
    return true;
  }

  if (decoded.type === "superadmin") {
    const admin = await SuperAdmin.findById(decoded.sub).select("status email");
    return Boolean(admin && admin.status === "active" && admin.email !== LEGACY_PLATFORM_CONFIG_EMAIL);
  }

  return false;
}

/**
 * Verify Bearer access token (never cookies). Attaches req.user = { id, tenantId, role, type }.
 */
export async function authenticate(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : null;

  if (!token) {
    return sendError(res, "GENERAL_UNAUTHORIZED", 401);
  }

  try {
    const decoded = verifyNewAccessToken(token);
    if (!(await validateNewTokenClaims(decoded))) {
      return sendError(res, "GENERAL_UNAUTHORIZED", 401);
    }
    req.user = claimsToUser(decoded);
    return next();
  } catch {
    return sendError(res, "AUTH_SESSION_EXPIRED", 401);
  }
}

/** Same as authenticate but continues when no/invalid token (for public routes with optional auth). */
export async function optionalAuthenticate(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : null;

  if (!token) {
    return next();
  }

  try {
    const decoded = verifyNewAccessToken(token);
    if (await validateNewTokenClaims(decoded)) {
      req.user = claimsToUser(decoded);
    }
  } catch {
    // ignore invalid optional token
  }

  return next();
}

/**
 * Legacy compatibility — supports old HS256 tokens and full User documents on req.user.
 * Prefer authenticate() for new RS256 tokens.
 */
export async function authenticateLegacy(req, res, next) {
  const header = req.headers.authorization || "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : null;
  const cookieToken = req.cookies?.access_token || null;
  const token = bearer || cookieToken;

  if (!token) {
    return sendError(res, "GENERAL_UNAUTHORIZED", 401);
  }

  try {
    const decoded = verifyNewAccessToken(token);
    if (await validateNewTokenClaims(decoded)) {
      req.user = claimsToUser(decoded);
      return next();
    }
  } catch {
    // fall through to legacy token
  }

  try {
    const decoded = verifyLegacyAccessToken(token);
    const user = await User.findById(decoded.sub);
    const activeStatuses = new Set(["ACTIVE", "active"]);
    if (!user || !activeStatuses.has(user.status)) {
      return sendError(res, "GENERAL_UNAUTHORIZED", 401);
    }
    req.user = user;
    return next();
  } catch {
    return sendError(res, "AUTH_SESSION_EXPIRED", 401);
  }
}

export async function optionalAuthenticateLegacy(req, res, next) {
  const header = req.headers.authorization || "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : null;
  const cookieToken = req.cookies?.access_token || null;
  const token = bearer || cookieToken;

  if (!token) {
    return next();
  }

  try {
    const decoded = verifyNewAccessToken(token);
    if (await validateNewTokenClaims(decoded)) {
      req.user = claimsToUser(decoded);
      return next();
    }
  } catch {
    // fall through
  }

  try {
    const decoded = verifyLegacyAccessToken(token);
    const user = await User.findById(decoded.sub);
    const activeStatuses = new Set(["ACTIVE", "active"]);
    if (user && activeStatuses.has(user.status)) {
      req.user = user;
    }
  } catch {
    // ignore
  }

  return next();
}
