import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "8h";

if (!JWT_SECRET) {
    console.error("FATAL ERROR: JWT_SECRET is not defined.");
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
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch {
        return res.status(401).json({ error: "Invalid token" });
    }
}

export function generateToken(user) {
    return jwt.sign(
        { id: user.id, email: user.email, role: user.role },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
    );
}
