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

  if (!err?.isOperational || statusCode >= 500) {
    statusCode = statusCode >= 500 ? httpStatus.INTERNAL_SERVER_ERROR : statusCode;
    if (statusCode >= 500) {
      errorKey = errorKey === "DB_UNAVAILABLE" ? "DB_UNAVAILABLE" : "GENERAL_UNKNOWN";
      errorMessage = getErrorMessage(errorKey);
      data = {};
    }
  }

  res.locals.errorMessage = errorMessage;

  const resp = prepareResponseMsg(data, false, errorKey, statusCode);
  resp.message.errorKey = errorKey || resp.message.errorKey;
  resp.message.errorMessage = errorMessage;

  res.status(statusCode).send(resp);
};

