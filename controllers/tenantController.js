import Tenant from "../models/Tenant.js";
import User from "../models/User.js";
import Plan from "../models/Plan.js";
import { prepareResponseMsg } from "../utils/helper.js";
import { getMessage } from "../core/message.js";
import { hashPassword } from "../services/password.js";

export const createTenant = async (req, res, next) => {
  try {
    const { tenant_name, domain, sub_domain, email, logo, branding, status, admin, planId } = req.body;

    const plan = await Plan.findById(planId);
    if (!plan || plan.isActive !== true) {
      return res
        .status(400)
        .send(prepareResponseMsg({}, false, "Invalid or inactive plan", 400));
    }

    // Creating a tenant always creates the first TENANT_ADMIN user.
    const maxUsers = Number(plan.features?.maxUsers ?? 0);
    if (maxUsers < 1) {
      return res
        .status(400)
        .send(
          prepareResponseMsg(
            {},
            false,
            "Plan limit exceeded. Upgrade required.",
            400
          )
        );
    }

    const subscriptionStartDate = new Date();
    const subscriptionEndDate = new Date(subscriptionStartDate);
    if (plan.billingCycle === "monthly") {
      subscriptionEndDate.setMonth(subscriptionEndDate.getMonth() + 1);
    } else if (plan.billingCycle === "yearly") {
      subscriptionEndDate.setFullYear(subscriptionEndDate.getFullYear() + 1);
    }

    const existing = await Tenant.findOne({ $or: [{ sub_domain }, { domain }, { email }] });
    if (existing) {
      const resp = prepareResponseMsg(
        {},
        false,
        "Tenant already exists (domain/subdomain/email)",
        409
      );
      return res.status(409).send(resp);
    }

    const tenantData = await Tenant.create({
      tenant_name,
      domain,
      sub_domain,
      email,
      logo,
      branding: branding || {},
      status,
      planId: plan._id,
      subscriptionStatus: "ACTIVE",
      subscriptionStartDate,
      subscriptionEndDate,
      user_count: 1, // First user (TENANT_ADMIN) is created right after.
    });

    // Auto-create TENANT_ADMIN user
    const adminEmail = (admin?.email || email || "").toLowerCase().trim();
    const adminPassword =
      admin?.password || process.env.DEFAULT_TENANT_ADMIN_PASSWORD || "ChangeMe#12345";
    if (admin?.role && admin.role !== "TENANT_ADMIN") {
      return res
        .status(400)
        .send(prepareResponseMsg({}, false, "Organization owner must have TENANT_ADMIN role", 400));
    }

    const adminName = admin?.name || `${tenant_name} Admin`;
    const adminRole = "TENANT_ADMIN";

    const passwordHash = await hashPassword(adminPassword);
    const adminUser = await User.create({
      tenantId: tenantData._id,
      name: adminName,
      email: adminEmail,
      passwordHash,
      role: adminRole,
      status: "ACTIVE",
    });

    const message = getMessage(100);
    const resp = prepareResponseMsg(
      {
        tenant: tenantData,
        tenantAdminUser: { id: adminUser._id, email: adminUser.email, role: adminUser.role },
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
    const tenants = await Tenant.find({})
      .populate("planId", "name")
      .sort({ created_on: -1 })
      .lean();

    const data = tenants.map((t) => ({
      ...t,
      plan: t.planId?.name || "FREE",
      planId: t.planId?._id || t.planId,
    }));

    const message = getMessage(102);
    const resp = prepareResponseMsg(data, true, message, 200);
    return res.status(200).send(resp);
  } catch (err) {
    return next(err);
  }
};

export const getTenant = async (req, res, next) => {
  try {
    const tenant = await Tenant.findById(req.params.id).populate("planId", "name").lean();
    if (!tenant) {
      return res.status(404).send(prepareResponseMsg({}, false, "Tenant not found", 404));
    }
    const data = {
      ...tenant,
      plan: tenant.planId?.name || "FREE",
      planId: tenant.planId?._id || tenant.planId,
    };
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
      return res.status(404).send(prepareResponseMsg({}, false, "Tenant not found", 404));
    }

    if (tenant_name !== undefined) tenant.tenant_name = tenant_name;
    if (email !== undefined) {
      const dup = await Tenant.findOne({ email, _id: { $ne: tenant._id } });
      if (dup) {
        return res
          .status(409)
          .send(prepareResponseMsg({}, false, "Email already in use", 409));
      }
      tenant.email = email;
    }
    if (planId !== undefined) {
      const plan = await Plan.findById(planId);
      if (!plan || plan.isActive !== true) {
        return res
          .status(400)
          .send(prepareResponseMsg({}, false, "Invalid or inactive plan", 400));
      }
      tenant.planId = plan._id;
    }
    if (typeof status === "boolean") tenant.status = status;
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
    const populated = await Tenant.findById(tenant._id).populate("planId", "name").lean();
    const data = {
      ...populated,
      plan: populated.planId?.name || "FREE",
      planId: populated.planId?._id || populated.planId,
    };
    return res.status(200).send(prepareResponseMsg(data, true, getMessage(101), 200));
  } catch (err) {
    return next(err);
  }
};

export const updateTenantStatus = async (req, res, next) => {
  try {
    const tenant = await Tenant.findById(req.params.id);
    if (!tenant) {
      return res.status(404).send(prepareResponseMsg({}, false, "Tenant not found", 404));
    }
    if (typeof req.body.status !== "boolean") {
      return res.status(400).send(prepareResponseMsg({}, false, "status must be a boolean", 400));
    }
    tenant.status = req.body.status;
    await tenant.save();
    return res
      .status(200)
      .send(prepareResponseMsg({ id: tenant._id, status: tenant.status }, true, getMessage(101), 200));
  } catch (err) {
    return next(err);
  }
};

export const resolveTenant = async (req, res) => {
  const sub = req.tenantSubdomain || null;
  if (!sub) {
    const resp = prepareResponseMsg({ subdomain: null, tenant: null }, true, getMessage(103), 200);
    return res.status(200).send(resp);
  }

  if (!req.tenant || req.tenant.status === false) {
    const resp = prepareResponseMsg({}, false, getMessage(151), 404);
    return res.status(404).send(resp);
  }

  const resp = prepareResponseMsg(
    { subdomain: sub, tenant: req.tenant },
    true,
    getMessage(103),
    200
  );
  return res.status(200).send(resp);
};

const RESERVED = new Set(["www", "admin", "api"]);

export const checkTenantSubdomain = async (req, res) => {
  const sub = String(req.params.subdomain || "")
    .trim()
    .toLowerCase();

  if (!sub || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(sub)) {
    return res
      .status(400)
      .send(prepareResponseMsg({ exists: false }, false, "Invalid workspace name", 400));
  }

  if (RESERVED.has(sub)) {
    return res
      .status(404)
      .send(prepareResponseMsg({ exists: false }, false, "Workspace not found", 404));
  }

  const tenant = await Tenant.findOne({ sub_domain: sub }).select(
    "tenant_name sub_domain status logo"
  );

  if (!tenant || tenant.status === false) {
    return res
      .status(404)
      .send(prepareResponseMsg({ exists: false }, false, "Workspace not found", 404));
  }

  return res.status(200).send(
    prepareResponseMsg(
      {
        exists: true,
        tenant_name: tenant.tenant_name,
        sub_domain: tenant.sub_domain,
        logo: tenant.logo,
      },
      true,
      "Workspace found",
      200
    )
  );
};
