import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import cors from "cors";
import cookieParser from "cookie-parser";
import sanitize from "mongo-sanitize";
import path from "path";
import { fileURLToPath } from "url";

import logger from "./core/logger.js";
import { errorHandler } from "./utils/error-handler.js";
import routes from "./routes/index.js";
import { tenantContext } from "./middlewares/tenant-context.js";
import "./cron/studentAnalyticsCron.js"; // Register nightly student analytics cron
import { corsOrigin } from "./utils/cors.js";
import { generalApiLimiter } from "./middleware/rateLimiter.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * CSRF strategy: refresh tokens use httpOnly cookies with SameSite=Strict.
 * That prevents cross-site cookie submission on modern browsers, so we do not
 * add a separate double-submit CSRF token for refresh/logout. State-changing
 * API calls also require a Bearer access token (memory-only on the client),
 * which third-party sites cannot read or attach.
 */
export function createApp() {
  const app = express();
  app.set("trust proxy", 1);

  app.use(helmet());
  app.use(
    cors({
      origin: corsOrigin,
      credentials: true,
      allowedHeaders: ["Content-Type", "Authorization", "X-Tenant-Subdomain"],
    })
  );
  app.use(cookieParser());
  app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "5mb" }));
  app.use(express.urlencoded({ extended: true, limit: process.env.JSON_BODY_LIMIT || "5mb" }));
  app.use((req, _res, next) => {
    if (req.body && typeof req.body === "object") {
      req.body = sanitize(req.body);
    }
    next();
  });

  if (process.env.NODE_ENV === "development") {
    app.use(morgan("dev"));
  }

  app.use("/static", express.static(path.join(__dirname, "public")));
  app.use("/uploads", express.static(path.join(__dirname, "uploads")));
  app.use((req, res, next) => {
    const startTime = Date.now();
    res.on("finish", () => {
      const duration = Date.now() - startTime;
      const message = `${req.method} ${req.originalUrl} ${res.statusCode} - ${duration}ms`;
      if (res.statusCode >= 500) logger.error(message);
      else if (res.statusCode >= 400) logger.warn(message);
      else logger.info(message);
    });
    next();
  });

  app.use(tenantContext);
  app.use("/api", generalApiLimiter);
  app.use("/api", routes);
  app.use(errorHandler);

  return app;
}

export default createApp;
