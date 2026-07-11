import { isErrorKey, isUserFacingMessage, sanitizeClientMessage } from "./errorMessages.js";

export const prepareResponseMsg = (data, status, msg, statusCode, limit = 0, totalCount = 0) => {
  const responseObject = {
    status: status,
    data: data ?? {},
    message: {
      message: "",
      errorMessage: "",
      errorKey: "",
      code: statusCode,
    },
    pagination: {
      totalPages: limit ? Math.ceil(totalCount / Number(limit)) : 0,
      totalRecords: totalCount,
    },
  };

  if (status) {
    responseObject.message.message = msg;
  } else {
    const errorKey = isErrorKey(msg) ? msg : "";
    responseObject.message.errorKey = errorKey;
    responseObject.message.errorMessage = sanitizeClientMessage(msg);
  }

  return responseObject;
};

/**
 * Send a standardized error response using an error key from errorMessages.js
 * @param {import("express").Response} res
 * @param {string} errorKey
 * @param {number} [statusCode=400]
 * @param {object} [data={}]
 */
export function sendError(res, errorKey, statusCode = 400, data = {}) {
  const resp = prepareResponseMsg(data, false, errorKey, statusCode);
  if (data.detail && isUserFacingMessage(data.detail)) {
    resp.message.errorMessage = String(data.detail).trim();
  }
  return res.status(statusCode).send(resp);
}

/**
 * @param {import("express").Response} res
 * @param {string} message
 * @param {object} [data={}]
 * @param {number} [statusCode=200]
 */
export function sendSuccess(res, message, data = {}, statusCode = 200) {
  return res.status(statusCode).send(prepareResponseMsg(data, true, message, statusCode));
}
