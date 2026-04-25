const loginBuckets = new Map();

const MAX_ATTEMPTS = Number.parseInt(process.env.LOGIN_RATE_LIMIT_MAX || "10", 10);
const WINDOW_MS = Number.parseInt(process.env.LOGIN_RATE_LIMIT_WINDOW_MS || `${15 * 60 * 1000}`, 10);

function keyFromReq(req) {
  const ip = req.ip || req.connection?.remoteAddress || "unknown";
  const email = (req.body?.email || "").toString().trim().toLowerCase();
  return `${ip}:${email}`;
}

export function loginRateLimit(req, res, next) {
  const key = keyFromReq(req);
  const now = Date.now();
  const existing = loginBuckets.get(key);

  if (!existing || now > existing.expiresAt) {
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

export function __clearLoginRateLimitStateForTests() {
  loginBuckets.clear();
}
