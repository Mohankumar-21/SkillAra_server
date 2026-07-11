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
    `You've been invited to join ${tenantName} on SkillAra.`,
    "",
    "Complete your signup using the link below (expires in 7 days):",
    inviteUrl,
    "",
    "If you did not expect this invitation, you can ignore this email.",
  ].join("\n");

  const html = `
    <p>You've been invited to join <strong>${tenantName}</strong> on SkillAra.</p>
    <p><a href="${inviteUrl}">Complete your signup</a> (link expires in 7 days).</p>
    <p>If you did not expect this invitation, you can ignore this email.</p>
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
