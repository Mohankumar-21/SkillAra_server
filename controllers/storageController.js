import Tenant from "../models/Tenant.js";
import User from "../models/User.js";
import {
  buildBrandingKey,
  buildUserAvatarKey,
  getPublicUrl,
  putObject,
  isStorageConfigured,
} from "../services/storageService.js";
import { sendError, sendSuccess } from "../utils/helper.js";
import { incrementTenantStorage } from "../middlewares/checkPlanLimits.js";

/**
 * Upload tenant branding logo directly to Backblaze B2 and persist in Tenant doc.
 */
export async function uploadTenantLogo(req, res) {
  try {
    if (!req.file) {
      return sendError(res, "NO_FILE_PROVIDED", 400);
    }
    if (!isStorageConfigured()) {
      return sendError(res, "STORAGE_NOT_CONFIGURED", 503);
    }

    const tenantId = req.tenantId || req.user?.tenantId;
    if (!tenantId) {
      return sendError(res, "TENANT_REQUIRED", 400);
    }

    const key = buildBrandingKey({
      tenantId: String(tenantId),
      type: "logo",
      filename: req.file.originalname,
      mimeType: req.file.mimetype,
    });

    await putObject({
      key,
      body: req.file.buffer,
      mimeType: req.file.mimetype,
      cacheControl: "public, max-age=86400",
    });

    const url = getPublicUrl(key);

    await Tenant.findByIdAndUpdate(tenantId, { logo: url });
    // Track storage usage for plan enforcement
    await incrementTenantStorage(tenantId, req.file.size);

    return sendSuccess(res, "LOGO_UPLOADED", { url, key });
  } catch (err) {
    return sendError(res, err.message || "UPLOAD_FAILED", err.status || 500);
  }
}

/**
 * Upload user profile picture / avatar to Backblaze B2 and persist in User doc.
 */
export async function uploadUserAvatar(req, res) {
  try {
    if (!req.file) {
      return sendError(res, "NO_FILE_PROVIDED", 400);
    }
    if (!isStorageConfigured()) {
      return sendError(res, "STORAGE_NOT_CONFIGURED", 503);
    }

    const tenantId = req.tenantId || req.user?.tenantId;
    const userId = req.params.userId || req.user?._id || req.user?.id;

    if (!tenantId) {
      return sendError(res, "TENANT_REQUIRED", 400);
    }

    const key = buildUserAvatarKey({
      tenantId: String(tenantId),
      userId: String(userId || "temp"),
      filename: req.file.originalname,
      mimeType: req.file.mimetype,
    });

    await putObject({
      key,
      body: req.file.buffer,
      mimeType: req.file.mimetype,
      cacheControl: "public, max-age=86400",
    });

    const url = getPublicUrl(key);

    if (userId && userId !== "temp") {
      await User.findByIdAndUpdate(userId, { profilePhoto: url });
    }
    // Track storage usage for plan enforcement
    await incrementTenantStorage(tenantId, req.file.size);

    return sendSuccess(res, "AVATAR_UPLOADED", { url, key });
  } catch (err) {
    return sendError(res, err.message || "UPLOAD_FAILED", err.status || 500);
  }
}
