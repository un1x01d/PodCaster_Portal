import nodemailer from "nodemailer";
import { query } from "../config/db.js";
import { decryptSettingValue } from "./settingsCrypto.js";

const MAIL_TIMEOUT_MS = Number.parseInt(process.env.SMTP_TIMEOUT_MS || "15000", 10);

function normalizeSmtpConfig(raw) {
  const cfg = raw && typeof raw === "object" ? raw : {};
  return {
    host: String(cfg.host || "").trim(),
    port: Number.parseInt(cfg.port, 10) || 587,
    secure: !!cfg.secure,
    username: String(cfg.username || "").trim(),
    password: decryptSettingValue(String(cfg.password || "")).trim(),
    fromEmail: String(cfg.fromEmail || "").trim(),
    fromName: String(cfg.fromName || "").trim(),
  };
}

async function loadSmtpConfig() {
  const rows = await query("SELECT value FROM app_settings WHERE key = 'smtp_config' LIMIT 1", []);
  const cfg = normalizeSmtpConfig(rows[0]?.value || {});
  if (!cfg.host || !cfg.username || !cfg.password || !cfg.fromEmail) {
    const err = new Error("smtp_not_configured");
    err.statusCode = 400;
    throw err;
  }
  return cfg;
}

function createTransport(cfg) {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: {
      user: cfg.username,
      pass: cfg.password,
    },
    connectionTimeout: MAIL_TIMEOUT_MS,
    greetingTimeout: MAIL_TIMEOUT_MS,
    socketTimeout: MAIL_TIMEOUT_MS,
  });
}

export async function sendInvitationEmail({
  toEmail,
  inviteUrl,
  customerName,
  inviterEmail,
  expiresAt,
}) {
  const cfg = await loadSmtpConfig();
  const transporter = createTransport(cfg);
  const senderName = cfg.fromName || "Support";
  const from = `${senderName} <${cfg.fromEmail}>`;
  const expires = new Date(expiresAt).toISOString();
  const subject = `You're invited to join ${customerName}`;
  const text = [
    `You've been invited to join "${customerName}".`,
    "",
    `Invited by: ${inviterEmail || "Administrator"}`,
    `Invite link: ${inviteUrl}`,
    `Expires at: ${expires}`,
    "",
    "If you were not expecting this invitation, ignore this email.",
  ].join("\n");
  const html = `
    <p>You've been invited to join <strong>${String(customerName || "").replace(/[<>&"]/g, "")}</strong>.</p>
    <p><strong>Invited by:</strong> ${String(inviterEmail || "Administrator").replace(/[<>&"]/g, "")}</p>
    <p><a href="${inviteUrl}">Accept invitation</a></p>
    <p><strong>Expires at:</strong> ${expires}</p>
    <p>If you were not expecting this invitation, ignore this email.</p>
  `;

  return transporter.sendMail({
    from,
    to: toEmail,
    subject,
    text,
    html,
  });
}
