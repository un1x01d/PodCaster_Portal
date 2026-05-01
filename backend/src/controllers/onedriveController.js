import { query } from "../config/db.js";
import { uploadSheet } from "./sheetController.js";
import fs from "fs";
import path from "path";
import { tmpdir } from "os";
import { createHmac, timingSafeEqual } from "crypto";
import { decryptSettingValue } from "../utils/settingsCrypto.js";
import { fetchProviderAutosyncMetadata } from "../utils/providerAutosync.js";

const MS_AUTH_BASE = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const MS_TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const MS_GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const SUPPORTED_EXTS = [".csv", ".xls", ".xlsx"];
const OAUTH_STATE_TTL_MS = 5 * 60 * 1000;
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

function getOneDriveStateSecret() {
  const candidate = String(process.env.ONEDRIVE_OAUTH_STATE_SECRET || process.env.JWT_SECRET || "").trim();
  if (!candidate) throw new Error("onedrive_state_secret_missing");
  return candidate;
}

function base64UrlEncode(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signState(payloadB64, secret) {
  return createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

function createOauthState(userId, secret, groupId = null, now = Date.now()) {
  const uid = Number(userId);
  if (!Number.isInteger(uid) || uid <= 0) throw new Error("invalid_user_id");
  const payload = { uid, gid: parsePositiveInt(groupId), exp: now + OAUTH_STATE_TTL_MS };
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const signature = signState(payloadB64, secret);
  return `${payloadB64}.${signature}`;
}

function verifyOauthState(state, secret, now = Date.now()) {
  const raw = String(state || "").trim();
  if (!raw || !raw.includes(".")) return null;
  const [payloadB64, signature] = raw.split(".");
  if (!payloadB64 || !signature) return null;
  const expected = signState(payloadB64, secret);
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

async function isIntegrationEnabled(groupId = null) {
  try {
    const cfg = await getOauthConfig(groupId);
    return oauthConfigIsComplete(cfg);
  } catch {
    return true;
  }
}

async function getOauthConfig(groupId = null) {
  const value = await getAppSettingValueWithScopedFallback("onedrive_oauth", groupId);
  const v = value || {};
  return {
    clientId: decryptSettingValue(String(v.clientId || "")).trim(),
    clientSecret: decryptSettingValue(String(v.clientSecret || "")).trim(),
    redirectUri: String(v.redirectUri || "").trim(),
    frontendUrl: String(v.frontendUrl || "http://localhost:5173").trim(),
  };
}

async function requireConfig(groupId = null) {
  const enabled = await isIntegrationEnabled(groupId);
  if (!enabled) throw new Error("onedrive_integration_disabled");
  const cfg = await getOauthConfig(groupId);
  if (!cfg.clientId || !cfg.clientSecret || !cfg.redirectUri) throw new Error("onedrive_oauth_not_configured");
  return cfg;
}

async function getUserGroupIds(userId) {
  const rows = await query(
    "SELECT group_id FROM user_groups WHERE user_id = $1 ORDER BY group_id ASC",
    [userId]
  );
  return rows.map((r) => Number(r.group_id)).filter((gid) => Number.isInteger(gid) && gid > 0);
}

async function resolveScopedGroupForOneDriveUser(req) {
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

async function upsertTokens(userId, tokenPayload) {
  const expiresIn = Number(tokenPayload?.expires_in || 3600);
  const expiresAt = new Date(Date.now() + Math.max(60, expiresIn) * 1000);
  await query(
    `INSERT INTO user_onedrive_tokens (user_id, drive_id, access_token, refresh_token, scope, token_type, expires_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
     ON CONFLICT (user_id)
     DO UPDATE SET
       drive_id = EXCLUDED.drive_id,
       access_token = EXCLUDED.access_token,
       refresh_token = COALESCE(EXCLUDED.refresh_token, user_onedrive_tokens.refresh_token),
       scope = EXCLUDED.scope,
       token_type = EXCLUDED.token_type,
       expires_at = EXCLUDED.expires_at,
       updated_at = NOW()`,
    [
      userId,
      tokenPayload?.drive_id || null,
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
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
    redirect_uri: cfg.redirectUri,
  });
  const res = await fetchWithTimeout(MS_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`onedrive_token_refresh_failed: ${text.slice(0, 300)}`);
  }
  return res.json();
}

async function getValidAccessTokenForUser(cfg, userId) {
  const rows = await query(
    "SELECT user_id, access_token, refresh_token, expires_at FROM user_onedrive_tokens WHERE user_id = $1 LIMIT 1",
    [userId]
  );
  if (!rows.length) throw new Error("onedrive_not_connected");
  const rec = rows[0];
  const expiresAt = rec.expires_at ? new Date(rec.expires_at).getTime() : 0;
  const stillValid = rec.access_token && expiresAt > (Date.now() + 60_000);
  if (stillValid) return rec.access_token;
  if (!rec.refresh_token) throw new Error("onedrive_refresh_token_missing");
  const refreshed = await refreshAccessToken(cfg, rec.refresh_token);
  await upsertTokens(userId, { ...refreshed, refresh_token: rec.refresh_token });
  return refreshed.access_token;
}

async function fetchDriveMetadata(accessToken) {
  const res = await fetchWithTimeout(`${MS_GRAPH_BASE}/me/drive`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`onedrive_drive_meta_failed: ${text.slice(0, 300)}`);
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

export async function getOneDriveStatus(req, res) {
  const groupId = await resolveScopedGroupForOneDriveUser(req);
  const enabled = await isIntegrationEnabled(groupId);
  return res.json({ enabled, groupId: groupId || null });
}

export async function getOneDriveAuthUrl(req, res) {
  try {
    const groupId = await resolveScopedGroupForOneDriveUser(req);
    const cfg = await requireConfig(groupId);
    const state = createOauthState(req.user?.id, getOneDriveStateSecret(), groupId);
    const params = new URLSearchParams({
      client_id: cfg.clientId,
      redirect_uri: cfg.redirectUri,
      response_type: "code",
      scope: "offline_access User.Read Files.Read",
      response_mode: "query",
      state,
    });
    return res.json({ url: `${MS_AUTH_BASE}?${params.toString()}`, groupId: groupId || null });
  } catch (e) {
    return res.status(400).json({ error: e?.message || "onedrive_oauth_not_configured" });
  }
}

export async function oneDriveCallback(req, res) {
  try {
    const code = String(req.query?.code || "").trim();
    const state = String(req.query?.state || "").trim();
    if (!code || !state) {
      const cfg = await getOauthConfig();
      return res.redirect(`${cfg.frontendUrl}/workspace?onedrive_error=missing_code`);
    }
    const verified = verifyOauthState(state, getOneDriveStateSecret());
    if (!verified?.userId) {
      const cfg = await getOauthConfig();
      return res.redirect(`${cfg.frontendUrl}/workspace?onedrive_error=invalid_state`);
    }
    const scopedGroupId = await resolveScopedGroupForUserId(verified.userId, verified.groupId);
    const cfg = await requireConfig(scopedGroupId);

    const body = new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUri,
      grant_type: "authorization_code",
      code,
      scope: "offline_access User.Read Files.Read",
    });
    const tokenRes = await fetchWithTimeout(MS_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      throw new Error(`onedrive_token_exchange_failed: ${text.slice(0, 300)}`);
    }
    const tokens = await tokenRes.json();
    const drive = await fetchDriveMetadata(tokens.access_token);
    await upsertTokens(verified.userId, { ...tokens, drive_id: drive?.id || null });
    return res.redirect(`${cfg.frontendUrl}/workspace?onedrive_connected=1`);
  } catch (e) {
    console.error("onedrive callback failed:", e?.message || e);
    const cfg = await getOauthConfig();
    return res.redirect(`${cfg.frontendUrl || "http://localhost:5173"}/workspace?onedrive_error=oauth_failed`);
  }
}

export async function listOneDriveFiles(req, res) {
  try {
    const groupId = await resolveScopedGroupForOneDriveUser(req);
    const cfg = await requireConfig(groupId);
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const accessToken = await getValidAccessTokenForUser(cfg, userId);
    const itemId = String(req.query?.itemId || "root").trim() || "root";
    const route = itemId === "root"
      ? `${MS_GRAPH_BASE}/me/drive/root/children?$top=200&$select=id,name,file,folder,size,lastModifiedDateTime,webUrl,parentReference`
      : `${MS_GRAPH_BASE}/me/drive/items/${encodeURIComponent(itemId)}/children?$top=200&$select=id,name,file,folder,size,lastModifiedDateTime,webUrl,parentReference`;
    const resp = await fetchWithTimeout(route, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(`onedrive_list_failed: ${txt.slice(0, 300)}`);
    }
    const json = await resp.json();
    const entries = Array.isArray(json?.value) ? json.value : [];
    const items = entries
      .filter((entry) => {
        if (entry?.folder) return true;
        return isSupportedSpreadsheetName(entry?.name);
      })
      .map((entry) => ({
        id: String(entry?.id || ""),
        name: String(entry?.name || ""),
        isFolder: !!entry?.folder,
        size: Number(entry?.size || 0),
        lastModifiedDateTime: entry?.lastModifiedDateTime || null,
        parentPath: String(entry?.parentReference?.path || ""),
      }))
      .filter((entry) => entry.id);
    return res.json({ entries: items, itemId });
  } catch (e) {
    const msg = e?.message || "onedrive_failed";
    if (msg.includes("onedrive_not_connected")) return res.status(400).json({ error: "onedrive_not_connected" });
    console.error("onedrive list failed:", msg);
    return res.status(500).json({ error: "onedrive_list_failed" });
  }
}

export async function importOneDriveFile(req, res) {
  try {
    const groupId = await resolveScopedGroupForOneDriveUser(req);
    const cfg = await requireConfig(groupId);
    const isAdmin = String(req.user?.role || "").toLowerCase() === "admin";
    const isGroupAdmin = req.user?.id ? await isGroupAdminUser(req.user.id) : false;
    if (!isAdmin && !isGroupAdmin) return res.status(403).json({ error: "Forbidden" });

    const itemId = String(req.body?.itemId || "").trim();
    const fileName = String(req.body?.name || "onedrive-file").trim();
    const displayName = String(req.body?.display_name || req.body?.displayName || "").trim();
    const autosyncEnabled = ["1", "true", "yes", "on"].includes(String(req.body?.autosync_enabled ?? req.body?.autosyncEnabled ?? "").trim().toLowerCase());
    if (!itemId) return res.status(400).json({ error: "item_id_required" });
    if (!displayName) return res.status(400).json({ error: "display_name_required" });
    if (!isSupportedSpreadsheetName(fileName)) return res.status(415).json({ error: "unsupported_file_type" });

    const accessToken = await getValidAccessTokenForUser(cfg, req.user.id);
    const autosyncMeta = autosyncEnabled
      ? await fetchProviderAutosyncMetadata({ provider: "onedrive", groupId, userId: req.user.id, sourceRef: itemId })
      : null;
    const downloadResp = await fetchWithTimeout(`${MS_GRAPH_BASE}/me/drive/items/${encodeURIComponent(itemId)}/content`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!downloadResp.ok) {
      const txt = await downloadResp.text();
      throw new Error(`onedrive_download_failed: ${txt.slice(0, 300)}`);
    }
    assertProviderContentLengthWithinLimit(downloadResp);
    const ext = path.extname(fileName || "") || ".xlsx";
    const safeBase = (fileName || "onedrive-file").replace(/[^\w.-]+/g, "_");
    const originalname = safeBase.endsWith(ext) ? safeBase : `${safeBase}${ext}`;
    const buf = Buffer.from(await downloadResp.arrayBuffer());
    if (buf.length > PROVIDER_IMPORT_MAX_BYTES) {
      return res.status(413).json({ error: "file_too_large", maxMB: Math.floor(PROVIDER_IMPORT_MAX_BYTES / (1024 * 1024)) });
    }
    const tmpPath = path.join(tmpdir(), `onedrive_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`);
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
      ...(autosyncEnabled ? {
        autosync_enabled: "1",
        autosync_provider: "onedrive",
        autosync_source_ref: itemId,
        autosync_group_id: String(groupId || ""),
        autosync_user_id: String(req.user.id || ""),
        autosync_remote_marker: autosyncMeta?.remoteMarker || "",
        autosync_remote_modified_at: autosyncMeta?.remoteModifiedAt || "",
        autosync_display_name: displayName,
        autosync_file_label: String(req.body?.file_label || req.body?.fileLabel || displayName || "").trim(),
      } : {}),
    };
    return uploadSheet(req, res);
  } catch (e) {
    const msg = e?.message || "onedrive_import_failed";
    console.error("onedrive import failed:", msg);
    if (e?.statusCode === 413 || msg.includes("provider_file_too_large")) {
      return res.status(413).json({ error: "file_too_large", maxMB: Math.floor(PROVIDER_IMPORT_MAX_BYTES / (1024 * 1024)) });
    }
    return res.status(500).json({ error: "onedrive_import_failed" });
  }
}
