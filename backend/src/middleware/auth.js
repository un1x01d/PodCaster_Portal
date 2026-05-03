import jwt from "jsonwebtoken";
import { randomBytes } from "crypto";
import { getTenantPool, isTenantDbIsolationEnabled, query, runWithDbPool } from "../config/db.js";
import { isPlatformAdminUser } from "../utils/authorization.js";

const JWT_SECRET_CONFIGURED = String(process.env.JWT_SECRET || "").trim();
const ALLOW_EPHEMERAL_JWT_SECRET = ["1", "true", "yes", "on"].includes(
    String(process.env.ALLOW_EPHEMERAL_JWT_SECRET || "").trim().toLowerCase()
);
const AUTH_DB_REFRESH_FAIL_OPEN = ["1", "true", "yes", "on"].includes(
    String(process.env.AUTH_DB_REFRESH_FAIL_OPEN || "").trim().toLowerCase()
);
const JWT_SECRET = JWT_SECRET_CONFIGURED || randomBytes(32).toString("hex");
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "8h";
const JWT_ISSUER = String(process.env.JWT_ISSUER || "").trim();
const JWT_AUDIENCE = String(process.env.JWT_AUDIENCE || "").trim();
const JWT_ALGORITHM = "HS256";

if (!JWT_SECRET_CONFIGURED) {
    if (!ALLOW_EPHEMERAL_JWT_SECRET) {
        console.error("FATAL ERROR: JWT_SECRET is not defined. Set JWT_SECRET or ALLOW_EPHEMERAL_JWT_SECRET=true for temporary non-production use.");
        process.exit(1);
    }
    console.warn("WARN: using ephemeral in-memory JWT secret because ALLOW_EPHEMERAL_JWT_SECRET=true.");
}

if ((JWT_ISSUER && !JWT_AUDIENCE) || (!JWT_ISSUER && JWT_AUDIENCE)) {
    console.error("FATAL ERROR: JWT_ISSUER and JWT_AUDIENCE must be configured together.");
    process.exit(1);
}

const AUTH_COOKIE_NAME = "auth_token";

function appendSetCookie(res, cookie) {
    const existing = res.getHeader("Set-Cookie");
    if (!existing) {
        res.setHeader("Set-Cookie", cookie);
        return;
    }
    const values = Array.isArray(existing) ? existing.concat(cookie) : [existing, cookie];
    res.setHeader("Set-Cookie", values);
}

function parseCookieValue(cookieHeader, name) {
    const source = String(cookieHeader || "");
    const parts = source.split(";").map((v) => v.trim());
    const prefix = `${name}=`;
    const hit = parts.find((p) => p.startsWith(prefix));
    if (!hit) return "";
    return decodeURIComponent(hit.slice(prefix.length));
}

function tokenFromReq(req) {
    const fromCookie = parseCookieValue(req.headers.cookie, AUTH_COOKIE_NAME);
    if (fromCookie) return fromCookie;
    const header = String(req.headers.authorization || "").trim();
    if (header.toLowerCase().startsWith("bearer ")) {
        const maybe = header.slice(7).trim();
        if (maybe) return maybe;
    }
    return "";
}

function isControlPlaneRoute(req) {
    const routeBase = String(req.baseUrl || "").trim();
    const path = String(req.path || "").trim();
    if (routeBase === "/auth") return true;
    // Invitations are accepted before a tenant session exists, so they must live in the control DB.
    if (path === "/users/invitations" || path.startsWith("/users/invitations/")) return true;
    return false;
}

export function setAuthCookie(req, res, token) {
    const secure = req.secure || String(req.headers["x-forwarded-proto"] || "").toLowerCase() === "https";
    const maxAge = Number.parseInt(process.env.JWT_COOKIE_MAX_AGE_MS || `${8 * 60 * 60 * 1000}`, 10);
    const cookie = [
        `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}`,
        "Path=/",
        "HttpOnly",
        "SameSite=Lax",
        secure ? "Secure" : null,
        `Max-Age=${Math.max(1, Math.floor(maxAge / 1000))}`,
    ].filter(Boolean).join("; ");
    appendSetCookie(res, cookie);
}

export function clearAuthCookie(req, res) {
    const secure = req.secure || String(req.headers["x-forwarded-proto"] || "").toLowerCase() === "https";
    const cookie = [
        `${AUTH_COOKIE_NAME}=`,
        "Path=/",
        "HttpOnly",
        "SameSite=Lax",
        secure ? "Secure" : null,
        "Max-Age=0",
    ].filter(Boolean).join("; ");
    appendSetCookie(res, cookie);
}

export async function auth(req, res, next) {
    const token = tokenFromReq(req);
    if (!token) return res.status(401).json({ error: "Unauthorized" });
    try {
        const verifyOpts = { algorithms: [JWT_ALGORITHM] };
        if (JWT_ISSUER && JWT_AUDIENCE) {
            verifyOpts.issuer = JWT_ISSUER;
            verifyOpts.audience = JWT_AUDIENCE;
        }
        req.user = jwt.verify(token, JWT_SECRET, verifyOpts);
        // Refresh privilege claims from DB so stale tokens do not keep old role/admin flags.
        const userId = Number.parseInt(String(req.user?.id || ""), 10);
        if (Number.isInteger(userId) && userId > 0) {
            try {
                const rows = await query(
                    `SELECT u.role,
                            EXISTS (
                              SELECT 1 FROM user_groups ug
                              WHERE ug.user_id = u.id AND ug.is_admin = TRUE
                            ) AS is_group_admin
                       FROM users u
                      WHERE u.id = $1
                      LIMIT 1`,
                    [userId]
                );
                const row = rows?.[0];
                if (!row) {
                    return res.status(401).json({ error: "Invalid token" });
                }
                const role = String(row.role || req.user.role || "").trim().toLowerCase();
                req.user.role = role || req.user.role;
                const isGroupAdmin = String(row.is_group_admin || "").toLowerCase() === "true" || row.is_group_admin === true;
                req.user.is_group_admin = isGroupAdmin;
                req.user.group_admin = isGroupAdmin;
                req.user.is_admin = isPlatformAdminUser(req.user);
            } catch (err) {
                if (!AUTH_DB_REFRESH_FAIL_OPEN) {
                    console.error("[auth] failed to refresh auth claims from DB:", err?.message || err);
                    return res.status(503).json({ error: "auth_claim_refresh_failed" });
                }
            }
        }
        const tenantDbName = String(req.user.tenant_database || "").trim();
        const shouldUseTenantDb = isTenantDbIsolationEnabled()
            && !isPlatformAdminUser(req.user)
            && !isControlPlaneRoute(req)
            && tenantDbName;
        if (!shouldUseTenantDb) return next();
        getTenantPool(tenantDbName)
            .then((tenantPool) => runWithDbPool(tenantPool, () => next()))
            .catch((err) => {
                console.error("[tenant-db] failed to resolve tenant pool:", err?.message || err);
                res.status(503).json({ error: "tenant_database_unavailable" });
            });
    } catch {
        return res.status(401).json({ error: "Invalid token" });
    }
}

export function generateToken(user) {
    const signOpts = { expiresIn: JWT_EXPIRES_IN, algorithm: JWT_ALGORITHM };
    if (JWT_ISSUER && JWT_AUDIENCE) {
        signOpts.issuer = JWT_ISSUER;
        signOpts.audience = JWT_AUDIENCE;
    }
    const payload = { id: user.id, email: user.email, role: user.role };
    if (user.customer_id) payload.customer_id = user.customer_id;
    if (user.customer_group_id) payload.customer_group_id = user.customer_group_id;
    if (user.tenant_database) payload.tenant_database = user.tenant_database;
    return jwt.sign(payload, JWT_SECRET, signOpts);
}
