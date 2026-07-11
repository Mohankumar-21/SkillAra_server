import mongoose from "mongoose";
import { sendError } from "./helper.js";

export function isDbReady() {
  return mongoose.connection.readyState === 1;
}

export function requireDb(req, res, next) {
  if (isDbReady()) return next();
  return sendError(res, "DB_UNAVAILABLE", 503);
}
