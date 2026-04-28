import { query, getClient } from "../config/db.js";
import { hashPassword, generateComplexPassword } from "../utils/security.js";
import { decryptSettingValue, encryptSettingValue } from "../utils/settingsCrypto.js";
import { parsePagination } from "../utils/pagination.js";

const EXPOSE_TEMP_PASSWORDS = process.env.EXPOSE_TEMP_PASSWORDS
    ? process.env.EXPOSE_TEMP_PASSWORDS === "true"
    : process.env.NODE_ENV !== "production";
const ALLOWED_ROLES = new Set(["admin", "user"]);
const HEAVY_LIST_CACHE = new Map();
const HEAVY_LIST_CACHE_TTL_MS = Number.parseInt(process.env.HEAVY_LIST_CACHE_TTL_MS || "20000", 10);
const HEAVY_LIST_CACHE_MAX = Number.parseInt(process.env.HEAVY_LIST_CACHE_MAX || "200", 10);
const ENABLE_STORAGE_USAGE_METRICS = String(process.env.ENABLE_STORAGE_USAGE_METRICS || "").toLowerCase() === "true";

function normalizeRole(value, fallback = "user") {
    const normalized = String(value || fallback).trim().toLowerCase();
    return ALLOWED_ROLES.has(normalized) ? normalized : null;
}

function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
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

async function getAdminGroups(userId) {
    const res = await query('SELECT group_id FROM user_groups WHERE user_id = $1 AND is_admin = TRUE', [userId]);
    return res.map(r => r.group_id);
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
    if (!desiredRole) return res.status(400).json({ error: "invalid_role" });
    if (!isGlobalAdmin) {
        const adminGroups = await getAdminGroups(req.user.id);
        if (!adminGroups.length) return res.status(403).json({ error: "Forbidden" });
        if (desiredRole !== "user") return res.status(403).json({ error: "Forbidden" });
    }
    const { email, password, role, firstName, lastName, company } = req.body;
    const emailText = normalizeEmail(email);
    const firstNameText = String(firstName || "").trim();
    const lastNameText = String(lastName || "").trim();
    const companyText = String(company || "").trim();
    if (!emailText || !firstNameText || !lastNameText || !companyText) {
        return res.status(400).json({ error: "first_name_last_name_email_company_required" });
    }

    const temporaryPassword = password || generateComplexPassword(16);
    const hashedFn = await hashPassword(temporaryPassword);

    try {
        const created = await query(
            "INSERT INTO users (email, password, role, first_name, last_name, company, password_reset_required) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, email, role, first_name, last_name, company",
            [emailText, hashedFn, desiredRole, firstNameText, lastNameText, companyText, true]
        );
        const payload = { ...created[0] };
        if (EXPOSE_TEMP_PASSWORDS) payload.newPassword = temporaryPassword;
        res.json(payload);
    } catch (e) {
        if (String(e).includes("unique constraint")) return res.status(400).json({ error: "Email exists" });
        res.status(500).json({ error: "failed" });
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
        const unmanagedGroups = await query(
            `SELECT group_id FROM user_groups WHERE user_id = $1 AND NOT (group_id = ANY($2::int[]))`, 
            [id, adminGroups]
        );
        if (unmanagedGroups.length > 0) {
            return res.status(403).json({ error: "Forbidden: User belongs to groups outside your admin scope." });
        }
    }

    try {
        // Handle password reset request
        if (reset) {
            const newPassword = generateComplexPassword(16);
            const hashed = await hashPassword(newPassword);
            await query("UPDATE users SET password=$1, password_reset_required=TRUE WHERE id=$2", [hashed, id]);
            return res.json(EXPOSE_TEMP_PASSWORDS ? { success: true, newPassword } : { success: true });
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

            // Instead of deleting globally, Group Admin only removes the user from ALL groups that the admin manages.
            await query(`DELETE FROM user_groups WHERE user_id = $1 AND group_id = ANY($2::int[])`, [id, adminGroups]);
            return res.json({ success: true, message: "User removed from your managed groups." });
        }

        // Global admin remains destructive
        await query("DELETE FROM users WHERE id=$1", [id]);
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
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    const rows = await query("SELECT value FROM app_settings WHERE key = 'google_integration' LIMIT 1", []);
    const enabled = rows.length ? !!rows[0]?.value?.enabled : true;
    res.json({ enabled });
}

export async function setGoogleIntegrationSetting(req, res) {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    const enabled = !!req.body?.enabled;
    await query(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ('google_integration', $1::jsonb, CURRENT_TIMESTAMP)
         ON CONFLICT (key)
         DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
        [JSON.stringify({ enabled })]
    );
    res.json({ success: true, enabled });
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

export async function getGoogleOauthSetting(req, res) {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    const rows = await query("SELECT value FROM app_settings WHERE key = 'google_oauth' LIMIT 1", []);
    const cfg = decryptOauthConfig(rows[0]?.value || {});
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
    });
}

export async function setGoogleOauthSetting(req, res) {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });

    const rows = await query("SELECT value FROM app_settings WHERE key = 'google_oauth' LIMIT 1", []);
    const current = decryptOauthConfig(rows[0]?.value || {});
    const next = normalizeOauthConfigForSave(current, req.body);

    await query(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ('google_oauth', $1::jsonb, CURRENT_TIMESTAMP)
         ON CONFLICT (key)
         DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
        [JSON.stringify(next)]
    );

    res.json({
        success: true,
        hasClientId: !!decryptSettingValue(next.clientId),
        hasClientSecret: !!decryptSettingValue(next.clientSecret),
        clientIdMasked: maskIfPresent(decryptSettingValue(next.clientId)),
        clientSecretMasked: maskIfPresent(decryptSettingValue(next.clientSecret)),
        redirectUri: next.redirectUri,
        frontendUrl: next.frontendUrl,
    });
}

export async function getDropboxIntegrationSetting(req, res) {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    const rows = await query("SELECT value FROM app_settings WHERE key = 'dropbox_integration' LIMIT 1", []);
    const enabled = rows.length ? !!rows[0]?.value?.enabled : true;
    res.json({ enabled });
}

export async function setDropboxIntegrationSetting(req, res) {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    const enabled = !!req.body?.enabled;
    await query(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ('dropbox_integration', $1::jsonb, CURRENT_TIMESTAMP)
         ON CONFLICT (key)
         DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
        [JSON.stringify({ enabled })]
    );
    res.json({ success: true, enabled });
}

export async function getDropboxOauthSetting(req, res) {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    const rows = await query("SELECT value FROM app_settings WHERE key = 'dropbox_oauth' LIMIT 1", []);
    const cfg = decryptOauthConfig(rows[0]?.value || {});
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
    });
}

export async function setDropboxOauthSetting(req, res) {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });

    const rows = await query("SELECT value FROM app_settings WHERE key = 'dropbox_oauth' LIMIT 1", []);
    const current = decryptOauthConfig(rows[0]?.value || {});
    const next = normalizeOauthConfigForSave(current, req.body);

    await query(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ('dropbox_oauth', $1::jsonb, CURRENT_TIMESTAMP)
         ON CONFLICT (key)
         DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
        [JSON.stringify(next)]
    );

    res.json({
        success: true,
        hasClientId: !!decryptSettingValue(next.clientId),
        hasClientSecret: !!decryptSettingValue(next.clientSecret),
        clientIdMasked: maskIfPresent(decryptSettingValue(next.clientId)),
        clientSecretMasked: maskIfPresent(decryptSettingValue(next.clientSecret)),
        redirectUri: next.redirectUri,
        frontendUrl: next.frontendUrl,
    });
}

export async function getOneDriveIntegrationSetting(req, res) {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    const rows = await query("SELECT value FROM app_settings WHERE key = 'onedrive_integration' LIMIT 1", []);
    const enabled = rows.length ? !!rows[0]?.value?.enabled : true;
    res.json({ enabled });
}

export async function setOneDriveIntegrationSetting(req, res) {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    const enabled = !!req.body?.enabled;
    await query(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ('onedrive_integration', $1::jsonb, CURRENT_TIMESTAMP)
         ON CONFLICT (key)
         DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
        [JSON.stringify({ enabled })]
    );
    res.json({ success: true, enabled });
}

export async function getOneDriveOauthSetting(req, res) {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    const rows = await query("SELECT value FROM app_settings WHERE key = 'onedrive_oauth' LIMIT 1", []);
    const cfg = decryptOauthConfig(rows[0]?.value || {});
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
    });
}

export async function setOneDriveOauthSetting(req, res) {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    const rows = await query("SELECT value FROM app_settings WHERE key = 'onedrive_oauth' LIMIT 1", []);
    const current = decryptOauthConfig(rows[0]?.value || {});
    const next = normalizeOauthConfigForSave(current, req.body);

    await query(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ('onedrive_oauth', $1::jsonb, CURRENT_TIMESTAMP)
         ON CONFLICT (key)
         DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
        [JSON.stringify(next)]
    );

    res.json({
        success: true,
        hasClientId: !!decryptSettingValue(next.clientId),
        hasClientSecret: !!decryptSettingValue(next.clientSecret),
        clientIdMasked: maskIfPresent(decryptSettingValue(next.clientId)),
        clientSecretMasked: maskIfPresent(decryptSettingValue(next.clientSecret)),
        redirectUri: next.redirectUri,
        frontendUrl: next.frontendUrl,
    });
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
        let sql;
        const params = [];
        if (ENABLE_STORAGE_USAGE_METRICS) {
            sql = `WITH group_folders AS (
                     SELECT DISTINCT fg.group_id, fg.folder_id
                     FROM folder_groups fg
                     UNION
                     SELECT g.id AS group_id, f.id AS folder_id
                     FROM groups g
                     JOIN folders f ON f.group_id = g.id
                   ),
                   folder_usage AS (
                     SELECT
                       s.folder_id,
                       COALESCE(SUM(pg_column_size(sr.row_data)), 0)::bigint AS total_size_bytes
                     FROM sheets s
                     LEFT JOIN sheet_rows sr ON sr.sheet_id = s.id
                     GROUP BY s.folder_id
                   ),
                   group_usage AS (
                     SELECT
                       gf.group_id,
                       COALESCE(SUM(fu.total_size_bytes), 0)::bigint AS used_storage_bytes
                     FROM group_folders gf
                     LEFT JOIN folder_usage fu ON fu.folder_id = gf.folder_id
                     GROUP BY gf.group_id
                   )
                   SELECT g.*,
                          COALESCE(gu.used_storage_bytes, 0)::bigint AS used_storage_bytes
                   FROM groups g
                   LEFT JOIN group_usage gu ON gu.group_id = g.id
                   ORDER BY g.id ASC`;
        } else {
            sql = `SELECT g.*, 0::bigint AS used_storage_bytes
                   FROM groups g
                   ORDER BY g.id ASC`;
        }
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
    let sql;
    if (ENABLE_STORAGE_USAGE_METRICS) {
        sql = `WITH group_folders AS (
                 SELECT DISTINCT fg.group_id, fg.folder_id
                 FROM folder_groups fg
                 WHERE fg.group_id = ANY($1::int[])
                 UNION
                 SELECT g.id AS group_id, f.id AS folder_id
                 FROM groups g
                 JOIN folders f ON f.group_id = g.id
                 WHERE g.id = ANY($1::int[])
               ),
               folder_usage AS (
                 SELECT
                   s.folder_id,
                   COALESCE(SUM(pg_column_size(sr.row_data)), 0)::bigint AS total_size_bytes
                 FROM sheets s
                 LEFT JOIN sheet_rows sr ON sr.sheet_id = s.id
                 GROUP BY s.folder_id
               ),
               group_usage AS (
                 SELECT
                   gf.group_id,
                   COALESCE(SUM(fu.total_size_bytes), 0)::bigint AS used_storage_bytes
                 FROM group_folders gf
                 LEFT JOIN folder_usage fu ON fu.folder_id = gf.folder_id
                 GROUP BY gf.group_id
               )
               SELECT g.*,
                      COALESCE(gu.used_storage_bytes, 0)::bigint AS used_storage_bytes
               FROM groups g
               LEFT JOIN group_usage gu ON gu.group_id = g.id
               WHERE g.id = ANY($1::int[])
               ORDER BY g.id ASC`;
    } else {
        sql = `SELECT g.*, 0::bigint AS used_storage_bytes
               FROM groups g
               WHERE g.id = ANY($1::int[])
               ORDER BY g.id ASC`;
    }
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
    try {
        const r = await query(
            "INSERT INTO groups (name, max_file_size_mb, max_total_storage_mb) VALUES ($1, $2, $3) RETURNING *",
            [name, maxFileSizeMb || 100, maxTotalStorageMb || 10240]
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
    try {
        const r = await query(
            "UPDATE groups SET name = COALESCE($1, name), max_file_size_mb = COALESCE($2, max_file_size_mb), max_total_storage_mb = COALESCE($3, max_total_storage_mb) WHERE id = $4 RETURNING *",
            [name, maxFileSizeMb, maxTotalStorageMb, id]
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
            return res.status(400).json({ error: "group_not_empty", message: "Cannot delete group with members. Remove all members first." });
        }
        
        // Cleanup other dependencies (folders might still exist, user didn't specify checking those, but permissions should be cleaned)
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
    }
    const { userIds } = req.body; // array
    if (!Array.isArray(userIds)) return res.status(400).json({ error: "invalid_format" });

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
    if (req.user.role !== "admin") {
        const adminGroups = await getAdminGroups(req.user.id);
        if (!adminGroups.includes(gid)) return res.status(403).json({ error: "Forbidden" });
    }
    const { userId } = req.body;
    await query("INSERT INTO user_groups (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [gid, userId]);
    clearHeavyListCache();
    res.json({ success: true });
}

export async function removeUserFromGroup(req, res) {
    const gid = parseInt(req.params.id, 10);
    if (req.user.role !== "admin") {
        const adminGroups = await getAdminGroups(req.user.id);
        if (!adminGroups.includes(gid)) return res.status(403).json({ error: "Forbidden" });
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
        `SELECT DISTINCT s.id, s.filename, s.display_name, s.uploaded_at, s.folder_id, f.name AS folder_name
         FROM sheets s
         LEFT JOIN folders f ON f.id = s.folder_id
         LEFT JOIN group_permissions gp ON gp.sheet_id = s.id AND gp.group_id = $1
         WHERE (
            EXISTS (SELECT 1 FROM folder_groups fg WHERE fg.folder_id = f.id AND fg.group_id = $1)
            OR f.group_id = $1 -- legacy compatibility
            OR (gp.group_id IS NOT NULL)
         )
         ORDER BY s.uploaded_at DESC`,
        [gid]
    );
    res.json(rows);
}

// --- Folders ---

export async function listFolders(req, res) {
    const pagination = parsePagination(req.query, { maxLimit: 1000 });
    if (pagination.error) return res.status(400).json({ error: pagination.error });
    const userId = Number(req.user?.id || 0);
    const role = String(req.user?.role || "");
    const pageTag = pagination.hasPagination ? `:l${pagination.limit}:o${pagination.offset}` : ":all";
    let cacheKey = `listFolders:${role}:${userId}:${ENABLE_STORAGE_USAGE_METRICS ? "usage" : "lite"}${pageTag}`;
    let rows;
    if (req.user.role === "admin") {
        const cached = getHeavyListCache(cacheKey);
        if (cached) return res.json(cached);
        const params = [];
        let sql;
        if (ENABLE_STORAGE_USAGE_METRICS) {
            sql = `
                WITH folder_usage AS (
                  SELECT
                    s.folder_id,
                    COUNT(DISTINCT s.id)::int AS sheet_count,
                    COALESCE(SUM(pg_column_size(sr.row_data)), 0)::bigint AS total_size_bytes
                  FROM sheets s
                  LEFT JOIN sheet_rows sr ON sr.sheet_id = s.id
                  GROUP BY s.folder_id
                )
                SELECT
                  f.id,
                  f.name,
                  f.parent_id,
                  f.created_at,
                  f.group_id AS legacy_group_id,
                  f.owner_user_id,
                  f.max_file_size_mb,
                  f.max_total_size_mb,
                  ou.email AS owner_user_email,
                  COALESCE(fu.sheet_count, 0) AS sheet_count,
                  COALESCE(fu.total_size_bytes, 0) AS total_size_bytes,
                  COALESCE(
                    ARRAY_AGG(DISTINCT fg.group_id) FILTER (WHERE fg.group_id IS NOT NULL),
                    ARRAY[]::INT[]
                  ) AS group_ids
                FROM folders f
                LEFT JOIN folder_groups fg ON fg.folder_id = f.id
                LEFT JOIN users ou ON ou.id = f.owner_user_id
                LEFT JOIN folder_usage fu ON fu.folder_id = f.id
                GROUP BY f.id, f.name, f.parent_id, f.created_at, f.group_id, f.owner_user_id, f.max_file_size_mb, f.max_total_size_mb, ou.email, fu.sheet_count, fu.total_size_bytes
                ORDER BY f.name ASC`;
        } else {
            sql = `
                SELECT
                  f.id,
                  f.name,
                  f.parent_id,
                  f.created_at,
                  f.group_id AS legacy_group_id,
                  f.owner_user_id,
                  f.max_file_size_mb,
                  f.max_total_size_mb,
                  ou.email AS owner_user_email,
                  0::int AS sheet_count,
                  0::bigint AS total_size_bytes,
                  COALESCE(
                    ARRAY_AGG(DISTINCT fg.group_id) FILTER (WHERE fg.group_id IS NOT NULL),
                    ARRAY[]::INT[]
                  ) AS group_ids
                FROM folders f
                LEFT JOIN folder_groups fg ON fg.folder_id = f.id
                LEFT JOIN users ou ON ou.id = f.owner_user_id
                GROUP BY f.id, f.name, f.parent_id, f.created_at, f.group_id, f.owner_user_id, f.max_file_size_mb, f.max_total_size_mb, ou.email
                ORDER BY f.name ASC`;
        }
        if (pagination.hasPagination) {
            sql += ` LIMIT $1 OFFSET $2`;
            params.push(pagination.limit, pagination.offset);
        }
        rows = await query(sql, params);
    } else {
        const adminGroups = await getAdminGroups(req.user.id);
        if (!adminGroups.length) return res.status(403).json({ error: "Forbidden" });
        cacheKey = `listFolders:${role}:${userId}:${[...adminGroups].sort((a, b) => a - b).join(",")}:${ENABLE_STORAGE_USAGE_METRICS ? "usage" : "lite"}${pageTag}`;
        const cached = getHeavyListCache(cacheKey);
        if (cached) return res.json(cached);
        const params = [adminGroups];
        let sql;
        if (ENABLE_STORAGE_USAGE_METRICS) {
            sql = `
                WITH folder_usage AS (
                  SELECT
                    s.folder_id,
                    COUNT(DISTINCT s.id)::int AS sheet_count,
                    COALESCE(SUM(pg_column_size(sr.row_data)), 0)::bigint AS total_size_bytes
                  FROM sheets s
                  LEFT JOIN sheet_rows sr ON sr.sheet_id = s.id
                  GROUP BY s.folder_id
                )
                SELECT
                  f.id,
                  f.name,
                  f.parent_id,
                  f.created_at,
                  f.group_id AS legacy_group_id,
                  f.owner_user_id,
                  f.max_file_size_mb,
                  f.max_total_size_mb,
                  ou.email AS owner_user_email,
                  COALESCE(fu.sheet_count, 0) AS sheet_count,
                  COALESCE(fu.total_size_bytes, 0) AS total_size_bytes,
                  COALESCE(
                    ARRAY_AGG(DISTINCT fg.group_id) FILTER (WHERE fg.group_id IS NOT NULL),
                    ARRAY[]::INT[]
                  ) AS group_ids
                FROM folders f
                LEFT JOIN folder_groups fg ON fg.folder_id = f.id
                LEFT JOIN users ou ON ou.id = f.owner_user_id
                LEFT JOIN folder_usage fu ON fu.folder_id = f.id
                WHERE (
                  f.group_id = ANY($1::int[])
                  OR EXISTS (
                    SELECT 1
                    FROM folder_groups fg2
                    WHERE fg2.folder_id = f.id
                      AND fg2.group_id = ANY($1::int[])
                  )
                )
                GROUP BY f.id, f.name, f.parent_id, f.created_at, f.group_id, f.owner_user_id, f.max_file_size_mb, f.max_total_size_mb, ou.email, fu.sheet_count, fu.total_size_bytes
                ORDER BY f.name ASC`;
        } else {
            sql = `
                SELECT
                  f.id,
                  f.name,
                  f.parent_id,
                  f.created_at,
                  f.group_id AS legacy_group_id,
                  f.owner_user_id,
                  f.max_file_size_mb,
                  f.max_total_size_mb,
                  ou.email AS owner_user_email,
                  0::int AS sheet_count,
                  0::bigint AS total_size_bytes,
                  COALESCE(
                    ARRAY_AGG(DISTINCT fg.group_id) FILTER (WHERE fg.group_id IS NOT NULL),
                    ARRAY[]::INT[]
                  ) AS group_ids
                FROM folders f
                LEFT JOIN folder_groups fg ON fg.folder_id = f.id
                LEFT JOIN users ou ON ou.id = f.owner_user_id
                WHERE (
                  f.group_id = ANY($1::int[])
                  OR EXISTS (
                    SELECT 1
                    FROM folder_groups fg2
                    WHERE fg2.folder_id = f.id
                      AND fg2.group_id = ANY($1::int[])
                  )
                )
                GROUP BY f.id, f.name, f.parent_id, f.created_at, f.group_id, f.owner_user_id, f.max_file_size_mb, f.max_total_size_mb, ou.email
                ORDER BY f.name ASC`;
        }
        if (pagination.hasPagination) {
            sql += ` LIMIT $2 OFFSET $3`;
            params.push(pagination.limit, pagination.offset);
        }
        rows = await query(sql, params);
    }

    const byId = new Map(rows.map(r => [r.id, r]));
    const pathCache = new Map();
    const buildPath = (folderId, seen = new Set()) => {
      if (!folderId || !byId.has(folderId)) return "";
      if (pathCache.has(folderId)) return pathCache.get(folderId);
      if (seen.has(folderId)) return byId.get(folderId).name; // cycle guard
      seen.add(folderId);
      const f = byId.get(folderId);
      const parentPath = f.parent_id ? buildPath(f.parent_id, seen) : "";
      const p = parentPath ? `${parentPath} / ${f.name}` : f.name;
      pathCache.set(folderId, p);
      return p;
    };

    const normalized = rows.map((r) => {
      const legacy = Number.isInteger(r.legacy_group_id) ? [r.legacy_group_id] : [];
      const gids = Array.from(new Set([...(r.group_ids || []), ...legacy]));
      return {
        ...r,
        group_ids: gids,
        path: buildPath(r.id),
      };
    });

    setHeavyListCache(cacheKey, normalized);
    res.json(normalized);
}

export async function createFolder(req, res) {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    const { name, groupId, groupIds, parentId, ownerUserId, maxFileSizeMb, maxTotalSizeMb } = req.body;
    try {
        const normalizedGroupIds = Array.isArray(groupIds)
          ? groupIds.map((g) => parseInt(g, 10)).filter((g) => Number.isInteger(g))
          : (groupId ? [parseInt(groupId, 10)].filter((g) => Number.isInteger(g)) : []);
        if (!String(name || "").trim()) return res.status(400).json({ error: "name_required" });
        if (!normalizedGroupIds.length) return res.status(400).json({ error: "group_required" });
        const parent = parentId ? parseInt(parentId, 10) : null;
        const ownerUser = ownerUserId ? parseInt(ownerUserId, 10) : null;
        const maxFile = Number.isFinite(Number(maxFileSizeMb)) ? Number(maxFileSizeMb) : 100;
        const maxTotal = Number.isFinite(Number(maxTotalSizeMb)) ? Number(maxTotalSizeMb) : 1024;

        const client = await getClient();
        try {
          await client.query("BEGIN");
          const r = await client.query(
            "INSERT INTO folders (name, group_id, parent_id, owner_user_id, max_file_size_mb, max_total_size_mb) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
            [name, normalizedGroupIds[0] || null, parent, ownerUser, maxFile, maxTotal]
          );
          const folder = r.rows[0];
          for (const gid of normalizedGroupIds) {
            await client.query(
              "INSERT INTO folder_groups (folder_id, group_id) VALUES ($1, $2) ON CONFLICT (folder_id, group_id) DO NOTHING",
              [folder.id, gid]
            );
          }
          await client.query("COMMIT");
          clearHeavyListCache();
          res.json({ ...folder, group_ids: normalizedGroupIds });
        } catch (e) {
          await client.query("ROLLBACK");
          throw e;
        } finally {
          client.release();
        }
    } catch {
        res.status(400).json({ error: "failed" });
    }
}

export async function updateFolder(req, res) {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    const folderId = parseInt(req.params.id, 10);
    if (!Number.isInteger(folderId)) return res.status(400).json({ error: "invalid_folder_id" });
    const { groupIds, maxFileSizeMb, maxTotalSizeMb } = req.body || {};
    try {
        const normalizedGroupIds = Array.isArray(groupIds)
          ? groupIds.map((g) => parseInt(g, 10)).filter((g) => Number.isInteger(g))
          : [];
        if (!normalizedGroupIds.length) return res.status(400).json({ error: "group_required" });
        const maxFile = Number.isFinite(Number(maxFileSizeMb)) ? Number(maxFileSizeMb) : 100;
        const maxTotal = Number.isFinite(Number(maxTotalSizeMb)) ? Number(maxTotalSizeMb) : 1024;

        const client = await getClient();
        try {
          await client.query("BEGIN");
          const updatedRows = await client.query(
            `UPDATE folders
             SET group_id = $1,
                 max_file_size_mb = $2,
                 max_total_size_mb = $3
             WHERE id = $4
             RETURNING *`,
            [normalizedGroupIds[0] || null, maxFile, maxTotal, folderId]
          );
          if (!updatedRows.rows.length) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "not_found" });
          }
          await client.query("DELETE FROM folder_groups WHERE folder_id = $1", [folderId]);
          for (const gid of normalizedGroupIds) {
            await client.query(
              "INSERT INTO folder_groups (folder_id, group_id) VALUES ($1, $2) ON CONFLICT (folder_id, group_id) DO NOTHING",
              [folderId, gid]
            );
          }
          await client.query("COMMIT");
          clearHeavyListCache();
          return res.json({ ...updatedRows.rows[0], group_ids: normalizedGroupIds });
        } catch (e) {
          await client.query("ROLLBACK");
          throw e;
        } finally {
          client.release();
        }
    } catch {
        return res.status(400).json({ error: "failed" });
    }
}

export async function deleteFolder(req, res) {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    await query("DELETE FROM folders WHERE id=$1", [req.params.id]);
    clearHeavyListCache();
    res.json({ success: true });
}

// --- Permissions ---

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
    res.json({ success: true });
}

export async function getGroupPermissions(req, res) {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    const { groupId, sheetId } = req.query;
    const rows = await query("SELECT * FROM group_permissions WHERE group_id=$1 AND sheet_id=$2", [groupId, sheetId]);
    if (!rows.length) return res.json({});
    res.json(rows[0]);
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
