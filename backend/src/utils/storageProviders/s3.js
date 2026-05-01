import path from "path";
import {
  trimString,
  toBoolean,
  awsAmzDate,
  awsDateStamp,
  awsHexSha256,
  awsHmac,
  awsSigningKey,
  canonicalQueryString,
  decryptSettingValue,
  fetchWithTimeout,
  decodeXmlEntities,
  supportedSpreadsheetExt,
  assertProviderContentLengthWithinLimit,
  PROVIDER_IMPORT_MAX_BYTES,
} from "./common.js";

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
  if (!bucket || !region || !accessKeyId || !secretAccessKey) throw new Error("s3_not_configured");

  const amzDate = awsAmzDate();
  const dateStamp = awsDateStamp(amzDate);
  const payloadHash = awsHexSha256("");
  const canonicalHeaders = `host:${url.host}\n` + `x-amz-content-sha256:${payloadHash}\n` + `x-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [method, url.pathname || "/", canonicalQueryString(url.searchParams), canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, awsHexSha256(canonicalRequest)].join("\n");
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
  while ((match = folderRegex.exec(text))) folders.push(decodeXmlEntities(match[1]));
  const fileRegex = /<Contents>\s*<Key>(.*?)<\/Key>[\s\S]*?<LastModified>(.*?)<\/LastModified>[\s\S]*?<Size>(.*?)<\/Size>[\s\S]*?<\/Contents>/gms;
  while ((match = fileRegex.exec(text))) files.push({ key: decodeXmlEntities(match[1]), updatedAt: decodeXmlEntities(match[2]), size: Number.parseInt(match[3], 10) || 0 });
  return { folders, files };
}

export async function listS3Entries(cfg, currentPath) {
  const prefix = trimString(currentPath, trimString(cfg?.prefix, ""));
  const { url, authorization, amzDate, payloadHash } = buildS3Url(cfg, {
    pathName: "/",
    queryParams: { "list-type": "2", delimiter: "/", ...(prefix ? { prefix } : {}) },
    method: "GET",
  });
  const res = await fetchWithTimeout(url.toString(), { method: "GET", headers: { Authorization: authorization, "x-amz-date": amzDate, "x-amz-content-sha256": payloadHash } });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`s3_list_failed: ${text.slice(0, 400)}`);
  }
  const xml = await res.text();
  const { folders, files } = parseAwsListXml(xml);
  const entries = [
    ...folders.map((folderPath) => ({ id: folderPath, name: folderPath.replace(/\/+$/, "").split("/").filter(Boolean).pop() || folderPath, path: folderPath, isFolder: true, size: 0, updatedAt: null })),
    ...files.filter((item) => supportedSpreadsheetExt(item.key)).map((item) => ({ id: item.key, name: item.key.replace(/\/+$/, "").split("/").filter(Boolean).pop() || item.key, path: item.key, isFolder: false, size: item.size, updatedAt: item.updatedAt || null })),
  ].filter((entry) => entry.id);
  return { entries, path: prefix || "" };
}

export async function fetchS3Metadata(cfg, sourceRef) {
  const key = trimString(sourceRef);
  const { url, authorization, amzDate, payloadHash } = buildS3Url(cfg, { pathName: `/${key}`, method: "HEAD" });
  const res = await fetchWithTimeout(url.toString(), { method: "HEAD", headers: { Authorization: authorization, "x-amz-date": amzDate, "x-amz-content-sha256": payloadHash } });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`s3_metadata_failed: ${text.slice(0, 400)}`);
  }
  const etag = String(res.headers.get("etag") || "").replaceAll("\"", "");
  const lastModified = res.headers.get("last-modified") || null;
  const size = res.headers.get("content-length") || null;
  return { provider: "s3_storage", sourceRef: key, remoteMarker: [etag, lastModified, size].filter(Boolean).join("|") || key, remoteModifiedAt: lastModified || null, originalName: path.basename(key) || "s3-file", s3Key: key };
}

export async function downloadS3File(cfg, sourceRef) {
  const key = trimString(sourceRef);
  const { url, authorization, amzDate, payloadHash } = buildS3Url(cfg, { pathName: `/${key}`, method: "GET" });
  const res = await fetchWithTimeout(url.toString(), { method: "GET", headers: { Authorization: authorization, "x-amz-date": amzDate, "x-amz-content-sha256": payloadHash } });
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
