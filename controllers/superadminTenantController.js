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



    if (!subdomain || !SUBDOMAIN_RE.test(subdomain)) {

      return sendError(res, "TENANT_SUBDOMAIN_INVALID", 400);

    }



    if (!adminEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {

      return sendError(res, "VALIDATION_EMAIL_INVALID", 400);

    }



    const existingTenant = await Tenant.findOne({

      $or: [{ subdomain }, { sub_domain: subdomain }],

    });

    if (existingTenant) {

      return sendError(res, "TENANT_SUBDOMAIN_TAKEN", 409);

    }



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



    const temporaryPassword = generateTemporaryPassword();

    const rootDomain = process.env.ROOT_DOMAIN || "skillara.com";

    const domain = body.domain || `${subdomain}.${rootDomain}`;



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

          logo: body.logo ?? null,

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



    await seedNewTenantDefaults(tenant._id);

    const ownerRole = await getTenantRoleBySlug(tenant._id, "organization-owner");

    const passwordHash = await hashPassword(temporaryPassword);

    const [adminUser] = await User.create(

      [

        {

          tenantId: tenant._id,

          name: adminName || `${name} Admin`,

          email: adminEmail,

          phone: adminPhone,

          passwordHash,

          roleId: ownerRole?._id || null,

          status: "active",

          isDefaultPassword: true,

          isTenantAdmin: true,

        },

      ],

      { session }

    );



    await session.commitTransaction();



    const loginUrl = buildTenantLoginUrl(subdomain);
    const emailResult = await sendTenantAdminWelcomeEmail({
      to: adminEmail,
      tenantName: name,
      adminName: adminName || adminEmail,
      loginUrl,
      temporaryPassword,
    });



    await writeAuditLog({

      actorId: req.user?.id,

      actorType: "superadmin",

      action: "tenant.created",

      targetId: tenant._id,

      tenantId: tenant._id,

      ip: req.ip,

      metadata: { subdomain: tenant.subdomain, adminEmail },

    });



    if (!emailResult.sent) {
      logger.info("[tenant-admin:credentials] Email not sent — share with owner manually", {
        adminEmail,
        loginUrl,
        temporaryPassword,
      });
    }

    const populated = tenant.toObject();



    return res.status(201).send(

      prepareResponseMsg(

        {

          tenant: normalizeTenantForApi(populated, planLabel),

          tenantAdmin: toPublicUser(adminUser),

          tenantAdminUser: toPublicUser(adminUser),
          welcomeEmailSent: emailResult.sent === true,
          loginUrl,
          ...(!emailResult.sent ? { temporaryPassword } : {}),
        },
        true,
        emailResult.sent
          ? "Organization created. A welcome email with a temporary password was sent to the owner."
          : "Organization created. Welcome email could not be sent — check SMTP settings and server logs.",

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

