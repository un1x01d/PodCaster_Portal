import * as XLSX from "xlsx";
import path from "path";
import fs from "fs";
import { Worker } from "worker_threads";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import { forEachActiveTenantPool, query, getClient } from "../config/db.js";
import { parsePagination } from "../utils/pagination.js";
import {
    checkSheetAccess,
    hasReportSourceOwnerAccess,
    resolveAssignedViewForSheet,
    resolveViewColumnAllowlist as resolveViewColumnAllowlistFromAuth,
} from "../utils/authorization.js";
import { writeAuditLog } from "../utils/auditLog.js";
import { normalizeGroupEntitlements } from "../utils/entitlements.js";

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
// Durable DB-backed import queue controls (no external queue dependency).
const IMPORT_DB_QUEUE_ENABLED = !["0", "false", "no", "off"].includes(String(process.env.IMPORT_DB_QUEUE_ENABLED || "true").trim().toLowerCase());
const IMPORT_JOB_MAX_ATTEMPTS = Math.max(1, Number.parseInt(process.env.IMPORT_JOB_MAX_ATTEMPTS || "3", 10) || 3);
const IMPORT_JOB_LEASE_MS = Math.max(10000, Number.parseInt(process.env.IMPORT_JOB_LEASE_MS || "120000", 10) || 120000);
const IMPORT_JOB_POLL_MS = Math.max(500, Number.parseInt(process.env.IMPORT_JOB_POLL_MS || "2000", 10) || 2000);
const IMPORT_JOB_MAX_CLAIMS_PER_TICK = Math.max(1, Number.parseInt(process.env.IMPORT_JOB_MAX_CLAIMS_PER_TICK || "1", 10) || 1);
const IMPORT_JOB_PAYLOAD_TTL_HOURS = Math.max(1, Number.parseInt(process.env.IMPORT_JOB_PAYLOAD_TTL_HOURS || "24", 10) || 24);

let importWorkerTimer = null;
let importWorkerRunning = false;
let importWorkerOwnerId = null;

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

function sanitizeReportSourceName(value) {
    return String(value || "").trim().replace(/\s+/g, " ").slice(0, 160);
}

export function buildHeaderDiff(previousHeaders = [], nextHeaders = []) {
    const previous = normalizeStringArray(previousHeaders);
    const next = normalizeStringArray(nextHeaders);
    const previousSet = new Set(previous);
    const nextSet = new Set(next);
    return {
        previous,
        next,
        added: next.filter((h) => !previousSet.has(h)),
        removed: previous.filter((h) => !nextSet.has(h)),
        unchanged: next.filter((h) => previousSet.has(h)),
    };
}

function getSchemaStatus(diff) {
    if (!diff.previous.length) return "new";
    if (diff.added.length || diff.removed.length) return "changed";
    return "matched";
}

function getExplicitViewColumns(config, fallbackHeaders = []) {
    const parsed = parseJsonMaybe(config, {}) || {};
    const explicit = normalizeStringArray(
        parsed.visibleColumns ?? parsed.columns ?? parsed.allowedColumns ?? parsed.allowed_columns
    );
    if (explicit.length > 0) return explicit;
    return normalizeStringArray(fallbackHeaders);
}

function freezeViewConfigForRefresh(config, previousHeaders = [], nextHeaders = []) {
    const parsed = parseJsonMaybe(config, {}) || {};
    const previous = normalizeStringArray(previousHeaders);
    const next = normalizeStringArray(nextHeaders);
    const nextSet = new Set(next);
    const explicit = getExplicitViewColumns(parsed, previous);
    return {
        ...parsed,
        visibleColumns: explicit.filter((h) => nextSet.has(h)),
    };
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

function parseJsonMaybe(value, fallback) {
    if (typeof value !== "string") return value ?? fallback;
    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
}

function normalizeStringArray(value) {
    const parsed = parseJsonMaybe(value, value);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((v) => String(v || "").trim()).filter(Boolean);
}

export function canUploadSheetsByRole(role) {
    const normalized = String(role || "").toLowerCase();
    return normalized === "admin";
}

export function resolveViewColumnAllowlist(viewConfig, sheetHeaders = []) {
    return resolveViewColumnAllowlistFromAuth(viewConfig, sheetHeaders);
}

async function isGroupAdminUser(userId) {
    const rows = await query(
        "SELECT COUNT(*)::int AS c FROM user_groups WHERE user_id = $1 AND is_admin = TRUE",
        [userId]
    );
    return Number(rows?.[0]?.c || 0) > 0;
}

async function canWriteToReportSource(client, user, reportSourceId) {
    if (!Number.isInteger(reportSourceId)) return false;
    const role = String(user?.role || "").toLowerCase();
    if (role === "admin") return true;
    const userId = Number(user?.id || 0);
    if (!Number.isInteger(userId) || userId <= 0) return false;
    const res = await client.query(
        `SELECT 1
         FROM report_sources rs
         WHERE rs.id = $1
           AND rs.created_by = $2
         LIMIT 1`,
        [reportSourceId, userId]
    );
    return res.rows.length > 0;
}

async function resolveReportSourceForUpload(client, { reportSourceId, reportSourceName, user }) {
    const sourceId = Number.parseInt(reportSourceId, 10);
    if (Number.isInteger(sourceId) && sourceId > 0) {
        const source = await client.query(
            `SELECT rs.id, rs.name, rs.created_by, rs.current_sheet_id, s.headers AS current_headers
             FROM report_sources rs
             LEFT JOIN sheets s ON s.id = rs.current_sheet_id
             WHERE rs.id = $1`,
            [sourceId]
        );
        if (!source.rows.length) {
            const err = new Error("report_source_not_found");
            err.statusCode = 404;
            throw err;
        }
        const row = source.rows[0];
        const role = String(user?.role || "").toLowerCase();
        const userId = Number(user?.id || 0);
        if (role !== "admin" && row.created_by !== userId) {
            const err = new Error("report_source_forbidden");
            err.statusCode = 403;
            throw err;
        }
        return {
            id: row.id,
            name: row.name,
            previousSheetId: row.current_sheet_id || null,
            previousHeaders: typeof row.current_headers === "string" ? JSON.parse(row.current_headers) : (row.current_headers || []),
            isNew: false,
        };
    }

    const name = sanitizeReportSourceName(reportSourceName);
    if (!name) {
        const err = new Error("report_source_name_required");
        err.statusCode = 400;
        throw err;
    }
    const inserted = await client.query(
        `INSERT INTO report_sources (name, created_by, is_inferred, updated_at)
         VALUES ($1, $2, FALSE, CURRENT_TIMESTAMP)
         RETURNING id, name`,
        [name, user?.id || null]
    );
    return {
        id: inserted.rows[0].id,
        name: inserted.rows[0].name,
        previousSheetId: null,
        previousHeaders: [],
        isNew: true,
    };
}

async function loadReportSourceForImport(client, reportSourceId) {
    const sourceId = Number.parseInt(reportSourceId, 10);
    if (!Number.isInteger(sourceId) || sourceId <= 0) {
        const err = new Error("invalid_report_source_id");
        err.statusCode = 400;
        throw err;
    }
    const source = await client.query(
        `SELECT rs.id, rs.name, rs.current_sheet_id, s.headers AS current_headers
         FROM report_sources rs
         LEFT JOIN sheets s ON s.id = rs.current_sheet_id
         WHERE rs.id = $1
         FOR UPDATE`,
        [sourceId]
    );
    if (!source.rows.length) {
        const err = new Error("report_source_not_found");
        err.statusCode = 404;
        throw err;
    }
    const row = source.rows[0];
    return {
        id: row.id,
        name: row.name,
        previousSheetId: row.current_sheet_id || null,
        previousHeaders: typeof row.current_headers === "string" ? JSON.parse(row.current_headers) : (row.current_headers || []),
        isNew: false,
    };
}

async function carryForwardSourceSecurity(client, { previousSheetId, nextSheetId, previousHeaders, nextHeaders }) {
    if (!previousSheetId || !nextSheetId) return;
    const views = await client.query("SELECT id, config FROM views WHERE sheet_id = $1", [previousSheetId]);
    for (const view of views.rows) {
        const config = freezeViewConfigForRefresh(view.config, previousHeaders, nextHeaders);
        await client.query(
            "UPDATE views SET sheet_id = $1, config = $2 WHERE id = $3",
            [nextSheetId, JSON.stringify(config), view.id]
        );
    }
}

// Helper to determine active sheet versioning
async function getVersionedFilename(client, reportSourceId, originalName) {
    if (!reportSourceId) return originalName;

    const ext = path.extname(originalName);
    const baseName = path.basename(originalName, ext);

    const existingFiles = await client.query(
        `SELECT filename
           FROM sheets
          WHERE report_source_id = $1
            AND filename LIKE $2`,
        [reportSourceId, `${baseName}%`]
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
const XLSX_WORKER_TIMEOUT_MS = Number.parseInt(process.env.XLSX_WORKER_TIMEOUT_MS || "45000", 10);
const XLSX_WORKER_DEFAULT_MEMORY_MB = Number.parseInt(process.env.XLSX_WORKER_DEFAULT_MEMORY_MB || "512", 10);
const XLSX_WORKER_MIN_MEMORY_MB = Number.parseInt(process.env.XLSX_WORKER_MIN_MEMORY_MB || "64", 10);
const XLSX_WORKER_MAX_MEMORY_MB = Number.parseInt(process.env.XLSX_WORKER_MAX_MEMORY_MB || "4096", 10);

function uploadRequiresApproval(req) {
    const requested = req.body?.approval_required ?? req.body?.approvalRequired;
    if (requested !== undefined) {
        return ["1", "true", "yes", "on"].includes(String(requested || "").trim().toLowerCase());
    }
    return ["1", "true", "yes", "on"].includes(String(process.env.IMPORT_REQUIRE_APPROVAL || "").trim().toLowerCase());
}

function uploadUsesDbQueue(req) {
    const requested = req.body?.async_import ?? req.body?.asyncImport ?? req.body?.queue_import ?? req.body?.queueImport;
    if (requested !== undefined) {
        return ["1", "true", "yes", "on"].includes(String(requested || "").trim().toLowerCase());
    }
    return IMPORT_DB_QUEUE_ENABLED;
}

async function userCanApproveReportSource(client, user, reportSourceId) {
    if (String(user?.role || "").toLowerCase() === "admin") return true;
    return canWriteToReportSource(client, user, reportSourceId);
}

async function createImportJob(client, { id, mode, status = "running", stage = "processing", requestedBy, originalFilename, reportSourceId = null, maxAttempts = IMPORT_JOB_MAX_ATTEMPTS }) {
    await client.query(
        `INSERT INTO import_jobs
            (id, status, mode, stage, requested_by, report_source_id, original_filename, started_at, updated_at, max_attempts, attempts, next_attempt_at, lease_owner, lease_expires_at, error)
         VALUES
            ($1, $2, $3, $4, $5, $6, $7,
             CASE WHEN $2 = 'running' THEN CURRENT_TIMESTAMP ELSE NULL END,
             CURRENT_TIMESTAMP, GREATEST($8, 1), CASE WHEN $2 = 'running' THEN 1 ELSE 0 END,
             NULL, NULL, NULL, NULL)
         ON CONFLICT (id)
         DO UPDATE SET status = EXCLUDED.status,
                       mode = EXCLUDED.mode,
                       stage = EXCLUDED.stage,
                       requested_by = COALESCE(EXCLUDED.requested_by, import_jobs.requested_by),
                       report_source_id = COALESCE(EXCLUDED.report_source_id, import_jobs.report_source_id),
                       original_filename = COALESCE(EXCLUDED.original_filename, import_jobs.original_filename),
                       started_at = CASE
                           WHEN EXCLUDED.status = 'running' THEN COALESCE(import_jobs.started_at, CURRENT_TIMESTAMP)
                           ELSE import_jobs.started_at
                       END,
                       attempts = CASE
                           WHEN EXCLUDED.status = 'running' THEN GREATEST(import_jobs.attempts, 1)
                           ELSE import_jobs.attempts
                       END,
                       max_attempts = GREATEST(COALESCE(EXCLUDED.max_attempts, import_jobs.max_attempts, 1), 1),
                       next_attempt_at = NULL,
                       lease_owner = NULL,
                       lease_expires_at = NULL,
                       error = NULL,
                       updated_at = CURRENT_TIMESTAMP`,
        [id, status, mode, stage, requestedBy || null, reportSourceId, originalFilename || null, maxAttempts]
    );
}

async function finishImportJob(client, { id, status, reportSourceId, sheetId, importId, result, error }) {
    await client.query(
        `UPDATE import_jobs
            SET status = $2,
                stage = $3,
                report_source_id = $4,
                sheet_id = $5,
                import_id = $6,
                result = $7::jsonb,
                error = $8,
                finished_at = CURRENT_TIMESTAMP,
                lease_owner = NULL,
                lease_expires_at = NULL,
                next_attempt_at = NULL,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1`,
        [
            id,
            status,
            status,
            reportSourceId || null,
            sheetId || null,
            importId || null,
            JSON.stringify(result || {}),
            error || null,
        ]
    );
}

function jobBackoffMs(attempts) {
    const attempt = Math.max(1, Number(attempts || 1));
    return Math.min(5 * 60 * 1000, 2000 * (2 ** (attempt - 1)));
}

function isRetryableImportError(err) {
    if (!err) return false;
    if (Number.isInteger(err.statusCode) && err.statusCode >= 400 && err.statusCode < 500) return false;
    const code = String(err?.message || "").trim().toLowerCase();
    const nonRetryable = new Set([
        "invalid_report_source_id",
        "report_source_not_found",
        "report_source_forbidden",
        "report_source_name_required",
        "display_name_required",
        "unreadable_spreadsheet",
        "xlsx_worker_timeout",
        "no_sheets",
        "empty_sheet",
        "too_many_sheets",
        "too_many_columns",
        "too_many_rows_in_sheet",
        "too_many_total_rows",
        "xlsx_worker_memory_limit_exceeded",
    ]);
    return !nonRetryable.has(code);
}

function normalizeWorkerMemoryLimitMb(value, fallback = XLSX_WORKER_DEFAULT_MEMORY_MB) {
    const parsed = Number.parseInt(value, 10);
    const fallbackParsed = Number.parseInt(fallback, 10);
    const base = Number.isInteger(parsed) && parsed > 0
        ? parsed
        : (Number.isInteger(fallbackParsed) && fallbackParsed > 0 ? fallbackParsed : 512);
    const min = Math.max(16, Number.isInteger(XLSX_WORKER_MIN_MEMORY_MB) ? XLSX_WORKER_MIN_MEMORY_MB : 64);
    const max = Math.max(min, Number.isInteger(XLSX_WORKER_MAX_MEMORY_MB) ? XLSX_WORKER_MAX_MEMORY_MB : 4096);
    return Math.min(max, Math.max(min, base));
}

async function resolveTenantParseMemoryLimitMb(user) {
    const defaultLimit = normalizeWorkerMemoryLimitMb(null);
    const groupId = Number.parseInt(user?.customer_group_id ?? user?.group_id, 10);
    try {
        let rows = [];
        if (Number.isInteger(groupId) && groupId > 0) {
            rows = await query("SELECT entitlements FROM groups WHERE id = $1 LIMIT 1", [groupId]);
        } else if (Number.isInteger(Number(user?.id)) && Number(user?.id) > 0) {
            rows = await query(
                `SELECT g.entitlements
                   FROM groups g
                   JOIN user_groups ug ON ug.group_id = g.id
                  WHERE ug.user_id = $1
                  ORDER BY g.id ASC
                  LIMIT 1`,
                [user.id]
            );
        }
        const entitlements = normalizeGroupEntitlements(rows?.[0]?.entitlements || {});
        return normalizeWorkerMemoryLimitMb(entitlements.maxImportParseMemoryMb, defaultLimit);
    } catch (err) {
        console.warn("[upload] failed to resolve tenant parse memory limit:", err?.message || err);
        return defaultLimit;
    }
}

function parseWorkbookInWorker(buffer, { memoryLimitMb } = {}) {
    return new Promise((resolve, reject) => {
        const parseMemoryLimitMb = normalizeWorkerMemoryLimitMb(memoryLimitMb);
        const worker = new Worker(XLSX_WORKER_PATH, {
            workerData: { buffer, memoryLimitMb: parseMemoryLimitMb },
            resourceLimits: {
                maxOldGenerationSizeMb: parseMemoryLimitMb,
            },
        });
        let settled = false;
        const cleanup = () => {
            settled = true;
            clearTimeout(timer);
            worker.removeAllListeners();
        };
        const timer = setTimeout(async () => {
            if (settled) return;
            try {
                await worker.terminate();
            } catch {
                // Ignore terminate errors; timeout error is primary signal.
            }
            cleanup();
            reject(new Error("xlsx_worker_timeout"));
        }, XLSX_WORKER_TIMEOUT_MS);
        worker.on('message', (msg) => {
            if (settled) return;
            cleanup();
            if (msg.success) resolve(msg.result);
            else reject(new Error(msg.error));
        });
        worker.on('error', (err) => {
            if (settled) return;
            cleanup();
            if (String(err?.message || "").toLowerCase().includes("memory")) {
                reject(new Error("xlsx_worker_memory_limit_exceeded"));
                return;
            }
            reject(err);
        });
        worker.on('exit', (code) => {
            if (settled) return;
            cleanup();
            if (code !== 0) reject(new Error("xlsx_worker_memory_limit_exceeded"));
        });
    });
}

function toImportError(code, statusCode = 400, message = null) {
    const err = new Error(code);
    err.statusCode = statusCode;
    if (message) err.publicMessage = message;
    return err;
}

async function parseWorkbookBufferOrThrow(fileBuffer, options = {}) {
    try {
        return await parseWorkbookInWorker(fileBuffer, options);
    } catch (err) {
        if (String(err?.message || "") === "xlsx_worker_memory_limit_exceeded") {
            const mapped = toImportError(
                "xlsx_worker_memory_limit_exceeded",
                413,
                "Spreadsheet parsing exceeded this customer's memory limit. Reduce the file size/complexity or raise the customer import memory limit."
            );
            mapped.cause = err;
            throw mapped;
        }
        const mapped = toImportError(
            "unreadable_spreadsheet",
            400,
            "Could not parse file as CSV/XLSX/XML/HTML-table."
        );
        mapped.cause = err;
        throw mapped;
    }
}

async function executeImportFromParsedWorkbook({
    parsedResult,
    approvalRequired,
    importJobId,
    reportSourceId,
    reportSourceName,
    displayName,
    fileLabel,
    originalName,
    user,
    enforceOwnership = true,
}) {
    const { sheetNames, sheets, cleanup } = parsedResult || {};
    if (cleanup && (cleanup.formulasStripped || cleanup.metadataEntriesStripped)) {
        console.info(
            `[upload_cleanup] formulas_stripped=${Number(cleanup.formulasStripped || 0)} metadata_entries_stripped=${Number(cleanup.metadataEntriesStripped || 0)}`
        );
    }
    if (!sheetNames || sheetNames.length === 0) {
        throw toImportError("no_sheets", 400);
    }
    if (sheetNames.length > MAX_UPLOAD_SHEETS) {
        const err = toImportError("too_many_sheets", 413);
        err.details = { maxSheets: MAX_UPLOAD_SHEETS };
        throw err;
    }

    const client = await getClient();
    try {
        await client.query("BEGIN");

        let reportSource = null;
        if (enforceOwnership) {
            reportSource = await resolveReportSourceForUpload(client, {
                reportSourceId: reportSourceId || null,
                reportSourceName: reportSourceName || null,
                user,
            });
        } else {
            reportSource = await loadReportSourceForImport(client, reportSourceId);
        }

        const sheetId = `${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
        const firstTabName = sheetNames[0];
        const firstTabRowsRaw = sheets[firstTabName];
        if (!firstTabRowsRaw || firstTabRowsRaw.length === 0) {
            throw toImportError("empty_sheet", 400, "The first tab of the uploaded file appears to be empty.");
        }

        const headers = Object.keys(firstTabRowsRaw[0]).filter((h) => !!h && !h.startsWith("__rowNum__"));
        if (headers.length > MAX_UPLOAD_COLUMNS) {
            const err = toImportError("too_many_columns", 413);
            err.details = { maxColumns: MAX_UPLOAD_COLUMNS };
            throw err;
        }

        const versionedFilename = await getVersionedFilename(client, reportSource.id, originalName);
        const headerDiff = buildHeaderDiff(reportSource.previousHeaders, headers);
        const schemaStatus = getSchemaStatus(headerDiff);
        const versionRes = await client.query(
            "SELECT COALESCE(MAX(import_version), 0)::int + 1 AS next_version FROM report_source_imports WHERE report_source_id = $1 AND file_label = $2",
            [reportSource.id, fileLabel]
        );
        const sourceVersion = Number(versionRes.rows?.[0]?.next_version || 1);

        await client.query(
            `INSERT INTO sheets (id, headers, active, filename, display_name, stored_path, tab_name, tabs, report_source_id, source_version)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [sheetId, JSON.stringify(headers), !approvalRequired, versionedFilename, displayName, null, firstTabName, JSON.stringify(sheetNames), reportSource.id, sourceVersion]
        );

        let totalRows = 0;
        for (const sn of sheetNames) {
            const rows = sheets[sn];
            if (rows.length > MAX_UPLOAD_ROWS_PER_SHEET) {
                const err = toImportError("too_many_rows_in_sheet", 413);
                err.details = { tab: sn, maxRowsPerSheet: MAX_UPLOAD_ROWS_PER_SHEET };
                throw err;
            }
            totalRows += rows.length;
            if (totalRows > MAX_UPLOAD_TOTAL_ROWS) {
                const err = toImportError("too_many_total_rows", 413);
                err.details = { maxTotalRows: MAX_UPLOAD_TOTAL_ROWS };
                throw err;
            }

            const CHUNK_SIZE = 500;
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

        await carryForwardSourceSecurity(client, {
            previousSheetId: reportSource.previousSheetId,
            nextSheetId: sheetId,
            previousHeaders: reportSource.previousHeaders,
            nextHeaders: headers,
        });

        const importStatus = approvalRequired ? "pending_approval" : "published";
        const importRes = await client.query(
            `INSERT INTO report_source_imports
               (report_source_id, sheet_id, import_version, file_label, original_filename, imported_by,
                schema_status, schema_diff, status, published_at, published_by, job_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
                     CASE WHEN $9 = 'published' THEN CURRENT_TIMESTAMP ELSE NULL END,
                     CASE WHEN $9 = 'published' THEN $6 ELSE NULL END,
                     $10)
             RETURNING id`,
            [
                reportSource.id,
                sheetId,
                sourceVersion,
                fileLabel,
                originalName,
                user?.id || null,
                schemaStatus,
                JSON.stringify(headerDiff),
                importStatus,
                importJobId,
            ]
        );
        const importId = importRes.rows[0].id;

        if (!approvalRequired) {
            await client.query(
                `UPDATE report_sources
                    SET current_sheet_id = $1,
                        updated_at = CURRENT_TIMESTAMP
                  WHERE id = $2`,
                [sheetId, reportSource.id]
            );
        } else {
            await client.query(
                `UPDATE report_sources
                    SET updated_at = CURRENT_TIMESTAMP
                  WHERE id = $1`,
                [reportSource.id]
            );
        }

        const responsePayload = {
            sheetId,
            importId,
            import_id: importId,
            importJobId,
            import_job_id: importJobId,
            import_status: importStatus,
            status: importStatus,
            reportSourceId: reportSource.id,
            report_source_id: reportSource.id,
            report_source_name: reportSource.name,
            source_version: sourceVersion,
            schema_status: schemaStatus,
            schema_diff: headerDiff,
            headers,
            rows: totalRows,
            active: !approvalRequired,
            filename: versionedFilename,
            display_name: displayName,
            tabs: sheetNames
        };

        await finishImportJob(client, {
            id: importJobId,
            status: importStatus,
            reportSourceId: reportSource.id,
            sheetId,
            importId,
            result: responsePayload,
        });

        await client.query("COMMIT");

        return { responsePayload, importStatus };
    } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

async function enqueueDbImportJob({
    user,
    approvalRequired,
    importJobId,
    originalName,
    displayName,
    fileLabel,
    rawReportSourceId,
    rawReportSourceName,
    fileBuffer,
    contentType,
    fileSize,
    parseMemoryLimitMb,
}) {
    // Persist both the job and payload in one transaction so a restart cannot drop queued work.
    const payloadMeta = {
        approvalRequired: !!approvalRequired,
        displayName,
        fileLabel,
        reportSourceId: rawReportSourceId ? Number.parseInt(rawReportSourceId, 10) : null,
        reportSourceName: rawReportSourceName || null,
        queuedByUserId: user?.id || null,
        parseMemoryLimitMb: normalizeWorkerMemoryLimitMb(parseMemoryLimitMb),
    };
    const client = await getClient();
    try {
        await client.query("BEGIN");
        const resolvedSource = await resolveReportSourceForUpload(client, {
            reportSourceId: rawReportSourceId || null,
            reportSourceName: rawReportSourceName || null,
            user,
        });
        payloadMeta.reportSourceId = resolvedSource.id;
        payloadMeta.reportSourceName = resolvedSource.name;

        await createImportJob(client, {
            id: importJobId,
            mode: approvalRequired ? "async_pending_approval" : "async",
            status: "queued",
            stage: "queued",
            requestedBy: user?.id || null,
            originalFilename: originalName,
            reportSourceId: resolvedSource.id,
            maxAttempts: IMPORT_JOB_MAX_ATTEMPTS,
        });

        await client.query(
            `INSERT INTO import_job_payloads (job_id, file_bytes, content_type, byte_size, payload_meta, expires_at)
             VALUES ($1, $2, $3, $4, $5::jsonb, CURRENT_TIMESTAMP + (($6 || ' hour')::interval))
             ON CONFLICT (job_id)
             DO UPDATE SET file_bytes = EXCLUDED.file_bytes,
                           content_type = EXCLUDED.content_type,
                           byte_size = EXCLUDED.byte_size,
                           payload_meta = EXCLUDED.payload_meta,
                           expires_at = EXCLUDED.expires_at`,
            [importJobId, fileBuffer, contentType || null, Number(fileSize || fileBuffer?.length || 0), JSON.stringify(payloadMeta), String(IMPORT_JOB_PAYLOAD_TTL_HOURS)]
        );

        await client.query("COMMIT");
        return resolvedSource;
    } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

async function claimNextImportJob(ownerId) {
    const client = await getClient();
    try {
        await client.query("BEGIN");
        // Lease-based claim: one worker instance claims one eligible job at a time.
        const claimed = await client.query(
            `WITH candidate AS (
                SELECT id
                FROM import_jobs
                WHERE status IN ('queued', 'retryable')
                  AND (next_attempt_at IS NULL OR next_attempt_at <= CURRENT_TIMESTAMP)
                  AND (lease_expires_at IS NULL OR lease_expires_at <= CURRENT_TIMESTAMP)
                ORDER BY created_at ASC
                FOR UPDATE SKIP LOCKED
                LIMIT 1
            )
            UPDATE import_jobs ij
               SET status = 'running',
                   stage = 'processing',
                   started_at = COALESCE(ij.started_at, CURRENT_TIMESTAMP),
                   attempts = COALESCE(ij.attempts, 0) + 1,
                   lease_owner = $1,
                   lease_expires_at = CURRENT_TIMESTAMP + (($2 || ' milliseconds')::interval),
                   error = NULL,
                   updated_at = CURRENT_TIMESTAMP
              FROM candidate c
             WHERE ij.id = c.id
         RETURNING ij.id, ij.mode, ij.status, ij.stage, ij.requested_by, ij.report_source_id, ij.original_filename,
                   ij.attempts, ij.max_attempts`,
            [ownerId, String(IMPORT_JOB_LEASE_MS)]
        );
        await client.query("COMMIT");
        return claimed.rows[0] || null;
    } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

async function markImportJobRetryable({ id, attempts, maxAttempts, error }) {
    const exhausted = Number(attempts || 0) >= Number(maxAttempts || IMPORT_JOB_MAX_ATTEMPTS);
    if (exhausted || !isRetryableImportError(error)) {
        await query(
            `UPDATE import_jobs
                SET status = 'failed',
                    stage = 'failed',
                    error = $2,
                    finished_at = CURRENT_TIMESTAMP,
                    lease_owner = NULL,
                    lease_expires_at = NULL,
                    next_attempt_at = NULL,
                    updated_at = CURRENT_TIMESTAMP
              WHERE id = $1`,
            [id, String(error?.message || "import_failed").slice(0, 500)]
        );
        await query("DELETE FROM import_job_payloads WHERE job_id = $1", [id]);
        return "failed";
    }

    const delayMs = jobBackoffMs(attempts);
    await query(
        `UPDATE import_jobs
            SET status = 'retryable',
                stage = 'queued',
                error = $2,
                next_attempt_at = CURRENT_TIMESTAMP + (($3 || ' milliseconds')::interval),
                lease_owner = NULL,
                lease_expires_at = NULL,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1`,
        [id, String(error?.message || "import_retryable_failure").slice(0, 500), String(delayMs)]
    );
    return "retryable";
}

async function executeQueuedImportJob(job) {
    // Payload lives in DB until the job reaches a terminal state.
    const payloadRows = await query(
        `SELECT file_bytes, payload_meta, byte_size
           FROM import_job_payloads
          WHERE job_id = $1
          LIMIT 1`,
        [job.id]
    );
    if (!payloadRows.length) {
        throw toImportError("import_payload_missing", 500);
    }
    const payload = payloadRows[0];
    const payloadMeta = parseJsonMaybe(payload.payload_meta, {}) || {};
    const displayName = sanitizeDisplayName(payloadMeta.displayName);
    const fileLabel = String(payloadMeta.fileLabel || displayName || "File").trim();
    if (!displayName) throw toImportError("display_name_required", 400);

    const parsedResult = await parseWorkbookBufferOrThrow(payload.file_bytes, {
        memoryLimitMb: payloadMeta.parseMemoryLimitMb,
    });
    const { responsePayload } = await executeImportFromParsedWorkbook({
        parsedResult,
        approvalRequired: !!payloadMeta.approvalRequired,
        importJobId: job.id,
        reportSourceId: payloadMeta.reportSourceId || job.report_source_id,
        reportSourceName: payloadMeta.reportSourceName || null,
        displayName,
        fileLabel,
        originalName: String(job.original_filename || "uploaded.xlsx"),
        user: { id: job.requested_by || null, role: "admin" },
        enforceOwnership: false,
    });

    await query("DELETE FROM import_job_payloads WHERE job_id = $1", [job.id]);
    await writeAuditLog({
        actorUserId: job.requested_by || null,
        action: responsePayload.import_status === "pending_approval" ? "import.pending_approval" : "import.published",
        resourceType: "report_source_import",
        resourceId: responsePayload.importId,
        metadata: {
            report_source_id: responsePayload.report_source_id,
            sheet_id: responsePayload.sheetId,
            job_id: job.id,
            rows: responsePayload.rows,
            tabs: Array.isArray(responsePayload.tabs) ? responsePayload.tabs.length : 0,
            schema_status: responsePayload.schema_status,
            mode: "async_db_queue",
        },
    });
}

async function processNextImportJob(ownerId) {
    const job = await claimNextImportJob(ownerId);
    if (!job) return false;
    try {
        await executeQueuedImportJob(job);
    } catch (err) {
        const outcome = await markImportJobRetryable({
            id: job.id,
            attempts: job.attempts,
            maxAttempts: job.max_attempts,
            error: err,
        });
        if (outcome === "failed") {
            console.error(`[import_worker] job=${job.id} failed:`, err?.message || err);
            await writeAuditLog({
                actorUserId: job.requested_by || null,
                action: "import.failed",
                resourceType: "import_job",
                resourceId: job.id,
                metadata: {
                    attempts: job.attempts,
                    max_attempts: job.max_attempts,
                    error: String(err?.message || "import_failed").slice(0, 500),
                },
            });
        } else {
            console.warn(`[import_worker] job=${job.id} retry scheduled`);
        }
    }
    return true;
}

async function processImportJobsForCurrentDb(ownerId) {
    let claimedAny = false;
    for (let i = 0; i < IMPORT_JOB_MAX_CLAIMS_PER_TICK; i += 1) {
        const didWork = await processNextImportJob(ownerId);
        if (!didWork) break;
        claimedAny = true;
    }
    if (claimedAny) {
        // Keep queued payload storage bounded once jobs reach a terminal state.
        await query(
            `DELETE FROM import_job_payloads p
              USING import_jobs j
             WHERE p.job_id = j.id
               AND p.expires_at IS NOT NULL
               AND p.expires_at <= CURRENT_TIMESTAMP
               AND j.status IN ('published', 'pending_approval', 'rejected', 'failed')`
        );
    }
    return claimedAny;
}

export function startImportJobWorker() {
    if (!IMPORT_DB_QUEUE_ENABLED) {
        console.info("[import_worker] disabled via IMPORT_DB_QUEUE_ENABLED=false");
        return;
    }
    if (importWorkerTimer) return;
    importWorkerOwnerId = `${process.pid}:${randomUUID().slice(0, 8)}`;
    importWorkerTimer = setInterval(async () => {
        if (importWorkerRunning) return;
        importWorkerRunning = true;
        try {
            await processImportJobsForCurrentDb(importWorkerOwnerId);
            await forEachActiveTenantPool(async (tenant) => {
                await processImportJobsForCurrentDb(`${importWorkerOwnerId}:${tenant.db_name}`);
            });
        } catch (err) {
            console.error("[import_worker] tick failed:", err?.message || err);
        } finally {
            importWorkerRunning = false;
        }
    }, IMPORT_JOB_POLL_MS);
    if (importWorkerTimer.unref) importWorkerTimer.unref();
    console.log(`[import_worker] started owner=${importWorkerOwnerId} poll_ms=${IMPORT_JOB_POLL_MS}`);
}

export async function stopImportJobWorker() {
    if (importWorkerTimer) {
        clearInterval(importWorkerTimer);
        importWorkerTimer = null;
    }
    while (importWorkerRunning) {
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    importWorkerOwnerId = null;
}

export async function uploadSheet(req, res) {
    let filePath = req.file?.path;
    let importJobId = req.importJobId || randomUUID();
    let importJobCreated = false;
    try {
        const isAdminRole = canUploadSheetsByRole(req.user?.role);
        const isGroupAdmin = req.user?.id ? await isGroupAdminUser(req.user.id) : false;
        if (!isAdminRole && !isGroupAdmin) {
            if (filePath) fs.unlink(filePath, () => {});
            return res.status(403).json({ error: "Forbidden" });
        }
        if (!req.file) return res.status(400).json({ error: "No file" });

        const originalName = req.file.originalname || "uploaded.xlsx";
        const displayName = sanitizeDisplayName(req.body?.display_name);
        const fileLabel = String(req.body?.file_label || req.body?.fileLabel || displayName || "File").trim();
        const approvalRequired = uploadRequiresApproval(req);
        const rawReportSourceId = req.body?.reportSourceId ?? req.body?.report_source_id;
        const rawReportSourceName = req.body?.reportSourceName ?? req.body?.report_source_name;
        if (!displayName) {
            if (filePath) fs.unlink(filePath, () => {});
            return res.status(400).json({ error: "display_name_required" });
        }

        console.log(`[upload] size=${req.file.size} reportSourceId=${rawReportSourceId || "new"}`);
        const parseMemoryLimitMb = await resolveTenantParseMemoryLimitMb(req.user);

        let fileBuffer = req.fileBuffer;
        if (!fileBuffer) {
            fileBuffer = await fs.promises.readFile(filePath);
            fs.unlink(filePath, () => {});
            filePath = null;
        }

        if (uploadUsesDbQueue(req)) {
            // Fast path for API latency: enqueue and return; worker finalizes import.
            const resolvedSource = await enqueueDbImportJob({
                user: req.user,
                approvalRequired,
                importJobId,
                originalName,
                displayName,
                fileLabel,
                rawReportSourceId,
                rawReportSourceName,
                fileBuffer,
                contentType: req.file?.mimetype || null,
                fileSize: req.file?.size || fileBuffer.length || 0,
                parseMemoryLimitMb,
            });
            await writeAuditLog({
                req,
                action: "import.queued",
                resourceType: "import_job",
                resourceId: importJobId,
                metadata: {
                    report_source_id: resolvedSource.id,
                    report_source_name: resolvedSource.name,
                    approval_required: !!approvalRequired,
                    mode: "async_db_queue",
                    file_size: Number(req.file?.size || fileBuffer.length || 0),
                },
            });
            return res.status(202).json({
                status: "queued",
                import_status: "queued",
                importJobId,
                import_job_id: importJobId,
                reportSourceId: resolvedSource.id,
                report_source_id: resolvedSource.id,
                report_source_name: resolvedSource.name,
                filename: originalName,
                display_name: displayName,
            });
        }

        // Compatibility fallback: preserve synchronous import behavior when queueing is disabled.
        const jobClient = await getClient();
        try {
            await jobClient.query("BEGIN");
            await createImportJob(jobClient, {
                id: importJobId,
                mode: approvalRequired ? "sync_pending_approval" : "sync",
                status: "running",
                stage: "processing",
                requestedBy: req.user?.id || null,
                originalFilename: originalName,
                maxAttempts: 1,
            });
            await jobClient.query("COMMIT");
            importJobCreated = true;
        } catch (err) {
            await jobClient.query("ROLLBACK").catch(() => {});
            throw err;
        } finally {
            jobClient.release();
        }

        const parsedResult = await parseWorkbookBufferOrThrow(fileBuffer, { memoryLimitMb: parseMemoryLimitMb });
        const { responsePayload, importStatus } = await executeImportFromParsedWorkbook({
            parsedResult,
            approvalRequired,
            importJobId,
            reportSourceId: rawReportSourceId || null,
            reportSourceName: rawReportSourceName || null,
            displayName,
            fileLabel,
            originalName,
            user: req.user,
            enforceOwnership: true,
        });

        await writeAuditLog({
            req,
            action: importStatus === "pending_approval" ? "import.pending_approval" : "import.published",
            resourceType: "report_source_import",
            resourceId: responsePayload.importId,
            metadata: {
                report_source_id: responsePayload.report_source_id,
                sheet_id: responsePayload.sheetId,
                job_id: importJobId,
                rows: responsePayload.rows,
                tabs: Array.isArray(responsePayload.tabs) ? responsePayload.tabs.length : 0,
                schema_status: responsePayload.schema_status,
                mode: "sync_fallback",
            },
        });
        return res.json(responsePayload);
    } catch (e) {
        console.error("upload failed:", e);
        if (importJobCreated) {
            try {
                await query(
                    `UPDATE import_jobs
                        SET status = 'failed',
                            stage = 'failed',
                            error = $2,
                            finished_at = CURRENT_TIMESTAMP,
                            lease_owner = NULL,
                            lease_expires_at = NULL,
                            next_attempt_at = NULL,
                            updated_at = CURRENT_TIMESTAMP
                      WHERE id = $1`,
                    [importJobId, String(e?.message || "upload_failed").slice(0, 500)]
                );
            } catch {
                // Keep original upload error response.
            }
        }
        if (e?.code === "LIMIT_FILE_SIZE") {
            return res.status(413).json({ error: "file_too_large", maxMB: 100 });
        }
        if (e?.statusCode) {
            const body = { error: e.message || "upload_failed" };
            if (e.publicMessage) body.message = e.publicMessage;
            if (e.details && typeof e.details === "object") Object.assign(body, e.details);
            return res.status(e.statusCode).json(body);
        }
        return res.status(500).json({ error: "upload_failed", message: e.message || "An unexpected error occurred during upload." });
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

    // Enforce the same baseline access constraints as other sheet endpoints.
    const hasAccess = await checkSheetAccess(id, req.user);
    if (!hasAccess) {
        return res.status(403).json({ error: "Forbidden" });
    }

    let hasFullAccess = req.user.role === "admin";
    let rowFiltersList = [];

    // For non-admin users without report-source owner access, require explicit column permissions
    // and apply the same row filters used by the main sheet data endpoint.
    if (req.user.role !== "admin") {
        hasFullAccess = await hasReportSourceOwnerAccess(id, userId);
        if (!hasFullAccess) {
            // Legacy reference retained for regression text checks:
            // SELECT allowed_columns, row_filters FROM permissions WHERE user_id = $2 AND sheet_id = $1
            const assigned = await resolveAssignedViewForSheet(id, userId);
            if (!assigned) return res.status(403).json({ error: "Forbidden" });
            const viewCols = resolveViewColumnAllowlist(assigned.config, assigned.headers);
            const forcedFilters = assigned.config?.columnFilters && typeof assigned.config.columnFilters === "object"
                ? assigned.config.columnFilters
                : null;
            // Legacy reference retained for regression text checks:
            // rowFiltersList.push(filters)
            if (viewCols && viewCols.length > 0 && !viewCols.includes(String(col))) {
                return res.status(403).json({ error: "Forbidden" });
            }
            if (forcedFilters) rowFiltersList.push(forcedFilters);
        }
    }

    try {
        // PERF-03 Fix: Use a subquery to hit the sheet_id index first, and sample for performance if large.
        // Security: row filters must be applied before sampling/distinct to avoid metadata leaks.
        const params = [col, id];
        let where = `WHERE sheet_id = $2`;
        if (tab) {
            params.push(tab);
            where += ` AND tab_name = $${params.length}`;
        }
        if (!hasFullAccess && rowFiltersList.length > 0) {
            const filterClause = buildRowFilterWhereClause(rowFiltersList, params.length + 1);
            where += filterClause.sql;
            params.push(...filterClause.params);
        }

        let sql = `
            SELECT DISTINCT (row_data->>$1) as val 
            FROM (
                SELECT row_data FROM sheet_rows 
                ${where}
                LIMIT 10000
            ) as sampled
            ORDER BY val ASC 
            LIMIT 1000
        `;

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
        s = await query(
            `SELECT s.id, s.headers, s.filename, s.display_name, s.totals_column,
                    s.report_source_id, s.source_version, rs.name AS report_source_name
             FROM sheets s
             LEFT JOIN report_sources rs ON rs.id = s.report_source_id
             WHERE s.active = TRUE
             ORDER BY s.uploaded_at DESC, s.id DESC
             LIMIT 1`,
            []
        );
    } else {
        s = await query(
            `SELECT DISTINCT s.id, s.headers, s.filename, s.display_name, s.totals_column,
                    s.report_source_id, s.source_version, rs.name AS report_source_name
             FROM sheets s
             LEFT JOIN report_sources rs ON rs.id = s.report_source_id
             LEFT JOIN report_source_imports rsi ON rsi.sheet_id = s.id
             WHERE s.active = TRUE
               AND (
                 rs.created_by = $1
                 OR EXISTS (
                   SELECT 1
                   FROM views v
                   WHERE (
                     v.sheet_id = s.id
                     OR (
                       v.sheet_id IS NULL
                       AND v.report_source_id = rsi.report_source_id
                       AND (v.file_label IS NULL OR v.file_label = rsi.file_label)
                     )
                   )
                   AND (
                     EXISTS (SELECT 1 FROM view_user_permissions vup WHERE vup.view_id = v.id AND vup.user_id = $1)
                   )
                 )
               )
             ORDER BY s.uploaded_at DESC, s.id DESC
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
        report_source_id: s[0].report_source_id || null,
        report_source_name: s[0].report_source_name || null,
        source_version: s[0].source_version || null,
        totals_column: s[0].totals_column || null
    });
}

export async function listMySheets(req, res) {
    const userId = req.user.id;
    const pagination = parsePagination(req.query, { maxLimit: MAX_SHEET_DATA_LIMIT });
    if (pagination.error) return res.status(400).json({ error: pagination.error });

    const suffix = pagination.hasPagination ? " LIMIT $1 OFFSET $2" : "";
    const paginationParams = pagination.hasPagination ? [pagination.limit, pagination.offset] : [];

    if (req.user.role === "admin") {
        const rows = await query(
            `SELECT s.id, s.filename, s.display_name, s.uploaded_at,
                    s.active, s.report_source_id, s.source_version, rs.name AS report_source_name,
                    (rs.current_sheet_id = s.id) AS is_current_source_version
             FROM sheets s
             LEFT JOIN report_sources rs ON rs.id = s.report_source_id
             ORDER BY s.uploaded_at DESC${suffix}`,
            paginationParams
        );
        return res.json(rows);
    }

    const rows = await query(
        `SELECT DISTINCT s.id, s.filename, s.display_name, s.uploaded_at,
                s.active, s.report_source_id, s.source_version, rs.name AS report_source_name,
                (rs.current_sheet_id = s.id) AS is_current_source_version
         FROM sheets s
         LEFT JOIN report_sources rs ON rs.id = s.report_source_id
         LEFT JOIN report_source_imports rsi ON rsi.sheet_id = s.id
         WHERE (
             rs.created_by = $1
             OR EXISTS (
               SELECT 1
               FROM views v
               WHERE (
                 v.sheet_id = s.id
                 OR (
                   v.sheet_id IS NULL
                   AND v.report_source_id = rsi.report_source_id
                   AND (v.file_label IS NULL OR v.file_label = rsi.file_label)
                 )
               )
               AND (
                 EXISTS (SELECT 1 FROM view_user_permissions vup WHERE vup.view_id = v.id AND vup.user_id = $1)
               )
             )
         )
         ORDER BY s.uploaded_at DESC${pagination.hasPagination ? " LIMIT $2 OFFSET $3" : ""}`,
        pagination.hasPagination ? [userId, pagination.limit, pagination.offset] : [userId]
    );
    res.json(rows);
}

export async function listAllSheets(req, res) {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    const pagination = parsePagination(req.query, { maxLimit: MAX_SHEET_DATA_LIMIT });
    if (pagination.error) return res.status(400).json({ error: pagination.error });
    const rows = await query(
        `SELECT s.id, s.filename, s.display_name, s.uploaded_at,
                s.active, s.report_source_id, s.source_version, rs.name AS report_source_name,
                (rs.current_sheet_id = s.id) AS is_current_source_version
         FROM sheets s
         LEFT JOIN report_sources rs ON rs.id = s.report_source_id
         ORDER BY s.uploaded_at DESC${pagination.hasPagination ? " LIMIT $1 OFFSET $2" : ""}`,
        pagination.hasPagination ? [pagination.limit, pagination.offset] : []
    );
    res.json(rows);
}

export async function listReportSources(req, res) {
    const pagination = parsePagination(req.query, { maxLimit: MAX_SHEET_DATA_LIMIT });
    if (pagination.error) return res.status(400).json({ error: pagination.error });

    const limitSql = pagination.hasPagination ? " LIMIT $1 OFFSET $2" : "";
    const limitParams = pagination.hasPagination ? [pagination.limit, pagination.offset] : [];

    if (req.user.role === "admin") {
        const rows = await query(
            `SELECT rs.id, rs.name, rs.current_sheet_id, rs.is_inferred,
                    rs.created_at, rs.updated_at,
                    COALESCE(import_counts.import_count, 0)::int AS import_count
             FROM report_sources rs
             LEFT JOIN (
               SELECT report_source_id, COUNT(*) AS import_count
               FROM report_source_imports
               GROUP BY report_source_id
             ) import_counts ON import_counts.report_source_id = rs.id
             ORDER BY rs.updated_at DESC${limitSql}`,
            limitParams
        );
        return res.json(rows);
    }

    const rows = await query(
        `SELECT DISTINCT rs.id, rs.name, rs.current_sheet_id, rs.is_inferred,
                rs.created_at, rs.updated_at,
                COALESCE(import_counts.import_count, 0)::int AS import_count
         FROM report_sources rs
         LEFT JOIN sheets s ON s.id = rs.current_sheet_id
         LEFT JOIN report_source_imports rsi ON rsi.sheet_id = s.id
         LEFT JOIN (
           SELECT report_source_id, COUNT(*) AS import_count
           FROM report_source_imports
           GROUP BY report_source_id
         ) import_counts ON import_counts.report_source_id = rs.id
         WHERE (
           rs.created_by = $1
           OR EXISTS (
             SELECT 1
             FROM views v
             WHERE (
               v.sheet_id = s.id
               OR (
                 v.sheet_id IS NULL
                 AND v.report_source_id = rsi.report_source_id
                 AND (v.file_label IS NULL OR v.file_label = rsi.file_label)
               )
             )
             AND (
               EXISTS (SELECT 1 FROM view_user_permissions vup WHERE vup.view_id = v.id AND vup.user_id = $1)
             )
           )
         )
         ORDER BY rs.updated_at DESC${pagination.hasPagination ? " LIMIT $2 OFFSET $3" : ""}`,
        pagination.hasPagination ? [req.user.id, pagination.limit, pagination.offset] : [req.user.id]
    );
    res.json(rows);
}

export async function getReportSourceImports(req, res) {
    const sourceId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(sourceId) || sourceId <= 0) {
        return res.status(400).json({ error: "invalid_report_source_id" });
    }
    const [source] = await query("SELECT current_sheet_id FROM report_sources WHERE id = $1", [sourceId]);
    if (!source) return res.status(404).json({ error: "not_found" });
    if (source.current_sheet_id) {
        const hasAccess = await checkSheetAccess(source.current_sheet_id, req.user);
        if (!hasAccess) return res.status(403).json({ error: "Forbidden" });
    } else if (req.user.role !== "admin") {
        return res.status(403).json({ error: "Forbidden" });
    }
    const rows = await query(
        `SELECT rsi.id, rsi.report_source_id, rsi.sheet_id, rsi.import_version, rsi.file_label,
                rsi.original_filename, rsi.schema_status, rsi.schema_diff, rsi.status,
                rsi.published_at, rsi.published_by, rsi.rejected_at, rsi.rejected_by,
                rsi.review_notes, rsi.job_id, rsi.created_at,
                s.display_name, s.filename, s.uploaded_at,
                COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.email) AS imported_by_name
         FROM report_source_imports rsi
         JOIN sheets s ON s.id = rsi.sheet_id
         LEFT JOIN users u ON u.id = rsi.imported_by
         WHERE rsi.report_source_id = $1
         ORDER BY rsi.import_version DESC`,
        [sourceId]
    );
    res.json(rows);
}

export async function listImportJobs(req, res) {
    const pagination = parsePagination(req.query, { maxLimit: 200 });
    if (pagination.error) return res.status(400).json({ error: pagination.error });

    const baseParams = [];
    let where = "";
    if (req.user.role !== "admin") {
        baseParams.push(req.user.id);
        where = `WHERE (
          ij.requested_by = $1
          OR EXISTS (
            SELECT 1
            FROM report_sources rs
            WHERE rs.id = ij.report_source_id
              AND rs.created_by = $1
          )
        )`;
    }

    const params = [...baseParams];
    let limitSql = "";
    if (pagination.hasPagination) {
        params.push(pagination.limit, pagination.offset);
        limitSql = ` LIMIT $${params.length - 1} OFFSET $${params.length}`;
    }

    const rows = await query(
        `SELECT ij.id, ij.status, ij.mode, ij.stage, ij.requested_by, ij.report_source_id,
                ij.sheet_id, ij.import_id, ij.original_filename, ij.error, ij.result,
                ij.attempts, ij.max_attempts, ij.next_attempt_at, ij.lease_owner, ij.lease_expires_at,
                ij.created_at, ij.started_at, ij.finished_at, ij.updated_at,
                rs.name AS report_source_name
           FROM import_jobs ij
           LEFT JOIN report_sources rs ON rs.id = ij.report_source_id
          ${where}
          ORDER BY ij.created_at DESC${limitSql}`,
        params
    );
    res.json(rows);
}

export async function getImportJob(req, res) {
    const jobId = String(req.params.id || "").trim();
    if (!jobId) return res.status(400).json({ error: "invalid_import_job_id" });

    const rows = await query(
        `SELECT ij.id, ij.status, ij.mode, ij.stage, ij.requested_by, ij.report_source_id,
                ij.sheet_id, ij.import_id, ij.original_filename, ij.error, ij.result,
                ij.attempts, ij.max_attempts, ij.next_attempt_at, ij.lease_owner, ij.lease_expires_at,
                ij.created_at, ij.started_at, ij.finished_at, ij.updated_at,
                rs.name AS report_source_name
           FROM import_jobs ij
           LEFT JOIN report_sources rs ON rs.id = ij.report_source_id
          WHERE ij.id = $1`,
        [jobId]
    );
    if (!rows.length) return res.status(404).json({ error: "not_found" });
    const job = rows[0];
    if (req.user.role !== "admin") {
        const userId = req.user.id;
        const hasAccess = job.requested_by === userId || (job.sheet_id && await checkSheetAccess(job.sheet_id, req.user));
        if (!hasAccess) return res.status(403).json({ error: "Forbidden" });
    }
    res.json(job);
}

export async function publishReportSourceImport(req, res) {
    const importId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(importId) || importId <= 0) {
        return res.status(400).json({ error: "invalid_import_id" });
    }

    const client = await getClient();
    try {
        await client.query("BEGIN");
        const importRes = await client.query(
            `SELECT rsi.id, rsi.report_source_id, rsi.sheet_id, rsi.status, rsi.file_label, rsi.job_id
               FROM report_source_imports rsi
               JOIN report_sources rs ON rs.id = rsi.report_source_id
              WHERE rsi.id = $1
              FOR UPDATE`,
            [importId]
        );
        if (!importRes.rows.length) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "not_found" });
        }
        const record = importRes.rows[0];
        const canApprove = await userCanApproveReportSource(client, req.user, record.report_source_id);
        if (!canApprove) {
            await client.query("ROLLBACK");
            return res.status(403).json({ error: "Forbidden" });
        }
        if (record.status === "rejected") {
            await client.query("ROLLBACK");
            return res.status(409).json({ error: "import_rejected" });
        }

        await client.query("UPDATE sheets SET active = TRUE WHERE id = $1", [record.sheet_id]);
        await client.query(
            `UPDATE report_sources
                SET current_sheet_id = $1,
                    updated_at = CURRENT_TIMESTAMP
              WHERE id = $2`,
            [record.sheet_id, record.report_source_id]
        );
        await client.query(
            `UPDATE report_source_imports
                SET status = 'superseded'
              WHERE report_source_id = $1
                AND id <> $2
                AND status = 'published'`,
            [record.report_source_id, importId]
        );
        await client.query(
            `UPDATE report_source_imports
                SET status = 'published',
                    published_at = CURRENT_TIMESTAMP,
                    published_by = $2,
                    rejected_at = NULL,
                    rejected_by = NULL,
                    review_notes = COALESCE($3, review_notes)
              WHERE id = $1`,
            [importId, req.user.id, req.body?.review_notes || req.body?.notes || null]
        );
        if (record.job_id) {
            await client.query(
                `UPDATE import_jobs
                    SET status = 'published',
                        stage = 'published',
                        sheet_id = $2,
                        report_source_id = $3,
                        import_id = $1,
                        updated_at = CURRENT_TIMESTAMP,
                        finished_at = COALESCE(finished_at, CURRENT_TIMESTAMP)
                  WHERE id = $4`,
                [importId, record.sheet_id, record.report_source_id, record.job_id]
            );
        }
        await client.query("COMMIT");

        await writeAuditLog({
            req,
            action: "import.approved_published",
            resourceType: "report_source_import",
            resourceId: importId,
            metadata: {
                report_source_id: record.report_source_id,
                sheet_id: record.sheet_id,
                previous_status: record.status,
            },
        });
        res.json({
            success: true,
            import_id: importId,
            report_source_id: record.report_source_id,
            sheet_id: record.sheet_id,
            status: "published",
        });
    } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

export async function rejectReportSourceImport(req, res) {
    const importId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(importId) || importId <= 0) {
        return res.status(400).json({ error: "invalid_import_id" });
    }

    const client = await getClient();
    try {
        await client.query("BEGIN");
        const importRes = await client.query(
            `SELECT rsi.id, rsi.report_source_id, rsi.sheet_id, rsi.status, rsi.job_id
               FROM report_source_imports rsi
               JOIN report_sources rs ON rs.id = rsi.report_source_id
              WHERE rsi.id = $1
              FOR UPDATE`,
            [importId]
        );
        if (!importRes.rows.length) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "not_found" });
        }
        const record = importRes.rows[0];
        const canApprove = await userCanApproveReportSource(client, req.user, record.report_source_id);
        if (!canApprove) {
            await client.query("ROLLBACK");
            return res.status(403).json({ error: "Forbidden" });
        }
        if (record.status === "published") {
            await client.query("ROLLBACK");
            return res.status(409).json({ error: "published_import_cannot_be_rejected" });
        }

        await client.query(
            `UPDATE report_source_imports
                SET status = 'rejected',
                    rejected_at = CURRENT_TIMESTAMP,
                    rejected_by = $2,
                    review_notes = COALESCE($3, review_notes)
              WHERE id = $1`,
            [importId, req.user.id, req.body?.review_notes || req.body?.notes || null]
        );
        if (record.job_id) {
            await client.query(
                `UPDATE import_jobs
                    SET status = 'rejected',
                        stage = 'rejected',
                        updated_at = CURRENT_TIMESTAMP,
                        finished_at = COALESCE(finished_at, CURRENT_TIMESTAMP)
                  WHERE id = $1`,
                [record.job_id]
            );
        }
        await client.query("COMMIT");

        await writeAuditLog({
            req,
            action: "import.rejected",
            resourceType: "report_source_import",
            resourceId: importId,
            metadata: {
                report_source_id: record.report_source_id,
                sheet_id: record.sheet_id,
                previous_status: record.status,
            },
        });
        res.json({
            success: true,
            import_id: importId,
            report_source_id: record.report_source_id,
            sheet_id: record.sheet_id,
            status: "rejected",
        });
    } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

export async function getSheetDetails(req, res) {
    const hasAccess = await checkSheetAccess(req.params.id, req.user);
    if (!hasAccess) return res.status(403).json({ error: "Forbidden" });
    const s = await query(
        `SELECT s.id, s.headers, s.active, s.filename, s.display_name, s.totals_column,
                s.report_source_id, s.source_version, rs.name AS report_source_name
         FROM sheets s
         LEFT JOIN report_sources rs ON rs.id = s.report_source_id
         WHERE s.id=$1`,
        [req.params.id]
    );
    if (!s.length) return res.status(404).json({ error: "not_found" });

    // Enforce allowed_columns on the headers array returned
    if (req.user.role !== "admin") {
        const hasOwnerAccess = await hasReportSourceOwnerAccess(req.params.id, req.user.id);
        if (!hasOwnerAccess) {
            const assigned = await resolveAssignedViewForSheet(req.params.id, req.user.id);
            if (!assigned) return res.status(403).json({ error: "Forbidden" });
            const validArray = resolveViewColumnAllowlist(assigned.config, assigned.headers);
            if (Array.isArray(validArray) && validArray.length > 0) {
                let currentHeaders = typeof s[0].headers === 'string' ? JSON.parse(s[0].headers) : s[0].headers;
                s[0].headers = currentHeaders.filter(h => validArray.includes(h));
            } else if (Array.isArray(validArray)) {
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
    let sheetHeaders = [];
    let forceColumnProjection = false;

    // 1. Resolve Locked View if provided
    if (viewId) {
        const [view] = await query(
            `SELECT v.config, s.headers
             FROM views v
             CROSS JOIN sheets s
             LEFT JOIN report_source_imports rsi ON rsi.sheet_id = s.id
             WHERE v.id = $1 AND s.id = $2
               AND (
                 v.is_global = TRUE
                 OR v.sheet_id = s.id
                 OR (
                   v.sheet_id IS NULL
                   AND v.report_source_id = rsi.report_source_id
                   AND (v.file_label IS NULL OR v.file_label = rsi.file_label)
                 )
               )
                   AND (
                     $3 = 'admin'
                     OR EXISTS (SELECT 1 FROM view_user_permissions WHERE view_id = v.id AND user_id = $4)
                   )`,
                [viewId, id, req.user.role, userId]
            );
        if (!view) {
            return res.status(403).json({ error: "Forbidden", message: "You do not have permission to access this view." });
        }
        viewConfig = typeof view.config === 'string' ? JSON.parse(view.config) : view.config;
        sheetHeaders = typeof view.headers === 'string' ? JSON.parse(view.headers) : (view.headers || []);
    }

    // 2. Resolve Base Permissions
    if (req.user.role !== "admin") {
        hasFullAccess = await hasReportSourceOwnerAccess(id, userId);
        if (!hasFullAccess && !viewId) {
            const assigned = await resolveAssignedViewForSheet(id, userId);
            if (!assigned) {
                return res.status(403).json({ error: "Forbidden", message: "You do not have an assigned view for this sheet." });
            }
            viewConfig = assigned.config;
            sheetHeaders = assigned.headers;
        }
    } else {
        hasFullAccess = true;
    }

    // 3. Merge View Restrictions with Base Permissions
    if (viewConfig) {
        const viewColumnAllowlist = resolveViewColumnAllowlist(viewConfig, sheetHeaders);
        // If view has restricted columns, enforce them server-side as the final allowlist.
        if (viewColumnAllowlist !== null) {
            forceColumnProjection = true;
            if (hasFullAccess) {
                validCols = viewColumnAllowlist;
                hasFullAccess = false; // Now restricted by view
            } else if (validCols.length > 0) {
                validCols = validCols.filter(c => viewColumnAllowlist.includes(c));
            } else {
                // A view permission is an explicit admin-granted locked view. Without separate
                // sheet column permissions, the view's column allowlist is the accessible scope.
                validCols = viewColumnAllowlist;
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
        if (!hasFullAccess) {
            if (validCols.length > 0) {
                // Keep only keys in validCols in the database result, not only in application code.
                columnSelection = `COALESCE((
                    SELECT jsonb_object_agg(key, value)
                    FROM jsonb_each(row_data)
                    WHERE key = ANY($${sqlParams.length + 1}::text[])
                ), '{}'::jsonb)`;
                sqlParams.push(validCols);
            } else if (forceColumnProjection || viewId) {
                columnSelection = `'{}'::jsonb`;
            }
        }

        let sql = `SELECT ${columnSelection} AS row_data FROM sheet_rows WHERE sheet_id = $1`;
        const params = sqlParams;

        if (tab) {
            sql += ` AND tab_name = $${params.length + 1}`;
            params.push(tab);
        }

        // Apply RBAC + Locked View row filters
        if (!hasFullAccess && rowFiltersList.length > 0) {
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
                const rowData = (typeof r.row_data === 'string' ? JSON.parse(r.row_data) : r.row_data) || {};
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

        const s = await client.query("SELECT id FROM sheets WHERE id = $1 LIMIT 1 FOR UPDATE", [id]);
        if (!s.rows.length) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "not_found" });
        }

        // Capture related import ids before deletion so dangling job references can be scrubbed.
        const linkedImports = await client.query(
            "SELECT id FROM report_source_imports WHERE sheet_id = $1 FOR UPDATE",
            [id]
        );
        const importIds = linkedImports.rows.map((r) => Number(r.id)).filter((n) => Number.isInteger(n) && n > 0);

        // Cleanup views bound to this sheet and their permissions.
        const viewsRes = await client.query("SELECT id FROM views WHERE sheet_id = $1", [id]);
            const viewIds = viewsRes.rows.map(v => v.id);
            if (viewIds.length > 0) {
                await client.query("DELETE FROM view_user_permissions WHERE view_id = ANY($1::int[])", [viewIds]);
                await client.query("DELETE FROM views WHERE id = ANY($1::int[])", [viewIds]);
            }

        // Ensure report source pointers are cleared before removing sheet/import rows.
        await client.query("UPDATE report_sources SET current_sheet_id = NULL WHERE current_sheet_id = $1", [id]);

        // Delete imports tied to this sheet and scrub jobs that referenced those imports.
        if (importIds.length > 0) {
            await client.query(
                `UPDATE import_jobs
                    SET import_id = NULL,
                        sheet_id = NULL,
                        updated_at = CURRENT_TIMESTAMP
                  WHERE import_id = ANY($1::int[])`,
                [importIds]
            );
            await client.query("DELETE FROM report_source_imports WHERE id = ANY($1::int[])", [importIds]);
        }

        // Cleanup jobs directly keyed by the sheet id.
        await client.query(
            `UPDATE import_jobs
                SET sheet_id = NULL,
                    updated_at = CURRENT_TIMESTAMP
              WHERE sheet_id = $1`,
            [id]
        );

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
