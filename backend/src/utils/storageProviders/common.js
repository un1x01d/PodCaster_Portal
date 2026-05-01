import { createHash, createHmac, createSign } from "crypto";
import { query } from "../../config/db.js";
import { decryptSettingValue } from "../settingsCrypto.js";

export const STORAGE_PROVIDER_DEFS = {
  sftp_storage: { label: "SFTP", settingKey: "sftp_storage" },
  gcs_storage: { label: "Google Cloud Storage", settingKey: "gcs_storage" },
  s3_storage: { label: "Amazon S3", settingKey: "s3_storage" },
  azure_blob_storage: { label: "Azure Blob Storage", settingKey: "azure_blob_storage" },
};

export const PROVIDER_TIMEOUT_MS = Number.parseInt(process.env.PROVIDER_FETCH_TIMEOUT_MS || "15000", 10);
export const PROVIDER_IMPORT_MAX_BYTES = Number.parseInt(process.env.PROVIDER_IMPORT_MAX_BYTES || `${100 * 1024 * 1024}`, 10);

export function parsePositiveInt(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function trimString(value, fallback = "") {
  const raw = value === undefined || value === null ? fallback : value;
  return String(raw || "").trim();
}

export function toBoolean(value, fallback = false) {
  if (value === undefined) return !!fallback;
  return !!value;
}

export function normalizeStorageProviderKey(provider) {
  const normalized = String(provider || "").trim().toLowerCase();
  if (STORAGE_PROVIDER_DEFS[normalized]) return normalized;
  if (normalized === "sftp") return "sftp_storage";
  if (normalized === "gcs" || normalized === "gcs_storage") return "gcs_storage";
  if (normalized === "s3") return "s3_storage";
  if (normalized === "azure" || normalized === "azure_blob" || normalized === "azure_blob_storage") return "azure_blob_storage";
  return null;
}

export function appSettingKeyForGroup(baseKey, groupId) {
  return Number.isInteger(groupId) && groupId > 0 ? `group:${groupId}:${baseKey}` : baseKey;
}

export async function getSettingValueWithGlobalFallback(baseKey, groupId) {
  const scopedKey = appSettingKeyForGroup(baseKey, groupId);
  const scopedRows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [scopedKey]);
  if (scopedRows.length) return scopedRows[0]?.value || null;
  if (!Number.isInteger(groupId) || groupId <= 0) return null;
  const globalRows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [baseKey]);
  return globalRows[0]?.value || null;
}

export function supportedSpreadsheetExt(name) {
  const lower = String(name || "").toLowerCase();
  return lower.endsWith(".csv") || lower.endsWith(".xls") || lower.endsWith(".xlsx");
}

export function decodeXmlEntities(value) {
  return String(value || "")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'");
}

export function awsHexSha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function awsHmac(key, value, encoding = null) {
  const h = createHmac("sha256", key).update(value);
  return encoding ? h.digest(encoding) : h.digest();
}

export function awsSigningKey(secretAccessKey, dateStamp, region, service) {
  const kDate = awsHmac(Buffer.from(`AWS4${secretAccessKey}`, "utf8"), dateStamp);
  const kRegion = awsHmac(kDate, region);
  const kService = awsHmac(kRegion, service);
  return awsHmac(kService, "aws4_request");
}

export function awsAmzDate(now = new Date()) {
  const iso = now.toISOString().replace(/[:\-]|\.\d{3}/g, "");
  return iso.slice(0, 15) + "Z";
}

export function awsDateStamp(amzDate) {
  return String(amzDate || "").slice(0, 8);
}

export function canonicalQueryString(params) {
  const entries = [];
  for (const [key, value] of params.entries()) {
    entries.push([encodeURIComponent(key), encodeURIComponent(value)]);
  }
  entries.sort((a, b) => {
    if (a[0] < b[0]) return -1;
    if (a[0] > b[0]) return 1;
    if (a[1] < b[1]) return -1;
    if (a[1] > b[1]) return 1;
    return 0;
  });
  return entries.map(([k, v]) => `${k}=${v}`).join("&");
}

export function assertProviderContentLengthWithinLimit(response) {
  const raw = response?.headers?.get?.("content-length");
  const parsed = Number.parseInt(String(raw || ""), 10);
  if (Number.isFinite(parsed) && parsed > PROVIDER_IMPORT_MAX_BYTES) {
    const err = new Error("provider_file_too_large");
    err.statusCode = 413;
    err.maxBytes = PROVIDER_IMPORT_MAX_BYTES;
    throw err;
  }
}

export async function fetchWithTimeout(url, options = {}, timeoutMs = PROVIDER_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export async function loadStorageProviderConfig(provider, groupId = null) {
  const normalizedProvider = normalizeStorageProviderKey(provider);
  if (!normalizedProvider) return null;
  const def = STORAGE_PROVIDER_DEFS[normalizedProvider];
  const value = await getSettingValueWithGlobalFallback(def.settingKey, groupId);
  return value || null;
}

export function createGcsJwtAssertion(cfg, tokenUri) {
  const clientEmail = trimString(cfg?.clientEmail);
  const privateKey = trimString(decryptSettingValue(String(cfg?.privateKey || "")));
  if (!clientEmail || !privateKey) {
    throw new Error("gcs_credentials_missing");
  }
  const scope = "https://www.googleapis.com/auth/devstorage.read_only";
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = { iss: clientEmail, scope, aud: tokenUri, iat: now, exp: now + 3600 };
  const base64Url = (value) => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  const signingInput = `${base64Url(header)}.${base64Url(claims)}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(privateKey, "base64url");
  return `${signingInput}.${signature}`;
}

export function buildAzureSharedKeyAuth({ method, url, accountName, accountKey, now = new Date() }) {
  const xmsDate = now.toUTCString();
  const xmsVersion = "2023-11-03";
  const canonicalizedHeaders = `x-ms-date:${xmsDate}\nx-ms-version:${xmsVersion}\n`;
  const resourcePath = url.pathname || "/";
  const canonicalizedResource = [`/${accountName}${resourcePath}`];
  const sortedParams = Array.from(url.searchParams.entries()).sort(([aKey, aVal], [bKey, bVal]) => {
    if (aKey < bKey) return -1;
    if (aKey > bKey) return 1;
    if (aVal < bVal) return -1;
    if (aVal > bVal) return 1;
    return 0;
  });
  for (const [k, v] of sortedParams) canonicalizedResource.push(`${k.toLowerCase()}:${v}`);
  const contentLength = method === "GET" || method === "HEAD" ? "" : "0";
  const stringToSign = [
    method, "", "", contentLength, "", "", "", "", "", "", "", "",
    canonicalizedHeaders + canonicalizedResource.join("\n"),
  ].join("\n");
  const signature = createHmac("sha256", Buffer.from(accountKey, "base64")).update(stringToSign).digest("base64");
  return { authorization: `SharedKey ${accountName}:${signature}`, xmsDate, xmsVersion };
}

export { decryptSettingValue };
