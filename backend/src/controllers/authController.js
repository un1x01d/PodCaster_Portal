import { query } from "../config/db.js";
import { hashPassword, verifyPassword } from "../utils/security.js";
import { clearAuthCookie, generateToken, setAuthCookie } from "../middleware/auth.js";

function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
}

async function resolveGroupAdminFlags(userId) {
    const rows = await query(
        "SELECT COUNT(*)::int AS c FROM user_groups WHERE user_id = $1 AND is_admin = TRUE",
        [userId]
    );
    const isGroupAdmin = Number(rows?.[0]?.c || 0) > 0;
    return {
        is_group_admin: isGroupAdmin,
        group_admin: isGroupAdmin,
    };
}

export async function login(req, res) {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "Missing credentials" });
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) return res.status(400).json({ error: "Missing credentials" });

    try {
        const rows = await query(
            `SELECT id, email, password, role, password_reset_required
             FROM users
             WHERE LOWER(email)=LOWER($1)`,
            [normalizedEmail]
        );
        if (!rows.length) return res.status(401).json({ error: "Invalid credentials" });

        const user = rows[0];
        const { valid, rehash } = await verifyPassword(password, user.password);

        if (!valid) return res.status(401).json({ error: "Invalid credentials" });

        if (rehash) {
            // Lazy migration: Update to hashed password
            console.log(`[Auth] Migrating password for user ${user.id} to bcrypt hash.`);
            const newHash = await hashPassword(password);
            await query("UPDATE users SET password = $1 WHERE id = $2", [newHash, user.id]);
        }

        const token = generateToken(user);
        setAuthCookie(req, res, token);
        const groupFlags = await resolveGroupAdminFlags(user.id);
        res.json({
            token,
            user: {
                id: user.id,
                email: user.email,
                role: user.role,
                password_reset_required: user.password_reset_required,
                ...groupFlags,
            }
        });
    } catch (err) {
        console.error("[Auth] login error:", err);
        res.status(500).json({ error: "internal_server_error" });
    }
}

export async function getMe(req, res) {
    try {
        const rows = await query(
            "SELECT id, email, role, default_view_id, password_reset_required FROM users WHERE id = $1",
            [req.user.id]
        );
        if (!rows.length) return res.status(404).json({ error: "user_not_found" });
        const groupFlags = await resolveGroupAdminFlags(rows[0].id);
        res.json({ ...rows[0], ...groupFlags });
    } catch (err) {
        console.error("[Auth] getMe error:", err);
        res.status(500).json({ error: "internal_server_error" });
    }
}

export async function changePassword(req, res) {
    const { currentPassword, newPassword } = req.body;

    // Strict Password Policy
    const minLen = 16;
    const hasUpper = /[A-Z]/.test(newPassword);
    const hasLower = /[a-z]/.test(newPassword);
    const hasNum = /[0-9]/.test(newPassword);
    const hasSpecial = /[!@#$%^&*()-_+=[\],.<>?]/.test(newPassword); // basic set

    if (!newPassword || newPassword.length < minLen || !hasUpper || !hasLower || !hasNum || !hasSpecial) {
        return res.status(400).json({
            error: "Password must be 16+ chars, with Upper, Lower, Number, and Special char."
        });
    }

    const rows = await query("SELECT id, password FROM users WHERE id=$1", [req.user.id]);
    if (!rows.length) return res.status(404).json({ error: "User not found" });
    const user = rows[0];

    const { valid } = await verifyPassword(currentPassword, user.password);
    if (!valid) return res.status(401).json({ error: "Invalid current password" });

    const hashed = await hashPassword(newPassword);
    await query("UPDATE users SET password=$1, password_reset_required=FALSE WHERE id=$2", [hashed, req.user.id]);
    res.json({ success: true });
}

export async function logout(req, res) {
    clearAuthCookie(req, res);
    res.json({ success: true });
}
