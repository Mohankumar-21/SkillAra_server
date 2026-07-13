import nodemailer from "nodemailer";
import logger from "../core/logger.js";

let transporterPromise = null;

function smtpConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

async function getTransporter() {
  if (!smtpConfigured()) return null;

  if (!transporterPromise) {
    const port = Number(process.env.SMTP_PORT || 587);
    transporterPromise = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }

  return transporterPromise;
}

function resolveFromAddress() {
  return process.env.EMAIL_FROM || process.env.SMTP_USER || "noreply@skillara.com";
}

/**
 * Sends transactional email via Gmail SMTP when configured, otherwise logs to console.
 * Required env: SMTP_HOST, SMTP_USER, SMTP_PASS (Gmail app password), optional EMAIL_FROM, SMTP_PORT.
 */
export async function sendInviteEmail({ to, subject, html, text }) {
  const from = resolveFromAddress();

  if (!process.env.SMTP_HOST) {
    logger.info("[email:stub] Email (SMTP_HOST not set)", { to, subject, text: text || html });
    return { sent: false, mode: "log", to };
  }

  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    logger.warn("[email] SMTP_HOST is set but SMTP_USER or SMTP_PASS is missing", { to, subject });
    return { sent: false, mode: "misconfigured", to };
  }

  try {
    const transporter = await getTransporter();
    const info = await transporter.sendMail({
      from,
      to,
      subject,
      text,
      html,
    });

    logger.info("[email] Sent via SMTP", { to, subject, messageId: info.messageId });
    return { sent: true, mode: "smtp", to, messageId: info.messageId };
  } catch (err) {
    const message = err?.message || String(err);
    logger.error("[email] SMTP send failed", { to, subject, error: message });
    return { sent: false, mode: "smtp", to, error: message };
  }
}

export function buildInviteEmailContent({ tenantName, inviteUrl }) {
  const subject = `You're invited to join ${tenantName} on SkillAra`;
  const text = [
    `Hello,`,
    "",
    `You've been invited to join ${tenantName} on SkillAra.`,
    "",
    `To accept this invitation and complete your signup, click the link below (expires in 7 days):`,
    inviteUrl,
    "",
    "If you did not expect this invitation, you can safely ignore this email.",
    "",
    "Best regards,",
    "The SkillAra Team",
  ].join("\n");

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; padding: 40px 20px; color: #1e293b; line-height: 1.6;">
      <div style="max-width: 540px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; border: 1px solid #f1f5f9; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05); padding: 40px; text-align: center;">
        <div style="margin-bottom: 24px;">
          <span style="font-size: 28px; font-weight: 800; color: #4f46e5; letter-spacing: -0.025em;">SkillAra</span>
        </div>
        <h2 style="font-size: 22px; font-weight: 700; color: #0f172a; margin-top: 0; margin-bottom: 12px; letter-spacing: -0.025em;">Invitation to join ${tenantName}</h2>
        <p style="font-size: 16px; color: #475569; margin-bottom: 28px; text-align: left;">
          You have been invited to join <strong>${tenantName}</strong> as a team member on SkillAra. Complete your profile setup to gain access to your organization's workspace.
        </p>
        <div style="margin-bottom: 32px;">
          <a href="${inviteUrl}" style="display: inline-block; background-color: #4f46e5; color: #ffffff; font-size: 15px; font-weight: 600; text-decoration: none; padding: 12px 32px; border-radius: 8px; box-shadow: 0 4px 6px -1px rgba(79, 70, 229, 0.2), 0 2px 4px -2px rgba(79, 70, 229, 0.2);">
            Accept Invitation &amp; Sign Up
          </a>
        </div>
        <p style="font-size: 13px; color: #94a3b8; margin-bottom: 24px; text-align: center;">
          This secure invitation link is valid for <strong>7 days</strong>.
        </p>
        <hr style="border: 0; border-top: 1px solid #f1f5f9; margin-bottom: 24px;" />
        <p style="font-size: 12px; color: #94a3b8; margin-bottom: 0; line-height: 1.5; text-align: left;">
          If you did not expect this invitation, or if you do not wish to join ${tenantName}, you can safely ignore this email. No account has been created for you yet.
        </p>
      </div>
      <div style="text-align: center; margin-top: 24px; font-size: 12px; color: #94a3b8;">
        &copy; ${new Date().getFullYear()} SkillAra. All rights reserved.
      </div>
    </div>
  `.trim();

  return { subject, text, html, from: resolveFromAddress() };
}

export function buildTenantAdminWelcomeEmailContent({
  tenantName,
  adminName,
  loginUrl,
  temporaryPassword,
}) {
  const subject = `Your ${tenantName} admin account on SkillAra`;
  const text = [
    `Hello${adminName ? ` ${adminName}` : ""},`,
    "",
    `An organization admin account has been created for ${tenantName} on SkillAra.`,
    "",
    `Sign in: ${loginUrl}`,
    `Email: use this inbox`,
    `Temporary password: ${temporaryPassword}`,
    "",
    "You will be asked to set a new password when you sign in for the first time.",
    "",
    "If you did not expect this email, contact platform support.",
  ].join("\n");

  const html = `
    <div style="font-family:Segoe UI,Arial,sans-serif;line-height:1.5;color:#1e293b;max-width:560px">
      <p>Hello${adminName ? ` ${adminName}` : ""},</p>
      <p>An organization admin account has been created for <strong>${tenantName}</strong> on SkillAra.</p>
      <p><strong>Sign in:</strong> <a href="${loginUrl}">${loginUrl}</a></p>
      <p><strong>Temporary password:</strong> <code style="background:#f1f5f9;padding:2px 6px;border-radius:4px">${temporaryPassword}</code></p>
      <p>You will be prompted to choose a new password on your first sign-in.</p>
      <p style="color:#64748b;font-size:14px">If you did not expect this email, contact platform support.</p>
    </div>
  `.trim();

  return { subject, text, html, from: resolveFromAddress() };
}

export async function sendTenantAdminWelcomeEmail(payload) {
  const content = buildTenantAdminWelcomeEmailContent(payload);
  return sendInviteEmail({ to: payload.to, ...content });
}

/** Reset cached transporter (tests). */
export function resetEmailTransport() {
  transporterPromise = null;
}
