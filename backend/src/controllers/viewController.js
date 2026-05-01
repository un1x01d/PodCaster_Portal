import { query } from "../config/db.js";
import { checkSheetAccess } from "../utils/authorization.js";
import { parsePagination } from "../utils/pagination.js";

async function isGroupAdminUser(userId) {
    const rows = await query(
        "SELECT 1 FROM user_groups WHERE user_id = $1 AND is_admin = TRUE LIMIT 1",
        [userId]
    );
    return rows.length > 0;
}

async function getManagedGroupIds(userId) {
    const rows = await query(
        "SELECT group_id FROM user_groups WHERE user_id = $1 AND is_admin = TRUE",
        [userId]
    );
    return rows.map((r) => Number(r.group_id)).filter((id) => Number.isInteger(id) && id > 0);
}

async function assertCustomerAdminOwnsView(viewId, userId) {
    const rows = await query("SELECT id, created_by FROM views WHERE id = $1", [viewId]);
    const view = rows[0];
    if (!view) {
        const err = new Error("not_found");
        err.statusCode = 404;
        throw err;
    }
    if (Number(view.created_by) !== Number(userId)) {
        const err = new Error("Forbidden");
        err.statusCode = 403;
        throw err;
    }
    return view;
}

async function assertUserWithinManagedGroups(userId, managedGroupIds) {
    const rows = await query(
        `SELECT 1
         FROM user_groups
         WHERE user_id = $1
           AND group_id = ANY($2::int[])
         LIMIT 1`,
        [userId, managedGroupIds]
    );
    if (!rows.length) {
        const err = new Error("Forbidden");
        err.statusCode = 403;
        throw err;
    }
}

export async function createView(req, res) {
    const { name, sheetId, config, level = "revision" } = req.body || {};
    const isGlobalAdmin = req.user.role === "admin";
    const isCustomerAdmin = isGlobalAdmin ? true : await isGroupAdminUser(req.user.id);
    if (!isCustomerAdmin) return res.status(403).json({ error: "Forbidden" });
    if (!String(name || "").trim()) return res.status(400).json({ error: "name_required" });

    let report_source_id = null;
    let file_label = null;
    let sid = null;
    let is_global = false;

    if (!isGlobalAdmin && level === "global") {
        return res.status(403).json({ error: "Forbidden" });
    }

    if (!isGlobalAdmin) {
        if (!sheetId) return res.status(400).json({ error: "sheet_id_required" });
        const hasSheetAccess = await checkSheetAccess(sheetId, req.user);
        if (!hasSheetAccess) return res.status(403).json({ error: "Forbidden" });
    }

    if (level === "global") {
        is_global = true;
    } else if (sheetId) {
        // Resolve source/label from sheetId
        const [meta] = await query(
            "SELECT report_source_id, file_label FROM report_source_imports WHERE sheet_id = $1",
            [sheetId]
        );
        if (meta) {
            report_source_id = meta.report_source_id;
            file_label = meta.file_label;
        }

        if (level === "source") {
            if (!meta) return res.status(400).json({ error: "sheet_context_missing" });
            file_label = null;
        } else if (level === "file") {
            if (!meta) return res.status(400).json({ error: "sheet_context_missing" });
            // keep label
        } else {
            // revision level
            sid = sheetId;
            report_source_id = null;
            file_label = null;
        }
    }

    const r = await query(
        `INSERT INTO views (name, sheet_id, report_source_id, file_label, is_global, config, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id, name, sheet_id, report_source_id, file_label, is_global, created_at`,
        [name, sid, report_source_id, file_label, is_global, JSON.stringify(config || {}), req.user.id]
    );
    if (!isGlobalAdmin) {
        await query(
            `INSERT INTO view_user_permissions (view_id, user_id)
             VALUES ($1, $2)
             ON CONFLICT DO NOTHING`,
            [r[0].id, req.user.id]
        );
    }
    res.json(r[0]);
}

export async function duplicateView(req, res) {
    const isGlobalAdmin = req.user.role === "admin";
    const isCustomerAdmin = isGlobalAdmin ? true : await isGroupAdminUser(req.user.id);
    if (!isCustomerAdmin) return res.status(403).json({ error: "Forbidden" });
    const { id } = req.params;
    const { name } = req.body || {};
    if (!name) return res.status(400).json({ error: "name_required" });

    const [original] = await query(
        "SELECT sheet_id, report_source_id, file_label, is_global, config, created_by FROM views WHERE id = $1",
        [id]
    );
    if (!original) return res.status(404).json({ error: "not_found" });
    if (!isGlobalAdmin) {
        if (Number(original.created_by) !== Number(req.user.id)) return res.status(403).json({ error: "Forbidden" });
        if (original.is_global) return res.status(403).json({ error: "Forbidden" });
    }

    const [newView] = await query(
        `INSERT INTO views (name, sheet_id, report_source_id, file_label, is_global, config, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, name, sheet_id, report_source_id, file_label, is_global, created_at`,
        [
            name,
            original.sheet_id,
            original.report_source_id,
            original.file_label,
            !!original.is_global,
            original.config,
            req.user.id
        ]
    );
    if (!isGlobalAdmin) {
        await query(
            `INSERT INTO view_user_permissions (view_id, user_id)
             VALUES ($1, $2)
             ON CONFLICT DO NOTHING`,
            [newView.id, req.user.id]
        );
    }
    res.json(newView);
}

export async function listViews(req, res) {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    const pagination = parsePagination(req.query, { maxLimit: 1000 });
    if (pagination.error) return res.status(400).json({ error: pagination.error });
    const totalRows = await query("SELECT COUNT(*)::int AS c FROM views", []);
    const total = Number(totalRows[0]?.c || 0);
    const rows = await query(
        `SELECT v.id, v.name, v.sheet_id, u.email as created_by
         FROM views v
         JOIN users u ON u.id = v.created_by
         ORDER BY v.name ASC
         LIMIT $1 OFFSET $2`,
        [pagination.limit, pagination.offset]
    );
    res.set("X-Total-Count", String(total));
    res.set("X-Limit", String(pagination.limit));
    res.set("X-Offset", String(pagination.offset));
    res.json(rows);
}

export async function deleteView(req, res) {
    const isGlobalAdmin = req.user.role === "admin";
    const isCustomerAdmin = isGlobalAdmin ? true : await isGroupAdminUser(req.user.id);
    if (!isCustomerAdmin) return res.status(403).json({ error: "Forbidden" });
    const vid = req.params.id;
    try {
        if (!isGlobalAdmin) {
            const [existing] = await query("SELECT created_by FROM views WHERE id = $1", [vid]);
            if (!existing) return res.status(404).json({ error: "not_found" });
            if (Number(existing.created_by) !== Number(req.user.id)) {
                return res.status(403).json({ error: "Forbidden" });
            }
        }
        const r = await query(`DELETE FROM views WHERE id=$1 RETURNING id`, [vid]);
        if (!r.length) return res.status(404).json({ error: "not_found" });
        res.json({ success: true });
    } catch (e) {
        console.error("delete view failed:", e);
        res.status(500).json({ error: "delete_view_failed" });
    }
}

export async function getViewsForSheet(req, res) {
    const { sheetId } = req.params;
    const hasSheetAccess = await checkSheetAccess(sheetId, req.user);
    if (!hasSheetAccess) return res.status(403).json({ error: "Forbidden" });

    // First resolve the hierarchy context for this sheet
    const [meta] = await query(
        "SELECT report_source_id, file_label FROM report_source_imports WHERE sheet_id = $1",
        [sheetId]
    );
    const sourceId = meta?.report_source_id || -1;
    const fileLabel = meta?.file_label || "";

    const scopeFilter = `
        (
          v.is_global = TRUE
          OR (v.report_source_id = $1 AND v.file_label IS NULL AND v.sheet_id IS NULL)
          OR (v.report_source_id = $1 AND v.file_label = $2 AND v.sheet_id IS NULL)
          OR (v.sheet_id = $3)
        )
    `;

    if (req.user.role === "admin") {
        const rows = await query(
            `SELECT v.id, v.name, v.sheet_id, v.report_source_id, v.file_label, v.is_global, v.config, v.created_at, v.created_by AS created_by_id, u.email as created_by
             FROM views v
             JOIN users u ON u.id = v.created_by
             WHERE ${scopeFilter}
             ORDER BY v.is_global DESC, v.report_source_id ASC NULLS LAST, v.file_label ASC NULLS LAST, v.name ASC`,
            [sourceId, fileLabel, sheetId]
        );
        return res.json(rows);
    }

    // Checking permissions for non-admin
    const rows = await query(
        `SELECT v.id, v.name, v.sheet_id, v.report_source_id, v.file_label, v.is_global, v.config, v.created_at, v.created_by AS created_by_id, u.email as created_by
         FROM views v
         JOIN users u ON u.id = v.created_by
         WHERE ${scopeFilter}
           AND (
             v.created_by = $4
             OR
             EXISTS (
               SELECT 1 FROM view_user_permissions vup WHERE vup.view_id = v.id AND vup.user_id = $4
             )
           )
         ORDER BY v.is_global DESC, v.report_source_id ASC NULLS LAST, v.file_label ASC NULLS LAST, v.name ASC`,
        [sourceId, fileLabel, sheetId, req.user.id]
    );
    res.json(rows);
}

// View Permissions
export async function createViewUserPerm(req, res) {
    const { viewId, userId } = req.body || {};
    const normalizedViewId = Number.parseInt(viewId, 10);
    const normalizedUserId = Number.parseInt(userId, 10);
    if (!Number.isInteger(normalizedViewId) || !Number.isInteger(normalizedUserId)) {
        return res.status(400).json({ error: "invalid_request" });
    }

    if (req.user.role !== "admin") {
        const isCustomerAdmin = await isGroupAdminUser(req.user.id);
        if (!isCustomerAdmin) return res.status(403).json({ error: "Forbidden" });
        const managedGroupIds = await getManagedGroupIds(req.user.id);
        if (!managedGroupIds.length) return res.status(403).json({ error: "Forbidden" });
        try {
            await assertCustomerAdminOwnsView(normalizedViewId, req.user.id);
            await assertUserWithinManagedGroups(normalizedUserId, managedGroupIds);
        } catch (err) {
            return res.status(err.statusCode || 403).json({ error: err.message || "Forbidden" });
        }
    }

    await query(`INSERT INTO view_user_permissions (view_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [normalizedViewId, normalizedUserId]);
    res.json({ success: true });
}

export async function deleteViewUserPerm(req, res) {
    const { viewId, userId } = req.params;
    const normalizedViewId = Number.parseInt(viewId, 10);
    const normalizedUserId = Number.parseInt(userId, 10);
    if (!Number.isInteger(normalizedViewId) || !Number.isInteger(normalizedUserId)) {
        return res.status(400).json({ error: "invalid_request" });
    }

    if (req.user.role !== "admin") {
        const isCustomerAdmin = await isGroupAdminUser(req.user.id);
        if (!isCustomerAdmin) return res.status(403).json({ error: "Forbidden" });
        try {
            await assertCustomerAdminOwnsView(normalizedViewId, req.user.id);
        } catch (err) {
            return res.status(err.statusCode || 403).json({ error: err.message || "Forbidden" });
        }
    }

    await query(`DELETE FROM view_user_permissions WHERE view_id=$1 AND user_id=$2`, [normalizedViewId, normalizedUserId]);
    res.json({ success: true });
}

export async function getUserViewPerms(req, res) {
    const { userId } = req.params;
    const normalizedUserId = Number.parseInt(userId, 10);
    if (!Number.isInteger(normalizedUserId)) {
        return res.status(400).json({ error: "invalid_request" });
    }

    let rows;
    if (req.user.role === "admin") {
        rows = await query(`SELECT view_id as id FROM view_user_permissions WHERE user_id=$1`, [normalizedUserId]);
    } else {
        const isCustomerAdmin = await isGroupAdminUser(req.user.id);
        if (!isCustomerAdmin) return res.status(403).json({ error: "Forbidden" });
        const managedGroupIds = await getManagedGroupIds(req.user.id);
        if (!managedGroupIds.length) return res.status(403).json({ error: "Forbidden" });
        try {
            await assertUserWithinManagedGroups(normalizedUserId, managedGroupIds);
        } catch (err) {
            return res.status(err.statusCode || 403).json({ error: err.message || "Forbidden" });
        }
        rows = await query(
            `SELECT vup.view_id as id
             FROM view_user_permissions vup
             JOIN views v ON v.id = vup.view_id
             WHERE vup.user_id = $1
               AND v.created_by = $2`,
            [normalizedUserId, req.user.id]
        );
    }
    res.json(rows);
}
