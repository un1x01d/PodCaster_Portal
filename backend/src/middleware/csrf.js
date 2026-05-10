import { randomBytes } from "crypto";

const CSRF_HEADER = String(process.env.CSRF_HEADER_NAME || "x-csrf-token").toLowerCase();
const CSRF_COOKIE = String(process.env.CSRF_COOKIE_NAME || "csrf_token");
const CSRF_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const CSRF_EXEMPT_PATHS = new Set([
  "/auth/login",
  "/auth/google/exchange",
  "/auth/saml/acs",
  "/auth/saml/exchange",
  "/email-ingest/inbound",
]);

function normalizePathname(pathname) {
  const raw = String(pathname || "").trim();
  if (!raw) return "/";
  const normalized = raw.replace(/\/+$/, "");
  return normalized || "/";
}

function parseCookieValue(cookieHeader, name) {
  const source = String(cookieHeader || "");
  const parts = source.split(";").map((v) => v.trim());
  const prefix = `${name}=`;
  const hit = parts.find((p) => p.startsWith(prefix));
  if (!hit) return "";
  return decodeURIComponent(hit.slice(prefix.length));
}

export function ensureCsrfCookie(req, res, next) {
  const existing = parseCookieValue(req.headers.cookie, CSRF_COOKIE);
  if (existing) return next();

  const secure = req.secure || String(req.headers["x-forwarded-proto"] || "").toLowerCase() === "https";
  const token = randomBytes(24).toString("hex");
  const cookie = [
    `${CSRF_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "SameSite=Lax",
    secure ? "Secure" : null,
  ].filter(Boolean).join("; ");

  res.append("Set-Cookie", cookie);
  return next();
}

export function csrfProtect(req, res, next) {
  if (!CSRF_METHODS.has(String(req.method || "").toUpperCase())) return next();
  if (CSRF_EXEMPT_PATHS.has(normalizePathname(req.path))) return next();

  const cookieToken = parseCookieValue(req.headers.cookie, CSRF_COOKIE);
  const headerToken = String(req.headers[CSRF_HEADER] || "").trim();
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({ error: "csrf_validation_failed" });
  }
  return next();
}
