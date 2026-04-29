const loginBuckets = new Map();
const aiBuckets = new Map();
const invitationLookupBuckets = new Map();
const invitationAcceptBuckets = new Map();
const invitationIssueBuckets = new Map();

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
let lastPruneAt = 0;

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

export function loginRateLimit(req, res, next) {
  const key = keyFromReq(req);
  const now = Date.now();
  pruneExpiredBuckets(now);
  const existing = loginBuckets.get(key);

  if (!existing || now > existing.expiresAt) {
    if (!existing && loginBuckets.size >= MAX_BUCKETS) {
      return res.status(429).json({ error: "rate_limiter_over_capacity" });
    }
    loginBuckets.set(key, { count: 1, expiresAt: now + WINDOW_MS });
    return next();
  }

  if (existing.count >= MAX_ATTEMPTS) {
    const retryAfterSec = Math.max(1, Math.ceil((existing.expiresAt - now) / 1000));
    res.set("Retry-After", String(retryAfterSec));
    return res.status(429).json({ error: "too_many_attempts" });
  }

  existing.count += 1;
  loginBuckets.set(key, existing);
  return next();
}

export function aiRateLimit(req, res, next) {
  const key = aiKeyFromReq(req);
  const now = Date.now();
  pruneExpiredBuckets(now);
  const existing = aiBuckets.get(key);

  if (!existing || now > existing.expiresAt) {
    if (!existing && aiBuckets.size >= AI_MAX_BUCKETS) {
      return res.status(429).json({ error: "rate_limiter_over_capacity" });
    }
    aiBuckets.set(key, { count: 1, expiresAt: now + AI_WINDOW_MS });
    return next();
  }

  if (existing.count >= AI_MAX_ATTEMPTS) {
    const retryAfterSec = Math.max(1, Math.ceil((existing.expiresAt - now) / 1000));
    res.set("Retry-After", String(retryAfterSec));
    return res.status(429).json({ error: "too_many_ai_requests" });
  }

  existing.count += 1;
  aiBuckets.set(key, existing);
  return next();
}

export function invitationLookupRateLimit(req, res, next) {
  const key = invitationLookupKeyFromReq(req);
  const now = Date.now();
  pruneExpiredBuckets(now);
  const blocked = runBucketRateLimit({
    map: invitationLookupBuckets,
    key,
    now,
    maxAttempts: INVITE_LOOKUP_MAX_ATTEMPTS,
    windowMs: INVITE_LOOKUP_WINDOW_MS,
    maxBuckets: INVITE_LOOKUP_MAX_BUCKETS,
    res,
    errorCode: "too_many_invitation_lookups",
  });
  if (blocked) return blocked;
  return next();
}

export function invitationAcceptRateLimit(req, res, next) {
  const key = invitationAcceptKeyFromReq(req);
  const now = Date.now();
  pruneExpiredBuckets(now);
  const blocked = runBucketRateLimit({
    map: invitationAcceptBuckets,
    key,
    now,
    maxAttempts: INVITE_ACCEPT_MAX_ATTEMPTS,
    windowMs: INVITE_ACCEPT_WINDOW_MS,
    maxBuckets: INVITE_ACCEPT_MAX_BUCKETS,
    res,
    errorCode: "too_many_invitation_accepts",
  });
  if (blocked) return blocked;
  return next();
}

export function invitationIssueRateLimit(req, res, next) {
  const key = invitationIssueKeyFromReq(req);
  const now = Date.now();
  pruneExpiredBuckets(now);
  const blocked = runBucketRateLimit({
    map: invitationIssueBuckets,
    key,
    now,
    maxAttempts: INVITE_ISSUE_MAX_ATTEMPTS,
    windowMs: INVITE_ISSUE_WINDOW_MS,
    maxBuckets: INVITE_ISSUE_MAX_BUCKETS,
    res,
    errorCode: "too_many_invitation_actions",
  });
  if (blocked) return blocked;
  return next();
}

export function __clearLoginRateLimitStateForTests() {
  loginBuckets.clear();
  aiBuckets.clear();
  invitationLookupBuckets.clear();
  invitationAcceptBuckets.clear();
  invitationIssueBuckets.clear();
  lastPruneAt = 0;
}
