import { query } from "../config/db.js";

export async function createView(req, res) {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    const { name, sheetId, config } = req.body || {};
    const r = await query(
        `INSERT INTO views (name, sheet_id, config, created_by)
         VALUES ($1,$2,$3,$4)
         RETURNING id, name, sheet_id, created_at`,
        [name, sheetId, JSON.stringify(config || {}), req.user.id]
    );
    res.json(r[0]);
}

export async function duplicateView(req, res) {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    const { id } = req.params;
    const { name } = req.body || {};
    if (!name) return res.status(400).json({ error: "name_required" });

    const [original] = await query("SELECT sheet_id, config FROM views WHERE id = $1", [id]);
    if (!original) return res.status(404).json({ error: "not_found" });

    const [newView] = await query(
        `INSERT INTO views (name, sheet_id, config, created_by)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, sheet_id, created_at`,
        [name, original.sheet_id, original.config, req.user.id]
    );
    res.json(newView);
}

export async function listViews(req, res) {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    const rows = await query(
        `SELECT v.id, v.name, v.sheet_id, u.email as created_by
         FROM views v
         JOIN users u ON u.id = v.created_by
         ORDER BY v.name ASC`
    );
    res.json(rows);
}

export async function deleteView(req, res) {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    const vid = req.params.id;
    try {
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
    if (req.user.role === "admin") {
        const rows = await query(
            `SELECT v.id, v.name, v.sheet_id, v.config, v.created_at, u.email as created_by
             FROM views v
             JOIN users u ON u.id = v.created_by
             WHERE v.sheet_id = $1
             ORDER BY v.name ASC`,
            [sheetId]
        );
        return res.json(rows);
    }

    // Checking permissions for non-admin
    const rows = await query(
        `SELECT v.id, v.name, v.sheet_id, v.config, v.created_at, u.email as created_by
         FROM views v
         JOIN users u ON u.id = v.created_by
         WHERE v.sheet_id = $1
           AND (
             EXISTS (
               SELECT 1 FROM view_user_permissions vup WHERE vup.view_id = v.id AND vup.user_id = $2
             )
             OR
             EXISTS (
               SELECT 1 FROM view_group_permissions vgp 
               JOIN user_groups ug ON ug.group_id = vgp.group_id
               WHERE vgp.view_id = v.id AND ug.user_id = $2
             )
           )
         ORDER BY v.name ASC`,
        [sheetId, req.user.id]
    );
    res.json(rows);
}

// View Permissions
export async function createViewUserPerm(req, res) {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    const { viewId, userId } = req.body;
    await query(`INSERT INTO view_user_permissions (view_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [viewId, userId]);
    res.json({ success: true });
}

export async function deleteViewUserPerm(req, res) {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    const { viewId, userId } = req.params;
    await query(`DELETE FROM view_user_permissions WHERE view_id=$1 AND user_id=$2`, [viewId, userId]);
    res.json({ success: true });
}

export async function getUserViewPerms(req, res) {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    const { userId } = req.params;
    const rows = await query(`SELECT view_id as id FROM view_user_permissions WHERE user_id=$1`, [userId]);
    res.json(rows);
}

export async function createViewGroupPerm(req, res) {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    const { viewId, groupId } = req.body;
    await query(`INSERT INTO view_group_permissions (view_id, group_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [viewId, groupId]);
    res.json({ success: true });
}

export async function deleteViewGroupPerm(req, res) {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    const { viewId, groupId } = req.params;
    await query(`DELETE FROM view_group_permissions WHERE view_id=$1 AND group_id=$2`, [viewId, groupId]);
    res.json({ success: true });
}

export async function getGroupViewPerms(req, res) {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    const { groupId } = req.params;
    const rows = await query(`SELECT view_id as id FROM view_group_permissions WHERE group_id=$1`, [groupId]);
    res.json(rows);
}
