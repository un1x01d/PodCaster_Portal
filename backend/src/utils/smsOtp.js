import { query } from "../config/db.js";
import { decryptSettingValue, encryptSettingValue } from "./settingsCrypto.js";

const SMS_TIMEOUT_MS = Number.parseInt(process.env.SMS_OTP_TIMEOUT_MS || "15000", 10);

function parseBool(value, fallback = false) {
  if (typeof value === "boolean") return value;
  const text = String(value || "").trim().toLowerCase();
  if (!text) return fallback;
  return text === "true" || text === "1" || text === "yes";
}

function normalizeSmsOtpConfig(raw) {
  const cfg = raw && typeof raw === "object" ? raw : {};
  return {
    provider: String(cfg.provider || "twilio").trim().toLowerCase() || "twilio",
    accountSid: String(cfg.accountSid || "").trim(),
    authToken: decryptSettingValue(String(cfg.authToken || "")).trim(),
    fromNumber: String(cfg.fromNumber || "").trim(),
    messagingServiceSid: String(cfg.messagingServiceSid || "").trim(),
    enabled: parseBool(cfg.enabled, true),
  };
}

export function normalizeSmsOtpConfigForSave(current, body) {
  const incomingToken = typeof body?.authToken === "string" ? body.authToken.trim() : undefined;
  const nextAuthToken = (incomingToken && incomingToken !== "***") ? incomingToken : String(current.authToken || "");
  return {
    provider: "twilio",
    accountSid: typeof body?.accountSid === "string" ? body.accountSid.trim() : String(current.accountSid || ""),
    authToken: encryptSettingValue(nextAuthToken),
    fromNumber: typeof body?.fromNumber === "string" ? body.fromNumber.trim() : String(current.fromNumber || ""),
    messagingServiceSid: typeof body?.messagingServiceSid === "string"
      ? body.messagingServiceSid.trim()
      : String(current.messagingServiceSid || ""),
    enabled: body?.enabled === undefined ? !!current.enabled : !!body.enabled,
  };
}

export async function loadSmsOtpConfig() {
  const rows = await query("SELECT value FROM app_settings WHERE key = 'sms_otp_config' LIMIT 1", []);
  return normalizeSmsOtpConfig(rows?.[0]?.value || {});
}

export async function saveSmsOtpConfig(nextConfig) {
  await query(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ('sms_otp_config', $1::jsonb, CURRENT_TIMESTAMP)
     ON CONFLICT (key)
     DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
    [JSON.stringify(nextConfig)]
  );
}

export function maskSecret(value) {
  return String(value || "").trim() ? "***" : "";
}

function validateTwilioConfig(cfg) {
  if (cfg.provider !== "twilio") throw new Error("sms_provider_not_supported");
  if (!cfg.enabled) throw new Error("sms_otp_disabled");
  if (!cfg.accountSid || !cfg.authToken) throw new Error("sms_otp_not_configured");
  if (!cfg.fromNumber && !cfg.messagingServiceSid) throw new Error("sms_otp_sender_not_configured");
}

async function fetchWithTimeout(url, options = {}, timeoutMs = SMS_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function sendSmsOtpMessage({ to, body }) {
  const cfg = await loadSmsOtpConfig();
  validateTwilioConfig(cfg);
  const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(cfg.accountSid)}/Messages.json`;
  const form = new URLSearchParams();
  form.set("To", String(to || "").trim());
  form.set("Body", String(body || "").trim());
  if (cfg.messagingServiceSid) form.set("MessagingServiceSid", cfg.messagingServiceSid);
  else form.set("From", cfg.fromNumber);

  const basicAuth = Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString("base64");
  const response = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form,
  });
  const text = await response.text();
  if (!response.ok) {
    const err = new Error("sms_send_failed");
    err.statusCode = 400;
    err.details = text.slice(0, 300);
    throw err;
  }
  return { success: true };
}

