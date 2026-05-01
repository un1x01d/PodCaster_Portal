import { query } from "../config/db.js";
import { decryptSettingValue } from "./settingsCrypto.js";
import {
  downloadStorageProviderFile,
  fetchStorageProviderMetadata,
} from "./storageProviders.js";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const DROPBOX_TOKEN_URL = "https://api.dropboxapi.com/oauth2/token";
const DROPBOX_METADATA_URL = "https://api.dropboxapi.com/2/files/get_metadata";
const DROPBOX_DOWNLOAD_URL = "https://content.dropboxapi.com/2/files/download";
const MS_TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const MS_GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const PROVIDER_TIMEOUT_MS = Number.parseInt(process.env.PROVIDER_FETCH_TIMEOUT_MS || "15000", 10);
const PROVIDER_IMPORT_MAX_BYTES = Number.parseInt(process.env.PROVIDER_IMPORT_MAX_BYTES || `${100 * 1024 * 1024}`, 10);

function appSettingKeyForGroup(baseKey, groupId) {
  return Number.isInteger(groupId) && groupId > 0 ? `group:${groupId}:${baseKey}` : baseKey;
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

async function getAppSettingValueWithScopedFallback(baseKey, groupId) {
  const scopedKey = appSettingKeyForGroup(baseKey, groupId);
  const scopedRows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [scopedKey]);
  if (scopedRows.length) return scopedRows[0]?.value;
  if (!groupId) return null;
  const globalRows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [baseKey]);
  return globalRows[0]?.value || null;
}

function oauthConfigIsComplete(cfg) {
  return !!(
    String(cfg?.clientId || "").trim()
    && String(cfg?.clientSecret || "").trim()
    && String(cfg?.redirectUri || "").trim()
  );
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

async function getOneDriveOauthConfig(groupId = null) {
  const value = await getAppSettingValueWithScopedFallback("onedrive_oauth", groupId);
  const v = value || {};
  return {
    clientId: decryptSettingValue(String(v.clientId || "")).trim(),
    clientSecret: decryptSettingValue(String(v.clientSecret || "")).trim(),
    redirectUri: String(v.redirectUri || "").trim(),
    frontendUrl: String(v.frontendUrl || "http://localhost:5173").trim(),
  };
}

async function refreshGoogleAccessToken(cfg, refreshToken) {
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

async function getValidGoogleAccessToken(groupId, userId) {
  const cfg = await getGoogleOauthConfig(groupId);
  if (!oauthConfigIsComplete(cfg)) throw new Error("google_oauth_not_configured");
  const rows = await query(
    "SELECT access_token, refresh_token, expires_at FROM user_google_tokens WHERE user_id = $1 LIMIT 1",
    [userId]
  );
  if (!rows.length) throw new Error("google_not_connected");
  const rec = rows[0];
  const expiresAt = rec.expires_at ? new Date(rec.expires_at).getTime() : 0;
  if (rec.access_token && expiresAt > (Date.now() + 60_000)) return { cfg, accessToken: rec.access_token };
  if (!rec.refresh_token) throw new Error("google_refresh_token_missing");
  const refreshed = await refreshGoogleAccessToken(cfg, rec.refresh_token);
  await upsertGoogleTokens(userId, { ...refreshed, refresh_token: rec.refresh_token });
  return { cfg, accessToken: refreshed.access_token };
}

async function fetchGoogleDriveMetadata(accessToken, fileId) {
  const res = await fetchWithTimeout(
    `${GOOGLE_DRIVE_FILES_URL}/${encodeURIComponent(fileId)}?fields=id,name,mimeType,modifiedTime,size,webViewLink,trashed&supportsAllDrives=true`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`google_drive_metadata_failed: ${text.slice(0, 300)}`);
  }
  return res.json();
}

async function downloadGoogleDriveFile(accessToken, meta, fileId) {
  const mimeType = String(meta?.mimeType || "").trim();
  if (mimeType === "application/vnd.google-apps.spreadsheet") {
    const exportUrl = `${GOOGLE_DRIVE_FILES_URL}/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}&supportsAllDrives=true`;
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

  const mediaUrl = `${GOOGLE_DRIVE_FILES_URL}/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;
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
    extension: mimeType === "text/csv" ? ".csv" : (mimeType === "application/vnd.ms-excel" ? ".xls" : ".xlsx"),
  };
}

async function getValidDropboxAccessToken(groupId, userId) {
  const cfg = await getDropboxOauthConfig(groupId);
  if (!oauthConfigIsComplete(cfg)) throw new Error("dropbox_oauth_not_configured");
  const rows = await query(
    "SELECT access_token, refresh_token, expires_at FROM user_dropbox_tokens WHERE user_id = $1 LIMIT 1",
    [userId]
  );
  if (!rows.length) throw new Error("dropbox_not_connected");
  const rec = rows[0];
  const expiresAt = rec.expires_at ? new Date(rec.expires_at).getTime() : 0;
  if (rec.access_token && expiresAt > (Date.now() + 60_000)) return { cfg, accessToken: rec.access_token };
  if (!rec.refresh_token) throw new Error("dropbox_refresh_token_missing");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: rec.refresh_token,
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
  const refreshed = await res.json();
  const refreshToken = refreshed.refresh_token || rec.refresh_token;
  const expiresIn = Number(refreshed?.expires_in || 14400);
  const expiresAtNew = new Date(Date.now() + Math.max(60, expiresIn) * 1000);
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
      refreshed?.dropbox_account_id || null,
      refreshed?.access_token || null,
      refreshToken || null,
      refreshed?.scope || null,
      refreshed?.token_type || "Bearer",
      expiresAtNew.toISOString(),
    ]
  );
  return { cfg, accessToken: refreshed.access_token };
}

async function fetchDropboxMetadata(accessToken, sourceRef) {
  const resp = await fetchWithTimeout(DROPBOX_METADATA_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ path: sourceRef }),
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`dropbox_metadata_failed: ${txt.slice(0, 300)}`);
  }
  const meta = await resp.json();
  const pathLower = String(meta?.path_lower || "").trim();
  const marker = [String(meta?.server_modified || ""), String(meta?.content_hash || "")].filter(Boolean).join("|");
  return {
    provider: "dropbox",
    sourceRef,
    remoteMarker: marker || String(meta?.id || sourceRef || ""),
    remoteModifiedAt: meta?.server_modified || null,
    originalName: String(meta?.name || "dropbox-file").trim(),
    pathLower,
    fileId: String(meta?.id || sourceRef || "").trim(),
  };
}

async function downloadDropboxFile(accessToken, meta, sourceRef) {
  const pathRef = String(meta?.pathLower || sourceRef || "").trim();
  const resp = await fetchWithTimeout(DROPBOX_DOWNLOAD_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Dropbox-API-Arg": JSON.stringify({ path: pathRef }),
    },
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`dropbox_download_failed: ${txt.slice(0, 300)}`);
  }
  assertProviderContentLengthWithinLimit(resp);
  const buf = Buffer.from(await resp.arrayBuffer());
  if (buf.length > PROVIDER_IMPORT_MAX_BYTES) {
    const err = new Error("provider_file_too_large");
    err.statusCode = 413;
    err.maxBytes = PROVIDER_IMPORT_MAX_BYTES;
    throw err;
  }
  const ext = pathRef.toLowerCase().endsWith(".csv") ? ".csv" : (pathRef.toLowerCase().endsWith(".xls") ? ".xls" : ".xlsx");
  return {
    buffer: buf,
    mimeType: "application/octet-stream",
    extension: ext,
  };
}

async function getValidOneDriveAccessToken(groupId, userId) {
  const cfg = await getOneDriveOauthConfig(groupId);
  if (!oauthConfigIsComplete(cfg)) throw new Error("onedrive_oauth_not_configured");
  const rows = await query(
    "SELECT access_token, refresh_token, expires_at FROM user_onedrive_tokens WHERE user_id = $1 LIMIT 1",
    [userId]
  );
  if (!rows.length) throw new Error("onedrive_not_connected");
  const rec = rows[0];
  const expiresAt = rec.expires_at ? new Date(rec.expires_at).getTime() : 0;
  if (rec.access_token && expiresAt > (Date.now() + 60_000)) return { cfg, accessToken: rec.access_token };
  if (!rec.refresh_token) throw new Error("onedrive_refresh_token_missing");
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: rec.refresh_token,
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
  const refreshed = await res.json();
  const expiresIn = Number(refreshed?.expires_in || 3600);
  const expiresAtNew = new Date(Date.now() + Math.max(60, expiresIn) * 1000);
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
      refreshed?.drive_id || null,
      refreshed?.access_token || null,
      refreshed?.refresh_token || rec.refresh_token || null,
      refreshed?.scope || null,
      refreshed?.token_type || "Bearer",
      expiresAtNew.toISOString(),
    ]
  );
  return { cfg, accessToken: refreshed.access_token };
}

async function fetchOneDriveMetadata(accessToken, sourceRef) {
  const resp = await fetchWithTimeout(
    `${MS_GRAPH_BASE}/me/drive/items/${encodeURIComponent(sourceRef)}?$select=id,name,lastModifiedDateTime,size,file,webUrl,parentReference`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`onedrive_metadata_failed: ${txt.slice(0, 300)}`);
  }
  const meta = await resp.json();
  return {
    provider: "onedrive",
    sourceRef,
    remoteMarker: String(meta?.lastModifiedDateTime || meta?.id || sourceRef || ""),
    remoteModifiedAt: meta?.lastModifiedDateTime || null,
    originalName: String(meta?.name || "onedrive-file").trim(),
    itemId: String(meta?.id || sourceRef || "").trim(),
  };
}

async function downloadOneDriveFile(accessToken, meta, sourceRef) {
  const itemId = String(meta?.itemId || sourceRef || "").trim();
  const resp = await fetchWithTimeout(`${MS_GRAPH_BASE}/me/drive/items/${encodeURIComponent(itemId)}/content`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`onedrive_download_failed: ${txt.slice(0, 300)}`);
  }
  assertProviderContentLengthWithinLimit(resp);
  const buf = Buffer.from(await resp.arrayBuffer());
  if (buf.length > PROVIDER_IMPORT_MAX_BYTES) {
    const err = new Error("provider_file_too_large");
    err.statusCode = 413;
    err.maxBytes = PROVIDER_IMPORT_MAX_BYTES;
    throw err;
  }
  const lowerName = String(meta?.originalName || "").toLowerCase();
  return {
    buffer: buf,
    mimeType: "application/octet-stream",
    extension: lowerName.endsWith(".csv") ? ".csv" : (lowerName.endsWith(".xls") ? ".xls" : ".xlsx"),
  };
}

export async function fetchProviderAutosyncMetadata({ provider, groupId = null, userId = null, sourceRef = null }) {
  const normalizedProvider = String(provider || "").trim().toLowerCase();
  const ref = String(sourceRef || "").trim();
  if (!normalizedProvider || !ref || !Number.isInteger(Number(userId)) || Number(userId) <= 0) return null;

  if (normalizedProvider === "google_drive") {
    const { accessToken } = await getValidGoogleAccessToken(groupId, userId);
    return fetchGoogleDriveMetadata(accessToken, ref);
  }
  if (normalizedProvider === "dropbox") {
    const { accessToken } = await getValidDropboxAccessToken(groupId, userId);
    return fetchDropboxMetadata(accessToken, ref);
  }
  if (normalizedProvider === "onedrive") {
    const { accessToken } = await getValidOneDriveAccessToken(groupId, userId);
    return fetchOneDriveMetadata(accessToken, ref);
  }
  if (normalizedProvider === "sftp_storage" || normalizedProvider === "gcs_storage" || normalizedProvider === "s3_storage" || normalizedProvider === "azure_blob_storage") {
    return fetchStorageProviderMetadata({ provider: normalizedProvider, groupId, userId, sourceRef: ref });
  }
  throw new Error("unsupported_autosync_provider");
}

export async function downloadProviderAutosyncFile({ provider, groupId = null, userId = null, sourceRef = null }) {
  const normalizedProvider = String(provider || "").trim().toLowerCase();
  const ref = String(sourceRef || "").trim();
  if (!normalizedProvider || !ref || !Number.isInteger(Number(userId)) || Number(userId) <= 0) return null;

  if (normalizedProvider === "google_drive") {
    const { accessToken } = await getValidGoogleAccessToken(groupId, userId);
    const meta = await fetchGoogleDriveMetadata(accessToken, ref);
    const download = await downloadGoogleDriveFile(accessToken, meta, ref);
    return { ...meta, ...download, provider: "google_drive", sourceRef: ref };
  }
  if (normalizedProvider === "dropbox") {
    const { accessToken } = await getValidDropboxAccessToken(groupId, userId);
    const meta = await fetchDropboxMetadata(accessToken, ref);
    const download = await downloadDropboxFile(accessToken, meta, ref);
    return { ...meta, ...download, provider: "dropbox", sourceRef: ref };
  }
  if (normalizedProvider === "onedrive") {
    const { accessToken } = await getValidOneDriveAccessToken(groupId, userId);
    const meta = await fetchOneDriveMetadata(accessToken, ref);
    const download = await downloadOneDriveFile(accessToken, meta, ref);
    return { ...meta, ...download, provider: "onedrive", sourceRef: ref };
  }
  if (normalizedProvider === "sftp_storage" || normalizedProvider === "gcs_storage" || normalizedProvider === "s3_storage" || normalizedProvider === "azure_blob_storage") {
    return downloadStorageProviderFile({ provider: normalizedProvider, groupId, userId, sourceRef: ref });
  }
  throw new Error("unsupported_autosync_provider");
}
