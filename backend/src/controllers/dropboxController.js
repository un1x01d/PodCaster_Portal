import { query } from "../config/db.js";
import { uploadSheet } from "./sheetController.js";
import fs from "fs";
import path from "path";
import { tmpdir } from "os";
import { createHmac, timingSafeEqual } from "crypto";
import { decryptSettingValue } from "../utils/settingsCrypto.js";

const DROPBOX_AUTH_BASE = "https://www.dropbox.com/oauth2/authorize";
const DROPBOX_TOKEN_URL = "https://api.dropboxapi.com/oauth2/token";
const DROPBOX_ACCOUNT_URL = "https://api.dropboxapi.com/2/users/get_current_account";
const DROPBOX_LIST_FOLDER_URL = "https://api.dropboxapi.com/2/files/list_folder";
const DROPBOX_DOWNLOAD_URL = "https://content.dropboxapi.com/2/files/download";
const SUPPORTED_EXTS = [".csv", ".xls", ".xlsx"];
const DROPBOX_OAUTH_STATE_TTL_MS = 5 * 60 * 1000;
const PROVIDER_TIMEOUT_MS = Number.parseInt(process.env.PROVIDER_FETCH_TIMEOUT_MS || "15000", 10);
const PROVIDER_IMPORT_MAX_BYTES = Number.parseInt(process.env.PROVIDER_IMPORT_MAX_BYTES || `${100 * 1024 * 1024}`, 10);

function parsePositiveInt(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function appSettingKeyForGroup(baseKey, groupId) {
  return Number.isInteger(groupId) && groupId > 0 ? `group:${groupId}:${baseKey}` : baseKey;
}

function oauthConfigIsComplete(cfg) {
  return !!(
    String(cfg?.clientId || "").trim()
    && String(cfg?.clientSecret || "").trim()
    && String(cfg?.redirectUri || "").trim()
  );
}

function base64UrlEncode(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function getDropboxStateSecret() {
  const candidate = String(process.env.DROPBOX_OAUTH_STATE_SECRET || process.env.JWT_SECRET || "").trim();
  if (!candidate) throw new Error("dropbox_state_secret_missing");
  return candidate;
}

function signDropboxState(payloadB64, secret) {
  return createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

export function createDropboxOauthState(userId, groupId = null, now = Date.now()) {
  const uid = Number(userId);
  if (!Number.isInteger(uid) || uid <= 0) throw new Error("invalid_user_id");
  const payload = { uid, gid: parsePositiveInt(groupId), exp: now + DROPBOX_OAUTH_STATE_TTL_MS };
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const signature = signDropboxState(payloadB64, getDropboxStateSecret());
  return `${payloadB64}.${signature}`;
}

export function verifyDropboxOauthState(state, now = Date.now()) {
  const raw = String(state || "").trim();
  if (!raw || !raw.includes(".")) return null;
  const [payloadB64, signature] = raw.split(".");
  if (!payloadB64 || !signature) return null;

  const expected = signDropboxState(payloadB64, getDropboxStateSecret());
  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null;

  let payload;
  try {
    payload = JSON.parse(base64UrlDecode(payloadB64));
  } catch {
    return null;
  }
  const uid = Number(payload?.uid);
  const exp = Number(payload?.exp || 0);
  if (!Number.isInteger(uid) || uid <= 0) return null;
  if (!Number.isFinite(exp) || exp <= now) return null;
  return {
    userId: uid,
    groupId: parsePositiveInt(payload?.gid),
  };
}

function isSupportedSpreadsheetName(name) {
  const lower = String(name || "").toLowerCase();
  return SUPPORTED_EXTS.some((ext) => lower.endsWith(ext));
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

async function getAppSettingValueWithScopedFallback(baseKey, groupId) {
  const scopedKey = appSettingKeyForGroup(baseKey, groupId);
  const scopedRows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [scopedKey]);
  if (scopedRows.length) return scopedRows[0]?.value;
  if (!groupId) return null;
  const globalRows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [baseKey]);
  return globalRows[0]?.value || null;
}

async function isDropboxIntegrationEnabled(groupId = null) {
  try {
    const cfg = await getDropboxOauthConfig(groupId);
    return oauthConfigIsComplete(cfg);
  } catch {
    return true;
  }
}

async function getDropboxOauthConfig(groupId = null) {
  const value = await getAppSettingValueWithScopedFallback("dropbox_oauth", groupId);
  const v = value || {};
  return {
    clientId: decryptSettingValue(String(v.clientId || "")).trim(),
    clientSecret: decryptSettingValue(String(v.clientSecret || "")).trim(),
    redirectUri: String(v.redirectUri || "").trim(),
    frontendUrl: String(v.frontendUrl || "http://localhost:5173").trim(),
  };
}

async function requireDropboxConfig(groupId = null) {
  const enabled = await isDropboxIntegrationEnabled(groupId);
  if (!enabled) throw new Error("dropbox_integration_disabled");
  const cfg = await getDropboxOauthConfig(groupId);
  if (!cfg.clientId || !cfg.clientSecret || !cfg.redirectUri) {
    throw new Error("dropbox_oauth_not_configured");
  }
  return cfg;
}

async function getUserGroupIds(userId) {
  const rows = await query(
    "SELECT group_id FROM user_groups WHERE user_id = $1 ORDER BY group_id ASC",
    [userId]
  );
  return rows.map((r) => Number(r.group_id)).filter((gid) => Number.isInteger(gid) && gid > 0);
}

async function resolveScopedGroupForDropboxUser(req) {
  const requestedGroupId = parsePositiveInt(req.query?.groupId ?? req.body?.groupId);
  if (String(req.user?.role || "").toLowerCase() === "admin") return requestedGroupId;
  const groups = await getUserGroupIds(req.user?.id);
  if (!groups.length) return null;
  if (requestedGroupId && groups.includes(requestedGroupId)) return requestedGroupId;
  return groups[0];
}

async function resolveScopedGroupForUserId(userId, requestedGroupId = null) {
  const groups = await getUserGroupIds(userId);
  if (!groups.length) return null;
  if (requestedGroupId && groups.includes(requestedGroupId)) return requestedGroupId;
  return groups[0];
}

async function upsertDropboxTokens(userId, tokenPayload) {
  const expiresIn = Number(tokenPayload?.expires_in || 14400);
  const expiresAt = new Date(Date.now() + Math.max(60, expiresIn) * 1000);
  await query(
    `INSERT INTO user_dropbox_tokens (user_id, dropbox_account_id, access_token, refresh_token, scope, token_type, expires_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
     ON CONFLICT (user_id)
     DO UPDATE SET
       dropbox_account_id = EXCLUDED.dropbox_account_id,
       access_token = EXCLUDED.access_token,
       refresh_token = COALESCE(EXCLUDED.refresh_token, user_dropbox_tokens.refresh_token),
       scope = EXCLUDED.scope,
       token_type = EXCLUDED.token_type,
       expires_at = EXCLUDED.expires_at,
       updated_at = NOW()`,
    [
      userId,
      tokenPayload?.dropbox_account_id || null,
      tokenPayload?.access_token || null,
      tokenPayload?.refresh_token || null,
      tokenPayload?.scope || null,
      tokenPayload?.token_type || "Bearer",
      expiresAt.toISOString(),
    ]
  );
}

async function refreshAccessToken(cfg, refreshToken) {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
  });
  const res = await fetchWithTimeout(DROPBOX_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`dropbox_token_refresh_failed: ${text.slice(0, 300)}`);
  }
  return res.json();
}

async function getValidAccessTokenForUser(cfg, userId) {
  const rows = await query(
    "SELECT user_id, access_token, refresh_token, expires_at FROM user_dropbox_tokens WHERE user_id = $1 LIMIT 1",
    [userId]
  );
  if (!rows.length) throw new Error("dropbox_not_connected");

  const rec = rows[0];
  const expiresAt = rec.expires_at ? new Date(rec.expires_at).getTime() : 0;
  const stillValid = rec.access_token && expiresAt > (Date.now() + 60_000);
  if (stillValid) return rec.access_token;

  if (!rec.refresh_token) throw new Error("dropbox_refresh_token_missing");
  const refreshed = await refreshAccessToken(cfg, rec.refresh_token);
  await upsertDropboxTokens(userId, {
    ...refreshed,
    refresh_token: rec.refresh_token,
  });
  return refreshed.access_token;
}

async function fetchDropboxAccount(accessToken) {
  const res = await fetchWithTimeout(DROPBOX_ACCOUNT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: "null",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`dropbox_account_failed: ${text.slice(0, 300)}`);
  }
  return res.json();
}

async function isGroupAdminUser(userId) {
  const rows = await query(
    "SELECT COUNT(*)::int AS c FROM user_groups WHERE user_id = $1 AND is_admin = TRUE",
    [userId]
  );
  return Number(rows?.[0]?.c || 0) > 0;
}

export async function getDropboxStatus(req, res) {
  const groupId = await resolveScopedGroupForDropboxUser(req);
  const enabled = await isDropboxIntegrationEnabled(groupId);
  return res.json({ enabled, groupId: groupId || null });
}

export async function getDropboxAuthUrl(req, res) {
  try {
    const groupId = await resolveScopedGroupForDropboxUser(req);
    const cfg = await requireDropboxConfig(groupId);
    const state = createDropboxOauthState(req.user?.id, groupId);
    const params = new URLSearchParams({
      client_id: cfg.clientId,
      redirect_uri: cfg.redirectUri,
      response_type: "code",
      token_access_type: "offline",
      scope: "account_info.read files.metadata.read files.content.read",
      state,
    });
    return res.json({ url: `${DROPBOX_AUTH_BASE}?${params.toString()}`, groupId: groupId || null });
  } catch (e) {
    return res.status(400).json({ error: e?.message || "dropbox_oauth_not_configured" });
  }
}

export async function dropboxCallback(req, res) {
  try {
    const code = String(req.query?.code || "").trim();
    const state = String(req.query?.state || "").trim();
    if (!code || !state) {
      const cfg = await getDropboxOauthConfig();
      return res.redirect(`${cfg.frontendUrl}/workspace?dropbox_error=missing_code`);
    }

    const verified = verifyDropboxOauthState(state);
    if (!verified?.userId) {
      const cfg = await getDropboxOauthConfig();
      return res.redirect(`${cfg.frontendUrl}/workspace?dropbox_error=invalid_state`);
    }
    const resolvedGroupId = await resolveScopedGroupForUserId(verified.userId, verified.groupId);
    const cfg = await requireDropboxConfig(resolvedGroupId);

    const body = new URLSearchParams({
      code,
      grant_type: "authorization_code",
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUri,
    });
    const tokenRes = await fetchWithTimeout(DROPBOX_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      throw new Error(`dropbox_token_exchange_failed: ${text.slice(0, 300)}`);
    }
    const tokens = await tokenRes.json();
    const account = await fetchDropboxAccount(tokens.access_token);

    await upsertDropboxTokens(verified.userId, {
      ...tokens,
      dropbox_account_id: account?.account_id || null,
    });

    return res.redirect(`${cfg.frontendUrl}/workspace?dropbox_connected=1`);
  } catch (e) {
    console.error("dropbox callback failed:", e?.message || e);
    const cfg = await getDropboxOauthConfig();
    return res.redirect(`${cfg.frontendUrl || "http://localhost:5173"}/workspace?dropbox_error=oauth_failed`);
  }
}

export async function listDropboxFiles(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const groupId = await resolveScopedGroupForDropboxUser(req);
    const cfg = await requireDropboxConfig(groupId);

    const accessToken = await getValidAccessTokenForUser(cfg, userId);
    const pathArg = String(req.query?.path || "").trim();
    const body = {
      path: pathArg,
      recursive: false,
      include_deleted: false,
      include_non_downloadable_files: false,
    };

    const resp = await fetchWithTimeout(DROPBOX_LIST_FOLDER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(`dropbox_list_failed: ${txt.slice(0, 300)}`);
    }

    const json = await resp.json();
    const entries = Array.isArray(json?.entries) ? json.entries : [];
    const items = entries
      .filter((entry) => {
        const tag = String(entry?.[".tag"] || "");
        if (tag === "folder") return true;
        if (tag !== "file") return false;
        return isSupportedSpreadsheetName(entry?.name);
      })
      .map((entry) => ({
        id: String(entry?.id || entry?.path_lower || ""),
        name: String(entry?.name || ""),
        pathLower: String(entry?.path_lower || ""),
        pathDisplay: String(entry?.path_display || ""),
        tag: String(entry?.[".tag"] || ""),
        clientModified: entry?.client_modified || null,
        serverModified: entry?.server_modified || null,
        size: Number(entry?.size || 0),
      }))
      .filter((entry) => entry.id);

    return res.json({ entries: items, path: pathArg || "" });
  } catch (e) {
    const msg = e?.message || "dropbox_failed";
    if (msg.includes("dropbox_not_connected")) return res.status(400).json({ error: "dropbox_not_connected" });
    console.error("dropbox list failed:", msg);
    return res.status(500).json({ error: "dropbox_list_failed" });
  }
}

export async function importDropboxFile(req, res) {
  try {
    const groupId = await resolveScopedGroupForDropboxUser(req);
    const cfg = await requireDropboxConfig(groupId);
    const isAdmin = String(req.user?.role || "").toLowerCase() === "admin";
    const isGroupAdmin = req.user?.id ? await isGroupAdminUser(req.user.id) : false;
    if (!isAdmin && !isGroupAdmin) return res.status(403).json({ error: "Forbidden" });

    const filePath = String(req.body?.pathLower || req.body?.path || "").trim();
    const fileName = String(req.body?.name || path.basename(filePath) || "dropbox-file").trim();
    const displayName = String(req.body?.display_name || req.body?.displayName || "").trim();

    if (!filePath) return res.status(400).json({ error: "file_path_required" });
    if (!displayName) return res.status(400).json({ error: "display_name_required" });
    if (!isSupportedSpreadsheetName(fileName)) return res.status(415).json({ error: "unsupported_file_type" });

    const accessToken = await getValidAccessTokenForUser(cfg, req.user.id);
    const downloadResp = await fetchWithTimeout(DROPBOX_DOWNLOAD_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Dropbox-API-Arg": JSON.stringify({ path: filePath }),
      },
    });
    if (!downloadResp.ok) {
      const txt = await downloadResp.text();
      throw new Error(`dropbox_download_failed: ${txt.slice(0, 300)}`);
    }
    assertProviderContentLengthWithinLimit(downloadResp);

    const ext = path.extname(fileName || "") || ".xlsx";
    const safeBase = (fileName || "dropbox-file").replace(/[^\w.-]+/g, "_");
    const originalname = safeBase.endsWith(ext) ? safeBase : `${safeBase}${ext}`;

    const buf = Buffer.from(await downloadResp.arrayBuffer());
    if (buf.length > PROVIDER_IMPORT_MAX_BYTES) {
      return res.status(413).json({ error: "file_too_large", maxMB: Math.floor(PROVIDER_IMPORT_MAX_BYTES / (1024 * 1024)) });
    }
    const tmpPath = path.join(tmpdir(), `dropbox_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`);
    await fs.promises.writeFile(tmpPath, buf);

    req.file = {
      path: tmpPath,
      originalname,
      mimetype: "application/octet-stream",
      size: buf.length,
    };
    req.body = {
      ...(req.body || {}),
      display_name: displayName,
    };

    return uploadSheet(req, res);
  } catch (e) {
    const msg = e?.message || "dropbox_import_failed";
    console.error("dropbox import failed:", msg);
    if (e?.statusCode === 413 || msg.includes("provider_file_too_large")) {
      return res.status(413).json({ error: "file_too_large", maxMB: Math.floor(PROVIDER_IMPORT_MAX_BYTES / (1024 * 1024)) });
    }
    return res.status(500).json({ error: "dropbox_import_failed" });
  }
}
