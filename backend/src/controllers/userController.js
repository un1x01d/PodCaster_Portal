import { query, getClient } from "../config/db.js";
import { hashPassword, generateComplexPassword } from "../utils/security.js";

const EXPOSE_TEMP_PASSWORDS = process.env.EXPOSE_TEMP_PASSWORDS
    ? process.env.EXPOSE_TEMP_PASSWORDS === "true"
    : process.env.NODE_ENV !== "production";

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
    try {
        if (isGlobalAdmin) {
            const users = await query("SELECT id, email, role, default_view_id FROM users ORDER BY id ASC");
            return res.json(users);
        } else {
            const adminGroups = await getAdminGroups(req.user.id);
            if (!adminGroups.length) return res.status(403).json({ error: "Forbidden" });
            
            // Return users who share ANY handled group with the admin
            const users = await query(`
                SELECT DISTINCT u.id, u.email, u.role, u.default_view_id 
                FROM users u
                JOIN user_groups ug ON u.id = ug.user_id
                WHERE ug.group_id = ANY($1::int[])
                ORDER BY u.id ASC`, [adminGroups]);
            return res.json(users);
        }
    } catch (e) {
        console.error("listUsers error:", e);
        res.status(500).json({ error: "internal_error" });
    }
}

export async function createUser(req, res) {
    const isGlobalAdmin = req.user.role === "admin";
    if (!isGlobalAdmin) {
        const adminGroups = await getAdminGroups(req.user.id);
        if (!adminGroups.length) return res.status(403).json({ error: "Forbidden" });
        if (req.body.role === "admin") return res.status(403).json({ error: "Forbidden" });
    }
    const { email, password, role } = req.body;

    const temporaryPassword = password || generateComplexPassword(16);
    const hashedFn = await hashPassword(temporaryPassword);

    try {
        const created = await query(
            "INSERT INTO users (email, password, role, password_reset_required) VALUES ($1, $2, $3, $4) RETURNING id, email, role",
            [email, hashedFn, role || "producer", true]
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
    const { email, password, role, reset } = req.body;
    
    const isGlobalAdmin = req.user.role === "admin";
    if (!isGlobalAdmin) {
        const adminGroups = await getAdminGroups(req.user.id);
        if (!adminGroups.length) return res.status(403).json({ error: "Forbidden" });
        if (role === "admin") return res.status(403).json({ error: "Forbidden" });

        const target = await query("SELECT role FROM users WHERE id=$1", [id]);
        if (!target.length) return res.status(404).json({ error: "not_found" });
        if (target[0].role === "admin") return res.status(403).json({ error: "Forbidden" });

        const sharesGroup = await query(`SELECT 1 FROM user_groups ug WHERE ug.user_id = $1 AND ug.group_id = ANY($2::int[])`, [id, adminGroups]);
        if (!sharesGroup.length) return res.status(403).json({ error: "Forbidden" });
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

// --- Groups ---

export async function listGroups(req, res) {
    if (req.user.role === "admin") {
        const groups = await query("SELECT * FROM groups ORDER BY id ASC");
        return res.json(groups);
    }

    const adminGroups = await getAdminGroups(req.user.id);
    if (!adminGroups.length) return res.status(403).json({ error: "Forbidden" });

    const groups = await query(
        "SELECT * FROM groups WHERE id = ANY($1::int[]) ORDER BY id ASC",
        [adminGroups]
    );
    return res.json(groups);
}

export async function createGroup(req, res) {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    const { name, maxFileSizeMb } = req.body;
    try {
        const r = await query("INSERT INTO groups (name, max_file_size_mb) VALUES ($1, $2) RETURNING *", [name, maxFileSizeMb || 100]);
        res.json(r[0]);
    } catch (e) {
        if (String(e).includes("unique")) return res.status(400).json({ error: "Name exists" });
        throw e;
    }
}

export async function updateGroup(req, res) {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    const { id } = req.params;
    const { name, maxFileSizeMb } = req.body;
    try {
        const r = await query(
            "UPDATE groups SET name = COALESCE($1, name), max_file_size_mb = COALESCE($2, max_file_size_mb) WHERE id = $3 RETURNING *",
            [name, maxFileSizeMb, id]
        );
        if (!r.length) return res.status(404).json({ error: "not_found" });
        res.json(r[0]);
    } catch (e) {
        if (String(e).includes("unique")) return res.status(400).json({ error: "Name exists" });
        throw e;
    }
}

export async function deleteGroup(req, res) {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    const { id } = req.params;
    try {
        // Check for members
        const members = await query("SELECT 1 FROM user_groups WHERE group_id = $1 LIMIT 1", [id]);
        if (members.length > 0) {
            return res.status(400).json({ error: "group_not_empty", message: "Cannot delete group with members. Remove all members first." });
        }
        
        // Cleanup other dependencies (folders might still exist, user didn't specify checking those, but permissions should be cleaned)
        await query("DELETE FROM group_permissions WHERE group_id = $1", [id]);
        await query("DELETE FROM view_group_permissions WHERE group_id = $1", [id]);
        
        const r = await query("DELETE FROM groups WHERE id = $1 RETURNING *", [id]);
        if (!r.length) return res.status(404).json({ error: "not_found" });
        
        res.json({ success: true });
    } catch (e) {
        console.error("deleteGroup error:", e);
        res.status(500).json({ error: "internal_error" });
    }
}

export async function getGroupMembers(req, res) {
    const gid = parseInt(req.params.id, 10);
    if (req.user.role !== "admin") {
        const adminGroups = await getAdminGroups(req.user.id);
        if (!adminGroups.includes(gid)) return res.status(403).json({ error: "Forbidden" });
    }
    const rows = await query(
        `SELECT u.id, u.email, u.role, ug.is_admin
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
        
        // Insert new members (DO NOTHING if already exists)
        for (const uid of userIds) {
            await client.query(
                "INSERT INTO user_groups (group_id, user_id) VALUES ($1, $2) ON CONFLICT (user_id, group_id) DO NOTHING",
                [gid, uid]
            );
        }
        await client.query("COMMIT");
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
    res.json({ success: true });
}

export async function toggleGroupAdmin(req, res) {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    const { id: gid, userId } = req.params;
    const { isAdmin } = req.body;
    
    try {
        await query(
            "UPDATE user_groups SET is_admin = $1 WHERE group_id = $2 AND user_id = $3",
            [!!isAdmin, gid, userId]
        );
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
    let rows;
    if (req.user.role === "admin") {
        rows = await query(`
            SELECT
              f.id,
              f.name,
              f.parent_id,
              f.created_at,
              f.group_id AS legacy_group_id,
              COALESCE(
                ARRAY_AGG(DISTINCT fg.group_id) FILTER (WHERE fg.group_id IS NOT NULL),
                ARRAY[]::INT[]
              ) AS group_ids
            FROM folders f
            LEFT JOIN folder_groups fg ON fg.folder_id = f.id
            GROUP BY f.id, f.name, f.parent_id, f.created_at, f.group_id
            ORDER BY f.name ASC
        `);
    } else {
        const adminGroups = await getAdminGroups(req.user.id);
        if (!adminGroups.length) return res.status(403).json({ error: "Forbidden" });

        rows = await query(`
            SELECT
              f.id,
              f.name,
              f.parent_id,
              f.created_at,
              f.group_id AS legacy_group_id,
              COALESCE(
                ARRAY_AGG(DISTINCT fg.group_id) FILTER (WHERE fg.group_id IS NOT NULL),
                ARRAY[]::INT[]
              ) AS group_ids
            FROM folders f
            LEFT JOIN folder_groups fg ON fg.folder_id = f.id
            WHERE (
              f.group_id = ANY($1::int[])
              OR EXISTS (
                SELECT 1
                FROM folder_groups fg2
                WHERE fg2.folder_id = f.id
                  AND fg2.group_id = ANY($1::int[])
              )
            )
            GROUP BY f.id, f.name, f.parent_id, f.created_at, f.group_id
            ORDER BY f.name ASC
        `, [adminGroups]);
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

    res.json(normalized);
}

export async function createFolder(req, res) {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    const { name, groupId, groupIds, parentId } = req.body;
    try {
        const normalizedGroupIds = Array.isArray(groupIds)
          ? groupIds.map((g) => parseInt(g, 10)).filter((g) => Number.isInteger(g))
          : (groupId ? [parseInt(groupId, 10)].filter((g) => Number.isInteger(g)) : []);
        const parent = parentId ? parseInt(parentId, 10) : null;

        const client = await getClient();
        try {
          await client.query("BEGIN");
          const r = await client.query(
            "INSERT INTO folders (name, group_id, parent_id) VALUES ($1, $2, $3) RETURNING *",
            [name, normalizedGroupIds[0] || null, parent]
          );
          const folder = r.rows[0];
          for (const gid of normalizedGroupIds) {
            await client.query(
              "INSERT INTO folder_groups (folder_id, group_id) VALUES ($1, $2) ON CONFLICT (folder_id, group_id) DO NOTHING",
              [folder.id, gid]
            );
          }
          await client.query("COMMIT");
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
