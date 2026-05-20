export function createSheetOrchestration(deps) {
const {
  query,
  getClient,
  normalizeEmailIngestSettings,
  getAppSettingValueWithScopedFallback,
  normalizeEmailIngestSenderAllowlist,
  normalizeEmailAddress,
  normalizeEmailLocalPart,
  sanitizeReportSourceName,
  resolveRuntimeGroupIdForUser,
  parseAutosyncConfig,
  persistImportJobPayload,
  createImportJob,
  finishImportJob,
  markImportJobRetryable,
  IMPORT_PIPELINE_SETTINGS_KEY,
  IMPORT_JOB_MAX_ATTEMPTS,
  importStagingWriteEnabledBySettings,
  importStagingFinalizeEnabledBySettings,
  queuedImportStreamingV2EnabledBySettings,
  isRetryableImportError,
  jobBackoffMs,
  parseJsonMaybe,
  writeAuditLog,
  toImportError,
  classifySheetBusinessContext,
  AI_DEBUG_LOGS,
} = deps;
async function loadEmailIngestSettingsForGroup(groupId) {
    const settingsRows = await getAppSettingValueWithScopedFallback("email_ingest_settings", null);
    const scopedAllowlistRows = groupId
        ? await getAppSettingValueWithScopedFallback("email_ingest_allowlist", groupId)
        : null;
    const allowlistRows = scopedAllowlistRows ?? await getAppSettingValueWithScopedFallback("email_ingest_allowlist", null);
    const current = normalizeEmailIngestSettings(settingsRows || {});
    return {
        ...current,
        allowedSenderDomains: normalizeEmailIngestSenderAllowlist(allowlistRows || settingsRows || {}),
    };
}

async function resolveEmailIngestCustomer(client, recipients, settings) {
    const addressPrefix = String(settings?.addressPrefix || "customer").trim().toLowerCase() || "customer";
    const addressMode = String(settings?.addressMode || "slug").trim().toLowerCase() === "id" ? "id" : "slug";
    const inboundDomain = String(settings?.inboundDomain || "").trim().toLowerCase();
    const candidates = Array.isArray(recipients) ? recipients : [];
    for (const recipient of candidates) {
        const email = normalizeEmailAddress(recipient);
        if (!email || !email.includes("@")) continue;
        const [localRaw, domainRaw] = email.split("@");
        const domain = String(domainRaw || "").trim().toLowerCase();
        if (inboundDomain && domain !== inboundDomain && !domain.endsWith(`.${inboundDomain}`)) continue;
        const local = normalizeEmailLocalPart(localRaw);
        const prefixToken = `${addressPrefix}-`;
        if (!local.startsWith(prefixToken)) continue;
        const alias = local.slice(prefixToken.length).trim();
        if (!alias) continue;

        if (addressMode === "id" || /^\d+$/.test(alias)) {
            const groupId = Number.parseInt(alias, 10);
            if (!Number.isInteger(groupId) || groupId <= 0) continue;
            const rows = await client.query(
                `SELECT c.id AS customer_id, c.group_id, c.slug, c.name AS customer_name, c.db_name, g.name AS group_name
                   FROM customers c
                   JOIN groups g ON g.id = c.group_id
                  WHERE c.group_id = $1
                    AND c.status = 'active'
                  LIMIT 1`,
                [groupId]
            );
            if (rows.rows.length) return { ...rows.rows[0], recipientAddress: email };
            continue;
        }

        const rows = await client.query(
            `SELECT c.id AS customer_id, c.group_id, c.slug, c.name AS customer_name, c.db_name, g.name AS group_name
               FROM customers c
               JOIN groups g ON g.id = c.group_id
              WHERE LOWER(c.slug) = LOWER($1)
                AND c.status = 'active'
              LIMIT 1`,
            [alias]
        );
        if (rows.rows.length) return { ...rows.rows[0], recipientAddress: email };
    }
    return null;
}

async function resolveOrCreateEmailReportSource(client, { groupId, recipientAddress, customerName, fileLabel, messageId = null }) {
    const sourceRef = normalizeEmailAddress(recipientAddress);
    const sourceName = sanitizeReportSourceName(customerName || sourceRef || `Customer ${groupId}`);
    const existing = await client.query(
        `SELECT rs.id, rs.name, rs.current_sheet_id,
                rs.review_required, rs.review_schema_changes, rs.review_label_rules,
                s.headers AS current_headers
           FROM report_sources rs
           LEFT JOIN sheets s ON s.id = rs.current_sheet_id
          WHERE rs.sync_provider = 'email'
            AND rs.sync_group_id = $1
            AND rs.sync_source_ref = $2
          LIMIT 1
          FOR UPDATE OF rs`,
        [groupId, sourceRef]
    );
    if (existing.rows.length) {
        const row = existing.rows[0];
        return {
            id: row.id,
            name: row.name,
            reviewRequired: !!row.review_required,
            reviewSchemaChanges: row.review_schema_changes !== false,
            reviewLabelRules: normalizeReviewLabelRules(row.review_label_rules),
            previousSheetId: row.current_sheet_id || null,
            previousHeaders: typeof row.current_headers === "string" ? JSON.parse(row.current_headers) : (row.current_headers || []),
            isNew: false,
        };
    }

    await assertReportSourceLimitAvailable(client, groupId);

    const inserted = await client.query(
        `INSERT INTO report_sources
            (name, created_by, is_inferred, sync_enabled, sync_provider, sync_source_ref, sync_group_id, sync_display_name, sync_file_label, sync_remote_marker, sync_last_attempted_marker, sync_last_synced_at, sync_updated_at, updated_at)
         VALUES
            ($1, NULL, FALSE, TRUE, 'email', $2, $3, $4, $5, $6, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT (sync_provider, sync_group_id, sync_source_ref)
         DO UPDATE SET name = EXCLUDED.name,
                       sync_enabled = TRUE,
                       sync_display_name = EXCLUDED.sync_display_name,
                       sync_file_label = COALESCE(EXCLUDED.sync_file_label, report_sources.sync_file_label),
                       sync_remote_marker = COALESCE(EXCLUDED.sync_remote_marker, report_sources.sync_remote_marker),
                       sync_last_attempted_marker = COALESCE(EXCLUDED.sync_last_attempted_marker, report_sources.sync_last_attempted_marker),
                       sync_last_synced_at = CURRENT_TIMESTAMP,
                       sync_last_error = NULL,
                       sync_updated_at = CURRENT_TIMESTAMP,
                       updated_at = CURRENT_TIMESTAMP
         RETURNING id, name`,
        [sourceName, sourceRef, groupId, customerName || sourceName, fileLabel || null]
    );

    return {
        id: inserted.rows[0].id,
        name: inserted.rows[0].name,
        reviewRequired: false,
        reviewSchemaChanges: true,
        reviewLabelRules: {},
        previousSheetId: null,
        previousHeaders: [],
        isNew: true,
    };
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
    if (isPlatformAdminUser(user)) return true;
    const userId = Number(user?.id || 0);
    if (!Number.isInteger(userId) || userId <= 0) return false;
    const res = await client.query(
        `SELECT 1
         FROM report_sources rs
         WHERE rs.id = $1
           AND (
             rs.created_by = $2
             OR EXISTS (
               SELECT 1
                 FROM user_groups admin_ug
                WHERE admin_ug.user_id = $2
                  AND admin_ug.is_admin = TRUE
                  AND (
                    admin_ug.group_id = rs.sync_group_id
                    OR EXISTS (
                      SELECT 1
                        FROM user_groups creator_ug
                       WHERE creator_ug.user_id = rs.created_by
                         AND creator_ug.group_id = admin_ug.group_id
                    )
                  )
             )
           )
         LIMIT 1`,
        [reportSourceId, userId]
    );
    return res.rows.length > 0;
}

async function sheetIsPublished(sheetId) {
    const rows = await query(
        `SELECT 1
           FROM report_source_imports
          WHERE sheet_id = $1
            AND status IN ('published', 'superseded', 'pending_approval')
          LIMIT 1`,
        [sheetId]
    );
    return rows.length > 0;
}

function buildReportSourceLimitError(entitlements, currentReportSources) {
    const err = new Error("group_report_source_limit_exceeded");
    err.statusCode = 403;
    err.details = {
        maxReportSources: entitlements.maxReportSources,
        currentReportSources,
    };
    return err;
}

async function assertReportSourceLimitAvailable(client, groupId) {
    const parsedGroupId = Number.parseInt(groupId, 10);
    if (!Number.isInteger(parsedGroupId) || parsedGroupId <= 0) return;

    const groupRes = await client.query(
        "SELECT id, entitlements FROM groups WHERE id = $1 LIMIT 1 FOR UPDATE",
        [parsedGroupId]
    );
    const group = groupRes.rows?.[0];
    if (!group) return;

    const entitlements = normalizeGroupEntitlements(group.entitlements || {});
    if (!Number.isInteger(entitlements.maxReportSources) || entitlements.maxReportSources <= 0) return;

    const countRes = await client.query(
        `SELECT COUNT(DISTINCT rs.id)::int AS c
           FROM report_sources rs
          WHERE rs.is_inferred IS NOT TRUE
            AND (
              rs.sync_group_id = $1
              OR EXISTS (
                SELECT 1
                  FROM user_groups ug
                 WHERE ug.group_id = $1
                   AND ug.user_id = rs.created_by
              )
            )`,
        [parsedGroupId]
    );
    const currentReportSources = Number(countRes.rows?.[0]?.c || 0);
    if (currentReportSources >= entitlements.maxReportSources) {
        throw buildReportSourceLimitError(entitlements, currentReportSources);
    }
}

async function resolveReportSourceForUpload(client, { reportSourceId, reportSourceName, user, autosyncConfig = null }) {
    const sourceId = Number.parseInt(reportSourceId, 10);
    if (Number.isInteger(sourceId) && sourceId > 0) {
        const source = await client.query(
            `SELECT rs.id, rs.name, rs.created_by, rs.current_sheet_id, rs.sync_group_id,
                    rs.review_required, rs.review_schema_changes, rs.review_label_rules,
                    s.headers AS current_headers
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
        const userId = Number(user?.id || 0);
        const canWrite = row.created_by === userId || await canWriteToReportSource(client, user, sourceId);
        if (!canWrite) {
            const err = new Error("report_source_forbidden");
            err.statusCode = 403;
            throw err;
        }
        return {
            id: row.id,
            name: row.name,
            syncGroupId: row.sync_group_id || null,
            reviewRequired: !!row.review_required,
            reviewSchemaChanges: row.review_schema_changes !== false,
            reviewLabelRules: normalizeReviewLabelRules(row.review_label_rules),
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
    const existingByName = await client.query(
        `SELECT id
           FROM report_sources
          WHERE LOWER(TRIM(COALESCE(name, ''))) = LOWER(TRIM($1))
          LIMIT 1`,
        [name]
    );
    if (existingByName.rows.length) {
        const err = new Error("report_source_name_exists");
        err.statusCode = 409;
        err.details = { existing_report_source_id: existingByName.rows[0].id };
        throw err;
    }
    const targetGroupId = autosyncConfig?.enabled && autosyncConfig?.groupId
        ? autosyncConfig.groupId
        : resolveImportGroupId(user, null);
    await assertReportSourceLimitAvailable(client, targetGroupId);

    const firstUploadRequiresReview = await firstUploadRequiresReviewBySettings({
        query,
        key: REVIEW_DEFAULTS_SETTINGS_KEY,
    });
    const inserted = await client.query(
        `INSERT INTO report_sources (name, created_by, is_inferred, sync_group_id, review_required, updated_at)
         VALUES ($1, $2, FALSE, $3, $4, CURRENT_TIMESTAMP)
         RETURNING id, name`,
        [name, user?.id || null, targetGroupId || null, firstUploadRequiresReview]
    );
    return {
        id: inserted.rows[0].id,
        name: inserted.rows[0].name,
        syncGroupId: Number.parseInt(user?.resolved_group_id ?? "", 10) || null,
        reviewRequired: firstUploadRequiresReview,
        reviewSchemaChanges: true,
        reviewLabelRules: {},
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
        `SELECT rs.id, rs.name, rs.current_sheet_id, rs.sync_group_id,
                rs.review_required, rs.review_schema_changes, rs.review_label_rules,
                s.headers AS current_headers
         FROM report_sources rs
         LEFT JOIN sheets s ON s.id = rs.current_sheet_id
         WHERE rs.id = $1
         FOR UPDATE OF rs`,
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
        syncGroupId: row.sync_group_id || null,
        reviewRequired: !!row.review_required,
        reviewSchemaChanges: row.review_schema_changes !== false,
        reviewLabelRules: normalizeReviewLabelRules(row.review_label_rules),
        previousSheetId: row.current_sheet_id || null,
        previousHeaders: typeof row.current_headers === "string" ? JSON.parse(row.current_headers) : (row.current_headers || []),
        isNew: false,
    };
}

function resolveImportGroupId(user, reportSource) {
    const raw = reportSource?.syncGroupId ?? user?.resolved_group_id;
    const parsed = Number.parseInt(raw, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function loadDlpSettings(client) {
    const rows = await client.query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [DLP_SETTINGS_KEY]);
    return normalizeDlpSettings(rows?.rows?.[0]?.value || rows?.[0]?.value || {});
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
const XLSX_WORKER_DEFAULT_MEMORY_MB = Number.parseInt(process.env.XLSX_WORKER_DEFAULT_MEMORY_MB || "8192", 10);
const XLSX_WORKER_MIN_MEMORY_MB = Number.parseInt(process.env.XLSX_WORKER_MIN_MEMORY_MB || "64", 10);
const XLSX_WORKER_MAX_MEMORY_MB = Number.parseInt(process.env.XLSX_WORKER_MAX_MEMORY_MB || "8192", 10);
const BUFFERED_IMPORT_LIMIT_MB = Math.max(
    1,
    Number.parseInt(process.env.MAX_BUFFERED_IMPORT_MB || process.env.MAX_UPLOAD_FILE_MB || "50", 10) || 50
);
const BUFFERED_IMPORT_LIMIT_BYTES = BUFFERED_IMPORT_LIMIT_MB * 1024 * 1024;

async function applyReportSourceAutosyncConfig(client, reportSourceId, autosyncConfig = null) {
    if (!autosyncConfig?.enabled) return;
    await client.query(
        `UPDATE report_sources
            SET sync_enabled = TRUE,
                sync_provider = $2,
                sync_source_ref = $3,
                sync_group_id = $4,
                sync_user_id = $5,
                sync_display_name = $6,
                sync_file_label = $7,
                sync_remote_marker = COALESCE($8, sync_remote_marker),
                sync_last_attempted_marker = COALESCE($8, sync_last_attempted_marker),
                sync_remote_modified_at = COALESCE($9::timestamp, sync_remote_modified_at),
                sync_last_checked_at = CURRENT_TIMESTAMP,
                sync_last_synced_at = CURRENT_TIMESTAMP,
                sync_last_error = NULL,
                sync_updated_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1`,
        [
            reportSourceId,
            autosyncConfig.provider,
            autosyncConfig.sourceRef,
            autosyncConfig.groupId,
            autosyncConfig.userId,
            autosyncConfig.displayName,
            autosyncConfig.fileLabel,
            autosyncConfig.remoteMarker,
            autosyncConfig.remoteModifiedAt,
        ]
    );
}

async function userCanApproveReportSource(client, user, reportSourceId) {
    if (String(user?.role || "").toLowerCase() === "admin") return true;
    return canWriteToReportSource(client, user, reportSourceId);
}

function normalizeWorkerMemoryLimitMb(value, fallback = XLSX_WORKER_DEFAULT_MEMORY_MB) {
    return normalizeWorkerMemoryLimitMbUtil(value, fallback, {
        minMemoryMb: XLSX_WORKER_MIN_MEMORY_MB,
        maxMemoryMb: XLSX_WORKER_MAX_MEMORY_MB,
    });
}

function assertBufferedImportSizeAllowed(fileSize, parseMemoryLimitMb) {
    return assertBufferedImportSizeAllowedUtil({
        fileSize,
        parseMemoryLimitMb,
        bufferedImportLimitBytes: BUFFERED_IMPORT_LIMIT_BYTES,
        fallbackMemoryMb: XLSX_WORKER_DEFAULT_MEMORY_MB,
        limits: {
            minMemoryMb: XLSX_WORKER_MIN_MEMORY_MB,
            maxMemoryMb: XLSX_WORKER_MAX_MEMORY_MB,
        },
    });
}

async function resolveTenantParseMemoryLimitMb(user) {
    return resolveTenantParseMemoryLimitMbUtil({
        user,
        query,
        resolveRuntimeGroupIdForUser,
        normalizeGroupEntitlements,
        fallbackMemoryMb: XLSX_WORKER_DEFAULT_MEMORY_MB,
        limits: {
            minMemoryMb: XLSX_WORKER_MIN_MEMORY_MB,
            maxMemoryMb: XLSX_WORKER_MAX_MEMORY_MB,
        },
    });
}

function parseWorkbookInWorker(buffer, { memoryLimitMb } = {}) {
    return parseWorkbookInWorkerUtil({
        buffer,
        memoryLimitMb,
        fallbackMemoryMb: XLSX_WORKER_DEFAULT_MEMORY_MB,
        limits: {
            minMemoryMb: XLSX_WORKER_MIN_MEMORY_MB,
            maxMemoryMb: XLSX_WORKER_MAX_MEMORY_MB,
        },
        Worker,
        workerPath: XLSX_WORKER_PATH,
        timeoutMs: XLSX_WORKER_TIMEOUT_MS,
    });
}

function parseWorkbookInWorkerStreamed(buffer, { memoryLimitMb } = {}) {
    return parseWorkbookInWorkerStreamedUtil({
        buffer,
        memoryLimitMb,
        fallbackMemoryMb: XLSX_WORKER_DEFAULT_MEMORY_MB,
        limits: {
            minMemoryMb: XLSX_WORKER_MIN_MEMORY_MB,
            maxMemoryMb: XLSX_WORKER_MAX_MEMORY_MB,
        },
        Worker,
        workerPath: XLSX_WORKER_PATH,
        timeoutMs: XLSX_WORKER_TIMEOUT_MS,
    });
}

function parseWorkbookFromBufferWithFallback(fileBuffer, options = {}) {
    return parseWorkbookFromBufferWithFallbackUtil({
        fileBuffer,
        options,
        XLSX,
    });
}

async function parseWorkbookBufferOrThrow(fileBuffer, options = {}) {
    return parseWorkbookBufferOrThrowUtil({
        fileBuffer,
        options,
        parseWorkbookInWorkerFn: (buf, opts) => parseWorkbookInWorker(buf, opts),
        parseWorkbookFromBufferWithFallbackFn: (buf, opts) => parseWorkbookFromBufferWithFallback(buf, opts),
        toImportError,
    });
}

async function parseWorkbookFileOrThrow(filePath, options = {}) {
    return parseWorkbookFileOrThrowUtil({
        filePath,
        options,
        fs,
        parseWorkbookBufferOrThrowFn: (buf, opts) => parseWorkbookBufferOrThrow(buf, opts),
    });
}

async function classifyAndPersistBusinessContext({
    reportSource,
    sheetId,
    groupId,
    sourceKind,
    sourceName,
    fileName,
    sheetNames,
    headers,
    sampleRows,
}) {
    if (!sheetId) return null;
    try {
        const classification = await classifySheetBusinessContext({
            sourceName: sourceName || reportSource?.name,
            fileName,
            sheetNames,
            headers,
            sampleRows,
            sourceKind,
            groupId,
        });
        if (!classification) return null;
        const storedClassification = {
            ...classification,
            status: "pending",
            sheetId,
        };
        await query(
            `UPDATE sheets
                SET business_classification = $2::jsonb,
                    business_classification_model = $3,
                    business_classification_status = 'pending',
                    business_classification_updated_at = CURRENT_TIMESTAMP
              WHERE id = $1`,
            [sheetId, JSON.stringify(storedClassification), classification.model || null]
        );
        return storedClassification;
    } catch (err) {
        if (AI_DEBUG_LOGS) console.warn("[business_classification] skipped:", err?.message || err);
        return null;
    }
}

async function carryForwardBusinessClassificationIfPrompted({
    reportSourceId,
    sheetId,
    fileLabel,
}) {
    const sourceId = Number.parseInt(reportSourceId, 10);
    const label = String(fileLabel || "").trim();
    const normalizedLabel = label.toLowerCase();
    if (!Number.isInteger(sourceId) || sourceId <= 0 || !sheetId || !label) return null;

    const priorRows = await query(
        `SELECT s.id AS sheet_id,
                s.business_classification,
                s.business_classification_status,
                s.business_classification_model,
                rsi.import_version
           FROM report_source_imports rsi
           JOIN sheets s ON s.id = rsi.sheet_id
          WHERE rsi.report_source_id = $1
            AND LOWER(TRIM(COALESCE(rsi.file_label, ''))) = $2
            AND rsi.sheet_id <> $3
            AND COALESCE(s.business_classification_status, 'none') <> 'none'
            AND s.business_classification <> '{}'::jsonb
          ORDER BY rsi.import_version DESC, rsi.created_at DESC
          LIMIT 1`,
        [sourceId, normalizedLabel, sheetId]
    );
    if (!priorRows.length) return null;

    const prior = priorRows[0];
    const current = prior.business_classification && typeof prior.business_classification === "object"
        ? prior.business_classification
        : {};
    if (!Object.keys(current).length) return null;

    const priorStatus = String(prior.business_classification_status || current.status || "").toLowerCase();
    const status = priorStatus === "confirmed" || priorStatus === "rejected"
        ? priorStatus
        : "already_prompted";
    const next = {
        ...current,
        status,
        sheetId,
        inheritedFromSheetId: prior.sheet_id,
        inheritedFromVersion: Number(prior.import_version || 0) || null,
        promptSuppressed: true,
        inheritedAt: new Date().toISOString(),
    };

    await query(
        `UPDATE sheets
            SET business_classification = $2::jsonb,
                business_classification_model = $3,
                business_classification_status = $4,
                business_classification_updated_at = CURRENT_TIMESTAMP,
                business_classification_confirmed_at = CASE
                    WHEN $4 IN ('confirmed', 'rejected') THEN CURRENT_TIMESTAMP
                    ELSE business_classification_confirmed_at
                END
          WHERE id = $1`,
        [sheetId, JSON.stringify(next), prior.business_classification_model || current.model || null, status]
    );
    return next;
}

const executeImportFromParsedWorkbook = createImportExecution({
    MAX_UPLOAD_SHEETS,
    MAX_UPLOAD_COLUMNS,
    MAX_UPLOAD_ROWS_PER_SHEET,
    MAX_UPLOAD_TOTAL_ROWS,
    IMPORT_STAGING_FINALIZE_ENABLED,
    toImportError,
    getClient,
    resolveReportSourceForUpload,
    loadReportSourceForImport,
    resolveImportGroupId,
    loadDlpSettings,
    isPlatformAdminUser,
    groupHasFeature,
    scanRowsForDlpInWorker: scanRowsForDlp,
    writeAuditLog,
    applyDlpColumnMasking,
    loadSemanticProfileRules,
    buildSheetSemanticProfile,
    maybeEnrichSheetSemanticProfileWithAi,
    evaluateAiChatCompatibilityForImport,
    canApproveWithMaskedDlp,
    AI_CHAT_COMPATIBILITY_ENFORCE_IMPORT,
    getVersionedFilename,
    buildHeaderDiff,
    getSchemaStatus,
    resolveReviewPolicy,
    normalizeSheetRow,
    buildInsightSummaryRows,
    carryForwardSourceSecurity,
    applyReportSourceAutosyncConfig,
    finishImportJob,
    carryForwardBusinessClassificationIfPrompted,
    classifyAndPersistBusinessContext,
});

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
    autosyncConfig = null,
    mode = null,
    enforceOwnership = true,
}) {
    // Persist both the job and payload in one transaction so a restart cannot drop queued work.
    const payloadMeta = {
        approvalRequired: !!approvalRequired,
        displayName,
        fileLabel,
        reportSourceId: rawReportSourceId ? Number.parseInt(rawReportSourceId, 10) : null,
        reportSourceName: rawReportSourceName || null,
        queuedByUserId: user?.id || null,
        queuedGroupId: Number.parseInt(user?.resolved_group_id ?? "", 10) || null,
        parseMemoryLimitMb: normalizeWorkerMemoryLimitMb(parseMemoryLimitMb),
        autosyncEnabled: !!autosyncConfig?.enabled,
        autosyncProvider: autosyncConfig?.provider || null,
        autosyncSourceRef: autosyncConfig?.sourceRef || null,
        autosyncGroupId: autosyncConfig?.groupId || null,
        autosyncUserId: autosyncConfig?.userId || null,
        autosyncRemoteMarker: autosyncConfig?.remoteMarker || null,
        autosyncRemoteModifiedAt: autosyncConfig?.remoteModifiedAt || null,
        autosyncDisplayName: autosyncConfig?.displayName || null,
        autosyncFileLabel: autosyncConfig?.fileLabel || null,
        classificationSourceKind: autosyncConfig?.enabled ? "autosync" : "manual_upload",
    };
    const client = await getClient();
    try {
        await client.query("BEGIN");
        const resolvedSource = enforceOwnership
            ? await resolveReportSourceForUpload(client, {
                reportSourceId: rawReportSourceId || null,
                reportSourceName: rawReportSourceName || null,
                user,
                autosyncConfig,
            })
            : await loadReportSourceForImport(client, rawReportSourceId);
        payloadMeta.reportSourceId = resolvedSource.id;
        payloadMeta.reportSourceName = resolvedSource.name;
        payloadMeta.queuedGroupId = Number.parseInt(resolvedSource?.syncGroupId ?? payloadMeta.queuedGroupId ?? "", 10) || null;

        await createImportJob(client, {
            id: importJobId,
            mode: mode || (approvalRequired ? "async_pending_approval" : "async"),
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

async function executeQueuedImportJob(job, payloadRows = null) {
    const t0 = Date.now();
    // Payload lives in DB until the job reaches a terminal state.
    const rows = payloadRows || await query(
        `SELECT file_bytes, payload_meta, byte_size
           FROM import_job_payloads
          WHERE job_id = $1
          LIMIT 1`,
        [job.id]
    );
    if (!rows.length) {
        throw toImportError("import_payload_missing", 500);
    }
    const payload = rows[0];
    const payloadMeta = parseJsonMaybe(payload.payload_meta, {}) || {};
    const displayName = sanitizeDisplayName(payloadMeta.displayName);
    const fileLabel = String(payloadMeta.fileLabel || displayName || "File").trim();
    if (!displayName) throw toImportError("display_name_required", 400);

    const useStreamingV2 = await queuedImportStreamingV2EnabledBySettings({
        query,
        key: IMPORT_PIPELINE_SETTINGS_KEY,
    });
    let parsedResult;
    if (useStreamingV2) {
        try {
            parsedResult = await parseWorkbookInWorkerStreamed(payload.file_bytes, {
                memoryLimitMb: payloadMeta.parseMemoryLimitMb,
            });
        } catch (streamErr) {
            if (AI_DEBUG_LOGS) console.warn("[import_stream_v2] fallback to legacy parser:", streamErr?.message || streamErr);
            parsedResult = await parseWorkbookBufferOrThrow(payload.file_bytes, {
                memoryLimitMb: payloadMeta.parseMemoryLimitMb,
            });
        }
    } else {
        parsedResult = await parseWorkbookBufferOrThrow(payload.file_bytes, {
            memoryLimitMb: payloadMeta.parseMemoryLimitMb,
        });
    }
    let stagedSourceJobId = null;
    const stagingWriteEnabled = await importStagingWriteEnabledBySettings({
        query,
        key: IMPORT_PIPELINE_SETTINGS_KEY,
        envDefault: IMPORT_STAGING_WRITE_ENABLED,
    });
    const stagingFinalizeEnabled = await importStagingFinalizeEnabledBySettings({
        query,
        key: IMPORT_PIPELINE_SETTINGS_KEY,
        envDefault: IMPORT_STAGING_FINALIZE_ENABLED,
    });
    const useStagingFinalize = stagingFinalizeEnabled === true && stagingWriteEnabled === true && useStreamingV2 === true;
    if (useStagingFinalize) stagedSourceJobId = job.id;
    const { responsePayload } = await executeImportFromParsedWorkbook({
        parsedResult,
        approvalRequired: !!payloadMeta.approvalRequired,
        importJobId: job.id,
        reportSourceId: payloadMeta.reportSourceId || job.report_source_id,
        reportSourceName: payloadMeta.reportSourceName || null,
        displayName,
        fileLabel,
        originalName: String(job.original_filename || "uploaded.xlsx"),
        user: {
            id: job.requested_by || null,
            role: "admin",
            resolved_group_id: payloadMeta.queuedGroupId || null,
        },
        enforceOwnership: false,
        fileSizeBytes: Number(payload.byte_size || payloadMeta.fileSize || 0),
        autosyncConfig: payloadMeta.autosyncEnabled ? {
            enabled: true,
            provider: payloadMeta.autosyncProvider,
            sourceRef: payloadMeta.autosyncSourceRef,
            groupId: payloadMeta.autosyncGroupId,
            userId: payloadMeta.autosyncUserId,
            remoteMarker: payloadMeta.autosyncRemoteMarker,
            remoteModifiedAt: payloadMeta.autosyncRemoteModifiedAt,
            displayName: payloadMeta.autosyncDisplayName,
            fileLabel: payloadMeta.autosyncFileLabel,
        } : null,
        classificationSourceKind: payloadMeta.classificationSourceKind || (payloadMeta.autosyncEnabled ? "autosync" : "manual_upload"),
        stagedSourceJobId,
    });

    if (stagingWriteEnabled === true && useStreamingV2 === true) {
        try {
            const sheetNames = Array.isArray(parsedResult?.sheetNames) ? parsedResult.sheetNames : [];
            const sheets = parsedResult?.sheets && typeof parsedResult.sheets === "object" ? parsedResult.sheets : {};
            await query(`DELETE FROM import_row_staging WHERE job_id = $1`, [job.id]);
            for (const sn of sheetNames) {
                const rows = Array.isArray(sheets[sn]) ? sheets[sn] : [];
                const CHUNK = 500;
                for (let i = 0; i < rows.length; i += CHUNK) {
                    const chunk = rows.slice(i, i + CHUNK);
                    const values = [];
                    const placeholders = [];
                    let p = 1;
                    chunk.forEach((r, idx) => {
                        values.push(job.id, sn, i + idx, JSON.stringify(normalizeSheetRow(r)));
                        placeholders.push(`($${p++},$${p++},$${p++},$${p++}::jsonb)`);
                    });
                    await query(
                        `INSERT INTO import_row_staging (job_id, sheet_name, row_index, row_data) VALUES ${placeholders.join(",")}`,
                        values
                    );
                }
            }
        } catch (stagingErr) {
            if (AI_DEBUG_LOGS) console.warn("[import_staging_write] skipped:", stagingErr?.message || stagingErr);
        }
    }

    await query("DELETE FROM import_job_payloads WHERE job_id = $1", [job.id]);
    if (stagedSourceJobId) {
        await query("DELETE FROM import_row_staging WHERE job_id = $1", [job.id]).catch(() => {});
    }
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
    recordIngestionLatencyMs(Date.now() - t0);
}

return {
  loadEmailIngestSettingsForGroup,
  resolveEmailIngestCustomer,
  resolveOrCreateEmailReportSource,
  assertReportSourceLimitAvailable,
  resolveReportSourceForUpload,
  loadReportSourceForImport,
  classifyAndPersistBusinessContext,
  carryForwardBusinessClassificationIfPrompted,
  enqueueDbImportJob,
  executeQueuedImportJob,
};
}
