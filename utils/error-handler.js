// errorHandler.js
import logger from "../core/logger.js";
import { prepareResponseMsg } from "./helper.js";
import httpStatus from "http-status";
export const errorHandler = (err, req, res, next) => {
  logger.error(err);
  const { status, statusText } = err ?? {};

  let statusCode = status || 400;
  let message = statusText || "Something went wrong";

  if (process.env.NODE_ENV === "production" && !err.isOperational) {
    statusCode = httpStatus.INTERNAL_SERVER_ERROR;
    message = httpStatus[httpStatus.INTERNAL_SERVER_ERROR];
  }

  res.locals.errorMessage = message;

  const resp = prepareResponseMsg({}, false, message, statusCode);
  res.status(statusCode).send(resp);
};
