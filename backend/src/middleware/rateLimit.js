const loginBuckets = new Map();
const aiBuckets = new Map();

const MAX_ATTEMPTS = Number.parseInt(process.env.LOGIN_RATE_LIMIT_MAX || "10", 10);
const WINDOW_MS = Number.parseInt(process.env.LOGIN_RATE_LIMIT_WINDOW_MS || `${15 * 60 * 1000}`, 10);
const PRUNE_INTERVAL_MS = Number.parseInt(process.env.LOGIN_RATE_LIMIT_PRUNE_INTERVAL_MS || "60000", 10);
const MAX_BUCKETS = Number.parseInt(process.env.LOGIN_RATE_LIMIT_MAX_BUCKETS || "50000", 10);
const AI_MAX_ATTEMPTS = Number.parseInt(process.env.AI_RATE_LIMIT_MAX || "60", 10);
const AI_WINDOW_MS = Number.parseInt(process.env.AI_RATE_LIMIT_WINDOW_MS || `${60 * 1000}`, 10);
const AI_MAX_BUCKETS = Number.parseInt(process.env.AI_RATE_LIMIT_MAX_BUCKETS || "50000", 10);
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

export function __clearLoginRateLimitStateForTests() {
  loginBuckets.clear();
  aiBuckets.clear();
  lastPruneAt = 0;
}
