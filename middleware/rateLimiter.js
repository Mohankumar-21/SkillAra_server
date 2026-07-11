import rateLimit, { ipKeyGenerator } from "express-rate-limit";

const baseOptions = {
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false },
};

const rateLimitResponse = {
  status: false,
  data: {},
  message: {
    message: "",
    errorMessage: "Too many requests. Please try again later.",
    errorKey: "AUTH_RATE_LIMITED",
    code: 429,
  },
  pagination: { totalPages: 0, totalRecords: 0 },
};

function loginKeyGenerator(req) {
  const ip = ipKeyGenerator(req.ip || req.socket?.remoteAddress || "unknown");
  const email = String(req.body?.email || "")
    .toLowerCase()
    .trim();
  return `${ip}:${email || "unknown"}`;
}

function noopMiddleware(_req, _res, next) {
  return next();
}

const loginLimiterOptions = {
  ...baseOptions,
  windowMs: 15 * 60 * 1000,
  limit: process.env.NODE_ENV === "development" ? 100 : 5,
  keyGenerator: loginKeyGenerator,
  message: {
    ...rateLimitResponse,
    message: {
      ...rateLimitResponse.message,
      errorMessage: "Too many login attempts. Please try again later.",
    },
  },
};

/** 5 attempts / 15 min per IP + email (tenant login). */
export const tenantLoginLimiter =
  process.env.NODE_ENV === "test" ? noopMiddleware : rateLimit(loginLimiterOptions);

/** 5 attempts / 15 min per IP + email (superadmin login + MFA verify). */
export const superadminLoginLimiter =
  process.env.NODE_ENV === "test" ? noopMiddleware : rateLimit(loginLimiterOptions);

/** General API limiter for /api routes. */
export const generalApiLimiter =
  process.env.NODE_ENV === "test"
    ? noopMiddleware
    : rateLimit({
        ...baseOptions,
        windowMs: 60 * 1000,
        limit: 120,
        message: rateLimitResponse,
      });
