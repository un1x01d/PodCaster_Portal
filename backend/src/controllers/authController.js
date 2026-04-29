import { query, getClient } from "../config/db.js";
import { hashPassword, verifyPassword } from "../utils/security.js";
import { clearAuthCookie, generateToken, setAuthCookie } from "../middleware/auth.js";
import { writeAuditLog } from "../utils/auditLog.js";
import { createHash } from "crypto";

function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
}

function hashInviteToken(token) {
    return createHash("sha256").update(String(token || "")).digest("hex");
}

function validateStrongPassword(password) {
    const next = String(password || "");
    const minLen = 16;
    const hasUpper = /[A-Z]/.test(next);
    const hasLower = /[a-z]/.test(next);
    const hasNum = /[0-9]/.test(next);
    const hasSpecial = /[!@#$%^&*()-_+=[\],.<>?]/.test(next);
    return next.length >= minLen && hasUpper && hasLower && hasNum && hasSpecial;
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
        if (!rows.length) {
            await writeAuditLog({
                req,
                action: "auth.login_failed",
                resourceType: "user",
                resourceId: normalizedEmail,
                metadata: { reason: "unknown_email" },
            });
            return res.status(401).json({ error: "Invalid credentials" });
        }

        const user = rows[0];
        const { valid, rehash } = await verifyPassword(password, user.password);

        if (!valid) {
            await writeAuditLog({
                req,
                actorUserId: user.id,
                action: "auth.login_failed",
                resourceType: "user",
                resourceId: user.id,
                metadata: { reason: "invalid_password" },
            });
            return res.status(401).json({ error: "Invalid credentials" });
        }

        if (rehash) {
            // Lazy migration: Update to hashed password
            console.log(`[Auth] Migrating password for user ${user.id} to bcrypt hash.`);
            const newHash = await hashPassword(password);
            await query("UPDATE users SET password = $1 WHERE id = $2", [newHash, user.id]);
        }

        const token = generateToken(user);
        setAuthCookie(req, res, token);
        const groupFlags = await resolveGroupAdminFlags(user.id);
        await writeAuditLog({
            req,
            actorUserId: user.id,
            action: "auth.login_success",
            resourceType: "user",
            resourceId: user.id,
        });
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

    if (!validateStrongPassword(newPassword)) {
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
    await writeAuditLog({
        req,
        action: "auth.password_changed",
        resourceType: "user",
        resourceId: req.user.id,
    });
    res.json({ success: true });
}

export async function getInvitationInfo(req, res) {
    const token = String(req.params?.token || "").trim();
    if (!token) return res.status(400).json({ error: "invitation_token_required" });
    const tokenHash = hashInviteToken(token);
    const rows = await query(
        `SELECT cui.id, cui.email, cui.group_id, cui.first_name, cui.last_name, cui.company, cui.expires_at, g.name AS group_name
           FROM customer_user_invitations cui
           JOIN groups g ON g.id = cui.group_id
          WHERE cui.token_hash = $1
            AND cui.accepted_at IS NULL
            AND cui.revoked_at IS NULL
            AND cui.expires_at > CURRENT_TIMESTAMP
          LIMIT 1`,
        [tokenHash]
    );
    if (!rows.length) return res.status(404).json({ error: "invitation_invalid_or_expired" });
    const invite = rows[0];
    return res.json({
        email: invite.email,
        firstName: invite.first_name,
        lastName: invite.last_name,
        company: invite.company,
        groupId: invite.group_id,
        groupName: invite.group_name,
        expiresAt: invite.expires_at,
    });
}

export async function acceptInvitation(req, res) {
    const token = String(req.body?.token || "").trim();
    const password = String(req.body?.password || "");
    if (!token) return res.status(400).json({ error: "invitation_token_required" });
    if (!validateStrongPassword(password)) {
        return res.status(400).json({
            error: "Password must be 16+ chars, with Upper, Lower, Number, and Special char.",
        });
    }

    const tokenHash = hashInviteToken(token);
    const client = await getClient();
    try {
        await client.query("BEGIN");
        const inviteRes = await client.query(
            `SELECT id, email, group_id, first_name, last_name, company
               FROM customer_user_invitations
              WHERE token_hash = $1
                AND accepted_at IS NULL
                AND revoked_at IS NULL
                AND expires_at > CURRENT_TIMESTAMP
              LIMIT 1
              FOR UPDATE`,
            [tokenHash]
        );
        if (!inviteRes.rows.length) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "invitation_invalid_or_expired" });
        }
        const invite = inviteRes.rows[0];

        const existingRes = await client.query(
            "SELECT id, email, role FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1 FOR UPDATE",
            [invite.email]
        );
        let userId = null;
        if (existingRes.rows.length) {
            const existing = existingRes.rows[0];
            if (existing.role === "admin") {
                await client.query("ROLLBACK");
                return res.status(403).json({ error: "admin_email_not_allowed" });
            }
            userId = existing.id;
            const hashed = await hashPassword(password);
            await client.query(
                `UPDATE users
                    SET password = $1,
                        role = 'user',
                        first_name = COALESCE(NULLIF(TRIM(first_name), ''), $2),
                        last_name = COALESCE(NULLIF(TRIM(last_name), ''), $3),
                        company = COALESCE(NULLIF(TRIM(company), ''), $4),
                        password_reset_required = FALSE
                  WHERE id = $5`,
                [hashed, invite.first_name, invite.last_name, invite.company, userId]
            );
        } else {
            const hashed = await hashPassword(password);
            const created = await client.query(
                `INSERT INTO users (email, password, role, first_name, last_name, company, password_reset_required)
                 VALUES ($1, $2, 'user', $3, $4, $5, FALSE)
                 RETURNING id`,
                [invite.email, hashed, invite.first_name, invite.last_name, invite.company]
            );
            userId = created.rows[0].id;
        }

        await client.query(
            "INSERT INTO user_groups (group_id, user_id, is_admin) VALUES ($1, $2, FALSE) ON CONFLICT (user_id, group_id) DO NOTHING",
            [invite.group_id, userId]
        );
        await client.query(
            "UPDATE customer_user_invitations SET accepted_at = CURRENT_TIMESTAMP, accepted_user_id = $2 WHERE id = $1",
            [invite.id, userId]
        );
        await client.query("COMMIT");

        const users = await query(
            "SELECT id, email, role, password_reset_required FROM users WHERE id = $1 LIMIT 1",
            [userId]
        );
        const appUser = users[0];
        const tokenValue = generateToken(appUser);
        setAuthCookie(req, res, tokenValue);
        await writeAuditLog({
            req,
            actorUserId: appUser.id,
            action: "auth.invitation_accepted",
            resourceType: "user",
            resourceId: appUser.id,
            metadata: { group_id: invite.group_id },
        });
        const groupFlags = await resolveGroupAdminFlags(appUser.id);
        return res.json({
            token: tokenValue,
            user: {
                id: appUser.id,
                email: appUser.email,
                role: appUser.role,
                password_reset_required: appUser.password_reset_required,
                ...groupFlags,
            },
        });
    } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        return res.status(500).json({ error: "invitation_accept_failed" });
    } finally {
        client.release();
    }
}

export async function logout(req, res) {
    if (req.user?.id) {
        await writeAuditLog({
            req,
            action: "auth.logout",
            resourceType: "user",
            resourceId: req.user.id,
        });
    }
    clearAuthCookie(req, res);
    res.json({ success: true });
}
