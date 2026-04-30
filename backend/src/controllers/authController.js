import { query, getClient, isTenantDbIsolationEnabled, syncCustomerPrincipalToTenant } from "../config/db.js";
import { hashPassword, verifyPassword } from "../utils/security.js";
import { clearAuthCookie, generateToken, setAuthCookie } from "../middleware/auth.js";
import { writeAuditLog } from "../utils/auditLog.js";
import { createHash, randomUUID, timingSafeEqual } from "crypto";
import { decryptSettingValue, encryptSettingValue } from "../utils/settingsCrypto.js";
import {
    buildOtpAuthUrl,
    generateTotpSecret,
    verifyTotpCode,
    normalizePhoneE164,
    maskPhone,
    generateNumericCode,
    hashCodeForChallenge,
    normalize2faDigits,
    normalize2faPeriod,
} from "../utils/twoFactor.js";
import {
    loadSmsOtpConfig,
    sendSmsOtpMessage,
} from "../utils/smsOtp.js";

const TWO_FACTOR_CHALLENGE_TTL_SEC = Number.parseInt(process.env.TWO_FACTOR_CHALLENGE_TTL_SEC || "300", 10);
const TWO_FACTOR_MAX_ATTEMPTS = Number.parseInt(process.env.TWO_FACTOR_MAX_ATTEMPTS || "5", 10);
const TWO_FACTOR_PENDING_TOTP_TTL_SEC = Number.parseInt(process.env.TWO_FACTOR_PENDING_TOTP_TTL_SEC || "600", 10);
const TWO_FACTOR_SMS_CODE_DIGITS = Number.parseInt(process.env.TWO_FACTOR_SMS_CODE_DIGITS || "6", 10);

const DEFAULT_TOTP_SETTINGS = {
    issuer: String(process.env.TWO_FACTOR_TOTP_ISSUER || "Data Insights Portal").trim() || "Data Insights Portal",
    digits: normalize2faDigits(process.env.TWO_FACTOR_TOTP_DIGITS || 6, 6),
    period: normalize2faPeriod(process.env.TWO_FACTOR_TOTP_PERIOD || 30, 30),
};

function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
}

function hashInviteToken(token) {
    return createHash("sha256").update(String(token || "")).digest("hex");
}

function challengeExpiresAtDate() {
    const ttl = Math.max(60, TWO_FACTOR_CHALLENGE_TTL_SEC);
    return new Date(Date.now() + ttl * 1000);
}

function safeCompareCodeHash(actual, expected) {
    const a = Buffer.from(String(actual || ""));
    const b = Buffer.from(String(expected || ""));
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
}

async function loadTotpSettings() {
    const rows = await query("SELECT value FROM app_settings WHERE key = 'two_factor_totp_settings' LIMIT 1", []);
    const raw = rows?.[0]?.value && typeof rows[0].value === "object" ? rows[0].value : {};
    return {
        issuer: String(raw.issuer || DEFAULT_TOTP_SETTINGS.issuer).trim() || DEFAULT_TOTP_SETTINGS.issuer,
        digits: normalize2faDigits(raw.digits ?? DEFAULT_TOTP_SETTINGS.digits, DEFAULT_TOTP_SETTINGS.digits),
        period: normalize2faPeriod(raw.period ?? DEFAULT_TOTP_SETTINGS.period, DEFAULT_TOTP_SETTINGS.period),
    };
}

function sanitize2faUser(userRow) {
    const method = String(userRow?.two_factor_method || "").trim().toLowerCase();
    return {
        twoFactorEnabled: !!userRow?.two_factor_enabled && (method === "totp" || method === "sms"),
        twoFactorMethod: method === "totp" || method === "sms" ? method : null,
        twoFactorPhoneMasked: method === "sms" ? maskPhone(userRow?.two_factor_phone) : "",
    };
}

async function issueSmsCodeForChallenge(challengeId, phone) {
    const code = generateNumericCode(TWO_FACTOR_SMS_CODE_DIGITS);
    await sendSmsOtpMessage({
        to: phone,
        body: `Your verification code is ${code}. It expires in ${Math.max(1, Math.floor(TWO_FACTOR_CHALLENGE_TTL_SEC / 60))} minute(s).`,
    });
    return hashCodeForChallenge(challengeId, code);
}

async function createLoginTwoFactorChallenge(req, userRow) {
    const method = String(userRow?.two_factor_method || "").trim().toLowerCase();
    if (method !== "totp" && method !== "sms") return null;
    if (method === "sms") {
        const phone = normalizePhoneE164(userRow?.two_factor_phone);
        if (!phone) {
            const err = new Error("two_factor_sms_phone_missing");
            err.statusCode = 503;
            throw err;
        }
    }

    const challengeId = randomUUID();
    const expiresAt = challengeExpiresAtDate();
    let codeHash = null;
    let masked = "";
    if (method === "sms") {
        const phone = normalizePhoneE164(userRow?.two_factor_phone);
        codeHash = await issueSmsCodeForChallenge(challengeId, phone);
        masked = maskPhone(phone);
    }
    await query(
        `INSERT INTO auth_2fa_challenges
            (id, user_id, method, context, code_hash, phone, expires_at)
         VALUES ($1, $2, $3, 'login', $4, $5, $6)`,
        [challengeId, userRow.id, method, codeHash, method === "sms" ? normalizePhoneE164(userRow?.two_factor_phone) : null, expiresAt.toISOString()]
    );
    await writeAuditLog({
        req,
        actorUserId: userRow.id,
        action: "auth.login_2fa_challenge_issued",
        resourceType: "user",
        resourceId: userRow.id,
        metadata: { method },
    });
    return {
        challengeId,
        method,
        maskedPhone: masked,
        expiresAt: expiresAt.toISOString(),
    };
}

async function finalizeAuthenticatedLogin(req, res, userRow) {
    const tenantContext = await resolveTenantContextForUser(userRow);
    const tokenUser = { ...userRow, ...tenantContext };
    const token = generateToken(tokenUser);
    setAuthCookie(req, res, token);
    const groupFlags = await resolveGroupAdminFlags(userRow.id);
    await writeAuditLog({
        req,
        actorUserId: userRow.id,
        action: "auth.login_success",
        resourceType: "user",
        resourceId: userRow.id,
    });
    return res.json({
        token,
        user: {
            id: userRow.id,
            email: userRow.email,
            role: userRow.role,
            password_reset_required: userRow.password_reset_required,
            ...tenantContext,
            ...groupFlags,
        }
    });
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

async function resolveTenantContextForUser(userRow) {
    if (!isTenantDbIsolationEnabled()) return {};
    if (String(userRow?.role || "").toLowerCase() === "admin") return {};
    const rows = await query(
        `SELECT c.id AS customer_id, c.group_id AS customer_group_id, c.db_name AS tenant_database
           FROM user_groups ug
           JOIN customers c ON c.group_id = ug.group_id
          WHERE ug.user_id = $1
            AND c.status = 'active'
          ORDER BY c.id ASC`,
        [userRow.id]
    );
    if (rows.length !== 1) return {};
    return {
        customer_id: rows[0].customer_id,
        customer_group_id: rows[0].customer_group_id,
        tenant_database: rows[0].tenant_database,
    };
}

export async function login(req, res) {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "Missing credentials" });
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) return res.status(400).json({ error: "Missing credentials" });

    try {
        const rows = await query(
            `SELECT id, email, password, role, password_reset_required,
                    two_factor_enabled, two_factor_method, two_factor_phone
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

        const twoFactor = sanitize2faUser(user);
        if (twoFactor.twoFactorEnabled) {
            try {
                const challenge = await createLoginTwoFactorChallenge(req, user);
                return res.json({
                    requiresTwoFactor: true,
                    challengeId: challenge.challengeId,
                    method: challenge.method,
                    maskedPhone: challenge.maskedPhone || "",
                    expiresAt: challenge.expiresAt,
                });
            } catch (twoFactorErr) {
                return res.status(twoFactorErr?.statusCode || 503).json({ error: twoFactorErr?.message || "two_factor_unavailable" });
            }
        }

        return finalizeAuthenticatedLogin(req, res, user);
    } catch (err) {
        console.error("[Auth] login error:", err);
        res.status(500).json({ error: "internal_server_error" });
    }
}

export async function getMe(req, res) {
    try {
        const rows = await query(
            `SELECT id, email, role, default_view_id, password_reset_required,
                    two_factor_enabled, two_factor_method, two_factor_phone
               FROM users WHERE id = $1`,
            [req.user.id]
        );
        if (!rows.length) return res.status(404).json({ error: "user_not_found" });
        const groupFlags = await resolveGroupAdminFlags(rows[0].id);
        const twoFactor = sanitize2faUser(rows[0]);
        res.json({ ...rows[0], ...groupFlags, ...twoFactor });
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
        if (isTenantDbIsolationEnabled()) {
            await syncCustomerPrincipalToTenant({ groupId: invite.group_id, userId }).catch((err) => {
                console.error("[tenant-db] sync invited principal failed:", err?.message || err);
            });
        }

        const users = await query(
            "SELECT id, email, role, password_reset_required FROM users WHERE id = $1 LIMIT 1",
            [userId]
        );
        const appUser = users[0];
        await writeAuditLog({
            req,
            actorUserId: appUser.id,
            action: "auth.invitation_accepted",
            resourceType: "user",
            resourceId: appUser.id,
            metadata: { group_id: invite.group_id },
        });
        return finalizeAuthenticatedLogin(req, res, appUser);
    } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        return res.status(500).json({ error: "invitation_accept_failed" });
    } finally {
        client.release();
    }
}

export async function verifyTwoFactorLogin(req, res) {
    const challengeId = String(req.body?.challengeId || "").trim();
    const code = String(req.body?.code || "").trim();
    if (!challengeId || !code) return res.status(400).json({ error: "challenge_id_and_code_required" });
    const client = await getClient();
    try {
        await client.query("BEGIN");
        const rows = await client.query(
            `SELECT c.id, c.user_id, c.method, c.code_hash, c.phone, c.expires_at, c.attempts, c.consumed_at,
                    u.email, u.role, u.password_reset_required, u.two_factor_totp_secret
               FROM auth_2fa_challenges c
               JOIN users u ON u.id = c.user_id
              WHERE c.id = $1
                AND c.context = 'login'
              LIMIT 1
              FOR UPDATE OF c`,
            [challengeId]
        );
        if (!rows.rows.length) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "two_factor_challenge_not_found" });
        }
        const c = rows.rows[0];
        if (c.consumed_at) {
            await client.query("ROLLBACK");
            return res.status(400).json({ error: "two_factor_challenge_consumed" });
        }
        if (Number(c.attempts || 0) >= Math.max(1, TWO_FACTOR_MAX_ATTEMPTS)) {
            await client.query("ROLLBACK");
            return res.status(429).json({ error: "two_factor_too_many_attempts" });
        }
        if (!c.expires_at || new Date(c.expires_at).getTime() <= Date.now()) {
            await client.query("ROLLBACK");
            return res.status(400).json({ error: "two_factor_challenge_expired" });
        }

        let valid = false;
        if (c.method === "totp") {
            const settings = await loadTotpSettings();
            const secret = decryptSettingValue(String(c.two_factor_totp_secret || "")).trim();
            if (secret) {
                valid = verifyTotpCode(secret, code, {
                    digits: settings.digits,
                    period: settings.period,
                    window: 1,
                });
            }
        } else if (c.method === "sms") {
            const expectedHash = String(c.code_hash || "");
            const actualHash = hashCodeForChallenge(c.id, code);
            valid = safeCompareCodeHash(actualHash, expectedHash);
        }

        if (!valid) {
            await client.query("UPDATE auth_2fa_challenges SET attempts = attempts + 1 WHERE id = $1", [c.id]);
            await client.query("COMMIT");
            await writeAuditLog({
                req,
                actorUserId: c.user_id,
                action: "auth.login_2fa_failed",
                resourceType: "user",
                resourceId: c.user_id,
                metadata: { method: c.method },
            });
            return res.status(401).json({ error: "invalid_two_factor_code" });
        }

        await client.query("UPDATE auth_2fa_challenges SET consumed_at = CURRENT_TIMESTAMP WHERE id = $1", [c.id]);
        await client.query("COMMIT");
        return finalizeAuthenticatedLogin(req, res, {
            id: c.user_id,
            email: c.email,
            role: c.role,
            password_reset_required: c.password_reset_required,
        });
    } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        return res.status(500).json({ error: "two_factor_verify_failed" });
    } finally {
        client.release();
    }
}

export async function resendTwoFactorSms(req, res) {
    const challengeId = String(req.body?.challengeId || "").trim();
    if (!challengeId) return res.status(400).json({ error: "challenge_id_required" });
    try {
        const rows = await query(
            `SELECT id, user_id, method, phone, expires_at, consumed_at
               FROM auth_2fa_challenges
              WHERE id = $1
                AND context = 'login'
              LIMIT 1`,
            [challengeId]
        );
        if (!rows.length) return res.status(404).json({ error: "two_factor_challenge_not_found" });
        const challenge = rows[0];
        if (challenge.method !== "sms") return res.status(400).json({ error: "two_factor_not_sms_challenge" });
        if (challenge.consumed_at) return res.status(400).json({ error: "two_factor_challenge_consumed" });
        const phone = normalizePhoneE164(challenge.phone);
        if (!phone) return res.status(400).json({ error: "two_factor_sms_phone_missing" });
        const expiresAt = challengeExpiresAtDate();
        const codeHash = await issueSmsCodeForChallenge(challenge.id, phone);
        await query(
            `UPDATE auth_2fa_challenges
                SET code_hash = $2,
                    expires_at = $3,
                    attempts = 0
              WHERE id = $1`,
            [challenge.id, codeHash, expiresAt.toISOString()]
        );
        await writeAuditLog({
            req,
            actorUserId: challenge.user_id,
            action: "auth.login_2fa_sms_resent",
            resourceType: "user",
            resourceId: challenge.user_id,
        });
        return res.json({ success: true, challengeId: challenge.id, maskedPhone: maskPhone(phone), expiresAt: expiresAt.toISOString() });
    } catch (err) {
        return res.status(500).json({ error: "two_factor_sms_resend_failed" });
    }
}

export async function getTwoFactorStatus(req, res) {
    try {
        const rows = await query(
            `SELECT two_factor_enabled, two_factor_method, two_factor_phone, two_factor_totp_secret
               FROM users
              WHERE id = $1
              LIMIT 1`,
            [req.user.id]
        );
        if (!rows.length) return res.status(404).json({ error: "user_not_found" });
        const user = rows[0];
        const smsCfg = await loadSmsOtpConfig().catch(() => ({ enabled: false }));
        return res.json({
            enabled: !!user.two_factor_enabled,
            method: String(user.two_factor_method || "").trim().toLowerCase() || null,
            phoneMasked: maskPhone(user.two_factor_phone),
            hasTotpSecret: !!decryptSettingValue(String(user.two_factor_totp_secret || "")).trim(),
            smsConfigured: !!smsCfg?.enabled,
        });
    } catch (err) {
        return res.status(500).json({ error: "two_factor_status_failed" });
    }
}

export async function startTotpSetup(req, res) {
    const currentPassword = String(req.body?.currentPassword || "");
    if (!currentPassword) return res.status(400).json({ error: "current_password_required" });
    try {
        const rows = await query("SELECT id, email, password FROM users WHERE id = $1 LIMIT 1", [req.user.id]);
        if (!rows.length) return res.status(404).json({ error: "user_not_found" });
        const user = rows[0];
        const { valid } = await verifyPassword(currentPassword, user.password);
        if (!valid) return res.status(401).json({ error: "invalid_current_password" });

        const settings = await loadTotpSettings();
        const secret = generateTotpSecret();
        const encryptedSecret = encryptSettingValue(secret);
        const expiresAt = new Date(Date.now() + Math.max(120, TWO_FACTOR_PENDING_TOTP_TTL_SEC) * 1000);
        await query(
            `INSERT INTO user_totp_pending (user_id, secret, expires_at, created_at)
             VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
             ON CONFLICT (user_id)
             DO UPDATE SET secret = EXCLUDED.secret, expires_at = EXCLUDED.expires_at, created_at = CURRENT_TIMESTAMP`,
            [req.user.id, encryptedSecret, expiresAt.toISOString()]
        );
        const otpAuthUrl = buildOtpAuthUrl({
            issuer: settings.issuer,
            accountName: user.email,
            secret,
            digits: settings.digits,
            period: settings.period,
        });
        return res.json({
            secret,
            otpAuthUrl,
            issuer: settings.issuer,
            digits: settings.digits,
            period: settings.period,
            expiresAt: expiresAt.toISOString(),
        });
    } catch (err) {
        return res.status(500).json({ error: "two_factor_totp_setup_start_failed" });
    }
}

export async function enableTotp(req, res) {
    const code = String(req.body?.code || "").trim();
    if (!code) return res.status(400).json({ error: "two_factor_code_required" });
    const client = await getClient();
    try {
        await client.query("BEGIN");
        const pendingRes = await client.query(
            `SELECT secret, expires_at
               FROM user_totp_pending
              WHERE user_id = $1
              LIMIT 1
              FOR UPDATE`,
            [req.user.id]
        );
        if (!pendingRes.rows.length) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "two_factor_totp_not_initialized" });
        }
        const pending = pendingRes.rows[0];
        if (!pending.expires_at || new Date(pending.expires_at).getTime() <= Date.now()) {
            await client.query("ROLLBACK");
            return res.status(400).json({ error: "two_factor_totp_setup_expired" });
        }
        const settings = await loadTotpSettings();
        const secret = decryptSettingValue(String(pending.secret || "")).trim();
        const valid = secret
            ? verifyTotpCode(secret, code, { digits: settings.digits, period: settings.period, window: 1 })
            : false;
        if (!valid) {
            await client.query("ROLLBACK");
            return res.status(401).json({ error: "invalid_two_factor_code" });
        }
        await client.query(
            `UPDATE users
                SET two_factor_enabled = TRUE,
                    two_factor_method = 'totp',
                    two_factor_totp_secret = $2
              WHERE id = $1`,
            [req.user.id, pending.secret]
        );
        await client.query("DELETE FROM user_totp_pending WHERE user_id = $1", [req.user.id]);
        await client.query("COMMIT");
        await writeAuditLog({
            req,
            actorUserId: req.user.id,
            action: "auth.2fa_totp_enabled",
            resourceType: "user",
            resourceId: req.user.id,
        });
        return res.json({ success: true, method: "totp" });
    } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        return res.status(500).json({ error: "two_factor_totp_enable_failed" });
    } finally {
        client.release();
    }
}

export async function startSmsSetup(req, res) {
    const currentPassword = String(req.body?.currentPassword || "");
    const phone = normalizePhoneE164(req.body?.phone);
    if (!currentPassword) return res.status(400).json({ error: "current_password_required" });
    if (!phone) return res.status(400).json({ error: "phone_e164_required" });

    try {
        const smsCfg = await loadSmsOtpConfig();
        if (!smsCfg.enabled) return res.status(400).json({ error: "sms_otp_not_configured" });
        const rows = await query("SELECT id, password FROM users WHERE id = $1 LIMIT 1", [req.user.id]);
        if (!rows.length) return res.status(404).json({ error: "user_not_found" });
        const { valid } = await verifyPassword(currentPassword, rows[0].password);
        if (!valid) return res.status(401).json({ error: "invalid_current_password" });
        const challengeId = randomUUID();
        const expiresAt = challengeExpiresAtDate();
        const codeHash = await issueSmsCodeForChallenge(challengeId, phone);
        await query(
            `INSERT INTO auth_2fa_challenges
                (id, user_id, method, context, code_hash, phone, expires_at)
             VALUES ($1, $2, 'sms', 'setup_sms', $3, $4, $5)`,
            [challengeId, req.user.id, codeHash, phone, expiresAt.toISOString()]
        );
        return res.json({
            challengeId,
            maskedPhone: maskPhone(phone),
            expiresAt: expiresAt.toISOString(),
        });
    } catch (err) {
        return res.status(500).json({ error: "two_factor_sms_setup_start_failed" });
    }
}

export async function confirmSmsSetup(req, res) {
    const challengeId = String(req.body?.challengeId || "").trim();
    const code = String(req.body?.code || "").trim();
    if (!challengeId || !code) return res.status(400).json({ error: "challenge_id_and_code_required" });
    const client = await getClient();
    try {
        await client.query("BEGIN");
        const found = await client.query(
            `SELECT id, user_id, code_hash, phone, expires_at, consumed_at, attempts
               FROM auth_2fa_challenges
              WHERE id = $1
                AND context = 'setup_sms'
              LIMIT 1
              FOR UPDATE`,
            [challengeId]
        );
        if (!found.rows.length) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "two_factor_challenge_not_found" });
        }
        const c = found.rows[0];
        if (Number(c.user_id) !== Number(req.user.id)) {
            await client.query("ROLLBACK");
            return res.status(403).json({ error: "Forbidden" });
        }
        if (c.consumed_at) {
            await client.query("ROLLBACK");
            return res.status(400).json({ error: "two_factor_challenge_consumed" });
        }
        if (Number(c.attempts || 0) >= Math.max(1, TWO_FACTOR_MAX_ATTEMPTS)) {
            await client.query("ROLLBACK");
            return res.status(429).json({ error: "two_factor_too_many_attempts" });
        }
        if (!c.expires_at || new Date(c.expires_at).getTime() <= Date.now()) {
            await client.query("ROLLBACK");
            return res.status(400).json({ error: "two_factor_challenge_expired" });
        }
        const expectedHash = String(c.code_hash || "");
        const actualHash = hashCodeForChallenge(c.id, code);
        if (!safeCompareCodeHash(actualHash, expectedHash)) {
            await client.query("UPDATE auth_2fa_challenges SET attempts = attempts + 1 WHERE id = $1", [c.id]);
            await client.query("COMMIT");
            return res.status(401).json({ error: "invalid_two_factor_code" });
        }
        await client.query(
            `UPDATE users
                SET two_factor_enabled = TRUE,
                    two_factor_method = 'sms',
                    two_factor_phone = $2
              WHERE id = $1`,
            [req.user.id, c.phone]
        );
        await client.query("UPDATE auth_2fa_challenges SET consumed_at = CURRENT_TIMESTAMP WHERE id = $1", [c.id]);
        await client.query("COMMIT");
        await writeAuditLog({
            req,
            actorUserId: req.user.id,
            action: "auth.2fa_sms_enabled",
            resourceType: "user",
            resourceId: req.user.id,
            metadata: { phone: maskPhone(c.phone) },
        });
        return res.json({ success: true, method: "sms", phoneMasked: maskPhone(c.phone) });
    } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        return res.status(500).json({ error: "two_factor_sms_setup_confirm_failed" });
    } finally {
        client.release();
    }
}

export async function disableTwoFactor(req, res) {
    const currentPassword = String(req.body?.currentPassword || "");
    if (!currentPassword) return res.status(400).json({ error: "current_password_required" });
    try {
        const rows = await query("SELECT id, password FROM users WHERE id = $1 LIMIT 1", [req.user.id]);
        if (!rows.length) return res.status(404).json({ error: "user_not_found" });
        const { valid } = await verifyPassword(currentPassword, rows[0].password);
        if (!valid) return res.status(401).json({ error: "invalid_current_password" });
        await query(
            `UPDATE users
                SET two_factor_enabled = FALSE,
                    two_factor_method = NULL,
                    two_factor_totp_secret = NULL,
                    two_factor_phone = NULL
              WHERE id = $1`,
            [req.user.id]
        );
        await query("DELETE FROM user_totp_pending WHERE user_id = $1", [req.user.id]);
        await writeAuditLog({
            req,
            actorUserId: req.user.id,
            action: "auth.2fa_disabled",
            resourceType: "user",
            resourceId: req.user.id,
        });
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ error: "two_factor_disable_failed" });
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
