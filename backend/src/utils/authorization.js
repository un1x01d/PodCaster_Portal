import { query } from "../config/db.js";

function isTruthyFlag(value) {
  return ["1", "true", "t", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

export function isPlatformAdminUser(user) {
  const roleLower = String(user?.role || "").trim().toLowerCase();
  return (
    roleLower === "admin" ||
    roleLower === "super_admin" ||
    roleLower === "superadmin" ||
    isTruthyFlag(user?.is_admin) ||
    isTruthyFlag(user?.super_admin)
  );
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

export function resolveViewColumnAllowlist(viewConfig, sheetHeaders = []) {
  const config = parseJsonMaybe(viewConfig, {}) || {};
  const explicitVisible = normalizeStringArray(
    config.visibleColumns ?? config.columns ?? config.allowedColumns ?? config.allowed_columns
  );
  if (explicitVisible.length > 0) return explicitVisible;

  const hiddenColumns = normalizeStringArray(config.hiddenColumns ?? config.hidden_columns);
  const headers = normalizeStringArray(sheetHeaders);
  if (hiddenColumns.length > 0 && headers.length > 0) {
    const hidden = new Set(hiddenColumns);
    return headers.filter((h) => !hidden.has(h));
  }
  return null;
}

export async function resolveAssignedViewForSheet(sheetId, userId, requestedViewId = null) {
  const sql = `
    SELECT
      v.id,
      v.config,
      s.headers
    FROM views v
    JOIN sheets s ON s.id = $1
    LEFT JOIN report_source_imports rsi ON rsi.sheet_id = s.id
    WHERE
      (
        v.sheet_id = s.id
        OR (
          v.sheet_id IS NULL
          AND v.report_source_id = rsi.report_source_id
          AND (v.file_label IS NULL OR v.file_label = rsi.file_label)
        )
      )
      AND (
        EXISTS (SELECT 1 FROM view_user_permissions vup WHERE vup.view_id = v.id AND vup.user_id = $2)
      )
      ${requestedViewId ? "AND v.id = $3" : ""}
    ORDER BY v.created_at DESC
    LIMIT 1
  `;
  const params = requestedViewId ? [sheetId, userId, requestedViewId] : [sheetId, userId];
  const rows = await query(sql, params);
  const row = rows[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    config: parseJsonMaybe(row.config, {}) || {},
    headers: parseJsonMaybe(row.headers, []) || [],
  };
}

export async function checkSheetAccess(sheetId, user) {
  if (isPlatformAdminUser(user)) return true;
  const rows = await query(
    `SELECT 1
       FROM sheets s
       LEFT JOIN report_sources rs ON rs.id = s.report_source_id
      WHERE s.id = $1
        AND (
          rs.created_by = $2
          OR EXISTS (
            SELECT 1
            FROM views v
            LEFT JOIN report_source_imports rsi ON rsi.sheet_id = s.id
            WHERE (
                v.sheet_id = s.id
                OR (
                  v.sheet_id IS NULL
                  AND v.report_source_id = rsi.report_source_id
                  AND (v.file_label IS NULL OR v.file_label = rsi.file_label)
                )
              )
              AND (
                EXISTS (SELECT 1 FROM view_user_permissions vup WHERE vup.view_id = v.id AND vup.user_id = $2)
              )
          )
        )
      LIMIT 1`,
    [sheetId, user.id]
  );
  return rows.length > 0;
}

export async function hasReportSourceOwnerAccess(sheetId, userId) {
  const rows = await query(
    `SELECT 1
     FROM sheets s
     LEFT JOIN report_sources rs ON rs.id = s.report_source_id
     WHERE s.id = $1
       AND rs.created_by = $2
     LIMIT 1`,
    [sheetId, userId]
  );
  return rows.length > 0;
}

export async function loadSheetPermissionSets(sheetId, userId) {
  const assigned = await resolveAssignedViewForSheet(sheetId, userId);
  if (!assigned) return { allPerms: [], validCols: [], rowFiltersList: [] };
  const validCols = resolveViewColumnAllowlist(assigned.config, assigned.headers) || [];
  const forcedFilters = assigned.config?.columnFilters && typeof assigned.config.columnFilters === "object"
    ? assigned.config.columnFilters
    : {};
  const allPerms = [{
    allowed_columns: validCols,
    row_filters: forcedFilters,
    _source: "view_assignment",
    _view_id: assigned.id,
  }];
  return {
    allPerms,
    validCols: Array.from(new Set(validCols.map((c) => String(c)))),
    rowFiltersList: Object.keys(forcedFilters).length ? [forcedFilters] : [],
  };
}
