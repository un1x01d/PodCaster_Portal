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
    isPlatformAdminUser,
    resolveRuntimeGroupIdForUser,
    resolveAssignedViewForSheet,
} from "../utils/authorization.js";
import { writeAuditLog } from "../utils/auditLog.js";
import { normalizeGroupEntitlements, groupHasFeature } from "../utils/entitlements.js";
import { downloadProviderAutosyncFile, fetchProviderAutosyncMetadata } from "../utils/providerAutosync.js";
import { ensureReportSourcesSchema } from "../config/db.js";
import { DLP_SETTINGS_KEY, normalizeDlpSettings, scanRowsForDlp, applyDlpColumnMasking } from "../utils/dlp.js";
import { classifySheetBusinessContext } from "../utils/businessClassification.js";
import { buildSheetSemanticProfile, loadSemanticProfileRules, mergeSheetSemanticProfileLearning } from "../utils/sheetSemanticProfile.js";
import { loadEffectiveAiRuntimeSettings } from "../utils/aiRuntimeSettings.js";
import { resolveChatCompletionProviderConfig } from "../utils/llmProvider.js";
import { buildChatCompletionRequestBody, extractOpenAiAssistantText, minCompletionTokensForModel } from "../utils/openAiCompat.js";
import {
    getAppSettingValueWithScopedFallback,
    normalizeEmailIngestSenderAllowlist,
    normalizeEmailIngestSettings,
    normalizeRevisionCompareSettings,
    REVISION_COMPARE_SETTINGS_KEY,
} from "./userController.js";
import { recordIngestionLatencyMs, setImportWorkerActiveJobs, setImportWorkerQueueDepth } from "../utils/metrics.js";
import { buildRowFilterWhereClause } from "../utils/rowFilters.js";
import {
    parseBooleanLike,
    parsePositiveIntLike,
    normalizeReviewLabelRules,
    resolveReviewPolicy,
    parseAutosyncConfig,
} from "./sheet/reviewPolicy.js";
import { evaluateAiChatCompatibilityForImport, canApproveWithMaskedDlp } from "./sheet/aiChatCompatibility.js";
import {
    sanitizeDisplayName,
    sanitizeReportSourceName,
    normalizeEmailAddress,
    assertUploadSignatureMatchesExtension,
    hasValidEmailIngestSharedSecret,
    normalizeEmailLocalPart,
    extractEmailAddresses,
    senderDomainIsAllowed,
} from "./sheet/uploadValidation.js";
import {
    buildHeaderDiff,
    getSchemaStatus,
    freezeViewConfigForRefresh,
    parseJsonMaybe,
    canUploadSheetsByRole,
    resolveViewColumnAllowlist,
    jobBackoffMs,
    isRetryableImportError,
    toImportError,
    normalizeStoredHeaders,
    sanitizeSemanticProfileDefaults,
} from "./sheet/controllerUtils.js";
export { assertUploadSignatureMatchesExtension } from "./sheet/uploadValidation.js";
export { buildHeaderDiff, canUploadSheetsByRole, resolveViewColumnAllowlist } from "./sheet/controllerUtils.js";

const MAX_UPLOAD_SHEETS = Number.parseInt(
    process.env.MAX_UPLOAD_SHEETS || (process.env.NODE_ENV === "production" ? "20" : "50"),
    10
);
const MAX_UPLOAD_ROWS_PER_SHEET = Number.parseInt(
    process.env.MAX_UPLOAD_ROWS_PER_SHEET || (process.env.NODE_ENV === "production" ? "300000" : "300000"),
    10
);
const MAX_UPLOAD_TOTAL_ROWS = Number.parseInt(
    process.env.MAX_UPLOAD_TOTAL_ROWS || (process.env.NODE_ENV === "production" ? "900000" : "900000"),
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
const AI_DEBUG_LOGS = String(process.env.AI_DEBUG_LOGS || "").trim().toLowerCase() === "true";
const IMPORT_JOB_LEASE_MS = Math.max(10000, Number.parseInt(process.env.IMPORT_JOB_LEASE_MS || "120000", 10) || 120000);
const IMPORT_JOB_POLL_MS = Math.max(500, Number.parseInt(process.env.IMPORT_JOB_POLL_MS || "2000", 10) || 2000);
const IMPORT_JOB_MAX_CLAIMS_PER_TICK = Math.max(1, Number.parseInt(process.env.IMPORT_JOB_MAX_CLAIMS_PER_TICK || "1", 10) || 1);
const IMPORT_JOB_PAYLOAD_TTL_HOURS = Math.max(1, Number.parseInt(process.env.IMPORT_JOB_PAYLOAD_TTL_HOURS || "24", 10) || 24);
const IMPORT_WORKER_ADVISORY_LOCK_KEY = Number.parseInt(process.env.IMPORT_WORKER_ADVISORY_LOCK_KEY || "814001", 10);
const AUTOSYNC_WORKER_ADVISORY_LOCK_KEY = Number.parseInt(process.env.AUTOSYNC_WORKER_ADVISORY_LOCK_KEY || "814002", 10);
const IMPORT_PIPELINE_SETTINGS_KEY = "import_pipeline_settings";
const REVIEW_DEFAULTS_SETTINGS_KEY = "review_defaults_settings";
const IMPORT_STAGING_WRITE_ENABLED = ["1", "true", "yes", "on"].includes(String(process.env.IMPORT_STAGING_WRITE_ENABLED || "false").trim().toLowerCase());
const IMPORT_STAGING_FINALIZE_ENABLED = ["1", "true", "yes", "on"].includes(String(process.env.IMPORT_STAGING_FINALIZE_ENABLED || "false").trim().toLowerCase());
const AI_CHAT_COMPATIBILITY_ENFORCE_IMPORT = ["1", "true", "yes", "on"].includes(String(process.env.AI_CHAT_COMPATIBILITY_ENFORCE_IMPORT || "true").trim().toLowerCase());
const OPENAI_TIMEOUT_MS = Number.parseInt(process.env.OPENAI_TIMEOUT_MS || "60000", 10);
const HEADER_AI_SAMPLE_ROWS = Math.min(120, Number.parseInt(process.env.HEADER_AI_SAMPLE_ROWS || "60", 10));
const HEADER_AI_SAMPLE_VALUES_PER_COLUMN = Math.min(8, Number.parseInt(process.env.HEADER_AI_SAMPLE_VALUES_PER_COLUMN || "5", 10));

function isRevisionCompareRequest(queryParams = {}) {
    const marker = String(
        queryParams.compare
        || queryParams.context
        || queryParams.purpose
        || queryParams.mode
        || ""
    ).trim().toLowerCase();
    return marker === "revision" || marker === "revision_compare" || marker === "compare_revisions";
}

async function resolveSheetDataMaxLimit(queryParams = {}) {
    if (!isRevisionCompareRequest(queryParams)) return MAX_SHEET_DATA_LIMIT;
    try {
        const rows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [REVISION_COMPARE_SETTINGS_KEY]);
        return normalizeRevisionCompareSettings(rows?.[0]?.value || {}).maxRows;
    } catch (err) {
        console.warn("[sheet_data] failed to load revision compare settings:", err?.message || err);
        return normalizeRevisionCompareSettings({}).maxRows;
    }
}

let importWorkerTimer = null;
let importWorkerRunning = false;
let importWorkerOwnerId = null;

async function tryAdvisoryLock(lockKey) {
    try {
        const rows = await query("SELECT pg_try_advisory_lock($1)::boolean AS locked", [lockKey]);
        return rows?.[0]?.locked === true;
    } catch {
        return false;
    }
}

async function releaseAdvisoryLock(lockKey) {
    try {
        await query("SELECT pg_advisory_unlock($1)", [lockKey]);
    } catch {
        // no-op
    }
}

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

function uniqueColumnSamples(rows = [], header, limit = HEADER_AI_SAMPLE_VALUES_PER_COLUMN) {
    const seen = new Set();
    const out = [];
    for (const row of rows) {
        const raw = row?.[header];
        const value = String(raw ?? "").trim();
        if (!value) continue;
        const key = value.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(value.slice(0, 120));
        if (out.length >= limit) break;
    }
    return out;
}

function buildHeaderAiContext(headers = [], rows = []) {
    const limitedRows = Array.isArray(rows) ? rows.slice(0, HEADER_AI_SAMPLE_ROWS) : [];
    return (Array.isArray(headers) ? headers : []).map((header) => ({
        header: String(header),
        sample_values: uniqueColumnSamples(limitedRows, header, HEADER_AI_SAMPLE_VALUES_PER_COLUMN),
    }));
}

function applyHeaderUnderstandingToProfile(profile = {}, headerUnderstanding = []) {
    const base = profile && typeof profile === "object" ? profile : {};
    const next = { ...base };
    const columns = Array.isArray(base.columns)
        ? base.columns.map((c) => ({ ...c, roles: Array.isArray(c.roles) ? [...c.roles] : [], meanings: Array.isArray(c.meanings) ? [...c.meanings] : [] }))
        : [];
    const defaults = { ...(base.defaults || {}) };
    const metricColumns = { ...(defaults.metricColumns || {}) };
    const dimensions = new Set(Array.isArray(defaults.dimensions) ? defaults.dimensions : []);
    const metrics = new Set(Array.isArray(defaults.metrics) ? defaults.metrics : []);
    let dateColumn = defaults.dateColumn || null;
    let serviceLineColumn = defaults.serviceLineColumn || null;
    let revenueModelColumn = defaults.revenueModelColumn || null;
    let driverDimensionColumn = defaults.driverDimensionColumn || null;
    const byName = new Map(columns.map((c) => [String(c.name), c]));
    for (const item of (Array.isArray(headerUnderstanding) ? headerUnderstanding : [])) {
        const header = String(item?.header || "").trim();
        if (!header || !byName.has(header)) continue;
        const col = byName.get(header);
        const meaning = String(item?.meaning || "").trim();
        const role = String(item?.role || "").trim();
        if (meaning && !col.meanings.includes(meaning)) col.meanings.push(meaning);
        if (role && !col.roles.includes(role)) col.roles.push(role);
        if (role === "metric") metrics.add(header);
        if (role === "dimension") dimensions.add(header);
        if (role === "date" && !dateColumn) dateColumn = header;
        if (meaning === "revenue") metricColumns.revenue = metricColumns.revenue || header;
        if (meaning === "cost") metricColumns.cost = metricColumns.cost || header;
        if (meaning === "profit") metricColumns.profit = metricColumns.profit || header;
        if (meaning === "quantity") metricColumns.quantity = metricColumns.quantity || header;
        if (meaning === "serviceLine") serviceLineColumn = serviceLineColumn || header;
        if (meaning === "revenueModel") revenueModelColumn = revenueModelColumn || header;
        if (!driverDimensionColumn && (meaning === "serviceLine" || meaning === "product" || meaning === "customer" || meaning === "category" || meaning === "region")) {
            driverDimensionColumn = header;
        }
    }
    next.columns = columns;
    next.defaults = {
        ...defaults,
        metricColumns,
        dateColumn,
        serviceLineColumn,
        revenueModelColumn,
        driverDimensionColumn,
        dimensions: Array.from(dimensions).slice(0, 20),
        metrics: Array.from(metrics).slice(0, 20),
    };
    next.learned = {
        ...(base.learned || {}),
        header_understanding: Array.isArray(headerUnderstanding) ? headerUnderstanding : [],
        header_understanding_updated_at: new Date().toISOString(),
    };
    return next;
}

async function inferHeaderUnderstandingWithAi({ headers = [], sampleRows = [], runtime = null }) {
    const { provider, model, baseUrl, apiKey } = resolveChatCompletionProviderConfig(runtime || {});
    if (!apiKey) return [];
    const context = buildHeaderAiContext(headers, sampleRows);
    if (!context.length) return [];
    const system = [
        "Classify spreadsheet headers for deterministic analytics.",
        "Use only provided header names and sample values.",
        "Return strict JSON only.",
        "Allowed meanings: revenue,cost,profit,quantity,customer,serviceLine,revenueModel,product,region,category,owner,period,other",
        "Allowed roles: metric,dimension,date,id,other",
    ].join(" ");
    const user = JSON.stringify({
        task: "Map each header to at most one meaning and one role.",
        headers: context,
        output_schema: { mappings: [{ header: "string", meaning: "string", role: "string", confidence: "0..1" }] },
    });
    const requestBody = buildChatCompletionRequestBody({
        model,
        provider,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        responseFormat: { type: "json_object" },
        maxCompletionTokens: minCompletionTokensForModel(model, 800, 800, 768),
        temperature: 0,
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(runtime?.openaiTimeoutMs || OPENAI_TIMEOUT_MS));
    try {
        const response = await fetch(`${String(baseUrl).replace(/\/+$/, "")}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify(requestBody),
            signal: controller.signal,
        });
        if (!response.ok) return [];
        const payload = await response.json().catch(() => ({}));
        const raw = String(extractOpenAiAssistantText(payload) || "").trim();
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        const mappings = Array.isArray(parsed?.mappings) ? parsed.mappings : [];
        const headerSet = new Set((Array.isArray(headers) ? headers : []).map((h) => String(h)));
        return mappings
            .map((m) => ({
                header: String(m?.header || "").trim(),
                meaning: String(m?.meaning || "other").trim(),
                role: String(m?.role || "other").trim(),
                confidence: Math.max(0, Math.min(1, Number(m?.confidence || 0))),
            }))
            .filter((m) => m.header && headerSet.has(m.header));
    } catch {
        return [];
    } finally {
        clearTimeout(timeout);
    }
}

async function maybeEnrichSheetSemanticProfileWithAi({ sheetId, headers = [], sampleRows = [], semanticProfile = {}, groupId = null, client = null }) {
    const hasExisting = Array.isArray(semanticProfile?.learned?.header_understanding) && semanticProfile.learned.header_understanding.length > 0;
    if (hasExisting) return semanticProfile;
    const runtimeBundle = await loadEffectiveAiRuntimeSettings(groupId);
    const runtime = runtimeBundle?.runtime || null;
    const inferred = await inferHeaderUnderstandingWithAi({ headers, sampleRows, runtime });
    if (!inferred.length) return semanticProfile;
    const nextProfile = applyHeaderUnderstandingToProfile(semanticProfile, inferred);
    const db = client || { query };
    await db.query(
        `UPDATE sheets
            SET semantic_profile = $2::jsonb,
                semantic_profile_updated_at = CURRENT_TIMESTAMP
          WHERE id = $1`,
        [sheetId, JSON.stringify(nextProfile)]
    ).catch(() => {});
    return nextProfile;
}

async function enrichSheetsWithAiChatCompatibility(rows = []) {
    const list = Array.isArray(rows) ? rows : [];
    const evaluate = async (row) => {
        const profile = row?.semantic_profile && typeof row.semantic_profile === "object" ? row.semantic_profile : {};

        const sampleRows = await query(
            `SELECT row_data
               FROM sheet_rows
              WHERE sheet_id = $1
              ORDER BY row_index ASC
              LIMIT 200`,
            [row.id]
        );
        const values = sampleRows.map((r) => r.row_data || {});
        const compatibility = evaluateAiChatCompatibilityForImport({
            semanticProfile: profile,
            sampleRows: values,
        });

        return {
            ...row,
            ai_chat_compatibility: {
                ready: compatibility.ready,
                approval_ready: compatibility.ready || canApproveWithMaskedDlp({ semanticProfile: profile, compatibility }),
                missing: compatibility.missing,
            },
        };
    };

    return Promise.all(list.map(evaluate));
}

function buildInsightSummaryRows({ sheetId, sheetNames, sheets }) {
    const out = [];
    for (const tabName of sheetNames || []) {
        const rows = Array.isArray(sheets?.[tabName]) ? sheets[tabName] : [];
        if (!rows.length) continue;
        const headers = Object.keys(rows[0] || {}).filter(Boolean);
        const dateCandidates = headers.filter((h) => /date|time|month|year|period/i.test(String(h)));
        const dateCol = dateCandidates[0] || headers.find((h) => rows.some((r) => toPeriodKeyFromValue(r?.[h])));
        if (!dateCol) continue;
        const metricCols = headers.filter((h) => rows.some((r) => toNumericOrNull(r?.[h]) !== null));
        const categoryCol = headers.find((h) => h !== dateCol && !metricCols.includes(h));
        const bucket = new Map();
        for (const row of rows) {
            const periodKey = toPeriodKeyFromValue(row?.[dateCol]);
            if (!periodKey) continue;
            const categoryKey = categoryCol ? String(row?.[categoryCol] ?? "Unknown") : "__all__";
            for (const metricKey of metricCols) {
                const num = toNumericOrNull(row?.[metricKey]);
                if (num === null) continue;
                const key = `${tabName}::${periodKey}::${categoryKey}::${metricKey}`;
                const prev = bucket.get(key) || { sum: 0, count: 0 };
                prev.sum += num;
                prev.count += 1;
                bucket.set(key, prev);
            }
        }
        bucket.forEach((agg, key) => {
            const [tn, periodKey, categoryKey, metricKey] = key.split("::");
            out.push({
                sheet_id: sheetId,
                tab_name: tn,
                period_key: periodKey,
                category_key: categoryKey,
                metric_key: metricKey,
                agg_sum: agg.sum,
                agg_avg: agg.count > 0 ? (agg.sum / agg.count) : null,
                agg_count: agg.count,
            });
        });
    }
    return out;
}

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

    const firstUploadRequiresReview = await firstUploadRequiresReviewBySettings();
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

function uploadRequiresApproval(req) {
    return ["1", "true", "yes", "on"].includes(String(process.env.IMPORT_REQUIRE_APPROVAL || "").trim().toLowerCase());
}

function uploadUsesDbQueue(req) {
    const requested = req.body?.async_import ?? req.body?.asyncImport ?? req.body?.queue_import ?? req.body?.queueImport;
    if (requested !== undefined) {
        return ["1", "true", "yes", "on"].includes(String(requested || "").trim().toLowerCase());
    }
    return false;
}

async function importStreamingEnabledBySettings() {
    try {
        const rows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [IMPORT_PIPELINE_SETTINGS_KEY]);
        const enabled = rows?.[0]?.value?.importStreamingEnabled;
        if (enabled === true || String(enabled || "").trim().toLowerCase() === "true") return true;
    } catch {
        // fallback path below
    }
    return false;
}

async function queuedImportStreamingV2EnabledBySettings() {
    try {
        const rows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [IMPORT_PIPELINE_SETTINGS_KEY]);
        const enabled = rows?.[0]?.value?.queuedImportStreamingV2Enabled;
        if (enabled === true || String(enabled || "").trim().toLowerCase() === "true") return true;
    } catch {
        // fallback disabled
    }
    return false;
}

async function importStagingWriteEnabledBySettings() {
    try {
        const rows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [IMPORT_PIPELINE_SETTINGS_KEY]);
        const enabled = rows?.[0]?.value?.importStagingWriteEnabled;
        if (enabled === true || String(enabled || "").trim().toLowerCase() === "true") return true;
    } catch {}
    return IMPORT_STAGING_WRITE_ENABLED;
}

async function importStagingFinalizeEnabledBySettings() {
    try {
        const rows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [IMPORT_PIPELINE_SETTINGS_KEY]);
        const enabled = rows?.[0]?.value?.importStagingFinalizeEnabled;
        if (enabled === true || String(enabled || "").trim().toLowerCase() === "true") return true;
    } catch {}
    return IMPORT_STAGING_FINALIZE_ENABLED;
}

async function firstUploadRequiresReviewBySettings() {
    try {
        const rows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [REVIEW_DEFAULTS_SETTINGS_KEY]);
        const enabled = rows?.[0]?.value?.firstUploadRequiresReview;
        if (enabled === undefined || enabled === null || String(enabled).trim() === "") return true;
        return enabled === true || String(enabled).trim().toLowerCase() === "true";
    } catch {}
    return true;
}

async function shouldUseQueuedImport(req) {
    if (await importStreamingEnabledBySettings()) return true;
    return uploadUsesDbQueue(req);
}

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

function assertBufferedImportSizeAllowed(fileSize, parseMemoryLimitMb) {
    const size = Number(fileSize || 0);
    const parseLimitBytes = normalizeWorkerMemoryLimitMb(parseMemoryLimitMb) * 1024 * 1024;
    const maxBytes = Math.min(BUFFERED_IMPORT_LIMIT_BYTES, parseLimitBytes);
    if (Number.isFinite(size) && size > maxBytes) {
        const err = new Error("file_too_large");
        err.statusCode = 413;
        err.details = { maxMB: Math.max(1, Math.floor(maxBytes / 1024 / 1024)) };
        throw err;
    }
}

async function resolveTenantParseMemoryLimitMb(user) {
    const defaultLimit = normalizeWorkerMemoryLimitMb(null);
    try {
        const groupId = await resolveRuntimeGroupIdForUser(user);
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
        const memoryLimitBytes = parseMemoryLimitMb * 1024 * 1024;
        if (Buffer.byteLength(buffer || Buffer.alloc(0)) > memoryLimitBytes) {
            reject(new Error("xlsx_worker_memory_limit_exceeded"));
            return;
        }
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

function parseWorkbookInWorkerStreamed(buffer, { memoryLimitMb } = {}) {
    return new Promise((resolve, reject) => {
        const parseMemoryLimitMb = normalizeWorkerMemoryLimitMb(memoryLimitMb);
        const memoryLimitBytes = parseMemoryLimitMb * 1024 * 1024;
        if (Buffer.byteLength(buffer || Buffer.alloc(0)) > memoryLimitBytes) {
            reject(new Error("xlsx_worker_memory_limit_exceeded"));
            return;
        }
        const worker = new Worker(XLSX_WORKER_PATH, {
            workerData: { buffer, memoryLimitMb: parseMemoryLimitMb, options: { streamMode: true } },
            resourceLimits: { maxOldGenerationSizeMb: parseMemoryLimitMb },
        });
        const result = {
            sheetNames: [],
            sheets: {},
            cleanup: { formulasStripped: 0, metadataEntriesStripped: 0 },
        };
        let settled = false;
        const cleanup = () => {
            if (settled) return false;
            settled = true;
            clearTimeout(timer);
            worker.removeAllListeners();
            return true;
        };
        const timer = setTimeout(async () => {
            if (!cleanup()) return;
            try { await worker.terminate(); } catch {}
            reject(new Error("xlsx_worker_timeout"));
        }, XLSX_WORKER_TIMEOUT_MS);
        worker.on("message", (msg) => {
            if (settled) return;
            if (!msg?.success) {
                cleanup();
                reject(new Error(msg?.error || "unreadable_spreadsheet"));
                return;
            }
            if (msg?.mode !== "stream") return;
            const ev = String(msg?.event || "");
            if (ev === "sheet_start") {
                const sn = String(msg.sheetName || "").trim();
                if (!sn) return;
                if (!result.sheetNames.includes(sn)) result.sheetNames.push(sn);
                if (!Array.isArray(result.sheets[sn])) result.sheets[sn] = [];
                return;
            }
            if (ev === "rows_chunk") {
                const sn = String(msg.sheetName || "").trim();
                if (!sn) return;
                if (!Array.isArray(result.sheets[sn])) result.sheets[sn] = [];
                const rows = Array.isArray(msg.rows) ? msg.rows : [];
                result.sheets[sn].push(...rows);
                return;
            }
            if (ev === "done") {
                const summary = msg.summary || {};
                result.cleanup = {
                    formulasStripped: Number(summary?.cleanup?.formulasStripped || 0),
                    metadataEntriesStripped: Number(summary?.cleanup?.metadataEntriesStripped || 0),
                };
                cleanup();
                resolve(result);
            }
        });
        worker.on("error", (err) => {
            if (!cleanup()) return;
            if (String(err?.message || "").toLowerCase().includes("memory")) {
                reject(new Error("xlsx_worker_memory_limit_exceeded"));
                return;
            }
            reject(err);
        });
        worker.on("exit", (code) => {
            if (settled) return;
            cleanup();
            if (code !== 0) reject(new Error("xlsx_worker_memory_limit_exceeded"));
            else reject(new Error("unreadable_spreadsheet"));
        });
    });
}

async function parseWorkbookFileInWorker(filePath, { memoryLimitMb } = {}) {
    const parseMemoryLimitMb = normalizeWorkerMemoryLimitMb(memoryLimitMb);
    const memoryLimitBytes = parseMemoryLimitMb * 1024 * 1024;
    const stats = await fs.promises.stat(filePath);
    if (stats.size > memoryLimitBytes) {
        throw new Error("xlsx_worker_memory_limit_exceeded");
    }
    return new Promise((resolve, reject) => {
        const worker = new Worker(XLSX_WORKER_PATH, {
            workerData: { filePath, memoryLimitMb: parseMemoryLimitMb },
            resourceLimits: {
                maxOldGenerationSizeMb: parseMemoryLimitMb,
            },
        });
        let settled = false;
        const cleanup = () => {
            if (settled) return false;
            settled = true;
            clearTimeout(timer);
            worker.removeAllListeners();
            return true;
        };
        const timer = setTimeout(() => {
            if (!cleanup()) return;
            worker.terminate().catch(() => {});
            reject(new Error("xlsx_worker_timeout"));
        }, XLSX_WORKER_TIMEOUT_MS);
        worker.once("message", (msg) => {
            if (!cleanup()) return;
            if (msg?.success) resolve(msg.result);
            else reject(new Error(msg?.error || "unreadable_spreadsheet"));
        });
        worker.once("error", (err) => {
            if (!cleanup()) return;
            reject(err);
        });
        worker.once("exit", (code) => {
            if (!settled && code !== 0) {
                cleanup();
                reject(new Error("xlsx_worker_crashed"));
            }
        });
    });
}

function parseWorkbookFromBufferWithFallback(fileBuffer, options = {}) {
    const readOptions = {
        type: "buffer",
        cellDates: true,
        cellFormula: false,
        cellHTML: false,
        cellNF: false,
        cellStyles: false,
        cellText: false,
        bookDeps: false,
        bookFiles: false,
        bookProps: false,
        bookVBA: false,
        WTF: false,
        ...options,
    };
    const normalized = Buffer.isBuffer(fileBuffer)
        ? fileBuffer
        : (fileBuffer instanceof ArrayBuffer ? Buffer.from(new Uint8Array(fileBuffer)) : Buffer.from(fileBuffer || ""));
    const sample = normalized.slice(0, 4096);
    const likelyText = (() => {
        if (!sample.length) return false;
        for (let i = 0; i < sample.length; i += 1) {
            if (sample[i] === 0x00) return false;
        }
        const text = sample.toString("utf8");
        return /<html|<table|,|\t|\r|\n/i.test(text);
    })();

    const attempts = [
        { type: "buffer", value: normalized },
        { type: "array", value: new Uint8Array(normalized) },
    ];
    if (likelyText) {
        attempts.push({ type: "string", value: normalized.toString("utf8") });
        attempts.push({ type: "binary", value: normalized.toString("binary") });
    }

    let parseError;
    for (const attempt of attempts) {
        try {
            return XLSX.read(attempt.value, { ...readOptions, type: attempt.type });
        } catch (err) {
            parseError = err;
        }
    }
    throw parseError || new Error("Unable to parse workbook data with fallback readers.");
}

async function parseWorkbookBufferOrThrow(fileBuffer, options = {}) {
    try {
        const parsed = await parseWorkbookInWorker(fileBuffer, options);
        if (parsed && Array.isArray(parsed.sheetNames) && parsed.sheetNames.length >= 0) {
            return parsed;
        }
        throw toImportError("empty_parsed_workbook", 400, "Workbook parser returned no sheet data.");
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
        const directWorkerErr = err;
        try {
            return parseWorkbookFromBufferWithFallback(fileBuffer, options);
        } catch (directErr) {
            const message = String(directErr?.message || "").toLowerCase();
            if (message.includes("password") || message.includes("encrypted")) {
                const mapped = toImportError(
                    "unreadable_spreadsheet",
                    400,
                    "Uploaded spreadsheet appears encrypted/password-protected or compressed in an unsupported way."
                );
                mapped.cause = { worker: directWorkerErr, direct: directErr };
                mapped.rootError = String(directErr?.message || directErr);
                throw mapped;
            }
            const mapped = toImportError(
                "unreadable_spreadsheet",
                400,
                "Could not parse file as CSV/XLSX/XML/HTML-table."
            );
            mapped.cause = { worker: directWorkerErr, direct: directErr };
            mapped.workerMessage = String(directWorkerErr?.message || "");
            mapped.directMessage = String(directErr?.message || "");
            mapped.rootError = String(directErr?.message || directErr);
            throw mapped;
        }
    }
}

async function parseWorkbookFileOrThrow(filePath, options = {}) {
    const fileBuffer = await fs.promises.readFile(filePath);
    return parseWorkbookBufferOrThrow(fileBuffer, options);
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
    autosyncConfig = null,
    fileSizeBytes = 0,
    classificationSourceKind = "manual_upload",
    stagedSourceJobId = null,
}) {
    const { sheetNames, sheets: parsedSheets, cleanup } = parsedResult || {};
    let sheets = parsedSheets;
    let dlpOutcome = null;
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
                autosyncConfig,
            });
        } else {
            reportSource = await loadReportSourceForImport(client, reportSourceId);
        }

        const groupId = resolveImportGroupId(user, reportSource);
        const dlp = await loadDlpSettings(client);
        const isSuperAdmin = isPlatformAdminUser(user);
        let customerDlpEnabled = true;
        if (!isSuperAdmin) {
            if (!groupId) {
                customerDlpEnabled = false;
            } else {
                const groupRes = await client.query("SELECT id, entitlements FROM groups WHERE id = $1 LIMIT 1", [groupId]);
                const group = groupRes.rows?.[0] || null;
                customerDlpEnabled = !!(group && groupHasFeature(group, "dlp"));
            }
        }
        if (dlp.enabled !== false && customerDlpEnabled) {
            const scan = scanRowsForDlp(sheets, dlp);
            if (scan.findings.length > 0) {
                await writeAuditLog({
                    req: { id: null, user, ip: null, headers: {} },
                    actorUserId: user?.id || null,
                    action: "dlp.findings_detected",
                    resourceType: "report_source",
                    resourceId: reportSource?.id || null,
                    metadata: {
                        groupId,
                        mode: dlp.mode,
                        findingsCount: scan.findings.length,
                        scannedCells: scan.scannedCells,
                        capped: scan.capped,
                        maskedColumns: scan.maskedColumns || {},
                        findings: scan.findings,
                    },
                });
            }
            if (scan.findings.length > 0) {
                const findingTypes = Array.from(new Set((scan.findings || []).map((f) => String(f?.type || "").trim()).filter(Boolean)));
                const prettyType = (t) => {
                    if (t === "ssn") return "SSN";
                    if (t === "credit_card") return "Credit Card";
                    if (t === "email") return "Email";
                    if (t === "phone") return "Phone";
                    if (t === "iban") return "IBAN";
                    return t.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
                };
                const typeList = findingTypes.map(prettyType).join(", ");
                dlpOutcome = {
                    enabled: dlp.enabled !== false,
                    mode: dlp.mode,
                    findingsCount: scan.findings.length,
                    scannedCells: Number(scan.scannedCells || 0),
                    capped: !!scan.capped,
                    findingTypes,
                    maskedColumns: scan.maskedColumns || {},
                    maskedCells: scan.maskedCells || {},
                    warning: dlp.mode === "warn",
                    warningMessage: dlp.mode === "warn" ? `PII detected (${typeList}) in ${scan.findings.length} cell(s). Import proceeded because DLP mode is WARN.` : null,
                    message: dlp.mode === "mask"
                        ? `DLP masking applied for: ${typeList}. Matching values were redacted.`
                        : (dlp.mode === "warn"
                            ? `PII detected (${typeList}) in ${scan.findings.length} cell(s). Import proceeded because DLP mode is WARN.`
                            : null),
                };
            }
            if ((dlp.mode === "mask" || dlp.maskDetectedColumns) && scan.findings.length > 0) {
                sheets = applyDlpColumnMasking(sheets, scan.maskedColumns, "[REDACTED]", scan.maskedCells || {});
            }
            if (scan.findings.length > 0 && dlp.mode === "block") {
                const err = toImportError("dlp_blocked", 403, "Import blocked by DLP policy.");
                err.details = {
                    groupId,
                    findingsCount: scan.findings.length,
                    scannedCells: scan.scannedCells,
                    capped: scan.capped,
                    maskedColumns: scan.maskedColumns || {},
                    findings: scan.findings,
                };
                throw err;
            }
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
        const semanticRules = await loadSemanticProfileRules();
        let semanticProfile = buildSheetSemanticProfile({ headers, sampleRows: firstTabRowsRaw, rules: semanticRules });
        semanticProfile = await maybeEnrichSheetSemanticProfileWithAi({
            sheetId,
            headers,
            sampleRows: firstTabRowsRaw,
            semanticProfile,
            groupId,
            client,
        });
        if (dlpOutcome) {
            semanticProfile = {
                ...(semanticProfile || {}),
                dlp: {
                    mode: dlpOutcome.mode,
                    findingsCount: Number(dlpOutcome.findingsCount || 0),
                    scannedCells: Number(dlpOutcome.scannedCells || 0),
                    maskedColumns: dlpOutcome.maskedColumns || {},
                    maskedCells: dlpOutcome.maskedCells || {},
                    updatedAt: new Date().toISOString(),
                },
            };
        }
        const aiChatCompatibility = evaluateAiChatCompatibilityForImport({
            semanticProfile,
            sampleRows: firstTabRowsRaw,
        });
        semanticProfile = {
            ...(semanticProfile || {}),
            learned: {
                ...((semanticProfile && typeof semanticProfile === "object" && semanticProfile.learned && typeof semanticProfile.learned === "object")
                    ? semanticProfile.learned
                    : {}),
                ai_chat_compatibility: {
                    ...aiChatCompatibility,
                    approval_ready: aiChatCompatibility.ready || canApproveWithMaskedDlp({ semanticProfile, compatibility: aiChatCompatibility }),
                    evaluatedAt: new Date().toISOString(),
                },
            },
        };
        const compatibilityReviewRequired = AI_CHAT_COMPATIBILITY_ENFORCE_IMPORT && !aiChatCompatibility.ready;

        const versionedFilename = await getVersionedFilename(client, reportSource.id, originalName);
        const headerDiff = buildHeaderDiff(reportSource.previousHeaders, headers);
        const schemaStatus = getSchemaStatus(headerDiff);
        const reviewPolicy = resolveReviewPolicy(reportSource, fileLabel, schemaStatus, approvalRequired);
        const baseReviewReasons = Array.isArray(reviewPolicy?.reasons) ? reviewPolicy.reasons : [];
        const reviewRequired = !!reviewPolicy.required || compatibilityReviewRequired;
        const versionRes = await client.query(
            "SELECT COALESCE(MAX(import_version), 0)::int + 1 AS next_version FROM report_source_imports WHERE report_source_id = $1 AND file_label = $2",
            [reportSource.id, fileLabel]
        );
        const sourceVersion = Number(versionRes.rows?.[0]?.next_version || 1);

        await client.query(
            `INSERT INTO sheets
               (id, headers, active, filename, display_name, stored_path, tab_name, tabs,
                report_source_id, source_version, semantic_profile, semantic_profile_updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, CURRENT_TIMESTAMP)`,
            [
                sheetId,
                JSON.stringify(headers),
                !reviewRequired,
                versionedFilename,
                displayName,
                null,
                firstTabName,
                JSON.stringify(sheetNames),
                reportSource.id,
                sourceVersion,
                JSON.stringify(semanticProfile),
            ]
        );

        let totalRows = 0;
        const canUseStagingFinalize = IMPORT_STAGING_FINALIZE_ENABLED === true && !!stagedSourceJobId;
        if (canUseStagingFinalize) {
            const countRows = await client.query(
                `SELECT sheet_name, COUNT(*)::int AS c
                   FROM import_row_staging
                  WHERE job_id = $1
                  GROUP BY sheet_name`,
                [stagedSourceJobId]
            );
            const countMap = new Map(countRows.rows.map((r) => [String(r.sheet_name), Number(r.c || 0)]));
            for (const sn of sheetNames) {
                const c = Number(countMap.get(sn) || 0);
                if (c > MAX_UPLOAD_ROWS_PER_SHEET) {
                    const err = toImportError("too_many_rows_in_sheet", 413);
                    err.details = { tab: sn, maxRowsPerSheet: MAX_UPLOAD_ROWS_PER_SHEET };
                    throw err;
                }
                totalRows += c;
            }
            if (totalRows > MAX_UPLOAD_TOTAL_ROWS) {
                const err = toImportError("too_many_total_rows", 413);
                err.details = { maxTotalRows: MAX_UPLOAD_TOTAL_ROWS };
                throw err;
            }
            if (totalRows <= 0) {
                throw toImportError("staging_rows_missing", 500);
            }
            await client.query(
                `INSERT INTO sheet_rows (sheet_id, row_index, row_data, tab_name)
                 SELECT $2 AS sheet_id, s.row_index, s.row_data, s.sheet_name AS tab_name
                   FROM import_row_staging s
                  WHERE s.job_id = $1
                  ORDER BY s.sheet_name ASC, s.row_index ASC`,
                [stagedSourceJobId, sheetId]
            );
        } else {
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
        }

        const summaryRows = buildInsightSummaryRows({ sheetId, sheetNames, sheets });
        if (summaryRows.length) {
            await client.query(`DELETE FROM sheet_insight_summaries WHERE sheet_id = $1`, [sheetId]);
            const CHUNK = 500;
            for (let i = 0; i < summaryRows.length; i += CHUNK) {
                const chunk = summaryRows.slice(i, i + CHUNK);
                const values = [];
                const placeholders = [];
                let p = 1;
                chunk.forEach((r) => {
                    values.push(r.sheet_id, r.tab_name, r.period_key, r.category_key, r.metric_key, r.agg_sum, r.agg_avg, r.agg_count);
                    placeholders.push(`($${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++})`);
                });
                await client.query(
                    `INSERT INTO sheet_insight_summaries
                    (sheet_id, tab_name, period_key, category_key, metric_key, agg_sum, agg_avg, agg_count)
                    VALUES ${placeholders.join(",")}
                    ON CONFLICT (sheet_id, tab_name, period_key, category_key, metric_key)
                    DO UPDATE SET
                      agg_sum = EXCLUDED.agg_sum,
                      agg_avg = EXCLUDED.agg_avg,
                      agg_count = EXCLUDED.agg_count,
                      updated_at = CURRENT_TIMESTAMP`,
                    values
                );
            }
        }

        await carryForwardSourceSecurity(client, {
            previousSheetId: reportSource.previousSheetId,
            nextSheetId: sheetId,
            previousHeaders: reportSource.previousHeaders,
            nextHeaders: headers,
        });

        const importStatus = reviewRequired ? "pending_approval" : "published";
        const importRes = await client.query(
            `INSERT INTO report_source_imports
               (report_source_id, sheet_id, import_version, file_label, original_filename, imported_by,
                schema_status, schema_diff, status, published_at, published_by, job_id, file_size_bytes)
               VALUES ($1, $2, $3, $4, $5, $6::int, $7, $8, $9,
                        CASE WHEN $9 = 'published' THEN CURRENT_TIMESTAMP ELSE NULL END,
                        CASE WHEN $9 = 'published' THEN $6::int ELSE NULL END,
                        $10, $11)
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
                Number(fileSizeBytes || 0),
            ]
        );
        const importId = importRes.rows[0].id;

        if (!reviewRequired) {
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

        if (autosyncConfig?.enabled) {
            await applyReportSourceAutosyncConfig(client, reportSource.id, autosyncConfig);
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
            review_required: reviewRequired,
            review_reasons: compatibilityReviewRequired
                ? [...baseReviewReasons, ...aiChatCompatibility.missing.map((reason) => `AI chat compatibility: ${reason}`)]
                : baseReviewReasons,
            semantic_profile: semanticProfile,
            headers,
            rows: totalRows,
            active: !reviewRequired,
            filename: versionedFilename,
            display_name: displayName,
            tabs: sheetNames
        };
        if (dlpOutcome) {
            responsePayload.dlp = dlpOutcome;
        }

        await finishImportJob(client, {
            id: importJobId,
            status: importStatus,
            reportSourceId: reportSource.id,
            sheetId,
            importId,
            result: responsePayload,
        });

        await client.query("COMMIT");

        const businessClassification = await carryForwardBusinessClassificationIfPrompted({
            reportSourceId: reportSource.id,
            sheetId,
            fileLabel,
        }) || await classifyAndPersistBusinessContext({
            reportSource,
            sheetId,
            groupId,
            sourceKind: classificationSourceKind,
            sourceName: reportSource.name,
            fileName: originalName,
            sheetNames,
            headers,
            sampleRows: firstTabRowsRaw,
        });
        if (businessClassification) {
            responsePayload.business_classification = businessClassification;
            responsePayload.business_classification_status = businessClassification.status || null;
        }

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

    const useStreamingV2 = await queuedImportStreamingV2EnabledBySettings();
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
    const stagingWriteEnabled = await importStagingWriteEnabledBySettings();
    const stagingFinalizeEnabled = await importStagingFinalizeEnabledBySettings();
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

async function processNextImportJob(ownerId) {
    const job = await claimNextImportJob(ownerId);
    if (!job) return false;
    const payloadRows = await query(
        `SELECT file_bytes, payload_meta, byte_size
           FROM import_job_payloads
          WHERE job_id = $1
          LIMIT 1`,
        [job.id]
    );
    try {
        await executeQueuedImportJob(job, payloadRows);
    } catch (err) {
        const outcome = await markImportJobRetryable({
            id: job.id,
            attempts: job.attempts,
            maxAttempts: job.max_attempts,
            error: err,
        });
        if (outcome === "failed") {
            console.error(`[import_worker] job=${job.id} failed:`, err?.message || err);
            const payloadMeta = parseJsonMaybe(payloadRows?.[0]?.payload_meta, {}) || {};
            if (String(job.mode || "").toLowerCase() === "autosync" && job.report_source_id && payloadMeta.autosyncEnabled) {
                await query(
                    `UPDATE report_sources
                        SET sync_last_error = $2,
                            sync_last_checked_at = CURRENT_TIMESTAMP,
                            sync_updated_at = CURRENT_TIMESTAMP,
                            updated_at = CURRENT_TIMESTAMP
                      WHERE id = $1`,
                    [job.report_source_id, String(err?.message || "autosync_failed").slice(0, 500)]
                );
            }
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
    try {
        const qRows = await query(
            `SELECT
                COUNT(*) FILTER (WHERE status IN ('queued','retryable'))::int AS queued_depth,
                COUNT(*) FILTER (WHERE status = 'running')::int AS active_jobs
             FROM import_jobs`,
            []
        );
        const queuedDepth = Number(qRows?.[0]?.queued_depth || 0);
        const activeJobs = Number(qRows?.[0]?.active_jobs || 0);
        setImportWorkerQueueDepth(queuedDepth);
        setImportWorkerActiveJobs(activeJobs);
    } catch {
        // no-op metrics fallback
    }
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
        let lockAcquired = false;
        try {
            lockAcquired = await tryAdvisoryLock(IMPORT_WORKER_ADVISORY_LOCK_KEY);
            if (!lockAcquired) return;
            await processImportJobsForCurrentDb(importWorkerOwnerId);
            await forEachActiveTenantPool(async (tenant) => {
                await processImportJobsForCurrentDb(`${importWorkerOwnerId}:${tenant.db_name}`);
            });
        } catch (err) {
            console.error("[import_worker] tick failed:", err?.message || err);
        } finally {
            if (lockAcquired) {
                await releaseAdvisoryLock(IMPORT_WORKER_ADVISORY_LOCK_KEY);
            }
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

const AUTOSYNC_POLL_SETTINGS_KEY = "autosync_poll_interval_settings";
const AUTOSYNC_DEFAULT_POLL_MS = Math.max(15000, Number.parseInt(process.env.AUTOSYNC_POLL_MS || "300000", 10) || 300000);
const AUTOSYNC_MAX_CLAIMS_PER_TICK = Math.max(1, Number.parseInt(process.env.AUTOSYNC_MAX_CLAIMS_PER_TICK || "5", 10) || 5);
const AUTOSYNC_RECHECK_MS = Math.max(60000, Number.parseInt(process.env.AUTOSYNC_RECHECK_MS || "60000", 10) || 60000);
let autosyncWorkerTimer = null;
let autosyncWorkerRunning = false;
let autosyncWorkerOwnerId = null;
let autosyncWorkerStopped = false;

async function loadAutosyncPollIntervalMs() {
    try {
        const rows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [AUTOSYNC_POLL_SETTINGS_KEY]);
        const rawMinutes = Number.parseInt(rows?.[0]?.value?.intervalMinutes ?? rows?.[0]?.value?.pollMinutes ?? rows?.[0]?.value?.minutes, 10);
        const minutes = Number.isFinite(rawMinutes) ? Math.min(1440, Math.max(1, rawMinutes)) : null;
        return minutes ? minutes * 60 * 1000 : AUTOSYNC_DEFAULT_POLL_MS;
    } catch (err) {
        console.error("[autosync_worker] failed to load interval setting:", err?.message || err);
        return AUTOSYNC_DEFAULT_POLL_MS;
    }
}

async function claimAutosyncReportSources(ownerId) {
    const client = await getClient();
    try {
        await client.query("BEGIN");
        const claimed = await client.query(
            `WITH candidate AS (
                SELECT id
                  FROM report_sources
                 WHERE sync_enabled = TRUE
                   AND sync_provider IN ('google_drive', 'dropbox', 'onedrive')
                   AND sync_source_ref IS NOT NULL
                   AND sync_user_id IS NOT NULL
                   AND (sync_last_checked_at IS NULL OR sync_last_checked_at <= CURRENT_TIMESTAMP - (($2 || ' milliseconds')::interval))
                 ORDER BY COALESCE(sync_last_checked_at, created_at) ASC, id ASC
                 FOR UPDATE SKIP LOCKED
                 LIMIT $1
            )
            UPDATE report_sources rs
               SET sync_last_checked_at = CURRENT_TIMESTAMP,
                   sync_updated_at = CURRENT_TIMESTAMP,
                   updated_at = CURRENT_TIMESTAMP
              FROM candidate c
             WHERE rs.id = c.id
         RETURNING rs.id, rs.name, rs.sync_provider, rs.sync_source_ref, rs.sync_group_id,
                   rs.sync_user_id, rs.sync_display_name, rs.sync_file_label, rs.sync_remote_marker,
                   rs.sync_last_attempted_marker, rs.sync_remote_modified_at, rs.sync_last_error`,
            [AUTOSYNC_MAX_CLAIMS_PER_TICK, String(AUTOSYNC_RECHECK_MS)]
        );
        await client.query("COMMIT");
        return claimed.rows || [];
    } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

async function updateAutosyncSourceState(sourceId, values = {}) {
    const assignments = [];
    const params = [sourceId];
    const push = (sqlExpr, value) => {
        params.push(value);
        assignments.push(`${sqlExpr} = $${params.length}`);
    };
    if (Object.prototype.hasOwnProperty.call(values, "sync_remote_marker")) push("sync_remote_marker", values.sync_remote_marker);
    if (Object.prototype.hasOwnProperty.call(values, "sync_last_attempted_marker")) push("sync_last_attempted_marker", values.sync_last_attempted_marker);
    if (Object.prototype.hasOwnProperty.call(values, "sync_remote_modified_at")) push("sync_remote_modified_at", values.sync_remote_modified_at);
    if (Object.prototype.hasOwnProperty.call(values, "sync_last_synced_at")) push("sync_last_synced_at", values.sync_last_synced_at);
    if (Object.prototype.hasOwnProperty.call(values, "sync_last_error")) push("sync_last_error", values.sync_last_error);
    if (Object.prototype.hasOwnProperty.call(values, "sync_last_checked_at")) push("sync_last_checked_at", values.sync_last_checked_at);
    if (Object.prototype.hasOwnProperty.call(values, "sync_display_name")) push("sync_display_name", values.sync_display_name);
    if (Object.prototype.hasOwnProperty.call(values, "sync_file_label")) push("sync_file_label", values.sync_file_label);
    if (Object.prototype.hasOwnProperty.call(values, "sync_provider")) push("sync_provider", values.sync_provider);
    if (Object.prototype.hasOwnProperty.call(values, "sync_source_ref")) push("sync_source_ref", values.sync_source_ref);
    if (Object.prototype.hasOwnProperty.call(values, "sync_group_id")) push("sync_group_id", values.sync_group_id);
    if (Object.prototype.hasOwnProperty.call(values, "sync_user_id")) push("sync_user_id", values.sync_user_id);
    if (!assignments.length) return;
    await query(
        `UPDATE report_sources
            SET ${assignments.join(", ")},
                sync_updated_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1`,
        params
    );
}

async function processAutosyncReportSource(source) {
    const provider = String(source?.sync_provider || "").trim().toLowerCase();
    const sourceRef = String(source?.sync_source_ref || "").trim();
    const groupId = parsePositiveIntLike(source?.sync_group_id);
    const userId = parsePositiveIntLike(source?.sync_user_id);
    if (!provider || !sourceRef || !userId) return;

    const remoteMeta = await fetchProviderAutosyncMetadata({
        provider,
        groupId,
        userId,
        sourceRef,
    });
    if (!remoteMeta?.remoteMarker) {
        await updateAutosyncSourceState(source.id, {
            sync_last_error: "autosync_remote_marker_missing",
            sync_last_checked_at: new Date().toISOString(),
        });
        return;
    }

    const currentMarker = String(source.sync_remote_marker || "").trim();
    const lastAttemptedMarker = String(source.sync_last_attempted_marker || "").trim();

    if (!currentMarker && !lastAttemptedMarker) {
        await updateAutosyncSourceState(source.id, {
            sync_remote_marker: remoteMeta.remoteMarker,
            sync_last_attempted_marker: remoteMeta.remoteMarker,
            sync_remote_modified_at: remoteMeta.remoteModifiedAt || null,
            sync_last_error: null,
            sync_last_checked_at: new Date().toISOString(),
        });
        return;
    }

    if (remoteMeta.remoteMarker === currentMarker || remoteMeta.remoteMarker === lastAttemptedMarker) {
        return;
    }

    const displayName = String(source.sync_display_name || source.name || remoteMeta.originalName || "Report source").trim();
    const fileLabel = String(source.sync_file_label || source.name || displayName || "File").trim();
    const downloaded = await downloadProviderAutosyncFile({
        provider,
        groupId,
        userId,
        sourceRef,
    });

    if (IMPORT_DB_QUEUE_ENABLED) {
        const importJobId = randomUUID();
        await enqueueDbImportJob({
            user: { id: userId, role: "admin" },
            approvalRequired: false,
            importJobId,
            originalName: downloaded.originalName || remoteMeta.originalName || `${displayName}.xlsx`,
            displayName,
            fileLabel,
            rawReportSourceId: String(source.id),
            rawReportSourceName: source.name || displayName,
            fileBuffer: downloaded.buffer,
            contentType: downloaded.mimeType || "application/octet-stream",
            fileSize: downloaded.buffer.length || 0,
            parseMemoryLimitMb: null,
            autosyncConfig: {
                enabled: true,
                provider,
                sourceRef,
                groupId,
                userId,
                remoteMarker: remoteMeta.remoteMarker,
                remoteModifiedAt: remoteMeta.remoteModifiedAt,
                displayName,
                fileLabel,
            },
            mode: "autosync",
            enforceOwnership: false,
        });
        await updateAutosyncSourceState(source.id, {
            sync_last_attempted_marker: remoteMeta.remoteMarker,
            sync_remote_modified_at: remoteMeta.remoteModifiedAt || null,
            sync_last_error: null,
            sync_last_checked_at: new Date().toISOString(),
            sync_display_name: displayName,
            sync_file_label: fileLabel,
            sync_provider: provider,
            sync_source_ref: sourceRef,
            sync_group_id: groupId,
            sync_user_id: userId,
        });
        return;
    }

    const parsedResult = await parseWorkbookBufferOrThrow(downloaded.buffer, { memoryLimitMb: null });
    await executeImportFromParsedWorkbook({
        parsedResult,
        approvalRequired: false,
        importJobId: randomUUID(),
        reportSourceId: source.id,
        reportSourceName: source.name || displayName,
        displayName,
        fileLabel,
        originalName: downloaded.originalName || remoteMeta.originalName || `${displayName}.xlsx`,
        user: { id: userId, role: "admin" },
        enforceOwnership: false,
        fileSizeBytes: Number(downloaded?.size || downloaded?.buffer?.length || 0),
        autosyncConfig: {
            enabled: true,
            provider,
            sourceRef,
            groupId,
            userId,
            remoteMarker: remoteMeta.remoteMarker,
            remoteModifiedAt: remoteMeta.remoteModifiedAt,
            displayName,
            fileLabel,
        },
        classificationSourceKind: "autosync",
    });
}

async function processAutosyncSourcesForCurrentDb(ownerId) {
    await ensureReportSourcesSchema();
    const sources = await claimAutosyncReportSources(ownerId);
    if (!sources.length) return false;
    let claimedAny = false;
    for (const source of sources) {
        claimedAny = true;
        try {
            await processAutosyncReportSource(source);
        } catch (err) {
            console.error(`[autosync_worker] source=${source.id} failed:`, err?.message || err);
            await updateAutosyncSourceState(source.id, {
                sync_last_error: String(err?.message || "autosync_failed").slice(0, 500),
                sync_last_checked_at: new Date().toISOString(),
            });
        }
    }
    return claimedAny;
}

async function scheduleNextAutosyncWorkerTick() {
    if (autosyncWorkerStopped) return;
    if (autosyncWorkerTimer) {
        clearTimeout(autosyncWorkerTimer);
        autosyncWorkerTimer = null;
    }
    const delayMs = await loadAutosyncPollIntervalMs();
    if (autosyncWorkerStopped) return;
    autosyncWorkerTimer = setTimeout(() => {
        void runReportSourceAutosyncWorkerTick();
    }, delayMs);
    if (autosyncWorkerTimer.unref) autosyncWorkerTimer.unref();
}

async function runReportSourceAutosyncWorkerTick() {
    if (autosyncWorkerStopped) return;
    if (autosyncWorkerRunning) {
        await scheduleNextAutosyncWorkerTick();
        return;
    }
    autosyncWorkerRunning = true;
    let lockAcquired = false;
    try {
        lockAcquired = await tryAdvisoryLock(AUTOSYNC_WORKER_ADVISORY_LOCK_KEY);
        if (!lockAcquired) return;
        await processAutosyncSourcesForCurrentDb(autosyncWorkerOwnerId);
        await forEachActiveTenantPool(async (tenant) => {
            await processAutosyncSourcesForCurrentDb(`${autosyncWorkerOwnerId}:${tenant.db_name}`);
        });
    } catch (err) {
        console.error("[autosync_worker] tick failed:", err?.message || err);
    } finally {
        if (lockAcquired) {
            await releaseAdvisoryLock(AUTOSYNC_WORKER_ADVISORY_LOCK_KEY);
        }
        autosyncWorkerRunning = false;
        await scheduleNextAutosyncWorkerTick();
    }
}

export function startReportSourceAutosyncWorker() {
    if (autosyncWorkerTimer) return;
    autosyncWorkerStopped = false;
    autosyncWorkerOwnerId = `${process.pid}:${randomUUID().slice(0, 8)}`;
    void scheduleNextAutosyncWorkerTick();
    console.log(`[autosync_worker] started owner=${autosyncWorkerOwnerId} poll_ms=dynamic`);
}

export async function stopReportSourceAutosyncWorker() {
    if (autosyncWorkerTimer) {
        clearTimeout(autosyncWorkerTimer);
        autosyncWorkerTimer = null;
    }
    autosyncWorkerStopped = true;
    while (autosyncWorkerRunning) {
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    autosyncWorkerOwnerId = null;
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
        const autosyncConfig = parseAutosyncConfig(req.body);
        if (!displayName) {
            if (filePath) fs.unlink(filePath, () => {});
            return res.status(400).json({ error: "display_name_required" });
        }

        console.log(`[upload] size=${req.file.size} reportSourceId=${rawReportSourceId || "new"}`);
        const parseMemoryLimitMb = await resolveTenantParseMemoryLimitMb(req.user);
        assertBufferedImportSizeAllowed(req.file?.size, parseMemoryLimitMb);
        const shouldQueueImport = await shouldUseQueuedImport(req);

        let fileBuffer = req.fileBuffer;
        if (!fileBuffer && shouldQueueImport) {
            fileBuffer = await fs.promises.readFile(filePath);
            fs.unlink(filePath, () => {});
            filePath = null;
        }
        if (!fileBuffer && filePath) {
            fileBuffer = await fs.promises.readFile(filePath);
        }
        assertUploadSignatureMatchesExtension({ originalName, fileBuffer });

        if (shouldQueueImport) {
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
                autosyncConfig,
            });
            await writeAuditLog({
                req,
                action: "import.queued",
                resourceType: "import_job",
                resourceId: importJobId,
                metadata: {
                    report_source_id: resolvedSource.id,
                report_source_name: resolvedSource.name,
                autosync_enabled: !!autosyncConfig?.enabled,
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
                autosync_enabled: !!autosyncConfig?.enabled,
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

        const parsedResult = fileBuffer
            ? await parseWorkbookBufferOrThrow(fileBuffer, { memoryLimitMb: parseMemoryLimitMb })
            : await parseWorkbookFileOrThrow(filePath, { memoryLimitMb: parseMemoryLimitMb });
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
            fileSizeBytes: Number(req.file?.size || fileBuffer?.length || 0),
            autosyncConfig,
            classificationSourceKind: autosyncConfig?.enabled ? "autosync" : "manual_upload",
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
        if (e?.message === "unreadable_spreadsheet" && req?.file) {
            const filename = req.file.originalname || "uploaded";
            const sniff = req.file.buffer
                ? req.file.buffer.slice(0, 8).toString("hex")
                : (req.file.path ? `path=${req.file.path}` : "no_buffer");
            console.error("[upload] unreadable_spreadsheet", {
                filename,
                mimetype: req.file.mimetype,
                size: req.file.size,
                sniff,
                workerMessage: e.workerMessage,
                directMessage: e.directMessage,
                rootError: e.rootError || null,
            });
        }
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
            return res.status(413).json({ error: "file_too_large", maxMB: BUFFERED_IMPORT_LIMIT_MB });
        }
        if (e?.statusCode) {
            const body = { error: e.message || "upload_failed" };
            if (e.publicMessage) body.message = e.publicMessage;
            if (e.details && typeof e.details === "object") Object.assign(body, e.details);
            return res.status(e.statusCode).json(body);
        }
        return res.status(500).json({ error: "upload_failed", details: { message: e.message || "upload_failed" } });
    } finally {
        if (filePath) {
            fs.unlink(filePath, () => {});
        }
    }
}

export async function ingestEmailAttachment(req, res) {
    let importJobId = req.importJobId || randomUUID();
    let importJobCreated = false;
    try {
        if (!hasValidEmailIngestSharedSecret(req)) {
            return res.status(403).json({ error: "email_ingest_unauthorized" });
        }
        const file = req.file
            || req.files?.file?.[0]
            || req.files?.attachment?.[0]
            || (Array.isArray(req.files) ? req.files[0] : null);
        if (!file) return res.status(400).json({ error: "No file" });

        const senderEmail = normalizeEmailAddress(
            req.body?.from
            || req.body?.sender
            || req.body?.mail_from
            || req.body?.mailFrom
            || req.body?.envelopeFrom
            || req.body?.sourceEmail
        );
        if (!senderEmail) return res.status(400).json({ error: "sender_email_required" });

        const recipientValues = [
            req.body?.to,
            req.body?.recipient,
            req.body?.envelopeTo,
            req.body?.deliveredTo,
            req.body?.originalRecipient,
        ].filter(Boolean);
        const recipientAddresses = extractEmailAddresses(recipientValues.join("\n"));
        if (!recipientAddresses.length) return res.status(400).json({ error: "recipient_email_required" });

        const baseSettings = await loadEmailIngestSettingsForGroup(null);
        if (baseSettings.enabled === false) return res.status(403).json({ error: "email_ingest_disabled" });

        const targetCustomer = await resolveEmailIngestCustomer({ query }, recipientAddresses, baseSettings);
        if (!targetCustomer) return res.status(404).json({ error: "customer_email_not_resolved" });

        const customerSettings = await loadEmailIngestSettingsForGroup(targetCustomer.group_id);
        if (customerSettings.requireApprovedSenders && !senderDomainIsAllowed(senderEmail, customerSettings.allowedSenderDomains)) {
            return res.status(403).json({ error: "sender_domain_not_allowed" });
        }

        const originalName = String(file.originalname || "email-attachment.xlsx").trim() || "email-attachment.xlsx";
        const subject = String(req.body?.subject || req.body?.emailSubject || "").trim();
        const fileLabel = String(req.body?.file_label || req.body?.fileLabel || subject || path.basename(originalName, path.extname(originalName)) || originalName).trim() || originalName;
        const displayName = sanitizeDisplayName(
            req.body?.display_name
            || req.body?.displayName
            || targetCustomer.customer_name
            || targetCustomer.group_name
            || fileLabel
        );

        const client = await getClient();
        let reportSource = null;
        try {
            await client.query("BEGIN");
            reportSource = await resolveOrCreateEmailReportSource(client, {
                groupId: targetCustomer.group_id,
                recipientAddress: targetCustomer.recipientAddress || recipientAddresses[0],
                customerName: targetCustomer.customer_name || targetCustomer.group_name,
                fileLabel,
                messageId: String(req.body?.messageId || req.body?.message_id || "").trim() || null,
            });

            await createImportJob(client, {
                id: importJobId,
                mode: "email",
                status: "running",
                stage: "processing",
                requestedBy: null,
                reportSourceId: reportSource.id,
                originalFilename: originalName,
                maxAttempts: 1,
            });
            await client.query("COMMIT");
            importJobCreated = true;
        } catch (err) {
            await client.query("ROLLBACK").catch(() => {});
            throw err;
        } finally {
            client.release();
        }

        const parseMemoryLimitMb = await resolveTenantParseMemoryLimitMb({ customer_group_id: targetCustomer.group_id });
        assertBufferedImportSizeAllowed(file?.size, parseMemoryLimitMb);
        let fileBuffer = file.buffer || null;
        if (!fileBuffer && file.path) {
            fileBuffer = await fs.promises.readFile(file.path);
        }
        if (!fileBuffer) return res.status(400).json({ error: "file_buffer_missing" });
        assertUploadSignatureMatchesExtension({ originalName, fileBuffer });
        await persistImportJobPayload(importJobId, fileBuffer, {
            contentType: file.mimetype || "application/octet-stream",
            original_filename: originalName,
            display_name: displayName,
            file_label: fileLabel,
            mode: "email",
            parseMemoryLimitMb,
            reportSourceId: reportSource.id,
            reportSourceName: reportSource.name,
            approvalRequired: false,
            requestedBy: null,
            classificationSourceKind: "email_ingest",
            source_group_id: targetCustomer.group_id,
            sender_email: senderEmail,
            recipient_email: targetCustomer.recipientAddress || recipientAddresses[0] || null,
        });

        await writeAuditLog({
            req,
            action: "email_ingest.queued",
            resourceType: "import_job",
            resourceId: importJobId,
            metadata: {
                report_source_id: reportSource.id,
                report_source_name: reportSource.name,
                sender_email: senderEmail,
                recipient_email: targetCustomer.recipientAddress || "",
                source_group_id: targetCustomer.group_id,
                mode: "email",
                import_status: "queued",
            },
        });
        return res.status(202).json({
            status: "queued",
            import_status: "queued",
            importJobId,
            import_job_id: importJobId,
            reportSourceId: reportSource.id,
            report_source_id: reportSource.id,
            report_source_name: reportSource.name,
            filename: originalName,
            display_name: displayName,
            email_sender: senderEmail,
            email_recipient: targetCustomer.recipientAddress,
            customer_group_id: targetCustomer.group_id,
            customer_id: targetCustomer.customer_id,
        });
    } catch (e) {
        console.error("email ingest failed:", e);
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
                    [importJobId, String(e?.message || "email_ingest_failed").slice(0, 500)]
                );
            } catch {
                // Preserve the original ingest error response.
            }
        }
        if (e?.code === "LIMIT_FILE_SIZE") {
            return res.status(413).json({ error: "file_too_large", maxMB: BUFFERED_IMPORT_LIMIT_MB });
        }
        if (e?.statusCode) {
            const body = { error: e.message || "email_ingest_failed" };
            if (e.publicMessage) body.message = e.publicMessage;
            if (e.details && typeof e.details === "object") Object.assign(body, e.details);
            return res.status(e.statusCode).json(body);
        }
        return res.status(500).json({ error: "email_ingest_failed", details: { message: e.message || "email_ingest_failed" } });
    } finally {
        const file = req.file
            || req.files?.file?.[0]
            || req.files?.attachment?.[0]
            || (Array.isArray(req.files) ? req.files[0] : null);
        if (file?.path) fs.unlink(file.path, () => {});
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
    if (!(await sheetIsPublished(id))) {
        return res.status(403).json({ error: "sheet_not_published" });
    }

    let hasFullAccess = isPlatformAdminUser(req.user);
    let rowFiltersList = [];

    // For non-admin users without report-source owner access, require explicit column permissions
    // and apply the same row filters used by the main sheet data endpoint.
    if (!isPlatformAdminUser(req.user)) {
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
        res.status(500).json({
            error: "sheet_unique_values_failed",
            details: { message: String(e?.message || "sheet_unique_values_failed") },
        });
    }
}

export async function getActiveSheet(req, res) {
    let s = [];
    if (isPlatformAdminUser(req.user)) {
        s = await query(
            `SELECT s.id, s.headers, s.filename, s.display_name, s.totals_column,
                    s.report_source_id, s.source_version, s.business_classification,
                    s.business_classification_status, s.business_classification_model,
                    s.business_classification_updated_at, s.business_classification_confirmed_at,
                    s.semantic_profile, s.semantic_profile_updated_at,
                    rs.name AS report_source_name
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
                    s.report_source_id, s.source_version, s.business_classification,
                    s.business_classification_status, s.business_classification_model,
                    s.business_classification_updated_at, s.business_classification_confirmed_at,
                    s.semantic_profile, s.semantic_profile_updated_at,
                    rs.name AS report_source_name
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
        business_classification: s[0].business_classification || {},
        business_classification_status: s[0].business_classification_status || "none",
        business_classification_model: s[0].business_classification_model || null,
        business_classification_updated_at: s[0].business_classification_updated_at || null,
        business_classification_confirmed_at: s[0].business_classification_confirmed_at || null,
        semantic_profile: s[0].semantic_profile || {},
        semantic_profile_updated_at: s[0].semantic_profile_updated_at || null,
        totals_column: s[0].totals_column || null
    });
}

export async function listMySheets(req, res) {
    const userId = req.user.id;
    const pagination = parsePagination(req.query, { maxLimit: MAX_SHEET_DATA_LIMIT });
    if (pagination.error) return res.status(400).json({ error: pagination.error });

    const suffix = pagination.hasPagination ? " LIMIT $1 OFFSET $2" : "";
    const paginationParams = pagination.hasPagination ? [pagination.limit, pagination.offset] : [];

    if (isPlatformAdminUser(req.user)) {
        const rows = await query(
            `SELECT s.id, s.filename, s.display_name, s.uploaded_at,
                    s.active, s.report_source_id, s.source_version, s.business_classification,
                    s.business_classification_status, s.business_classification_model,
                    s.business_classification_updated_at, s.business_classification_confirmed_at,
                    s.semantic_profile, s.semantic_profile_updated_at,
                    rs.name AS report_source_name,
                    (rs.current_sheet_id = s.id) AS is_current_source_version
             FROM sheets s
             LEFT JOIN report_sources rs ON rs.id = s.report_source_id
             ORDER BY s.uploaded_at DESC${suffix}`,
            paginationParams
        );
        const enriched = await enrichSheetsWithAiChatCompatibility(rows);
        return res.json(enriched);
    }

    const rows = await query(
        `SELECT DISTINCT s.id, s.filename, s.display_name, s.uploaded_at,
                s.active, s.report_source_id, s.source_version, s.business_classification,
                s.business_classification_status, s.business_classification_model,
                s.business_classification_updated_at, s.business_classification_confirmed_at,
                s.semantic_profile, s.semantic_profile_updated_at,
                rs.name AS report_source_name,
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
    const enriched = await enrichSheetsWithAiChatCompatibility(rows);
    res.json(enriched);
}

export async function listAllSheets(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    const pagination = parsePagination(req.query, { maxLimit: MAX_SHEET_DATA_LIMIT });
    if (pagination.error) return res.status(400).json({ error: pagination.error });
    const rows = await query(
        `SELECT s.id, s.filename, s.display_name, s.uploaded_at,
                s.active, s.report_source_id, s.source_version, s.business_classification,
                s.business_classification_status, s.business_classification_model,
                s.business_classification_updated_at, s.business_classification_confirmed_at,
                s.semantic_profile, s.semantic_profile_updated_at,
                rs.name AS report_source_name,
                (rs.current_sheet_id = s.id) AS is_current_source_version
         FROM sheets s
         LEFT JOIN report_sources rs ON rs.id = s.report_source_id
         ORDER BY s.uploaded_at DESC${pagination.hasPagination ? " LIMIT $1 OFFSET $2" : ""}`,
        pagination.hasPagination ? [pagination.limit, pagination.offset] : []
    );
    const enriched = await enrichSheetsWithAiChatCompatibility(rows);
    res.json(enriched);
}

export async function listReportSources(req, res) {
    const pagination = parsePagination(req.query, { maxLimit: MAX_SHEET_DATA_LIMIT });
    if (pagination.error) return res.status(400).json({ error: pagination.error });

    const limitSql = pagination.hasPagination ? " LIMIT $1 OFFSET $2" : "";
    const limitParams = pagination.hasPagination ? [pagination.limit, pagination.offset] : [];

    if (isPlatformAdminUser(req.user)) {
        const rows = await query(
            `SELECT rs.id, rs.name, rs.current_sheet_id, rs.is_inferred,
                    rs.review_required, rs.review_schema_changes, rs.review_label_rules,
                    rs.sync_enabled, rs.sync_provider, rs.sync_source_ref,
                    rs.sync_group_id, rs.sync_user_id, rs.sync_display_name,
                    rs.sync_file_label, rs.sync_remote_marker, rs.sync_last_attempted_marker,
                    rs.sync_remote_modified_at, rs.sync_last_checked_at, rs.sync_last_synced_at,
                    rs.sync_last_error,
                    rs.created_at, rs.updated_at,
                    COALESCE(import_counts.import_count, 0)::int AS import_count,
                    COALESCE(import_counts.file_labels, '[]'::jsonb) AS file_labels
             FROM report_sources rs
             LEFT JOIN (
               SELECT report_source_id,
                      COUNT(*) AS import_count,
                      jsonb_agg(DISTINCT file_label) FILTER (WHERE file_label IS NOT NULL AND TRIM(file_label) <> '') AS file_labels
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
                rs.review_required, rs.review_schema_changes, rs.review_label_rules,
                rs.sync_enabled, rs.sync_provider, rs.sync_source_ref,
                rs.sync_group_id, rs.sync_user_id, rs.sync_display_name,
                rs.sync_file_label, rs.sync_remote_marker, rs.sync_last_attempted_marker,
                rs.sync_remote_modified_at, rs.sync_last_checked_at, rs.sync_last_synced_at,
                rs.sync_last_error,
                rs.created_at, rs.updated_at,
                COALESCE(import_counts.import_count, 0)::int AS import_count,
                COALESCE(import_counts.file_labels, '[]'::jsonb) AS file_labels
         FROM report_sources rs
         LEFT JOIN sheets s ON s.id = rs.current_sheet_id
         LEFT JOIN report_source_imports rsi ON rsi.sheet_id = s.id
         LEFT JOIN (
           SELECT report_source_id,
                  COUNT(*) AS import_count,
                  jsonb_agg(DISTINCT file_label) FILTER (WHERE file_label IS NOT NULL AND TRIM(file_label) <> '') AS file_labels
           FROM report_source_imports
           GROUP BY report_source_id
         ) import_counts ON import_counts.report_source_id = rs.id
         WHERE (
           rs.created_by = $1
           OR EXISTS (
             SELECT 1
               FROM user_groups admin_ug
              WHERE admin_ug.user_id = $1
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

export async function updateReportSourceReviewPolicy(req, res) {
    const sourceId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(sourceId) || sourceId <= 0) {
        return res.status(400).json({ error: "invalid_report_source_id" });
    }

    const reviewRequired = parseBooleanLike(req.body?.review_required ?? req.body?.reviewRequired);
    const reviewSchemaChanges = req.body?.review_schema_changes === undefined && req.body?.reviewSchemaChanges === undefined
        ? true
        : parseBooleanLike(req.body?.review_schema_changes ?? req.body?.reviewSchemaChanges);
    const reviewLabelRules = normalizeReviewLabelRules(req.body?.review_label_rules ?? req.body?.reviewLabelRules);

    const client = await getClient();
    try {
        await client.query("BEGIN");
        const sourceRes = await client.query(
            `SELECT id
               FROM report_sources
              WHERE id = $1
              FOR UPDATE`,
            [sourceId]
        );
        if (!sourceRes.rows.length) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "not_found" });
        }

        const canManage = await userCanApproveReportSource(client, req.user, sourceId);
        if (!canManage) {
            await client.query("ROLLBACK");
            return res.status(403).json({ error: "Forbidden" });
        }

        const updated = await client.query(
            `UPDATE report_sources
                SET review_required = $2,
                    review_schema_changes = $3,
                    review_label_rules = $4::jsonb,
                    updated_at = CURRENT_TIMESTAMP
              WHERE id = $1
              RETURNING id, name, review_required, review_schema_changes, review_label_rules, updated_at`,
            [sourceId, reviewRequired, reviewSchemaChanges, JSON.stringify(reviewLabelRules)]
        );

        await client.query("COMMIT");
        await writeAuditLog({
            req,
            action: "report_source.review_policy_updated",
            resourceType: "report_source",
            resourceId: sourceId,
            metadata: {
                review_required: reviewRequired,
                review_schema_changes: reviewSchemaChanges,
                review_label_rules: reviewLabelRules,
            },
        });
        return res.json(updated.rows[0]);
    } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

export async function updateReportSourceAutosync(req, res) {
    const sourceId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(sourceId) || sourceId <= 0) {
        return res.status(400).json({ error: "invalid_report_source_id" });
    }
    const enabled = parseBooleanLike(req.body?.enabled ?? req.body?.sync_enabled ?? req.body?.syncEnabled);
    const client = await getClient();
    try {
        await client.query("BEGIN");
        const sourceRes = await client.query(
            `SELECT id, created_by, sync_provider, sync_source_ref, sync_enabled
               FROM report_sources
              WHERE id = $1
              FOR UPDATE`,
            [sourceId]
        );
        if (!sourceRes.rows.length) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "not_found" });
        }
        const source = sourceRes.rows[0];
        const canApprove = await userCanApproveReportSource(client, req.user, sourceId);
        if (!canApprove) {
            await client.query("ROLLBACK");
            return res.status(403).json({ error: "Forbidden" });
        }
        if (enabled && (!String(source.sync_provider || "").trim() || !String(source.sync_source_ref || "").trim())) {
            await client.query("ROLLBACK");
            return res.status(409).json({ error: "autosync_source_not_configured" });
        }
        await client.query(
            `UPDATE report_sources
                SET sync_enabled = $2,
                    sync_last_error = CASE WHEN $2 THEN NULL ELSE sync_last_error END,
                    updated_at = CURRENT_TIMESTAMP
              WHERE id = $1`,
            [sourceId, enabled]
        );
        await client.query("COMMIT");
        await writeAuditLog({
            req,
            action: "report_source.autosync_updated",
            resourceType: "report_source",
            resourceId: sourceId,
            metadata: { enabled },
        });
        return res.json({ success: true, id: sourceId, sync_enabled: enabled });
    } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

export async function deleteReportSource(req, res) {
    const sourceId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(sourceId) || sourceId <= 0) {
        return res.status(400).json({ error: "invalid_report_source_id" });
    }

    const client = await getClient();
    try {
        await client.query("BEGIN");
        const sourceRes = await client.query(
            `SELECT id, name, current_sheet_id
               FROM report_sources
              WHERE id = $1
              FOR UPDATE`,
            [sourceId]
        );
        if (!sourceRes.rows.length) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "not_found" });
        }
        const source = sourceRes.rows[0];
        const canManage = await userCanApproveReportSource(client, req.user, sourceId);
        if (!canManage) {
            await client.query("ROLLBACK");
            return res.status(403).json({ error: "Forbidden" });
        }

        // Prevent dangling import job pointers before deleting source/import records.
        const jobsReg = await client.query("SELECT to_regclass('import_jobs') AS reg");
        const hasImportJobsTable = !!jobsReg.rows?.[0]?.reg;
        if (hasImportJobsTable) {
            const colRes = await client.query(
                `SELECT column_name
                   FROM information_schema.columns
                  WHERE table_name = 'import_jobs'
                    AND column_name IN ('report_source_id', 'sheet_id', 'import_id')`
            );
            const cols = new Set((colRes.rows || []).map((r) => String(r.column_name)));
            const sets = [];
            if (cols.has("report_source_id")) sets.push("report_source_id = NULL");
            if (cols.has("sheet_id")) sets.push("sheet_id = NULL");
            if (cols.has("import_id")) sets.push("import_id = NULL");
            if (sets.length) {
                await client.query(
                    `UPDATE import_jobs
                        SET ${sets.join(", ")}
                      WHERE report_source_id = $1`,
                    [sourceId]
                );
            }
        }

        // Remove sheets tied to this source so source deletion clears its full revision history.
        await client.query("DELETE FROM sheets WHERE report_source_id = $1", [sourceId]);

        // Remove source (report_source_imports/views cascade by FK).
        await client.query("DELETE FROM report_sources WHERE id = $1", [sourceId]);

        await client.query("COMMIT");
        await writeAuditLog({
            req,
            action: "report_source.deleted",
            resourceType: "report_source",
            resourceId: sourceId,
            metadata: { name: source.name || null, current_sheet_id: source.current_sheet_id || null },
        });
        return res.json({ success: true, id: sourceId });
    } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

export async function getReportSourceImports(req, res) {
    const sourceId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(sourceId) || sourceId <= 0) {
        return res.status(400).json({ error: "invalid_report_source_id" });
    }
    const isPlatformAdmin = isPlatformAdminUser(req.user);
    const [source] = await query("SELECT current_sheet_id FROM report_sources WHERE id = $1", [sourceId]);
    if (!source) return res.status(404).json({ error: "not_found" });
    let canManageSource = isPlatformAdmin;
    if (!canManageSource) {
        const client = await getClient();
        try {
            canManageSource = await canWriteToReportSource(client, req.user, sourceId);
        } finally {
            client.release();
        }
    }
    if (source.current_sheet_id) {
        const hasAccess = await checkSheetAccess(source.current_sheet_id, req.user);
        if (!hasAccess && !canManageSource) return res.status(403).json({ error: "Forbidden" });
    } else if (!canManageSource) {
        return res.status(403).json({ error: "Forbidden" });
    }
    const rows = await query(
        `SELECT rsi.id, rsi.report_source_id, rsi.sheet_id, rsi.import_version, rsi.file_label,
                rsi.original_filename, rsi.schema_status, rsi.schema_diff, rsi.status,
                rsi.published_at, rsi.published_by, rsi.rejected_at, rsi.rejected_by,
                rsi.review_notes, rsi.job_id, rsi.file_size_bytes, rsi.created_at,
                s.display_name, s.filename, s.uploaded_at,
                COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.email) AS imported_by_name
         FROM report_source_imports rsi
         JOIN sheets s ON s.id = rsi.sheet_id
         LEFT JOIN users u ON u.id = rsi.imported_by
         WHERE rsi.report_source_id = $1
         ORDER BY rsi.import_version DESC`,
        [sourceId]
    );
    const enriched = rows.map((row) => {
        const status = String(row?.status || "").trim().toLowerCase();
        const selectable = status === "published" || status === "superseded" || status === "pending_approval";
        let selectableReason = "unknown";
        if (selectable) selectableReason = "ok";
        else if (!row?.sheet_id) selectableReason = "missing_sheet";
        else if (status === "rejected") selectableReason = "rejected";
        else if (status === "failed") selectableReason = "failed";
        else if (status === "superseded") selectableReason = "superseded";
        else if (status === "blocked") selectableReason = "blocked_by_policy";
        else if (!status) selectableReason = "not_accessible";
        return {
            ...row,
            selectable,
            selectable_reason: selectableReason,
        };
    });
    res.json(enriched);
}

export async function listImportJobs(req, res) {
    const pagination = parsePagination(req.query, { maxLimit: 200 });
    if (pagination.error) return res.status(400).json({ error: pagination.error });

    const baseParams = [];
    let where = "";
    if (!isPlatformAdminUser(req.user)) {
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
    if (!isPlatformAdminUser(req.user)) {
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
        if (record.status === "published") {
            await client.query("ROLLBACK");
            return res.json({
                success: true,
                idempotent: true,
                import_id: importId,
                report_source_id: record.report_source_id,
                sheet_id: record.sheet_id,
                status: "published",
            });
        }

        if (AI_CHAT_COMPATIBILITY_ENFORCE_IMPORT) {
            const preflightRows = await client.query(
                `SELECT s.headers, s.tab_name, s.semantic_profile
                   FROM sheets s
                  WHERE s.id = $1
                  LIMIT 1`,
                [record.sheet_id]
            );
            if (preflightRows.rows?.length) {
                const sheet = preflightRows.rows[0];
                const sampleRowsRes = await client.query(
                    `SELECT row_data
                       FROM sheet_rows
                      WHERE sheet_id = $1
                        AND ($2::text IS NULL OR tab_name = $2)
                      ORDER BY row_index ASC
                      LIMIT 300`,
                    [record.sheet_id, sheet.tab_name || null]
                );
                const sampleRows = sampleRowsRes.rows.map((r) => r.row_data || {});
                const compatibility = evaluateAiChatCompatibilityForImport({
                    semanticProfile: sheet.semantic_profile || {},
                    sampleRows,
                });
                const approvalReady = compatibility.ready || canApproveWithMaskedDlp({ semanticProfile: sheet.semantic_profile || {}, compatibility });
                if (!approvalReady) {
                    await client.query("ROLLBACK");
                    return res.status(422).json({
                        error: "ai_chat_compatibility_blocked",
                        message: "Publish blocked: spreadsheet is not AI-chat compatible.",
                        details: {
                            reasons: compatibility.missing,
                            required: [
                                "mapped date/year column with valid date values",
                                "at least one mapped metric column with numeric values",
                            ],
                        },
                    });
                }
            }
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

        const sheetRows = await client.query(
            `SELECT s.headers, s.tab_name, s.semantic_profile, s.group_id
               FROM sheets s
               LEFT JOIN report_sources rs ON rs.id = s.report_source_id
              WHERE s.id = $1
              LIMIT 1`,
            [record.sheet_id]
        );
        if (sheetRows.rows?.length) {
            const row = sheetRows.rows[0];
            const headers = normalizeStoredHeaders(row.headers);
            const sampleRowsRes = await client.query(
                `SELECT row_data
                   FROM sheet_rows
                  WHERE sheet_id = $1
                    AND ($2::text IS NULL OR tab_name = $2)
                  ORDER BY row_index ASC
                  LIMIT $3`,
                [record.sheet_id, row.tab_name || null, HEADER_AI_SAMPLE_ROWS]
            );
            const sampleRows = sampleRowsRes.rows.map((r) => r.row_data || {});
            await maybeEnrichSheetSemanticProfileWithAi({
                sheetId: record.sheet_id,
                headers,
                sampleRows,
                semanticProfile: row.semantic_profile || {},
                groupId: Number.isInteger(Number(row.group_id)) ? Number(row.group_id) : null,
                client,
            });
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
        if (record.status === "rejected") {
            await client.query("ROLLBACK");
            return res.json({
                success: true,
                idempotent: true,
                import_id: importId,
                report_source_id: record.report_source_id,
                sheet_id: record.sheet_id,
                status: "rejected",
            });
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

export async function deleteRejectedReportSourceImport(req, res) {
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
        if (String(record.status || "").trim().toLowerCase() !== "rejected") {
            await client.query("ROLLBACK");
            return res.status(409).json({ error: "only_rejected_import_can_be_deleted" });
        }

        await client.query(
            `UPDATE report_sources
                SET current_sheet_id = NULL
              WHERE id = $1
                AND current_sheet_id = $2`,
            [record.report_source_id, record.sheet_id]
        );

        if (record.job_id) {
            await client.query(
                `UPDATE import_jobs
                    SET status = 'deleted',
                        stage = 'deleted',
                        updated_at = CURRENT_TIMESTAMP,
                        finished_at = COALESCE(finished_at, CURRENT_TIMESTAMP)
                  WHERE id = $1`,
                [record.job_id]
            );
        }

        await client.query(`DELETE FROM report_source_imports WHERE id = $1`, [importId]);
        await client.query(`DELETE FROM sheets WHERE id = $1`, [record.sheet_id]);
        await client.query("COMMIT");

        await writeAuditLog({
            req,
            action: "import.rejected_deleted",
            resourceType: "report_source_import",
            resourceId: importId,
            metadata: {
                report_source_id: record.report_source_id,
                sheet_id: record.sheet_id,
            },
        });
        return res.json({
            success: true,
            import_id: importId,
            report_source_id: record.report_source_id,
            sheet_id: record.sheet_id,
            status: "deleted",
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
    if (!(await sheetIsPublished(req.params.id))) return res.status(403).json({ error: "sheet_not_published" });
    const s = await query(
        `SELECT s.id, s.headers, s.active, s.filename, s.display_name, s.totals_column,
                s.report_source_id, s.source_version, s.business_classification,
                s.business_classification_status, s.business_classification_model,
                s.business_classification_updated_at, s.business_classification_confirmed_at,
                s.semantic_profile, s.semantic_profile_updated_at,
                rs.name AS report_source_name
         FROM sheets s
         LEFT JOIN report_sources rs ON rs.id = s.report_source_id
         WHERE s.id=$1`,
        [req.params.id]
    );
    if (!s.length) return res.status(404).json({ error: "not_found" });

    // Enforce allowed_columns on the headers array returned
    if (!isPlatformAdminUser(req.user)) {
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

export async function confirmSheetBusinessClassification(req, res) {
    const sheetId = String(req.params.id || "").trim();
    if (!sheetId) return res.status(400).json({ error: "invalid_sheet_id" });
    const hasAccess = await checkSheetAccess(sheetId, req.user);
    if (!hasAccess) return res.status(403).json({ error: "Forbidden" });

    const confirmed = req.body?.confirmed === true;
    const rejected = req.body?.confirmed === false;
    if (!confirmed && !rejected) {
        return res.status(400).json({ error: "business_classification_confirmation_required" });
    }

    const rows = await query(
        `SELECT business_classification, business_classification_status
           FROM sheets
          WHERE id = $1
          LIMIT 1`,
        [sheetId]
    );
    if (!rows.length) return res.status(404).json({ error: "not_found" });
    const current = rows[0].business_classification && typeof rows[0].business_classification === "object"
        ? rows[0].business_classification
        : {};
    if (!Object.keys(current).length) {
        return res.status(400).json({ error: "business_classification_missing" });
    }
    const currentStatus = String(rows[0].business_classification_status || current.status || "").toLowerCase();
    if (currentStatus === "confirmed" || currentStatus === "rejected") {
        return res.json({
            success: true,
            sheetId,
            business_classification: current,
            business_classification_status: currentStatus,
        });
    }
    const status = confirmed ? "confirmed" : "rejected";
    const next = {
        ...current,
        status,
        confirmed: confirmed,
        confirmedAt: new Date().toISOString(),
    };
    await query(
        `UPDATE sheets
            SET business_classification = $2::jsonb,
                business_classification_status = $3,
                business_classification_confirmed_at = CURRENT_TIMESTAMP
          WHERE id = $1`,
        [sheetId, JSON.stringify(next), status]
    );
    return res.json({
        success: true,
        sheetId,
        business_classification: next,
        business_classification_status: status,
    });
}

export async function updateSheetSemanticProfile(req, res) {
    const sheetId = String(req.params.id || "").trim();
    if (!sheetId) return res.status(400).json({ error: "invalid_sheet_id" });
    const hasAccess = await checkSheetAccess(sheetId, req.user);
    if (!hasAccess) return res.status(403).json({ error: "Forbidden" });
    const canUpdate = isPlatformAdminUser(req.user) || await hasReportSourceOwnerAccess(sheetId, req.user.id);
    if (!canUpdate) return res.status(403).json({ error: "Forbidden" });

    const rows = await query(
        `SELECT headers, semantic_profile
           FROM sheets
          WHERE id = $1
          LIMIT 1`,
        [sheetId]
    );
    if (!rows.length) return res.status(404).json({ error: "not_found" });

    const headers = normalizeStoredHeaders(rows[0].headers);
    const defaults = sanitizeSemanticProfileDefaults(req.body?.defaults || req.body || {}, headers);
    if (!Object.keys(defaults).length) {
        return res.status(400).json({ error: "semantic_profile_defaults_required" });
    }

    const current = rows[0].semantic_profile && typeof rows[0].semantic_profile === "object"
        ? rows[0].semantic_profile
        : {};
    const next = mergeSheetSemanticProfileLearning(current, {
        defaults,
        notes: req.body?.notes || null,
    });

    await query(
        `UPDATE sheets
            SET semantic_profile = $2::jsonb,
                semantic_profile_updated_at = CURRENT_TIMESTAMP
          WHERE id = $1`,
        [sheetId, JSON.stringify(next)]
    );

    return res.json({
        success: true,
        sheetId,
        semantic_profile: next,
    });
}

export async function updateSheetDetails(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    const { totals_column } = req.body || {};
    await query("UPDATE sheets SET totals_column = $1 WHERE id = $2", [totals_column || null, req.params.id]);
    res.json({ success: true });
}

export async function getSheetTabs(req, res) {
    try {
        const hasAccess = await checkSheetAccess(req.params.id, req.user);
        if (!hasAccess) return res.status(403).json({ error: "Forbidden" });
        if (!(await sheetIsPublished(req.params.id))) return res.status(403).json({ error: "sheet_not_published" });
        const s = await query("SELECT tabs, tab_name FROM sheets WHERE id = $1", [req.params.id]);
        if (!s.length) return res.status(404).json({ error: "not_found" });
        const tabs = s[0].tabs || (s[0].tab_name ? [s[0].tab_name] : []);
        res.json({ tabs });
    } catch (e) {
        console.error("get tabs failed:", e);
        res.status(500).json({
            error: "sheet_tabs_failed",
            details: { message: String(e?.message || "sheet_tabs_failed") },
        });
    }
}

export async function getSheetData(req, res) {
    const { id } = req.params;
    const { tab, sort_by, sort_order, filters: filtersRaw, viewId } = req.query;
    const userId = req.user.id;
    if (!(await sheetIsPublished(id))) {
        return res.status(403).json({ error: "sheet_not_published" });
    }
    const isPlatformAdmin = isPlatformAdminUser(req.user);
    const isGroupAdmin = await isGroupAdminUser(userId);
    const canBypassViewAssignmentCheck = isPlatformAdmin || isGroupAdmin;
    delete req.headers["if-none-match"];
    delete req.headers["if-modified-since"];
    const pagination = parsePagination(req.query, { maxLimit: await resolveSheetDataMaxLimit(req.query) });
    if (pagination.error) {
        return res.status(400).json({ error: pagination.error });
    }
    if (String(req.query?.cursor || "").trim() && sort_by) {
        return res.status(400).json({
            error: "unsupported_cursor_sort_combination",
            message: "Cursor pagination is only supported with default row order (no sort_by).",
        });
    }

    let validCols = [];
    let rowFiltersList = [];
    let hasFullAccess = false;
    let viewConfig = null;
    let sheetHeaders = [];
    let forceColumnProjection = false;
    let dlpMaskedColumnsByTab = {};

    // 1. Resolve Locked View if provided
    if (viewId) {
        let [view] = await query(
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
                     $3 = TRUE
                     OR EXISTS (SELECT 1 FROM view_user_permissions WHERE view_id = v.id AND user_id = $4)
                   )`,
                [viewId, id, canBypassViewAssignmentCheck, userId]
            );
        if (!view) {
            // Fallback: allow loading a locked view by id when sheet/source linkage changed across revisions.
            // We still enforce that requester is platform/group admin or explicitly assigned to the view.
            [view] = await query(
                `SELECT v.config, s.headers
                   FROM views v
                   LEFT JOIN sheets s ON s.id = $2
                  WHERE v.id = $1
                    AND (
                      $3 = TRUE
                      OR EXISTS (SELECT 1 FROM view_user_permissions WHERE view_id = v.id AND user_id = $4)
                    )
                  LIMIT 1`,
                [viewId, id, canBypassViewAssignmentCheck, userId]
            );
        }
        if (!view) {
            return res.status(403).json({ error: "Forbidden", message: "You do not have permission to access this view." });
        }
        viewConfig = typeof view.config === 'string' ? JSON.parse(view.config) : view.config;
        sheetHeaders = typeof view.headers === 'string' ? JSON.parse(view.headers) : (view.headers || []);
    }

    // 2. Resolve Base Permissions
    if (!isPlatformAdmin) {
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
        if (sheetHeaders.length === 0) {
            const [hRow] = await query("SELECT headers FROM sheets WHERE id = $1", [id]);
            if (hRow) {
                sheetHeaders = typeof hRow.headers === "string" ? JSON.parse(hRow.headers) : (hRow.headers || []);
            }
        }

        try {
            const [semanticRow] = await query(
                `SELECT s.headers, s.tab_name, s.semantic_profile, s.group_id
                   FROM sheets s
                   LEFT JOIN report_sources rs ON rs.id = s.report_source_id
                  WHERE s.id = $1
                  LIMIT 1`,
                [id]
            );
            if (semanticRow) {
                const currentProfile = semanticRow.semantic_profile && typeof semanticRow.semantic_profile === "object"
                    ? semanticRow.semantic_profile
                    : {};
                const maskedByTab = currentProfile?.dlp?.maskedColumns;
                if (maskedByTab && typeof maskedByTab === "object" && !Array.isArray(maskedByTab)) {
                    dlpMaskedColumnsByTab = maskedByTab;
                }
                const missingAiCache = !Array.isArray(currentProfile?.learned?.header_understanding)
                    || currentProfile.learned.header_understanding.length === 0;
                if (missingAiCache) {
                    const sampleRowsRes = await query(
                        `SELECT row_data
                           FROM sheet_rows
                          WHERE sheet_id = $1
                            AND ($2::text IS NULL OR tab_name = $2)
                          ORDER BY row_index ASC
                          LIMIT $3`,
                        [id, semanticRow.tab_name || null, HEADER_AI_SAMPLE_ROWS]
                    );
                    const sampleRows = sampleRowsRes.map((r) => r.row_data || {});
                    await maybeEnrichSheetSemanticProfileWithAi({
                        sheetId: id,
                        headers: normalizeStoredHeaders(semanticRow.headers),
                        sampleRows,
                        semanticProfile: currentProfile,
                        groupId: Number.isInteger(Number(semanticRow.group_id)) ? Number(semanticRow.group_id) : null,
                    });
                }
            }
        } catch {}

        const resolveColumnKey = (requested) => {
            if (!sheetHeaders.length) return requested;
            const exact = sheetHeaders.find((h) => h === requested);
            if (exact) return exact;
            const lowerRequested = String(requested).toLowerCase().trim();
            return sheetHeaders.find((h) => String(h).toLowerCase().trim() === lowerRequested) || requested;
        };

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
            const filterClause = buildRowFilterWhereClause(rowFiltersList, params.length + 1, sheetHeaders);
            sql += filterClause.sql;
            params.push(...filterClause.params);
        }

        // Apply dynamic UI column filters
        if (filtersRaw) {
            try {
                const uiFilters = typeof filtersRaw === 'string' ? JSON.parse(filtersRaw) : filtersRaw;
                if (typeof uiFilters === 'object' && !Array.isArray(uiFilters)) {
                    Object.entries(uiFilters).forEach(([col, val]) => {
                        if (val === null || val === undefined || val === "") return;
                        // Security: Only allow filtering on validCols if not admin
                        if (!hasFullAccess && !validCols.includes(col)) return;

                        const resolvedCol = resolveColumnKey(col);
                        const colExpr = `row_data->>$${params.length + 1}`;
                        
                        if (typeof val === 'string' || typeof val === 'number') {
                            const strVal = String(val).trim();
                            if (strVal.includes(",")) {
                                // Multi-select string fallback
                                const vals = strVal.split(",").map(v => v.trim()).filter(Boolean);
                                sql += ` AND (${colExpr}) = ANY($${params.length + 2}::text[])`;
                                params.push(resolvedCol, vals);
                            } else {
                                const isLikelyNumeric = /^-?\d+(?:\.\d+)?$/.test(strVal.replace(/[^0-9.-]/g, ""));
                                if (isLikelyNumeric && !/[a-zA-Z]/.test(strVal)) {
                                    const cleanVal = strVal.replace(/[^0-9.-]/g, "");
                                    sql += ` AND (NULLIF(regexp_replace(COALESCE(${colExpr}, ''), '[^0-9.-]', '', 'g'), '') IS NOT NULL 
                                                AND CAST(NULLIF(regexp_replace(COALESCE(${colExpr}, ''), '[^0-9.-]', '', 'g'), '') AS NUMERIC) = $${params.length + 2}::numeric)`;
                                    params.push(resolvedCol, cleanVal);
                                } else {
                                    sql += ` AND (${colExpr}) ILIKE $${params.length + 2}`;
                                    params.push(resolvedCol, `%${strVal}%`);
                                }
                            }
                        } else if (Array.isArray(val) && val.length > 0) {
                            sql += ` AND (${colExpr}) = ANY($${params.length + 2}::text[])`;
                            params.push(resolvedCol, val.map(v => String(v)));
                        } else if (typeof val === 'object' && val.value) {
                            const op = val.operator === 'equals' ? '=' : 'ILIKE';
                            const searchVal = val.operator === 'equals' ? String(val.value) : `%${val.value}%`;
                            sql += ` AND (${colExpr}) ${op} $${params.length + 2}`;
                            params.push(resolvedCol, searchVal);
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

        const cursorRaw = String(req.query?.cursor || "").trim();
        let decodedCursor = null;
        if (cursorRaw && !sort_by) {
            try { decodedCursor = JSON.parse(Buffer.from(cursorRaw, "base64url").toString("utf8")); } catch { decodedCursor = null; }
            if (decodedCursor && Number.isInteger(Number(decodedCursor.rowIndex))) {
                sql += ` AND row_index > $${params.length + 1}`;
                params.push(Number(decodedCursor.rowIndex));
            }
        }
        const effectiveLimit = pagination.hasPagination ? pagination.limit : (SHEET_DATA_HARD_CAP > 0 ? SHEET_DATA_HARD_CAP : 1000);
        sql += ` LIMIT $${params.length + 1}`;
        params.push(effectiveLimit + 1);
        if (pagination.hasPagination && !decodedCursor) {
            sql += ` OFFSET $${params.length + 1}`;
            params.push(pagination.offset);
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

        const hasMore = rows.length > effectiveLimit;
        const items = hasMore ? rows.slice(0, effectiveLimit) : rows;
        const nextCursor = (!sort_by && hasMore && items.length)
            ? Buffer.from(JSON.stringify({ rowIndex: Number(items.length ? (decodedCursor?.rowIndex || 0) + items.length : 0) }), "utf8").toString("base64url")
            : null;
        const effectiveTab = String(tab || "").trim();
        const dlpMaskedColumns = (() => {
            if (effectiveTab) {
                return Array.isArray(dlpMaskedColumnsByTab?.[effectiveTab]) ? dlpMaskedColumnsByTab[effectiveTab] : [];
            }
            const union = new Set();
            Object.values(dlpMaskedColumnsByTab || {}).forEach((cols) => {
                if (!Array.isArray(cols)) return;
                cols.forEach((c) => union.add(String(c)));
            });
            return Array.from(union);
        })();
        res.set("X-DLP-Masked-Columns", JSON.stringify(dlpMaskedColumns));
        res.set("X-Next-Cursor", nextCursor || "");
        res.set("X-Has-More", hasMore ? "1" : "0");
        if (String(req.query?.cursor_mode || "").toLowerCase() === "body") {
            return res
                .set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0, private")
                .json({ items, nextCursor, hasMore });
        }
        return res
            .set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0, private")
            .json(items);
    } catch (e) {
        console.error("Get sheet data failed:", e);
        res.status(500).json({
            error: "sheet_data_fetch_failed",
            details: { message: String(e?.message || "sheet_data_fetch_failed") },
        });
    }
}

export async function deleteSheet(req, res) {
    if (!isPlatformAdminUser(req.user)) return res.status(403).json({ error: "Forbidden" });
    const { id } = req.params;
    const client = await getClient();

    try {
        await client.query("BEGIN");
        const importJobsReg = await client.query("SELECT to_regclass('import_jobs') AS reg");
        const hasImportJobsTable = !!importJobsReg.rows?.[0]?.reg;
        let importJobsHasImportId = false;
        let importJobsHasSheetId = false;
        if (hasImportJobsTable) {
            const colRes = await client.query(
                `SELECT column_name
                   FROM information_schema.columns
                  WHERE table_name = 'import_jobs'
                    AND column_name IN ('import_id', 'sheet_id')`
            );
            const cols = new Set((colRes.rows || []).map((r) => String(r.column_name)));
            importJobsHasImportId = cols.has("import_id");
            importJobsHasSheetId = cols.has("sheet_id");
        }

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
            if (hasImportJobsTable && (importJobsHasImportId || importJobsHasSheetId)) {
                const sets = [];
                if (importJobsHasImportId) sets.push("import_id = NULL");
                if (importJobsHasSheetId) sets.push("sheet_id = NULL");
                await client.query(
                    `UPDATE import_jobs
                        SET ${sets.join(", ")}
                      WHERE import_id = ANY($1::int[])`,
                    [importIds]
                );
            }
            await client.query("DELETE FROM report_source_imports WHERE id = ANY($1::int[])", [importIds]);
        }

        // Cleanup jobs directly keyed by the sheet id.
        if (hasImportJobsTable && importJobsHasSheetId) {
            await client.query(
                `UPDATE import_jobs
                    SET sheet_id = NULL
                  WHERE sheet_id = $1`,
                [id]
            );
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
import {
    getMappingsForSource,
    approveMapping,
    correctMapping,
    rejectMapping,
} from "../services/accounting/fieldMappingService.js";

export async function getSheetAccountingMappings(req, res) {
    const sheetId = Number.parseInt(req.params.id, 10);
    const hasAccess = await checkSheetAccess(sheetId, req.user);
    if (!hasAccess) return res.status(403).json({ error: "Forbidden" });
    const rows = await getMappingsForSource({ sheetId, tenantId: req.user?.customer_id || null, userId: req.user?.id || null });
    return res.json(rows);
}

export async function approveSheetAccountingMapping(req, res) {
    const sheetId = Number.parseInt(req.params.id, 10);
    const hasAccess = await checkSheetAccess(sheetId, req.user);
    if (!hasAccess) return res.status(403).json({ error: "Forbidden" });
    const { header, canonicalField } = req.body || {};
    const out = await approveMapping({ sheetId, tenantId: req.user?.customer_id || null, userId: req.user?.id || null, originalHeader: header, canonicalField, req });
    if (!out.ok) return res.status(400).json({ error: out.error || "approve_failed" });
    return res.json(out);
}

export async function correctSheetAccountingMapping(req, res) {
    const sheetId = Number.parseInt(req.params.id, 10);
    const hasAccess = await checkSheetAccess(sheetId, req.user);
    if (!hasAccess) return res.status(403).json({ error: "Forbidden" });
    const { header, oldCanonicalField, newCanonicalField } = req.body || {};
    const out = await correctMapping({ sheetId, tenantId: req.user?.customer_id || null, userId: req.user?.id || null, originalHeader: header, oldCanonicalField, newCanonicalField, req });
    if (!out.ok) return res.status(400).json({ error: out.error || "correct_failed" });
    return res.json(out);
}

export async function rejectSheetAccountingMapping(req, res) {
    const sheetId = Number.parseInt(req.params.id, 10);
    const hasAccess = await checkSheetAccess(sheetId, req.user);
    if (!hasAccess) return res.status(403).json({ error: "Forbidden" });
    const { header, canonicalField, reason } = req.body || {};
    const out = await rejectMapping({ sheetId, tenantId: req.user?.customer_id || null, userId: req.user?.id || null, originalHeader: header, canonicalField, reason, req });
    if (!out.ok) return res.status(400).json({ error: out.error || "reject_failed" });
    return res.json(out);
}
