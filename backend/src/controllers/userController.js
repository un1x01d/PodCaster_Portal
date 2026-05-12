import {
    query,
    getClient,
    isTenantDbIsolationEnabled,
    provisionCustomerDatabase,
    removeCustomerPrincipalFromTenant,
    syncCustomerGroupToTenant,
    syncCustomerPrincipalToTenant,
} from "../config/db.js";
import { hashPassword, generateComplexPassword } from "../utils/security.js";
import { decryptSettingValue, encryptSettingValue } from "../utils/settingsCrypto.js";
import { parsePagination } from "../utils/pagination.js";
import { writeAuditLog } from "../utils/auditLog.js";
import { normalizeGroupEntitlements, groupHasFeature } from "../utils/entitlements.js";
import { sendInvitationEmail, loadInviteEmailTemplate, normalizeInviteEmailTemplateForSave, renderInviteTemplate } from "../utils/smtpMailer.js";
import { loadInvitationPolicy, saveInvitationPolicy, computeInvitationExpiryDate } from "../utils/invitationLifecycle.js";
import { DLP_SETTINGS_KEY, normalizeDlpSettings } from "../utils/dlp.js";
import { isPlatformAdminUser, resolveUserAccessContext } from "../utils/authorization.js";
import { normalize2faDigits, normalize2faPeriod } from "../utils/twoFactor.js";
import { AI_FEATURE_TOGGLES_SETTINGS_KEY, normalizeAiFeatureToggles, resolveEffectiveAiFeaturesForUser } from "../utils/aiFeatureToggles.js";
import { loadAiRuntimeSettings, saveAiRuntimeSettings } from "../utils/aiRuntimeSettings.js";
import { fetchOpenAiOrganizationUsageSummary, normalizeUsagePeriodMonth } from "../utils/openAiUsage.js";
import { invalidateLearningRulesCache } from "../services/ai/semanticKnowledgeService.js";
import { normalizeText } from "../services/ai/accountingGlossary.js";
import { randomBytes, createHash } from "crypto";

const EXPOSE_TEMP_PASSWORDS = process.env.EXPOSE_TEMP_PASSWORDS
    ? process.env.EXPOSE_TEMP_PASSWORDS === "true"
    : process.env.NODE_ENV !== "production";
const ALLOWED_ROLES = new Set(["admin", "user"]);
const HEAVY_LIST_CACHE = new Map();
const HEAVY_LIST_CACHE_TTL_MS = Number.parseInt(process.env.HEAVY_LIST_CACHE_TTL_MS || "20000", 10);
const HEAVY_LIST_CACHE_MAX = Number.parseInt(process.env.HEAVY_LIST_CACHE_MAX || "200", 10);
const GROUPS_LIST_CACHE_ENABLED = String(process.env.GROUPS_LIST_CACHE_ENABLED || "false").trim().toLowerCase() === "true";
const ENABLE_STORAGE_USAGE_METRICS = String(process.env.ENABLE_STORAGE_USAGE_METRICS || "").toLowerCase() === "true";
const CUSTOMER_INVITE_BASE_URL = String(process.env.CUSTOMER_INVITE_BASE_URL || "").trim();
const INSIGHT_TRANSLATION_CACHE_SETTINGS_KEY = "insight_translation_cache_settings";
const AUTOSYNC_POLL_INTERVAL_SETTINGS_KEY = "autosync_poll_interval_settings";
export const REVISION_COMPARE_SETTINGS_KEY = "revision_compare_settings";
const METRICS_EXPOSURE_SETTINGS_KEY = "metrics_exposure_settings";
const EMAIL_INGEST_SETTINGS_KEY = "email_ingest_settings";
const EMAIL_INGEST_ALLOWLIST_KEY = "email_ingest_allowlist";
const IMPORT_PIPELINE_SETTINGS_KEY = "import_pipeline_settings";
const TWO_FACTOR_TOTP_SETTINGS_KEY = "two_factor_totp_settings";
const SMS_OTP_CONFIG_KEY = "sms_otp_config";
const AI_SELF_LEARNING_SETTINGS_KEY = "ai_self_learning_settings";
const RAW_INSIGHT_TRANSLATION_CACHE_TTL_MS = Number.parseInt(
    process.env.INSIGHT_TRANSLATION_CACHE_TTL_MS || `${60 * 60 * 1000}`,
    10
);
const DEFAULT_INSIGHT_TRANSLATION_CACHE_TTL_MINUTES = Number.isFinite(RAW_INSIGHT_TRANSLATION_CACHE_TTL_MS)
    ? Math.max(1, Math.round(RAW_INSIGHT_TRANSLATION_CACHE_TTL_MS / (60 * 1000)))
    : 60;
const DEFAULT_TOTP_ISSUER = String(process.env.TWO_FACTOR_TOTP_ISSUER || "TFORN Insights").trim() || "TFORN Insights";
const DEFAULT_TOTP_DIGITS = normalize2faDigits(process.env.TWO_FACTOR_TOTP_DIGITS || 6, 6);
const DEFAULT_TOTP_PERIOD = normalize2faPeriod(process.env.TWO_FACTOR_TOTP_PERIOD || 30, 30);
const REVISION_COMPARE_MAX_ROWS_CAP = 100000;
const DEFAULT_REVISION_COMPARE_MAX_ROWS = Math.min(
    REVISION_COMPARE_MAX_ROWS_CAP,
    Math.max(1000, Number.parseInt(process.env.REVISION_COMPARE_MAX_ROWS || "100000", 10) || 100000)
);

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
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
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
    const cursorRaw = String(req.query?.cursor || "").trim();
    let cursor = null;
    if (cursorRaw) {
        try { cursor = JSON.parse(Buffer.from(cursorRaw, "base64url").toString("utf8")); } catch { cursor = null; }
    }
    if (cursor?.createdAt && Number.isInteger(Number(cursor?.id))) {
        params.push(String(cursor.createdAt), Number(cursor.id));
        clauses.push(`(al.created_at < $${params.length - 1}::timestamp OR (al.created_at = $${params.length - 1}::timestamp AND al.id < $${params.length}))`);
    }
    const whereFinal = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = pagination.hasPagination ? pagination.limit : 100;
    params.push(limit + 1);
    const rows = await query(
        `SELECT al.id, al.actor_user_id, u.email AS actor_email, al.action, al.resource_type,
                al.resource_id, al.request_id, al.ip, al.user_agent, al.metadata, al.created_at
           FROM audit_logs al
           LEFT JOIN users u ON u.id = al.actor_user_id
          ${whereFinal}
          ORDER BY al.created_at DESC, al.id DESC
          LIMIT $${params.length}`,
        params
    );
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items[items.length - 1];
    const nextCursor = hasMore && last
        ? Buffer.from(JSON.stringify({ createdAt: last.created_at, id: last.id }), "utf8").toString("base64url")
        : null;
    res.set("X-Next-Cursor", nextCursor || "");
    res.set("X-Has-More", hasMore ? "1" : "0");
    if (String(req.query?.cursor_mode || "").toLowerCase() === "body") {
        return res.json({ items, nextCursor, hasMore });
    }
    return res.json(items);
}

export async function getAiUsageSummary(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    const periodMonth = normalizeUsagePeriodMonth(req.query?.periodMonth);
    const rows = await query(
        `SELECT g.id AS group_id,
                g.name AS group_name,
                $1::text AS period_month,
                COALESCE(a.query_count, 0) AS query_count,
                COALESCE(a.prompt_tokens, 0) AS prompt_tokens,
                COALESCE(a.completion_tokens, 0) AS completion_tokens,
                COALESCE(a.estimated_cost_usd, 0) AS estimated_cost_usd,
                a.provider,
                a.model,
                a.updated_at
           FROM groups g
           LEFT JOIN ai_usage_monthly a
                  ON a.group_id = g.id
                 AND a.period_month = $1
          ORDER BY COALESCE(a.estimated_cost_usd, 0) DESC,
                   COALESCE(a.query_count, 0) DESC,
                   g.name ASC`,
        [periodMonth]
    );
    const appTotals = rows.reduce((acc, row) => {
        acc.queryCount += Number(row.query_count || 0);
        acc.promptTokens += Number(row.prompt_tokens || 0);
        acc.completionTokens += Number(row.completion_tokens || 0);
        acc.estimatedCostUsd += Number(row.estimated_cost_usd || 0);
        return acc;
    }, { queryCount: 0, promptTokens: 0, completionTokens: 0, estimatedCostUsd: 0 });
    let openAiUsage = null;
    let openAiError = null;
    let openAiErrorCode = null;
    try {
        openAiUsage = await fetchOpenAiOrganizationUsageSummary(periodMonth);
    } catch (err) {
        openAiError = err?.message || "openai_usage_unavailable";
        openAiErrorCode = err?.code || "openai_usage_unavailable";
    }
    return res.json({
        periodMonth,
        source: openAiUsage ? "openai" : "app_local",
        totals: {
            queryCount: Number(appTotals.queryCount || 0),
            promptTokens: Number(appTotals.promptTokens || 0),
            completionTokens: Number(appTotals.completionTokens || 0),
            actualCostUsd: openAiUsage ? Number(openAiUsage.costUsd || 0) : null,
            estimatedCostUsd: Number(appTotals.estimatedCostUsd.toFixed(6)),
            currency: openAiUsage?.currency || "usd",
            inputCachedTokens: Number(openAiUsage?.inputCachedTokens || 0),
            inputAudioTokens: Number(openAiUsage?.inputAudioTokens || 0),
            outputAudioTokens: Number(openAiUsage?.outputAudioTokens || 0),
            audioSpeechCharacters: Number(openAiUsage?.audioSpeechCharacters || 0),
        },
        openAi: openAiUsage ? {
            source: "openai",
            actualCostUsd: Number(openAiUsage.costUsd || 0),
            currency: openAiUsage.currency || "usd",
            lineItems: Array.isArray(openAiUsage.lineItems) ? openAiUsage.lineItems : [],
            partialErrors: Array.isArray(openAiUsage.partialErrors) ? openAiUsage.partialErrors : [],
        } : {
            source: "unavailable",
            code: openAiErrorCode,
            error: openAiError,
        },
        appLocal: {
            source: "app_local",
            queryCount: appTotals.queryCount,
            promptTokens: appTotals.promptTokens,
            completionTokens: appTotals.completionTokens,
            estimatedCostUsd: Number(appTotals.estimatedCostUsd.toFixed(6)),
        },
        groups: rows.map((row) => ({
            groupId: Number(row.group_id),
            groupName: row.group_name,
            queryCount: Number(row.query_count || 0),
            promptTokens: Number(row.prompt_tokens || 0),
            completionTokens: Number(row.completion_tokens || 0),
            estimatedCostUsd: Number(Number(row.estimated_cost_usd || 0).toFixed(6)),
            provider: row.provider || "openai",
            model: row.model || null,
            updatedAt: row.updated_at,
        })),
    });
}

async function getAdminGroups(userId) {
    const access = await resolveUserAccessContext({ id: userId });
    return access.managedGroupIds;
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

async function assertGroupAllowsUserManagementForAnyActor(groupId) {
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
    const isGlobalAdmin = isPlatformAdminUser(req.user);
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
    const isGlobalAdmin = isPlatformAdminUser(req.user);
    const pagination = parsePagination(req.query, { maxLimit: 1000 });
    if (pagination.error) return res.status(400).json({ error: pagination.error });
    try {
        if (isGlobalAdmin) {
            const totalRows = await query("SELECT COUNT(*)::int AS c FROM users", []);
            const total = Number(totalRows[0]?.c || 0);
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
            res.set("X-Total-Count", String(total));
            res.set("X-Limit", String(pagination.limit));
            res.set("X-Offset", String(pagination.offset));
            return res.json(users);
    } else {
        const adminGroups = await getAdminGroups(req.user.id);
        if (!adminGroups.length) return res.status(403).json({ error: "Forbidden" });
        try {
            await assertGroupsCanManageUsers(adminGroups);
        } catch (err) {
            return res.status(err.statusCode || 403).json({ error: err.message });
        }
        const totalRows = await query(
            `SELECT COUNT(DISTINCT u.id)::int AS c
             FROM users u
             JOIN user_groups ug ON u.id = ug.user_id
             WHERE ug.group_id = ANY($1::int[])`,
            [adminGroups]
        );
        const total = Number(totalRows[0]?.c || 0);

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
            res.set("X-Total-Count", String(total));
            res.set("X-Limit", String(pagination.limit));
            res.set("X-Offset", String(pagination.offset));
            return res.json(users);
        }
    } catch (e) {
        console.error("listUsers error:", e);
        res.status(500).json({ error: "user_create_failed", details: { message: String(e?.message || "user_create_failed") } });
    }
}

export async function createUser(req, res) {
    const isGlobalAdmin = isPlatformAdminUser(req.user);
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
        res.status(500).json({ error: "users_list_failed", details: { message: String(e?.message || "users_list_failed") } });
    }
}

export async function inviteCustomerUser(req, res) {
    const isGlobalAdmin = isPlatformAdminUser(req.user);
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
    const isGlobalAdmin = isPlatformAdminUser(req.user);
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
    const isGlobalAdmin = isPlatformAdminUser(req.user);
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
    const isGlobalAdmin = isPlatformAdminUser(req.user);

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
    
    const isGlobalAdmin = isPlatformAdminUser(req.user);
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
        res.status(500).json({ error: "user_update_failed", details: { message: String(e?.message || "user_update_failed") } });
    }
}

export async function deleteUser(req, res) {
    const { id } = req.params;
    const isGlobalAdmin = isPlatformAdminUser(req.user);
    
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
        res.status(500).json({ error: "user_delete_failed", details: { message: String(e?.message || "user_delete_failed") } });
    }
}

export async function setDefaultView(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
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
        assertAllowedKeys(req.body || {}, ["enabled", "groupId"]);
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

function decryptQuickbooksOauthConfig(raw) {
    const cfg = raw && typeof raw === "object" ? raw : {};
    const base = decryptOauthConfig(cfg);
    const environment = String(cfg.environment || "production").trim().toLowerCase() === "sandbox" ? "sandbox" : "production";
    const companyId = String(cfg.companyId || "").trim();
    const selectedDataTypes = Array.isArray(cfg.selectedDataTypes)
        ? cfg.selectedDataTypes.map((v) => String(v || "").trim()).filter(Boolean)
        : [];
    return {
        ...base,
        environment,
        companyId,
        selectedDataTypes,
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

function normalizeQuickbooksOauthConfigForSave(current, body) {
    const base = normalizeOauthConfigForSave(current, body);
    const incomingEnvironment = String(body?.environment || current.environment || "production").trim().toLowerCase();
    const environment = incomingEnvironment === "sandbox" ? "sandbox" : "production";
    const companyId = typeof body?.companyId === "string" ? body.companyId.trim() : String(current.companyId || "");
    const selectedDataTypes = Array.isArray(body?.selectedDataTypes)
        ? body.selectedDataTypes.map((v) => String(v || "").trim()).filter(Boolean).slice(0, 25)
        : (Array.isArray(current.selectedDataTypes) ? current.selectedDataTypes : []);
    return {
        ...base,
        environment,
        companyId,
        selectedDataTypes,
    };
}

export function appSettingKeyForGroup(baseKey, groupId) {
    return Number.isInteger(groupId) && groupId > 0 ? `group:${groupId}:${baseKey}` : baseKey;
}

export async function resolveScopedGroupForIntegrationSettings(req) {
    const requestedGroupId = parsePositiveInt(req.query?.groupId ?? req.body?.groupId);
    if (isPlatformAdminUser(req.user)) {
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

export async function getAppSettingValueWithScopedFallback(baseKey, groupId) {
    const scopedKey = appSettingKeyForGroup(baseKey, groupId);
    const scopedRows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [scopedKey]);
    if (scopedRows.length) return scopedRows[0]?.value;
    return null;
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
    } else if (provider === "quickbooks") {
        tokenUrl = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
        body = new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            code: "codex_probe_invalid_code",
            grant_type: "authorization_code",
            redirect_uri: redirectUri,
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
        assertAllowedKeys(req.body || {}, ["clientId", "clientSecret", "redirectUri", "frontendUrl", "groupId"]);
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
        assertAllowedKeys(req.body || {}, ["enabled", "groupId"]);
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
        assertAllowedKeys(req.body || {}, ["clientId", "clientSecret", "redirectUri", "frontendUrl", "groupId"]);
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

export async function getQuickbooksIntegrationSetting(req, res) {
    try {
        const scope = await resolveScopedGroupForIntegrationSettings(req);
        const value = await getAppSettingValueWithScopedFallback("quickbooks_integration", scope.groupId);
        const enabled = value ? !!value?.enabled : true;
        res.json({ enabled, groupId: scope.groupId || null });
    } catch (err) {
        res.status(err.statusCode || 403).json({ error: err.message || "Forbidden" });
    }
}

export async function setQuickbooksIntegrationSetting(req, res) {
    try {
        assertAllowedKeys(req.body || {}, ["enabled", "groupId"]);
        const scope = await resolveScopedGroupForIntegrationSettings(req);
        const enabled = !!req.body?.enabled;
        const key = appSettingKeyForGroup("quickbooks_integration", scope.groupId);
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

export async function setOneDriveIntegrationSetting(req, res) {
    try {
        assertAllowedKeys(req.body || {}, ["enabled", "groupId"]);
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
        assertAllowedKeys(req.body || {}, ["clientId", "clientSecret", "redirectUri", "frontendUrl", "groupId"]);
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

export async function getQuickbooksOauthSetting(req, res) {
    try {
        const scope = await resolveScopedGroupForIntegrationSettings(req);
        const value = await getAppSettingValueWithScopedFallback("quickbooks_oauth", scope.groupId);
        const cfg = decryptQuickbooksOauthConfig(value || {});
        const clientId = String(cfg.clientId || "");
        const clientSecret = String(cfg.clientSecret || "");
        const redirectUri = String(cfg.redirectUri || "");
        const frontendUrl = String(cfg.frontendUrl || "");
        const environment = String(cfg.environment || "production");
        const companyId = String(cfg.companyId || "");
        const selectedDataTypes = Array.isArray(cfg.selectedDataTypes) ? cfg.selectedDataTypes : [];

        res.json({
            hasClientId: !!clientId,
            hasClientSecret: !!clientSecret,
            clientIdMasked: maskIfPresent(clientId),
            clientSecretMasked: maskIfPresent(clientSecret),
            redirectUri,
            frontendUrl,
            environment,
            companyId,
            selectedDataTypes,
            groupId: scope.groupId || null,
        });
    } catch (err) {
        res.status(err.statusCode || 403).json({ error: err.message || "Forbidden" });
    }
}

export async function setQuickbooksOauthSetting(req, res) {
    try {
        assertAllowedKeys(req.body || {}, ["clientId", "clientSecret", "redirectUri", "frontendUrl", "environment", "companyId", "selectedDataTypes", "groupId"]);
        const scope = await resolveScopedGroupForIntegrationSettings(req);
        const key = appSettingKeyForGroup("quickbooks_oauth", scope.groupId);
        const currentRaw = await getAppSettingValueWithScopedFallback("quickbooks_oauth", scope.groupId);
        const current = decryptQuickbooksOauthConfig(currentRaw || {});
        const next = normalizeQuickbooksOauthConfigForSave(current, req.body);

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
            environment: next.environment || "production",
            companyId: next.companyId || "",
            selectedDataTypes: Array.isArray(next.selectedDataTypes) ? next.selectedDataTypes : [],
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

export async function testQuickbooksOauthSetting(req, res) {
    try {
        const { scope, cfg } = await loadScopedDecryptedOauthConfig(req, "quickbooks_oauth");
        const result = await runOauthCredentialsProbe("quickbooks", cfg);
        if (!result.ok) return res.status(400).json({ ...result, groupId: scope.groupId || null });
        return res.json({ ...result, groupId: scope.groupId || null });
    } catch (err) {
        return res.status(err.statusCode || 403).json({ error: err.message || "Forbidden" });
    }
}

function decryptSamlSsoConfig(raw) {
    const cfg = raw && typeof raw === "object" ? raw : {};
    return {
        idpSsoUrl: String(cfg.idpSsoUrl || "").trim(),
        idpEntityId: String(cfg.idpEntityId || "").trim(),
        spEntityId: String(cfg.spEntityId || "").trim(),
        acsUrl: String(cfg.acsUrl || "").trim(),
        nameIdFormat: String(cfg.nameIdFormat || "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress").trim(),
        x509Certificate: String(cfg.x509Certificate || "").trim(),
        defaultRelayState: String(cfg.defaultRelayState || "").trim(),
    };
}

function normalizeSamlSsoConfigForSave(current, body) {
    const next = {
        idpSsoUrl: typeof body?.idpSsoUrl === "string" ? body.idpSsoUrl.trim() : String(current.idpSsoUrl || ""),
        idpEntityId: typeof body?.idpEntityId === "string" ? body.idpEntityId.trim() : String(current.idpEntityId || ""),
        spEntityId: typeof body?.spEntityId === "string" ? body.spEntityId.trim() : String(current.spEntityId || ""),
        acsUrl: typeof body?.acsUrl === "string" ? body.acsUrl.trim() : String(current.acsUrl || ""),
        nameIdFormat: typeof body?.nameIdFormat === "string" && body.nameIdFormat.trim()
            ? body.nameIdFormat.trim()
            : String(current.nameIdFormat || "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress"),
        x509Certificate: typeof body?.x509Certificate === "string" ? body.x509Certificate.trim() : String(current.x509Certificate || ""),
        defaultRelayState: typeof body?.defaultRelayState === "string" ? body.defaultRelayState.trim() : String(current.defaultRelayState || ""),
    };
    return next;
}

function isValidHttpUrl(value) {
    try {
        const u = new URL(String(value || ""));
        return u.protocol === "https:" || u.protocol === "http:";
    } catch (_) {
        return false;
    }
}

function samlConfigIsComplete(cfg) {
    return !!(
        String(cfg?.idpSsoUrl || "").trim()
        && String(cfg?.idpEntityId || "").trim()
        && String(cfg?.spEntityId || "").trim()
        && String(cfg?.acsUrl || "").trim()
    );
}

export async function getSamlSsoSetting(req, res) {
    try {
        const scope = await resolveScopedGroupForIntegrationSettings(req);
        const value = await getAppSettingValueWithScopedFallback("saml_sso", scope.groupId);
        const cfg = decryptSamlSsoConfig(value || {});
        res.json({
            ...cfg,
            hasX509Certificate: !!String(cfg.x509Certificate || "").trim(),
            groupId: scope.groupId || null,
        });
    } catch (err) {
        res.status(err.statusCode || 403).json({ error: err.message || "Forbidden" });
    }
}

export async function setSamlSsoSetting(req, res) {
    try {
        assertAllowedKeys(req.body || {}, ["idpSsoUrl", "idpEntityId", "spEntityId", "acsUrl", "nameIdFormat", "x509Certificate", "defaultRelayState", "groupId"]);
        const scope = await resolveScopedGroupForIntegrationSettings(req);
        const key = appSettingKeyForGroup("saml_sso", scope.groupId);
        const currentRaw = await getAppSettingValueWithScopedFallback("saml_sso", scope.groupId);
        const current = decryptSamlSsoConfig(currentRaw || {});
        const next = normalizeSamlSsoConfigForSave(current, req.body);

        await query(
            `INSERT INTO app_settings (key, value, updated_at)
             VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
             ON CONFLICT (key)
             DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
            [key, JSON.stringify(next)]
        );

        res.json({
            success: true,
            ...next,
            hasX509Certificate: !!String(next.x509Certificate || "").trim(),
            groupId: scope.groupId || null,
        });
    } catch (err) {
        res.status(err.statusCode || 403).json({ error: err.message || "Forbidden" });
    }
}

export async function testSamlSsoSetting(req, res) {
    try {
        const scope = await resolveScopedGroupForIntegrationSettings(req);
        const value = await getAppSettingValueWithScopedFallback("saml_sso", scope.groupId);
        const cfg = decryptSamlSsoConfig(value || {});
        if (!samlConfigIsComplete(cfg)) {
            return res.status(400).json({ ok: false, error: "saml_not_configured", groupId: scope.groupId || null });
        }
        if (!isValidHttpUrl(cfg.idpSsoUrl) || !isValidHttpUrl(cfg.acsUrl)) {
            return res.status(400).json({ ok: false, error: "saml_invalid_url", groupId: scope.groupId || null });
        }
        return res.json({ ok: true, message: "saml_configuration_valid", groupId: scope.groupId || null });
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
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
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
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    assertAllowedKeys(req.body || {}, ["host", "port", "secure", "username", "password", "fromEmail", "fromName"]);
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

export async function getInviteEmailTemplateSetting(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    const template = await loadInviteEmailTemplate();
    return res.json(template);
}

export async function setInviteEmailTemplateSetting(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    assertAllowedKeys(req.body || {}, ["subject", "html", "text", "logoUrl"]);
    const current = await loadInviteEmailTemplate();
    const next = normalizeInviteEmailTemplateForSave(req.body || {}, current);
    await query(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ('invite_email_template', $1::jsonb, CURRENT_TIMESTAMP)
         ON CONFLICT (key)
         DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
        [JSON.stringify(next)]
    );
    await writeAuditLog({
        req,
        action: "invite_email_template.updated",
        resourceType: "app_settings",
        resourceId: "invite_email_template",
    });
    return res.json({ success: true, ...next });
}

export async function previewInviteEmailTemplate(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    const current = await loadInviteEmailTemplate();
    const template = normalizeInviteEmailTemplateForSave(req.body || {}, current);
    const sample = req.body && typeof req.body === "object" ? req.body : {};
    const rendered = renderInviteTemplate(template, {
        customerName: String(sample.customerName || "Acme Corp"),
        inviterEmail: String(sample.inviterEmail || req.user.email || "admin@example.com"),
        inviteUrl: String(sample.inviteUrl || "https://app.example.com/?invite=preview-token"),
        expiresAt: String(sample.expiresAt || new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString()),
        logoUrl: String(sample.logoUrl || template.logoUrl || ""),
    });
    return res.json(rendered);
}

export async function getCustomerInvitationPolicy(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    const policy = await loadInvitationPolicy();
    return res.json(policy);
}

export async function setCustomerInvitationPolicy(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
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

function normalizeInsightTranslationCacheSettings(raw = {}) {
    const ttlMinutesRaw = Number.parseInt(String(raw?.ttlMinutes ?? ""), 10);
    const ttlMinutes = Number.isFinite(ttlMinutesRaw) ? ttlMinutesRaw : DEFAULT_INSIGHT_TRANSLATION_CACHE_TTL_MINUTES;
    return {
        ttlMinutes: Math.max(1, Math.min(1440, ttlMinutes)),
    };
}

function assertAllowedKeys(raw, allowedKeys = []) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        const err = new Error("invalid_settings_payload");
        err.statusCode = 400;
        throw err;
    }
    const allowed = new Set(allowedKeys);
    const unknown = Object.keys(raw).filter((k) => !allowed.has(k));
    if (unknown.length) {
        const err = new Error("unknown_settings_keys");
        err.statusCode = 400;
        err.details = { unknown };
        throw err;
    }
}

function normalizeMetricsExposureSettings(raw = {}) {
    return {
        enabled: raw?.enabled === true,
    };
}

function normalizeTwoFactorTotpSettings(raw = {}) {
    return {
        issuer: String(raw?.issuer || DEFAULT_TOTP_ISSUER).trim() || DEFAULT_TOTP_ISSUER,
        digits: normalize2faDigits(raw?.digits ?? DEFAULT_TOTP_DIGITS, DEFAULT_TOTP_DIGITS),
        period: normalize2faPeriod(raw?.period ?? DEFAULT_TOTP_PERIOD, DEFAULT_TOTP_PERIOD),
    };
}

function normalizeSmsOtpSettings(raw = {}) {
    const cfg = raw && typeof raw === "object" ? raw : {};
    const incomingToken = String(cfg?.authToken || "").trim();
    return {
        provider: "twilio",
        enabled: cfg?.enabled !== false,
        accountSid: String(cfg?.accountSid || "").trim(),
        authToken: incomingToken && incomingToken !== "***" ? encryptSettingValue(incomingToken) : String(cfg?.authToken || "").trim(),
        fromNumber: String(cfg?.fromNumber || "").trim(),
        messagingServiceSid: String(cfg?.messagingServiceSid || "").trim(),
    };
}

function serializeSmsOtpSettingsForRead(raw = {}) {
    const cfg = raw && typeof raw === "object" ? raw : {};
    const decrypted = decryptSettingValue(String(cfg?.authToken || "")).trim();
    return {
        provider: "twilio",
        enabled: cfg?.enabled !== false,
        accountSid: String(cfg?.accountSid || "").trim(),
        authToken: decrypted ? "***" : "",
        hasAuthToken: !!decrypted,
        fromNumber: String(cfg?.fromNumber || "").trim(),
        messagingServiceSid: String(cfg?.messagingServiceSid || "").trim(),
    };
}

const DEFAULT_AUTOSYNC_POLL_INTERVAL_MINUTES = Math.max(
    1,
    Number.parseInt(process.env.AUTOSYNC_POLL_INTERVAL_MINUTES || "5", 10) || 5
);

function normalizeAutosyncPollIntervalSettings(raw = {}) {
    const intervalMinutesRaw = Number.parseInt(
        raw?.intervalMinutes ?? raw?.pollMinutes ?? raw?.minutes ?? DEFAULT_AUTOSYNC_POLL_INTERVAL_MINUTES,
        10
    );
    const intervalMinutes = Number.isFinite(intervalMinutesRaw)
        ? Math.min(1440, Math.max(1, intervalMinutesRaw))
        : DEFAULT_AUTOSYNC_POLL_INTERVAL_MINUTES;
    return { intervalMinutes };
}

export function normalizeRevisionCompareSettings(raw = {}) {
    const maxRowsRaw = Number.parseInt(
        raw?.maxRows ?? raw?.maxCompareRows ?? raw?.revisionCompareMaxRows ?? DEFAULT_REVISION_COMPARE_MAX_ROWS,
        10
    );
    const maxRows = Number.isFinite(maxRowsRaw)
        ? Math.min(REVISION_COMPARE_MAX_ROWS_CAP, Math.max(1000, maxRowsRaw))
        : DEFAULT_REVISION_COMPARE_MAX_ROWS;
    return { maxRows };
}

export function normalizeEmailIngestSettings(raw = {}) {
    const routingMode = String(raw?.routingMode || raw?.routeMode || "catch_all").trim().toLowerCase() === "default_routing"
        ? "default_routing"
        : "catch_all";
    const addressMode = String(raw?.addressMode || raw?.customerAddressMode || "slug").trim().toLowerCase() === "id"
        ? "id"
        : "slug";
    return {
        enabled: raw?.enabled !== false,
        provider: "google_workspace",
        inboundDomain: String(raw?.inboundDomain || raw?.emailDomain || "").trim().toLowerCase(),
        routeMailbox: String(raw?.routeMailbox || raw?.mailbox || "").trim().toLowerCase(),
        addressPrefix: String(raw?.addressPrefix || raw?.customerAddressPrefix || "customer").trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-") || "customer",
        addressMode,
        routingMode,
        requireApprovedSenders: raw?.requireApprovedSenders !== false,
        notes: String(raw?.notes || "").trim(),
    };
}

export function normalizeImportPipelineSettings(raw = {}) {
    const enabled = raw?.importStreamingEnabled;
    const v2 = raw?.queuedImportStreamingV2Enabled;
    const stagingWrite = raw?.importStagingWriteEnabled;
    const stagingFinalize = raw?.importStagingFinalizeEnabled;
    return {
        importStreamingEnabled: enabled === true || String(enabled).trim().toLowerCase() === "true",
        queuedImportStreamingV2Enabled: v2 === true || String(v2).trim().toLowerCase() === "true",
        importStagingWriteEnabled: stagingWrite === true || String(stagingWrite).trim().toLowerCase() === "true",
        importStagingFinalizeEnabled: stagingFinalize === true || String(stagingFinalize).trim().toLowerCase() === "true",
    };
}

export async function getImportPipelineSetting(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    const rows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [IMPORT_PIPELINE_SETTINGS_KEY]);
    const current = normalizeImportPipelineSettings(rows?.[0]?.value || {});
    return res.json(current);
}

export async function setImportPipelineSetting(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    assertAllowedKeys(req.body || {}, ["importStreamingEnabled", "queuedImportStreamingV2Enabled", "importStagingWriteEnabled", "importStagingFinalizeEnabled"]);
    const next = normalizeImportPipelineSettings(req.body || {});
    await query(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
         ON CONFLICT (key)
         DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
        [IMPORT_PIPELINE_SETTINGS_KEY, JSON.stringify(next)]
    );
    await writeAuditLog({
        req,
        action: "import_pipeline.settings_updated",
        resourceType: "app_settings",
        resourceId: IMPORT_PIPELINE_SETTINGS_KEY,
        metadata: next,
    });
    return res.json({ success: true, ...next });
}

export function normalizeEmailIngestSenderAllowlist(raw = {}) {
    const allowedSenderDomains = Array.isArray(raw?.allowedSenderDomains)
        ? raw.allowedSenderDomains
        : String(raw?.allowedSenderDomains || raw?.allowedSenderDomainsCsv || "")
            .split(/[\n,]+/)
            .map((value) => String(value || "").trim())
            .filter(Boolean);
    return Array.from(new Set(allowedSenderDomains.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean)));
}

export async function getInsightTranslationCacheSetting(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    const rows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [INSIGHT_TRANSLATION_CACHE_SETTINGS_KEY]);
    const current = normalizeInsightTranslationCacheSettings(rows?.[0]?.value || {});
    return res.json(current);
}

export async function setInsightTranslationCacheSetting(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    assertAllowedKeys(req.body || {}, ["ttlMinutes"]);
    const next = normalizeInsightTranslationCacheSettings(req.body || {});
    await query(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
         ON CONFLICT (key)
         DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
        [INSIGHT_TRANSLATION_CACHE_SETTINGS_KEY, JSON.stringify(next)]
    );
    await writeAuditLog({
        req,
        action: "insight_translation_cache.settings_updated",
        resourceType: "app_settings",
        resourceId: INSIGHT_TRANSLATION_CACHE_SETTINGS_KEY,
        metadata: next,
    });
    return res.json({ success: true, ...next });
}

export async function getAiFeatureTogglesSetting(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    const rows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [AI_FEATURE_TOGGLES_SETTINGS_KEY]);
    const current = normalizeAiFeatureToggles(rows?.[0]?.value || {});
    return res.json(current);
}

export async function setAiFeatureTogglesSetting(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    assertAllowedKeys(req.body || {}, [
        "chatEnabled",
        "dashboardTranslationEnabled",
        "chatAudioEnabled",
        "insightAiEnabled",
        "businessClassificationEnabled",
    ]);
    const next = normalizeAiFeatureToggles(req.body || {});
    await query(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
         ON CONFLICT (key)
         DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
        [AI_FEATURE_TOGGLES_SETTINGS_KEY, JSON.stringify(next)]
    );
    await writeAuditLog({
        req,
        action: "ai_feature_toggles.settings_updated",
        resourceType: "app_settings",
        resourceId: AI_FEATURE_TOGGLES_SETTINGS_KEY,
        metadata: next,
    });
    return res.json({ success: true, ...next });
}

export async function getMyAiFeatureTogglesSetting(req, res) {
    const effective = await resolveEffectiveAiFeaturesForUser(req.user);
    return res.json(effective);
}

export async function getAiRuntimeSetting(req, res) {
    try {
        if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
        const current = await loadAiRuntimeSettings(null);
        return res.json({ ...current, groupId: null });
    } catch (err) {
        return res.status(err.statusCode || 403).json({ error: err.message || "Forbidden" });
    }
}

export function normalizeAiSelfLearningSettings(raw = {}) {
    return {
        enabled: raw?.enabled === true || String(raw?.enabled || "").toLowerCase() === "true",
        autoApplyApprovedRules: raw?.autoApplyApprovedRules === true || String(raw?.autoApplyApprovedRules || "").toLowerCase() === "true",
        autoApproveAllCandidates: raw?.autoApproveAllCandidates === true || String(raw?.autoApproveAllCandidates || "").toLowerCase() === "true",
        minConfidence: Math.max(0, Math.min(1, Number(raw?.minConfidence ?? 0.75) || 0.75)),
    };
}

export async function getAiSelfLearningSetting(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    const rows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [AI_SELF_LEARNING_SETTINGS_KEY]);
    const current = normalizeAiSelfLearningSettings(rows?.[0]?.value || {});
    return res.json(current);
}

export async function setAiSelfLearningSetting(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    assertAllowedKeys(req.body || {}, ["enabled", "autoApplyApprovedRules", "autoApproveAllCandidates", "minConfidence"]);
    const next = normalizeAiSelfLearningSettings(req.body || {});
    await query(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
         ON CONFLICT (key)
         DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
        [AI_SELF_LEARNING_SETTINGS_KEY, JSON.stringify(next)]
    );
    await writeAuditLog({
        req,
        action: "ai_self_learning.settings_updated",
        resourceType: "app_settings",
        resourceId: AI_SELF_LEARNING_SETTINGS_KEY,
        metadata: next,
    });
    return res.json({ success: true, ...next });
}

export async function listAiLearningFeedback(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    const status = String(req.query?.status || "pending").trim().toLowerCase();
    const allowed = new Set(["pending", "approved", "rejected", "all"]);
    const resolved = allowed.has(status) ? status : "pending";
    const rows = resolved === "all"
        ? await query(
            `SELECT id, sheet_id, user_id, locale, question, bad_answer, expected_answer, context, status, approved_rule_id, reviewed_by, reviewed_at, created_at
             FROM ai_learning_feedback
             ORDER BY created_at DESC
             LIMIT 500`
        )
        : await query(
            `SELECT id, sheet_id, user_id, locale, question, bad_answer, expected_answer, context, status, approved_rule_id, reviewed_by, reviewed_at, created_at
             FROM ai_learning_feedback
             WHERE status = $1
             ORDER BY created_at DESC
             LIMIT 500`,
            [resolved]
        );
    return res.json({ items: rows || [] });
}

export async function reviewAiLearningFeedback(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    const id = Number.parseInt(req.params?.id, 10);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "invalid_feedback_id" });
    const action = String(req.body?.action || "").trim().toLowerCase();
    if (action !== "approve" && action !== "reject") return res.status(400).json({ error: "invalid_action" });
    const notes = String(req.body?.notes || "").trim().slice(0, 1000);
    const client = await getClient();
    try {
        await client.query("BEGIN");
        const foundRows = await client.query(
            `SELECT id, question, expected_answer, locale, status
             FROM ai_learning_feedback
             WHERE id = $1
             FOR UPDATE`,
            [id]
        );
        const found = foundRows.rows?.[0];
        if (!found) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "feedback_not_found" });
        }
        if (String(found.status) !== "pending") {
            await client.query("ROLLBACK");
            return res.status(409).json({ error: "feedback_already_reviewed" });
        }
        let approvedRuleId = null;
        if (action === "approve") {
            const context = found.context || {};
            const successfulPlan = context.successfulPlan || null;
            
            let mappedIntent = "answer_shape";
            let mappedPayload = { expectedAnswer: String(found.expected_answer || ""), notes };

            if (successfulPlan && typeof successfulPlan === "object" && successfulPlan.operation) {
                mappedIntent = successfulPlan.operation;
                mappedPayload = {
                    ...successfulPlan,
                    notes: `Learned from feedback ${id}: ${notes}`
                };
            }

            const ruleRows = await client.query(
                `INSERT INTO ai_learning_rules
                   (source_feedback_id, scope, locale, phrase, mapped_intent, mapped_payload, confidence, status, approved_by)
                 VALUES ($1, 'global', $2, $3, $4, $5::jsonb, 1.0, 'approved', $6)
                 RETURNING id`,
                [
                    id,
                    String(found.locale || "en"),
                    normalizeText(String(found.question || "")),
                    mappedIntent,
                    JSON.stringify(mappedPayload),
                    Number(req.user?.id || 0) || null,
                ]
            );
            approvedRuleId = ruleRows.rows?.[0]?.id || null;
            invalidateLearningRulesCache();
        }

        await client.query(
            `UPDATE ai_learning_feedback
             SET status = $2, approved_rule_id = $3, reviewed_by = $4, reviewed_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [id, action === "approve" ? "approved" : "rejected", approvedRuleId, Number(req.user?.id || 0) || null]
        );
        await client.query("COMMIT");
        await writeAuditLog({
            req,
            action: `ai_learning.feedback_${action}`,
            resourceType: "ai_learning_feedback",
            resourceId: String(id),
            metadata: { approvedRuleId, notes },
        });
        return res.json({ success: true, id, status: action === "approve" ? "approved" : "rejected", approvedRuleId });
    } catch (err) {
        try { await client.query("ROLLBACK"); } catch {}
        return res.status(500).json({ error: "ai_learning_review_failed", detail: String(err?.message || "internal_server_error") });
    } finally {
        client.release();
    }
}

export async function listAiLearningCandidates(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    const status = String(req.query?.status || "pending").trim().toLowerCase();
    const allowed = new Set(["pending", "approved", "rejected", "all"]);
    const resolved = allowed.has(status) ? status : "pending";
    const rows = resolved === "all"
        ? await query(
            `SELECT id, locale, phrase, suggested_intent, suggested_payload, evidence_count, confidence, status, approved_rule_id, reviewed_by, reviewed_at, created_at, updated_at
             FROM ai_learning_candidates
             ORDER BY evidence_count DESC, updated_at DESC
             LIMIT 1000`
        )
        : await query(
            `SELECT id, locale, phrase, suggested_intent, suggested_payload, evidence_count, confidence, status, approved_rule_id, reviewed_by, reviewed_at, created_at, updated_at
             FROM ai_learning_candidates
             WHERE status = $1
             ORDER BY evidence_count DESC, updated_at DESC
             LIMIT 1000`,
            [resolved]
        );
    return res.json({ items: rows || [] });
}

export async function reviewAiLearningCandidate(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    const id = Number.parseInt(req.params?.id, 10);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "invalid_candidate_id" });
    const action = String(req.body?.action || "").trim().toLowerCase();
    if (action !== "approve" && action !== "reject") return res.status(400).json({ error: "invalid_action" });
    const client = await getClient();
    try {
        await client.query("BEGIN");
        const foundRows = await client.query(
            `SELECT id, locale, phrase, suggested_intent, suggested_payload, status
             FROM ai_learning_candidates
             WHERE id = $1
             FOR UPDATE`,
            [id]
        );
        const found = foundRows.rows?.[0];
        if (!found) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "candidate_not_found" });
        }
        if (String(found.status) !== "pending") {
            await client.query("ROLLBACK");
            return res.status(409).json({ error: "candidate_already_reviewed" });
        }
        let approvedRuleId = null;
        if (action === "approve") {
            const ruleRows = await client.query(
                `INSERT INTO ai_learning_rules
                   (scope, locale, phrase, mapped_intent, mapped_payload, confidence, status, approved_by)
                 VALUES ('global', $1, $2, $3, $4::jsonb, 0.9, 'approved', $5)
                 RETURNING id`,
                [found.locale, normalizeText(found.phrase), found.suggested_intent, JSON.stringify(found.suggested_payload || {}), Number(req.user?.id || 0) || null]
            );
            approvedRuleId = ruleRows.rows?.[0]?.id || null;
            invalidateLearningRulesCache();
        }
        await client.query(
            `UPDATE ai_learning_candidates
             SET status = $2, approved_rule_id = $3, reviewed_by = $4, reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [id, action === "approve" ? "approved" : "rejected", approvedRuleId, Number(req.user?.id || 0) || null]
        );
        await client.query("COMMIT");
        return res.json({ success: true, id, status: action === "approve" ? "approved" : "rejected", approvedRuleId });
    } catch (err) {
        try { await client.query("ROLLBACK"); } catch {}
        return res.status(500).json({ error: "ai_learning_candidate_review_failed", detail: String(err?.message || "internal_server_error") });
    } finally {
        client.release();
    }
}

export async function getAiLearningImpact(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    const days = Math.max(1, Math.min(180, Number.parseInt(String(req.query?.days || "30"), 10) || 30));
    const rows = await query(
        `SELECT detected_intent,
                COUNT(*)::int AS total,
                SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END)::int AS ok_count,
                SUM(CASE WHEN status = 'no_data' THEN 1 ELSE 0 END)::int AS no_data_count,
                SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END)::int AS error_count
         FROM ai_learning_events
         WHERE created_at >= (CURRENT_TIMESTAMP - ($1::int || ' days')::interval)
         GROUP BY detected_intent
         ORDER BY total DESC`,
        [days]
    );
    return res.json({ days, intents: rows || [] });
}

export async function setAiRuntimeSetting(req, res) {
    try {
        if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
        const incoming = req.body && typeof req.body === "object" ? { ...req.body } : {};
        assertAllowedKeys(incoming, [
            "aiRuntimePreset", "aiProvider", "providerConfigs",
            "globalAiDisabled", "chatEnabled", "chatAudioEnabled", "dashboardTranslationEnabled", "businessClassificationEnabled", "insightAiEnabled",
            "chatMaxInputChars", "chatHistoryWindowMessages", "dashboardTranslateMaxItems", "dashboardTranslateMaxCharsPerItem",
            "chatPromptBudgetEnabled",
            "businessClassificationModel", "businessClassificationApplyUploads", "businessClassificationApplyEmailIngest", "businessClassificationApplyAutosync",
            "businessClassificationMaxSampleRows", "businessClassificationMaxPromptChars", "businessClassificationMaxOutputTokens",
            "llmMaxOutputTokens", "openaiModel", "openaiBaseUrl", "openaiTimeoutMs", "openaiTemperature", "openaiMaxOutputTokens",
            "openaiInputCostPer1M", "openaiOutputCostPer1M", "translationOpenaiModel", "translationTemperature", "translationMaxOutputTokens",
            "insightAiModel", "insightAiMaxSeriesPoints", "insightAiMaxPromptChars",
            "chatAudioMaxChars", "chatAudioTtsModelEn", "chatAudioTtsModelDefault", "chatAudioTtsVoice", "chatAudioTtsSpeed",
            "aiBaseUrlAllowlistEnabled", "aiBaseUrlAllowlistBypass", "aiBaseUrlAllowlist",
            "importStreamingEnabled",
        ]);
        const aiProvider = String(incoming.aiProvider || "openai").trim().toLowerCase();
        const providerConfigs = incoming.providerConfigs && typeof incoming.providerConfigs === "object" ? incoming.providerConfigs : {};
        const providerModel = String(providerConfigs?.[aiProvider]?.model || "").trim();
        if (providerModel) {
            incoming.openaiModel = providerModel;
        }
        const next = await saveAiRuntimeSettings(null, incoming);
        const featureToggles = normalizeAiFeatureToggles({
            chatEnabled: next.globalAiDisabled !== true && next.chatEnabled === true,
            dashboardTranslationEnabled: next.globalAiDisabled !== true && next.dashboardTranslationEnabled === true,
            chatAudioEnabled: next.globalAiDisabled !== true && next.chatAudioEnabled === true,
            insightAiEnabled: next.globalAiDisabled !== true && next.insightAiEnabled === true,
            businessClassificationEnabled: next.globalAiDisabled !== true && next.businessClassificationEnabled === true,
        });
        await query(
            `INSERT INTO app_settings (key, value, updated_at)
             VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
             ON CONFLICT (key)
             DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
            [AI_FEATURE_TOGGLES_SETTINGS_KEY, JSON.stringify(featureToggles)]
        );
        await writeAuditLog({
            req,
            action: "ai_runtime.settings_updated",
            resourceType: "app_settings",
            resourceId: "ai_runtime_settings:global",
            metadata: {
                ...next,
                groupId: null,
                aiBaseUrlPolicy: {
                    allowlistEnabled: next.aiBaseUrlAllowlistEnabled === true,
                    allowlistBypass: next.aiBaseUrlAllowlistBypass === true,
                    allowlistSize: Array.isArray(next.aiBaseUrlAllowlist) ? next.aiBaseUrlAllowlist.length : 0,
                },
            },
        });
        return res.json({ success: true, ...next, groupId: null });
    } catch (err) {
        return res.status(err.statusCode || 403).json({ error: err.message || "Forbidden" });
    }
}

export async function getMetricsExposureSetting(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    const rows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [METRICS_EXPOSURE_SETTINGS_KEY]);
    const current = normalizeMetricsExposureSettings(rows?.[0]?.value || {});
    return res.json(current);
}

export async function getTwoFactorTotpSetting(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    const rows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [TWO_FACTOR_TOTP_SETTINGS_KEY]);
    const current = normalizeTwoFactorTotpSettings(rows?.[0]?.value || {});
    return res.json(current);
}

export async function setTwoFactorTotpSetting(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    assertAllowedKeys(req.body || {}, ["issuer", "digits", "period"]);
    const next = normalizeTwoFactorTotpSettings(req.body || {});
    await query(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
         ON CONFLICT (key)
         DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
        [TWO_FACTOR_TOTP_SETTINGS_KEY, JSON.stringify(next)]
    );
    await writeAuditLog({
        req,
        action: "two_factor_totp.settings_updated",
        resourceType: "app_settings",
        resourceId: TWO_FACTOR_TOTP_SETTINGS_KEY,
        metadata: next,
    });
    return res.json({ success: true, ...next });
}

export async function getSmsOtpSetting(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    const rows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [SMS_OTP_CONFIG_KEY]);
    const current = serializeSmsOtpSettingsForRead(rows?.[0]?.value || {});
    return res.json(current);
}

export async function setSmsOtpSetting(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    assertAllowedKeys(req.body || {}, ["provider", "enabled", "accountSid", "authToken", "fromNumber", "messagingServiceSid"]);
    const rows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [SMS_OTP_CONFIG_KEY]);
    const currentRaw = rows?.[0]?.value && typeof rows[0].value === "object" ? rows[0].value : {};
    const merged = {
        ...currentRaw,
        provider: "twilio",
        enabled: req.body?.enabled === undefined ? currentRaw?.enabled !== false : req.body.enabled !== false,
        accountSid: typeof req.body?.accountSid === "string" ? req.body.accountSid : currentRaw?.accountSid,
        authToken: typeof req.body?.authToken === "string" ? req.body.authToken : currentRaw?.authToken,
        fromNumber: typeof req.body?.fromNumber === "string" ? req.body.fromNumber : currentRaw?.fromNumber,
        messagingServiceSid: typeof req.body?.messagingServiceSid === "string" ? req.body.messagingServiceSid : currentRaw?.messagingServiceSid,
    };
    const next = normalizeSmsOtpSettings(merged);
    await query(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
         ON CONFLICT (key)
         DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
        [SMS_OTP_CONFIG_KEY, JSON.stringify(next)]
    );
    await writeAuditLog({
        req,
        action: "sms_otp.settings_updated",
        resourceType: "app_settings",
        resourceId: SMS_OTP_CONFIG_KEY,
        metadata: {
            provider: "twilio",
            enabled: next.enabled !== false,
            accountSid: String(next.accountSid || ""),
            hasAuthToken: !!decryptSettingValue(String(next.authToken || "")).trim(),
            fromNumber: String(next.fromNumber || ""),
            messagingServiceSid: String(next.messagingServiceSid || ""),
        },
    });
    return res.json({ success: true, ...serializeSmsOtpSettingsForRead(next) });
}

export async function getDlpSetting(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    const rows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [DLP_SETTINGS_KEY]);
    const current = normalizeDlpSettings(rows?.[0]?.value || {});
    return res.json({ ...current, configured: rows.length > 0 });
}

export async function setDlpSetting(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    assertAllowedKeys(req.body || {}, ["enabled", "mode", "checkSsn", "checkCreditCard", "checkEmail", "checkPhone", "checkIban", "maskDetectedColumns", "maxCellsScanned", "maxFindings"]);
    const next = normalizeDlpSettings(req.body || {});
    await query(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
         ON CONFLICT (key)
         DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
        [DLP_SETTINGS_KEY, JSON.stringify(next)]
    );
    await writeAuditLog({
        req,
        action: "dlp.settings_updated",
        resourceType: "app_settings",
        resourceId: DLP_SETTINGS_KEY,
        metadata: next,
    });
    return res.json({ success: true, configured: true, ...next });
}

export async function setMetricsExposureSetting(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    assertAllowedKeys(req.body || {}, ["enabled"]);
    const next = normalizeMetricsExposureSettings(req.body || {});
    await query(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
         ON CONFLICT (key)
         DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
        [METRICS_EXPOSURE_SETTINGS_KEY, JSON.stringify(next)]
    );
    await writeAuditLog({
        req,
        action: "metrics_exposure.settings_updated",
        resourceType: "app_settings",
        resourceId: METRICS_EXPOSURE_SETTINGS_KEY,
        metadata: next,
    });
    return res.json({ success: true, ...next });
}

export async function getAutosyncPollIntervalSetting(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    const rows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [AUTOSYNC_POLL_INTERVAL_SETTINGS_KEY]);
    const current = normalizeAutosyncPollIntervalSettings(rows?.[0]?.value || {});
    return res.json(current);
}

export async function setAutosyncPollIntervalSetting(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    assertAllowedKeys(req.body || {}, ["intervalMinutes", "pollMinutes", "minutes"]);
    const next = normalizeAutosyncPollIntervalSettings(req.body || {});
    await query(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
         ON CONFLICT (key)
         DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
        [AUTOSYNC_POLL_INTERVAL_SETTINGS_KEY, JSON.stringify(next)]
    );
    await writeAuditLog({
        req,
        action: "autosync_poll_interval.settings_updated",
        resourceType: "app_settings",
        resourceId: AUTOSYNC_POLL_INTERVAL_SETTINGS_KEY,
        metadata: next,
    });
    return res.json({ success: true, ...next });
}

export async function getRevisionCompareSetting(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    const rows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [REVISION_COMPARE_SETTINGS_KEY]);
    const current = normalizeRevisionCompareSettings(rows?.[0]?.value || {});
    return res.json({ ...current, configured: rows.length > 0, maxAllowedRows: REVISION_COMPARE_MAX_ROWS_CAP });
}

export async function setRevisionCompareSetting(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    assertAllowedKeys(req.body || {}, ["maxRows", "maxCompareRows", "revisionCompareMaxRows"]);
    const next = normalizeRevisionCompareSettings(req.body || {});
    await query(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
         ON CONFLICT (key)
         DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
        [REVISION_COMPARE_SETTINGS_KEY, JSON.stringify(next)]
    );
    await writeAuditLog({
        req,
        action: "revision_compare.settings_updated",
        resourceType: "app_settings",
        resourceId: REVISION_COMPARE_SETTINGS_KEY,
        metadata: next,
    });
    return res.json({ success: true, configured: true, maxAllowedRows: REVISION_COMPARE_MAX_ROWS_CAP, ...next });
}

export async function getEmailIngestSetting(req, res) {
    const scope = await resolveScopedGroupForIntegrationSettings(req);
    const currentRows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [EMAIL_INGEST_SETTINGS_KEY]);
    const scopedAllowlistRaw = scope.groupId
        ? await getAppSettingValueWithScopedFallback(EMAIL_INGEST_ALLOWLIST_KEY, scope.groupId)
        : null;
    const allowlistRaw = scopedAllowlistRaw ?? await getAppSettingValueWithScopedFallback(EMAIL_INGEST_ALLOWLIST_KEY, null);
    const current = normalizeEmailIngestSettings(currentRows?.[0]?.value || {});
    return res.json({
        ...current,
        allowedSenderDomains: normalizeEmailIngestSenderAllowlist(allowlistRaw || currentRows?.[0]?.value || {}),
        groupId: scope.groupId || null,
    });
}

export async function setEmailIngestSetting(req, res) {
    const scope = await resolveScopedGroupForIntegrationSettings(req);
    assertAllowedKeys(req.body || {}, ["enabled", "provider", "inboundDomain", "emailDomain", "routeMailbox", "mailbox", "addressPrefix", "customerAddressPrefix", "addressMode", "customerAddressMode", "routingMode", "routeMode", "requireApprovedSenders", "notes", "allowedSenderDomains", "allowedSenderDomainsCsv"]);
    const next = normalizeEmailIngestSettings(req.body || {});
    const allowedSenderDomains = normalizeEmailIngestSenderAllowlist(req.body || {});
    if (isPlatformAdminUser(req.user)) {
        await query(
            `INSERT INTO app_settings (key, value, updated_at)
             VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
             ON CONFLICT (key)
             DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
            [EMAIL_INGEST_SETTINGS_KEY, JSON.stringify(next)]
        );
    }
    await query(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
         ON CONFLICT (key)
         DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
        [appSettingKeyForGroup(EMAIL_INGEST_ALLOWLIST_KEY, scope.groupId), JSON.stringify({ allowedSenderDomains })]
    );
    await writeAuditLog({
        req,
        action: "email_ingest.settings_updated",
        resourceType: "app_settings",
        resourceId: appSettingKeyForGroup(EMAIL_INGEST_ALLOWLIST_KEY, scope.groupId),
        metadata: { ...next, allowedSenderDomains, groupId: scope.groupId || null },
    });
    return res.json({ success: true, ...next, allowedSenderDomains, groupId: scope.groupId || null });
}

export async function getMyMetricsExposureSetting(req, res) {
    const rows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [METRICS_EXPOSURE_SETTINGS_KEY]);
    const current = normalizeMetricsExposureSettings(rows?.[0]?.value || {});
    return res.json(current);
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
        assertAllowedKeys(req.body || {}, ["enabled", "groupId"]);
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
    if (isPlatformAdminUser(req.user)) {
        const cacheKey = `listGroups:admin:${ENABLE_STORAGE_USAGE_METRICS ? "usage" : "lite"}${pageTag}`;
        if (GROUPS_LIST_CACHE_ENABLED) {
            const cached = getHeavyListCache(cacheKey);
            if (cached) return res.json(cached);
        }
        const totalRows = await query("SELECT COUNT(*)::int AS c FROM groups", []);
        const total = Number(totalRows[0]?.c || 0);
        let sql = `SELECT g.*, c.id AS customer_id, c.db_name AS customer_db_name, c.status AS customer_db_status,
                          0::bigint AS used_storage_bytes
                   FROM groups g
                   LEFT JOIN customers c ON c.group_id = g.id
                   ORDER BY g.id ASC`;
        const params = [];
        if (pagination.hasPagination) {
            sql += ` LIMIT $1 OFFSET $2`;
            params.push(pagination.limit, pagination.offset);
        }
        const groups = await query(sql, params);
        if (GROUPS_LIST_CACHE_ENABLED) setHeavyListCache(cacheKey, groups);
        res.set("X-Total-Count", String(total));
        res.set("X-Limit", String(pagination.limit));
        res.set("X-Offset", String(pagination.offset));
        return res.json(groups);
    }

    const adminGroups = await getAdminGroups(req.user.id);
    if (!adminGroups.length) return res.status(403).json({ error: "Forbidden" });
    const cacheKey = `listGroups:user:${req.user.id}:${[...adminGroups].sort((a, b) => a - b).join(",")}:${ENABLE_STORAGE_USAGE_METRICS ? "usage" : "lite"}${pageTag}`;
    if (GROUPS_LIST_CACHE_ENABLED) {
        const cached = getHeavyListCache(cacheKey);
        if (cached) return res.json(cached);
    }

    const totalRows = await query(
        `SELECT COUNT(*)::int AS c FROM groups g WHERE g.id = ANY($1::int[])`,
        [adminGroups]
    );
    const total = Number(totalRows[0]?.c || 0);
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
    if (GROUPS_LIST_CACHE_ENABLED) setHeavyListCache(cacheKey, groups);
    res.set("X-Total-Count", String(total));
    res.set("X-Limit", String(pagination.limit));
    res.set("X-Offset", String(pagination.offset));
    return res.json(groups);
}

export async function createGroup(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    const { name, maxFileSizeMb, maxTotalStorageMb } = req.body;
    const customerFirstName = String(req.body?.customerFirstName || "").trim();
    const customerLastName = String(req.body?.customerLastName || "").trim();
    const customerCompanyName = String(req.body?.customerCompanyName || "").trim();
    const customerEmail = normalizeEmail(req.body?.customerEmail || "");
    const customerPhone = String(req.body?.customerPhone || "").trim();
    const entitlements = parseEntitlementsInput(req.body?.entitlements);
    if (!customerFirstName || !customerLastName || !customerCompanyName || !customerEmail) {
        return res.status(400).json({ error: "customer_first_last_company_email_required" });
    }
    try {
        const client = await getClient();
        let createdGroup = null;
        let linkedUserId = null;
        let linkedUserEmail = customerEmail;
        try {
            await client.query("BEGIN");
            const groupResult = await client.query(
                `INSERT INTO groups (
                    name, max_file_size_mb, max_total_storage_mb, entitlements,
                    customer_first_name, customer_last_name, customer_company_name, customer_email, customer_phone
                 ) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9) RETURNING *`,
                [
                    name,
                    maxFileSizeMb || 100,
                    maxTotalStorageMb || 10240,
                    JSON.stringify(entitlements || {}),
                    customerFirstName,
                    customerLastName,
                    customerCompanyName,
                    customerEmail,
                    customerPhone || null,
                ]
            );
            createdGroup = groupResult.rows?.[0] || null;
            if (!createdGroup?.id) throw new Error("group_create_failed");

            const existingUserRes = await client.query(
                "SELECT id, email, role FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1 FOR UPDATE",
                [customerEmail]
            );
            const existingUser = existingUserRes.rows?.[0] || null;
            if (existingUser && String(existingUser.role || "").toLowerCase() === "admin") {
                await client.query("ROLLBACK");
                return res.status(403).json({ error: "admin_email_not_allowed" });
            }

            if (existingUser) {
                linkedUserId = Number(existingUser.id);
                linkedUserEmail = String(existingUser.email || customerEmail);
                await client.query(
                    `UPDATE users
                        SET first_name = COALESCE(NULLIF(TRIM(first_name), ''), $1),
                            last_name = COALESCE(NULLIF(TRIM(last_name), ''), $2),
                            company = COALESCE(NULLIF(TRIM(company), ''), $3)
                      WHERE id = $4`,
                    [customerFirstName, customerLastName, customerCompanyName, linkedUserId]
                );
            } else {
                const tempPassword = generateComplexPassword(16);
                const hashed = await hashPassword(tempPassword);
                const insertedUserRes = await client.query(
                    `INSERT INTO users (email, password, role, first_name, last_name, company, password_reset_required)
                     VALUES ($1, $2, 'user', $3, $4, $5, TRUE)
                     RETURNING id, email`,
                    [customerEmail, hashed, customerFirstName, customerLastName, customerCompanyName]
                );
                linkedUserId = Number(insertedUserRes.rows?.[0]?.id || 0);
                linkedUserEmail = String(insertedUserRes.rows?.[0]?.email || customerEmail);
            }

            if (!linkedUserId) throw new Error("customer_admin_user_create_failed");

            await client.query(
                `INSERT INTO user_groups (group_id, user_id, is_admin)
                 VALUES ($1, $2, TRUE)
                 ON CONFLICT (user_id, group_id)
                 DO UPDATE SET is_admin = TRUE`,
                [createdGroup.id, linkedUserId]
            );

            await client.query("COMMIT");
        } catch (txErr) {
            await client.query("ROLLBACK").catch(() => {});
            throw txErr;
        } finally {
            client.release();
        }

        if (isTenantDbIsolationEnabled()) {
            const customer = await provisionCustomerDatabase({ groupId: createdGroup.id, name: createdGroup.name });
            createdGroup.customer_id = customer?.id || null;
            createdGroup.customer_db_status = customer?.status || null;
            await syncCustomerPrincipalToTenant({ groupId: createdGroup.id, userId: linkedUserId }).catch((err) => {
                console.error("[tenant-db] sync customer principal failed:", err?.message || err);
            });
        }
        clearHeavyListCache();
        res.json({ ...createdGroup, customer_admin_user_id: linkedUserId, customer_admin_email: linkedUserEmail });
    } catch (e) {
        if (String(e).includes("unique")) return res.status(400).json({ error: "Name exists" });
        throw e;
    }
}

export async function provisionGroupDatabase(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    const gid = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(gid) || gid <= 0) return res.status(400).json({ error: "invalid_group_id" });
    try {
        const customer = await provisionCustomerDatabase({ groupId: gid });
        const members = await query("SELECT user_id FROM user_groups WHERE group_id = $1", [gid]);
        for (const member of members) {
            await syncCustomerPrincipalToTenant({ groupId: gid, userId: member.user_id });
        }
        clearHeavyListCache();
        res.json({ success: true, customer, syncedUsers: members.length });
    } catch (err) {
        console.error("[tenant-db] provision customer database failed:", err?.message || err);
        res.status(500).json({ error: "tenant_database_provision_failed" });
    }
}

export async function updateGroup(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    const { id } = req.params;
    const { name, maxFileSizeMb, maxTotalStorageMb } = req.body;
    const customerFirstName = req.body?.customerFirstName;
    const customerLastName = req.body?.customerLastName;
    const customerCompanyName = req.body?.customerCompanyName;
    const customerEmail = req.body?.customerEmail;
    const customerPhone = req.body?.customerPhone;
    const entitlements = parseEntitlementsInput(req.body?.entitlements);
    const hasCustomerProfileField = (
        customerFirstName !== undefined
        || customerLastName !== undefined
        || customerCompanyName !== undefined
        || customerEmail !== undefined
        || customerPhone !== undefined
    );
    if (hasCustomerProfileField) {
        const first = String(customerFirstName || "").trim();
        const last = String(customerLastName || "").trim();
        const company = String(customerCompanyName || "").trim();
        const email = normalizeEmail(customerEmail || "");
        if (!first || !last || !company || !email) {
            return res.status(400).json({ error: "customer_first_last_company_email_required" });
        }
    }
    try {
        const r = await query(
            `UPDATE groups
                SET name = COALESCE($1, name),
                    max_file_size_mb = COALESCE($2, max_file_size_mb),
                    max_total_storage_mb = COALESCE($3, max_total_storage_mb),
                    entitlements = COALESCE($4::jsonb, entitlements),
                    customer_first_name = COALESCE($5, customer_first_name),
                    customer_last_name = COALESCE($6, customer_last_name),
                    customer_company_name = COALESCE($7, customer_company_name),
                    customer_email = COALESCE($8, customer_email),
                    customer_phone = COALESCE($9, customer_phone)
              WHERE id = $10
              RETURNING *`,
            [
                name,
                maxFileSizeMb,
                maxTotalStorageMb,
                entitlements === undefined ? null : JSON.stringify(entitlements),
                customerFirstName === undefined ? null : String(customerFirstName || "").trim(),
                customerLastName === undefined ? null : String(customerLastName || "").trim(),
                customerCompanyName === undefined ? null : String(customerCompanyName || "").trim(),
                customerEmail === undefined ? null : normalizeEmail(customerEmail || ""),
                customerPhone === undefined ? null : (String(customerPhone || "").trim() || null),
                id,
            ]
        );
        if (!r.length) return res.status(404).json({ error: "not_found" });
        if (isTenantDbIsolationEnabled()) {
            await syncCustomerGroupToTenant(id).catch((err) => {
                console.error("[tenant-db] sync customer group failed:", err?.message || err);
            });
        }
        clearHeavyListCache();
        res.json(r[0]);
    } catch (e) {
        if (String(e).includes("unique")) return res.status(400).json({ error: "Name exists" });
        throw e;
    }
}

export async function deleteGroup(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
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
        res.status(500).json({ error: "group_create_failed", details: { message: String(e?.message || "group_create_failed") } });
    } finally {
        client.release();
    }
}

export async function getGroupMembers(req, res) {
    const gid = parseInt(req.params.id, 10);
    if (!isPlatformAdminUser(req.user)) {
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
    if (!isPlatformAdminUser(req.user)) {
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
    try {
        await assertGroupAllowsUserManagementForAnyActor(gid);
    } catch (err) {
        return res.status(err.statusCode || 403).json({ error: err.message });
    }
    if (!isPlatformAdminUser(req.user)) {
        const group = await loadGroupForAdminAction(gid);
        const entitlements = normalizeGroupEntitlements(group?.entitlements || {});
        if (entitlements.maxUsers && userIds.length > entitlements.maxUsers) {
            return res.status(403).json({ error: "group_user_limit_exceeded", maxUsers: entitlements.maxUsers });
        }
    }
    const previousUserIds = isTenantDbIsolationEnabled()
        ? (await query("SELECT user_id FROM user_groups WHERE group_id = $1", [gid])).map((r) => Number(r.user_id))
        : [];
    const adminRows = await query("SELECT user_id FROM user_groups WHERE group_id = $1 AND is_admin = TRUE", [gid]);
    const adminIds = new Set(adminRows.map((r) => Number(r.user_id)));
    const nextSetPreview = new Set((userIds || []).map((id) => Number(id)));
    const retainedAdmins = [...adminIds].filter((adminId) => nextSetPreview.has(adminId));
    if (!retainedAdmins.length) {
        return res.status(400).json({ error: "one_group_admin_required" });
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
        if (isTenantDbIsolationEnabled()) {
            const nextSet = new Set(userIds.map((id) => Number(id)));
            for (const uid of nextSet) {
                await syncCustomerPrincipalToTenant({ groupId: gid, userId: uid }).catch((err) => {
                    console.error("[tenant-db] sync group member failed:", err?.message || err);
                });
            }
            for (const uid of previousUserIds) {
                if (!nextSet.has(uid)) {
                    await removeCustomerPrincipalFromTenant({ groupId: gid, userId: uid }).catch((err) => {
                        console.error("[tenant-db] remove group member failed:", err?.message || err);
                    });
                }
            }
        }
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
    try {
        await assertGroupAllowsUserManagementForAnyActor(gid);
    } catch (err) {
        return res.status(err.statusCode || 403).json({ error: err.message });
    }
    if (!isPlatformAdminUser(req.user)) {
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
    if (isTenantDbIsolationEnabled()) {
        await syncCustomerPrincipalToTenant({ groupId: gid, userId }).catch((err) => {
            console.error("[tenant-db] sync customer principal failed:", err?.message || err);
        });
    }
    clearHeavyListCache();
    res.json({ success: true });
}

export async function removeUserFromGroup(req, res) {
    const gid = parseInt(req.params.id, 10);
    if (!isPlatformAdminUser(req.user)) {
        const adminGroups = await getAdminGroups(req.user.id);
        if (!adminGroups.includes(gid)) return res.status(403).json({ error: "Forbidden" });
        try {
            await assertGroupCanManageUsers(gid);
        } catch (err) {
            return res.status(err.statusCode || 403).json({ error: err.message });
        }
    }
    const { userId } = req.params;
    const membershipRows = await query(
        "SELECT is_admin FROM user_groups WHERE group_id = $1 AND user_id = $2 LIMIT 1",
        [gid, userId]
    );
    if (membershipRows.length && !!membershipRows[0].is_admin) {
        const adminCountRows = await query("SELECT COUNT(*)::int AS c FROM user_groups WHERE group_id = $1 AND is_admin = TRUE", [gid]);
        const adminCount = Number(adminCountRows?.[0]?.c || 0);
        if (adminCount <= 1) {
            return res.status(400).json({ error: "one_group_admin_required" });
        }
    }
    await query("DELETE FROM user_groups WHERE group_id=$1 AND user_id=$2", [gid, userId]);
    if (isTenantDbIsolationEnabled()) {
        await removeCustomerPrincipalFromTenant({ groupId: gid, userId }).catch((err) => {
            console.error("[tenant-db] remove customer principal failed:", err?.message || err);
        });
    }
    clearHeavyListCache();
    res.json({ success: true });
}

export async function toggleGroupAdmin(req, res) {
    const { id: gid, userId } = req.params;
    const { isAdmin } = req.body;

    try {
        if (!isPlatformAdminUser(req.user)) {
            const adminGroups = await getAdminGroups(req.user.id);
            if (!adminGroups.includes(Number(gid))) return res.status(403).json({ error: "Forbidden" });
            const group = await loadGroupForAdminAction(gid);
            if (!groupHasFeature(group, "manageGroupAdmins")) {
                return res.status(403).json({ error: "feature_not_enabled:manageGroupAdmins" });
            }
        }

        const numericGroupId = Number.parseInt(gid, 10);
        const numericUserId = Number.parseInt(userId, 10);
        if (!Number.isInteger(numericGroupId) || !Number.isInteger(numericUserId)) {
            return res.status(400).json({ error: "invalid_group_or_user_id" });
        }
        const membership = await query(
            "SELECT 1 FROM user_groups WHERE group_id = $1 AND user_id = $2 LIMIT 1",
            [numericGroupId, numericUserId]
        );
        if (!membership.length) return res.status(404).json({ error: "membership_not_found" });

        if (!!isAdmin) {
            const client = await getClient();
            try {
                await client.query("BEGIN");
                await client.query("UPDATE user_groups SET is_admin = FALSE WHERE group_id = $1", [numericGroupId]);
                await client.query("UPDATE user_groups SET is_admin = TRUE WHERE group_id = $1 AND user_id = $2", [numericGroupId, numericUserId]);
                await client.query("COMMIT");
            } catch (txErr) {
                await client.query("ROLLBACK").catch(() => {});
                throw txErr;
            } finally {
                client.release();
            }
        } else {
            const currentRows = await query(
                "SELECT is_admin FROM user_groups WHERE group_id = $1 AND user_id = $2 LIMIT 1",
                [numericGroupId, numericUserId]
            );
            if (currentRows.length && !!currentRows[0].is_admin) {
                const adminCountRows = await query("SELECT COUNT(*)::int AS c FROM user_groups WHERE group_id = $1 AND is_admin = TRUE", [numericGroupId]);
                const adminCount = Number(adminCountRows?.[0]?.c || 0);
                if (adminCount <= 1) return res.status(400).json({ error: "one_group_admin_required" });
            }
            await query(
                "UPDATE user_groups SET is_admin = FALSE WHERE group_id = $1 AND user_id = $2",
                [numericGroupId, numericUserId]
            );
        }
        if (isTenantDbIsolationEnabled()) {
            await syncCustomerPrincipalToTenant({ groupId: numericGroupId, userId: numericUserId }).catch((err) => {
                console.error("[tenant-db] sync group admin flag failed:", err?.message || err);
            });
        }
        clearHeavyListCache();
        res.json({ success: true });
    } catch (e) {
        console.error("toggleGroupAdmin error:", e);
        res.status(500).json({ error: "add_user_to_group_failed", details: { message: String(e?.message || "add_user_to_group_failed") } });
    }
}

export async function getGroupSheets(req, res) {
    const gid = parseInt(req.params.id, 10);
    if (!isPlatformAdminUser(req.user)) {
        const adminGroups = await getAdminGroups(req.user.id);
        if (!adminGroups.includes(gid)) return res.status(403).json({ error: "Forbidden" });
    }
    const rows = await query(
        `SELECT DISTINCT s.id, s.filename, s.display_name, s.uploaded_at,
                s.report_source_id, rs.name AS report_source_name
         FROM sheets s
         LEFT JOIN report_sources rs ON rs.id = s.report_source_id
         WHERE (
            EXISTS (
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
