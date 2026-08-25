import express from "express";
import { uploadImage } from "../middlewares/upload.js";
import { uploadTenantLogo, uploadUserAvatar } from "../controllers/storageController.js";
import { requireAuth, requireRole, requireTenant } from "../middlewares/auth.js";
import { checkPlanLimits } from "../middlewares/checkPlanLimits.js";
import { requireDb } from "../utils/db-state.js";

const router = express.Router();

// Upload tenant branding logo (Backblaze B2)
router.post(
  "/branding/logo",
  requireDb,
  requireAuth,
  requireRole("TENANT_ADMIN", "ORG_ADMIN"),
  requireTenant,
  checkPlanLimits({ resource: "storage" }),
  uploadImage.single("file"),
  uploadTenantLogo
);

// Upload user profile photo / avatar (Backblaze B2)
router.post(
  "/users/avatar",
  requireDb,
  requireAuth,
  requireTenant,
  checkPlanLimits({ resource: "storage" }),
  uploadImage.single("file"),
  uploadUserAvatar
);

// Upload specific user's avatar by admin
router.post(
  "/users/:userId/avatar",
  requireDb,
  requireAuth,
  requireRole("TENANT_ADMIN", "ORG_ADMIN"),
  requireTenant,
  checkPlanLimits({ resource: "storage" }),
  uploadImage.single("file"),
  uploadUserAvatar
);

export default router;
