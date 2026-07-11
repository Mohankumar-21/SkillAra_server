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

    const field = Object.keys(err.keyPattern || {})[0] || "";

    const errorKey =

      field.includes("email") || field.includes("sub_domain") || field.includes("domain")

        ? field.includes("email") && !field.includes("sub")

          ? "USER_EMAIL_EXISTS"

          : "TENANT_EXISTS"

        : "GENERAL_VALIDATION_FAILED";

    return {

      statusCode: 409,

      errorKey,

      errorMessage: getErrorMessage(errorKey),

      data: {},

    };

  }



  if (err?.name === "ValidationError") {

    return {

      statusCode: 400,

      errorKey: "GENERAL_VALIDATION_FAILED",

      errorMessage: getErrorMessage("GENERAL_VALIDATION_FAILED"),

      data: {},

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

