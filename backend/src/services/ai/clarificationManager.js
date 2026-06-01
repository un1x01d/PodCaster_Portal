import { query } from "../../config/db.js";

const PENDING_FALLBACK = new Map();
const KEY_PREFIX = "chat_pending_clarification";
const DEFAULT_TTL_MS = 30 * 60 * 1000;
const DEFAULT_DB_TIMEOUT_MS = 1500;

function normalize(s) { return String(s || "").trim().toLowerCase(); }

function ordinalToNumber(text) {
  const map = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5 };
  return map[normalize(text).replace(/^the\s+/, "").replace(/\s+one$/, "")] || null;
}

function safeInt(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function safeKeyPart(value, fallback) {
  const raw = String(value || fallback || "").trim() || String(fallback || "default");
  return raw.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 128) || String(fallback || "default");
}

function ttlMs() {
  const configured = Number(process.env.CHAT_CLARIFICATION_TTL_MS || "");
  return Number.isFinite(configured) && configured > 0 ? Math.trunc(configured) : DEFAULT_TTL_MS;
}

function dbTimeoutMs() {
  const configured = Number(process.env.CHAT_CLARIFICATION_DB_TIMEOUT_MS || "");
  return Number.isFinite(configured) && configured > 0 ? Math.trunc(configured) : DEFAULT_DB_TIMEOUT_MS;
}

function memoryOnlyStore() {
  return String(process.env.CHAT_CLARIFICATION_STORE || "").toLowerCase() === "memory";
}

async function queryWithTimeout(sql, params = []) {
  let timer = null;
  try {
    return await Promise.race([
      query(sql, params),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("clarification_db_timeout")), dbTimeoutMs());
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function nowIso() {
  return new Date().toISOString();
}

function toEpochMs(value) {
  const t = Date.parse(String(value || ""));
  return Number.isFinite(t) ? t : 0;
}

function envelope(payload = {}) {
  const createdAt = payload.createdAt || nowIso();
  const expiresAt = payload.expiresAt || new Date(Date.now() + ttlMs()).toISOString();
  return {
    ...payload,
    createdAt,
    expiresAt,
  };
}

function isExpired(payload) {
  return toEpochMs(payload?.expiresAt) > 0 && toEpochMs(payload.expiresAt) <= Date.now();
}

export function clarificationKey({ tenantId = null, userId, sessionId = "default", sheetId }) {
  return [
    KEY_PREFIX,
    safeInt(tenantId, 0),
    safeInt(userId, 0),
    safeKeyPart(sessionId, "default"),
    safeKeyPart(sheetId, "nosheet"),
  ].join(":");
}

export async function setPendingClarification(key, payload) {
  const scopedKey = String(key || "").trim();
  if (!scopedKey) return false;
  const value = envelope(payload && typeof payload === "object" ? payload : {});
  if (memoryOnlyStore()) {
    PENDING_FALLBACK.set(scopedKey, value);
    return true;
  }
  try {
    await queryWithTimeout(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
      [scopedKey, JSON.stringify(value)]
    );
    PENDING_FALLBACK.set(scopedKey, value);
    return true;
  } catch (_) {
    PENDING_FALLBACK.set(scopedKey, value);
    return false;
  }
}

export async function clearPendingClarification(key) {
  const scopedKey = String(key || "").trim();
  if (!scopedKey) return false;
  PENDING_FALLBACK.delete(scopedKey);
  if (memoryOnlyStore()) return true;
  try {
    await queryWithTimeout("DELETE FROM app_settings WHERE key = $1", [scopedKey]);
    return true;
  } catch (_) {
    return false;
  }
}

export async function getPendingClarification(key) {
  const scopedKey = String(key || "").trim();
  if (!scopedKey) return null;
  let value = null;
  if (memoryOnlyStore()) value = PENDING_FALLBACK.get(scopedKey) || null;
  if (!memoryOnlyStore()) {
    try {
      const rows = await queryWithTimeout("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [scopedKey]);
    const raw = rows?.[0]?.value;
      if (raw && typeof raw === "object") value = raw;
    } catch (_) {
      value = PENDING_FALLBACK.get(scopedKey) || null;
    }
  }
  if (!value) value = PENDING_FALLBACK.get(scopedKey) || null;
  if (!value) return null;
  if (isExpired(value)) {
    await clearPendingClarification(scopedKey);
    return null;
  }
  return value;
}

export function resolveClarificationReply(pending, rawReply) {
  if (!pending || !Array.isArray(pending.options) || !pending.options.length) return null;
  const opts = pending.options.map((o, idx) => ({ idx: idx + 1, value: String(o.value || o.label || "").trim() })).filter((o) => o.value);
  const reply = String(rawReply || "").trim();
  if (!reply) return null;
  const n = Number.parseInt((reply.match(/#?\s*(\d+)/) || [])[1] || "", 10);
  if (Number.isInteger(n)) {
    const hit = opts.find((o) => o.idx === n);
    if (hit) return hit.value;
  }
  const ord = ordinalToNumber(reply);
  if (ord) {
    const hit = opts.find((o) => o.idx === ord);
    if (hit) return hit.value;
  }
  const low = normalize(reply);
  const exact = opts.find((o) => normalize(o.value) === low);
  if (exact) return exact.value;
  const includes = opts.find((o) => low.includes(normalize(o.value)) || normalize(o.value).includes(low));
  return includes ? includes.value : null;
}

export function __clearClarificationFallbackForTests() {
  PENDING_FALLBACK.clear();
}
