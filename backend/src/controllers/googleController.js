import { getTenantPool, isTenantDbIsolationEnabled, query, runWithDbPool, syncCustomerPrincipalToTenant } from "../config/db.js";
import { generateToken, setAuthCookie } from "../middleware/auth.js";
import { uploadSheet } from "./sheetController.js";
import fs from "fs";
import path from "path";
import { tmpdir } from "os";
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { decryptSettingValue } from "../utils/settingsCrypto.js";
import { groupHasFeature } from "../utils/entitlements.js";
import { fetchProviderAutosyncMetadata } from "../utils/providerAutosync.js";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const GOOGLE_DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const GOOGLE_DRIVE_EXPORT_BASE = "https://www.googleapis.com/drive/v3/files";
const GOOGLE_OAUTH_STATE_TTL_MS = 5 * 60 * 1000;
const PROVIDER_TIMEOUT_MS = Number.parseInt(process.env.PROVIDER_FETCH_TIMEOUT_MS || "15000", 10);
const PROVIDER_IMPORT_MAX_BYTES = Number.parseInt(process.env.PROVIDER_IMPORT_MAX_BYTES || `${100 * 1024 * 1024}`, 10);
const GOOGLE_LOGIN_CODE_TTL_MS = 60 * 1000;

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

function getGoogleStateSecret() {
  const candidate = String(process.env.GOOGLE_OAUTH_STATE_SECRET || process.env.JWT_SECRET || "").trim();
  if (!candidate) throw new Error("google_state_secret_missing");
  return candidate;
}

function signGoogleState(payloadB64, secret) {
  return createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

function getGoogleLoginCodeSecret() {
  const candidate = String(process.env.GOOGLE_LOGIN_CODE_SECRET || process.env.GOOGLE_OAUTH_STATE_SECRET || process.env.JWT_SECRET || "").trim();
  if (!candidate) throw new Error("google_login_code_secret_missing");
  return candidate;
}

function signGoogleLoginCode(payloadB64, secret) {
  return createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

function createGoogleOauthState({ groupId = null } = {}, secret, now = Date.now()) {
  const payload = {
    exp: now + GOOGLE_OAUTH_STATE_TTL_MS,
    nonce: randomBytes(12).toString("base64url"),
    gid: Number.isInteger(groupId) && groupId > 0 ? groupId : null,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = signGoogleState(payloadB64, secret);
  return `${payloadB64}.${signature}`;
}

function verifyGoogleOauthState(state, secret, now = Date.now()) {
  const raw = String(state || "").trim();
  if (!raw || !raw.includes(".")) return null;
  const [payloadB64, signature] = raw.split(".");
  if (!payloadB64 || !signature) return null;
  const expected = signGoogleState(payloadB64, secret);
  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null;
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
    if (Number(payload?.exp || 0) <= now) return null;
    return {
      groupId: parsePositiveInt(payload?.gid),
    };
  } catch {
    return null;
  }
}

function parseCookieValue(cookieHeader, name) {
  const source = String(cookieHeader || "");
  const parts = source.split(";").map((v) => v.trim());
  const prefix = `${name}=`;
  const hit = parts.find((p) => p.startsWith(prefix));
  if (!hit) return "";
  return decodeURIComponent(hit.slice(prefix.length));
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

function issueGoogleLoginCode(user, now = Date.now()) {
  const token = generateToken(user);
  const payload = {
    tok: token,
    exp: now + GOOGLE_LOGIN_CODE_TTL_MS,
    nonce: randomBytes(12).toString("base64url"),
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = signGoogleLoginCode(payloadB64, getGoogleLoginCodeSecret());
  return `${payloadB64}.${signature}`;
}

function consumeGoogleLoginCode(code, now = Date.now()) {
  const raw = String(code || "").trim();
  if (!raw || !raw.includes(".")) return null;
  const [payloadB64, signature] = raw.split(".");
  if (!payloadB64 || !signature) return null;

  const expected = signGoogleLoginCode(payloadB64, getGoogleLoginCodeSecret());
  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null;

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
    const exp = Number(payload?.exp || 0);
    const token = String(payload?.tok || "").trim();
    if (!token || !Number.isFinite(exp) || exp <= now) return null;
    return token;
  } catch {
    return null;
  }
}

function extFromMimeType(mimeType) {
  if (mimeType === "text/csv") return ".csv";
  if (mimeType === "application/vnd.ms-excel") return ".xls";
  return ".xlsx";
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

async function downloadGoogleDriveFile(accessToken, fileId, mimeType) {
  if (mimeType === "application/vnd.google-apps.spreadsheet") {
    const exportUrl = `${GOOGLE_DRIVE_EXPORT_BASE}/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}`;
    const resp = await fetchWithTimeout(exportUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(`drive_export_failed: ${txt.slice(0, 300)}`);
    }
    assertProviderContentLengthWithinLimit(resp);
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length > PROVIDER_IMPORT_MAX_BYTES) {
      const err = new Error("provider_file_too_large");
      err.statusCode = 413;
      err.maxBytes = PROVIDER_IMPORT_MAX_BYTES;
      throw err;
    }
    return {
      buffer: buf,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      extension: ".xlsx",
    };
  }

  const mediaUrl = `${GOOGLE_DRIVE_EXPORT_BASE}/${encodeURIComponent(fileId)}?alt=media`;
  const resp = await fetchWithTimeout(mediaUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`drive_download_failed: ${txt.slice(0, 300)}`);
  }
  assertProviderContentLengthWithinLimit(resp);
  const buf = Buffer.from(await resp.arrayBuffer());
  if (buf.length > PROVIDER_IMPORT_MAX_BYTES) {
    const err = new Error("provider_file_too_large");
    err.statusCode = 413;
    err.maxBytes = PROVIDER_IMPORT_MAX_BYTES;
    throw err;
  }
  return {
    buffer: buf,
    mimeType: mimeType || "application/octet-stream",
    extension: extFromMimeType(mimeType || ""),
  };
}

async function getAppSettingValueWithScopedFallback(baseKey, groupId) {
  const scopedKey = appSettingKeyForGroup(baseKey, groupId);
  const scopedRows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [scopedKey]);
  if (scopedRows.length) return scopedRows[0]?.value;
  return null;
}

async function isGoogleIntegrationEnabled(groupId = null) {
  try {
    const cfg = await getGoogleOauthConfig(groupId);
    return oauthConfigIsComplete(cfg);
  } catch {
    return true;
  }
}

async function getGoogleOauthConfig(groupId = null) {
  const value = await getAppSettingValueWithScopedFallback("google_oauth", groupId);
  const v = value || {};
  return {
    clientId: decryptSettingValue(String(v.clientId || "")).trim(),
    clientSecret: decryptSettingValue(String(v.clientSecret || "")).trim(),
    redirectUri: String(v.redirectUri || "").trim(),
    frontendUrl: String(v.frontendUrl || process.env.FRONTEND_URL || "http://localhost:5173").trim(),
  };
}

async function requireGoogleConfig(groupId = null) {
  const enabled = await isGoogleIntegrationEnabled(groupId);
  if (!enabled) {
    throw new Error("google_integration_disabled");
  }
  const cfg = await getGoogleOauthConfig(groupId);
  if (!cfg.clientId || !cfg.clientSecret || !cfg.redirectUri) {
    throw new Error("google_oauth_not_configured");
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

async function readGroupFeatureFlag(groupId, featureName) {
  if (!Number.isInteger(groupId) || groupId <= 0) return true;
  const rows = await query("SELECT entitlements FROM groups WHERE id = $1 LIMIT 1", [groupId]);
  if (!rows.length) return null;
  return groupHasFeature({ entitlements: rows[0]?.entitlements || {} }, featureName);
}

async function assertGroupFeatureEnabled(groupId, featureName, errorCode) {
  if (!Number.isInteger(groupId) || groupId <= 0) return;
  const enabled = await readGroupFeatureFlag(groupId, featureName);
  if (enabled === null) throw new Error("group_not_found");
  if (!enabled) throw new Error(errorCode);
}

async function resolveScopedGroupForGoogleAuthUser(req) {
  const requestedGroupId = parsePositiveInt(req.query?.groupId ?? req.body?.groupId);
  if (String(req.user?.role || "").toLowerCase() === "admin") {
    return requestedGroupId;
  }
  const groups = await getUserGroupIds(req.user?.id);
  if (!groups.length) return null;
  if (requestedGroupId && groups.includes(requestedGroupId)) return requestedGroupId;
  return groups[0];
}

export async function getGoogleStatus(req, res) {
  const groupId = await resolveScopedGroupForGoogleAuthUser(req);
  const driveFeatureEnabled = await readGroupFeatureFlag(groupId, "googleDrive");
  const ssoFeatureEnabled = await readGroupFeatureFlag(groupId, "sso");
  const enabled = driveFeatureEnabled !== false && await isGoogleIntegrationEnabled(groupId);
  return res.json({ enabled, ssoEnabled: ssoFeatureEnabled !== false, groupId: groupId || null });
}

function buildGoogleAuthUrl(cfg, state) {
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
    state,
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
  const res = await fetchWithTimeout(GOOGLE_TOKEN_URL, {
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
  const res = await fetchWithTimeout(GOOGLE_TOKEN_URL, {
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
  const res = await fetchWithTimeout(GOOGLE_USERINFO_URL, {
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

async function findOrCreateGoogleUser(googleUser, { requiredGroupId = null } = {}) {
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

  if (Number.isInteger(requiredGroupId) && requiredGroupId > 0) {
    throw new Error("sso_user_not_provisioned");
  }

  const created = await query(
    "INSERT INTO users (email, password, role, password_reset_required) VALUES ($1, NULL, 'user', FALSE) RETURNING id, email, role",
    [email]
  );
  return created[0];
}

async function userBelongsToGroup(userId, groupId) {
  if (!Number.isInteger(groupId) || groupId <= 0) return true;
  const rows = await query(
    "SELECT 1 FROM user_groups WHERE user_id = $1 AND group_id = $2 LIMIT 1",
    [userId, groupId]
  );
  return rows.length > 0;
}

async function resolveTenantContextForGroup(userId, groupId) {
  if (!isTenantDbIsolationEnabled() || !Number.isInteger(groupId) || groupId <= 0) return {};
  const rows = await query(
    `SELECT c.id AS customer_id, c.group_id AS customer_group_id, c.db_name AS tenant_database
       FROM customers c
       JOIN user_groups ug ON ug.group_id = c.group_id
      WHERE c.group_id = $1
        AND ug.user_id = $2
        AND c.status = 'active'
      LIMIT 1`,
    [groupId, userId]
  );
  if (!rows.length) return {};
  return {
    customer_id: rows[0].customer_id,
    customer_group_id: rows[0].customer_group_id,
    tenant_database: rows[0].tenant_database,
  };
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
    const requestedGroupId = parsePositiveInt(_req.query?.groupId);
    await assertGroupFeatureEnabled(requestedGroupId, "sso", "google_sso_disabled");
    const cfg = await requireGoogleConfig(requestedGroupId);
    const state = createGoogleOauthState(
      { groupId: requestedGroupId },
      getGoogleStateSecret()
    );
    const secure = _req.secure || String(_req.headers["x-forwarded-proto"] || "").toLowerCase() === "https";
    const cookie = [
      `google_oauth_state=${encodeURIComponent(state)}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      secure ? "Secure" : null,
      `Max-Age=${Math.floor(GOOGLE_OAUTH_STATE_TTL_MS / 1000)}`,
    ].filter(Boolean).join("; ");
    res.setHeader("Set-Cookie", cookie);
    return res.json({ url: buildGoogleAuthUrl(cfg, state), groupId: requestedGroupId || null });
  } catch (e) {
    return res.status(400).json({ error: e?.message || "google_oauth_not_configured" });
  }
}

export async function getGoogleConnectUrl(req, res) {
  try {
    const groupId = await resolveScopedGroupForGoogleAuthUser(req);
    await assertGroupFeatureEnabled(groupId, "googleDrive", "google_drive_disabled");
    const cfg = await requireGoogleConfig(groupId);
    const state = createGoogleOauthState(
      { groupId },
      getGoogleStateSecret()
    );
    const secure = req.secure || String(req.headers["x-forwarded-proto"] || "").toLowerCase() === "https";
    const cookie = [
      `google_oauth_state=${encodeURIComponent(state)}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      secure ? "Secure" : null,
      `Max-Age=${Math.floor(GOOGLE_OAUTH_STATE_TTL_MS / 1000)}`,
    ].filter(Boolean).join("; ");
    res.setHeader("Set-Cookie", cookie);
    return res.json({ url: buildGoogleAuthUrl(cfg, state), groupId: groupId || null });
  } catch (e) {
    return res.status(400).json({ error: e?.message || "google_oauth_not_configured" });
  }
}

export async function googleCallback(req, res) {
  try {
    const code = String(req.query?.code || "").trim();
    const state = String(req.query?.state || "").trim();
    const cookieState = parseCookieValue(req.headers?.cookie, "google_oauth_state");
    const stateBuf = Buffer.from(state);
    const cookieBuf = Buffer.from(cookieState);
    const stateMatchesCookie = !!state && !!cookieState && stateBuf.length === cookieBuf.length && timingSafeEqual(stateBuf, cookieBuf);
    const statePayload = verifyGoogleOauthState(state, getGoogleStateSecret());
    const requiredGroupId = statePayload?.groupId || null;
    await assertGroupFeatureEnabled(requiredGroupId, "sso", "google_sso_disabled");
    const cfg = await requireGoogleConfig(requiredGroupId);
    if (!code) {
      return res.redirect(`${cfg.frontendUrl}/?google_error=missing_code`);
    }
    if (!stateMatchesCookie || !statePayload) {
      return res.redirect(`${cfg.frontendUrl}/?google_error=invalid_state`);
    }

    const tokens = await exchangeCodeForTokens(cfg, code);
    const googleUser = await fetchGoogleUser(tokens.access_token);
    const appUser = await findOrCreateGoogleUser(googleUser, { requiredGroupId });
    if (requiredGroupId && !(await userBelongsToGroup(appUser.id, requiredGroupId))) {
      throw new Error("sso_group_membership_required");
    }

    await upsertGoogleTokens(appUser.id, {
      ...tokens,
      google_sub: googleUser?.sub || null,
    });

    const tenantContext = await resolveTenantContextForGroup(appUser.id, requiredGroupId);
    if (tenantContext.tenant_database) {
      await syncCustomerPrincipalToTenant({ groupId: tenantContext.customer_group_id, userId: appUser.id });
      const tenantPool = await getTenantPool(tenantContext.tenant_database);
      await runWithDbPool(tenantPool, () => upsertGoogleTokens(appUser.id, {
        ...tokens,
        google_sub: googleUser?.sub || null,
      }));
    }

    const loginCode = issueGoogleLoginCode({ ...appUser, ...tenantContext });
    return res.redirect(`${cfg.frontendUrl}/?google_code=${encodeURIComponent(loginCode)}`);
  } catch (e) {
    console.error("google callback failed:", e?.message || e);
    const code = e?.message === "admin_manual_login_required"
      ? "admin_manual_login_required"
      : (e?.message || "oauth_failed");
    const cfg = await getGoogleOauthConfig();
    return res.redirect(`${cfg.frontendUrl || "http://localhost:5173"}/?google_error=${encodeURIComponent(code)}`);
  }
}

export async function exchangeGoogleCode(req, res) {
  const code = String(req.body?.code || "").trim();
  if (!code) return res.status(400).json({ error: "google_code_required" });
  const token = consumeGoogleLoginCode(code);
  if (!token) {
    return res.status(400).json({ error: "google_code_invalid_or_expired" });
  }
  setAuthCookie(req, res, token);
  return res.json({ success: true });
}

export async function listGoogleDriveFiles(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const groupId = await resolveScopedGroupForGoogleAuthUser(req);
    await assertGroupFeatureEnabled(groupId, "googleDrive", "google_drive_disabled");
    const cfg = await requireGoogleConfig(groupId);

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

    const resp = await fetchWithTimeout(`${GOOGLE_DRIVE_FILES_URL}?${params.toString()}`, {
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
    if (msg.includes("google_drive_disabled")) return res.status(403).json({ error: "google_drive_disabled" });
    console.error("google drive list failed:", msg);
    return res.status(500).json({ error: "google_drive_failed" });
  }
}

export async function importGoogleDriveFile(req, res) {
  try {
    const groupId = await resolveScopedGroupForGoogleAuthUser(req);
    await assertGroupFeatureEnabled(groupId, "googleDrive", "google_drive_disabled");
    const cfg = await requireGoogleConfig(groupId);
    const isAdmin = String(req.user?.role || "").toLowerCase() === "admin";
    const isGroupAdmin = req.user?.id ? await isGroupAdminUser(req.user.id) : false;
    if (!isAdmin && !isGroupAdmin) return res.status(403).json({ error: "Forbidden" });

    const fileId = String(req.body?.fileId || "").trim();
    const fileName = String(req.body?.name || "google-drive-file").trim();
    const mimeType = String(req.body?.mimeType || "").trim();
    const displayName = String(req.body?.display_name || req.body?.displayName || "").trim();
    const autosyncEnabled = ["1", "true", "yes", "on"].includes(String(req.body?.autosync_enabled ?? req.body?.autosyncEnabled ?? "").trim().toLowerCase());

    if (!fileId) return res.status(400).json({ error: "file_id_required" });
    if (!displayName) return res.status(400).json({ error: "display_name_required" });

    const accessToken = await getValidAccessTokenForUser(cfg, req.user.id);
    const autosyncMeta = autosyncEnabled
      ? await fetchProviderAutosyncMetadata({ provider: "google_drive", groupId, userId: req.user.id, sourceRef: fileId })
      : null;
    const downloaded = await downloadGoogleDriveFile(accessToken, fileId, mimeType);

    const ext = path.extname(fileName || "") || downloaded.extension;
    const safeBase = (fileName || "google-drive-file").replace(/[^\w.-]+/g, "_");
    const originalname = safeBase.endsWith(ext) ? safeBase : `${safeBase}${ext}`;

    const tmpPath = path.join(tmpdir(), `gdrive_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`);
    await fs.promises.writeFile(tmpPath, downloaded.buffer);

    req.file = {
      path: tmpPath,
      originalname,
      mimetype: downloaded.mimeType,
      size: downloaded.buffer.length,
    };
    req.body = {
      ...(req.body || {}),
      display_name: displayName,
      ...(autosyncEnabled ? {
        autosync_enabled: "1",
        autosync_provider: "google_drive",
        autosync_source_ref: fileId,
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
    const msg = e?.message || "google_drive_import_failed";
    console.error("google drive import failed:", msg);
    if (msg.includes("google_drive_disabled")) return res.status(403).json({ error: "google_drive_disabled" });
    if (e?.statusCode === 413 || msg.includes("provider_file_too_large")) {
      return res.status(413).json({ error: "file_too_large", maxMB: Math.floor(PROVIDER_IMPORT_MAX_BYTES / (1024 * 1024)) });
    }
    return res.status(500).json({ error: "google_drive_import_failed" });
  }
}
