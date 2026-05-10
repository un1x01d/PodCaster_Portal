import { query } from "../config/db.js";

const loginBuckets = new Map();
const aiBuckets = new Map();
const invitationLookupBuckets = new Map();
const invitationAcceptBuckets = new Map();
const invitationIssueBuckets = new Map();
const twoFactorBuckets = new Map();
const oauthPublicBuckets = new Map();
const oauthExchangeBuckets = new Map();
const uploadBuckets = new Map();
const expensiveTenantBuckets = new Map();

const MAX_ATTEMPTS = Number.parseInt(process.env.LOGIN_RATE_LIMIT_MAX || "10", 10);
const WINDOW_MS = Number.parseInt(process.env.LOGIN_RATE_LIMIT_WINDOW_MS || `${15 * 60 * 1000}`, 10);
const PRUNE_INTERVAL_MS = Number.parseInt(process.env.LOGIN_RATE_LIMIT_PRUNE_INTERVAL_MS || "60000", 10);
const MAX_BUCKETS = Number.parseInt(process.env.LOGIN_RATE_LIMIT_MAX_BUCKETS || "50000", 10);
const AI_MAX_ATTEMPTS = Number.parseInt(process.env.AI_RATE_LIMIT_MAX || "60", 10);
const AI_WINDOW_MS = Number.parseInt(process.env.AI_RATE_LIMIT_WINDOW_MS || `${60 * 1000}`, 10);
const AI_MAX_BUCKETS = Number.parseInt(process.env.AI_RATE_LIMIT_MAX_BUCKETS || "50000", 10);
const INVITE_LOOKUP_MAX_ATTEMPTS = Number.parseInt(process.env.INVITE_LOOKUP_RATE_LIMIT_MAX || "40", 10);
const INVITE_LOOKUP_WINDOW_MS = Number.parseInt(process.env.INVITE_LOOKUP_RATE_LIMIT_WINDOW_MS || `${5 * 60 * 1000}`, 10);
const INVITE_LOOKUP_MAX_BUCKETS = Number.parseInt(process.env.INVITE_LOOKUP_RATE_LIMIT_MAX_BUCKETS || "50000", 10);
const INVITE_ACCEPT_MAX_ATTEMPTS = Number.parseInt(process.env.INVITE_ACCEPT_RATE_LIMIT_MAX || "15", 10);
const INVITE_ACCEPT_WINDOW_MS = Number.parseInt(process.env.INVITE_ACCEPT_RATE_LIMIT_WINDOW_MS || `${10 * 60 * 1000}`, 10);
const INVITE_ACCEPT_MAX_BUCKETS = Number.parseInt(process.env.INVITE_ACCEPT_RATE_LIMIT_MAX_BUCKETS || "50000", 10);
const INVITE_ISSUE_MAX_ATTEMPTS = Number.parseInt(process.env.INVITE_ISSUE_RATE_LIMIT_MAX || "30", 10);
const INVITE_ISSUE_WINDOW_MS = Number.parseInt(process.env.INVITE_ISSUE_RATE_LIMIT_WINDOW_MS || `${10 * 60 * 1000}`, 10);
const INVITE_ISSUE_MAX_BUCKETS = Number.parseInt(process.env.INVITE_ISSUE_RATE_LIMIT_MAX_BUCKETS || "50000", 10);
const TWO_FACTOR_MAX_ATTEMPTS = Number.parseInt(process.env.TWO_FACTOR_RATE_LIMIT_MAX || "20", 10);
const TWO_FACTOR_WINDOW_MS = Number.parseInt(process.env.TWO_FACTOR_RATE_LIMIT_WINDOW_MS || `${10 * 60 * 1000}`, 10);
const TWO_FACTOR_MAX_BUCKETS = Number.parseInt(process.env.TWO_FACTOR_RATE_LIMIT_MAX_BUCKETS || "50000", 10);
const OAUTH_PUBLIC_MAX_ATTEMPTS = Number.parseInt(process.env.OAUTH_PUBLIC_RATE_LIMIT_MAX || "40", 10);
const OAUTH_PUBLIC_WINDOW_MS = Number.parseInt(process.env.OAUTH_PUBLIC_RATE_LIMIT_WINDOW_MS || `${5 * 60 * 1000}`, 10);
const OAUTH_PUBLIC_MAX_BUCKETS = Number.parseInt(process.env.OAUTH_PUBLIC_RATE_LIMIT_MAX_BUCKETS || "50000", 10);
const OAUTH_EXCHANGE_MAX_ATTEMPTS = Number.parseInt(process.env.OAUTH_EXCHANGE_RATE_LIMIT_MAX || "20", 10);
const OAUTH_EXCHANGE_WINDOW_MS = Number.parseInt(process.env.OAUTH_EXCHANGE_RATE_LIMIT_WINDOW_MS || `${5 * 60 * 1000}`, 10);
const OAUTH_EXCHANGE_MAX_BUCKETS = Number.parseInt(process.env.OAUTH_EXCHANGE_RATE_LIMIT_MAX_BUCKETS || "50000", 10);
const UPLOAD_MAX_ATTEMPTS = Number.parseInt(process.env.UPLOAD_RATE_LIMIT_MAX || "5", 10);
const UPLOAD_WINDOW_MS = Number.parseInt(process.env.UPLOAD_RATE_LIMIT_WINDOW_MS || `${15 * 60 * 1000}`, 10);
const UPLOAD_MAX_BUCKETS = Number.parseInt(process.env.UPLOAD_RATE_LIMIT_MAX_BUCKETS || "10000", 10);
const EXPENSIVE_TENANT_MAX_ATTEMPTS = Number.parseInt(process.env.EXPENSIVE_TENANT_RATE_LIMIT_MAX || "120", 10);
const EXPENSIVE_TENANT_WINDOW_MS = Number.parseInt(process.env.EXPENSIVE_TENANT_RATE_LIMIT_WINDOW_MS || `${60 * 1000}`, 10);
const EXPENSIVE_TENANT_MAX_BUCKETS = Number.parseInt(process.env.EXPENSIVE_TENANT_RATE_LIMIT_MAX_BUCKETS || "50000", 10);
let lastPruneAt = 0;
const DISTRIBUTED_RATE_LIMIT = String(
  process.env.RATE_LIMIT_DISTRIBUTED ?? "1"
).trim() !== "0";
const RATE_LIMIT_FAIL_OPEN = String(
  process.env.RATE_LIMIT_FAIL_OPEN ?? "0"
).trim() !== "0";

function pruneExpiredBuckets(now) {
  if (now - lastPruneAt < PRUNE_INTERVAL_MS) return;
  lastPruneAt = now;
  for (const [key, value] of loginBuckets.entries()) {
    if (now > value.expiresAt) loginBuckets.delete(key);
  }
  for (const [key, value] of aiBuckets.entries()) {
    if (now > value.expiresAt) aiBuckets.delete(key);
  }
  for (const [key, value] of invitationLookupBuckets.entries()) {
    if (now > value.expiresAt) invitationLookupBuckets.delete(key);
  }
  for (const [key, value] of invitationAcceptBuckets.entries()) {
    if (now > value.expiresAt) invitationAcceptBuckets.delete(key);
  }
  for (const [key, value] of invitationIssueBuckets.entries()) {
    if (now > value.expiresAt) invitationIssueBuckets.delete(key);
  }
  for (const [key, value] of twoFactorBuckets.entries()) {
    if (now > value.expiresAt) twoFactorBuckets.delete(key);
  }
  for (const [key, value] of oauthPublicBuckets.entries()) {
    if (now > value.expiresAt) oauthPublicBuckets.delete(key);
  }
  for (const [key, value] of oauthExchangeBuckets.entries()) {
    if (now > value.expiresAt) oauthExchangeBuckets.delete(key);
  }
  for (const [key, value] of uploadBuckets.entries()) {
    if (now > value.expiresAt) uploadBuckets.delete(key);
  }
  for (const [key, value] of expensiveTenantBuckets.entries()) {
    if (now > value.expiresAt) expensiveTenantBuckets.delete(key);
  }
}

function keyFromReq(req) {
  const ip = req.ip || req.connection?.remoteAddress || "unknown";
  const email = (req.body?.email || "").toString().trim().toLowerCase();
  return `${ip}:${email}`;
}

function aiKeyFromReq(req) {
  const ip = req.ip || req.connection?.remoteAddress || "unknown";
  const uid = req.user?.id ? String(req.user.id) : "anon";
  const route = String(req.route?.path || req.path || "").trim();
  return `${ip}:${uid}:${route}`;
}

function invitationLookupKeyFromReq(req) {
  const ip = req.ip || req.connection?.remoteAddress || "unknown";
  const token = String(req.params?.token || "").trim().slice(0, 16);
  return `${ip}:${token}`;
}

function invitationAcceptKeyFromReq(req) {
  const ip = req.ip || req.connection?.remoteAddress || "unknown";
  const token = String(req.body?.token || "").trim().slice(0, 16);
  return `${ip}:${token}`;
}

function invitationIssueKeyFromReq(req) {
  const ip = req.ip || req.connection?.remoteAddress || "unknown";
  const userId = req.user?.id ? String(req.user.id) : "anon";
  const groupId = String(req.body?.groupId || req.params?.id || req.query?.groupId || "").trim() || "none";
  return `${ip}:${userId}:${groupId}`;
}

function twoFactorKeyFromReq(req) {
  const ip = req.ip || req.connection?.remoteAddress || "unknown";
  const challengeId = String(req.body?.challengeId || req.body?.code || "").slice(0, 24);
  return `${ip}:${challengeId}`;
}

function oauthPublicKeyFromReq(req) {
  const ip = req.ip || req.connection?.remoteAddress || "unknown";
  const route = String(req.route?.path || req.path || "").trim();
  const groupId = String(req.query?.groupId || req.body?.groupId || "").trim().slice(0, 16);
  return `${ip}:${route}:${groupId || "none"}`;
}

function oauthExchangeKeyFromReq(req) {
  const ip = req.ip || req.connection?.remoteAddress || "unknown";
  const codePrefix = String(req.body?.code || "").trim().slice(0, 12);
  return `${ip}:${codePrefix || "none"}`;
}

function uploadKeyFromReq(req) {
  const ip = req.ip || req.connection?.remoteAddress || "unknown";
  const userId = req.user?.id ? String(req.user.id) : "anon";
  return `${ip}:${userId}`;
}

function expensiveTenantKeyFromReq(req) {
  const route = String(req.route?.path || req.path || "").trim();
  const groupId = String(
    req.user?.resolved_group_id
    || req.query?.groupId
    || req.body?.groupId
    || "global"
  ).trim();
  return `${groupId}:${route}`;
}

function runBucketRateLimit({ map, key, now, maxAttempts, windowMs, maxBuckets, res, errorCode }) {
  const existing = map.get(key);
  if (!existing || now > existing.expiresAt) {
    if (!existing && map.size >= maxBuckets) {
      return res.status(429).json({ error: "rate_limiter_over_capacity" });
    }
    map.set(key, { count: 1, expiresAt: now + windowMs });
    return null;
  }
  if (existing.count >= maxAttempts) {
    const retryAfterSec = Math.max(1, Math.ceil((existing.expiresAt - now) / 1000));
    res.set("Retry-After", String(retryAfterSec));
    return res.status(429).json({ error: errorCode });
  }
  existing.count += 1;
  map.set(key, existing);
  return null;
}

async function runDistributedRateLimit({ scope, key, now, maxAttempts, windowMs, res, errorCode }) {
  const windowStartMs = Math.floor(now / windowMs) * windowMs;
  const expiresAtMs = windowStartMs + windowMs;
  const expiresIso = new Date(expiresAtMs).toISOString();
  const rows = await query(
    `INSERT INTO rate_limit_counters (scope, bucket_key, window_start_ms, count, expires_at, updated_at)
     VALUES ($1, $2, $3, 1, $4::timestamptz, CURRENT_TIMESTAMP)
     ON CONFLICT (scope, bucket_key, window_start_ms)
     DO UPDATE SET count = rate_limit_counters.count + 1,
                   updated_at = CURRENT_TIMESTAMP
     RETURNING count`,
    [scope, key, windowStartMs, expiresIso]
  );
  const count = Number(rows?.[0]?.count || 0);
  if (count > maxAttempts) {
    const retryAfterSec = Math.max(1, Math.ceil((expiresAtMs - now) / 1000));
    res.set("Retry-After", String(retryAfterSec));
    return res.status(429).json({ error: errorCode });
  }
  return null;
}

function runLocalRateLimit({ map, key, now, maxAttempts, windowMs, maxBuckets, res, errorCode }) {
  pruneExpiredBuckets(now);
  return runBucketRateLimit({ map, key, now, maxAttempts, windowMs, maxBuckets, res, errorCode });
}

function runRateLimitMiddleware(req, res, next, options) {
  const { scope, map, key, now, maxAttempts, windowMs, maxBuckets, errorCode } = options;
  if (!DISTRIBUTED_RATE_LIMIT) {
    const blocked = runLocalRateLimit({ map, key, now, maxAttempts, windowMs, maxBuckets, res, errorCode });
    if (blocked) return blocked;
    return next();
  }
  runDistributedRateLimit({ scope, key, now, maxAttempts, windowMs, res, errorCode })
    .then((blocked) => {
      if (blocked) return;
      next();
    })
    .catch(() => {
      if (!RATE_LIMIT_FAIL_OPEN) {
        return res.status(503).json({ error: "rate_limiter_unavailable" });
      }
      const blocked = runLocalRateLimit({ map, key, now, maxAttempts, windowMs, maxBuckets, res, errorCode });
      if (blocked) return;
      next();
    });
  return undefined;
}

export function loginRateLimit(req, res, next) {
  const key = keyFromReq(req);
  const now = Date.now();
  return runRateLimitMiddleware(req, res, next, {
    scope: "login",
    map: loginBuckets,
    key,
    now,
    maxAttempts: MAX_ATTEMPTS,
    windowMs: WINDOW_MS,
    maxBuckets: MAX_BUCKETS,
    res,
    errorCode: "too_many_attempts",
  });
}

export function aiRateLimit(req, res, next) {
  const key = aiKeyFromReq(req);
  const now = Date.now();
  return runRateLimitMiddleware(req, res, next, {
    scope: "ai",
    map: aiBuckets,
    key,
    now,
    maxAttempts: AI_MAX_ATTEMPTS,
    windowMs: AI_WINDOW_MS,
    maxBuckets: AI_MAX_BUCKETS,
    res,
    errorCode: "too_many_ai_requests",
  });
}

export function invitationLookupRateLimit(req, res, next) {
  const key = invitationLookupKeyFromReq(req);
  const now = Date.now();
  return runRateLimitMiddleware(req, res, next, {
    scope: "invite_lookup",
    map: invitationLookupBuckets,
    key,
    now,
    maxAttempts: INVITE_LOOKUP_MAX_ATTEMPTS,
    windowMs: INVITE_LOOKUP_WINDOW_MS,
    maxBuckets: INVITE_LOOKUP_MAX_BUCKETS,
    res,
    errorCode: "too_many_invitation_lookups",
  });
}

export function invitationAcceptRateLimit(req, res, next) {
  const key = invitationAcceptKeyFromReq(req);
  const now = Date.now();
  return runRateLimitMiddleware(req, res, next, {
    scope: "invite_accept",
    map: invitationAcceptBuckets,
    key,
    now,
    maxAttempts: INVITE_ACCEPT_MAX_ATTEMPTS,
    windowMs: INVITE_ACCEPT_WINDOW_MS,
    maxBuckets: INVITE_ACCEPT_MAX_BUCKETS,
    res,
    errorCode: "too_many_invitation_accepts",
  });
}

export function invitationIssueRateLimit(req, res, next) {
  const key = invitationIssueKeyFromReq(req);
  const now = Date.now();
  return runRateLimitMiddleware(req, res, next, {
    scope: "invite_issue",
    map: invitationIssueBuckets,
    key,
    now,
    maxAttempts: INVITE_ISSUE_MAX_ATTEMPTS,
    windowMs: INVITE_ISSUE_WINDOW_MS,
    maxBuckets: INVITE_ISSUE_MAX_BUCKETS,
    res,
    errorCode: "too_many_invitation_actions",
  });
}

export function twoFactorRateLimit(req, res, next) {
  const key = twoFactorKeyFromReq(req);
  const now = Date.now();
  return runRateLimitMiddleware(req, res, next, {
    scope: "two_factor",
    map: twoFactorBuckets,
    key,
    now,
    maxAttempts: TWO_FACTOR_MAX_ATTEMPTS,
    windowMs: TWO_FACTOR_WINDOW_MS,
    maxBuckets: TWO_FACTOR_MAX_BUCKETS,
    res,
    errorCode: "too_many_two_factor_attempts",
  });
}

export function oauthPublicRateLimit(req, res, next) {
  const key = oauthPublicKeyFromReq(req);
  const now = Date.now();
  return runRateLimitMiddleware(req, res, next, {
    scope: "oauth_public",
    map: oauthPublicBuckets,
    key,
    now,
    maxAttempts: OAUTH_PUBLIC_MAX_ATTEMPTS,
    windowMs: OAUTH_PUBLIC_WINDOW_MS,
    maxBuckets: OAUTH_PUBLIC_MAX_BUCKETS,
    res,
    errorCode: "too_many_oauth_requests",
  });
}

export function oauthExchangeRateLimit(req, res, next) {
  const key = oauthExchangeKeyFromReq(req);
  const now = Date.now();
  return runRateLimitMiddleware(req, res, next, {
    scope: "oauth_exchange",
    map: oauthExchangeBuckets,
    key,
    now,
    maxAttempts: OAUTH_EXCHANGE_MAX_ATTEMPTS,
    windowMs: OAUTH_EXCHANGE_WINDOW_MS,
    maxBuckets: OAUTH_EXCHANGE_MAX_BUCKETS,
    res,
    errorCode: "too_many_oauth_exchanges",
  });
}

export function uploadRateLimit(req, res, next) {
  const key = uploadKeyFromReq(req);
  const now = Date.now();
  return runRateLimitMiddleware(req, res, next, {
    scope: "upload",
    map: uploadBuckets,
    key,
    now,
    maxAttempts: UPLOAD_MAX_ATTEMPTS,
    windowMs: UPLOAD_WINDOW_MS,
    maxBuckets: UPLOAD_MAX_BUCKETS,
    res,
    errorCode: "too_many_upload_attempts",
  });
}

export function expensiveTenantRateLimit(req, res, next) {
  const key = expensiveTenantKeyFromReq(req);
  const now = Date.now();
  return runRateLimitMiddleware(req, res, next, {
    scope: "expensive_tenant",
    map: expensiveTenantBuckets,
    key,
    now,
    maxAttempts: EXPENSIVE_TENANT_MAX_ATTEMPTS,
    windowMs: EXPENSIVE_TENANT_WINDOW_MS,
    maxBuckets: EXPENSIVE_TENANT_MAX_BUCKETS,
    res,
    errorCode: "too_many_expensive_requests",
  });
}

export function __clearLoginRateLimitStateForTests() {
  loginBuckets.clear();
  aiBuckets.clear();
  invitationLookupBuckets.clear();
  invitationAcceptBuckets.clear();
  invitationIssueBuckets.clear();
  twoFactorBuckets.clear();
  oauthPublicBuckets.clear();
  oauthExchangeBuckets.clear();
  uploadBuckets.clear();
  lastPruneAt = 0;
}
