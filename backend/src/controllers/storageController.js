import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { createHash, createHmac, createSign } from "crypto";
import { query } from "../config/db.js";
import { uploadSheet } from "./sheetController.js";
import { decryptSettingValue, encryptSettingValue } from "../utils/settingsCrypto.js";
import {
  downloadStorageProviderFile,
  getStorageProviderStatus as getStorageProviderRuntimeStatus,
  listStorageProviderEntries,
  normalizeStorageProviderKey,
} from "../utils/storageProviders.js";
import {
  appSettingKeyForGroup,
  resolveScopedGroupForIntegrationSettings,
} from "./userController.js";

const STORAGE_TEST_TIMEOUT_MS = Number.parseInt(process.env.STORAGE_TEST_TIMEOUT_MS || "20000", 10);
const SFTP_TMP_PREFIX = "storage-sftp-";
const fsp = fs.promises;

function parsePositiveInt(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function trimString(value, fallback = "") {
  const raw = value === undefined || value === null ? fallback : value;
  return String(raw || "").trim();
}

function shellQuote(value) {
  const raw = String(value ?? "");
  return `'${raw.replaceAll("'", `'\\''`)}'`;
}

function safeAskpassScript(secretValue) {
  return `#!/bin/sh\nprintf '%s\\n' ${shellQuote(String(secretValue || ""))}\n`;
}

async function cleanupStaleSftpTempArtifacts() {
  try {
    const root = os.tmpdir();
    const now = Date.now();
    const entries = await fsp.readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith(SFTP_TMP_PREFIX)) continue;
      const target = path.join(root, entry.name);
      try {
        const st = await fsp.stat(target);
        const ageMs = now - Number(st.mtimeMs || st.ctimeMs || now);
        if (ageMs > 60 * 60 * 1000) await fsp.rm(target, { recursive: true, force: true });
      } catch {}
    }
  } catch {}
}

function maskIfPresent(value) {
  return trimString(value) ? "***" : "";
}

function toBoolean(value, fallback = false) {
  if (value === undefined) return !!fallback;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["false", "0", "no", "off", ""].includes(normalized)) return false;
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
  }
  return !!value;
}

async function getSettingValueWithGlobalFallback(baseKey, groupId) {
  const scopedKey = appSettingKeyForGroup(baseKey, groupId);
  const scopedRows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [scopedKey]);
  if (scopedRows.length) return scopedRows[0]?.value || null;
  if (!Number.isInteger(groupId) || groupId <= 0) return null;
  const globalRows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [baseKey]);
  return globalRows[0]?.value || null;
}

async function loadScopedStorageSetting(req, baseKey, options = {}) {
  const scope = await resolveScopedGroupForIntegrationSettings(req);
  const useGlobalFallback = options?.globalFallback !== false;
  const value = useGlobalFallback
    ? await getSettingValueWithGlobalFallback(baseKey, scope.groupId)
    : await (async () => {
        const scopedKey = appSettingKeyForGroup(baseKey, scope.groupId);
        const scopedRows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [scopedKey]);
        return scopedRows.length ? (scopedRows[0]?.value || null) : null;
      })();
  return { scope, value: value || {} };
}

async function saveScopedStorageSetting(baseKey, groupId, value) {
  const key = appSettingKeyForGroup(baseKey, groupId);
  await query(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
     ON CONFLICT (key)
     DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
    [key, JSON.stringify(value)]
  );
}

function sanitizeStorageSecret(currentValue, incomingValue) {
  const raw = trimString(incomingValue, "");
  if (!raw || raw === "***") return String(currentValue || "");
  return raw;
}

function makeStorageResponse(scope, value, fields) {
  const response = { enabled: toBoolean(value?.enabled, false), groupId: scope.groupId || null };
  for (const field of fields) {
    if (field.secret) {
      response[field.hasKey] = !!trimString(decryptSettingValue(String(value?.[field.name] || "")));
      response[`${field.name}Masked`] = maskIfPresent(decryptSettingValue(String(value?.[field.name] || "")));
      continue;
    }
    if (field.type === "number") {
      response[field.name] = Number.parseInt(value?.[field.name], 10) || field.defaultValue || 0;
      continue;
    }
    if (field.type === "boolean") {
      response[field.name] = toBoolean(value?.[field.name], field.defaultValue || false);
      continue;
    }
    response[field.name] = trimString(value?.[field.name], field.defaultValue || "");
  }
  return response;
}

function buildStorageConfig(current, body, fields) {
  const next = { ...current };
  next.enabled = toBoolean(body?.enabled, current.enabled ?? false);
  for (const field of fields) {
    if (field.name === "enabled") continue;
    if (field.secret) {
      const currentSecret = decryptSettingValue(String(current?.[field.name] || ""));
      next[field.name] = encryptSettingValue(sanitizeStorageSecret(currentSecret, body?.[field.name]));
      continue;
    }
    if (field.type === "number") {
      const candidate = Number.parseInt(body?.[field.name], 10);
      next[field.name] = Number.isInteger(candidate) && candidate > 0 ? candidate : (current?.[field.name] ?? field.defaultValue ?? "");
      continue;
    }
    if (field.type === "boolean") {
      next[field.name] = body?.[field.name] === undefined ? toBoolean(current?.[field.name], field.defaultValue || false) : !!body[field.name];
      continue;
    }
    const incoming = body?.[field.name];
    next[field.name] = incoming === undefined ? trimString(current?.[field.name], field.defaultValue || "") : trimString(incoming, field.defaultValue || "");
  }
  return next;
}

function assertAllowedStorageKeys(body, fields = []) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    const err = new Error("invalid_settings_payload");
    err.statusCode = 400;
    throw err;
  }
  const allowed = new Set(["groupId", ...fields.map((f) => f.name)]);
  const unknown = Object.keys(body).filter((k) => !allowed.has(k));
  if (unknown.length) {
    const err = new Error("unknown_settings_keys");
    err.statusCode = 400;
    err.details = { unknown };
    throw err;
  }
}

function awsHexSha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function awsHmac(key, value, encoding = null) {
  const h = createHmac("sha256", key).update(value);
  return encoding ? h.digest(encoding) : h.digest();
}

function awsSigningKey(secretAccessKey, dateStamp, region, service) {
  const kDate = awsHmac(Buffer.from(`AWS4${secretAccessKey}`, "utf8"), dateStamp);
  const kRegion = awsHmac(kDate, region);
  const kService = awsHmac(kRegion, service);
  return awsHmac(kService, "aws4_request");
}

function awsAmzDate(now = new Date()) {
  const iso = now.toISOString().replace(/[:\-]|\.\d{3}/g, "");
  return iso.slice(0, 15) + "Z";
}

function awsDateStamp(amzDate) {
  return String(amzDate || "").slice(0, 8);
}

function canonicalQueryString(params) {
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

async function fetchWithTimeout(url, options = {}, timeoutMs = STORAGE_TEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function runSshProbe(cfg) {
  const host = trimString(cfg?.host);
  const username = trimString(cfg?.username);
  const port = parsePositiveInt(cfg?.port) || 22;
  if (!host || !username) {
    return { ok: false, error: "storage_not_configured" };
  }

  const args = [
    "-o", "BatchMode=no",
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", "ConnectTimeout=10",
    "-o", "ServerAliveInterval=5",
    "-o", "ServerAliveCountMax=1",
    "-p", String(port),
  ];

  await cleanupStaleSftpTempArtifacts();
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), SFTP_TMP_PREFIX));
  const cleanupPaths = [];
  const env = { ...process.env };

  try {
    if (trimString(cfg?.authMode, "password") === "ssh_key") {
      const privateKey = trimString(decryptSettingValue(String(cfg?.privateKey || "")));
      if (!privateKey) return { ok: false, error: "ssh_private_key_missing" };
      const keyPath = path.join(tmpDir, "id_rsa");
      await fsp.writeFile(keyPath, privateKey, { mode: 0o600 });
      cleanupPaths.push(keyPath);
      args.push("-i", keyPath, "-o", "IdentitiesOnly=yes", "-o", "PreferredAuthentications=publickey");
      const passphrase = trimString(decryptSettingValue(String(cfg?.passphrase || "")));
      if (passphrase) {
        const scriptPath = path.join(tmpDir, "askpass.sh");
        await fsp.writeFile(scriptPath, safeAskpassScript(passphrase), { mode: 0o700 });
        cleanupPaths.push(scriptPath);
        env.SSH_ASKPASS = scriptPath;
        env.SSH_ASKPASS_REQUIRE = "force";
        env.DISPLAY = env.DISPLAY || "codex";
      }
    } else {
      const password = trimString(decryptSettingValue(String(cfg?.password || "")));
      if (!password) return { ok: false, error: "ssh_password_missing" };
      const scriptPath = path.join(tmpDir, "askpass.sh");
      await fsp.writeFile(scriptPath, safeAskpassScript(password), { mode: 0o700 });
      cleanupPaths.push(scriptPath);
      env.SSH_ASKPASS = scriptPath;
      env.SSH_ASKPASS_REQUIRE = "force";
      env.DISPLAY = env.DISPLAY || "codex";
      args.push("-o", "PreferredAuthentications=password,keyboard-interactive");
      args.push("-o", "PubkeyAuthentication=no");
    }

    const target = `${username}@${host}`;
    const commandArgs = [...args, target, "echo", "codex-probe-ok"];
    const result = await new Promise((resolve) => {
      const proc = spawn("ssh", commandArgs, {
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      const timeout = setTimeout(() => {
        proc.kill("SIGKILL");
      }, STORAGE_TEST_TIMEOUT_MS);
      proc.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
      proc.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
      proc.on("error", (err) => {
        clearTimeout(timeout);
        resolve({ ok: false, error: "ssh_command_unavailable", details: String(err?.message || err) });
      });
      proc.on("close", (code) => {
        clearTimeout(timeout);
        if (code === 0 && stdout.includes("codex-probe-ok")) {
          resolve({ ok: true, message: "storage_probe_success" });
          return;
        }
        const lower = `${stdout}\n${stderr}`.toLowerCase();
        if (lower.includes("permission denied") || lower.includes("authentication failed")) {
          resolve({ ok: false, error: "invalid_credentials", details: (stderr || stdout).slice(0, 400) });
          return;
        }
        resolve({ ok: false, error: "storage_probe_failed", details: (stderr || stdout).slice(0, 400) });
      });
    });
    return result;
  } finally {
    for (const p of cleanupPaths) {
      try { await fsp.unlink(p); } catch {}
    }
    try { await fsp.rm(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

function createGcsJwtAssertion(cfg, tokenUri) {
  const clientEmail = trimString(cfg?.clientEmail);
  const privateKey = trimString(decryptSettingValue(String(cfg?.privateKey || "")));
  if (!clientEmail || !privateKey) {
    throw new Error("gcs_credentials_missing");
  }
  const scope = "https://www.googleapis.com/auth/devstorage.read_only";
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: clientEmail,
    scope,
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
  };
  const base64Url = (value) => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  const signingInput = `${base64Url(header)}.${base64Url(claims)}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(privateKey, "base64url");
  return `${signingInput}.${signature}`;
}

function createAwsS3AuthHeader({ method, url, accessKeyId, secretAccessKey, region }) {
  const amzDate = awsAmzDate();
  const dateStamp = awsDateStamp(amzDate);
  const host = url.host;
  const payloadHash = awsHexSha256("");
  const canonicalHeaders = `host:${host}\n` + `x-amz-content-sha256:${payloadHash}\n` + `x-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    method,
    url.pathname || "/",
    canonicalQueryString(url.searchParams),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    awsHexSha256(canonicalRequest),
  ].join("\n");
  const signingKey = awsSigningKey(secretAccessKey, dateStamp, region, "s3");
  const signature = awsHmac(signingKey, stringToSign, "hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { authorization, amzDate, payloadHash };
}

function buildAzureSharedKeyAuth({ method, url, accountName, accountKey, now = new Date() }) {
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
  const contentLength = method === "GET" ? "" : "0";
  const stringToSign = [
    method,
    "",
    "",
    contentLength,
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    canonicalizedHeaders + canonicalizedResource.join("\n"),
  ].join("\n");
  const signature = createHmac("sha256", Buffer.from(accountKey, "base64")).update(stringToSign).digest("base64");
  return {
    authorization: `SharedKey ${accountName}:${signature}`,
    xmsDate,
    xmsVersion,
  };
}

const SFTP_FIELDS = [
  { name: "enabled", type: "boolean", defaultValue: false },
  { name: "host" },
  { name: "port", type: "number", defaultValue: 22 },
  { name: "username" },
  { name: "authMode", defaultValue: "password" },
  { name: "password", secret: true, hasKey: "hasPassword" },
  { name: "privateKey", secret: true, hasKey: "hasPrivateKey" },
  { name: "passphrase", secret: true, hasKey: "hasPassphrase" },
  { name: "remotePath", defaultValue: "" },
];

const GCS_FIELDS = [
  { name: "enabled", type: "boolean", defaultValue: false },
  { name: "projectId" },
  { name: "bucket" },
  { name: "clientEmail" },
  { name: "privateKey", secret: true, hasKey: "hasPrivateKey" },
  { name: "tokenUri", defaultValue: "https://oauth2.googleapis.com/token" },
  { name: "prefix", defaultValue: "" },
];

const S3_FIELDS = [
  { name: "enabled", type: "boolean", defaultValue: false },
  { name: "bucket" },
  { name: "region" },
  { name: "accessKeyId" },
  { name: "secretAccessKey", secret: true, hasKey: "hasSecretAccessKey" },
  { name: "endpointUrl", defaultValue: "" },
  { name: "pathStyleAccess", type: "boolean", defaultValue: false },
  { name: "prefix", defaultValue: "" },
];

const AZURE_FIELDS = [
  { name: "enabled", type: "boolean", defaultValue: false },
  { name: "accountName" },
  { name: "accountKey", secret: true, hasKey: "hasAccountKey" },
  { name: "container" },
  { name: "endpointSuffix", defaultValue: "blob.core.windows.net" },
  { name: "prefix", defaultValue: "" },
];

async function testSftpConnection(cfg) {
  const host = trimString(cfg?.host);
  const username = trimString(cfg?.username);
  const port = parsePositiveInt(cfg?.port) || 22;
  if (!host || !username) return { ok: false, error: "sftp_not_configured" };
  return runSshProbe({ ...cfg, host, username, port });
}

async function testGcsConnection(cfg) {
  const bucket = trimString(cfg?.bucket);
  const projectId = trimString(cfg?.projectId);
  const tokenUri = trimString(cfg?.tokenUri, "https://oauth2.googleapis.com/token");
  if (!bucket || !projectId) return { ok: false, error: "gcs_not_configured" };
  let assertion;
  try {
    assertion = createGcsJwtAssertion(cfg, tokenUri);
  } catch (err) {
    return { ok: false, error: err.message || "gcs_credentials_missing" };
  }
  const tokenRes = await fetchWithTimeout(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    const lower = text.toLowerCase();
    if (lower.includes("invalid_grant") || lower.includes("unauthorized") || lower.includes("invalid_client")) {
      return { ok: false, error: "invalid_credentials", details: text.slice(0, 400) };
    }
    return { ok: false, error: "gcs_token_exchange_failed", details: text.slice(0, 400) };
  }
  const tokenJson = await tokenRes.json();
  const accessToken = trimString(tokenJson?.access_token);
  if (!accessToken) return { ok: false, error: "gcs_access_token_missing" };
  const bucketUrl = new URL(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}`);
  bucketUrl.searchParams.set("fields", "name");
  const res = await fetchWithTimeout(bucketUrl.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    return { ok: false, error: "gcs_bucket_probe_failed", details: text.slice(0, 400) };
  }
  return { ok: true, message: "storage_probe_success" };
}

async function testS3Connection(cfg) {
  const bucket = trimString(cfg?.bucket);
  const region = trimString(cfg?.region);
  const accessKeyId = trimString(cfg?.accessKeyId);
  const secretAccessKey = trimString(decryptSettingValue(String(cfg?.secretAccessKey || "")));
  if (!bucket || !region || !accessKeyId || !secretAccessKey) {
    return { ok: false, error: "s3_not_configured" };
  }
  const endpointUrl = trimString(cfg?.endpointUrl);
  const pathStyleAccess = toBoolean(cfg?.pathStyleAccess, false);
  let url;
  if (endpointUrl) {
    url = new URL(endpointUrl);
    if (pathStyleAccess && !url.pathname.includes(`/${bucket}`)) {
      url.pathname = `${url.pathname.replace(/\/$/, "")}/${bucket}`;
    }
  } else if (pathStyleAccess) {
    url = new URL(`https://s3.${region}.amazonaws.com/${bucket}`);
  } else {
    url = new URL(`https://${bucket}.s3.${region}.amazonaws.com/`);
  }
  url.searchParams.set("list-type", "2");
  url.searchParams.set("max-keys", "1");
  const { authorization, amzDate, payloadHash } = createAwsS3AuthHeader({
    method: "GET",
    url,
    accessKeyId,
    secretAccessKey,
    region,
  });
  const res = await fetchWithTimeout(url.toString(), {
    method: "GET",
    headers: {
      Authorization: authorization,
      "x-amz-date": amzDate,
      "x-amz-content-sha256": payloadHash,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    const lower = text.toLowerCase();
    if (lower.includes("invalidaccesskeyid") || lower.includes("signaturedoesnotmatch") || lower.includes("accessdenied")) {
      return { ok: false, error: "invalid_credentials", details: text.slice(0, 400) };
    }
    return { ok: false, error: "s3_probe_failed", details: text.slice(0, 400) };
  }
  return { ok: true, message: "storage_probe_success" };
}

async function testAzureBlobConnection(cfg) {
  const accountName = trimString(cfg?.accountName);
  const accountKey = trimString(decryptSettingValue(String(cfg?.accountKey || "")));
  const container = trimString(cfg?.container);
  const endpointSuffix = trimString(cfg?.endpointSuffix, "blob.core.windows.net");
  if (!accountName || !accountKey || !container) {
    return { ok: false, error: "azure_not_configured" };
  }
  const url = new URL(`https://${accountName}.${endpointSuffix}/${container}`);
  url.searchParams.set("restype", "container");
  url.searchParams.set("comp", "list");
  url.searchParams.set("maxresults", "1");
  const { authorization, xmsDate, xmsVersion } = buildAzureSharedKeyAuth({
    method: "GET",
    url,
    accountName,
    accountKey,
  });
  const res = await fetchWithTimeout(url.toString(), {
    method: "GET",
    headers: {
      Authorization: authorization,
      "x-ms-date": xmsDate,
      "x-ms-version": xmsVersion,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    const lower = text.toLowerCase();
    if (lower.includes("authenticationfailed") || lower.includes("authorizationfailure")) {
      return { ok: false, error: "invalid_credentials", details: text.slice(0, 400) };
    }
    return { ok: false, error: "azure_probe_failed", details: text.slice(0, 400) };
  }
  return { ok: true, message: "storage_probe_success" };
}

function respondStorageSetting(res, scope, value, fields) {
  return res.json(makeStorageResponse(scope, value, fields));
}

async function testStorageProbe(res, probeResult, scope) {
  if (!probeResult.ok) return res.status(400).json({ ...probeResult, groupId: scope.groupId || null });
  return res.json({ ...probeResult, groupId: scope.groupId || null });
}

export async function getSftpStorageSetting(req, res) {
  try {
    const { scope, value } = await loadScopedStorageSetting(req, "sftp_storage", { globalFallback: false });
    return respondStorageSetting(res, scope, value, SFTP_FIELDS);
  } catch (err) {
    return res.status(err.statusCode || 403).json({ error: err.message || "Forbidden" });
  }
}

export async function setSftpStorageSetting(req, res) {
  try {
    assertAllowedStorageKeys(req.body || {}, SFTP_FIELDS);
    const { scope, value } = await loadScopedStorageSetting(req, "sftp_storage", { globalFallback: false });
    const next = buildStorageConfig(value, req.body || {}, SFTP_FIELDS);
    await saveScopedStorageSetting("sftp_storage", scope.groupId, next);
    return respondStorageSetting(res, scope, next, SFTP_FIELDS);
  } catch (err) {
    return res.status(err.statusCode || 403).json({ error: err.message || "Forbidden" });
  }
}

export async function testSftpStorageSetting(req, res) {
  try {
    const { scope, value } = await loadScopedStorageSetting(req, "sftp_storage", { globalFallback: false });
    const probeResult = await testSftpConnection(value);
    return testStorageProbe(res, probeResult, scope);
  } catch (err) {
    return res.status(err.statusCode || 403).json({ error: err.message || "Forbidden" });
  }
}

export async function getGcsStorageSetting(req, res) {
  try {
    const { scope, value } = await loadScopedStorageSetting(req, "gcs_storage");
    return respondStorageSetting(res, scope, value, GCS_FIELDS);
  } catch (err) {
    return res.status(err.statusCode || 403).json({ error: err.message || "Forbidden" });
  }
}

export async function setGcsStorageSetting(req, res) {
  try {
    assertAllowedStorageKeys(req.body || {}, GCS_FIELDS);
    const { scope, value } = await loadScopedStorageSetting(req, "gcs_storage");
    const next = buildStorageConfig(value, req.body || {}, GCS_FIELDS);
    await saveScopedStorageSetting("gcs_storage", scope.groupId, next);
    return respondStorageSetting(res, scope, next, GCS_FIELDS);
  } catch (err) {
    return res.status(err.statusCode || 403).json({ error: err.message || "Forbidden" });
  }
}

export async function testGcsStorageSetting(req, res) {
  try {
    const { scope, value } = await loadScopedStorageSetting(req, "gcs_storage");
    const probeResult = await testGcsConnection(value);
    return testStorageProbe(res, probeResult, scope);
  } catch (err) {
    return res.status(err.statusCode || 403).json({ error: err.message || "Forbidden" });
  }
}

export async function getS3StorageSetting(req, res) {
  try {
    const { scope, value } = await loadScopedStorageSetting(req, "s3_storage");
    return respondStorageSetting(res, scope, value, S3_FIELDS);
  } catch (err) {
    return res.status(err.statusCode || 403).json({ error: err.message || "Forbidden" });
  }
}

export async function setS3StorageSetting(req, res) {
  try {
    assertAllowedStorageKeys(req.body || {}, S3_FIELDS);
    const { scope, value } = await loadScopedStorageSetting(req, "s3_storage");
    const next = buildStorageConfig(value, req.body || {}, S3_FIELDS);
    await saveScopedStorageSetting("s3_storage", scope.groupId, next);
    return respondStorageSetting(res, scope, next, S3_FIELDS);
  } catch (err) {
    return res.status(err.statusCode || 403).json({ error: err.message || "Forbidden" });
  }
}

export async function testS3StorageSetting(req, res) {
  try {
    const { scope, value } = await loadScopedStorageSetting(req, "s3_storage");
    const probeResult = await testS3Connection(value);
    return testStorageProbe(res, probeResult, scope);
  } catch (err) {
    return res.status(err.statusCode || 403).json({ error: err.message || "Forbidden" });
  }
}

export async function getAzureBlobStorageSetting(req, res) {
  try {
    const { scope, value } = await loadScopedStorageSetting(req, "azure_blob_storage");
    return respondStorageSetting(res, scope, value, AZURE_FIELDS);
  } catch (err) {
    return res.status(err.statusCode || 403).json({ error: err.message || "Forbidden" });
  }
}

export async function setAzureBlobStorageSetting(req, res) {
  try {
    assertAllowedStorageKeys(req.body || {}, AZURE_FIELDS);
    const { scope, value } = await loadScopedStorageSetting(req, "azure_blob_storage");
    const next = buildStorageConfig(value, req.body || {}, AZURE_FIELDS);
    await saveScopedStorageSetting("azure_blob_storage", scope.groupId, next);
    return respondStorageSetting(res, scope, next, AZURE_FIELDS);
  } catch (err) {
    return res.status(err.statusCode || 403).json({ error: err.message || "Forbidden" });
  }
}

export async function testAzureBlobStorageSetting(req, res) {
  try {
    const { scope, value } = await loadScopedStorageSetting(req, "azure_blob_storage");
    const probeResult = await testAzureBlobConnection(value);
    return testStorageProbe(res, probeResult, scope);
  } catch (err) {
    return res.status(err.statusCode || 403).json({ error: err.message || "Forbidden" });
  }
}

function normalizeProviderRouteParam(req) {
  const provider = normalizeStorageProviderKey(req.params?.provider);
  if (!provider) {
    const err = new Error("unsupported_storage_provider");
    err.statusCode = 400;
    throw err;
  }
  return provider;
}

export async function getStorageProviderStatus(req, res) {
  try {
    const provider = normalizeProviderRouteParam(req);
    const scope = await resolveScopedGroupForIntegrationSettings(req);
    const status = await getStorageProviderRuntimeStatus(provider, scope.groupId);
    return res.json(status);
  } catch (err) {
    return res.status(err.statusCode || 403).json({ error: err.message || "Forbidden" });
  }
}

export async function listStorageProviderFiles(req, res) {
  try {
    const provider = normalizeProviderRouteParam(req);
    const scope = await resolveScopedGroupForIntegrationSettings(req);
    const currentPath = String(req.query?.path || req.query?.prefix || req.query?.remotePath || "").trim();
    const result = await listStorageProviderEntries({ provider, groupId: scope.groupId, path: currentPath });
    return res.json(result);
  } catch (err) {
    const code = err.statusCode || 403;
    const msg = String(err?.message || "");
    if (msg.includes("storage_provider_disabled")) {
      return res.status(403).json({ error: "storage_provider_disabled" });
    }
    return res.status(code).json({ error: err.message || "Forbidden" });
  }
}

export async function importStorageProviderFile(req, res) {
  let tmpPath = null;
  try {
    const provider = normalizeProviderRouteParam(req);
    const scope = await resolveScopedGroupForIntegrationSettings(req);
    const displayName = String(req.body?.display_name || req.body?.displayName || "").trim();
    const fileLabel = String(req.body?.file_label || req.body?.fileLabel || "").trim();
    const autosyncEnabled = ["1", "true", "yes", "on"].includes(String(req.body?.autosync_enabled ?? req.body?.autosyncEnabled ?? "").trim().toLowerCase());
    const sourceRef = String(
      req.body?.sourceRef
      || req.body?.source_ref
      || req.body?.path
      || req.body?.objectName
      || req.body?.blobName
      || req.body?.key
      || ""
    ).trim();
    const fileName = String(req.body?.name || req.body?.fileName || sourceRef || "storage-file").trim();
    if (!sourceRef) return res.status(400).json({ error: "source_ref_required" });
    if (!displayName) return res.status(400).json({ error: "display_name_required" });
    const downloaded = await downloadStorageProviderFile({
      provider,
      groupId: scope.groupId,
      userId: req.user?.id,
      sourceRef,
    });

    const ext = path.extname(fileName || "") || downloaded.extension || ".xlsx";
    const safeBase = (fileName || "storage-file").replace(/[^\w.-]+/g, "_");
    const originalname = safeBase.endsWith(ext) ? safeBase : `${safeBase}${ext}`;
    tmpPath = path.join(tmpdir(), `${provider}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`);
    await fs.promises.writeFile(tmpPath, downloaded.buffer);

    req.file = {
      path: tmpPath,
      originalname,
      mimetype: downloaded.mimeType || "application/octet-stream",
      size: downloaded.buffer.length,
    };
    req.body = {
      ...(req.body || {}),
      display_name: displayName,
      ...(autosyncEnabled ? {
        autosync_enabled: "1",
        autosync_provider: provider,
        autosync_source_ref: sourceRef,
        autosync_group_id: String(scope.groupId || ""),
        autosync_user_id: String(req.user?.id || ""),
        autosync_remote_marker: downloaded.remoteMarker || "",
        autosync_remote_modified_at: downloaded.remoteModifiedAt || "",
        autosync_display_name: displayName,
        autosync_file_label: fileLabel || displayName,
      } : {}),
    };

    return uploadSheet(req, res);
  } catch (err) {
    console.error("storage import failed:", err?.message || err);
    const msg = String(err?.message || "");
    if (msg.includes("storage_provider_disabled")) {
      return res.status(403).json({ error: "storage_provider_disabled" });
    }
    if (err?.statusCode === 413 || msg.includes("provider_file_too_large")) {
      return res.status(413).json({ error: "file_too_large", maxMB: Math.floor((err.maxBytes || 0) / (1024 * 1024)) || Math.floor(100 * 1024 * 1024 / (1024 * 1024)) });
    }
    return res.status(500).json({ error: "storage_import_failed", details: { message: String(err?.message || "storage_import_failed") } });
  } finally {
    if (tmpPath) {
      try { await fs.promises.rm(tmpPath, { force: true }); } catch {}
    }
  }
}
