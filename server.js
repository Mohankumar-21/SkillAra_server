import express from "express";
import dotenv from "dotenv";
import helmet from "helmet";
import morgan from "morgan";
import cors from "cors";
import cookieParser from "cookie-parser";
import sanitize from "mongo-sanitize";

import connectToDb from "./config/db.js";
import logger from "./core/logger.js";
import path from "path";
import { errorHandler } from "./utils/error-handler.js";
import { prepareResponseMsg } from "./utils/helper.js";
import { fileURLToPath } from "url";
import routes from "./routes/index.js";
import { tenantContext } from "./middlewares/tenant-context.js";
import { seedSuperAdmin } from "./utils/seedSuperAdmin.js";
import { seedDefaultPlans } from "./utils/seedPlans.js";
import { corsOrigin } from "./utils/cors.js";

// Fix __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config();

// Initialize app
const app = express();
// Trust first proxy hop only (avoids permissive trust proxy with rate limiting).
app.set("trust proxy", 1);

// Connect Database
connectToDb()
  .then(() => seedSuperAdmin())
  .then(() => seedDefaultPlans())
  .catch((err) => logger.error(err));

// Middleware
app.use(helmet());
app.use(
  cors({
    origin: corsOrigin,
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization", "X-Tenant-Subdomain"],
  })
);
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use((req, _res, next) => {
  // NoSQL injection hardening for request body.
  // Express 5: req.query is read-only — do not assign to it.
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
    if (res.statusCode >= 500) {
      logger.error(message);
    } else if (res.statusCode >= 400) {
      logger.warn(message);
    } else {
      logger.info(message);
    }
  });
  next();
});

app.use(tenantContext);
app.use("/api", routes);
app.use(errorHandler);

// // Catch unmatched API routes
// app.use("/api/*", (req, res) => {
//   const resp = prepareResponseMsg({}, false, "API endpoint not found", 404);
//   res.status(404).send(resp);
// });

// // Catch other unmatched routes (optional)
// app.use((req, res) => {
//   const resp = prepareResponseMsg({}, false, "Page not found", 404);
//   res.status(404).send(resp);
// });
const port = process.env.PORT || 5000;
app.listen(port, "0.0.0.0", () => {
  console.log(`The server is listening on Port ${port} !`);
});

export default app;
