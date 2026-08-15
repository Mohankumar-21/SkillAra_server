import logger from "../core/logger.js";

import { getErrorMessage } from "./errorMessages.js";

import { prepareResponseMsg } from "./helper.js";

import { normalizeError } from "./appError.js";

import httpStatus from "http-status";



export const errorHandler = (err, req, res, next) => {
  if (process.env.NODE_ENV === "production") {
    logger.error(err?.message || err);
  } else {
    logger.error(err);
  }

  let { statusCode, errorKey, errorMessage, data } = normalizeError(err);

  /**
   * Unexpected 5xx failures are masked so internals never reach the client.
   * Operational errors (AppError, and the dependency-outage keys normalizeError
   * produces) carry curated messages and keep their own status — otherwise a
   * deliberate 503 "storage unavailable" would surface as an opaque 500.
   */
  const isOperational =
    Boolean(err?.isOperational) || errorKey === "DB_UNAVAILABLE";

  if (!isOperational && statusCode >= 500) {
    statusCode = httpStatus.INTERNAL_SERVER_ERROR;
    errorKey = "GENERAL_UNKNOWN";
    errorMessage = getErrorMessage(errorKey);
    data = {};
  }

  res.locals.errorMessage = errorMessage;

  const resp = prepareResponseMsg(data, false, errorKey, statusCode);
  resp.message.errorKey = errorKey || resp.message.errorKey;
  resp.message.errorMessage = errorMessage;

  res.status(statusCode).send(resp);
};

