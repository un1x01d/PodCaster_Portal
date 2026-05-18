import path from "path";
import { timingSafeEqual } from "crypto";

export function sanitizeDisplayName(value) {
  const text = String(value || "").trim().replace(/\s+/g, "_");
  return text.slice(0, 120);
}

export function sanitizeReportSourceName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 160);
}

export function normalizeEmailAddress(value) {
  return String(value || "").trim().toLowerCase();
}

function looksLikeZipContainer(buffer) {
  return Buffer.isBuffer(buffer)
    && buffer.length >= 4
    && buffer[0] === 0x50
    && buffer[1] === 0x4b
    && buffer[2] === 0x03
    && buffer[3] === 0x04;
}

function looksLikeLegacyXls(buffer) {
  return Buffer.isBuffer(buffer)
    && buffer.length >= 8
    && buffer[0] === 0xd0
    && buffer[1] === 0xcf
    && buffer[2] === 0x11
    && buffer[3] === 0xe0
    && buffer[4] === 0xa1
    && buffer[5] === 0xb1
    && buffer[6] === 0x1a
    && buffer[7] === 0xe1;
}

function looksLikeCsvText(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return false;
  const sample = buffer.subarray(0, Math.min(buffer.length, 512)).toString("utf8");
  const normalized = sample.replace(/^\uFEFF/, "").trim();
  if (!normalized) return false;
  if (normalized.includes("\u0000")) return false;
  return /[,\t;\n]/.test(normalized);
}

export function assertUploadSignatureMatchesExtension({ originalName = "", fileBuffer = null }) {
  const ext = String(path.extname(String(originalName || "") || "").toLowerCase());
  if (!Buffer.isBuffer(fileBuffer) || fileBuffer.length < 4) {
    const err = new Error("unsupported_file_type");
    err.statusCode = 415;
    throw err;
  }
  if (ext === ".xlsx") {
    if (!looksLikeZipContainer(fileBuffer)) {
      const err = new Error("unsupported_file_type");
      err.statusCode = 415;
      throw err;
    }
    return;
  }
  if (ext === ".xls") {
    if (!looksLikeLegacyXls(fileBuffer) && !looksLikeZipContainer(fileBuffer)) {
      const err = new Error("unsupported_file_type");
      err.statusCode = 415;
      throw err;
    }
    return;
  }
  if (ext === ".csv") {
    if (!looksLikeCsvText(fileBuffer)) {
      const err = new Error("unsupported_file_type");
      err.statusCode = 415;
      throw err;
    }
    return;
  }
  const err = new Error("unsupported_file_type");
  err.statusCode = 415;
  throw err;
}

export function hasValidEmailIngestSharedSecret(req) {
  const expected = String(process.env.EMAIL_INGEST_SHARED_SECRET || "").trim();
  if (!expected) return process.env.NODE_ENV !== "production";
  const provided = String(
    req.headers["x-email-ingest-secret"]
    || req.headers["x-ingest-secret"]
    || req.body?.ingest_secret
    || ""
  ).trim();
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function normalizeEmailLocalPart(value) {
  return String(value || "").trim().toLowerCase().split("+")[0].trim();
}

export function extractEmailAddresses(value) {
  const entries = Array.isArray(value)
    ? value
    : String(value || "")
      .split(/[\n,;]+/)
      .map((item) => item.trim());
  return Array.from(new Set(entries.map((entry) => {
    const raw = String(entry || "").trim();
    if (!raw) return "";
    const angle = raw.match(/<([^>]+)>/);
    return normalizeEmailAddress(angle ? angle[1] : raw);
  }).filter(Boolean)));
}

function emailDomainFromAddress(value) {
  const email = normalizeEmailAddress(value);
  const idx = email.lastIndexOf("@");
  return idx > 0 ? email.slice(idx + 1) : "";
}

export function senderDomainIsAllowed(senderEmail, allowedDomains = []) {
  const senderDomain = emailDomainFromAddress(senderEmail);
  if (!senderDomain) return false;
  const normalizedAllowed = Array.isArray(allowedDomains)
    ? allowedDomains.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean)
    : [];
  if (!normalizedAllowed.length) return false;
  return normalizedAllowed.some((allowed) => senderDomain === allowed || senderDomain.endsWith(`.${allowed}`));
}
