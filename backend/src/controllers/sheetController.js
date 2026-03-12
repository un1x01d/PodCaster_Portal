import * as XLSX from "xlsx";
import path from "path";
import fs from "fs";
import { query, getClient } from "../config/db.js";

// Helper to determine active sheet versioning
async function getVersionedFilename(client, folderId, originalName) {
    if (!folderId) return originalName; // No versioning in root? Or just basic? adhering to original logic which only checked folder

    const ext = path.extname(originalName);
    const baseName = path.basename(originalName, ext);

    const existingFiles = await client.query(
        `SELECT filename FROM sheets WHERE folder_id = $1 AND filename LIKE $2`,
        [folderId, `${baseName}%`]
    );

    if (existingFiles.rows.length > 0) {
        let maxVersion = 0;
        const versionRegex = /\(v(\d+)\)/;

        existingFiles.rows.forEach(file => {
            if (file.filename === originalName) {
                maxVersion = Math.max(maxVersion, 1);
            }
            const match = file.filename.match(versionRegex);
            if (match) {
                maxVersion = Math.max(maxVersion, parseInt(match[1], 10));
            }
        });

        if (maxVersion > 0) {
            return `${baseName} (v${maxVersion + 1})${ext}`;
        }
    }
    return originalName;
}

export async function uploadSheet(req, res) {
    try {
        if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
        if (!req.file) return res.status(400).json({ error: "No file" });

        const originalName = req.file.originalname || "uploaded.xlsx";
        const folderId = req.body?.folderId ? parseInt(req.body.folderId, 10) : null;

        console.log(`[upload] name=${originalName} mime=${req.file.mimetype} folderId=${folderId ?? "—"}`);

        // Parse Workbook
        let wb;
        try {
            // Optimization: Use XLSX.readFile directly on the temp path to avoid loading buffer into JS memory twice
            wb = XLSX.readFile(req.file.path, { cellDates: true });
        } catch (eStr) {
            console.error("XLSX.readFile error:", eStr);
            const msg = String(eStr?.message || "unknown_error");
            if (msg.includes("Invalid HTML: could not find <table>")) {
                return res.status(422).json({
                    error: "html_without_tables",
                    message: "This file is HTML without <table>. Re-export as CSV/XLSX or include a table."
                });
            }
            return res.status(400).json({
                error: "unreadable_spreadsheet",
                message: "Could not parse file as CSV/XLSX/XML/HTML-table."
            });
        }

        const sheetNames = wb.SheetNames;
        if (!sheetNames || sheetNames.length === 0) {
            console.error("No sheets in workbook");
            return res.status(400).json({ error: "no_sheets" });
        }

        const client = await getClient();
        try {
            await client.query('BEGIN');

            // Deactivate all previous sheets
            await client.query("UPDATE sheets SET active = FALSE WHERE active = TRUE");

            const sheetId = `${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

            // Folder Resolution & Group Limit Check
            let assignedFolderId = null;
            if (Number.isInteger(folderId)) {
                const f = await client.query(`
                    SELECT f.id, g.max_file_size_mb 
                    FROM folders f 
                    JOIN groups g ON g.id = f.group_id 
                    WHERE f.id = $1 LIMIT 1
                `, [folderId]);
                
                if (f.rows.length) {
                    assignedFolderId = f.rows[0].id;
                    const limitMb = f.rows[0].max_file_size_mb || 100;
                    if (req.file.size > limitMb * 1024 * 1024) {
                        await client.query('ROLLBACK');
                        return res.status(413).json({ 
                            error: "file_too_large", 
                            message: `File exceeds group limit of ${limitMb}MB`,
                            maxMB: limitMb 
                        });
                    }
                }
            }

            // Versioning
            const versionedFilename = await getVersionedFilename(client, assignedFolderId, originalName);

            // Get headers from FIRST tab
            const firstTabRows = XLSX.utils.sheet_to_json(wb.Sheets[sheetNames[0]], { defval: "" });
            const headers = Object.keys(firstTabRows[0] || {});

            // Insert Sheet Record
            await client.query(
                `INSERT INTO sheets (id, headers, active, filename, folder_id, stored_path, tab_name, tabs) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [sheetId, JSON.stringify(headers), true, versionedFilename, assignedFolderId, null, sheetNames[0], JSON.stringify(sheetNames)]
            );

            // Insert Rows
            let totalRows = 0;
            for (const sn of sheetNames) {
                const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { defval: "" });
                const CHUNK_SIZE = 1000;
                for (let j = 0; j < rows.length; j += CHUNK_SIZE) {
                    const chunk = rows.slice(j, j + CHUNK_SIZE);
                    const values = [];
                    const placeHolders = [];
                    let pIdx = 1;

                    chunk.forEach((r, idx) => {
                        values.push(sheetId, j + idx, JSON.stringify(r), sn);
                        placeHolders.push(`($${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++})`);
                    });

                    const sql = `INSERT INTO sheet_rows (sheet_id, row_index, row_data, tab_name) VALUES ${placeHolders.join(",")}`;
                    await client.query(sql, values);
                }
                totalRows += rows.length;
            }

            await client.query('COMMIT');
            res.json({
                sheetId,
                headers,
                rows: totalRows,
                active: true,
                filename: versionedFilename,
                folderId: assignedFolderId,
                tabs: sheetNames
            });

        } catch (txErr) {
            await client.query('ROLLBACK');
            throw txErr;
        } finally {
            client.release();
        }

    } catch (e) {
        console.error("upload failed:", e);
        if (e?.code === "LIMIT_FILE_SIZE") {
            return res.status(413).json({ error: "file_too_large", maxMB: 100 });
        }
        res.status(500).json({ error: "upload_failed", message: "An unexpected error occurred during upload." });
    } finally {
        if (req.file && req.file.path) {
            fs.unlink(req.file.path, () => {});
        }
    }
}

export async function getActiveSheet(req, res) {
    const s = await query("SELECT id, headers, filename, totals_column FROM sheets WHERE active = TRUE LIMIT 1", []);
    if (!s.length) return res.json(null);
    res.json({ sheetId: s[0].id, headers: s[0].headers, filename: s[0].filename, totals_column: s[0].totals_column || null });
}

export async function listMySheets(req, res) {
    const userId = req.user.id;
    if (req.user.role === "admin") {
        const rows = await query(
            `SELECT s.id, s.filename, s.uploaded_at, s.folder_id, f.name AS folder_name, s.active
             FROM sheets s
             LEFT JOIN folders f ON f.id = s.folder_id
             ORDER BY s.uploaded_at DESC`,
            []
        );
        return res.json(rows);
    }

    const rows = await query(
        `SELECT DISTINCT s.id, s.filename, s.uploaded_at, s.folder_id, f.name AS folder_name, s.active
         FROM sheets s
         LEFT JOIN folders f ON f.id = s.folder_id
         WHERE (
             (f.group_id IN (SELECT group_id FROM user_groups WHERE user_id = $1))
             OR
             (s.id IN (SELECT sheet_id FROM permissions WHERE user_id = $1))
             OR 
             (s.id IN (SELECT sheet_id FROM group_permissions WHERE group_id IN (SELECT group_id FROM user_groups WHERE user_id = $1)))
         )
         ORDER BY s.uploaded_at DESC`,
        [userId]
    );
    res.json(rows);
}

export async function listAllSheets(req, res) {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    const rows = await query(
        `SELECT s.id, s.filename, s.uploaded_at, s.folder_id, f.name AS folder_name, s.active
         FROM sheets s
         LEFT JOIN folders f ON f.id = s.folder_id
         ORDER BY s.uploaded_at DESC`,
        []
    );
    res.json(rows);
}

async function checkSheetAccess(sheetId, user) {
    if (user.role === "admin") return true;
    const res = await query(
        `SELECT COUNT(s.id) FROM sheets s
         LEFT JOIN folders f ON f.id = s.folder_id
         WHERE s.id = $1 AND (
             (f.group_id IN (SELECT group_id FROM user_groups WHERE user_id = $2))
             OR
             (s.id IN (SELECT sheet_id FROM permissions WHERE user_id = $2))
             OR 
             (s.id IN (SELECT sheet_id FROM group_permissions WHERE group_id IN (SELECT group_id FROM user_groups WHERE user_id = $2)))
         )`,
        [sheetId, user.id]
    );
    return res[0].count !== '0';
}

export async function getSheetDetails(req, res) {
    const hasAccess = await checkSheetAccess(req.params.id, req.user);
    if (!hasAccess) return res.status(403).json({ error: "Forbidden" });
    const s = await query("SELECT id, headers, active, filename, totals_column FROM sheets WHERE id=$1", [req.params.id]);
    if (!s.length) return res.status(404).json({ error: "not_found" });

    // Enforce allowed_columns on the headers array returned
    if (req.user.role !== "admin") {
        const folderAccess = await query(
            `SELECT 1 FROM sheets s LEFT JOIN folders f ON f.id = s.folder_id WHERE s.id = $1 AND f.group_id IN (SELECT group_id FROM user_groups WHERE user_id = $2)`,
            [req.params.id, req.user.id]
        );
        if (folderAccess.length === 0) {
            const userPerms = await query(
                `SELECT allowed_columns FROM permissions WHERE user_id = $2 AND sheet_id = $1
                 UNION ALL
                 SELECT gp.allowed_columns FROM group_permissions gp
                 JOIN user_groups ug ON ug.group_id = gp.group_id
                 WHERE ug.user_id = $2 AND gp.sheet_id = $1`,
                [req.params.id, req.user.id]
            );
            let validCols = new Set();
            userPerms.forEach(p => {
                let cols = typeof p.allowed_columns === 'string' ? JSON.parse(p.allowed_columns) : (p.allowed_columns || []);
                if (cols.length) cols.forEach(c => validCols.add(c));
            });
            const validArray = Array.from(validCols);
            if (validArray.length > 0) {
                let currentHeaders = typeof s[0].headers === 'string' ? JSON.parse(s[0].headers) : s[0].headers;
                s[0].headers = currentHeaders.filter(h => validArray.includes(h));
            } else if (userPerms.length > 0) {
                s[0].headers = [];
            }
        }
    }

    res.json(s[0]);
}

export async function updateSheetDetails(req, res) {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    const { totals_column } = req.body || {};
    await query("UPDATE sheets SET totals_column = $1 WHERE id = $2", [totals_column || null, req.params.id]);
    res.json({ success: true });
}

export async function getSheetTabs(req, res) {
    try {
        const hasAccess = await checkSheetAccess(req.params.id, req.user);
        if (!hasAccess) return res.status(403).json({ error: "Forbidden" });
        const s = await query("SELECT tabs, tab_name FROM sheets WHERE id = $1", [req.params.id]);
        if (!s.length) return res.status(404).json({ error: "not_found" });
        const tabs = s[0].tabs || (s[0].tab_name ? [s[0].tab_name] : []);
        res.json({ tabs });
    } catch (e) {
        console.error("get tabs failed:", e);
        res.status(500).json({ error: "failed" });
    }
}

export async function getSheetData(req, res) {
    const { id } = req.params;
    const { tab } = req.query;
    const userId = req.user.id;

    let validCols = [];
    let rowFiltersList = [];
    let hasFullAccess = false;

    if (req.user.role !== "admin") {
        const folderAccess = await query(
            `SELECT 1 FROM sheets s LEFT JOIN folders f ON f.id = s.folder_id WHERE s.id = $1 AND f.group_id IN (SELECT group_id FROM user_groups WHERE user_id = $2)`,
            [id, userId]
        );
        if (folderAccess.length > 0) hasFullAccess = true;

        const userPerms = await query(
            `SELECT allowed_columns, row_filters FROM permissions WHERE user_id = $2 AND sheet_id = $1`,
            [id, userId]
        );
        const groupPerms = await query(
            `SELECT gp.allowed_columns, gp.row_filters FROM group_permissions gp JOIN user_groups ug ON ug.group_id = gp.group_id WHERE ug.user_id = $2 AND gp.sheet_id = $1`,
            [id, userId]
        );

        const allPerms = [...userPerms, ...groupPerms];

        if (!hasFullAccess && allPerms.length === 0) {
            return res.status(403).json({ error: "Forbidden", message: "You do not have permission to access this sheet." });
        }

        if (!hasFullAccess) {
            let allowedColsSet = new Set();
            allPerms.forEach(p => {
                let cols = typeof p.allowed_columns === 'string' ? JSON.parse(p.allowed_columns) : (p.allowed_columns || []);
                if (cols.length) cols.forEach(c => allowedColsSet.add(c));
                let filters = typeof p.row_filters === 'string' ? JSON.parse(p.row_filters) : (p.row_filters || {});
                rowFiltersList.push(filters);
            });
            validCols = Array.from(allowedColsSet);

            // Bug 3: If user has metadata access but no allowed columns, deny data access
            if (allPerms.length > 0 && validCols.length === 0) {
                return res.status(403).json({ 
                    error: "Forbidden", 
                    message: "You have permission to access this sheet, but no columns have been shared with you." 
                });
            }
        }
    } else {
        hasFullAccess = true;
    }

    try {
        let sql = `SELECT row_data FROM sheet_rows WHERE sheet_id = $1`;
        const params = [id];

        if (tab) {
            sql += ` AND tab_name = $2`;
            params.push(tab);
        }

        sql += ` ORDER BY row_index ASC`;

        let rows = await query(sql, params);

        if (!hasFullAccess) {
            rows = rows.filter(r => {
                let rowData = typeof r.row_data === 'string' ? JSON.parse(r.row_data) : r.row_data;

                let rowAllowed = false;
                for (const filters of rowFiltersList) {
                    const keys = Object.keys(filters);
                    if (keys.length === 0) {
                        rowAllowed = true;
                        break;
                    }
                    let match = true;
                    for (const key of keys) {
                        if (String(rowData[key]) !== String(filters[key])) {
                            match = false;
                            break;
                        }
                    }
                    if (match) {
                        rowAllowed = true;
                        break;
                    }
                }
                if (!rowAllowed) return false;

                if (validCols.length > 0) {
                    Object.keys(rowData).forEach(k => {
                        if (!validCols.includes(k)) {
                            delete rowData[k];
                        }
                    });
                } else {
                    rowData = {};
                }
                r.row_data = rowData;
                return true;
            });
        }

        res.json(rows.map(r => r.row_data));
    } catch (e) {
        console.error("Get sheet data failed:", e);
        res.status(500).json({ error: "failed" });
    }
}

export async function deleteSheet(req, res) {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    const { id } = req.params;
    const client = await getClient();

    try {
        await client.query("BEGIN");

        const s = await client.query("SELECT id, folder_id FROM sheets WHERE id = $1", [id]);
        if (!s.rows.length) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "not_found" });
        }

        // Delete permissions manually (no FK cascade in DB schema for these)
        await client.query("DELETE FROM permissions WHERE sheet_id = $1", [id]);
        await client.query("DELETE FROM group_permissions WHERE sheet_id = $1", [id]);

        // Bug 2: Cleanup views and their permissions
        const viewsRes = await client.query("SELECT id FROM views WHERE sheet_id = $1", [id]);
        const viewIds = viewsRes.rows.map(v => v.id);
        if (viewIds.length > 0) {
            await client.query("DELETE FROM view_user_permissions WHERE view_id = ANY($1::int[])", [viewIds]);
            await client.query("DELETE FROM view_group_permissions WHERE view_id = ANY($1::int[])", [viewIds]);
            await client.query("DELETE FROM views WHERE id = ANY($1::int[])", [viewIds]);
        }

        // Delete Sheet (Rows cascade via FK)
        await client.query("DELETE FROM sheets WHERE id = $1", [id]);

        await client.query("COMMIT");
        res.json({ success: true, id });

    } catch (e) {
        await client.query("ROLLBACK");
        console.error("Delete sheet failed:", e);
        res.status(500).json({ error: "delete_failed" });
    } finally {
        client.release();
    }
}
