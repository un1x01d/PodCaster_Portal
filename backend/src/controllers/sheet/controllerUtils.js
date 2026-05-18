import { isPlatformAdminUser, resolveViewColumnAllowlist as resolveViewColumnAllowlistFromAuth } from "../../utils/authorization.js";

export function parseJsonMaybe(value, fallback) {
  if (typeof value !== "string") return value ?? fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function normalizeStringArray(value) {
  const parsed = parseJsonMaybe(value, value);
  if (!Array.isArray(parsed)) return [];
  return parsed.map((v) => String(v || "").trim()).filter(Boolean);
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

export function getSchemaStatus(diff) {
  if (!diff.previous.length) return "new";
  if (diff.added.length || diff.removed.length) return "changed";
  return "matched";
}

export function getExplicitViewColumns(config, fallbackHeaders = []) {
  const parsed = parseJsonMaybe(config, {}) || {};
  const explicit = normalizeStringArray(
    parsed.visibleColumns ?? parsed.columns ?? parsed.allowedColumns ?? parsed.allowed_columns
  );
  if (explicit.length > 0) return explicit;
  return normalizeStringArray(fallbackHeaders);
}

export function freezeViewConfigForRefresh(config, previousHeaders = [], nextHeaders = []) {
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

export function canUploadSheetsByRole(role) {
  return isPlatformAdminUser({ role });
}

export function resolveViewColumnAllowlist(viewConfig, sheetHeaders = []) {
  return resolveViewColumnAllowlistFromAuth(viewConfig, sheetHeaders);
}

export function jobBackoffMs(attempts) {
  const attempt = Math.max(1, Number(attempts || 1));
  return Math.min(5 * 60 * 1000, 2000 * (2 ** (attempt - 1)));
}

export function isRetryableImportError(err) {
  if (!err) return false;
  if (Number.isInteger(err.statusCode) && err.statusCode >= 400 && err.statusCode < 500) return false;
  const code = String(err?.message || "").trim().toLowerCase();
  const nonRetryable = new Set([
    "invalid_report_source_id",
    "report_source_not_found",
    "report_source_forbidden",
    "report_source_name_required",
    "report_source_name_exists",
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

export function toImportError(code, statusCode = 400, message = null) {
  const err = new Error(code);
  err.statusCode = statusCode;
  if (message) err.publicMessage = message;
  return err;
}

export function normalizeStoredHeaders(value) {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value || "[]");
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function sanitizeSemanticProfileDefaults(input, headers) {
  const headerSet = new Set((Array.isArray(headers) ? headers : []).map((h) => String(h)));
  const defaults = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const out = {};
  const keepColumn = (value) => {
    const text = String(value || "").trim();
    return text && headerSet.has(text) ? text : null;
  };

  if (defaults.metricColumns && typeof defaults.metricColumns === "object" && !Array.isArray(defaults.metricColumns)) {
    const metricColumns = {};
    Object.entries(defaults.metricColumns).forEach(([meaning, column]) => {
      const safeMeaning = String(meaning || "").trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);
      const safeColumn = keepColumn(column);
      if (safeMeaning && safeColumn) metricColumns[safeMeaning] = safeColumn;
    });
    if (Object.keys(metricColumns).length) out.metricColumns = metricColumns;
  }

  const dateColumn = keepColumn(defaults.dateColumn);
  if (dateColumn) out.dateColumn = dateColumn;

  const driverDimensionColumn = keepColumn(defaults.driverDimensionColumn);
  if (driverDimensionColumn) out.driverDimensionColumn = driverDimensionColumn;

  for (const key of ["dimensions", "metrics"]) {
    if (!Array.isArray(defaults[key])) continue;
    const safeList = Array.from(new Set(defaults[key].map(keepColumn).filter(Boolean))).slice(0, 50);
    if (safeList.length) out[key] = safeList;
  }

  return out;
}
