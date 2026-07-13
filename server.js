import dotenv from "dotenv";
import connectToDb from "./config/db.js";
import logger from "./core/logger.js";
import { createApp } from "./app.js";
import { seedSuperAdmin } from "./utils/seedSuperAdmin.js";
import { seedDefaultPlans, migrateLegacyPlansCollection } from "./utils/seedPlans.js";
import { seedDefaultOrganizationTypes } from "./services/platformMasterService.js";
import { backfillTenantAdmins } from "./utils/backfillTenantAdmins.js";
import { backfillRolesAndPermissions } from "./utils/backfillRoles.js";
import { syncTenantIndexes } from "./utils/syncTenantIndexes.js";

dotenv.config();

const app = createApp();

if (process.env.NODE_ENV !== "test") {
  connectToDb()
    .then(() => syncTenantIndexes())
    .then(() => seedSuperAdmin())
    .then(() => migrateLegacyPlansCollection())
    .then(() => seedDefaultPlans())
    .then(() => seedDefaultOrganizationTypes())
    .then(() => backfillTenantAdmins())
    .then(() => backfillRolesAndPermissions())
    .catch((err) => logger.error(err));

  const port = process.env.PORT || 5000;
  app.listen(port, "0.0.0.0", () => {
    console.log(`The server is listening on Port ${port} !`);
  });
}

export default app;
