import jwt from "jsonwebtoken";
import { randomBytes } from "crypto";

const JWT_SECRET = String(process.env.JWT_SECRET || "").trim() || randomBytes(32).toString("hex");
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "8h";
const JWT_ISSUER = String(process.env.JWT_ISSUER || "").trim();
const JWT_AUDIENCE = String(process.env.JWT_AUDIENCE || "").trim();

if (!process.env.JWT_SECRET) {
    if (process.env.NODE_ENV === "production") {
        console.error("FATAL ERROR: JWT_SECRET is not defined in production environment.");
        process.exit(1);
    }
    console.warn("WARN: JWT_SECRET not set; using ephemeral in-memory secret for non-production.");
}

if ((JWT_ISSUER && !JWT_AUDIENCE) || (!JWT_ISSUER && JWT_AUDIENCE)) {
    console.error("FATAL ERROR: JWT_ISSUER and JWT_AUDIENCE must be configured together.");
    process.exit(1);
}

const AUTH_COOKIE_NAME = "auth_token";

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
    res.setHeader("Set-Cookie", cookie);
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
    res.setHeader("Set-Cookie", cookie);
}

export function auth(req, res, next) {
    const token = tokenFromReq(req);
    if (!token) return res.status(401).json({ error: "Unauthorized" });
    try {
        const verifyOpts = {};
        if (JWT_ISSUER && JWT_AUDIENCE) {
            verifyOpts.issuer = JWT_ISSUER;
            verifyOpts.audience = JWT_AUDIENCE;
        }
        req.user = jwt.verify(token, JWT_SECRET, verifyOpts);
        next();
    } catch {
        return res.status(401).json({ error: "Invalid token" });
    }
}

export function generateToken(user) {
    const signOpts = { expiresIn: JWT_EXPIRES_IN };
    if (JWT_ISSUER && JWT_AUDIENCE) {
        signOpts.issuer = JWT_ISSUER;
        signOpts.audience = JWT_AUDIENCE;
    }
    return jwt.sign(
        { id: user.id, email: user.email, role: user.role },
        JWT_SECRET,
        signOpts
    );
}
