import { query } from "../config/db.js";
import { uploadSheet } from "./sheetController.js";
import fs from "fs";
import path from "path";
import { tmpdir } from "os";
import { createHmac, timingSafeEqual } from "crypto";
import { decryptSettingValue } from "../utils/settingsCrypto.js";

const MS_AUTH_BASE = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const MS_TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const MS_GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const SUPPORTED_EXTS = [".csv", ".xls", ".xlsx"];
const OAUTH_STATE_TTL_MS = 5 * 60 * 1000;

function base64UrlEncode(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function getStateSecret() {
  return "podcaster-portal-onedrive-oauth-state-v1";
}

function signState(payloadB64, secret) {
  return createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

function createOauthState(userId, now = Date.now()) {
  const uid = Number(userId);
  if (!Number.isInteger(uid) || uid <= 0) throw new Error("invalid_user_id");
  const payload = { uid, exp: now + OAUTH_STATE_TTL_MS };
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const signature = signState(payloadB64, getStateSecret());
  return `${payloadB64}.${signature}`;
}

function verifyOauthState(state, now = Date.now()) {
  const raw = String(state || "").trim();
  if (!raw || !raw.includes(".")) return null;
  const [payloadB64, signature] = raw.split(".");
  if (!payloadB64 || !signature) return null;
  const expected = signState(payloadB64, getStateSecret());
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
  return uid;
}

function isSupportedSpreadsheetName(name) {
  const lower = String(name || "").toLowerCase();
  return SUPPORTED_EXTS.some((ext) => lower.endsWith(ext));
}

async function isIntegrationEnabled() {
  try {
    const rows = await query("SELECT value FROM app_settings WHERE key = 'onedrive_integration' LIMIT 1", []);
    if (!rows.length) return true;
    return !!rows[0]?.value?.enabled;
  } catch {
    return true;
  }
}

async function getOauthConfig() {
  const rows = await query("SELECT value FROM app_settings WHERE key = 'onedrive_oauth' LIMIT 1", []);
  const v = rows[0]?.value || {};
  return {
    clientId: decryptSettingValue(String(v.clientId || "")).trim(),
    clientSecret: decryptSettingValue(String(v.clientSecret || "")).trim(),
    redirectUri: String(v.redirectUri || "").trim(),
    frontendUrl: String(v.frontendUrl || "http://localhost:5173").trim(),
  };
}

async function requireConfig() {
  const enabled = await isIntegrationEnabled();
  if (!enabled) throw new Error("onedrive_integration_disabled");
  const cfg = await getOauthConfig();
  if (!cfg.clientId || !cfg.clientSecret || !cfg.redirectUri) throw new Error("onedrive_oauth_not_configured");
  return cfg;
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
  const res = await fetch(MS_TOKEN_URL, {
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
  const res = await fetch(`${MS_GRAPH_BASE}/me/drive`, {
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

export async function getOneDriveStatus(_req, res) {
  const enabled = await isIntegrationEnabled();
  return res.json({ enabled });
}

export async function getOneDriveAuthUrl(req, res) {
  try {
    const cfg = await requireConfig();
    const state = createOauthState(req.user?.id);
    const params = new URLSearchParams({
      client_id: cfg.clientId,
      redirect_uri: cfg.redirectUri,
      response_type: "code",
      scope: "offline_access User.Read Files.Read",
      response_mode: "query",
      state,
    });
    return res.json({ url: `${MS_AUTH_BASE}?${params.toString()}` });
  } catch (e) {
    return res.status(400).json({ error: e?.message || "onedrive_oauth_not_configured" });
  }
}

export async function oneDriveCallback(req, res) {
  try {
    const cfg = await requireConfig();
    const code = String(req.query?.code || "").trim();
    const state = String(req.query?.state || "").trim();
    if (!code || !state) return res.redirect(`${cfg.frontendUrl}/workspace?onedrive_error=missing_code`);
    const userId = verifyOauthState(state);
    if (!userId) return res.redirect(`${cfg.frontendUrl}/workspace?onedrive_error=invalid_state`);

    const body = new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUri,
      grant_type: "authorization_code",
      code,
      scope: "offline_access User.Read Files.Read",
    });
    const tokenRes = await fetch(MS_TOKEN_URL, {
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
    await upsertTokens(userId, { ...tokens, drive_id: drive?.id || null });
    return res.redirect(`${cfg.frontendUrl}/workspace?onedrive_connected=1`);
  } catch (e) {
    console.error("onedrive callback failed:", e?.message || e);
    const cfg = await getOauthConfig();
    return res.redirect(`${cfg.frontendUrl || "http://localhost:5173"}/workspace?onedrive_error=oauth_failed`);
  }
}

export async function listOneDriveFiles(req, res) {
  try {
    const cfg = await requireConfig();
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const accessToken = await getValidAccessTokenForUser(cfg, userId);
    const itemId = String(req.query?.itemId || "root").trim() || "root";
    const route = itemId === "root"
      ? `${MS_GRAPH_BASE}/me/drive/root/children?$top=200&$select=id,name,file,folder,size,lastModifiedDateTime,webUrl,parentReference`
      : `${MS_GRAPH_BASE}/me/drive/items/${encodeURIComponent(itemId)}/children?$top=200&$select=id,name,file,folder,size,lastModifiedDateTime,webUrl,parentReference`;
    const resp = await fetch(route, { headers: { Authorization: `Bearer ${accessToken}` } });
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
    return res.status(500).json({ error: "onedrive_list_failed", message: msg });
  }
}

export async function importOneDriveFile(req, res) {
  try {
    const cfg = await requireConfig();
    const isAdmin = String(req.user?.role || "").toLowerCase() === "admin";
    const isGroupAdmin = req.user?.id ? await isGroupAdminUser(req.user.id) : false;
    if (!isAdmin && !isGroupAdmin) return res.status(403).json({ error: "Forbidden" });

    const itemId = String(req.body?.itemId || "").trim();
    const fileName = String(req.body?.name || "onedrive-file").trim();
    const displayName = String(req.body?.display_name || req.body?.displayName || "").trim();
    const folderId = req.body?.folder_id ?? req.body?.folderId ?? null;
    if (!itemId) return res.status(400).json({ error: "item_id_required" });
    if (!displayName) return res.status(400).json({ error: "display_name_required" });
    if (!isSupportedSpreadsheetName(fileName)) return res.status(415).json({ error: "unsupported_file_type" });

    const accessToken = await getValidAccessTokenForUser(cfg, req.user.id);
    const downloadResp = await fetch(`${MS_GRAPH_BASE}/me/drive/items/${encodeURIComponent(itemId)}/content`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!downloadResp.ok) {
      const txt = await downloadResp.text();
      throw new Error(`onedrive_download_failed: ${txt.slice(0, 300)}`);
    }
    const ext = path.extname(fileName || "") || ".xlsx";
    const safeBase = (fileName || "onedrive-file").replace(/[^\w.-]+/g, "_");
    const originalname = safeBase.endsWith(ext) ? safeBase : `${safeBase}${ext}`;
    const buf = Buffer.from(await downloadResp.arrayBuffer());
    const tmpPath = path.join(tmpdir(), `onedrive_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`);
    fs.writeFileSync(tmpPath, buf);

    req.file = {
      path: tmpPath,
      originalname,
      mimetype: "application/octet-stream",
      size: buf.length,
    };
    req.body = {
      ...(req.body || {}),
      display_name: displayName,
      folder_id: folderId,
    };
    return uploadSheet(req, res);
  } catch (e) {
    const msg = e?.message || "onedrive_import_failed";
    console.error("onedrive import failed:", msg);
    return res.status(500).json({ error: "onedrive_import_failed", message: msg });
  }
}
