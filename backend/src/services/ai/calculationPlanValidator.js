const ALLOWED_STATUS = new Set(["ready", "needs_clarification", "not_answerable"]);
const ALLOWED_ANALYSIS = new Set(["single_metric", "grouped_summary", "trend", "comparison", "variance", "margin", "explanation", "ranking", "driver_analysis", "contribution_analysis"]);
const ALLOWED_AGG = new Set(["sum", "count", "avg", "min", "max", "calculated"]);
const ALLOWED_FORMULA_OP = new Set(["sum", "subtract", "divide", "ratio", "none"]);
const ALLOWED_FILTER_OP = new Set(["=", "!=", ">", ">=", "<", "<=", "between", "in", "contains"]);

export function isValidIsoDate(value = "") {
  const s = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  return d.toISOString().slice(0, 10) === s;
}

export function validateDateRange(start, end) {
  if (!isValidIsoDate(start) || !isValidIsoDate(end)) return false;
  return new Date(`${start}T00:00:00Z`).getTime() <= new Date(`${end}T00:00:00Z`).getTime();
}

export function validateCalculationPlan(plan = {}, datasetContext = {}, permissions = {}) {
  const columns = Array.isArray(datasetContext?.columns) ? datasetContext.columns : [];
  const allowed = new Set((Array.isArray(permissions?.allowed_columns) ? permissions.allowed_columns : columns.map((c) => c?.name))
    .map((v) => String(v || "").toLowerCase()));
  const colByName = new Map(columns.map((c) => [String(c?.name || "").toLowerCase(), c || {}]));
  const originalColName = new Map(columns.map((c) => [String(c?.name || "").toLowerCase(), String(c?.name || "")]));

  const fail = (code, details = []) => ({
    ok: false,
    code: String(code || "invalid_plan"),
    reason: String(code || "invalid_plan"),
    details: Array.isArray(details) ? details : [String(details || "")].filter(Boolean),
  });

  if (!plan || typeof plan !== "object") return fail("plan_not_object");
  if (!ALLOWED_STATUS.has(String(plan.status || ""))) return fail("invalid_status");

  if (plan.status === "needs_clarification") {
    if (!plan?.clarification?.question) return fail("clarification_missing_question");
    return { ok: true };
  }
  if (plan.status === "not_answerable") {
    const na = plan.not_answerable;
    if (!na || typeof na !== "object" || !String(na.reason || "").trim()) {
      return fail("not_answerable_missing_reason");
    }
    return { ok: true };
  }

  const p = plan.calculation_plan;
  if (!p || typeof p !== "object") return fail("missing_calculation_plan");
  if (!ALLOWED_ANALYSIS.has(String(p.analysis_type || ""))) return fail("invalid_analysis_type");

  const isDriverAnalysis = String(p.analysis_type || "") === "driver_analysis";
  const metric = isDriverAnalysis ? (p.base_metric || p.metric || {}) : (p.metric || {});
  const sourceColumns = Array.isArray(metric.source_columns) ? metric.source_columns.map((c) => String(c || "")) : [];
  if (!sourceColumns.length) return fail("metric_source_columns_missing");
  for (const col of sourceColumns) {
    const lowCol = col.toLowerCase();
    if (!colByName.has(lowCol)) return fail(`unknown_column:${col}`);
    if (!allowed.has(lowCol)) return fail(`unauthorized_column:${col}`);
  }
  if (!ALLOWED_AGG.has(String(metric.aggregation || ""))) return fail("invalid_aggregation");
  if (!isDriverAnalysis) {
    const formula = metric.formula || {};
    if (!ALLOWED_FORMULA_OP.has(String(formula.operation || "none"))) return fail("invalid_formula_operation");
  }

  const tr = p.time_range || {};
  const dateColumn = String(tr.date_column || "").trim();
  if (dateColumn) {
    const lowDateCol = dateColumn.toLowerCase();
    if (!colByName.has(lowDateCol)) return fail(`unknown_date_column:${dateColumn}`);
    if (!allowed.has(lowDateCol)) return fail(`unauthorized_date_column:${dateColumn}`);
  }
  const dateDetails = [];
  if (tr.start || tr.end || String(p.analysis_type || "") === "comparison") {
    if (String(p.analysis_type || "") === "comparison") {
      // Comparison often needs a range, but 'all time' comparisons (like YoY across the whole sheet) 
      // may omit explicit start/end to imply 'all available data'.
      if (!dateColumn) dateDetails.push("comparison_requires_date_column");
    }
    if (tr.start && !isValidIsoDate(tr.start)) dateDetails.push("invalid_start_iso");
    if (tr.end && !isValidIsoDate(tr.end)) dateDetails.push("invalid_end_iso");
      if (tr.start && tr.end && !validateDateRange(tr.start, tr.end)) {
        if (isValidIsoDate(tr.start) && isValidIsoDate(tr.end)) dateDetails.push("start_after_end");
      }
      if (dateDetails.length) return fail("invalid_date_range", dateDetails);
    }

  const comparison = p.comparison || null;
  if (String(p.analysis_type || "") === "comparison") {
    if (!comparison || typeof comparison !== "object") return fail("comparison_missing");
    if (String(comparison.type || "") === "year_over_year") {
      if (tr.grain && String(tr.grain || "").toLowerCase() !== "year") return fail("comparison_invalid_grain", ["comparison_requires_year_grain"]);
      if (!dateColumn) return fail("invalid_date_range", ["comparison_requires_date_column"]);
    }
  }

  for (const filter of (Array.isArray(p.filters) ? p.filters : [])) {
    const col = String(filter?.column || "");
    const lowCol = col.toLowerCase();
    const op = String(filter?.operator || "");
    if (!colByName.has(lowCol)) return fail(`unknown_filter_column:${col}`);
    if (!allowed.has(lowCol)) return fail(`unauthorized_filter_column:${col}`);
    if (!ALLOWED_FILTER_OP.has(op)) return fail(`invalid_filter_operator:${op}`);
    if (op === "between") {
      const vals = Array.isArray(filter?.value) ? filter.value : [];
      if (vals.length !== 2 || !validateDateRange(vals[0], vals[1])) return fail("invalid_between_filter");
    }
  }

  for (const g of (Array.isArray(p.group_by) ? p.group_by : [])) {
    const col = String(g || "");
    const lowCol = col.toLowerCase();
    if (!colByName.has(lowCol)) return fail(`unknown_group_column:${col}`);
    if (!allowed.has(lowCol)) return fail(`unauthorized_group_column:${col}`);
  }

  return { ok: true };
}
