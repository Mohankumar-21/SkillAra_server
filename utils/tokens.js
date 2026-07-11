import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import jwt from "jsonwebtoken";

const ACCESS_TTL_SECONDS = 15 * 60; // 15 minutes
const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days — remember-me sessions
const SESSION_REFRESH_TTL_SECONDS = 24 * 60 * 60; // 24 hours — non-remember sessions
const INVITE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const MFA_CHALLENGE_TTL_SECONDS = 5 * 60; // 5 minutes

const ALLOWED_ALGORITHMS = ["RS256"];
const TENANT_USER_CLAIMS = new Set(["sub", "tenant_id", "role", "type"]);
const SUPERADMIN_CLAIMS = new Set(["sub", "role", "type"]);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KEYS_DIR = path.join(__dirname, "..", ".keys");
const PRIVATE_KEY_PATH = path.join(KEYS_DIR, "private.pem");
const PUBLIC_KEY_PATH = path.join(KEYS_DIR, "public.pem");

let cachedKeys = null;

function normalizePemFromEnv(value) {
  if (!value) return "";
  return value.includes("\\n") ? value.replace(/\\n/g, "\n") : value;
}

/**
 * Generate an RSA keypair for local development when env keys are not set.
 * Keys are written to SkillAra_server/.keys/ (gitignored).
 */
export function generateKeysIfMissing() {
  if (!fs.existsSync(KEYS_DIR)) {
    fs.mkdirSync(KEYS_DIR, { recursive: true, mode: 0o700 });
  }

  if (!fs.existsSync(PRIVATE_KEY_PATH) || !fs.existsSync(PUBLIC_KEY_PATH)) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    fs.writeFileSync(PRIVATE_KEY_PATH, privateKey, { mode: 0o600 });
    fs.writeFileSync(PUBLIC_KEY_PATH, publicKey, { mode: 0o644 });
  }

  return {
    privateKey: fs.readFileSync(PRIVATE_KEY_PATH, "utf8"),
    publicKey: fs.readFileSync(PUBLIC_KEY_PATH, "utf8"),
  };
}

function loadKeys() {
  if (cachedKeys) return cachedKeys;

  const envPrivate = normalizePemFromEnv(process.env.PRIVATE_KEY);
  const envPublic = normalizePemFromEnv(process.env.PUBLIC_KEY);

  if (envPrivate && envPublic) {
    cachedKeys = { privateKey: envPrivate, publicKey: envPublic };
    return cachedKeys;
  }

  if (process.env.NODE_ENV === "production") {
    throw Object.assign(new Error("PRIVATE_KEY and PUBLIC_KEY must be set in production"), {
      status: 500,
    });
  }

  cachedKeys = generateKeysIfMissing();
  return cachedKeys;
}

function sanitizePayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw Object.assign(new Error("Invalid token payload"), { status: 500 });
  }

  const type = payload.type;
  if (type === "tenant_user") {
    const allowed = TENANT_USER_CLAIMS;
    for (const key of Object.keys(payload)) {
      if (!allowed.has(key)) {
        throw Object.assign(new Error(`Disallowed JWT claim: ${key}`), { status: 500 });
      }
    }
    if (!payload.sub || !payload.tenant_id || !payload.role) {
      throw Object.assign(new Error("tenant_user token requires sub, tenant_id, and role"), {
        status: 500,
      });
    }
    return {
      sub: String(payload.sub),
      tenant_id: String(payload.tenant_id),
      role: String(payload.role),
      type: "tenant_user",
    };
  }

  if (type === "superadmin") {
    const allowed = SUPERADMIN_CLAIMS;
    for (const key of Object.keys(payload)) {
      if (!allowed.has(key)) {
        throw Object.assign(new Error(`Disallowed JWT claim: ${key}`), { status: 500 });
      }
    }
    if (!payload.sub) {
      throw Object.assign(new Error("superadmin token requires sub"), { status: 500 });
    }
    return {
      sub: String(payload.sub),
      role: "superadmin",
      type: "superadmin",
    };
  }

  throw Object.assign(new Error("JWT payload type must be tenant_user or superadmin"), {
    status: 500,
  });
}

/**
 * Sign a short-lived access token (15 min). Payload must not contain PII beyond sub/tenant_id/role.
 *
 * Tenant user: { sub, tenant_id, role, type: 'tenant_user' }
 * Superadmin:  { sub, role: 'superadmin', type: 'superadmin' }
 */
export function signAccessToken(payload) {
  const { privateKey } = loadKeys();
  const claims = sanitizePayload(payload);
  return jwt.sign(claims, privateKey, {
    algorithm: "RS256",
    expiresIn: ACCESS_TTL_SECONDS,
  });
}

/**
 * Verify access token signature and algorithm. Rejects HS256, alg:none, and other algorithms.
 */
export function verifyAccessToken(token) {
  const { publicKey } = loadKeys();
  return jwt.verify(token, publicKey, { algorithms: ALLOWED_ALGORITHMS });
}

/** SHA-256 hash of a refresh token (store this in RefreshToken.tokenHash). */
export function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

/** Cryptographically random 64-byte refresh token (128 hex chars). Return to client; store hash only. */
export function generateRefreshToken() {
  return crypto.randomBytes(64).toString("hex");
}

export function getAccessTtlSeconds() {
  return ACCESS_TTL_SECONDS;
}

export function getRefreshTtlSeconds() {
  return REFRESH_TTL_SECONDS;
}

export function getSessionRefreshTtlSeconds() {
  return SESSION_REFRESH_TTL_SECONDS;
}

/** Reset cached keys (useful in tests). */
export function resetKeyCache() {
  cachedKeys = null;
}

const INVITE_CLAIMS = new Set(["sub", "tenant_id", "type"]);
const MFA_CHALLENGE_CLAIMS = new Set(["sub", "type"]);

function sanitizeInvitePayload(payload) {
  for (const key of Object.keys(payload)) {
    if (!INVITE_CLAIMS.has(key)) {
      throw Object.assign(new Error(`Disallowed invite JWT claim: ${key}`), { status: 500 });
    }
  }
  if (!payload.sub || !payload.tenant_id) {
    throw Object.assign(new Error("invite token requires sub and tenant_id"), { status: 500 });
  }
  return {
    sub: String(payload.sub),
    tenant_id: String(payload.tenant_id),
    type: "invite",
  };
}

function sanitizeMfaChallengePayload(payload) {
  for (const key of Object.keys(payload)) {
    if (!MFA_CHALLENGE_CLAIMS.has(key)) {
      throw Object.assign(new Error(`Disallowed MFA JWT claim: ${key}`), { status: 500 });
    }
  }
  if (!payload.sub) {
    throw Object.assign(new Error("MFA challenge token requires sub"), { status: 500 });
  }
  return { sub: String(payload.sub), type: "mfa_challenge" };
}

/** Short-lived invite token for invite-based registration (Task 5 issues these). */
export function signInviteToken(payload) {
  const { privateKey } = loadKeys();
  const claims = sanitizeInvitePayload({ ...payload, type: "invite" });
  return jwt.sign(claims, privateKey, {
    algorithm: "RS256",
    expiresIn: INVITE_TTL_SECONDS,
  });
}

export function verifyInviteToken(token) {
  const { publicKey } = loadKeys();
  const decoded = jwt.verify(token, publicKey, { algorithms: ALLOWED_ALGORITHMS });
  if (decoded.type !== "invite") {
    throw Object.assign(new Error("Invalid invite token type"), { status: 401 });
  }
  return decoded;
}

/** Temporary token between password check and MFA verification for superadmin login. */
export function signMfaChallengeToken(payload) {
  const { privateKey } = loadKeys();
  const claims = sanitizeMfaChallengePayload({ ...payload, type: "mfa_challenge" });
  return jwt.sign(claims, privateKey, {
    algorithm: "RS256",
    expiresIn: MFA_CHALLENGE_TTL_SECONDS,
  });
}

export function verifyMfaChallengeToken(token) {
  const { publicKey } = loadKeys();
  const decoded = jwt.verify(token, publicKey, { algorithms: ALLOWED_ALGORITHMS });
  if (decoded.type !== "mfa_challenge") {
    throw Object.assign(new Error("Invalid MFA challenge token type"), { status: 401 });
  }
  return decoded;
}
