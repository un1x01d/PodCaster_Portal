import path from "path";
import {
  trimString,
  decryptSettingValue,
  fetchWithTimeout,
  decodeXmlEntities,
  supportedSpreadsheetExt,
  buildAzureSharedKeyAuth,
  assertProviderContentLengthWithinLimit,
  PROVIDER_IMPORT_MAX_BYTES,
} from "./common.js";

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
  while ((match = folderRegex.exec(text))) folders.push(decodeXmlEntities(match[1]));
  const fileRegex = /<Blob>\s*<Name>(.*?)<\/Name>[\s\S]*?<Properties>[\s\S]*?<Last-Modified>(.*?)<\/Last-Modified>[\s\S]*?<Content-Length>(.*?)<\/Content-Length>[\s\S]*?<\/Properties>[\s\S]*?<\/Blob>/gms;
  while ((match = fileRegex.exec(text))) files.push({ name: decodeXmlEntities(match[1]), updatedAt: decodeXmlEntities(match[2]), size: Number.parseInt(match[3], 10) || 0 });
  return { folders, files };
}

export async function listAzureEntries(cfg, currentPath) {
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
  const { authorization, xmsDate, xmsVersion } = buildAzureSharedKeyAuth({ method: "GET", url, accountName, accountKey: trimString(decryptSettingValue(String(cfg?.accountKey || ""))) });
  const res = await fetchWithTimeout(url.toString(), { method: "GET", headers: { Authorization: authorization, "x-ms-date": xmsDate, "x-ms-version": xmsVersion } });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`azure_list_failed: ${text.slice(0, 400)}`);
  }
  const xml = await res.text();
  const { folders, files } = parseAzureListXml(xml);
  const entries = [
    ...folders.map((folderPath) => ({ id: folderPath, name: folderPath.replace(/\/+$/, "").split("/").filter(Boolean).pop() || folderPath, path: folderPath, isFolder: true, size: 0, updatedAt: null })),
    ...files.filter((item) => supportedSpreadsheetExt(item.name)).map((item) => ({ id: item.name, name: item.name.replace(/\/+$/, "").split("/").filter(Boolean).pop() || item.name, path: item.name, isFolder: false, size: item.size, updatedAt: item.updatedAt || null })),
  ].filter((entry) => entry.id);
  return { entries, path: prefix || "" };
}

export async function fetchAzureMetadata(cfg, sourceRef) {
  const accountName = trimString(cfg?.accountName);
  const container = trimString(cfg?.container);
  const endpointSuffix = trimString(cfg?.endpointSuffix, "blob.core.windows.net");
  const blobName = trimString(sourceRef);
  if (!accountName || !container || !blobName) throw new Error("azure_not_configured");
  const url = new URL(`https://${accountName}.${endpointSuffix}/${container}/${blobName}`);
  const { authorization, xmsDate, xmsVersion } = buildAzureSharedKeyAuth({ method: "HEAD", url, accountName, accountKey: trimString(decryptSettingValue(String(cfg?.accountKey || ""))) });
  const res = await fetchWithTimeout(url.toString(), { method: "HEAD", headers: { Authorization: authorization, "x-ms-date": xmsDate, "x-ms-version": xmsVersion } });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`azure_metadata_failed: ${text.slice(0, 400)}`);
  }
  const lastModified = res.headers.get("last-modified") || null;
  const size = res.headers.get("content-length") || null;
  const etag = String(res.headers.get("etag") || "").replaceAll("\"", "");
  return { provider: "azure_blob_storage", sourceRef: blobName, remoteMarker: [etag, lastModified, size].filter(Boolean).join("|") || blobName, remoteModifiedAt: lastModified || null, originalName: path.basename(blobName) || "azure-file", azureBlobName: blobName };
}

export async function downloadAzureFile(cfg, sourceRef) {
  const accountName = trimString(cfg?.accountName);
  const container = trimString(cfg?.container);
  const endpointSuffix = trimString(cfg?.endpointSuffix, "blob.core.windows.net");
  const blobName = trimString(sourceRef);
  if (!accountName || !container || !blobName) throw new Error("azure_not_configured");
  const url = new URL(`https://${accountName}.${endpointSuffix}/${container}/${blobName}`);
  const { authorization, xmsDate, xmsVersion } = buildAzureSharedKeyAuth({ method: "GET", url, accountName, accountKey: trimString(decryptSettingValue(String(cfg?.accountKey || ""))) });
  const res = await fetchWithTimeout(url.toString(), { method: "GET", headers: { Authorization: authorization, "x-ms-date": xmsDate, "x-ms-version": xmsVersion } });
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
