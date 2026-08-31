export function createUserGroupRoutes(deps) {
const {
  query,
  isPlatformAdminUser,
  normalizeGroupEntitlements,
  DEFAULT_GROUP_ENTITLEMENTS,
  normalizeGroupRole,
  syncCustomerGroupToTenant,
  syncCustomerPrincipalToTenant,
  removeCustomerPrincipalFromTenant,
  provisionCustomerDatabase,
  resolveGroupAllowedColumns,
} = deps;
async function listGroups(req, res) {
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

async function createGroup(req, res) {
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

async function provisionGroupDatabase(req, res) {
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

async function updateGroup(req, res) {
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

async function deleteGroup(req, res) {
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

async function getGroupMembers(req, res) {
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

async function updateGroupMembers(req, res) {
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

async function addUserToGroup(req, res) {
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

async function removeUserFromGroup(req, res) {
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

async function toggleGroupAdmin(req, res) {
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

async function getGroupSheets(req, res) {
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

async function getUserKpiOverrides(req, res) {
    const sheetSignature = String(req.query?.sheetSignature || "").trim();
    if (!sheetSignature) return res.status(400).json({ error: "sheet_signature_required" });
    const key = `kpi_overrides:user:${req.user.id}:sheet:${sheetSignature}`;
    const rows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [key]);
    const value = rows?.[0]?.value;
    return res.json({ ok: true, key, value: value && typeof value === "object" ? value : {} });
}

async function setUserKpiOverrides(req, res) {
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
return {
  listGroups,
  createGroup,
  provisionGroupDatabase,
  updateGroup,
  deleteGroup,
  getGroupMembers,
  updateGroupMembers,
  addUserToGroup,
  removeUserFromGroup,
  toggleGroupAdmin,
  getGroupSheets,
  getUserKpiOverrides,
  setUserKpiOverrides,
};
}
