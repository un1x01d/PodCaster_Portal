import path from "path";
import {
  createGcsJwtAssertion,
  fetchWithTimeout,
  trimString,
  supportedSpreadsheetExt,
  assertProviderContentLengthWithinLimit,
  PROVIDER_IMPORT_MAX_BYTES,
} from "./common.js";

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
    throw new Error("gcs_token_exchange_failed");
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

export async function listGcsEntries(cfg, currentPath) {
  const bucket = trimString(cfg?.bucket);
  if (!bucket) throw new Error("gcs_not_configured");
  const prefix = normalizeGcsPrefix(trimString(currentPath, trimString(cfg?.prefix, "")));
  const accessToken = await getGcsAccessToken(cfg);
  const url = new URL(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o`);
  if (prefix) url.searchParams.set("prefix", prefix);
  url.searchParams.set("delimiter", "/");
  url.searchParams.set("fields", "items(name,size,updated),prefixes");
  const res = await fetchWithTimeout(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    throw new Error("gcs_list_failed");
  }
  const json = await res.json();
  const files = Array.isArray(json?.items) ? json.items : [];
  const folders = Array.isArray(json?.prefixes) ? json.prefixes : [];
  const entries = [
    ...folders.map((folderPath) => ({ id: folderPath, name: objectNameToLabel(folderPath, prefix), path: folderPath, isFolder: true, size: 0, updatedAt: null })),
    ...files
      .filter((item) => supportedSpreadsheetExt(item?.name))
      .map((item) => ({ id: String(item?.name || ""), name: objectNameToLabel(item?.name, prefix), path: String(item?.name || ""), isFolder: false, size: Number.parseInt(item?.size, 10) || 0, updatedAt: item?.updated || null })),
  ].filter((entry) => entry.id);
  return { entries, path: prefix || "" };
}

export async function fetchGcsMetadata(cfg, sourceRef) {
  const bucket = trimString(cfg?.bucket);
  const objectName = trimString(sourceRef);
  if (!bucket || !objectName) throw new Error("gcs_not_configured");
  const accessToken = await getGcsAccessToken(cfg);
  const url = new URL(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(objectName)}`);
  url.searchParams.set("fields", "name,updated,size,generation,md5Hash");
  const res = await fetchWithTimeout(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    throw new Error("gcs_metadata_failed");
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

export async function downloadGcsFile(cfg, sourceRef) {
  const bucket = trimString(cfg?.bucket);
  const objectName = trimString(sourceRef);
  if (!bucket || !objectName) throw new Error("gcs_not_configured");
  const accessToken = await getGcsAccessToken(cfg);
  const url = new URL(`https://storage.googleapis.com/download/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(objectName)}`);
  url.searchParams.set("alt", "media");
  const res = await fetchWithTimeout(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    throw new Error("gcs_download_failed");
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
