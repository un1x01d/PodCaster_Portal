import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { createHash, createHmac, createSign } from "crypto";
import { query } from "../config/db.js";
import { decryptSettingValue } from "./settingsCrypto.js";

const STORAGE_PROVIDER_DEFS = {
  sftp_storage: { label: "SFTP", settingKey: "sftp_storage" },
  gcs_storage: { label: "Google Cloud Storage", settingKey: "gcs_storage" },
  s3_storage: { label: "Amazon S3", settingKey: "s3_storage" },
  azure_blob_storage: { label: "Azure Blob Storage", settingKey: "azure_blob_storage" },
};

const PROVIDER_TIMEOUT_MS = Number.parseInt(process.env.PROVIDER_FETCH_TIMEOUT_MS || "15000", 10);
const PROVIDER_IMPORT_MAX_BYTES = Number.parseInt(process.env.PROVIDER_IMPORT_MAX_BYTES || `${100 * 1024 * 1024}`, 10);

function parsePositiveInt(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function trimString(value, fallback = "") {
  const raw = value === undefined || value === null ? fallback : value;
  return String(raw || "").trim();
}

function toBoolean(value, fallback = false) {
  if (value === undefined) return !!fallback;
  return !!value;
}

function normalizeStorageProviderKey(provider) {
  const normalized = String(provider || "").trim().toLowerCase();
  if (STORAGE_PROVIDER_DEFS[normalized]) return normalized;
  if (normalized === "sftp") return "sftp_storage";
  if (normalized === "gcs" || normalized === "gcs_storage") return "gcs_storage";
  if (normalized === "s3") return "s3_storage";
  if (normalized === "azure" || normalized === "azure_blob" || normalized === "azure_blob_storage") return "azure_blob_storage";
  return null;
}

export { normalizeStorageProviderKey };

function appSettingKeyForGroup(baseKey, groupId) {
  return Number.isInteger(groupId) && groupId > 0 ? `group:${groupId}:${baseKey}` : baseKey;
}

async function getSettingValueWithGlobalFallback(baseKey, groupId) {
  const scopedKey = appSettingKeyForGroup(baseKey, groupId);
  const scopedRows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [scopedKey]);
  if (scopedRows.length) return scopedRows[0]?.value || null;
  if (!Number.isInteger(groupId) || groupId <= 0) return null;
  const globalRows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [baseKey]);
  return globalRows[0]?.value || null;
}

function supportedSpreadsheetExt(name) {
  const lower = String(name || "").toLowerCase();
  return lower.endsWith(".csv") || lower.endsWith(".xls") || lower.endsWith(".xlsx");
}

function decodeXmlEntities(value) {
  return String(value || "")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'");
}

function shellQuote(value) {
  return `'${String(value || "").replaceAll("'", `'\\''`)}'`;
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

function assertProviderContentLengthWithinLimit(response) {
  const raw = response?.headers?.get?.("content-length");
  const parsed = Number.parseInt(String(raw || ""), 10);
  if (Number.isFinite(parsed) && parsed > PROVIDER_IMPORT_MAX_BYTES) {
    const err = new Error("provider_file_too_large");
    err.statusCode = 413;
    err.maxBytes = PROVIDER_IMPORT_MAX_BYTES;
    throw err;
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = PROVIDER_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function loadStorageProviderConfig(provider, groupId = null) {
  const normalizedProvider = normalizeStorageProviderKey(provider);
  if (!normalizedProvider) return null;
  const def = STORAGE_PROVIDER_DEFS[normalizedProvider];
  const value = await getSettingValueWithGlobalFallback(def.settingKey, groupId);
  return value || null;
}

async function isStorageProviderEnabled(provider, groupId = null) {
  const cfg = await loadStorageProviderConfig(provider, groupId);
  return !!cfg?.enabled;
}

function spawnWithTimeout(command, args, options = {}, timeoutMs = PROVIDER_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const proc = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], ...options });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => proc.kill("SIGKILL"), timeoutMs);
    proc.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    proc.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    proc.on("error", (err) => {
      clearTimeout(timeout);
      resolve({ ok: false, code: -1, stdout, stderr, error: err });
    });
    proc.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ ok: code === 0, code, stdout, stderr });
    });
  });
}

function buildSshAuthContext(cfg) {
  const host = trimString(cfg?.host);
  const username = trimString(cfg?.username);
  const port = parsePositiveInt(cfg?.port) || 22;
  if (!host || !username) return null;

  const args = [
    "-o", "BatchMode=no",
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", "ConnectTimeout=10",
    "-o", "ServerAliveInterval=5",
    "-o", "ServerAliveCountMax=1",
    "-p", String(port),
  ];

  const env = { ...process.env };
  const cleanup = [];
  if (trimString(cfg?.authMode, "password") === "ssh_key") {
    const privateKey = trimString(decryptSettingValue(String(cfg?.privateKey || "")));
    if (!privateKey) return null;
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "storage-sftp-"));
    const keyPath = path.join(tmpDir, "id_rsa");
    fs.writeFileSync(keyPath, privateKey, { mode: 0o600 });
    cleanup.push(() => {
      try { fs.unlinkSync(keyPath); } catch {}
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    });
    args.push("-i", keyPath, "-o", "IdentitiesOnly=yes", "-o", "PreferredAuthentications=publickey");
    const passphrase = trimString(decryptSettingValue(String(cfg?.passphrase || "")));
    if (passphrase) {
      const scriptPath = path.join(tmpDir, "askpass.sh");
      fs.writeFileSync(scriptPath, `#!/bin/sh\nprintf '%s\\n' "${passphrase.replaceAll("\"", "\\\"")}"\n`, { mode: 0o700 });
      cleanup.push(() => {
        try { fs.unlinkSync(scriptPath); } catch {}
      });
      env.SSH_ASKPASS = scriptPath;
      env.SSH_ASKPASS_REQUIRE = "force";
      env.DISPLAY = env.DISPLAY || "codex";
    }
  } else {
    const password = trimString(decryptSettingValue(String(cfg?.password || "")));
    if (!password) return null;
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "storage-sftp-"));
    const scriptPath = path.join(tmpDir, "askpass.sh");
    fs.writeFileSync(scriptPath, `#!/bin/sh\nprintf '%s\\n' "${password.replaceAll("\"", "\\\"")}"\n`, { mode: 0o700 });
    cleanup.push(() => {
      try { fs.unlinkSync(scriptPath); } catch {}
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    });
    env.SSH_ASKPASS = scriptPath;
    env.SSH_ASKPASS_REQUIRE = "force";
    env.DISPLAY = env.DISPLAY || "codex";
    args.push("-o", "PreferredAuthentications=password,keyboard-interactive");
    args.push("-o", "PubkeyAuthentication=no");
  }

  return {
    host,
    username,
    target: `${username}@${host}`,
    port,
    args,
    env,
    cleanup,
  };
}

async function runSshCommand(cfg, remoteArgs, timeoutMs = PROVIDER_TIMEOUT_MS) {
  const ctx = buildSshAuthContext(cfg);
  if (!ctx) {
    return { ok: false, error: "sftp_not_configured" };
  }
  try {
    const proc = spawn("ssh", [...ctx.args, ctx.target, ...remoteArgs], {
      env: ctx.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => proc.kill("SIGKILL"), timeoutMs);
    proc.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    proc.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    return await new Promise((resolve) => {
      proc.on("error", (err) => {
        clearTimeout(timeout);
        resolve({ ok: false, error: err?.message || "ssh_command_unavailable", stdout, stderr });
      });
      proc.on("close", (code) => {
        clearTimeout(timeout);
        resolve({ ok: code === 0, code, stdout, stderr });
      });
    });
  } finally {
    for (const cleanupFn of ctx.cleanup || []) {
      try { cleanupFn(); } catch {}
    }
  }
}

async function listSftpEntries(cfg, currentPath) {
  const pathArg = trimString(currentPath, trimString(cfg?.remotePath, ".") || ".");
  const result = await runSshCommand(cfg, [
    "find",
    pathArg,
    "-mindepth",
    "1",
    "-maxdepth",
    "1",
    "-printf",
    "%y\t%P\t%p\t%s\t%TY-%Tm-%TdT%TH:%TM:%TS\n",
  ]);
  if (!result.ok) {
    const text = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
    throw new Error(`sftp_list_failed: ${text.slice(0, 400)}`);
  }
  const entries = String(result.stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [kind, relName = "", fullPath = "", size = "0", updatedAt = ""] = line.split("\t");
      const isFolder = kind === "d";
      const name = relName || path.basename(fullPath);
      const resolvedPath = fullPath || (path.posix.join(pathArg, name));
      return {
        id: resolvedPath,
        name,
        path: resolvedPath,
        isFolder,
        size: Number.parseInt(size, 10) || 0,
        updatedAt: updatedAt || null,
      };
    })
    .filter((entry) => entry.id);
  return { entries, path: pathArg };
}

async function fetchSftpMetadata(cfg, sourceRef) {
  const filePath = trimString(sourceRef);
  const result = await runSshCommand(cfg, [
    "stat",
    "-c",
    "%Y\t%s\t%n",
    filePath,
  ]);
  if (!result.ok) {
    const text = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
    throw new Error(`sftp_metadata_failed: ${text.slice(0, 400)}`);
  }
  const [mtime = "", size = "", name = ""] = String(result.stdout || "").trim().split("\t");
  return {
    provider: "sftp_storage",
    sourceRef: filePath,
    remoteMarker: [mtime, size].filter(Boolean).join("|") || filePath,
    remoteModifiedAt: mtime ? new Date(Number.parseInt(mtime, 10) * 1000).toISOString() : null,
    originalName: path.basename(name || filePath || "sftp-file"),
    sftpPath: filePath,
  };
}

async function downloadSftpFile(cfg, sourceRef) {
  const ctx = buildSshAuthContext(cfg);
  if (!ctx) throw new Error("sftp_not_configured");
  const filePath = trimString(sourceRef);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "storage-sftp-dl-"));
  const localPath = path.join(tmpDir, path.basename(filePath) || "download.xlsx");
  try {
    const scpArgs = [...ctx.args, "-q", `${ctx.target}:${filePath}`, localPath];
    const proc = spawn("scp", scpArgs, { env: ctx.env, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    const code = await new Promise((resolve) => {
      const timeout = setTimeout(() => proc.kill("SIGKILL"), PROVIDER_TIMEOUT_MS);
      proc.on("error", () => {
        clearTimeout(timeout);
        resolve(-1);
      });
      proc.on("close", (exitCode) => {
        clearTimeout(timeout);
        resolve(exitCode);
      });
    });
    if (code !== 0) {
      throw new Error(`sftp_download_failed: ${String(stderr || "").slice(0, 400)}`);
    }
    const buf = await fs.promises.readFile(localPath);
    const lowerName = filePath.toLowerCase();
    return {
      buffer: buf,
      mimeType: "application/octet-stream",
      extension: lowerName.endsWith(".csv") ? ".csv" : (lowerName.endsWith(".xls") ? ".xls" : ".xlsx"),
      originalName: path.basename(filePath),
      sftpPath: filePath,
    };
  } finally {
    try { await fs.promises.rm(tmpDir, { recursive: true, force: true }); } catch {}
    for (const cleanupFn of ctx.cleanup || []) {
      try { cleanupFn(); } catch {}
    }
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

async function getGcsAccessToken(cfg) {
  const tokenUri = trimString(cfg?.tokenUri, "https://oauth2.googleapis.com/token");
  const assertion = createGcsJwtAssertion(cfg, tokenUri);
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
    throw new Error(`gcs_token_exchange_failed: ${text.slice(0, 300)}`);
  }
  const tokenJson = await tokenRes.json();
  const accessToken = trimString(tokenJson?.access_token);
  if (!accessToken) throw new Error("gcs_access_token_missing");
  return accessToken;
}

function normalizeGcsPrefix(prefix) {
  const normalized = trimString(prefix);
  if (!normalized) return "";
  return normalized.endsWith("/") ? normalized : `${normalized}/`;
}

function objectNameToLabel(name, prefix) {
  const cleanName = String(name || "").replace(/\/+$/, "");
  const cleanPrefix = normalizeGcsPrefix(prefix);
  if (cleanPrefix && cleanName.startsWith(cleanPrefix)) {
    return cleanName.slice(cleanPrefix.length).split("/")[0];
  }
  return cleanName.split("/").filter(Boolean).pop() || cleanName;
}

async function listGcsEntries(cfg, currentPath) {
  const bucket = trimString(cfg?.bucket);
  if (!bucket) throw new Error("gcs_not_configured");
  const prefix = normalizeGcsPrefix(trimString(currentPath, trimString(cfg?.prefix, "")));
  const accessToken = await getGcsAccessToken(cfg);
  const url = new URL(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o`);
  if (prefix) url.searchParams.set("prefix", prefix);
  url.searchParams.set("delimiter", "/");
  url.searchParams.set("fields", "items(name,size,updated),prefixes");
  const res = await fetchWithTimeout(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`gcs_list_failed: ${text.slice(0, 400)}`);
  }
  const json = await res.json();
  const files = Array.isArray(json?.items) ? json.items : [];
  const folders = Array.isArray(json?.prefixes) ? json.prefixes : [];
  const entries = [
    ...folders.map((folderPath) => ({
      id: folderPath,
      name: objectNameToLabel(folderPath, prefix),
      path: folderPath,
      isFolder: true,
      size: 0,
      updatedAt: null,
    })),
    ...files
      .filter((item) => supportedSpreadsheetExt(item?.name))
      .map((item) => ({
        id: String(item?.name || ""),
        name: objectNameToLabel(item?.name, prefix),
        path: String(item?.name || ""),
        isFolder: false,
        size: Number.parseInt(item?.size, 10) || 0,
        updatedAt: item?.updated || null,
      })),
  ].filter((entry) => entry.id);
  return { entries, path: prefix || "" };
}

async function fetchGcsMetadata(cfg, sourceRef) {
  const bucket = trimString(cfg?.bucket);
  const objectName = trimString(sourceRef);
  if (!bucket || !objectName) throw new Error("gcs_not_configured");
  const accessToken = await getGcsAccessToken(cfg);
  const url = new URL(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(objectName)}`);
  url.searchParams.set("fields", "name,updated,size,generation,md5Hash");
  const res = await fetchWithTimeout(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`gcs_metadata_failed: ${text.slice(0, 400)}`);
  }
  const meta = await res.json();
  return {
    provider: "gcs_storage",
    sourceRef: objectName,
    remoteMarker: [meta?.generation, meta?.md5Hash, meta?.updated].filter(Boolean).join("|") || objectName,
    remoteModifiedAt: meta?.updated || null,
    originalName: path.basename(objectName) || "gcs-file",
    gcsBucket: bucket,
    gcsObjectName: objectName,
  };
}

async function downloadGcsFile(cfg, sourceRef) {
  const bucket = trimString(cfg?.bucket);
  const objectName = trimString(sourceRef);
  if (!bucket || !objectName) throw new Error("gcs_not_configured");
  const accessToken = await getGcsAccessToken(cfg);
  const url = new URL(`https://storage.googleapis.com/download/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(objectName)}`);
  url.searchParams.set("alt", "media");
  const res = await fetchWithTimeout(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`gcs_download_failed: ${text.slice(0, 400)}`);
  }
  assertProviderContentLengthWithinLimit(res);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > PROVIDER_IMPORT_MAX_BYTES) {
    const err = new Error("provider_file_too_large");
    err.statusCode = 413;
    err.maxBytes = PROVIDER_IMPORT_MAX_BYTES;
    throw err;
  }
  return {
    buffer: buf,
    mimeType: "application/octet-stream",
    extension: objectName.toLowerCase().endsWith(".csv") ? ".csv" : (objectName.toLowerCase().endsWith(".xls") ? ".xls" : ".xlsx"),
    originalName: path.basename(objectName) || "gcs-file",
    gcsBucket: bucket,
    gcsObjectName: objectName,
  };
}

function buildS3Url(cfg, { pathName = "/", queryParams = {}, method = "GET" } = {}) {
  const bucket = trimString(cfg?.bucket);
  const region = trimString(cfg?.region);
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
  url.pathname = pathStyleAccess && endpointUrl
    ? `${url.pathname.replace(/\/$/, "")}${pathName.startsWith("/") ? pathName : `/${pathName}`}`
    : (pathName || "/");
  for (const [k, v] of Object.entries(queryParams || {})) {
    if (v !== undefined && v !== null && `${v}` !== "") url.searchParams.set(k, String(v));
  }
  const accessKeyId = trimString(cfg?.accessKeyId);
  const secretAccessKey = trimString(decryptSettingValue(String(cfg?.secretAccessKey || "")));
  if (!bucket || !region || !accessKeyId || !secretAccessKey) {
    throw new Error("s3_not_configured");
  }
  const amzDate = awsAmzDate();
  const dateStamp = awsDateStamp(amzDate);
  const payloadHash = awsHexSha256("");
  const canonicalHeaders = `host:${url.host}\n` + `x-amz-content-sha256:${payloadHash}\n` + `x-amz-date:${amzDate}\n`;
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
  return { url, authorization, amzDate, payloadHash };
}

function parseAwsListXml(xml) {
  const text = String(xml || "");
  const folders = [];
  const files = [];
  const folderRegex = /<CommonPrefixes>\s*<Prefix>(.*?)<\/Prefix>\s*<\/CommonPrefixes>/gms;
  let match;
  while ((match = folderRegex.exec(text))) {
    folders.push(decodeXmlEntities(match[1]));
  }
  const fileRegex = /<Contents>\s*<Key>(.*?)<\/Key>[\s\S]*?<LastModified>(.*?)<\/LastModified>[\s\S]*?<Size>(.*?)<\/Size>[\s\S]*?<\/Contents>/gms;
  while ((match = fileRegex.exec(text))) {
    files.push({
      key: decodeXmlEntities(match[1]),
      updatedAt: decodeXmlEntities(match[2]),
      size: Number.parseInt(match[3], 10) || 0,
    });
  }
  return { folders, files };
}

async function listS3Entries(cfg, currentPath) {
  const prefix = trimString(currentPath, trimString(cfg?.prefix, ""));
  const { url, authorization, amzDate, payloadHash } = buildS3Url(cfg, {
    pathName: "/",
    queryParams: {
      "list-type": "2",
      delimiter: "/",
      ...(prefix ? { prefix } : {}),
    },
    method: "GET",
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
    throw new Error(`s3_list_failed: ${text.slice(0, 400)}`);
  }
  const xml = await res.text();
  const { folders, files } = parseAwsListXml(xml);
  const entries = [
    ...folders.map((folderPath) => ({
      id: folderPath,
      name: folderPath.replace(/\/+$/, "").split("/").filter(Boolean).pop() || folderPath,
      path: folderPath,
      isFolder: true,
      size: 0,
      updatedAt: null,
    })),
    ...files
      .filter((item) => supportedSpreadsheetExt(item.key))
      .map((item) => ({
        id: item.key,
        name: item.key.replace(/\/+$/, "").split("/").filter(Boolean).pop() || item.key,
        path: item.key,
        isFolder: false,
        size: item.size,
        updatedAt: item.updatedAt || null,
      })),
  ].filter((entry) => entry.id);
  return { entries, path: prefix || "" };
}

async function fetchS3Metadata(cfg, sourceRef) {
  const key = trimString(sourceRef);
  const { url, authorization, amzDate, payloadHash } = buildS3Url(cfg, {
    pathName: `/${key}`,
    method: "HEAD",
  });
  const res = await fetchWithTimeout(url.toString(), {
    method: "HEAD",
    headers: {
      Authorization: authorization,
      "x-amz-date": amzDate,
      "x-amz-content-sha256": payloadHash,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`s3_metadata_failed: ${text.slice(0, 400)}`);
  }
  const etag = String(res.headers.get("etag") || "").replaceAll("\"", "");
  const lastModified = res.headers.get("last-modified") || null;
  const size = res.headers.get("content-length") || null;
  return {
    provider: "s3_storage",
    sourceRef: key,
    remoteMarker: [etag, lastModified, size].filter(Boolean).join("|") || key,
    remoteModifiedAt: lastModified || null,
    originalName: path.basename(key) || "s3-file",
    s3Key: key,
  };
}

async function downloadS3File(cfg, sourceRef) {
  const key = trimString(sourceRef);
  const { url, authorization, amzDate, payloadHash } = buildS3Url(cfg, {
    pathName: `/${key}`,
    method: "GET",
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
    throw new Error(`s3_download_failed: ${text.slice(0, 400)}`);
  }
  assertProviderContentLengthWithinLimit(res);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > PROVIDER_IMPORT_MAX_BYTES) {
    const err = new Error("provider_file_too_large");
    err.statusCode = 413;
    err.maxBytes = PROVIDER_IMPORT_MAX_BYTES;
    throw err;
  }
  return {
    buffer: buf,
    mimeType: "application/octet-stream",
    extension: key.toLowerCase().endsWith(".csv") ? ".csv" : (key.toLowerCase().endsWith(".xls") ? ".xls" : ".xlsx"),
    originalName: path.basename(key) || "s3-file",
    s3Key: key,
  };
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
  const contentLength = method === "GET" || method === "HEAD" ? "" : "0";
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

function normalizeAzurePrefix(prefix) {
  const normalized = trimString(prefix);
  if (!normalized) return "";
  return normalized.endsWith("/") ? normalized : `${normalized}/`;
}

function parseAzureListXml(xml) {
  const text = String(xml || "");
  const folders = [];
  const files = [];
  const folderRegex = /<BlobPrefix>\s*<Name>(.*?)<\/Name>\s*<\/BlobPrefix>/gms;
  let match;
  while ((match = folderRegex.exec(text))) {
    folders.push(decodeXmlEntities(match[1]));
  }
  const fileRegex = /<Blob>\s*<Name>(.*?)<\/Name>[\s\S]*?<Properties>[\s\S]*?<Last-Modified>(.*?)<\/Last-Modified>[\s\S]*?<Content-Length>(.*?)<\/Content-Length>[\s\S]*?<\/Properties>[\s\S]*?<\/Blob>/gms;
  while ((match = fileRegex.exec(text))) {
    files.push({
      name: decodeXmlEntities(match[1]),
      updatedAt: decodeXmlEntities(match[2]),
      size: Number.parseInt(match[3], 10) || 0,
    });
  }
  return { folders, files };
}

async function listAzureEntries(cfg, currentPath) {
  const accountName = trimString(cfg?.accountName);
  const container = trimString(cfg?.container);
  const endpointSuffix = trimString(cfg?.endpointSuffix, "blob.core.windows.net");
  if (!accountName || !container) throw new Error("azure_not_configured");
  const prefix = normalizeAzurePrefix(trimString(currentPath, trimString(cfg?.prefix, "")));
  const url = new URL(`https://${accountName}.${endpointSuffix}/${container}`);
  url.searchParams.set("restype", "container");
  url.searchParams.set("comp", "list");
  url.searchParams.set("delimiter", "/");
  url.searchParams.set("maxresults", "1000");
  if (prefix) url.searchParams.set("prefix", prefix);
  const { authorization, xmsDate, xmsVersion } = buildAzureSharedKeyAuth({
    method: "GET",
    url,
    accountName,
    accountKey: trimString(decryptSettingValue(String(cfg?.accountKey || ""))),
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
    throw new Error(`azure_list_failed: ${text.slice(0, 400)}`);
  }
  const xml = await res.text();
  const { folders, files } = parseAzureListXml(xml);
  const entries = [
    ...folders.map((folderPath) => ({
      id: folderPath,
      name: folderPath.replace(/\/+$/, "").split("/").filter(Boolean).pop() || folderPath,
      path: folderPath,
      isFolder: true,
      size: 0,
      updatedAt: null,
    })),
    ...files
      .filter((item) => supportedSpreadsheetExt(item.name))
      .map((item) => ({
        id: item.name,
        name: item.name.replace(/\/+$/, "").split("/").filter(Boolean).pop() || item.name,
        path: item.name,
        isFolder: false,
        size: item.size,
        updatedAt: item.updatedAt || null,
      })),
  ].filter((entry) => entry.id);
  return { entries, path: prefix || "" };
}

async function fetchAzureMetadata(cfg, sourceRef) {
  const accountName = trimString(cfg?.accountName);
  const container = trimString(cfg?.container);
  const endpointSuffix = trimString(cfg?.endpointSuffix, "blob.core.windows.net");
  const blobName = trimString(sourceRef);
  if (!accountName || !container || !blobName) throw new Error("azure_not_configured");
  const url = new URL(`https://${accountName}.${endpointSuffix}/${container}/${blobName}`);
  const { authorization, xmsDate, xmsVersion } = buildAzureSharedKeyAuth({
    method: "HEAD",
    url,
    accountName,
    accountKey: trimString(decryptSettingValue(String(cfg?.accountKey || ""))),
  });
  const res = await fetchWithTimeout(url.toString(), {
    method: "HEAD",
    headers: {
      Authorization: authorization,
      "x-ms-date": xmsDate,
      "x-ms-version": xmsVersion,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`azure_metadata_failed: ${text.slice(0, 400)}`);
  }
  const lastModified = res.headers.get("last-modified") || null;
  const size = res.headers.get("content-length") || null;
  const etag = String(res.headers.get("etag") || "").replaceAll("\"", "");
  return {
    provider: "azure_blob_storage",
    sourceRef: blobName,
    remoteMarker: [etag, lastModified, size].filter(Boolean).join("|") || blobName,
    remoteModifiedAt: lastModified || null,
    originalName: path.basename(blobName) || "azure-file",
    azureBlobName: blobName,
  };
}

async function downloadAzureFile(cfg, sourceRef) {
  const accountName = trimString(cfg?.accountName);
  const container = trimString(cfg?.container);
  const endpointSuffix = trimString(cfg?.endpointSuffix, "blob.core.windows.net");
  const blobName = trimString(sourceRef);
  if (!accountName || !container || !blobName) throw new Error("azure_not_configured");
  const url = new URL(`https://${accountName}.${endpointSuffix}/${container}/${blobName}`);
  const { authorization, xmsDate, xmsVersion } = buildAzureSharedKeyAuth({
    method: "GET",
    url,
    accountName,
    accountKey: trimString(decryptSettingValue(String(cfg?.accountKey || ""))),
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
    throw new Error(`azure_download_failed: ${text.slice(0, 400)}`);
  }
  assertProviderContentLengthWithinLimit(res);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > PROVIDER_IMPORT_MAX_BYTES) {
    const err = new Error("provider_file_too_large");
    err.statusCode = 413;
    err.maxBytes = PROVIDER_IMPORT_MAX_BYTES;
    throw err;
  }
  return {
    buffer: buf,
    mimeType: "application/octet-stream",
    extension: blobName.toLowerCase().endsWith(".csv") ? ".csv" : (blobName.toLowerCase().endsWith(".xls") ? ".xls" : ".xlsx"),
    originalName: path.basename(blobName) || "azure-file",
    azureBlobName: blobName,
  };
}

export async function getStorageProviderStatus(provider, groupId = null) {
  const normalizedProvider = normalizeStorageProviderKey(provider);
  if (!normalizedProvider) throw new Error("unsupported_storage_provider");
  const cfg = await loadStorageProviderConfig(normalizedProvider, groupId);
  return {
    provider: normalizedProvider,
    enabled: !!cfg?.enabled,
    configured: !!cfg,
    groupId: Number.isInteger(groupId) && groupId > 0 ? groupId : null,
  };
}

export async function listStorageProviderEntries({ provider, groupId = null, path: currentPath = "" }) {
  const normalizedProvider = normalizeStorageProviderKey(provider);
  if (!normalizedProvider) throw new Error("unsupported_storage_provider");
  const cfg = await loadStorageProviderConfig(normalizedProvider, groupId);
  if (!cfg?.enabled) throw new Error("storage_provider_disabled");

  if (normalizedProvider === "sftp_storage") return listSftpEntries(cfg, currentPath);
  if (normalizedProvider === "gcs_storage") return listGcsEntries(cfg, currentPath);
  if (normalizedProvider === "s3_storage") return listS3Entries(cfg, currentPath);
  if (normalizedProvider === "azure_blob_storage") return listAzureEntries(cfg, currentPath);
  throw new Error("unsupported_storage_provider");
}

export async function fetchStorageProviderMetadata({ provider, groupId = null, userId = null, sourceRef = null }) {
  const normalizedProvider = normalizeStorageProviderKey(provider);
  const ref = trimString(sourceRef);
  if (!normalizedProvider || !ref) return null;
  const cfg = await loadStorageProviderConfig(normalizedProvider, groupId);
  if (!cfg?.enabled) throw new Error("storage_provider_disabled");

  if (normalizedProvider === "sftp_storage") return fetchSftpMetadata(cfg, ref);
  if (normalizedProvider === "gcs_storage") return fetchGcsMetadata(cfg, ref);
  if (normalizedProvider === "s3_storage") return fetchS3Metadata(cfg, ref);
  if (normalizedProvider === "azure_blob_storage") return fetchAzureMetadata(cfg, ref);
  throw new Error("unsupported_storage_provider");
}

export async function downloadStorageProviderFile({ provider, groupId = null, userId = null, sourceRef = null }) {
  const normalizedProvider = normalizeStorageProviderKey(provider);
  const ref = trimString(sourceRef);
  if (!normalizedProvider || !ref) return null;
  const cfg = await loadStorageProviderConfig(normalizedProvider, groupId);
  if (!cfg?.enabled) throw new Error("storage_provider_disabled");

  if (normalizedProvider === "sftp_storage") {
    const meta = await fetchSftpMetadata(cfg, ref);
    const download = await downloadSftpFile(cfg, ref);
    return { ...meta, ...download, provider: "sftp_storage", sourceRef: ref };
  }
  if (normalizedProvider === "gcs_storage") {
    const meta = await fetchGcsMetadata(cfg, ref);
    const download = await downloadGcsFile(cfg, ref);
    return { ...meta, ...download, provider: "gcs_storage", sourceRef: ref };
  }
  if (normalizedProvider === "s3_storage") {
    const meta = await fetchS3Metadata(cfg, ref);
    const download = await downloadS3File(cfg, ref);
    return { ...meta, ...download, provider: "s3_storage", sourceRef: ref };
  }
  if (normalizedProvider === "azure_blob_storage") {
    const meta = await fetchAzureMetadata(cfg, ref);
    const download = await downloadAzureFile(cfg, ref);
    return { ...meta, ...download, provider: "azure_blob_storage", sourceRef: ref };
  }
  throw new Error("unsupported_storage_provider");
}
