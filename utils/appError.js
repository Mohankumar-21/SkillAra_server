import { getErrorMessage, isErrorKey } from "./errorMessages.js";



export class AppError extends Error {

  /**

   * @param {string} errorKey - key from errorMessages.js

   * @param {number} [statusCode=400]

   * @param {object} [data={}]

   */

  constructor(errorKey, statusCode = 400, data = {}) {

    super(getErrorMessage(errorKey));

    this.name = "AppError";

    this.errorKey = errorKey;

    this.statusCode = statusCode;

    this.data = data;

    this.isOperational = true;

  }

}



/** @param {unknown} err */

export function normalizeError(err) {

  if (err instanceof AppError) {

    return {

      statusCode: err.statusCode,

      errorKey: err.errorKey,

      errorMessage: getErrorMessage(err.errorKey),

      data: err.data,

    };

  }



  if (err?.code === 11000) {
    const keyPattern = err.keyPattern || {};
    const fields = Object.keys(keyPattern);
    const field = fields.join(" ");

    let errorKey = "GENERAL_VALIDATION_FAILED";
    if (fields.includes("subdomain") || fields.includes("sub_domain")) {
      errorKey = "TENANT_SUBDOMAIN_TAKEN";
    } else if (fields.includes("email") && fields.includes("tenantId")) {
      errorKey = "USER_EMAIL_EXISTS";
    } else if (fields.includes("email")) {
      errorKey = "TENANT_EMAIL_IN_USE";
    } else if (fields.includes("domain")) {
      errorKey = "TENANT_EXISTS";
    }

    return {
      statusCode: 409,
      errorKey,
      errorMessage: getErrorMessage(errorKey),
      data: { fields },
    };
  }



  if (err?.name === "ValidationError") {
    const details = Object.values(err.errors || {})
      .map((e) => e?.message)
      .filter(Boolean);
    return {
      statusCode: 400,
      errorKey: "GENERAL_VALIDATION_FAILED",
      errorMessage: details[0] || getErrorMessage("GENERAL_VALIDATION_FAILED"),
      data: { detail: details[0] || undefined, issues: details },
    };
  }

  if (
    err?.type === "entity.too.large" ||
    err?.status === 413 ||
    /request entity too large/i.test(String(err?.message || ""))
  ) {
    return {
      statusCode: 413,
      errorKey: "GENERAL_VALIDATION_FAILED",
      errorMessage: "Upload is too large. Use a smaller logo (under 2MB) and try again.",
      data: { detail: "Upload is too large. Use a smaller logo (under 2MB) and try again." },
    };
  }



  if (err?.name === "CastError") {

    return {

      statusCode: 400,

      errorKey: "GENERAL_NOT_FOUND",

      errorMessage: getErrorMessage("GENERAL_NOT_FOUND"),

      data: {},

    };

  }



  if (

    err?.name === "MongoServerError" ||

    err?.name === "MongoNetworkError" ||

    err?.name === "MongoTimeoutError" ||

    /mongo/i.test(String(err?.message || ""))

  ) {

    return {

      statusCode: 503,

      errorKey: "DB_UNAVAILABLE",

      errorMessage: getErrorMessage("DB_UNAVAILABLE"),

      data: {},

    };

  }



  if (err?.name === "JsonWebTokenError" || err?.name === "TokenExpiredError") {

    return {

      statusCode: 401,

      errorKey: "AUTH_SESSION_EXPIRED",

      errorMessage: getErrorMessage("AUTH_SESSION_EXPIRED"),

      data: {},

    };

  }



  const msg = err?.message;

  if (typeof msg === "string" && isErrorKey(msg)) {

    return {

      statusCode: err.statusCode || 400,

      errorKey: msg,

      errorMessage: getErrorMessage(msg),

      data: err.data || {},

    };

  }



  return {

    statusCode: err?.statusCode || err?.status || 500,

    errorKey: "GENERAL_UNKNOWN",

    errorMessage: getErrorMessage("GENERAL_UNKNOWN"),

    data: {},

  };

}

