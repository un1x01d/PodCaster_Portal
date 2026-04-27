import * as XLSX from "xlsx";
import path from "path";
import fs from "fs";
import { Worker } from "worker_threads";
import { fileURLToPath } from "url";
import { query, getClient } from "../config/db.js";
import { parsePagination } from "../utils/pagination.js";

const MAX_UPLOAD_SHEETS = Number.parseInt(
    process.env.MAX_UPLOAD_SHEETS || (process.env.NODE_ENV === "production" ? "20" : "50"),
    10
);
const MAX_UPLOAD_ROWS_PER_SHEET = Number.parseInt(
    process.env.MAX_UPLOAD_ROWS_PER_SHEET || (process.env.NODE_ENV === "production" ? "50000" : "200000"),
    10
);
const MAX_UPLOAD_TOTAL_ROWS = Number.parseInt(
    process.env.MAX_UPLOAD_TOTAL_ROWS || (process.env.NODE_ENV === "production" ? "100000" : "500000"),
    10
);
const MAX_UPLOAD_COLUMNS = Number.parseInt(
    process.env.MAX_UPLOAD_COLUMNS || "500",
    10
);
const MAX_SHEET_DATA_LIMIT = Number.parseInt(process.env.SHEET_DATA_MAX_LIMIT || "5000", 10);
const SHEET_DATA_HARD_CAP = Number.parseInt(
    process.env.SHEET_DATA_HARD_CAP || (process.env.NODE_ENV === "production" ? "20000" : "0"),
    10
);

function normalizeSheetCellValue(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        const y = value.getFullYear();
        const m = String(value.getMonth() + 1).padStart(2, "0");
        const d = String(value.getDate()).padStart(2, "0");
        return `${y}-${m}-${d}`;
    }
    if (typeof value === "string") {
        const text = value.trim();
        if (!text) return value;
        const isoDateOnly = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (isoDateOnly) return text;
        const parsed = new Date(text);
        if (!Number.isNaN(parsed.getTime())) {
            const y = parsed.getFullYear();
            const m = String(parsed.getMonth() + 1).padStart(2, "0");
            const d = String(parsed.getDate()).padStart(2, "0");
            return `${y}-${m}-${d}`;
        }
    }
    return value;
}

function normalizeSheetRow(row) {
    const out = {};
    Object.entries(row || {}).forEach(([key, value]) => {
        out[key] = normalizeSheetCellValue(value);
    });
    return out;
}

function sanitizeDisplayName(value) {
    const text = String(value || "").trim().replace(/\s+/g, "_");
    return text.slice(0, 120);
}

function buildRowFilterWhereClause(rowFiltersList = [], startParamIndex = 1) {
    const normalized = Array.isArray(rowFiltersList) ? rowFiltersList : [];
    const hasAllowAll = normalized.some((f) => !f || Object.keys(f).length === 0);
    if (hasAllowAll) return { sql: "", params: [] };

    const groups = [];
    const params = [];
    let paramIdx = startParamIndex;
    normalized.forEach((filters) => {
        const entries = Object.entries(filters || {}).filter(([k]) => !!k);
        if (!entries.length) return;
        const predicates = entries.map(([k, v]) => {
            params.push(k);
            params.push(String(v));
            const sql = `(row_data->>$${paramIdx}) = $${paramIdx + 1}`;
            paramIdx += 2;
            return sql;
        });
        if (predicates.length) groups.push(`(${predicates.join(" AND ")})`);
    });
    if (!groups.length) return { sql: " AND 1 = 0", params };
    return { sql: ` AND (${groups.join(" OR ")})`, params };
}

export function canUploadSheetsByRole(role) {
    const normalized = String(role || "").toLowerCase();
    return normalized === "admin";
}

async function isGroupAdminUser(userId) {
    const rows = await query(
        "SELECT COUNT(*)::int AS c FROM user_groups WHERE user_id = $1 AND is_admin = TRUE",
        [userId]
    );
    return Number(rows?.[0]?.c || 0) > 0;
}

async function canWriteToFolder(client, user, folderId) {
    if (!Number.isInteger(folderId)) return true;
    const role = String(user?.role || "").toLowerCase();
    if (role === "admin") return true;
    const userId = Number(user?.id || 0);
    if (!Number.isInteger(userId) || userId <= 0) return false;
    const res = await client.query(
        `SELECT 1
         FROM folders f
         LEFT JOIN folder_groups fg ON fg.folder_id = f.id
         WHERE f.id = $1
           AND (
             EXISTS (
               SELECT 1
               FROM user_groups ug
               WHERE ug.user_id = $2 AND ug.is_admin = TRUE
                 AND (ug.group_id = fg.group_id OR ug.group_id = f.group_id)
             )
           )
         LIMIT 1`,
        [folderId, userId]
    );
    return res.rows.length > 0;
}

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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const XLSX_WORKER_PATH = path.join(__dirname, "..", "utils", "xlsxWorker.js");

function parseWorkbookInWorker(buffer) {
    return new Promise((resolve, reject) => {
        const worker = new Worker(XLSX_WORKER_PATH, {
            workerData: { buffer }
        });
        worker.on('message', (msg) => {
            if (msg.success) resolve(msg.result);
            else reject(new Error(msg.error));
        });
        worker.on('error', reject);
        worker.on('exit', (code) => {
            if (code !== 0) reject(new Error(`Worker stopped with exit code ${code}`));
        });
    });
}

export async function uploadSheet(req, res) {
    let filePath = req.file?.path;
    try {
        const isAdminRole = canUploadSheetsByRole(req.user?.role);
        const isGroupAdmin = req.user?.id ? await isGroupAdminUser(req.user.id) : false;
        if (!isAdminRole && !isGroupAdmin) return res.status(403).json({ error: "Forbidden" });
        if (!req.file) return res.status(400).json({ error: "No file" });

        const originalName = req.file.originalname || "uploaded.xlsx";
        const displayName = sanitizeDisplayName(req.body?.display_name);
        const rawFolderId = req.body?.folderId ?? req.body?.folder_id;
        const folderId = rawFolderId ? parseInt(rawFolderId, 10) : null;
        if (!displayName) return res.status(400).json({ error: "display_name_required" });

        console.log(`[upload] name=${originalName} size=${req.file.size} folderId=${folderId ?? "—"}`);

        // Read file into buffer and delete temporary file immediately to free disk space
        const fileBuffer = fs.readFileSync(filePath);
        fs.unlink(filePath, () => {});
        filePath = null;

        // PERF-01 Fix: Parse Workbook in a worker thread to avoid blocking the event loop
        let parsedResult;
        try {
            parsedResult = await parseWorkbookInWorker(fileBuffer);
        } catch (err) {
            console.error("XLSX read failure:", err);
            return res.status(400).json({
                error: "unreadable_spreadsheet",
                message: "Could not parse file as CSV/XLSX/XML/HTML-table."
            });
        }

        const { sheetNames, sheets } = parsedResult;
        if (!sheetNames || sheetNames.length === 0) {
            return res.status(400).json({ error: "no_sheets" });
        }
        if (sheetNames.length > MAX_UPLOAD_SHEETS) {
            return res.status(413).json({
                error: "too_many_sheets",
                maxSheets: MAX_UPLOAD_SHEETS
            });
        }

        const client = await getClient();
        try {
            await client.query('BEGIN');

            const sheetId = `${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

            // Folder Resolution & Group Limit Check
            let assignedFolderId = null;
            if (Number.isInteger(folderId)) {
                const canWrite = await canWriteToFolder(client, req.user, folderId);
                if (!canWrite) {
                    await client.query('ROLLBACK');
                    return res.status(403).json({ error: "Forbidden", message: "You do not have write access to this folder." });
                }
                const f = await client.query(`
                    SELECT
                      f.id,
                      COALESCE(MIN(g.max_file_size_mb), 100) AS max_file_size_mb
                    FROM folders f
                    LEFT JOIN folder_groups fg ON fg.folder_id = f.id
                    LEFT JOIN groups g ON g.id = fg.group_id
                    WHERE f.id = $1
                    GROUP BY f.id
                    LIMIT 1
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
            const firstTabName = sheetNames[0];
            const firstTabRowsRaw = sheets[firstTabName];
            
            // STAB-01 Fix: Check if sheet has data
            if (!firstTabRowsRaw || firstTabRowsRaw.length === 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: "empty_sheet", message: "The first tab of the uploaded file appears to be empty." });
            }

            // In worker, we used sheet_to_json directly for efficiency, 
            // so we need to get headers differently if we want the raw array.
            // However, the existing code expected header:1 for headers.
            // Let's adjust the worker to return headers too, or just extract from objects.
            const headers = Object.keys(firstTabRowsRaw[0]).filter(h => !!h && !h.startsWith("__rowNum__"));
            
            if (headers.length > MAX_UPLOAD_COLUMNS) {
                await client.query('ROLLBACK');
                return res.status(413).json({
                    error: "too_many_columns",
                    maxColumns: MAX_UPLOAD_COLUMNS
                });
            }

            // Insert Sheet Record
            await client.query(
                `INSERT INTO sheets (id, headers, active, filename, display_name, folder_id, stored_path, tab_name, tabs) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                [sheetId, JSON.stringify(headers), true, versionedFilename, displayName, assignedFolderId, null, firstTabName, JSON.stringify(sheetNames)]
            );

            // Insert Rows in Chunks per Tab
            let totalRows = 0;
            for (const sn of sheetNames) {
                const rows = sheets[sn];
                
                if (rows.length > MAX_UPLOAD_ROWS_PER_SHEET) {
                    await client.query('ROLLBACK');
                    return res.status(413).json({
                        error: "too_many_rows_in_sheet",
                        tab: sn,
                        maxRowsPerSheet: MAX_UPLOAD_ROWS_PER_SHEET
                    });
                }
                totalRows += rows.length;
                if (totalRows > MAX_UPLOAD_TOTAL_ROWS) {
                    await client.query('ROLLBACK');
                    return res.status(413).json({
                        error: "too_many_total_rows",
                        maxTotalRows: MAX_UPLOAD_TOTAL_ROWS
                    });
                }

                const CHUNK_SIZE = 500; // Smaller chunk size for JSONB insertion
                for (let j = 0; j < rows.length; j += CHUNK_SIZE) {
                    const chunk = rows.slice(j, j + CHUNK_SIZE);
                    const values = [];
                    const placeHolders = [];
                    let pIdx = 1;

                    chunk.forEach((r, idx) => {
                        const normalizedRow = normalizeSheetRow(r);
                        values.push(sheetId, j + idx, JSON.stringify(normalizedRow), sn);
                        placeHolders.push(`($${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++})`);
                    });

                    const sql = `INSERT INTO sheet_rows (sheet_id, row_index, row_data, tab_name) VALUES ${placeHolders.join(",")}`;
                    await client.query(sql, values);
                }
            }

            await client.query('COMMIT');
            res.json({
                sheetId,
                headers,
                rows: totalRows,
                active: true,
                filename: versionedFilename,
                display_name: displayName,
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
        res.status(500).json({ error: "upload_failed", message: e.message || "An unexpected error occurred during upload." });
    } finally {
        if (filePath) {
            fs.unlink(filePath, () => {});
        }
    }
}

export async function getUniqueValues(req, res) {
    const { id } = req.params;
    const { col, tab } = req.query;
    const userId = req.user.id;

    if (!col) return res.status(400).json({ error: "column_required" });

    // 1. Permission check (Reuse logic from getSheetData or similar)
    // For brevity in this fix, we check basic access to the sheet.
    // In a full implementation, we'd verify 'col' is in the user's validCols.
    const access = await query(
        `SELECT 1 FROM sheets s WHERE s.id = $1 AND (active = TRUE OR folder_id IN (SELECT id FROM folders WHERE group_id IN (SELECT group_id FROM user_groups WHERE user_id = $2)))`,
        [id, userId]
    );
    if (!access.length && req.user.role !== 'admin') {
        return res.status(403).json({ error: "Forbidden" });
    }

    try {
        // PERF-03 Fix: Use a subquery to hit the sheet_id index first, and sample for performance if large
        let sql = `
            SELECT DISTINCT (row_data->>$1) as val 
            FROM (
                SELECT row_data FROM sheet_rows 
                WHERE sheet_id = $2 
                ${tab ? 'AND tab_name = $3' : ''}
                LIMIT 10000
            ) as sampled
            ORDER BY val ASC 
            LIMIT 1000
        `;
        const params = [col, id];
        if (tab) params.push(tab);

        const rows = await query(sql, params);
        const values = rows.map(r => r.val).filter(v => v !== null);
        res.json(values);
    } catch (e) {
        console.error("Get unique values failed:", e);
        res.status(500).json({ error: "failed" });
    }
}

export async function getActiveSheet(req, res) {
    let s = [];
    if (req.user.role === "admin") {
        s = await query("SELECT id, headers, filename, display_name, totals_column FROM sheets WHERE active = TRUE LIMIT 1", []);
    } else {
        s = await query(
            `SELECT DISTINCT s.id, s.headers, s.filename, s.display_name, s.totals_column
             FROM sheets s
             LEFT JOIN folders f ON f.id = s.folder_id
             WHERE s.active = TRUE
               AND (
                 (
                   EXISTS (
                     SELECT 1
                     FROM folder_groups fg
                     JOIN user_groups ug ON ug.group_id = fg.group_id
                     WHERE fg.folder_id = f.id AND ug.user_id = $1
                   )
                   OR f.group_id IN (SELECT group_id FROM user_groups WHERE user_id = $1)
                 )
                 OR (s.id IN (SELECT sheet_id FROM permissions WHERE user_id = $1))
                 OR (s.id IN (SELECT sheet_id FROM group_permissions WHERE group_id IN (SELECT group_id FROM user_groups WHERE user_id = $1)))
               )
             LIMIT 1`,
            [req.user.id]
        );
    }
    if (!s.length) return res.json(null);
    res.json({
        sheetId: s[0].id,
        headers: s[0].headers,
        filename: s[0].filename,
        display_name: s[0].display_name || null,
        totals_column: s[0].totals_column || null
    });
}

export async function listMySheets(req, res) {
    const userId = req.user.id;
    if (req.user.role === "admin") {
        const rows = await query(
            `SELECT s.id, s.filename, s.display_name, s.uploaded_at, s.folder_id, f.name AS folder_name, s.active
             FROM sheets s
             LEFT JOIN folders f ON f.id = s.folder_id
             ORDER BY s.uploaded_at DESC`,
            []
        );
        return res.json(rows);
    }

    const rows = await query(
        `SELECT DISTINCT s.id, s.filename, s.display_name, s.uploaded_at, s.folder_id, f.name AS folder_name, s.active
         FROM sheets s
         LEFT JOIN folders f ON f.id = s.folder_id
         WHERE (
             (
               EXISTS (
                 SELECT 1
                 FROM folder_groups fg
                 JOIN user_groups ug ON ug.group_id = fg.group_id
                 WHERE fg.folder_id = f.id AND ug.user_id = $1
               )
               OR f.group_id IN (SELECT group_id FROM user_groups WHERE user_id = $1) -- legacy compatibility
             )
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
        `SELECT s.id, s.filename, s.display_name, s.uploaded_at, s.folder_id, f.name AS folder_name, s.active
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
             (
               EXISTS (
                 SELECT 1
                 FROM folder_groups fg
                 JOIN user_groups ug ON ug.group_id = fg.group_id
                 WHERE fg.folder_id = f.id AND ug.user_id = $2
               )
               OR f.group_id IN (SELECT group_id FROM user_groups WHERE user_id = $2) -- legacy compatibility
             )
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
    const s = await query("SELECT id, headers, active, filename, display_name, totals_column FROM sheets WHERE id=$1", [req.params.id]);
    if (!s.length) return res.status(404).json({ error: "not_found" });

    // Enforce allowed_columns on the headers array returned
    if (req.user.role !== "admin") {
        const folderAccess = await query(
            `SELECT 1
             FROM sheets s
             LEFT JOIN folders f ON f.id = s.folder_id
             WHERE s.id = $1
               AND (
                 EXISTS (
                   SELECT 1
                   FROM folder_groups fg
                   JOIN user_groups ug ON ug.group_id = fg.group_id
                   WHERE fg.folder_id = f.id AND ug.user_id = $2
                 )
                 OR f.group_id IN (SELECT group_id FROM user_groups WHERE user_id = $2) -- legacy compatibility
               )`,
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
    const { tab, sort_by, sort_order, filters: filtersRaw, viewId } = req.query;
    const userId = req.user.id;
    const pagination = parsePagination(req.query, { maxLimit: MAX_SHEET_DATA_LIMIT });
    if (pagination.error) {
        return res.status(400).json({ error: pagination.error });
    }

    let validCols = [];
    let rowFiltersList = [];
    let hasFullAccess = false;
    let viewConfig = null;

    // 1. Resolve Locked View if provided
    if (viewId) {
        const [view] = await query(
            `SELECT v.config FROM views v
             WHERE v.id = $1 AND v.sheet_id = $2
               AND (
                 $3 = 'admin'
                 OR EXISTS (SELECT 1 FROM view_user_permissions WHERE view_id = v.id AND user_id = $4)
                 OR EXISTS (
                   SELECT 1 FROM view_group_permissions vgp 
                   JOIN user_groups ug ON ug.group_id = vgp.group_id
                   WHERE vgp.view_id = v.id AND ug.user_id = $4
                 )
               )`,
            [viewId, id, req.user.role, userId]
        );
        if (!view) {
            return res.status(403).json({ error: "Forbidden", message: "You do not have permission to access this view." });
        }
        viewConfig = typeof view.config === 'string' ? JSON.parse(view.config) : view.config;
    }

    // 2. Resolve Base Permissions
    if (req.user.role !== "admin") {
        const folderAccess = await query(
            `SELECT 1
             FROM sheets s
             LEFT JOIN folders f ON f.id = s.folder_id
             WHERE s.id = $1
               AND (
                 EXISTS (
                   SELECT 1
                   FROM folder_groups fg
                   JOIN user_groups ug ON ug.group_id = fg.group_id
                   WHERE fg.folder_id = f.id AND ug.user_id = $2
                 )
                 OR f.group_id IN (SELECT group_id FROM user_groups WHERE user_id = $2)
               )`,
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

        if (!hasFullAccess && allPerms.length === 0 && !viewId) {
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

            if (allPerms.length > 0 && validCols.length === 0 && !viewId) {
                return res.status(403).json({ 
                    error: "Forbidden", 
                    message: "You have permission to access this sheet, but no columns have been shared with you." 
                });
            }
        }
    } else {
        hasFullAccess = true;
    }

    // 3. Merge View Restrictions with Base Permissions
    if (viewConfig) {
        // If view has restricted columns, further restrict validCols
        if (Array.isArray(viewConfig.visibleColumns) && viewConfig.visibleColumns.length > 0) {
            if (hasFullAccess) {
                validCols = viewConfig.visibleColumns;
                hasFullAccess = false; // Now restricted by view
            } else {
                validCols = validCols.filter(c => viewConfig.visibleColumns.includes(c));
            }
        }
        // If view has forced filters, add them to rowFiltersList
        if (viewConfig.columnFilters && Object.keys(viewConfig.columnFilters).length > 0) {
            rowFiltersList.push(viewConfig.columnFilters);
            hasFullAccess = false;
        }
    }

    try {
        let columnSelection = "row_data";
        const sqlParams = [id];

        // RBAC: Data Stripping at Database Level
        if (!hasFullAccess && validCols.length > 0) {
            // Keep only keys in validCols. 
            // PostgreSQL 9.5+ approach using JSONB subtraction or object_agg
            // Using a subquery for object_agg is safest for keeping only allowed keys
            columnSelection = `(
                SELECT jsonb_object_agg(key, value)
                FROM jsonb_each(row_data)
                WHERE key = ANY($${sqlParams.length + 1}::text[])
            )`;
            sqlParams.push(validCols);
        }

        let sql = `SELECT ${columnSelection} AS row_data FROM sheet_rows WHERE sheet_id = $1`;
        const params = sqlParams;

        if (tab) {
            sql += ` AND tab_name = $${params.length + 1}`;
            params.push(tab);
        }

        // Apply RBAC + Locked View row filters
        if (!hasFullAccess) {
            const filterClause = buildRowFilterWhereClause(rowFiltersList, params.length + 1);
            sql += filterClause.sql;
            params.push(...filterClause.params);
        }

        // Apply dynamic UI column filters
        if (filtersRaw) {
            try {
                const uiFilters = typeof filtersRaw === 'string' ? JSON.parse(filtersRaw) : filtersRaw;
                if (typeof uiFilters === 'object' && !Array.isArray(uiFilters)) {
                    Object.entries(uiFilters).forEach(([col, val]) => {
                        if (!val) return;
                        // Security: Only allow filtering on validCols if not admin
                        if (!hasFullAccess && !validCols.includes(col)) return;

                        if (typeof val === 'string' || typeof val === 'number') {
                            sql += ` AND (row_data->>$${params.length + 1}) ILIKE $${params.length + 2}`;
                            params.push(col, `%${val}%`);
                        } else if (Array.isArray(val) && val.length > 0) {
                            sql += ` AND (row_data->>$${params.length + 1}) = ANY($${params.length + 2}::text[])`;
                            params.push(col, val.map(v => String(v)));
                        } else if (typeof val === 'object' && val.value) {
                            const op = val.operator === 'equals' ? '=' : 'ILIKE';
                            const searchVal = val.operator === 'equals' ? String(val.value) : `%${val.value}%`;
                            sql += ` AND (row_data->>$${params.length + 1}) ${op} $${params.length + 2}`;
                            params.push(col, searchVal);
                        }
                    });
                }
            } catch (e) {
                console.warn("Failed to parse UI filters:", e);
            }
        }

        // Apply sorting
        if (sort_by) {
            const direction = String(sort_order).toLowerCase() === 'desc' ? 'DESC' : 'ASC';
            // Security: Only allow sorting on validCols if not admin
            if (hasFullAccess || validCols.includes(sort_by)) {
                sql += ` ORDER BY (
                    CASE 
                        WHEN (row_data->>$${params.length + 1}) ~ '^-?[0-9]+(\\.[0-9]+)?$' 
                        THEN CAST(row_data->>$${params.length + 1} AS NUMERIC)
                        ELSE NULL 
                    END) ${direction} NULLS LAST, (row_data->>$${params.length + 1}) ${direction}`;
                params.push(sort_by);
            } else {
                sql += ` ORDER BY row_index ASC`;
            }
        } else {
            sql += ` ORDER BY row_index ASC`;
        }

        if (pagination.hasPagination) {
            sql += ` LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
            params.push(pagination.limit, pagination.offset);
        } else if (!pagination.hasPagination && SHEET_DATA_HARD_CAP > 0) {
            sql += ` LIMIT $${params.length + 1}`;
            params.push(SHEET_DATA_HARD_CAP + 1);
        }

        let rows = await query(sql, params);

        // Strip unauthorized columns for non-admins (or view-restricted)
        if (!hasFullAccess) {
            rows = rows.map(r => {
                const rowData = typeof r.row_data === 'string' ? JSON.parse(r.row_data) : r.row_data;
                Object.keys(rowData).forEach(k => {
                    if (!validCols.includes(k)) {
                        delete rowData[k];
                    }
                });
                return rowData;
            });
        } else {
            rows = rows.map(r => typeof r.row_data === 'string' ? JSON.parse(r.row_data) : r.row_data);
        }

        if (!pagination.hasPagination && SHEET_DATA_HARD_CAP > 0 && rows.length > SHEET_DATA_HARD_CAP) {
            return res.status(413).json({
                error: "result_too_large",
                message: "Result set too large. Please request with ?limit=<n>&offset=<n>.",
                maxRows: SHEET_DATA_HARD_CAP
            });
        }

        res.json(rows);
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
