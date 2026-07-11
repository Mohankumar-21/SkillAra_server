import { z } from "zod";
import { sendError } from "./helper.js";
import { validationMessageFromZod } from "./errorMessages.js";

/**
 * Express middleware — validates req.body with a Zod schema.
 * Returns a user-friendly validation message from errorMessages.
 */
export function validateBody(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(res, "GENERAL_VALIDATION_FAILED", 400, {
        issues: parsed.error.issues,
        detail: validationMessageFromZod(parsed.error),
      });
    }
    req.body = parsed.data;
    return next();
  };
}
