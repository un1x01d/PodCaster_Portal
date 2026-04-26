import { query } from "../config/db.js";
import { generateToken } from "../middleware/auth.js";
import { uploadSheet } from "./sheetController.js";
import fs from "fs";
import path from "path";
import { tmpdir } from "os";
import { decryptSettingValue } from "../utils/settingsCrypto.js";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const GOOGLE_DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const GOOGLE_DRIVE_EXPORT_BASE = "https://www.googleapis.com/drive/v3/files";

function extFromMimeType(mimeType) {
  if (mimeType === "text/csv") return ".csv";
  if (mimeType === "application/vnd.ms-excel") return ".xls";
  return ".xlsx";
}

async function downloadGoogleDriveFile(accessToken, fileId, mimeType) {
  if (mimeType === "application/vnd.google-apps.spreadsheet") {
    const exportUrl = `${GOOGLE_DRIVE_EXPORT_BASE}/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}`;
    const resp = await fetch(exportUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(`drive_export_failed: ${txt.slice(0, 300)}`);
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    return {
      buffer: buf,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      extension: ".xlsx",
    };
  }

  const mediaUrl = `${GOOGLE_DRIVE_EXPORT_BASE}/${encodeURIComponent(fileId)}?alt=media`;
  const resp = await fetch(mediaUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`drive_download_failed: ${txt.slice(0, 300)}`);
  }
  const buf = Buffer.from(await resp.arrayBuffer());
  return {
    buffer: buf,
    mimeType: mimeType || "application/octet-stream",
    extension: extFromMimeType(mimeType || ""),
  };
}

async function isGoogleIntegrationEnabled() {
  try {
    const rows = await query("SELECT value FROM app_settings WHERE key = 'google_integration' LIMIT 1", []);
    if (!rows.length) return true;
    return !!rows[0]?.value?.enabled;
  } catch {
    return true;
  }
}

async function getGoogleOauthConfig() {
  const rows = await query("SELECT value FROM app_settings WHERE key = 'google_oauth' LIMIT 1", []);
  const v = rows[0]?.value || {};
  return {
    clientId: decryptSettingValue(String(v.clientId || "")).trim(),
    clientSecret: decryptSettingValue(String(v.clientSecret || "")).trim(),
    redirectUri: String(v.redirectUri || "").trim(),
    frontendUrl: String(v.frontendUrl || process.env.FRONTEND_URL || "http://localhost:5173").trim(),
  };
}

async function requireGoogleConfig() {
  const enabled = await isGoogleIntegrationEnabled();
  if (!enabled) {
    throw new Error("google_integration_disabled");
  }
  const cfg = await getGoogleOauthConfig();
  if (!cfg.clientId || !cfg.clientSecret || !cfg.redirectUri) {
    throw new Error("google_oauth_not_configured");
  }
  return cfg;
}

export async function getGoogleStatus(_req, res) {
  const enabled = await isGoogleIntegrationEnabled();
  return res.json({ enabled });
}

function buildGoogleAuthUrl(cfg) {
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    scope: [
      "openid",
      "email",
      "profile",
      "https://www.googleapis.com/auth/drive.readonly",
    ].join(" "),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function exchangeCodeForTokens(cfg, code) {
  const body = new URLSearchParams({
    code,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: cfg.redirectUri,
    grant_type: "authorization_code",
  });
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`google_token_exchange_failed: ${text.slice(0, 300)}`);
  }
  return res.json();
}

async function refreshAccessToken(cfg, refreshToken) {
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`google_token_refresh_failed: ${text.slice(0, 300)}`);
  }
  return res.json();
}

async function fetchGoogleUser(accessToken) {
  const res = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`google_userinfo_failed: ${text.slice(0, 300)}`);
  }
  return res.json();
}

async function upsertGoogleTokens(userId, tokenPayload) {
  const expiresIn = Number(tokenPayload?.expires_in || 3600);
  const expiresAt = new Date(Date.now() + Math.max(60, expiresIn) * 1000);
  await query(
    `INSERT INTO user_google_tokens (user_id, google_sub, access_token, refresh_token, scope, token_type, expires_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
     ON CONFLICT (user_id)
     DO UPDATE SET
       google_sub = EXCLUDED.google_sub,
       access_token = EXCLUDED.access_token,
       refresh_token = COALESCE(EXCLUDED.refresh_token, user_google_tokens.refresh_token),
       scope = EXCLUDED.scope,
       token_type = EXCLUDED.token_type,
       expires_at = EXCLUDED.expires_at,
       updated_at = NOW()`,
    [
      userId,
      tokenPayload?.google_sub || null,
      tokenPayload?.access_token || null,
      tokenPayload?.refresh_token || null,
      tokenPayload?.scope || null,
      tokenPayload?.token_type || "Bearer",
      expiresAt.toISOString(),
    ]
  );
}

async function findOrCreateGoogleUser(googleUser) {
  const email = String(googleUser?.email || "").trim().toLowerCase();
  if (!email) throw new Error("google_email_missing");

  const existing = await query("SELECT id, email, role FROM users WHERE email = $1 LIMIT 1", [email]);
  if (existing.length) {
    // Admin accounts must continue using manual credentials.
    if (existing[0].role === "admin") {
      throw new Error("admin_manual_login_required");
    }
    return existing[0];
  }

  const created = await query(
    "INSERT INTO users (email, password, role, password_reset_required) VALUES ($1, NULL, 'user', FALSE) RETURNING id, email, role",
    [email]
  );
  return created[0];
}

async function getValidAccessTokenForUser(cfg, userId) {
  const rows = await query(
    "SELECT user_id, access_token, refresh_token, expires_at FROM user_google_tokens WHERE user_id = $1 LIMIT 1",
    [userId]
  );
  if (!rows.length) throw new Error("google_not_connected");

  const rec = rows[0];
  const expiresAt = rec.expires_at ? new Date(rec.expires_at).getTime() : 0;
  const stillValid = rec.access_token && expiresAt > (Date.now() + 60_000);
  if (stillValid) return rec.access_token;

  if (!rec.refresh_token) throw new Error("google_refresh_token_missing");
  const refreshed = await refreshAccessToken(cfg, rec.refresh_token);
  await upsertGoogleTokens(userId, {
    ...refreshed,
    refresh_token: rec.refresh_token,
  });
  return refreshed.access_token;
}

async function isGroupAdminUser(userId) {
  const rows = await query(
    "SELECT COUNT(*)::int AS c FROM user_groups WHERE user_id = $1 AND is_admin = TRUE",
    [userId]
  );
  return Number(rows?.[0]?.c || 0) > 0;
}

export async function getGoogleLoginUrl(_req, res) {
  try {
    const cfg = await requireGoogleConfig();
    return res.json({ url: buildGoogleAuthUrl(cfg) });
  } catch (e) {
    return res.status(400).json({ error: e?.message || "google_oauth_not_configured" });
  }
}

export async function googleCallback(req, res) {
  try {
    const cfg = await requireGoogleConfig();
    const code = String(req.query?.code || "").trim();
    if (!code) {
      return res.redirect(`${cfg.frontendUrl}/?google_error=missing_code`);
    }

    const tokens = await exchangeCodeForTokens(cfg, code);
    const googleUser = await fetchGoogleUser(tokens.access_token);
    const appUser = await findOrCreateGoogleUser(googleUser);

    await upsertGoogleTokens(appUser.id, {
      ...tokens,
      google_sub: googleUser?.sub || null,
    });

    const token = generateToken(appUser);
    return res.redirect(`${cfg.frontendUrl}/?google_token=${encodeURIComponent(token)}`);
  } catch (e) {
    console.error("google callback failed:", e?.message || e);
    const code = e?.message === "admin_manual_login_required" ? "admin_manual_login_required" : "oauth_failed";
    const cfg = await getGoogleOauthConfig();
    return res.redirect(`${cfg.frontendUrl || "http://localhost:5173"}/?google_error=${encodeURIComponent(code)}`);
  }
}

export async function listGoogleDriveFiles(req, res) {
  try {
    const cfg = await requireGoogleConfig();
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const accessToken = await getValidAccessTokenForUser(cfg, userId);
    const parentId = String(req.query?.parentId || "root").trim() || "root";
    const safeParentId = parentId.replace(/'/g, "\\'");
    const q = [
      "trashed = false",
      `'${safeParentId}' in parents`,
      "(mimeType = 'application/vnd.google-apps.folder' or mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' or mimeType = 'application/vnd.ms-excel' or mimeType = 'text/csv')",
    ].join(" and ");
    const params = new URLSearchParams({
      pageSize: "100",
      fields: "files(id,name,mimeType,modifiedTime,size,webViewLink,parents)",
      orderBy: "folder,name_natural",
      q,
    });

    const resp = await fetch(`${GOOGLE_DRIVE_FILES_URL}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(`drive_list_failed: ${txt.slice(0, 300)}`);
    }

    const json = await resp.json();
    return res.json({ files: Array.isArray(json?.files) ? json.files : [] });
  } catch (e) {
    const msg = e?.message || "google_drive_failed";
    if (msg.includes("google_not_connected")) return res.status(400).json({ error: "google_not_connected" });
    console.error("google drive list failed:", msg);
    return res.status(500).json({ error: "google_drive_failed", message: msg });
  }
}

export async function importGoogleDriveFile(req, res) {
  try {
    const cfg = await requireGoogleConfig();
    const isAdmin = String(req.user?.role || "").toLowerCase() === "admin";
    const isGroupAdmin = req.user?.id ? await isGroupAdminUser(req.user.id) : false;
    if (!isAdmin && !isGroupAdmin) return res.status(403).json({ error: "Forbidden" });

    const fileId = String(req.body?.fileId || "").trim();
    const fileName = String(req.body?.name || "google-drive-file").trim();
    const mimeType = String(req.body?.mimeType || "").trim();
    const displayName = String(req.body?.display_name || req.body?.displayName || "").trim();
    const folderId = req.body?.folder_id ?? req.body?.folderId ?? null;

    if (!fileId) return res.status(400).json({ error: "file_id_required" });
    if (!displayName) return res.status(400).json({ error: "display_name_required" });

    const accessToken = await getValidAccessTokenForUser(cfg, req.user.id);
    const downloaded = await downloadGoogleDriveFile(accessToken, fileId, mimeType);

    const ext = path.extname(fileName || "") || downloaded.extension;
    const safeBase = (fileName || "google-drive-file").replace(/[^\w.-]+/g, "_");
    const originalname = safeBase.endsWith(ext) ? safeBase : `${safeBase}${ext}`;

    const tmpPath = path.join(tmpdir(), `gdrive_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`);
    fs.writeFileSync(tmpPath, downloaded.buffer);

    req.file = {
      path: tmpPath,
      originalname,
      mimetype: downloaded.mimeType,
      size: downloaded.buffer.length,
    };
    req.body = {
      ...(req.body || {}),
      display_name: displayName,
      folder_id: folderId,
    };

    return uploadSheet(req, res);
  } catch (e) {
    const msg = e?.message || "google_drive_import_failed";
    console.error("google drive import failed:", msg);
    return res.status(500).json({ error: "google_drive_import_failed", message: msg });
  }
}
