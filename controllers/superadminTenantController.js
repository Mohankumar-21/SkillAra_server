import mongoose from "mongoose";



import Tenant from "../models/Tenant.js";

import User from "../models/User.js";

import { getPlanById } from "../services/planService.js";
import { getOrganizationTypeById } from "../services/platformMasterService.js";

import logger from "../core/logger.js";
import { hashPassword } from "../services/password.js";

import { sendTenantAdminWelcomeEmail, sendTenantAdminPasswordResetEmail } from "../services/emailService.js";

import { prepareResponseMsg, sendError } from "../utils/helper.js";

import { toPublicUser } from "../utils/user.js";

import { writeAuditLog } from "../services/auditLog.js";

import { generateTemporaryPassword } from "../utils/tempPassword.js";

import { buildTenantLoginUrl } from "../utils/tenantLoginUrl.js";

import { normalizeTenantForApi } from "../utils/tenantMapper.js";

import { seedNewTenantDefaults } from "../services/tenantSeedService.js";
import { getTenantRoleBySlug } from "../services/roleService.js";
import {
  buildBrandingKey,
  getPublicUrl,
  putObject,
  isStorageConfigured,
} from "../services/storageService.js";

const SUBDOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;



function readBranding(body) {

  const branding = body?.branding || {};

  return {

    welcome_message: String(branding.welcome_message || "").trim(),

    primary_color: branding.primary_color || "#4F46E5",

    secondary_color: branding.secondary_color || "#7C3AED",

  };

}



function subscriptionEndDate(plan, startDate, isTrial = true) {
  const end = new Date(startDate);
  if (isTrial) {
    const days = Number(plan?.trialDays ?? 14);
    end.setDate(end.getDate() + days);
    return end;
  }
  if (plan?.billingCycle === "yearly") {
    end.setFullYear(end.getFullYear() + 1);
  } else {
    end.setMonth(end.getMonth() + 1);
  }
  return end;
}



/**

 * POST /api/superadmin/tenants

 * Creates tenant + first tenant_admin with a temporary password emailed to the owner.

 */

export async function createTenantWithAdmin(req, res, next) {

  const session = await mongoose.startSession();



  try {

    const body = req.body || {};

    const name = String(body.name || body.tenant_name || "").trim();

    const subdomain = String(body.subdomain || body.sub_domain || "")

      .toLowerCase()

      .trim();

    const contactEmail = String(body.email || body.contactEmail || "")

      .toLowerCase()

      .trim();

    const adminBlock = body.admin || {};

    const adminEmail = String(adminBlock.email || body.adminEmail || contactEmail)

      .toLowerCase()

      .trim();

    const adminName = String(adminBlock.name || `${body.owner_first || ""} ${body.owner_last || ""}`.trim()).trim();

    const adminPhone = String(adminBlock.phone || body.owner_phone || body.phone || "").trim();

    const planId = body.planId ? String(body.planId).trim() : null;
    const orgTypeId = body.orgTypeId ? String(body.orgTypeId).trim() : null;

    const active = body.status !== false;



    if (!name || name.length < 2) {

      return sendError(res, "GENERAL_VALIDATION_FAILED", 400, {

        detail: "Organization name is required.",

      });

    }



    if (!subdomain || subdomain.length < 3 || subdomain.length > 15 || !SUBDOMAIN_RE.test(subdomain) || /--/.test(subdomain)) {

      return sendError(res, "TENANT_SUBDOMAIN_INVALID", 400);

    }



    if (!adminEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
      return sendError(res, "VALIDATION_EMAIL_INVALID", 400);
    }

    if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
      return sendError(res, "VALIDATION_EMAIL_INVALID", 400);
    }

    const rootDomain = process.env.ROOT_DOMAIN || "skillara.com";
    const domain = String(body.domain || `${subdomain}.${rootDomain}`).trim().toLowerCase();
    const tenantEmail = (contactEmail || adminEmail).toLowerCase();

    /**
     * Email rules on tenant create:
     * 1) Tenant contact email — unique across Tenant.email
     * 2) Owner User email — unique per tenant only (same email allowed in other tenants)
     * 3) Subdomain / domain — unique
     */
    const subdomainConflict = await Tenant.findOne({
      $or: [{ subdomain }, { sub_domain: subdomain }, { domain }],
    });
    if (subdomainConflict) {
      return sendError(res, "TENANT_SUBDOMAIN_TAKEN", 409);
    }

    const contactEmailConflict = await Tenant.findOne({ email: tenantEmail });
    if (contactEmailConflict) {
      return sendError(res, "TENANT_EMAIL_IN_USE", 409, {
        detail: "Organization contact email must be unique across all organizations.",
        email: tenantEmail,
      });
    }

    // Owner email may already exist as a User in another tenant — allowed (workspace-scoped login).
    // Only block if that email is already another org's Tenant contact email AND differs from
    // this org's contact (rare mismatch: owner email taken as someone else's billing contact).
    if (adminEmail !== tenantEmail) {
      const ownerAsOtherTenantContact = await Tenant.findOne({ email: adminEmail });
      if (ownerAsOtherTenantContact) {
        const conflictName =
          ownerAsOtherTenantContact.name ||
          ownerAsOtherTenantContact.tenant_name ||
          ownerAsOtherTenantContact.subdomain ||
          ownerAsOtherTenantContact.sub_domain ||
          "another organization";
        return sendError(res, "TENANT_OWNER_EMAIL_IN_USE", 409, {
          detail: `Owner email is already the contact email for "${conflictName}". Use the same email as this org's contact, or a different owner email.`,
          email: adminEmail,
          conflictTenant: conflictName,
        });
      }
    }

    // Informational: same person can own multiple orgs; no block on cross-tenant User email.



    let planDoc = null;

    let planLabel = String(body.plan || "trial").trim() || "trial";

    let subscriptionStatus = "TRIAL";



    if (planId) {

      planDoc = await getPlanById(planId);

      if (!planDoc || planDoc.isActive !== true) {

        return sendError(res, "PLAN_INVALID", 400);

      }

      planLabel = planDoc.name;

      subscriptionStatus = planDoc.name === "FREE" ? "TRIAL" : "ACTIVE";

    }



    let orgTypeDoc = null;
    let orgTypeLabel = String(body.org_type || body.orgType || "").trim();

    if (orgTypeId) {
      orgTypeDoc = await getOrganizationTypeById(orgTypeId);
      if (!orgTypeDoc) {
        return sendError(res, "ORG_TYPE_NOT_FOUND", 400);
      }
      orgTypeLabel = orgTypeDoc.name;
    } else if (orgTypeLabel) {
      return sendError(res, "ORG_TYPE_REQUIRED", 400, {
        detail: "Organization type id is required.",
      });
    }



    const subscriptionStartDate = new Date();

    const subscriptionEndDateValue = planDoc
      ? subscriptionEndDate(planDoc, subscriptionStartDate, subscriptionStatus === "TRIAL")
      : null;



    let logoUrl = body.logo ?? null;
    if (logoUrl && String(logoUrl).startsWith("data:image/") && isStorageConfigured()) {
      try {
        const matches = String(logoUrl).match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
        if (matches) {
          const mimeType = matches[1];
          const buffer = Buffer.from(matches[2], "base64");
          const key = buildBrandingKey({
            tenantId: subdomain,
            type: "logo",
            filename: "logo",
            mimeType,
          });
          await putObject({ key, body: buffer, mimeType, cacheControl: "public, max-age=31536000, immutable" });
          logoUrl = getPublicUrl(key);
        }
      } catch (err) {
        logger.warn(`Failed to upload logo to B2 during tenant create: ${err.message}`);
      }
    }

    const temporaryPassword = generateTemporaryPassword();

    try {
      session.startTransaction();
    } catch (txErr) {
      logger.warn(`[tenant:create] Could not start transaction (standalone DB?): ${txErr.message}`);
    }

    const sessionOpt = session && session.inTransaction() ? { session } : {};

    const [tenant] = await Tenant.create(
      [
        {
          name,
          subdomain,
          domain,
          email: contactEmail || adminEmail,
          phone: String(body.phone || "").trim(),
          orgType: orgTypeLabel,
          orgTypeId: orgTypeDoc?._id || null,
          industry: String(body.industry || "").trim(),
          website: String(body.website || "").trim(),
          country: String(body.country || "").trim(),
          timezone: String(body.timezone || "").trim(),
          currency: String(body.currency || "").trim(),
          logo: logoUrl,
          branding: readBranding(body),
          plan: planLabel,
          planId: planDoc?._id || null,
          subscriptionStatus,
          subscriptionStartDate,
          subscriptionEndDate: subscriptionEndDateValue,
          user_count: 1,
          status: active ? "active" : "suspended",
        },
      ],
      sessionOpt
    );

    await seedNewTenantDefaults(tenant._id, sessionOpt);
    const ownerRole = await getTenantRoleBySlug(tenant._id, "organization-owner", sessionOpt);
    if (!ownerRole?._id) {
      if (session && session.inTransaction()) {
        await session.abortTransaction();
      }
      return sendError(res, "GENERAL_UNKNOWN", 500, {
        detail: "Failed to provision the organization owner role. Please try again.",
      });
    }

    const passwordHash = await hashPassword(temporaryPassword);

    const [adminUser] = await User.create(
      [
        {
          tenantId: tenant._id,
          name: adminName || `${name} Admin`,
          email: adminEmail,
          phone: adminPhone,
          passwordHash,
          roleId: ownerRole._id,
          status: "active",
          isDefaultPassword: true,
          isTenantAdmin: true,
        },
      ],
      sessionOpt
    );

    if (session && session.inTransaction()) {
      await session.commitTransaction();
    }

    const loginUrl = buildTenantLoginUrl(subdomain);
    const sendWelcomeEmail = body.sendWelcomeEmail !== false;

    if (sendWelcomeEmail) {
      // Dispatch email asynchronously in background so org creation responds instantly (<200ms)
      sendTenantAdminWelcomeEmail({
        to: adminEmail,
        tenantName: name,
        adminName: adminName || adminEmail,
        loginUrl,
        temporaryPassword,
      })
        .then((result) => {
          if (!result.sent) {
            logger.info("[tenant-admin:credentials] Email not delivered via SMTP", {
              adminEmail,
              loginUrl,
              temporaryPassword,
              mode: result.mode,
              error: result.error || null,
            });
          }
        })
        .catch((err) => {
          logger.error("[tenant-admin:credentials] Welcome email background error", {
            adminEmail,
            error: err.message,
          });
        });
    }

    await writeAuditLog({
      actorId: req.user?.id,
      actorType: "superadmin",
      action: "tenant.created",
      targetId: tenant._id,
      tenantId: tenant._id,
      ip: req.ip,
      metadata: {
        subdomain: tenant.subdomain,
        adminEmail,
        sendWelcomeEmail,
      },
    });

    const populated = tenant.toObject();

    return res.status(201).send(
      prepareResponseMsg(
        {
          tenant: normalizeTenantForApi(populated, planLabel),
          tenantAdmin: toPublicUser(adminUser),
          tenantAdminUser: toPublicUser(adminUser),
          loginUrl,
          temporaryPassword,
        },
        true,
        "Organization created successfully. Temporary credentials generated.",
        201
      )
    );

  } catch (err) {
    if (session && session.inTransaction()) {
      try {
        await session.abortTransaction();
      } catch {
        // ignore secondary abort error
      }
    }
    return next(err);
  } finally {
    session.endSession();
  }

}

/**
 * POST /api/superadmin/tenants/:tenantId/reset-admin-password
 * Issues a new temporary password for the tenant's primary admin.
 */
export async function resetTenantAdminPassword(req, res, next) {
  try {
    const tenant = await Tenant.findById(req.params.tenantId);
    if (!tenant) {
      return sendError(res, "TENANT_NOT_FOUND", 404);
    }

    const adminUser = await User.findOne({ tenantId: tenant._id, isTenantAdmin: true });
    if (!adminUser) {
      return sendError(res, "USER_NOT_FOUND", 404);
    }

    const temporaryPassword = generateTemporaryPassword();
    adminUser.passwordHash = await hashPassword(temporaryPassword);
    adminUser.isDefaultPassword = true;
    adminUser.status = "active";
    await adminUser.save();

    const subdomain = tenant.subdomain || tenant.sub_domain;
    const loginUrl = buildTenantLoginUrl(subdomain);
    const tenantName = tenant.name || tenant.tenant_name || subdomain;

    sendTenantAdminPasswordResetEmail({
      to: adminUser.email,
      tenantName,
      adminName: adminUser.name || adminUser.email,
      loginUrl,
      temporaryPassword,
    })
      .then((result) => {
        if (!result.sent) {
          logger.info("[tenant-admin:reset-password] Reset email not delivered via SMTP", {
            adminEmail: adminUser.email,
            loginUrl,
            temporaryPassword,
            mode: result.mode,
            error: result.error || null,
          });
        }
      })
      .catch((err) => {
        logger.error("[tenant-admin:reset-password] Reset email background error", {
          adminEmail: adminUser.email,
          error: err.message,
        });
      });

    return res.status(200).send(
      prepareResponseMsg(
        {
          email: adminUser.email,
          loginUrl,
          temporaryPassword,
        },
        true,
        "New temporary password generated and reset email dispatched to the organization owner.",
        200
      )
    );
  } catch (err) {
    return next(err);
  }
}

