import { query, getClient } from "../config/db.js";
import { hashPassword, generateComplexPassword } from "../utils/security.js";
import { decryptSettingValue, encryptSettingValue } from "../utils/settingsCrypto.js";
import { parsePagination } from "../utils/pagination.js";
import { writeAuditLog } from "../utils/auditLog.js";
import { normalizeGroupEntitlements, groupHasFeature } from "../utils/entitlements.js";
import { sendInvitationEmail } from "../utils/smtpMailer.js";
import { loadInvitationPolicy, saveInvitationPolicy, computeInvitationExpiryDate } from "../utils/invitationLifecycle.js";
import { randomBytes, createHash } from "crypto";

const EXPOSE_TEMP_PASSWORDS = process.env.EXPOSE_TEMP_PASSWORDS
    ? process.env.EXPOSE_TEMP_PASSWORDS === "true"
    : process.env.NODE_ENV !== "production";
const ALLOWED_ROLES = new Set(["admin", "user"]);
const HEAVY_LIST_CACHE = new Map();
const HEAVY_LIST_CACHE_TTL_MS = Number.parseInt(process.env.HEAVY_LIST_CACHE_TTL_MS || "20000", 10);
const HEAVY_LIST_CACHE_MAX = Number.parseInt(process.env.HEAVY_LIST_CACHE_MAX || "200", 10);
const ENABLE_STORAGE_USAGE_METRICS = String(process.env.ENABLE_STORAGE_USAGE_METRICS || "").toLowerCase() === "true";
const CUSTOMER_INVITE_BASE_URL = String(process.env.CUSTOMER_INVITE_BASE_URL || "").trim();

function normalizeRole(value, fallback = "user") {
    const normalized = String(value || fallback).trim().toLowerCase();
    return ALLOWED_ROLES.has(normalized) ? normalized : null;
}

function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
}

function parsePositiveInt(value) {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function createInviteTokenPair() {
    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    return { token, tokenHash };
}

function resolveInviteBaseUrl(req) {
    if (/^https?:\/\//i.test(CUSTOMER_INVITE_BASE_URL)) return CUSTOMER_INVITE_BASE_URL.replace(/\/+$/, "");
    const frontendUrl = String(process.env.FRONTEND_URL || "").trim();
    if (/^https?:\/\//i.test(frontendUrl)) return frontendUrl.replace(/\/+$/, "");
    const originHeader = String(req.headers?.origin || "").trim();
    if (/^https?:\/\//i.test(originHeader)) return originHeader.replace(/\/+$/, "");
    const fallback = "http://localhost:5173";
    return fallback.replace(/\/+$/, "");
}

function getHeavyListCache(key) {
    const found = HEAVY_LIST_CACHE.get(key);
    if (!found) return null;
    if (Date.now() > Number(found.expiresAt || 0)) {
        HEAVY_LIST_CACHE.delete(key);
        return null;
    }
    return found.value;
}

function setHeavyListCache(key, value) {
    HEAVY_LIST_CACHE.set(key, { value, expiresAt: Date.now() + HEAVY_LIST_CACHE_TTL_MS });
    while (HEAVY_LIST_CACHE.size > HEAVY_LIST_CACHE_MAX) {
        const oldest = HEAVY_LIST_CACHE.keys().next().value;
        if (!oldest) break;
        HEAVY_LIST_CACHE.delete(oldest);
    }
}

function clearHeavyListCache() {
    HEAVY_LIST_CACHE.clear();
}

export async function listAuditLogs(req, res) {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    const pagination = parsePagination(req.query, { maxLimit: 1000 });
    if (pagination.error) return res.status(400).json({ error: pagination.error });
    const params = [];
    const clauses = [];
    if (req.query?.actorUserId) {
        params.push(Number.parseInt(req.query.actorUserId, 10));
        clauses.push(`al.actor_user_id = $${params.length}`);
    }
    if (req.query?.action) {
        params.push(String(req.query.action));
        clauses.push(`al.action = $${params.length}`);
    }
    if (req.query?.resourceType) {
        params.push(String(req.query.resourceType));
        clauses.push(`al.resource_type = $${params.length}`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    let limitSql = "";
    if (pagination.hasPagination) {
        params.push(pagination.limit, pagination.offset);
        limitSql = ` LIMIT $${params.length - 1} OFFSET $${params.length}`;
    }
    const rows = await query(
        `SELECT al.id, al.actor_user_id, u.email AS actor_email, al.action, al.resource_type,
                al.resource_id, al.request_id, al.ip, al.user_agent, al.metadata, al.created_at
           FROM audit_logs al
           LEFT JOIN users u ON u.id = al.actor_user_id
          ${where}
          ORDER BY al.created_at DESC${limitSql}`,
        params
    );
    res.json(rows);
}

async function getAdminGroups(userId) {
    const res = await query('SELECT group_id FROM user_groups WHERE user_id = $1 AND is_admin = TRUE', [userId]);
    return res.map(r => r.group_id);
}

async function loadGroupForAdminAction(groupId) {
    const gid = Number.parseInt(groupId, 10);
    if (!Number.isInteger(gid) || gid <= 0) return null;
    const rows = await query("SELECT id, name, entitlements FROM groups WHERE id = $1", [gid]);
    return rows[0] || null;
}

async function assertGroupCanManageUsers(groupId) {
    const group = await loadGroupForAdminAction(groupId);
    if (!group) {
        const err = new Error("group_not_found");
        err.statusCode = 404;
        throw err;
    }
    if (!groupHasFeature(group, "manageUsers")) {
        const err = new Error("feature_not_enabled:manageUsers");
        err.statusCode = 403;
        throw err;
    }
    return group;
}

async function assertGroupsCanManageUsers(groupIds) {
    const ids = Array.from(new Set((groupIds || [])
        .map((groupId) => Number.parseInt(groupId, 10))
        .filter((groupId) => Number.isInteger(groupId) && groupId > 0)));
    for (const groupId of ids) {
        await assertGroupCanManageUsers(groupId);
    }
}

async function assertGroupUserLimitAvailable(groupId, additionalUsers = 1) {
    const group = await assertGroupCanManageUsers(groupId);
    const entitlements = normalizeGroupEntitlements(group.entitlements || {});
    if (!entitlements.maxUsers) return group;
    const rows = await query("SELECT COUNT(*)::int AS c FROM user_groups WHERE group_id = $1", [group.id]);
    const current = Number(rows?.[0]?.c || 0);
    if (current + additionalUsers > entitlements.maxUsers) {
        const err = new Error("group_user_limit_exceeded");
        err.statusCode = 403;
        err.details = { maxUsers: entitlements.maxUsers, currentUsers: current };
        throw err;
    }
    return group;
}

async function getCustomerAdminManageableGroups(userId) {
    const adminGroups = await getAdminGroups(userId);
    if (!adminGroups.length) return [];
    const rows = await query("SELECT id, entitlements FROM groups WHERE id = ANY($1::int[])", [adminGroups]);
    return rows
        .filter((group) => groupHasFeature(group, "manageUsers"))
        .map((group) => Number(group.id))
        .filter((groupId) => Number.isInteger(groupId) && groupId > 0);
}

function parseEntitlementsInput(value) {
    if (value === undefined) return undefined;
    return normalizeGroupEntitlements(value);
}

// --- Users ---

export async function getUserGroups(req, res) {
    const id = parseInt(req.params.id, 10);
    const isGlobalAdmin = req.user.role === "admin";
    if (!isGlobalAdmin) {
        const adminGroups = await getAdminGroups(req.user.id);
        if (!adminGroups.length) return res.status(403).json({ error: "Forbidden" });
        const sharesGroup = await query(`SELECT 1 FROM user_groups ug WHERE ug.user_id = $1 AND ug.group_id = ANY($2::int[])`, [id, adminGroups]);
        if (!sharesGroup.length && req.user.id !== id) return res.status(403).json({ error: "Forbidden" });
    }
    const rows = await query(
        `SELECT g.id, g.name FROM groups g
         JOIN user_groups ug ON ug.group_id = g.id
         WHERE ug.user_id = $1
         ORDER BY g.id ASC`,
        [id]
    );
    res.json(rows);
}

export async function listUsers(req, res) {
    const isGlobalAdmin = req.user.role === "admin";
    const pagination = parsePagination(req.query, { maxLimit: 1000 });
    if (pagination.error) return res.status(400).json({ error: pagination.error });
    try {
        if (isGlobalAdmin) {
            const params = [];
            let sql = `SELECT id, email, role, default_view_id, first_name, last_name, company,
                              CASE WHEN password IS NULL THEN 'google' ELSE 'manual' END AS auth_provider
                       FROM users
                       ORDER BY id ASC`;
            if (pagination.hasPagination) {
                sql += ` LIMIT $1 OFFSET $2`;
                params.push(pagination.limit, pagination.offset);
            }
            const users = await query(
                sql,
                params
            );
            return res.json(users);
    } else {
        const adminGroups = await getAdminGroups(req.user.id);
        if (!adminGroups.length) return res.status(403).json({ error: "Forbidden" });
        try {
            await assertGroupsCanManageUsers(adminGroups);
        } catch (err) {
            return res.status(err.statusCode || 403).json({ error: err.message });
        }

        // Return users who share ANY handled group with the admin
        const params = [adminGroups];
            let sql = `
                SELECT DISTINCT u.id, u.email, u.role, u.default_view_id, u.first_name, u.last_name, u.company,
                                CASE WHEN u.password IS NULL THEN 'google' ELSE 'manual' END AS auth_provider
                FROM users u
                JOIN user_groups ug ON u.id = ug.user_id
                WHERE ug.group_id = ANY($1::int[])
                ORDER BY u.id ASC`;
            if (pagination.hasPagination) {
                sql += ` LIMIT $2 OFFSET $3`;
                params.push(pagination.limit, pagination.offset);
            }
            const users = await query(sql, params);
            return res.json(users);
        }
    } catch (e) {
        console.error("listUsers error:", e);
        res.status(500).json({ error: "internal_error" });
    }
}

export async function createUser(req, res) {
    const isGlobalAdmin = req.user.role === "admin";
    const desiredRole = normalizeRole(req.body?.role, "user");
    const requestedGroupId = req.body?.groupId ?? req.body?.group_id;
    const targetGroupId = requestedGroupId ? Number.parseInt(requestedGroupId, 10) : null;
    if (!desiredRole) return res.status(400).json({ error: "invalid_role" });
    if (!isGlobalAdmin) {
        const adminGroups = await getAdminGroups(req.user.id);
        if (!adminGroups.length) return res.status(403).json({ error: "Forbidden" });
        if (desiredRole !== "user") return res.status(403).json({ error: "Forbidden" });
        if (!Number.isInteger(targetGroupId) || !adminGroups.includes(targetGroupId)) {
            return res.status(400).json({ error: "managed_group_required" });
        }
        try {
            await assertGroupUserLimitAvailable(targetGroupId, 1);
        } catch (err) {
            return res.status(err.statusCode || 403).json({ error: err.message, ...(err.details || {}) });
        }
    } else if (Number.isInteger(targetGroupId)) {
        const targetGroup = await loadGroupForAdminAction(targetGroupId);
        if (!targetGroup) {
            return res.status(400).json({ error: "invalid_group_id" });
        }
    }
    const { email, password, role, firstName, lastName, company } = req.body;
    const emailText = normalizeEmail(email);
    const firstNameText = String(firstName || "").trim();
    const lastNameText = String(lastName || "").trim();
    const companyText = String(company || "").trim();
    if (!emailText || !firstNameText || !lastNameText || !companyText) {
        return res.status(400).json({ error: "first_name_last_name_email_company_required" });
    }
    if (desiredRole === "user" && Number.isInteger(targetGroupId) && targetGroupId > 0) {
        return res.status(400).json({ error: "customer_users_invite_only" });
    }

    const temporaryPassword = password || generateComplexPassword(16);
    const hashedFn = await hashPassword(temporaryPassword);

    try {
        const client = await getClient();
        let payload;
        try {
            await client.query("BEGIN");
            const created = await client.query(
                "INSERT INTO users (email, password, role, first_name, last_name, company, password_reset_required) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, email, role, first_name, last_name, company",
                [emailText, hashedFn, desiredRole, firstNameText, lastNameText, companyText, true]
            );
            payload = { ...created.rows[0] };
            if (Number.isInteger(targetGroupId)) {
                await client.query(
                    "INSERT INTO user_groups (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
                    [targetGroupId, payload.id]
                );
            }
            await client.query("COMMIT");
        } catch (err) {
            await client.query("ROLLBACK").catch(() => {});
            throw err;
        } finally {
            client.release();
        }
        if (EXPOSE_TEMP_PASSWORDS) payload.newPassword = temporaryPassword;
        await writeAuditLog({
            req,
            action: "user.created",
            resourceType: "user",
            resourceId: payload.id,
            metadata: { role: payload.role, group_id: targetGroupId || null },
        });
        clearHeavyListCache();
        res.json(payload);
    } catch (e) {
        if (String(e).includes("unique constraint")) return res.status(400).json({ error: "Email exists" });
        res.status(500).json({ error: "failed" });
    }
}

export async function inviteCustomerUser(req, res) {
    const isGlobalAdmin = req.user.role === "admin";
    const targetGroupId = parsePositiveInt(req.body?.groupId ?? req.body?.group_id);
    const emailText = normalizeEmail(req.body?.email);
    const firstNameText = String(req.body?.firstName || "").trim();
    const lastNameText = String(req.body?.lastName || "").trim();
    const companyText = String(req.body?.company || "").trim();
    const inviteBaseUrl = resolveInviteBaseUrl(req);

    if (!Number.isInteger(targetGroupId) || targetGroupId <= 0) {
        return res.status(400).json({ error: "managed_group_required" });
    }
    if (!emailText || !firstNameText || !lastNameText || !companyText) {
        return res.status(400).json({ error: "first_name_last_name_email_company_required" });
    }

    try {
        if (!isGlobalAdmin) {
            const adminGroups = await getAdminGroups(req.user.id);
            if (!adminGroups.length || !adminGroups.includes(targetGroupId)) {
                return res.status(403).json({ error: "Forbidden" });
            }
        } else {
            const targetGroup = await loadGroupForAdminAction(targetGroupId);
            if (!targetGroup) return res.status(400).json({ error: "invalid_group_id" });
        }

        const targetGroup = await assertGroupUserLimitAvailable(targetGroupId, 1);
        const existingUsers = await query(
            "SELECT id, role FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1",
            [emailText]
        );
        const existingUser = existingUsers[0] || null;
        if (existingUser?.role === "admin") {
            return res.status(403).json({ error: "admin_email_not_allowed" });
        }
        if (existingUser?.id) {
            const existingMembership = await query(
                "SELECT 1 FROM user_groups WHERE user_id = $1 AND group_id = $2 LIMIT 1",
                [existingUser.id, targetGroupId]
            );
            if (existingMembership.length) {
                return res.status(400).json({ error: "user_already_in_customer" });
            }
        }

        const { token, tokenHash } = createInviteTokenPair();
        const invitePolicy = await loadInvitationPolicy();
        const expiresAt = computeInvitationExpiryDate(invitePolicy);

        const inserted = await query(
            `INSERT INTO customer_user_invitations
                (email, group_id, first_name, last_name, company, token_hash, invited_by_user_id, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING id, expires_at`,
            [emailText, targetGroupId, firstNameText, lastNameText, companyText, tokenHash, req.user.id, expiresAt.toISOString()]
        );
        const invitation = inserted[0];
        const inviteUrl = `${inviteBaseUrl}/?invite=${encodeURIComponent(token)}`;

        try {
            await sendInvitationEmail({
                toEmail: emailText,
                inviteUrl,
                customerName: String(targetGroup?.name || `Customer ${targetGroupId}`),
                inviterEmail: String(req.user?.email || ""),
                expiresAt: invitation.expires_at || expiresAt.toISOString(),
            });
        } catch (mailErr) {
            await query("UPDATE customer_user_invitations SET revoked_at = CURRENT_TIMESTAMP WHERE id = $1", [invitation.id]);
            return res.status(mailErr?.statusCode || 500).json({ error: mailErr?.message || "invitation_email_failed" });
        }

        await writeAuditLog({
            req,
            action: "customer_user.invited",
            resourceType: "group",
            resourceId: targetGroupId,
            metadata: {
                invite_id: invitation.id,
                email: emailText,
                expires_at: invitation.expires_at || expiresAt.toISOString(),
            },
        });
        clearHeavyListCache();
        return res.json({
            success: true,
            invitationId: invitation.id,
            email: emailText,
            groupId: targetGroupId,
            expiresAt: invitation.expires_at || expiresAt.toISOString(),
        });
    } catch (err) {
        return res.status(err.statusCode || 500).json({ error: err.message || "invitation_failed" });
    }
}

export async function listCustomerInvitations(req, res) {
    const isGlobalAdmin = req.user.role === "admin";
    const requestedGroupId = parsePositiveInt(req.query?.groupId);
    const pagination = parsePagination(req.query, { maxLimit: 250 });
    if (pagination.error) return res.status(400).json({ error: pagination.error });

    const params = [];
    const where = [
        "cui.accepted_at IS NULL",
        "cui.revoked_at IS NULL",
    ];

    try {
        if (isGlobalAdmin) {
            if (requestedGroupId) {
                const group = await loadGroupForAdminAction(requestedGroupId);
                if (!group) return res.status(404).json({ error: "group_not_found" });
                where.push(`cui.group_id = $${params.push(requestedGroupId)}`);
            }
        } else {
            const manageableGroupIds = await getCustomerAdminManageableGroups(req.user.id);
            if (!manageableGroupIds.length) return res.status(403).json({ error: "Forbidden" });
            if (requestedGroupId && !manageableGroupIds.includes(requestedGroupId)) {
                return res.status(403).json({ error: "Forbidden" });
            }
            if (requestedGroupId) {
                where.push(`cui.group_id = $${params.push(requestedGroupId)}`);
            } else {
                where.push(`cui.group_id = ANY($${params.push(manageableGroupIds)}::int[])`);
            }
        }

        let limitSql = "";
        if (pagination.hasPagination) {
            params.push(pagination.limit, pagination.offset);
            limitSql = ` LIMIT $${params.length - 1} OFFSET $${params.length}`;
        }
        const rows = await query(
            `SELECT cui.id, cui.email, cui.group_id, g.name AS group_name, cui.first_name, cui.last_name, cui.company,
                    cui.expires_at, cui.created_at, cui.invited_by_user_id, iu.email AS invited_by_email
               FROM customer_user_invitations cui
               JOIN groups g ON g.id = cui.group_id
               LEFT JOIN users iu ON iu.id = cui.invited_by_user_id
              WHERE ${where.join(" AND ")}
              ORDER BY cui.created_at DESC${limitSql}`,
            params
        );
        return res.json(rows.map((row) => ({
            ...row,
            is_expired: row.expires_at ? new Date(row.expires_at).getTime() <= Date.now() : false,
        })));
    } catch (err) {
        return res.status(500).json({ error: "invitation_list_failed" });
    }
}

export async function resendCustomerInvitation(req, res) {
    const invitationId = parsePositiveInt(req.params?.id);
    if (!invitationId) return res.status(400).json({ error: "invalid_invitation_id" });
    const isGlobalAdmin = req.user.role === "admin";
    const inviteBaseUrl = resolveInviteBaseUrl(req);

    try {
        const rows = await query(
            `SELECT cui.id, cui.email, cui.group_id, cui.first_name, cui.last_name, cui.company, cui.accepted_at, cui.revoked_at,
                    g.name AS group_name
               FROM customer_user_invitations cui
               JOIN groups g ON g.id = cui.group_id
              WHERE cui.id = $1
              LIMIT 1`,
            [invitationId]
        );
        if (!rows.length) return res.status(404).json({ error: "invitation_not_found" });
        const invitation = rows[0];
        if (invitation.accepted_at) return res.status(400).json({ error: "invitation_already_accepted" });
        if (invitation.revoked_at) return res.status(400).json({ error: "invitation_revoked" });

        if (!isGlobalAdmin) {
            const manageableGroupIds = await getCustomerAdminManageableGroups(req.user.id);
            if (!manageableGroupIds.includes(Number(invitation.group_id))) {
                return res.status(403).json({ error: "Forbidden" });
            }
        }

        const { token, tokenHash } = createInviteTokenPair();
        const invitePolicy = await loadInvitationPolicy();
        const expiresAt = computeInvitationExpiryDate(invitePolicy);
        await query(
            `UPDATE customer_user_invitations
                SET token_hash = $2,
                    invited_by_user_id = $3,
                    expires_at = $4
              WHERE id = $1`,
            [invitation.id, tokenHash, req.user.id, expiresAt.toISOString()]
        );
        const inviteUrl = `${inviteBaseUrl}/?invite=${encodeURIComponent(token)}`;
        await sendInvitationEmail({
            toEmail: invitation.email,
            inviteUrl,
            customerName: String(invitation.group_name || `Customer ${invitation.group_id}`),
            inviterEmail: String(req.user?.email || ""),
            expiresAt: expiresAt.toISOString(),
        });
        await writeAuditLog({
            req,
            action: "customer_user.invitation_resent",
            resourceType: "group",
            resourceId: invitation.group_id,
            metadata: { invite_id: invitation.id, email: invitation.email, expires_at: expiresAt.toISOString() },
        });
        return res.json({ success: true, invitationId: invitation.id, expiresAt: expiresAt.toISOString() });
    } catch (err) {
        return res.status(500).json({ error: "invitation_resend_failed" });
    }
}

export async function revokeCustomerInvitation(req, res) {
    const invitationId = parsePositiveInt(req.params?.id);
    if (!invitationId) return res.status(400).json({ error: "invalid_invitation_id" });
    const isGlobalAdmin = req.user.role === "admin";

    try {
        const rows = await query(
            `SELECT id, group_id, email, accepted_at, revoked_at
               FROM customer_user_invitations
              WHERE id = $1
              LIMIT 1`,
            [invitationId]
        );
        if (!rows.length) return res.status(404).json({ error: "invitation_not_found" });
        const invitation = rows[0];
        if (invitation.accepted_at) return res.status(400).json({ error: "invitation_already_accepted" });
        if (invitation.revoked_at) return res.status(400).json({ error: "invitation_already_revoked" });
        if (!isGlobalAdmin) {
            const manageableGroupIds = await getCustomerAdminManageableGroups(req.user.id);
            if (!manageableGroupIds.includes(Number(invitation.group_id))) {
                return res.status(403).json({ error: "Forbidden" });
            }
        }
        await query("UPDATE customer_user_invitations SET revoked_at = CURRENT_TIMESTAMP WHERE id = $1", [invitation.id]);
        await writeAuditLog({
            req,
            action: "customer_user.invitation_revoked",
            resourceType: "group",
            resourceId: invitation.group_id,
            metadata: { invite_id: invitation.id, email: invitation.email },
        });
        return res.json({ success: true, invitationId: invitation.id });
    } catch (err) {
        return res.status(500).json({ error: "invitation_revoke_failed" });
    }
}

export async function updateUser(req, res) {
    const { id } = req.params;
    const { email, password, role, reset, firstName, lastName, company } = req.body;
    
    const isGlobalAdmin = req.user.role === "admin";
    const desiredRole = role !== undefined ? normalizeRole(role, "user") : undefined;
    if (role !== undefined && !desiredRole) return res.status(400).json({ error: "invalid_role" });
    if (!isGlobalAdmin) {
        const adminGroups = await getAdminGroups(req.user.id);
        if (!adminGroups.length) return res.status(403).json({ error: "Forbidden" });
        if (desiredRole !== undefined && desiredRole !== "user") return res.status(403).json({ error: "Forbidden" });

        const target = await query("SELECT role FROM users WHERE id=$1", [id]);
        if (!target.length) return res.status(404).json({ error: "not_found" });
        if (target[0].role === "admin") return res.status(403).json({ error: "Forbidden" });

        const sharesGroup = await query(`SELECT 1 FROM user_groups ug WHERE ug.user_id = $1 AND ug.group_id = ANY($2::int[])`, [id, adminGroups]);
        if (!sharesGroup.length) return res.status(403).json({ error: "Forbidden" });

        // SEC-01 Fix: Ensure user doesn't belong to groups OUTSIDE the admin's scope
        const memberships = await query(
            "SELECT group_id FROM user_groups WHERE user_id = $1",
            [id]
        );
        const unmanagedGroups = memberships.filter((row) => !adminGroups.includes(row.group_id));
        if (unmanagedGroups.length > 0) {
            return res.status(403).json({ error: "Forbidden: User belongs to customers outside your admin scope." });
        }
        try {
            await assertGroupsCanManageUsers(memberships.map((row) => row.group_id));
        } catch (err) {
            return res.status(err.statusCode || 403).json({ error: err.message });
        }
    }

    try {
        // Handle password reset request
        if (reset) {
            const suppliedPassword = String(password || "");
            const newPassword = suppliedPassword || generateComplexPassword(16);
            const hashed = await hashPassword(newPassword);
            await query("UPDATE users SET password=$1, password_reset_required=TRUE WHERE id=$2", [hashed, id]);
            await writeAuditLog({
                req,
                action: "user.password_reset",
                resourceType: "user",
                resourceId: id,
            });
            return res.json(EXPOSE_TEMP_PASSWORDS && !suppliedPassword ? { success: true, newPassword } : { success: true });
        }

        // Dynamic partial update
        const fields = [];
        const values = [];
        let idx = 1;

        if (email !== undefined) {
            if (!String(email || "").trim()) return res.status(400).json({ error: "email_required" });
            fields.push(`email=$${idx++}`);
            values.push(normalizeEmail(email));
        }
        if (role !== undefined) {
            fields.push(`role=$${idx++}`);
            values.push(desiredRole);
        }
        if (firstName !== undefined) {
            if (!String(firstName || "").trim()) return res.status(400).json({ error: "first_name_required" });
            fields.push(`first_name=$${idx++}`);
            values.push(String(firstName).trim());
        }
        if (lastName !== undefined) {
            if (!String(lastName || "").trim()) return res.status(400).json({ error: "last_name_required" });
            fields.push(`last_name=$${idx++}`);
            values.push(String(lastName).trim());
        }
        if (company !== undefined) {
            if (!String(company || "").trim()) return res.status(400).json({ error: "company_required" });
            fields.push(`company=$${idx++}`);
            values.push(String(company).trim());
        }
        if (password !== undefined) {
            const hashed = await hashPassword(password);
            fields.push(`password=$${idx++}`);
            values.push(hashed);
        }

        if (fields.length === 0) {
            return res.json({ success: true });
        }

        values.push(id);
        const sql = `UPDATE users SET ${fields.join(", ")} WHERE id=$${idx}`;

        await query(sql, values);
        await writeAuditLog({
            req,
            action: "user.updated",
            resourceType: "user",
            resourceId: id,
            metadata: {
                fields: fields.map((field) => field.split("=")[0]),
            },
        });
        res.json({ success: true });
    } catch (e) {
        if (String(e).includes("unique constraint")) {
            return res.status(400).json({ error: "Email exists" });
        }
        console.error("updateUser error:", e);
        res.status(500).json({ error: "internal_server_error" });
    }
}

export async function deleteUser(req, res) {
    const { id } = req.params;
    const isGlobalAdmin = req.user.role === "admin";
    
    try {
        if (!isGlobalAdmin) {
            const adminGroups = await getAdminGroups(req.user.id);
            if (!adminGroups.length) return res.status(403).json({ error: "Forbidden" });

            const target = await query("SELECT role FROM users WHERE id=$1", [id]);
            if (!target.length) return res.status(404).json({ error: "not_found" });
            if (target[0].role === "admin") return res.status(403).json({ error: "Forbidden" });
            const targetManagedGroups = await query(
                "SELECT group_id FROM user_groups WHERE user_id = $1 AND group_id = ANY($2::int[])",
                [id, adminGroups]
            );
            if (!targetManagedGroups.length) return res.status(403).json({ error: "Forbidden" });
            try {
                await assertGroupsCanManageUsers(targetManagedGroups.map((row) => row.group_id));
            } catch (err) {
                return res.status(err.statusCode || 403).json({ error: err.message });
            }

            // Instead of deleting globally, customer admin only removes the user from managed customers.
            await query(`DELETE FROM user_groups WHERE user_id = $1 AND group_id = ANY($2::int[])`, [id, adminGroups]);
            await writeAuditLog({
                req,
                action: "user.removed_from_managed_groups",
                resourceType: "user",
                resourceId: id,
                metadata: { group_ids: adminGroups },
            });
            return res.json({ success: true, message: "User removed from your managed customers." });
        }

        // Global admin remains destructive
        await query("DELETE FROM users WHERE id=$1", [id]);
        await writeAuditLog({
            req,
            action: "user.deleted",
            resourceType: "user",
            resourceId: id,
        });
        res.json({ success: true });
    } catch (e) {
        console.error("deleteUser error:", e);
        res.status(500).json({ error: "internal_error" });
    }
}

export async function setDefaultView(req, res) {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    const { userId } = req.params;
    const { viewId } = req.body;
    await query(
        "UPDATE users SET default_view_id = $1 WHERE id = $2",
        [viewId || null, userId]
    );
    res.json({ success: true });
}

export async function getGoogleIntegrationSetting(req, res) {
    try {
        const scope = await resolveScopedGroupForIntegrationSettings(req);
        const value = await getAppSettingValueWithScopedFallback("google_integration", scope.groupId);
        const enabled = value ? !!value?.enabled : true;
        res.json({ enabled, groupId: scope.groupId || null });
    } catch (err) {
        res.status(err.statusCode || 403).json({ error: err.message || "Forbidden" });
    }
}

export async function setGoogleIntegrationSetting(req, res) {
    try {
        const scope = await resolveScopedGroupForIntegrationSettings(req);
        const enabled = !!req.body?.enabled;
        const key = appSettingKeyForGroup("google_integration", scope.groupId);
        await query(
            `INSERT INTO app_settings (key, value, updated_at)
             VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
             ON CONFLICT (key)
             DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
            [key, JSON.stringify({ enabled })]
        );
        res.json({ success: true, enabled, groupId: scope.groupId || null });
    } catch (err) {
        res.status(err.statusCode || 403).json({ error: err.message || "Forbidden" });
    }
}

function maskIfPresent(value) {
    return String(value || "").trim() ? "***" : "";
}

function decryptOauthConfig(raw) {
    const cfg = raw && typeof raw === "object" ? raw : {};
    return {
        clientId: decryptSettingValue(String(cfg.clientId || "")),
        clientSecret: decryptSettingValue(String(cfg.clientSecret || "")),
        redirectUri: String(cfg.redirectUri || ""),
        frontendUrl: String(cfg.frontendUrl || ""),
    };
}

function normalizeOauthConfigForSave(current, body) {
    const incomingClientIdRaw = typeof body?.clientId === "string" ? body.clientId.trim() : undefined;
    const incomingClientSecretRaw = typeof body?.clientSecret === "string" ? body.clientSecret.trim() : undefined;
    const incomingRedirectRaw = typeof body?.redirectUri === "string" ? body.redirectUri.trim() : undefined;
    const incomingFrontendRaw = typeof body?.frontendUrl === "string" ? body.frontendUrl.trim() : undefined;

    const nextClientId = (incomingClientIdRaw && incomingClientIdRaw !== "***") ? incomingClientIdRaw : String(current.clientId || "");
    const nextClientSecret = (incomingClientSecretRaw && incomingClientSecretRaw !== "***") ? incomingClientSecretRaw : String(current.clientSecret || "");

    return {
        clientId: encryptSettingValue(nextClientId),
        clientSecret: encryptSettingValue(nextClientSecret),
        redirectUri: incomingRedirectRaw !== undefined ? incomingRedirectRaw : String(current.redirectUri || ""),
        frontendUrl: incomingFrontendRaw !== undefined ? incomingFrontendRaw : String(current.frontendUrl || ""),
    };
}

function appSettingKeyForGroup(baseKey, groupId) {
    return Number.isInteger(groupId) && groupId > 0 ? `group:${groupId}:${baseKey}` : baseKey;
}

async function resolveScopedGroupForIntegrationSettings(req) {
    const requestedGroupId = parsePositiveInt(req.query?.groupId ?? req.body?.groupId);
    if (req.user.role === "admin") {
        return { groupId: requestedGroupId };
    }

    const adminGroups = await getAdminGroups(req.user.id);
    if (!adminGroups.length) {
        const err = new Error("Forbidden");
        err.statusCode = 403;
        throw err;
    }
    if (requestedGroupId) {
        if (!adminGroups.includes(requestedGroupId)) {
            const err = new Error("Forbidden");
            err.statusCode = 403;
            throw err;
        }
        return { groupId: requestedGroupId };
    }
    if (adminGroups.length === 1) {
        return { groupId: adminGroups[0] };
    }
    const err = new Error("group_id_required");
    err.statusCode = 400;
    throw err;
}

async function getAppSettingValueWithScopedFallback(baseKey, groupId) {
    const scopedKey = appSettingKeyForGroup(baseKey, groupId);
    const scopedRows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [scopedKey]);
    if (scopedRows.length) return scopedRows[0]?.value;
    if (!groupId) return null;
    const globalRows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [baseKey]);
    return globalRows[0]?.value || null;
}

function oauthConfigIsComplete(cfg) {
    return !!(
        String(cfg?.clientId || "").trim()
        && String(cfg?.clientSecret || "").trim()
        && String(cfg?.redirectUri || "").trim()
    );
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

async function runOauthCredentialsProbe(provider, cfg) {
    if (!oauthConfigIsComplete(cfg)) {
        return { ok: false, error: "oauth_not_configured" };
    }

    const redirectUri = String(cfg.redirectUri || "").trim();
    const clientId = String(cfg.clientId || "").trim();
    const clientSecret = String(cfg.clientSecret || "").trim();
    let tokenUrl = "";
    let body;
    let headers = { "Content-Type": "application/x-www-form-urlencoded" };

    if (provider === "google") {
        tokenUrl = "https://oauth2.googleapis.com/token";
        body = new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            code: "codex_probe_invalid_code",
            grant_type: "authorization_code",
            redirect_uri: redirectUri,
        });
    } else if (provider === "dropbox") {
        tokenUrl = "https://api.dropboxapi.com/oauth2/token";
        body = new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            code: "codex_probe_invalid_code",
            grant_type: "authorization_code",
            redirect_uri: redirectUri,
        });
    } else if (provider === "onedrive") {
        tokenUrl = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
        body = new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            code: "codex_probe_invalid_code",
            grant_type: "authorization_code",
            redirect_uri: redirectUri,
            scope: "offline_access User.Read Files.Read",
        });
    } else {
        return { ok: false, error: "unknown_provider" };
    }

    try {
        const res = await fetchWithTimeout(tokenUrl, {
            method: "POST",
            headers,
            body,
        });
        const text = await res.text();
        const lower = String(text || "").toLowerCase();
        if (res.ok) {
            return { ok: true, message: "oauth_probe_success" };
        }
        if (
            lower.includes("invalid_client")
            || lower.includes("unauthorized_client")
            || lower.includes("client authentication failed")
        ) {
            return { ok: false, error: "invalid_client_credentials" };
        }
        if (
            lower.includes("invalid_grant")
            || lower.includes("bad_verification_code")
            || lower.includes("authorization code")
            || lower.includes("invalid code")
        ) {
            return { ok: true, message: "oauth_credentials_valid_code_rejected" };
        }
        return { ok: false, error: "oauth_probe_failed", details: text.slice(0, 300) };
    } catch (err) {
        return { ok: false, error: "oauth_probe_network_error", details: String(err?.message || err) };
    }
}

export async function getGoogleOauthSetting(req, res) {
    try {
        const scope = await resolveScopedGroupForIntegrationSettings(req);
        const value = await getAppSettingValueWithScopedFallback("google_oauth", scope.groupId);
        const cfg = decryptOauthConfig(value || {});
        const clientId = String(cfg.clientId || "");
        const clientSecret = String(cfg.clientSecret || "");
        const redirectUri = String(cfg.redirectUri || "");
        const frontendUrl = String(cfg.frontendUrl || "");

        res.json({
            hasClientId: !!clientId,
            hasClientSecret: !!clientSecret,
            clientIdMasked: maskIfPresent(clientId),
            clientSecretMasked: maskIfPresent(clientSecret),
            redirectUri,
            frontendUrl,
            groupId: scope.groupId || null,
        });
    } catch (err) {
        res.status(err.statusCode || 403).json({ error: err.message || "Forbidden" });
    }
}

export async function setGoogleOauthSetting(req, res) {
    try {
        const scope = await resolveScopedGroupForIntegrationSettings(req);
        const key = appSettingKeyForGroup("google_oauth", scope.groupId);
        const currentRaw = await getAppSettingValueWithScopedFallback("google_oauth", scope.groupId);
        const current = decryptOauthConfig(currentRaw || {});
        const next = normalizeOauthConfigForSave(current, req.body);

        await query(
            `INSERT INTO app_settings (key, value, updated_at)
             VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
             ON CONFLICT (key)
             DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
            [key, JSON.stringify(next)]
        );

        res.json({
            success: true,
            hasClientId: !!decryptSettingValue(next.clientId),
            hasClientSecret: !!decryptSettingValue(next.clientSecret),
            clientIdMasked: maskIfPresent(decryptSettingValue(next.clientId)),
            clientSecretMasked: maskIfPresent(decryptSettingValue(next.clientSecret)),
            redirectUri: next.redirectUri,
            frontendUrl: next.frontendUrl,
            groupId: scope.groupId || null,
        });
    } catch (err) {
        res.status(err.statusCode || 403).json({ error: err.message || "Forbidden" });
    }
}

export async function getDropboxIntegrationSetting(req, res) {
    try {
        const scope = await resolveScopedGroupForIntegrationSettings(req);
        const value = await getAppSettingValueWithScopedFallback("dropbox_integration", scope.groupId);
        const enabled = value ? !!value?.enabled : true;
        res.json({ enabled, groupId: scope.groupId || null });
    } catch (err) {
        res.status(err.statusCode || 403).json({ error: err.message || "Forbidden" });
    }
}

export async function setDropboxIntegrationSetting(req, res) {
    try {
        const scope = await resolveScopedGroupForIntegrationSettings(req);
        const enabled = !!req.body?.enabled;
        const key = appSettingKeyForGroup("dropbox_integration", scope.groupId);
        await query(
            `INSERT INTO app_settings (key, value, updated_at)
             VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
             ON CONFLICT (key)
             DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
            [key, JSON.stringify({ enabled })]
        );
        res.json({ success: true, enabled, groupId: scope.groupId || null });
    } catch (err) {
        res.status(err.statusCode || 403).json({ error: err.message || "Forbidden" });
    }
}

export async function getDropboxOauthSetting(req, res) {
    try {
        const scope = await resolveScopedGroupForIntegrationSettings(req);
        const value = await getAppSettingValueWithScopedFallback("dropbox_oauth", scope.groupId);
        const cfg = decryptOauthConfig(value || {});
        const clientId = String(cfg.clientId || "");
        const clientSecret = String(cfg.clientSecret || "");
        const redirectUri = String(cfg.redirectUri || "");
        const frontendUrl = String(cfg.frontendUrl || "");

        res.json({
            hasClientId: !!clientId,
            hasClientSecret: !!clientSecret,
            clientIdMasked: maskIfPresent(clientId),
            clientSecretMasked: maskIfPresent(clientSecret),
            redirectUri,
            frontendUrl,
            groupId: scope.groupId || null,
        });
    } catch (err) {
        res.status(err.statusCode || 403).json({ error: err.message || "Forbidden" });
    }
}

export async function setDropboxOauthSetting(req, res) {
    try {
        const scope = await resolveScopedGroupForIntegrationSettings(req);
        const key = appSettingKeyForGroup("dropbox_oauth", scope.groupId);
        const currentRaw = await getAppSettingValueWithScopedFallback("dropbox_oauth", scope.groupId);
        const current = decryptOauthConfig(currentRaw || {});
        const next = normalizeOauthConfigForSave(current, req.body);

        await query(
            `INSERT INTO app_settings (key, value, updated_at)
             VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
             ON CONFLICT (key)
             DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
            [key, JSON.stringify(next)]
        );

        res.json({
            success: true,
            hasClientId: !!decryptSettingValue(next.clientId),
            hasClientSecret: !!decryptSettingValue(next.clientSecret),
            clientIdMasked: maskIfPresent(decryptSettingValue(next.clientId)),
            clientSecretMasked: maskIfPresent(decryptSettingValue(next.clientSecret)),
            redirectUri: next.redirectUri,
            frontendUrl: next.frontendUrl,
            groupId: scope.groupId || null,
        });
    } catch (err) {
        res.status(err.statusCode || 403).json({ error: err.message || "Forbidden" });
    }
}

export async function getOneDriveIntegrationSetting(req, res) {
    try {
        const scope = await resolveScopedGroupForIntegrationSettings(req);
        const value = await getAppSettingValueWithScopedFallback("onedrive_integration", scope.groupId);
        const enabled = value ? !!value?.enabled : true;
        res.json({ enabled, groupId: scope.groupId || null });
    } catch (err) {
        res.status(err.statusCode || 403).json({ error: err.message || "Forbidden" });
    }
}

export async function setOneDriveIntegrationSetting(req, res) {
    try {
        const scope = await resolveScopedGroupForIntegrationSettings(req);
        const enabled = !!req.body?.enabled;
        const key = appSettingKeyForGroup("onedrive_integration", scope.groupId);
        await query(
            `INSERT INTO app_settings (key, value, updated_at)
             VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
             ON CONFLICT (key)
             DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
            [key, JSON.stringify({ enabled })]
        );
        res.json({ success: true, enabled, groupId: scope.groupId || null });
    } catch (err) {
        res.status(err.statusCode || 403).json({ error: err.message || "Forbidden" });
    }
}

export async function getOneDriveOauthSetting(req, res) {
    try {
        const scope = await resolveScopedGroupForIntegrationSettings(req);
        const value = await getAppSettingValueWithScopedFallback("onedrive_oauth", scope.groupId);
        const cfg = decryptOauthConfig(value || {});
        const clientId = String(cfg.clientId || "");
        const clientSecret = String(cfg.clientSecret || "");
        const redirectUri = String(cfg.redirectUri || "");
        const frontendUrl = String(cfg.frontendUrl || "");

        res.json({
            hasClientId: !!clientId,
            hasClientSecret: !!clientSecret,
            clientIdMasked: maskIfPresent(clientId),
            clientSecretMasked: maskIfPresent(clientSecret),
            redirectUri,
            frontendUrl,
            groupId: scope.groupId || null,
        });
    } catch (err) {
        res.status(err.statusCode || 403).json({ error: err.message || "Forbidden" });
    }
}

export async function setOneDriveOauthSetting(req, res) {
    try {
        const scope = await resolveScopedGroupForIntegrationSettings(req);
        const key = appSettingKeyForGroup("onedrive_oauth", scope.groupId);
        const currentRaw = await getAppSettingValueWithScopedFallback("onedrive_oauth", scope.groupId);
        const current = decryptOauthConfig(currentRaw || {});
        const next = normalizeOauthConfigForSave(current, req.body);

        await query(
            `INSERT INTO app_settings (key, value, updated_at)
             VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
             ON CONFLICT (key)
             DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
            [key, JSON.stringify(next)]
        );

        res.json({
            success: true,
            hasClientId: !!decryptSettingValue(next.clientId),
            hasClientSecret: !!decryptSettingValue(next.clientSecret),
            clientIdMasked: maskIfPresent(decryptSettingValue(next.clientId)),
            clientSecretMasked: maskIfPresent(decryptSettingValue(next.clientSecret)),
            redirectUri: next.redirectUri,
            frontendUrl: next.frontendUrl,
            groupId: scope.groupId || null,
        });
    } catch (err) {
        res.status(err.statusCode || 403).json({ error: err.message || "Forbidden" });
    }
}

async function loadScopedDecryptedOauthConfig(req, baseKey) {
    const scope = await resolveScopedGroupForIntegrationSettings(req);
    const value = await getAppSettingValueWithScopedFallback(baseKey, scope.groupId);
    const cfg = decryptOauthConfig(value || {});
    return { scope, cfg };
}

export async function testGoogleOauthSetting(req, res) {
    try {
        const { scope, cfg } = await loadScopedDecryptedOauthConfig(req, "google_oauth");
        const result = await runOauthCredentialsProbe("google", cfg);
        if (!result.ok) return res.status(400).json({ ...result, groupId: scope.groupId || null });
        return res.json({ ...result, groupId: scope.groupId || null });
    } catch (err) {
        return res.status(err.statusCode || 403).json({ error: err.message || "Forbidden" });
    }
}

export async function testDropboxOauthSetting(req, res) {
    try {
        const { scope, cfg } = await loadScopedDecryptedOauthConfig(req, "dropbox_oauth");
        const result = await runOauthCredentialsProbe("dropbox", cfg);
        if (!result.ok) return res.status(400).json({ ...result, groupId: scope.groupId || null });
        return res.json({ ...result, groupId: scope.groupId || null });
    } catch (err) {
        return res.status(err.statusCode || 403).json({ error: err.message || "Forbidden" });
    }
}

export async function testOneDriveOauthSetting(req, res) {
    try {
        const { scope, cfg } = await loadScopedDecryptedOauthConfig(req, "onedrive_oauth");
        const result = await runOauthCredentialsProbe("onedrive", cfg);
        if (!result.ok) return res.status(400).json({ ...result, groupId: scope.groupId || null });
        return res.json({ ...result, groupId: scope.groupId || null });
    } catch (err) {
        return res.status(err.statusCode || 403).json({ error: err.message || "Forbidden" });
    }
}

function decryptSmtpConfig(raw) {
    const cfg = raw && typeof raw === "object" ? raw : {};
    return {
        host: String(cfg.host || ""),
        port: Number.parseInt(cfg.port, 10) || 587,
        secure: !!cfg.secure,
        username: String(cfg.username || ""),
        password: decryptSettingValue(String(cfg.password || "")),
        fromEmail: String(cfg.fromEmail || ""),
        fromName: String(cfg.fromName || ""),
    };
}

function normalizeSmtpConfigForSave(current, body) {
    const incomingPasswordRaw = typeof body?.password === "string" ? body.password.trim() : undefined;
    const nextPassword = (incomingPasswordRaw && incomingPasswordRaw !== "***")
        ? incomingPasswordRaw
        : String(current.password || "");
    const portCandidate = Number.parseInt(body?.port, 10);
    const safePort = Number.isInteger(portCandidate) && portCandidate > 0 ? portCandidate : Number(current.port || 587) || 587;

    return {
        host: typeof body?.host === "string" ? body.host.trim() : String(current.host || ""),
        port: safePort,
        secure: body?.secure === undefined ? !!current.secure : !!body.secure,
        username: typeof body?.username === "string" ? body.username.trim() : String(current.username || ""),
        password: encryptSettingValue(nextPassword),
        fromEmail: typeof body?.fromEmail === "string" ? body.fromEmail.trim() : String(current.fromEmail || ""),
        fromName: typeof body?.fromName === "string" ? body.fromName.trim() : String(current.fromName || ""),
    };
}

export async function getSmtpSetting(req, res) {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    const rows = await query("SELECT value FROM app_settings WHERE key = 'smtp_config' LIMIT 1", []);
    const cfg = decryptSmtpConfig(rows[0]?.value || {});
    res.json({
        hasPassword: !!String(cfg.password || "").trim(),
        passwordMasked: maskIfPresent(cfg.password),
        host: cfg.host,
        port: cfg.port,
        secure: cfg.secure,
        username: cfg.username,
        fromEmail: cfg.fromEmail,
        fromName: cfg.fromName,
    });
}

export async function setSmtpSetting(req, res) {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    const rows = await query("SELECT value FROM app_settings WHERE key = 'smtp_config' LIMIT 1", []);
    const current = decryptSmtpConfig(rows[0]?.value || {});
    const next = normalizeSmtpConfigForSave(current, req.body);
    await query(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ('smtp_config', $1::jsonb, CURRENT_TIMESTAMP)
         ON CONFLICT (key)
         DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
        [JSON.stringify(next)]
    );
    res.json({
        success: true,
        hasPassword: !!decryptSettingValue(next.password),
        passwordMasked: maskIfPresent(decryptSettingValue(next.password)),
        host: next.host,
        port: next.port,
        secure: next.secure,
        username: next.username,
        fromEmail: next.fromEmail,
        fromName: next.fromName,
    });
}

export async function getCustomerInvitationPolicy(req, res) {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    const policy = await loadInvitationPolicy();
    return res.json(policy);
}

export async function setCustomerInvitationPolicy(req, res) {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    const policy = await saveInvitationPolicy(req.body || {});
    await writeAuditLog({
        req,
        action: "customer_invitation.policy_updated",
        resourceType: "app_settings",
        resourceId: "customer_invitation_policy",
        metadata: policy,
    });
    return res.json({ success: true, ...policy });
}

function resolveSsoFeatureValue(entitlements) {
    const normalized = normalizeGroupEntitlements(entitlements || {});
    return normalized.features?.sso !== false;
}

export async function getSsoSetting(req, res) {
    try {
        const scope = await resolveScopedGroupForIntegrationSettings(req);
        if (!Number.isInteger(scope.groupId) || scope.groupId <= 0) {
            return res.status(400).json({ error: "group_id_required" });
        }
        const rows = await query("SELECT id, entitlements FROM groups WHERE id = $1 LIMIT 1", [scope.groupId]);
        if (!rows.length) return res.status(404).json({ error: "group_not_found" });
        return res.json({
            groupId: scope.groupId,
            enabled: resolveSsoFeatureValue(rows[0]?.entitlements || {}),
        });
    } catch (err) {
        return res.status(err.statusCode || 403).json({ error: err.message || "Forbidden" });
    }
}

export async function setSsoSetting(req, res) {
    try {
        const scope = await resolveScopedGroupForIntegrationSettings(req);
        if (!Number.isInteger(scope.groupId) || scope.groupId <= 0) {
            return res.status(400).json({ error: "group_id_required" });
        }
        const rows = await query("SELECT id, entitlements FROM groups WHERE id = $1 LIMIT 1", [scope.groupId]);
        if (!rows.length) return res.status(404).json({ error: "group_not_found" });
        const enabled = !!req.body?.enabled;
        const normalized = normalizeGroupEntitlements(rows[0]?.entitlements || {});
        const next = {
            ...normalized,
            features: {
                ...normalized.features,
                sso: enabled,
            },
        };
        await query("UPDATE groups SET entitlements = $2::jsonb WHERE id = $1", [scope.groupId, JSON.stringify(next)]);
        await writeAuditLog({
            req,
            action: "group.sso_feature_updated",
            resourceType: "group",
            resourceId: scope.groupId,
            metadata: { enabled },
        });
        return res.json({ success: true, groupId: scope.groupId, enabled });
    } catch (err) {
        return res.status(err.statusCode || 403).json({ error: err.message || "Forbidden" });
    }
}

// --- Groups ---

export async function listGroups(req, res) {
    const pagination = parsePagination(req.query, { maxLimit: 1000 });
    if (pagination.error) return res.status(400).json({ error: pagination.error });
    const pageTag = pagination.hasPagination ? `:l${pagination.limit}:o${pagination.offset}` : ":all";
    if (req.user.role === "admin") {
        const cacheKey = `listGroups:admin:${ENABLE_STORAGE_USAGE_METRICS ? "usage" : "lite"}${pageTag}`;
        const cached = getHeavyListCache(cacheKey);
        if (cached) return res.json(cached);
        let sql = `SELECT g.*, 0::bigint AS used_storage_bytes
                   FROM groups g
                   ORDER BY g.id ASC`;
        const params = [];
        if (pagination.hasPagination) {
            sql += ` LIMIT $1 OFFSET $2`;
            params.push(pagination.limit, pagination.offset);
        }
        const groups = await query(sql, params);
        setHeavyListCache(cacheKey, groups);
        return res.json(groups);
    }

    const adminGroups = await getAdminGroups(req.user.id);
    if (!adminGroups.length) return res.status(403).json({ error: "Forbidden" });
    const cacheKey = `listGroups:user:${req.user.id}:${[...adminGroups].sort((a, b) => a - b).join(",")}:${ENABLE_STORAGE_USAGE_METRICS ? "usage" : "lite"}${pageTag}`;
    const cached = getHeavyListCache(cacheKey);
    if (cached) return res.json(cached);

    const params = [adminGroups];
    let sql = `SELECT g.*, 0::bigint AS used_storage_bytes
               FROM groups g
               WHERE g.id = ANY($1::int[])
               ORDER BY g.id ASC`;
    if (pagination.hasPagination) {
        sql += ` LIMIT $2 OFFSET $3`;
        params.push(pagination.limit, pagination.offset);
    }
    const groups = await query(sql, params);
    setHeavyListCache(cacheKey, groups);
    return res.json(groups);
}

export async function createGroup(req, res) {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    const { name, maxFileSizeMb, maxTotalStorageMb } = req.body;
    const entitlements = parseEntitlementsInput(req.body?.entitlements);
    try {
        const r = await query(
            "INSERT INTO groups (name, max_file_size_mb, max_total_storage_mb, entitlements) VALUES ($1, $2, $3, $4::jsonb) RETURNING *",
            [name, maxFileSizeMb || 100, maxTotalStorageMb || 10240, JSON.stringify(entitlements || {})]
        );
        clearHeavyListCache();
        res.json(r[0]);
    } catch (e) {
        if (String(e).includes("unique")) return res.status(400).json({ error: "Name exists" });
        throw e;
    }
}

export async function updateGroup(req, res) {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    const { id } = req.params;
    const { name, maxFileSizeMb, maxTotalStorageMb } = req.body;
    const entitlements = parseEntitlementsInput(req.body?.entitlements);
    try {
        const r = await query(
            `UPDATE groups
                SET name = COALESCE($1, name),
                    max_file_size_mb = COALESCE($2, max_file_size_mb),
                    max_total_storage_mb = COALESCE($3, max_total_storage_mb),
                    entitlements = COALESCE($4::jsonb, entitlements)
              WHERE id = $5
              RETURNING *`,
            [name, maxFileSizeMb, maxTotalStorageMb, entitlements === undefined ? null : JSON.stringify(entitlements), id]
        );
        if (!r.length) return res.status(404).json({ error: "not_found" });
        clearHeavyListCache();
        res.json(r[0]);
    } catch (e) {
        if (String(e).includes("unique")) return res.status(400).json({ error: "Name exists" });
        throw e;
    }
}

export async function deleteGroup(req, res) {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    const { id } = req.params;
    const client = await getClient();
    try {
        await client.query("BEGIN");
        // Check for members
        const members = await client.query("SELECT 1 FROM user_groups WHERE group_id = $1 LIMIT 1", [id]);
        if (members.rows.length > 0) {
            await client.query("ROLLBACK");
            return res.status(400).json({ error: "group_not_empty", message: "Cannot delete customer with users. Remove all users first." });
        }
        
        // Cleanup dependencies that are not cascade-linked.
        await client.query("DELETE FROM group_permissions WHERE group_id = $1", [id]);
        await client.query("DELETE FROM view_group_permissions WHERE group_id = $1", [id]);
        
        const r = await client.query("DELETE FROM groups WHERE id = $1 RETURNING *", [id]);
        if (!r.rows.length) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "not_found" });
        }
        await client.query("COMMIT");
        clearHeavyListCache();
        res.json({ success: true });
    } catch (e) {
        await client.query("ROLLBACK");
        console.error("deleteGroup error:", e);
        res.status(500).json({ error: "internal_error" });
    } finally {
        client.release();
    }
}

export async function getGroupMembers(req, res) {
    const gid = parseInt(req.params.id, 10);
    if (req.user.role !== "admin") {
        const adminGroups = await getAdminGroups(req.user.id);
        if (!adminGroups.includes(gid)) return res.status(403).json({ error: "Forbidden" });
        try {
            await assertGroupCanManageUsers(gid);
        } catch (err) {
            return res.status(err.statusCode || 403).json({ error: err.message });
        }
    }
    const rows = await query(
        `SELECT u.id, u.email, u.role, ug.is_admin,
                CASE WHEN u.password IS NULL THEN 'google' ELSE 'manual' END AS auth_provider
         FROM user_groups ug
         JOIN users u ON u.id = ug.user_id
         WHERE ug.group_id=$1
         ORDER BY u.email ASC`,
        [gid]
    );
    res.json(rows);
}

export async function updateGroupMembers(req, res) {
    const gid = parseInt(req.params.id, 10);
    if (req.user.role !== "admin") {
        const adminGroups = await getAdminGroups(req.user.id);
        if (!adminGroups.includes(gid)) return res.status(403).json({ error: "Forbidden" });
        try {
            await assertGroupCanManageUsers(gid);
        } catch (err) {
            return res.status(err.statusCode || 403).json({ error: err.message });
        }
    }
    const { userIds } = req.body; // array
    if (!Array.isArray(userIds)) return res.status(400).json({ error: "invalid_format" });
    if (req.user.role !== "admin") {
        const group = await loadGroupForAdminAction(gid);
        const entitlements = normalizeGroupEntitlements(group?.entitlements || {});
        if (entitlements.maxUsers && userIds.length > entitlements.maxUsers) {
            return res.status(403).json({ error: "group_user_limit_exceeded", maxUsers: entitlements.maxUsers });
        }
    }

    // H9: wrap in transaction to eliminate DELETE+INSERT race condition
    const client = await getClient();
    try {
        await client.query("BEGIN");
        // Delete members NOT in the new list (preserves existing users' flags)
        await client.query("DELETE FROM user_groups WHERE group_id=$1 AND NOT (user_id = ANY($2::int[]))", [gid, userIds]);
        
        // Insert new members in one statement (avoids N+1 query overhead)
        if (userIds.length > 0) {
            await client.query(
                `INSERT INTO user_groups (group_id, user_id)
                 SELECT $1, uid
                 FROM unnest($2::int[]) AS uid
                 ON CONFLICT (user_id, group_id) DO NOTHING`,
                [gid, userIds]
            );
        }
        await client.query("COMMIT");
        clearHeavyListCache();
        res.json({ success: true });
    } catch (e) {
        await client.query("ROLLBACK");
        console.error("updateGroupMembers failed:", e);
        res.status(500).json({ error: "update_group_members_failed" });
    } finally {
        client.release();
    }
}

export async function addUserToGroup(req, res) {
    const gid = parseInt(req.params.id, 10);
    const userId = Number.parseInt(req.body?.userId, 10);
    if (!Number.isInteger(gid) || !Number.isInteger(userId)) return res.status(400).json({ error: "invalid_group_or_user_id" });
    if (req.user.role !== "admin") {
        const adminGroups = await getAdminGroups(req.user.id);
        if (!adminGroups.includes(gid)) return res.status(403).json({ error: "Forbidden" });
        try {
            const existing = await query("SELECT 1 FROM user_groups WHERE group_id = $1 AND user_id = $2", [gid, userId]);
            if (!existing.length) await assertGroupUserLimitAvailable(gid, 1);
            else await assertGroupCanManageUsers(gid);
        } catch (err) {
            return res.status(err.statusCode || 403).json({ error: err.message, ...(err.details || {}) });
        }
    }
    await query("INSERT INTO user_groups (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [gid, userId]);
    clearHeavyListCache();
    res.json({ success: true });
}

export async function removeUserFromGroup(req, res) {
    const gid = parseInt(req.params.id, 10);
    if (req.user.role !== "admin") {
        const adminGroups = await getAdminGroups(req.user.id);
        if (!adminGroups.includes(gid)) return res.status(403).json({ error: "Forbidden" });
        try {
            await assertGroupCanManageUsers(gid);
        } catch (err) {
            return res.status(err.statusCode || 403).json({ error: err.message });
        }
    }
    const { userId } = req.params;
    await query("DELETE FROM user_groups WHERE group_id=$1 AND user_id=$2", [gid, userId]);
    clearHeavyListCache();
    res.json({ success: true });
}

export async function toggleGroupAdmin(req, res) {
    const { id: gid, userId } = req.params;
    const { isAdmin } = req.body;

    try {
        if (req.user.role !== "admin") {
            const adminGroups = await getAdminGroups(req.user.id);
            if (!adminGroups.includes(Number(gid))) return res.status(403).json({ error: "Forbidden" });
            const group = await loadGroupForAdminAction(gid);
            if (!groupHasFeature(group, "manageGroupAdmins")) {
                return res.status(403).json({ error: "feature_not_enabled:manageGroupAdmins" });
            }
        }

        await query(
            "UPDATE user_groups SET is_admin = $1 WHERE group_id = $2 AND user_id = $3",
            [!!isAdmin, gid, userId]
        );
        clearHeavyListCache();
        res.json({ success: true });
    } catch (e) {
        console.error("toggleGroupAdmin error:", e);
        res.status(500).json({ error: "internal_error" });
    }
}

export async function getGroupSheets(req, res) {
    const gid = parseInt(req.params.id, 10);
    if (req.user.role !== "admin") {
        const adminGroups = await getAdminGroups(req.user.id);
        if (!adminGroups.includes(gid)) return res.status(403).json({ error: "Forbidden" });
    }
    const rows = await query(
        `SELECT DISTINCT s.id, s.filename, s.display_name, s.uploaded_at,
                s.report_source_id, rs.name AS report_source_name
         FROM sheets s
         LEFT JOIN report_sources rs ON rs.id = s.report_source_id
         LEFT JOIN group_permissions gp ON gp.sheet_id = s.id AND gp.group_id = $1
         WHERE (
            gp.group_id IS NOT NULL
            OR EXISTS (
                SELECT 1
                FROM user_groups ug
                WHERE ug.group_id = $1
                  AND ug.user_id = rs.created_by
            )
         )
         ORDER BY s.uploaded_at DESC`,
        [gid]
    );
    res.json(rows);
}

// --- Permissions ---

async function resolveReportSourceCurrentSheet(reportSourceId) {
    const sourceId = Number.parseInt(reportSourceId, 10);
    if (!Number.isInteger(sourceId) || sourceId <= 0) {
        return { error: "invalid_report_source_id" };
    }

    const rows = await query(
        "SELECT id, current_sheet_id FROM report_sources WHERE id = $1",
        [sourceId]
    );
    if (!rows.length) return { error: "report_source_not_found", status: 404 };
    if (!rows[0].current_sheet_id) return { error: "report_source_has_no_current_sheet", status: 400 };
    return { reportSourceId: rows[0].id, sheetId: rows[0].current_sheet_id };
}

export async function setPermissions(req, res) {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    const { userId, sheetId, allowed, rowFilters } = req.body;

    await query(
        `INSERT INTO permissions (user_id, sheet_id, allowed_columns, row_filters)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (sheet_id, user_id)
         DO UPDATE SET allowed_columns=$3, row_filters=$4`,
        [userId, sheetId, JSON.stringify(allowed || []), JSON.stringify(rowFilters || [])]
    );
    await writeAuditLog({
        req,
        action: "permission.user_sheet_set",
        resourceType: "sheet",
        resourceId: sheetId,
        metadata: { target_user_id: userId, allowed_columns: Array.isArray(allowed) ? allowed.length : 0 },
    });
    res.json({ success: true });
}

export async function getPermissions(req, res) {
    // Admin only for editing
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    const { userId, sheetId } = req.query;
    const rows = await query("SELECT * FROM permissions WHERE user_id=$1 AND sheet_id=$2", [userId, sheetId]);
    if (!rows.length) return res.json({});
    res.json(rows[0]);
}

export async function setReportSourcePermissions(req, res) {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    const { userId, reportSourceId, allowed, rowFilters } = req.body;
    const resolved = await resolveReportSourceCurrentSheet(reportSourceId);
    if (resolved.error) return res.status(resolved.status || 400).json({ error: resolved.error });

    await query(
        `INSERT INTO permissions (user_id, sheet_id, allowed_columns, row_filters)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (sheet_id, user_id)
         DO UPDATE SET allowed_columns=$3, row_filters=$4`,
        [userId, resolved.sheetId, JSON.stringify(allowed || []), JSON.stringify(rowFilters || [])]
    );
    await writeAuditLog({
        req,
        action: "permission.user_report_source_set",
        resourceType: "report_source",
        resourceId: resolved.reportSourceId,
        metadata: { target_user_id: userId, sheet_id: resolved.sheetId, allowed_columns: Array.isArray(allowed) ? allowed.length : 0 },
    });
    res.json({ success: true, report_source_id: resolved.reportSourceId, sheet_id: resolved.sheetId });
}

export async function getReportSourcePermissions(req, res) {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    const { userId, reportSourceId } = req.query;
    const resolved = await resolveReportSourceCurrentSheet(reportSourceId);
    if (resolved.error) return res.status(resolved.status || 400).json({ error: resolved.error });

    const rows = await query("SELECT * FROM permissions WHERE user_id=$1 AND sheet_id=$2", [userId, resolved.sheetId]);
    if (!rows.length) return res.json({ report_source_id: resolved.reportSourceId, sheet_id: resolved.sheetId });
    res.json({ ...rows[0], report_source_id: resolved.reportSourceId, sheet_id: resolved.sheetId });
}

export async function setGroupPermissions(req, res) {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    const { groupId, sheetId, allowed, rowFilters } = req.body;

    await query(
        `INSERT INTO group_permissions (group_id, sheet_id, allowed_columns, row_filters)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (sheet_id, group_id)
         DO UPDATE SET allowed_columns=$3, row_filters=$4`,
        [groupId, sheetId, JSON.stringify(allowed || []), JSON.stringify(rowFilters || [])]
    );
    await writeAuditLog({
        req,
        action: "permission.group_sheet_set",
        resourceType: "sheet",
        resourceId: sheetId,
        metadata: { target_group_id: groupId, allowed_columns: Array.isArray(allowed) ? allowed.length : 0 },
    });
    res.json({ success: true });
}

export async function getGroupPermissions(req, res) {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    const { groupId, sheetId } = req.query;
    const rows = await query("SELECT * FROM group_permissions WHERE group_id=$1 AND sheet_id=$2", [groupId, sheetId]);
    if (!rows.length) return res.json({});
    res.json(rows[0]);
}

export async function setReportSourceGroupPermissions(req, res) {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    const { groupId, reportSourceId, allowed, rowFilters } = req.body;
    const resolved = await resolveReportSourceCurrentSheet(reportSourceId);
    if (resolved.error) return res.status(resolved.status || 400).json({ error: resolved.error });

    await query(
        `INSERT INTO group_permissions (group_id, sheet_id, allowed_columns, row_filters)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (sheet_id, group_id)
         DO UPDATE SET allowed_columns=$3, row_filters=$4`,
        [groupId, resolved.sheetId, JSON.stringify(allowed || []), JSON.stringify(rowFilters || [])]
    );
    await writeAuditLog({
        req,
        action: "permission.group_report_source_set",
        resourceType: "report_source",
        resourceId: resolved.reportSourceId,
        metadata: { target_group_id: groupId, sheet_id: resolved.sheetId, allowed_columns: Array.isArray(allowed) ? allowed.length : 0 },
    });
    res.json({ success: true, report_source_id: resolved.reportSourceId, sheet_id: resolved.sheetId });
}

export async function getReportSourceGroupPermissions(req, res) {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    const { groupId, reportSourceId } = req.query;
    const resolved = await resolveReportSourceCurrentSheet(reportSourceId);
    if (resolved.error) return res.status(resolved.status || 400).json({ error: resolved.error });

    const rows = await query("SELECT * FROM group_permissions WHERE group_id=$1 AND sheet_id=$2", [groupId, resolved.sheetId]);
    if (!rows.length) return res.json({ report_source_id: resolved.reportSourceId, sheet_id: resolved.sheetId });
    res.json({ ...rows[0], report_source_id: resolved.reportSourceId, sheet_id: resolved.sheetId });
}

export async function getUserKpiOverrides(req, res) {
    const sheetSignature = String(req.query?.sheetSignature || "").trim();
    if (!sheetSignature) return res.status(400).json({ error: "sheet_signature_required" });
    const key = `kpi_overrides:user:${req.user.id}:sheet:${sheetSignature}`;
    const rows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [key]);
    const value = rows?.[0]?.value;
    return res.json({ ok: true, key, value: value && typeof value === "object" ? value : {} });
}

export async function setUserKpiOverrides(req, res) {
    const sheetSignature = String(req.body?.sheetSignature || "").trim();
    const value = req.body?.value;
    if (!sheetSignature) return res.status(400).json({ error: "sheet_signature_required" });
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return res.status(400).json({ error: "invalid_value" });
    }
    const key = `kpi_overrides:user:${req.user.id}:sheet:${sheetSignature}`;
    await query(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
         ON CONFLICT (key)
         DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
        [key, JSON.stringify(value)]
    );
    return res.json({ ok: true, key });
}
