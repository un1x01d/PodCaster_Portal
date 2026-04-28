const CSRF_HEADER = String(process.env.CSRF_HEADER_NAME || "x-csrf-token").toLowerCase();
const CSRF_COOKIE = String(process.env.CSRF_COOKIE_NAME || "csrf_token");
const CSRF_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const CSRF_BYPASS_BEARER = String(process.env.CSRF_BYPASS_BEARER || "true").toLowerCase() === "true";
const CSRF_STRICT_MODE = String(process.env.CSRF_STRICT_MODE || "false").toLowerCase() === "true";
const CSRF_EXEMPT_PATHS = new Set([
  "/auth/login",
  "/auth/logout",
  "/auth/google/exchange",
]);

function parseCookieValue(cookieHeader, name) {
  const source = String(cookieHeader || "");
  const parts = source.split(";").map((v) => v.trim());
  const prefix = `${name}=`;
  const hit = parts.find((p) => p.startsWith(prefix));
  if (!hit) return "";
  return decodeURIComponent(hit.slice(prefix.length));
}

function hasBearerAuth(req) {
  const header = String(req.headers.authorization || "").trim().toLowerCase();
  return header.startsWith("bearer ");
}

export function csrfProtect(req, res, next) {
  if (!CSRF_METHODS.has(String(req.method || "").toUpperCase())) return next();
  if (CSRF_EXEMPT_PATHS.has(String(req.path || "").trim())) return next();
  if (!CSRF_STRICT_MODE && CSRF_BYPASS_BEARER && hasBearerAuth(req)) return next();

  const cookieToken = parseCookieValue(req.headers.cookie, CSRF_COOKIE);
  const headerToken = String(req.headers[CSRF_HEADER] || "").trim();
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({ error: "csrf_validation_failed" });
  }
  return next();
}
