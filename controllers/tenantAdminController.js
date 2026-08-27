import User from "../models/User.js";
import Tenant from "../models/Tenant.js";
import { signInviteToken } from "../utils/tokens.js";
import { prepareResponseMsg, sendError } from "../utils/helper.js";
import { toPublicUsers, applyUserProfileFields } from "../utils/user.js";
import { buildInviteSignupUrl } from "../utils/inviteLinks.js";
import { buildInviteEmailContent, sendInviteEmail } from "../services/emailService.js";
import { resolveTenantRoleForUser } from "../services/roleService.js";

async function findTenantById(tenantId) {
  let tenant = await Tenant.findById(tenantId);
  if (tenant) return tenant;
  return Tenant.findOne({ _id: tenantId });
}

/**
 * POST /api/tenant-admin/invite-user
 * Creates an invited user and emails (or logs) a signup link.
 */
export async function inviteUser(req, res, next) {
  try {
    const email = String(req.body?.email || "")
      .toLowerCase()
      .trim();
    const roleId = String(req.body?.roleId || "").trim();

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return sendError(res, "VALIDATION_EMAIL_INVALID", 400);
    }

    if (!/^[0-9a-fA-F]{24}$/.test(roleId)) {
      return sendError(res, "ROLE_INVALID", 400);
    }

    const tenant = await findTenantById(req.tenantId);
    if (!tenant) {
      return sendError(res, "TENANT_NOT_FOUND", 404);
    }

    const roleDoc = await resolveTenantRoleForUser({ tenantId: tenant._id, roleId });
    if (!roleDoc || roleDoc.isOwnerRole) {
      return sendError(res, "ROLE_INVALID", 400);
    }

    const subdomain = tenant.subdomain || tenant.sub_domain;
    if (!subdomain) {
      return sendError(res, "TENANT_WORKSPACE_INVALID", 400);
    }

    const existing = await User.findOne({ email, tenantId: tenant._id });
    if (existing) {
      return sendError(res, "USER_EMAIL_EXISTS", 409);
    }

    const profileFields = {};
    const profileError = await applyUserProfileFields(profileFields, {
      phone: req.body.phone,
      employeeId: req.body.employeeId,
      departmentId: req.body.departmentId,
      profilePhoto: req.body.profilePhoto,
    }, tenant._id);
    if (profileError) {
      return sendError(res, profileError, 400);
    }

    const name = req.body.name ? String(req.body.name).trim() : "";

    const user = await User.create({
      tenantId: tenant._id,
      email,
      name,
      roleId: roleDoc._id,
      status: "invited",
      ...profileFields,
    });

    const inviteToken = signInviteToken({
      sub: String(user._id),
      tenant_id: String(tenant._id),
    });

    const originHeader = req.get("origin") || req.get("referer");
    const inviteUrl = buildInviteSignupUrl(subdomain, inviteToken, originHeader);
    const tenantName = tenant.name || tenant.tenant_name || subdomain;
    const emailContent = buildInviteEmailContent({ tenantName, inviteUrl });

    const emailResult = await sendInviteEmail({
      to: email,
      subject: emailContent.subject,
      html: emailContent.html,
      text: emailContent.text,
    });

    const emailSent = Boolean(emailResult?.sent);
    let message = "Invitation sent";
    if (!emailSent) {
      if (emailResult?.mode === "log") {
        message = "User invited (email logged to console)";
      } else {
        message = "User invited but email failed to send";
      }
    }

    const [publicUser] = await toPublicUsers([user], tenant._id);

    return res.status(201).send(
      prepareResponseMsg(
        {
          user: publicUser,
          inviteUrl: process.env.NODE_ENV === "development" ? inviteUrl : undefined,
          emailSent,
          emailResult,
        },
        true,
        message,
        201
      )
    );
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/tenant-admin/resend-invite
 * Resends user invitation email.
 */
export async function resendInvite(req, res, next) {
  try {
    const userId = String(req.body?.userId || "").trim();

    if (!/^[0-9a-fA-F]{24}$/.test(userId)) {
      return sendError(res, "USER_INVALID", 400);
    }

    const tenant = await findTenantById(req.tenantId);
    if (!tenant) {
      return sendError(res, "TENANT_NOT_FOUND", 404);
    }

    const user = await User.findOne({ _id: userId, tenantId: tenant._id });
    if (!user) {
      return sendError(res, "USER_NOT_FOUND", 404);
    }

    if (user.status !== "invited") {
      return sendError(res, "USER_ALREADY_ACTIVE", 400);
    }

    const subdomain = tenant.subdomain || tenant.sub_domain;
    if (!subdomain) {
      return sendError(res, "TENANT_WORKSPACE_INVALID", 400);
    }

    const inviteToken = signInviteToken({
      sub: String(user._id),
      tenant_id: String(tenant._id),
    });

    const originHeader = req.get("origin") || req.get("referer");
    const inviteUrl = buildInviteSignupUrl(subdomain, inviteToken, originHeader);
    const tenantName = tenant.name || tenant.tenant_name || subdomain;
    const emailContent = buildInviteEmailContent({ tenantName, inviteUrl });

    const emailResult = await sendInviteEmail({
      to: user.email,
      subject: emailContent.subject,
      html: emailContent.html,
      text: emailContent.text,
    });

    const emailSent = Boolean(emailResult?.sent);
    let message = "Invitation resent";
    if (!emailSent) {
      if (emailResult?.mode === "log") {
        message = "Invitation resent (email logged to console)";
      } else {
        message = "Invitation resent but email failed to send";
      }
    }

    const [publicUser] = await toPublicUsers([user], tenant._id);

    return res.status(200).send(
      prepareResponseMsg(
        {
          user: publicUser,
          inviteUrl: process.env.NODE_ENV === "development" ? inviteUrl : undefined,
          emailSent,
          emailResult,
        },
        true,
        message,
        200
      )
    );
  } catch (err) {
    return next(err);
  }
}
