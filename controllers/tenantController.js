import Tenant from "../models/Tenant.js";
import User from "../models/User.js";
import Plan from "../models/Plan.js";
import { prepareResponseMsg } from "../utils/helper.js";
import { getMessage } from "../core/message.js";
import { hashPassword } from "../services/password.js";

export const createTenant = async (req, res, next) => {
  try {
    const { tenant_name, domain, sub_domain, email, logo, status, admin, planId } = req.body;

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
    const adminName = admin?.name || `${tenant_name} Admin`;

    const passwordHash = await hashPassword(adminPassword);
    const adminUser = await User.create({
      tenantId: tenantData._id,
      name: adminName,
      email: adminEmail,
      passwordHash,
      role: "TENANT_ADMIN",
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
    const tenants = await Tenant.find({}).sort({ created_on: -1 });
    const message = getMessage(102);
    const resp = prepareResponseMsg(tenants, true, message, 200);
    return res.status(200).send(resp);
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

  if (!req.tenant) {
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
