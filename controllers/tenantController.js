import Tenant from "../models/Tenant.js";
import User from "../models/User.js";
import { prepareResponseMsg, sendError } from "../utils/helper.js";
import { getMessage } from "../core/message.js";
import { hashPassword } from "../services/password.js";
import { writeAuditLog } from "../services/auditLog.js";
import { normalizeTenantForApi, booleanToTenantStatus, isTenantActive } from "../utils/tenantMapper.js";
import { extractSubdomainFromRequest } from "../utils/resolve-tenant-request.js";
import { getPlanById, buildPlanNameMap } from "../services/planService.js";
import { seedNewTenantDefaults } from "../services/tenantSeedService.js";
import { getTenantRoleBySlug } from "../services/roleService.js";

export const createTenant = async (req, res, next) => {
  try {
    const { tenant_name, domain, sub_domain, email, logo, branding, status, admin, planId } = req.body;

    const plan = await getPlanById(planId);
    if (!plan || plan.isActive !== true) {
      return sendError(res, "PLAN_INVALID", 400);
    }

    const maxUsers = Number(plan.features?.maxUsers ?? 0);
    if (maxUsers < 1) {
      return sendError(res, "PLAN_LIMIT_EXCEEDED", 400);
    }

    const subscriptionStartDate = new Date();
    const subscriptionEndDate = new Date(subscriptionStartDate);
    if (plan.billingCycle === "monthly") {
      subscriptionEndDate.setMonth(subscriptionEndDate.getMonth() + 1);
    } else if (plan.billingCycle === "yearly") {
      subscriptionEndDate.setFullYear(subscriptionEndDate.getFullYear() + 1);
    }

    const existing = await Tenant.findOne({
      $or: [{ subdomain: sub_domain }, { sub_domain }, { domain }, { email }],
    });
    if (existing) {
      return sendError(res, "TENANT_EXISTS", 409);
    }

    const tenantData = await Tenant.create({
      name: tenant_name,
      subdomain: sub_domain,
      domain,
      email,
      logo,
      branding: branding || {},
      status,
      plan: plan.name,
      planId: plan._id,
      subscriptionStatus: "ACTIVE",
      subscriptionStartDate,
      subscriptionEndDate,
      user_count: 1,
    });

    const adminEmail = (admin?.email || email || "").toLowerCase().trim();
    const adminPassword =
      admin?.password || process.env.DEFAULT_TENANT_ADMIN_PASSWORD || "ChangeMe#12345";

    await seedNewTenantDefaults(tenantData._id);
    const ownerRole = await getTenantRoleBySlug(tenantData._id, "organization-owner");
    if (!ownerRole) {
      return sendError(res, "ROLE_INVALID", 500);
    }

    const adminName = admin?.name || `${tenant_name} Admin`;

    const passwordHash = await hashPassword(adminPassword);
    const adminUser = await User.create({
      tenantId: tenantData._id,
      name: adminName,
      email: adminEmail,
      passwordHash,
      roleId: ownerRole._id,
      status: "active",
      isTenantAdmin: true,
    });

    const message = getMessage(100);
    const resp = prepareResponseMsg(
      {
        tenant: tenantData,
        tenantAdminUser: { id: adminUser._id, email: adminUser.email, roleId: adminUser.roleId },
      },
      true,
      message,
      201
    );
    return res.status(201).send(resp);
  } catch (err) {
    return next(err);
  }
};

export const listTenants = async (req, res, next) => {
  try {
    const tenants = await Tenant.find({}).sort({ createdAt: -1 }).lean();
    const planMap = await buildPlanNameMap();

    const data = tenants.map((t) =>
      normalizeTenantForApi(t, planMap.get(String(t.planId)) || t.plan)
    );

    const message = getMessage(102);
    const resp = prepareResponseMsg(data, true, message, 200);
    return res.status(200).send(resp);
  } catch (err) {
    return next(err);
  }
};

export const getTenant = async (req, res, next) => {
  try {
    const tenant = await Tenant.findById(req.params.id).lean();
    if (!tenant) {
      return sendError(res, "TENANT_NOT_FOUND", 404);
    }
    const planMap = await buildPlanNameMap();
    const data = normalizeTenantForApi(tenant, planMap.get(String(tenant.planId)) || tenant.plan);
    return res.status(200).send(prepareResponseMsg(data, true, getMessage(103), 200));
  } catch (err) {
    return next(err);
  }
};

export const updateTenant = async (req, res, next) => {
  try {
    const { tenant_name, email, planId, status, subscriptionStatus, logo, branding } = req.body;
    const tenant = await Tenant.findById(req.params.id);
    if (!tenant) {
      return sendError(res, "TENANT_NOT_FOUND", 404);
    }

    if (tenant_name !== undefined) tenant.name = tenant_name;
    if (email !== undefined) {
      const dup = await Tenant.findOne({ email, _id: { $ne: tenant._id } });
      if (dup) {
        return sendError(res, "TENANT_EMAIL_IN_USE", 409);
      }
      tenant.email = email;
    }
    if (planId !== undefined) {
      const plan = await getPlanById(planId);
      if (!plan || plan.isActive !== true) {
        return sendError(res, "PLAN_INVALID", 400);
      }
      tenant.planId = plan._id;
      tenant.plan = plan.name;
    }
    if (typeof status === "boolean") tenant.status = booleanToTenantStatus(status);
    if (subscriptionStatus) tenant.subscriptionStatus = subscriptionStatus;
    if (req.body.logo !== undefined) tenant.logo = req.body.logo;
    if (branding !== undefined) {
      tenant.branding = {
        welcome_message: branding.welcome_message ?? tenant.branding?.welcome_message ?? "",
        primary_color: branding.primary_color ?? tenant.branding?.primary_color ?? "#4F46E5",
        secondary_color: branding.secondary_color ?? tenant.branding?.secondary_color ?? "#7C3AED",
      };
    }

    await tenant.save();
    const planMap = await buildPlanNameMap();
    const data = normalizeTenantForApi(
      tenant.toObject(),
      planMap.get(String(tenant.planId)) || tenant.plan
    );
    return res.status(200).send(prepareResponseMsg(data, true, getMessage(101), 200));
  } catch (err) {
    return next(err);
  }
};

export const updateTenantStatus = async (req, res, next) => {
  try {
    const tenant = await Tenant.findById(req.params.id);
    if (!tenant) {
      return sendError(res, "TENANT_NOT_FOUND", 404);
    }
    if (typeof req.body.status !== "boolean") {
      return sendError(res, "TENANT_STATUS_INVALID", 400);
    }
    tenant.status = booleanToTenantStatus(req.body.status);
    await tenant.save();

    await writeAuditLog({
      actorId: req.user?._id || req.user?.id,
      actorType: req.user?.type === "superadmin" ? "superadmin" : "tenant_user",
      action: req.body.status ? "tenant.activated" : "tenant.suspended",
      targetId: tenant._id,
      tenantId: tenant._id,
      ip: req.ip,
      metadata: { status: tenant.status },
    });

    return res.status(200).send(
      prepareResponseMsg(
        { id: tenant._id, status: req.body.status },
        true,
        getMessage(101),
        200
      )
    );
  } catch (err) {
    return next(err);
  }
};

export const resolveTenant = async (req, res) => {
  const sub = req.tenantSubdomain || extractSubdomainFromRequest(req);
  if (!sub) {
    const resp = prepareResponseMsg({ subdomain: null, tenant: null }, true, getMessage(103), 200);
    return res.status(200).send(resp);
  }

  let tenant = req.tenant;
  if (!tenant) {
    tenant = await Tenant.findOne({ $or: [{ subdomain: sub }, { sub_domain: sub }] });
  }

  if (!tenant || !isTenantActive(tenant.status)) {
    return sendError(res, "TENANT_NOT_FOUND", 404);
  }

  const tenantPayload = normalizeTenantForApi(
    tenant.toObject ? tenant.toObject() : tenant
  );

  const resp = prepareResponseMsg(
    { subdomain: sub, tenant: tenantPayload },
    true,
    getMessage(103),
    200
  );
  return res.status(200).send(resp);
};

const RESERVED = new Set([
  "www",
  "admin",
  "api",
  "app",
  "mail",
  "support",
  "help",
  "blog",
  "status",
  "cdn",
  "static",
  "assets",
]);

/** Public subdomain check — always 200 for valid format (availability / workspace lookup). */
export const checkTenantSubdomain = async (req, res) => {
  const sub = String(req.params.subdomain || "")
    .trim()
    .toLowerCase();

  if (!sub || sub.length < 3 || sub.length > 15 || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(sub) || /--/.test(sub)) {
    return sendError(res, "TENANT_WORKSPACE_INVALID", 400);
  }

  if (RESERVED.has(sub)) {
    return res.status(200).send(
      prepareResponseMsg(
        {
          exists: false,
          available: false,
          reserved: true,
          sub_domain: sub,
        },
        true,
        "Subdomain is reserved",
        200
      )
    );
  }

  const tenant = await Tenant.findOne({
    $or: [{ subdomain: sub }, { sub_domain: sub }],
  }).select("name subdomain sub_domain status logo tenant_name");

  if (!tenant) {
    return res.status(200).send(
      prepareResponseMsg(
        {
          exists: false,
          available: true,
          sub_domain: sub,
        },
        true,
        "Subdomain is available",
        200
      )
    );
  }

  const isInactive =
    tenant.status === "suspended" || tenant.status === false || tenant.status === "inactive";

  return res.status(200).send(
    prepareResponseMsg(
      {
        exists: true,
        available: false,
        inactive: isInactive,
        tenant_name: tenant.name || tenant.tenant_name,
        sub_domain: tenant.subdomain || tenant.sub_domain,
        logo: tenant.logo,
        status: tenant.status,
      },
      true,
      isInactive ? "Workspace exists but is inactive" : "Workspace found",
      200
    )
  );
};
