import User from "../models/User.js";
import Tenant from "../models/Tenant.js";
import { signInviteToken } from "../utils/tokens.js";
import { prepareResponseMsg, sendError } from "../utils/helper.js";
import { toPublicUsers } from "../utils/user.js";
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

    const user = await User.create({
      tenantId: tenant._id,
      email,
      roleId: roleDoc._id,
      status: "invited",
    });

    const inviteToken = signInviteToken({
      sub: String(user._id),
      tenant_id: String(tenant._id),
    });

    const inviteUrl = buildInviteSignupUrl(subdomain, inviteToken);
    const tenantName = tenant.name || tenant.tenant_name || subdomain;
    const emailContent = buildInviteEmailContent({ tenantName, inviteUrl });

    await sendInviteEmail({
      to: email,
      subject: emailContent.subject,
      html: emailContent.html,
      text: emailContent.text,
    });

    const [publicUser] = await toPublicUsers([user], tenant._id);

    return res.status(201).send(
      prepareResponseMsg(
        {
          user: publicUser,
          inviteUrl: process.env.NODE_ENV === "development" ? inviteUrl : undefined,
        },
        true,
        "Invitation sent",
        201
      )
    );
  } catch (err) {
    return next(err);
  }
}
