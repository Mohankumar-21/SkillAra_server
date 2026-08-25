import mongoose from "mongoose";



import Tenant from "../models/Tenant.js";

import User from "../models/User.js";

import { getPlanById } from "../services/planService.js";
import { getOrganizationTypeById } from "../services/platformMasterService.js";

import logger from "../core/logger.js";
import { hashPassword } from "../services/password.js";

import { sendTenantAdminWelcomeEmail } from "../services/emailService.js";

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



function subscriptionEndDate(plan, startDate) {

  const end = new Date(startDate);

  if (plan?.billingCycle === "monthly") {

    end.setMonth(end.getMonth() + 1);

  } else if (plan?.billingCycle === "yearly") {

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

      ? subscriptionEndDate(planDoc, subscriptionStartDate)

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

    session.startTransaction();

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

      { session }

    );



    await seedNewTenantDefaults(tenant._id, { session });
    const ownerRole = await getTenantRoleBySlug(tenant._id, "organization-owner", { session });
    if (!ownerRole?._id) {
      await session.abortTransaction();
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

      { session }

    );



    await session.commitTransaction();



    const loginUrl = buildTenantLoginUrl(subdomain);
    const sendWelcomeEmail = body.sendWelcomeEmail !== false;
    let emailResult = { sent: false, mode: "skipped" };

    if (sendWelcomeEmail) {
      emailResult = await sendTenantAdminWelcomeEmail({
        to: adminEmail,
        tenantName: name,
        adminName: adminName || adminEmail,
        loginUrl,
        temporaryPassword,
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
        welcomeEmailSent: emailResult.sent === true,
        welcomeEmailMode: emailResult.mode || null,
      },
    });

    if (sendWelcomeEmail && !emailResult.sent) {
      logger.info("[tenant-admin:credentials] Email not sent — share with owner manually", {
        adminEmail,
        loginUrl,
        temporaryPassword,
        mode: emailResult.mode,
        error: emailResult.error || null,
      });
    }

    const populated = tenant.toObject();

    const emailFailed = sendWelcomeEmail && emailResult.sent !== true;
    const successMessage = !sendWelcomeEmail
      ? "Organization created. Welcome email was skipped."
      : emailResult.sent
        ? "Organization created. A welcome email with a temporary password was sent to the owner."
        : emailResult.mode === "misconfigured" || emailResult.mode === "log"
          ? "Organization created. Welcome email was not sent — configure SMTP_HOST, SMTP_USER, and SMTP_PASS on the server."
          : "Organization created. Welcome email could not be sent — check SMTP settings and server logs.";

    return res.status(201).send(
      prepareResponseMsg(
        {
          tenant: normalizeTenantForApi(populated, planLabel),
          tenantAdmin: toPublicUser(adminUser),
          tenantAdminUser: toPublicUser(adminUser),
          welcomeEmailSent: emailResult.sent === true,
          welcomeEmailMode: emailResult.mode || null,
          welcomeEmailError: emailResult.error || null,
          loginUrl,
          ...(emailFailed || !sendWelcomeEmail ? { temporaryPassword } : {}),
        },
        true,
        successMessage,
        201
      )
    );

  } catch (err) {

    await session.abortTransaction();

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
    const emailResult = await sendTenantAdminWelcomeEmail({
      to: adminUser.email,
      tenantName: tenant.name || tenant.tenant_name || subdomain,
      adminName: adminUser.name || adminUser.email,
      loginUrl,
      temporaryPassword,
    });

    if (!emailResult.sent) {
      logger.info("[tenant-admin:credentials] Password reset — share manually", {
        adminEmail: adminUser.email,
        loginUrl,
        temporaryPassword,
      });
    }

    return res.status(200).send(
      prepareResponseMsg(
        {
          email: adminUser.email,
          loginUrl,
          welcomeEmailSent: emailResult.sent === true,
          ...(!emailResult.sent ? { temporaryPassword } : {}),
        },
        true,
        emailResult.sent
          ? "New temporary password emailed to the organization owner."
          : "New temporary password generated. Share it with the owner manually.",
        200
      )
    );
  } catch (err) {
    return next(err);
  }
}

