import { metricRegistry, resolveFinanceColumns } from "./metricRegistry.js";
import { query } from "../../config/db.js";

function toDate(v) {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function enforceRowAccess(rows = [], permissionContext = {}) {
  const filters = Array.isArray(permissionContext.rowFiltersList) ? permissionContext.rowFiltersList : [];
  if (!filters.length) return rows;
  return rows.filter((row) => filters.every((f) => Object.entries(f || {}).every(([k, v]) => String(row?.[k] ?? "") === String(v))));
}

export function enforceColumnAccess(rows = [], allowedColumns = []) {
  const set = new Set((allowedColumns || []).map(String));
  return rows.map((r) => Object.fromEntries(Object.entries(r || {}).filter(([k]) => set.has(String(k)))));
}

export function validateMetricColumnAccess(metric, allowedColumns = [], columnMap = {}) {
  const set = new Set((allowedColumns || []).map(String));
  const requiredLogical = metric?.requiredColumns || [];
  const missing = requiredLogical.filter((logical) => !columnMap?.[logical] || !set.has(String(columnMap[logical])));
  return { ok: missing.length === 0, missing };
}

function applyPeriodFilter(rows = [], columnMap = {}, period = null) {
  if (!period || (!period.start && !period.end)) return rows;
  const col = columnMap.period;
  if (!col) return rows;
  const s = period.start ? toDate(period.start) : null;
  const e = period.end ? toDate(period.end) : null;
  return rows.filter((r) => {
    const d = toDate(r?.[col]);
    if (!d) return false;
    if (s && d < s) return false;
    if (e && d > e) return false;
    return true;
  });
}

function groupRows(rows = [], byCol = null) {
  if (!byCol) return { all: rows };
  return rows.reduce((acc, row) => {
    const k = String(row?.[byCol] ?? "unknown");
    if (!acc[k]) acc[k] = [];
    acc[k].push(row);
    return acc;
  }, {});
}

export async function logFinanceCalculationAudit(payload = {}) {
  await query(
    `INSERT INTO finance_calculation_audit
      (user_id, tenant_id, sheet_id, metric, columns_used, filters_used, row_count, success, error_code)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9)`,
    [payload.userId || null, payload.tenantId || null, payload.sheetId || null, payload.metric || null, JSON.stringify(payload.columnsUsed || []), JSON.stringify(payload.filtersUsed || {}), Number(payload.rowCount || 0), !!payload.success, payload.errorCode || null]
  ).catch(() => {});
}

export async function calculateFinanceMetric({ rows = [], headers = [], metricKey, filters = {}, permissionContext = {}, period = null, groupBy = null, comparison = null, audit = {} }) {
  const metric = metricRegistry[metricKey];
  if (!metric) {
    return { ok: false, errorCode: "UNKNOWN_METRIC", message: `Unknown metric ${metricKey}.`, metric: metricKey };
  }

  const allowedColumns = permissionContext.allowedColumns || headers;
  const scopedRows = enforceColumnAccess(enforceRowAccess(rows, permissionContext), allowedColumns);
  const columnMap = resolveFinanceColumns(headers);
  const accessCheck = validateMetricColumnAccess(metric, allowedColumns, columnMap);
  if (!accessCheck.ok) {
    const out = { ok: false, errorCode: "UNAUTHORIZED_OR_MISSING_COLUMNS", message: `Metric ${metricKey} requires restricted or missing columns.`, missingColumns: accessCheck.missing, metric: metricKey };
    await logFinanceCalculationAudit({ ...audit, metric: metricKey, columnsUsed: Object.values(columnMap).filter(Boolean), filtersUsed: filters, rowCount: 0, success: false, errorCode: out.errorCode });
    return out;
  }

  const periodRows = applyPeriodFilter(scopedRows, columnMap, period);
  const groupedRows = groupRows(periodRows, groupBy || null);
  const comparisonPayload = comparison || {};
  const calc = metric.calculate({ rows: periodRows, groupedRows, columns: columnMap, comparison: comparisonPayload });

  const out = {
    ok: true,
    metric: metric.key,
    label: metric.label,
    formula: metric.formula,
    value: calc.value,
    outputType: metric.outputType,
    inputs: calc.inputs || {},
    rowCount: periodRows.length,
    notes: Array.isArray(calc.notes) ? calc.notes : [],
    period: period || {},
  };

  await logFinanceCalculationAudit({ ...audit, metric: metric.key, columnsUsed: metric.requiredColumns.map((k) => columnMap[k]).filter(Boolean), filtersUsed: filters, rowCount: periodRows.length, success: true, errorCode: null });
  return out;
}
