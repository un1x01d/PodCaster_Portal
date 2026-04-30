import nodemailer from "nodemailer";
import { query } from "../config/db.js";
import { decryptSettingValue } from "./settingsCrypto.js";

const MAIL_TIMEOUT_MS = Number.parseInt(process.env.SMTP_TIMEOUT_MS || "15000", 10);
const DEFAULT_LOGO_URL = String(process.env.INVITE_EMAIL_LOGO_URL || "").trim();

function defaultInviteTemplate() {
  return {
    subject: "You're invited to join {{customerName}}",
    html: `
      <div style="font-family:Arial,sans-serif;color:#0f172a;max-width:620px;margin:0 auto;">
        <div style="padding:20px 0;text-align:center;">
          {{logoBlock}}
        </div>
        <h2 style="margin:0 0 12px 0;">You're invited to join {{customerName}}</h2>
        <p style="margin:0 0 10px 0;">Invited by: <strong>{{inviterEmail}}</strong></p>
        <p style="margin:0 0 16px 0;">Click below to activate access:</p>
        <p style="margin:0 0 16px 0;">
          <a href="{{inviteUrl}}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:6px;">Accept Invitation</a>
        </p>
        <p style="margin:0 0 8px 0;font-size:13px;color:#475569;">Expires at: {{expiresAt}}</p>
        <p style="margin:0;font-size:12px;color:#64748b;">If you were not expecting this invitation, you can ignore this email.</p>
      </div>
    `,
    text: [
      "You're invited to join {{customerName}}.",
      "",
      "Invited by: {{inviterEmail}}",
      "Invite link: {{inviteUrl}}",
      "Expires at: {{expiresAt}}",
      "",
      "If you were not expecting this invitation, ignore this email.",
    ].join("\n"),
    logoUrl: DEFAULT_LOGO_URL,
  };
}

function normalizeInviteTemplate(raw) {
  const base = defaultInviteTemplate();
  const cfg = raw && typeof raw === "object" ? raw : {};
  return {
    subject: String(cfg.subject || base.subject).trim() || base.subject,
    html: String(cfg.html || base.html).trim() || base.html,
    text: String(cfg.text || base.text).trim() || base.text,
    logoUrl: String(cfg.logoUrl || base.logoUrl || "").trim(),
  };
}

function templateValue(str, key, value) {
  const re = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, "g");
  return String(str || "").replace(re, String(value ?? ""));
}

function formatDateOnly(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const dt = new Date(raw);
  if (!Number.isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);
  return raw.slice(0, 10);
}

export function renderInviteTemplate(template, payload) {
  const safe = normalizeInviteTemplate(template);
  const vars = {
    customerName: String(payload?.customerName || ""),
    inviterEmail: String(payload?.inviterEmail || ""),
    inviteUrl: String(payload?.inviteUrl || ""),
    expiresAt: formatDateOnly(payload?.expiresAt),
    logoUrl: String(payload?.logoUrl || safe.logoUrl || ""),
  };
  const logoBlock = vars.logoUrl
    ? `<img src="${vars.logoUrl}" alt="Logo" style="max-height:48px;max-width:220px;object-fit:contain;" />`
    : "";
  let subject = safe.subject;
  let html = safe.html;
  let text = safe.text;
  for (const [key, val] of Object.entries(vars)) {
    subject = templateValue(subject, key, val);
    html = templateValue(html, key, val);
    text = templateValue(text, key, val);
  }
  html = templateValue(html, "logoBlock", logoBlock);
  text = templateValue(text, "logoBlock", "");
  return { subject, html, text };
}

export async function loadInviteEmailTemplate() {
  const rows = await query("SELECT value FROM app_settings WHERE key = 'invite_email_template' LIMIT 1", []);
  return normalizeInviteTemplate(rows?.[0]?.value || {});
}

export function normalizeInviteEmailTemplateForSave(input, current) {
  const base = normalizeInviteTemplate(current || {});
  const next = input && typeof input === "object" ? input : {};
  return normalizeInviteTemplate({
    subject: next.subject ?? base.subject,
    html: next.html ?? base.html,
    text: next.text ?? base.text,
    logoUrl: next.logoUrl ?? base.logoUrl,
  });
}

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
  const template = await loadInviteEmailTemplate();
  const transporter = createTransport(cfg);
  const senderName = cfg.fromName || "Support";
  const from = `${senderName} <${cfg.fromEmail}>`;
  const rendered = renderInviteTemplate(template, {
    customerName: String(customerName || ""),
    inviterEmail: String(inviterEmail || "Administrator"),
    inviteUrl,
    expiresAt,
  });

  return transporter.sendMail({
    from,
    to: toEmail,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
  });
}
