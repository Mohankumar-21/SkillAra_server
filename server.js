import dotenv from "dotenv";
import http from "http";
import connectToDb from "./config/db.js";
import logger from "./core/logger.js";
import { createApp } from "./app.js";
import { seedSuperAdmin } from "./utils/seedSuperAdmin.js";
import { seedDefaultPlans, migrateLegacyPlansCollection } from "./utils/seedPlans.js";
import { seedDefaultOrganizationTypes } from "./services/platformMasterService.js";
import { backfillTenantAdmins } from "./utils/backfillTenantAdmins.js";
import { backfillRolesAndPermissions } from "./utils/backfillRoles.js";
import { syncTenantIndexes } from "./utils/syncTenantIndexes.js";
import { attachSignaling } from "./services/webrtcSignaling.js";
import { attachMentorshipChat } from "./services/mentorshipChatSocket.js";

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

  const httpServer = http.createServer(app);
  attachSignaling(httpServer);
  attachMentorshipChat(httpServer);

  const port = process.env.PORT || 5000;
  httpServer.listen(port, "0.0.0.0", () => {
    console.log(`The server is listening on Port ${port} !`);
    console.log(`WebRTC signaling is listening on /socket.io/webrtc`);
    console.log("Mentorship chat is listening on /socket.io/mentorship-chat");
  });
}

export default app;
