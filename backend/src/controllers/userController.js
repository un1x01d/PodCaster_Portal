import { query } from "../config/db.js";
import { hashPassword, generateComplexPassword } from "../utils/security.js";

// --- Users ---

export async function listUsers(req, res) {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    const users = await query("SELECT id, email, role, default_view_id FROM users ORDER BY id ASC");
    res.json(users);
}

export async function createUser(req, res) {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    const { email, password, role } = req.body;

    // Hash password for new user
    const hashedFn = await hashPassword(password || "password123");

    try {
        const r = await query(
            "INSERT INTO users (email, password, role, password_reset_required) VALUES ($1, $2, $3, $4) RETURNING id, email, role",
            [email, hashedFn, role || "producer", true]
        );
        res.json(r[0]);
    } catch (e) {
        if (String(e).includes("unique constraint")) return res.status(400).json({ error: "Email exists" });
        throw e;
    }
}

export async function updateUser(req, res) {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    const { id } = req.params;
    const { email, password, role, reset } = req.body;

    // Handle password reset request
    if (reset) {
        const newPassword = generateComplexPassword(16);
        const hashed = await hashPassword(newPassword);
        await query("UPDATE users SET password=$1, password_reset_required=TRUE WHERE id=$2", [hashed, id]);
        return res.json({ success: true, newPassword });
    }

    // Dynamic partial update
    const fields = [];
    const values = [];
    let idx = 1;

    if (email !== undefined) {
        fields.push(`email=$${idx++}`);
        values.push(email);
    }
    if (role !== undefined) {
        fields.push(`role=$${idx++}`);
        values.push(role);
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
}

export async function deleteUser(req, res) {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    await query("DELETE FROM users WHERE id=$1", [req.params.id]);
    res.json({ success: true });
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

// --- Groups ---

export async function listGroups(req, res) {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    const groups = await query("SELECT * FROM groups ORDER BY id ASC");
    res.json(groups);
}

export async function createGroup(req, res) {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    const { name } = req.body;
    try {
        const r = await query("INSERT INTO groups (name) VALUES ($1) RETURNING *", [name]);
        res.json(r[0]);
    } catch (e) {
        if (String(e).includes("unique")) return res.status(400).json({ error: "Name exists" });
        throw e;
    }
}

export async function deleteGroup(req, res) {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    await query("DELETE FROM groups WHERE id=$1", [req.params.id]);
    res.json({ success: true });
}

export async function getGroupMembers(req, res) {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    const rows = await query(
        `SELECT u.id, u.email, u.role 
         FROM user_groups ug 
         JOIN users u ON u.id = ug.user_id 
         WHERE ug.group_id=$1
         ORDER BY u.email ASC`,
        [req.params.id]
    );
    res.json(rows);
}

export async function updateGroupMembers(req, res) {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    const { id } = req.params;
    const { userIds } = req.body; // array

    await query("DELETE FROM user_groups WHERE group_id=$1", [id]);
    for (const uid of userIds) {
        await query("INSERT INTO user_groups (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [id, uid]);
    }
    res.json({ success: true });
}

export async function addUserToGroup(req, res) {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    const { id } = req.params;
    const { userId } = req.body;
    await query("INSERT INTO user_groups (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [id, userId]);
    res.json({ success: true });
}

export async function removeUserFromGroup(req, res) {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    const { id, userId } = req.params;
    await query("DELETE FROM user_groups WHERE group_id=$1 AND user_id=$2", [id, userId]);
    res.json({ success: true });
}

export async function getGroupSheets(req, res) {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    const gid = Number(req.params.id);
    const rows = await query(
        `SELECT DISTINCT s.id, s.filename, s.uploaded_at, s.folder_id, f.name AS folder_name
         FROM sheets s
         LEFT JOIN folders f ON f.id = s.folder_id
         LEFT JOIN group_permissions gp ON gp.sheet_id = s.id AND gp.group_id = $1
         WHERE (f.group_id = $1) OR (gp.group_id IS NOT NULL)
         ORDER BY s.uploaded_at DESC`,
        [gid]
    );
    res.json(rows);
}

// --- Folders ---

export async function listFolders(req, res) {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    const rows = await query("SELECT * FROM folders ORDER BY name ASC");
    res.json(rows);
}

export async function createFolder(req, res) {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    const { name, groupId } = req.body;
    try {
        const r = await query(
            "INSERT INTO folders (name, group_id) VALUES ($1, $2) RETURNING *",
            [name, groupId || null]
        );
        res.json(r[0]);
    } catch {
        res.status(400).json({ error: "failed" });
    }
}

export async function deleteFolder(req, res) {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    await query("DELETE FROM folders WHERE id=$1", [req.params.id]);
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
