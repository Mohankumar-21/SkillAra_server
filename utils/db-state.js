import mongoose from "mongoose";
import { prepareResponseMsg } from "./helper.js";

export function isDbReady() {
  // 1 = connected
  return mongoose.connection.readyState === 1;
}

export function requireDb(req, res, next) {
  if (isDbReady()) return next();
  const resp = prepareResponseMsg(
    {},
    false,
    "Database is not connected. Please check MONGO_URI / network / DNS.",
    503
  );
  return res.status(503).send(resp);
}
