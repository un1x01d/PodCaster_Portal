import Decimal from "decimal.js";
import { parseMoney } from "../accounting/numeric.js";

const SAFE_OPS = new Set([
  "aggregate",
  "period_delta",
  "year_over_year",
  "period_driver_delta",
  "period_delta_by_dimension",
  "ranking",
  "trend",
  "ratio",
  "margin",
  "variance",
]);

function toDecimal(value) {
  const parsed = parseMoney(value);
  if (!parsed?.ok || !Number.isFinite(Number(parsed.value))) return null;
  return new Decimal(String(parsed.value));
}

function toIsoDate(value) {
  if (value === null || value === undefined || value === "") return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === "number" && Number.isFinite(value) && value > 20000 && value < 80000) {
    const excelEpoch = Date.UTC(1899, 11, 30);
    const ms = Math.round(value * 86400000);
    const d = new Date(excelEpoch + ms);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }

  const raw = String(value).trim();
  if (!raw) return null;

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const d = new Date(`${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}T00:00:00Z`);
    if (!Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === raw) return raw;
  }

  const slashMatch = raw.match(/^(\d{1,2})[\/\.](\d{1,2})[\/\.](\d{4})$/);
  if (slashMatch) {
    const mm = Number(slashMatch[1]);
    const dd = Number(slashMatch[2]);
    const yy = Number(slashMatch[3]);
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      const d = new Date(Date.UTC(yy, mm - 1, dd));
      const iso = d.toISOString().slice(0, 10);
      if (Number(iso.slice(0, 4)) == yy && Number(iso.slice(5, 7)) == mm && Number(iso.slice(8, 10)) == dd) return iso;
    }
  }

  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function extractYear(value) {
  const iso = toIsoDate(value);
  if (!iso) return null;
  return Number(iso.slice(0, 4));
}

function metricValueFromRow(row, metric = {}, counters = null) {
  const agg = String(metric?.aggregation || "sum").toLowerCase();
  if (agg === "count") return new Decimal(1);
  const dec = toDecimal(row?.[metric?.column]);
  if (!dec && counters) counters.invalid_numeric_rows += 1;
  return dec;
}

function checkAllowedColumns(step, allowedColumnsSet) {
  const required = [];
  if (step?.metric?.column) required.push(step.metric.column);
  for (const m of (Array.isArray(step?.metrics) ? step.metrics : [])) if (m?.column) required.push(m.column);
  for (const c of (Array.isArray(step?.driver_columns) ? step.driver_columns : [])) if (c) required.push(c);
  for (const c of (Array.isArray(step?.group_by) ? step.group_by : [])) if (c) required.push(c);
  if (step?.dimension) required.push(step.dimension);
  if (step?.date_column) required.push(step.date_column);
  for (const f of (Array.isArray(step?.filters) ? step.filters : [])) if (f?.column) required.push(f.column);

  const denied = required.filter((c) => !allowedColumnsSet.has(String(c)));
  return { ok: denied.length === 0, denied };
}

function matchesFilter(row, filter) {
  const col = String(filter?.column || "");
  const op = String(filter?.operator || "=");
  const val = filter?.value;
  const cell = row?.[col];

  if (op === "contains") return String(cell || "").toLowerCase().includes(String(val || "").toLowerCase());
  if (op === "in") return Array.isArray(val) && val.map((v) => String(v)).includes(String(cell));

  const cellDec = toDecimal(cell);
  const valDec = toDecimal(val);
  if (cellDec && valDec) {
    if (op === "=") return cellDec.eq(valDec);
    if (op === "!=") return !cellDec.eq(valDec);
    if (op === ">") return cellDec.gt(valDec);
    if (op === ">=") return cellDec.gte(valDec);
    if (op === "<") return cellDec.lt(valDec);
    if (op === "<=") return cellDec.lte(valDec);
  }

  if (op === "between") {
    if (!Array.isArray(val) || val.length !== 2) return false;
    const iso = toIsoDate(cell);
    const start = String(val[0] || "");
    const end = String(val[1] || "");
    return !!iso && iso >= start && iso <= end;
  }

  if (op === "=") return String(cell) === String(val);
  if (op === "!=") return String(cell) !== String(val);
  return false;
}

function applyRowSelection({ rows, step, externalFilters = [], counters }) {
  const allFilters = [
    ...(Array.isArray(externalFilters) ? externalFilters : []),
    ...(Array.isArray(step?.filters) ? step.filters : []),
  ];

  const dateRange = step?.time_range || null;
  const dateCol = step?.date_column || null;

  const out = [];
  for (const row of rows) {
    counters.rows_scanned += 1;
    if (dateRange && dateCol) {
      const iso = toIsoDate(row?.[dateCol]);
      if (!iso) continue;
      if (iso < dateRange[0] || iso > dateRange[1]) continue;
    }
    let pass = true;
    for (const f of allFilters) {
      if (!matchesFilter(row, f)) {
        pass = false;
        break;
      }
    }
    if (pass) out.push(row);
  }
  counters.rows_matched = out.length;
  return out;
}

function aggregateRows(rows, metric, counters) {
  const agg = String(metric?.aggregation || "sum").toLowerCase();
  if (agg === "count") return new Decimal(rows.length);

  const vals = [];
  for (const r of rows) {
    const v = metricValueFromRow(r, metric, counters);
    if (v) vals.push(v);
  }
  if (!vals.length) return new Decimal(0);
  if (agg === "avg") return vals.reduce((a, b) => a.plus(b), new Decimal(0)).div(vals.length);
  if (agg === "min") return vals.reduce((a, b) => Decimal.min(a, b));
  if (agg === "max") return vals.reduce((a, b) => Decimal.max(a, b));
  return vals.reduce((a, b) => a.plus(b), new Decimal(0));
}

function groupAggregate(rows, dimension, metric, counters) {
  const map = new Map();
  for (const r of rows) {
    const key = String(r?.[dimension] ?? "").trim();
    if (!key) continue;
    const v = metricValueFromRow(r, metric, counters);
    if (!v) continue;
    map.set(key, (map.get(key) || new Decimal(0)).plus(v));
  }
  return map;
}

function sortRows(rows, sort, limit = null) {
  const direction = String(sort?.direction || "desc").toLowerCase() === "asc" ? "asc" : "desc";
  const sorted = [...rows].sort((a, b) => {
    const av = Number(a.value ?? 0);
    const bv = Number(b.value ?? 0);
    return direction === "asc" ? av - bv : bv - av;
  });
  return Number.isFinite(Number(limit)) && Number(limit) > 0 ? sorted.slice(0, Number(limit)) : sorted;
}

function execAggregate({ selectedRows, step, counters, metadata }) {
  const groupBy = Array.isArray(step?.group_by) ? step.group_by : [];
  if (!groupBy.length) {
    const value = aggregateRows(selectedRows, step.metric, counters);
    return { value: value.toNumber() };
  }
  const dim = String(groupBy[0] || "");
  const grouped = groupAggregate(selectedRows, dim, step.metric, counters);
  const rows = Array.from(grouped.entries()).map(([label, dec]) => ({ label, value: dec.toNumber() }));
  return { rows: sortRows(rows, step.sort, step.limit) };
}

function execPeriodDelta({ selectedRows, step, counters }) {
  const baselineCounter = { rows_scanned: 0, rows_matched: 0, invalid_numeric_rows: 0 };
  const comparisonCounter = { rows_scanned: 0, rows_matched: 0, invalid_numeric_rows: 0 };
  const baselineRows = applyRowSelection({ rows: selectedRows, step: { ...step, filters: [], time_range: step.baseline_range }, counters: baselineCounter });
  const comparisonRows = applyRowSelection({ rows: selectedRows, step: { ...step, filters: [], time_range: step.comparison_range }, counters: comparisonCounter });

  if (!baselineRows.length || !comparisonRows.length) {
    return {
      __error: {
        code: "INSUFFICIENT_PERIOD_DATA",
        message: "One of the comparison periods has no matched rows.",
        baseline_rows_matched: baselineRows.length,
        comparison_rows_matched: comparisonRows.length,
      },
    };
  }

  const baseline = aggregateRows(baselineRows, step.metric, counters);
  const comparison = aggregateRows(comparisonRows, step.metric, counters);
  const absolute = comparison.minus(baseline);
  const pct = baseline.isZero() ? null : absolute.div(baseline).times(100);
  return {
    baseline_value: baseline.toNumber(),
    comparison_value: comparison.toNumber(),
    absolute_change: absolute.toNumber(),
    percent_change: pct ? pct.toNumber() : null,
    baseline_rows_matched: baselineRows.length,
    comparison_rows_matched: comparisonRows.length,
    date_range_used: { baseline: step.baseline_range || null, comparison: step.comparison_range || null },
  };
}

function execYearOverYear({ selectedRows, step, counters }) {
  const byYear = new Map();
  for (const row of selectedRows) {
    const y = extractYear(row?.[step.date_column]);
    if (!Number.isFinite(y)) continue;
    const v = metricValueFromRow(row, step.metric, counters);
    if (!v) continue;
    byYear.set(y, (byYear.get(y) || new Decimal(0)).plus(v));
  }
  const years = Array.from(byYear.keys()).sort((a, b) => a - b);
  const rows = years.map((year, idx) => {
    const value = byYear.get(year) || new Decimal(0);
    const prev = idx > 0 ? (byYear.get(years[idx - 1]) || new Decimal(0)) : null;
    const absolute = prev ? value.minus(prev) : null;
    const pct = prev && !prev.isZero() ? absolute.div(prev).times(100) : null;
    return {
      year,
      value: value.toNumber(),
      previous_year_value: prev ? prev.toNumber() : null,
      absolute_change: absolute ? absolute.toNumber() : null,
      percent_change: pct ? pct.toNumber() : null,
    };
  });
  return { rows };
}

function execPeriodDriverDelta({ selectedRows, step, counters }) {
  const driverColumns = Array.isArray(step.driver_columns) ? step.driver_columns.filter(Boolean) : [];
  if (!driverColumns.length) {
    return { __error: { code: "MISSING_DRIVER_COLUMNS", message: "Driver analysis requires one or more driver columns." } };
  }

  const baselineRows = selectedRows.filter((r) => {
    const iso = toIsoDate(r?.[step.date_column]);
    return Array.isArray(step.baseline_range) && iso && iso >= step.baseline_range[0] && iso <= step.baseline_range[1];
  });
  const comparisonRows = selectedRows.filter((r) => {
    const iso = toIsoDate(r?.[step.date_column]);
    return Array.isArray(step.comparison_range) && iso && iso >= step.comparison_range[0] && iso <= step.comparison_range[1];
  });

  if (!baselineRows.length || !comparisonRows.length) {
    return {
      __error: {
        code: "INSUFFICIENT_PERIOD_DATA",
        message: "One of the comparison periods has no matched rows.",
        baseline_rows_matched: baselineRows.length,
        comparison_rows_matched: comparisonRows.length,
      },
    };
  }

  const drivers = [];
  for (const col of driverColumns) {
    const metric = { column: col, aggregation: "sum" };
    const baseline = aggregateRows(baselineRows, metric, counters);
    const comparison = aggregateRows(comparisonRows, metric, counters);
    const delta = comparison.minus(baseline);
    drivers.push({ label: col, baseline_value: baseline.toNumber(), comparison_value: comparison.toNumber(), delta: delta.toNumber() });
  }
  drivers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return {
    rows: drivers,
    top_ranked: drivers.slice(0, 5),
    top_positive: drivers.filter((d) => d.delta > 0).slice(0, 5),
    top_negative: drivers.filter((d) => d.delta < 0).slice(0, 5),
  };
}

function execPeriodDeltaByDimension({ selectedRows, step, counters }) {
  const dim = String(step.dimension || step.group_by?.[0] || "");
  if (!dim) return { rows: [] };

  const hasExplicitPeriods = Array.isArray(step.baseline_range) && step.baseline_range.length === 2
    && Array.isArray(step.comparison_range) && step.comparison_range.length === 2;

  if (!hasExplicitPeriods && step.date_column) {
    const yearDim = new Map();
    for (const r of selectedRows) {
      const key = String(r?.[dim] ?? "").trim();
      const year = extractYear(r?.[step.date_column]);
      if (!key || !Number.isFinite(year)) continue;
      const v = metricValueFromRow(r, step.metric, counters);
      if (!v) continue;
      const yMap = yearDim.get(year) || new Map();
      yMap.set(key, (yMap.get(key) || new Decimal(0)).plus(v));
      yearDim.set(year, yMap);
    }

    const years = Array.from(yearDim.keys()).sort((a, b) => a - b);
    const rowsByYear = [];
    for (let i = 1; i < years.length; i += 1) {
      const prevYear = years[i - 1];
      const year = years[i];
      const prevMap = yearDim.get(prevYear) || new Map();
      const currMap = yearDim.get(year) || new Map();
      const labels = new Set([...prevMap.keys(), ...currMap.keys()]);
      const deltas = [];
      for (const label of labels) {
        const baseline = prevMap.get(label) || new Decimal(0);
        const comparison = currMap.get(label) || new Decimal(0);
        const delta = comparison.minus(baseline);
        if (delta.isZero()) continue;
        const pct = baseline.isZero() ? null : delta.div(baseline).times(100);
        deltas.push({
          label,
          baseline_value: baseline.toNumber(),
          comparison_value: comparison.toNumber(),
          absolute_change: delta.toNumber(),
          percent_change: pct ? pct.toNumber() : null,
          abs_delta_sort: Math.abs(delta.toNumber()),
        });
      }
      deltas.sort((a, b) => b.abs_delta_sort - a.abs_delta_sort);
      const limit = Number(step.limit || 1);
      const top = (Number.isFinite(limit) && limit > 0 ? deltas.slice(0, limit) : deltas).map(({ abs_delta_sort, ...rest }) => rest);
      rowsByYear.push({ year, previous_year: prevYear, top_contributors: top });
    }

    const flatRows = rowsByYear.flatMap((y) => (Array.isArray(y.top_contributors) ? y.top_contributors.map((c) => ({ year: y.year, previous_year: y.previous_year, ...c })) : []));
    return { rows_by_year: rowsByYear, rows: flatRows };
  }

  const keys = new Set();
  for (const r of selectedRows) {
    const key = String(r?.[dim] ?? "").trim();
    if (key) keys.add(key);
  }

  const rows = [];
  for (const key of keys) {
    const dimRows = selectedRows.filter((r) => String(r?.[dim] ?? "").trim() === key);
    const baselineRows = dimRows.filter((r) => {
      const iso = toIsoDate(r?.[step.date_column]);
      return Array.isArray(step.baseline_range) && iso && iso >= step.baseline_range[0] && iso <= step.baseline_range[1];
    });
    const comparisonRows = dimRows.filter((r) => {
      const iso = toIsoDate(r?.[step.date_column]);
      return Array.isArray(step.comparison_range) && iso && iso >= step.comparison_range[0] && iso <= step.comparison_range[1];
    });
    const baseline = aggregateRows(baselineRows, step.metric, counters);
    const comparison = aggregateRows(comparisonRows, step.metric, counters);
    const delta = comparison.minus(baseline);
    if (delta.isZero()) continue;
    const pct = baseline.isZero() ? null : delta.div(baseline).times(100);
    rows.push({
      label: key,
      baseline_value: baseline.toNumber(),
      comparison_value: comparison.toNumber(),
      absolute_change: delta.toNumber(),
      percent_change: pct ? pct.toNumber() : null,
      abs_delta_sort: Math.abs(delta.toNumber()),
    });
  }

  rows.sort((a, b) => b.abs_delta_sort - a.abs_delta_sort);
  const limited = Number(step.limit || 10) > 0 ? rows.slice(0, Number(step.limit || 10)) : rows;
  return { rows: limited.map(({ abs_delta_sort, ...rest }) => rest) };
}

function execRanking({ selectedRows, step, counters }) {
  const dim = String(step.dimension || step.group_by?.[0] || "");
  const grain = String(step.grain || "none").toLowerCase();
  if (step.date_column && grain === "year") {
    const byYear = new Map();
    for (const r of selectedRows) {
      const year = extractYear(r?.[step.date_column]);
      if (!Number.isFinite(year)) continue;
      const key = String(r?.[dim] ?? "").trim();
      if (!key) continue;
      const v = metricValueFromRow(r, step.metric, counters);
      if (!v) continue;
      const yearBucket = byYear.get(year) || new Map();
      yearBucket.set(key, (yearBucket.get(key) || new Decimal(0)).plus(v));
      byYear.set(year, yearBucket);
    }

    const yearEntries = Array.from(byYear.entries()).sort((a, b) => Number(a[0]) - Number(b[0]));
    const rowsByYear = yearEntries.map(([year, bucket], idx) => {
      const prevBucket = idx > 0 ? yearEntries[idx - 1][1] : null;
      const yearTotal = Array.from(bucket.values()).reduce((acc, dec) => acc.plus(dec), new Decimal(0));
      const rows = Array.from(bucket.entries()).map(([label, dec]) => {
        const prev = prevBucket ? (prevBucket.get(label) || null) : null;
        const absolute = prev ? dec.minus(prev) : null;
        const pct = prev && !prev.isZero() ? absolute.div(prev).times(100) : null;
        const share = !yearTotal.isZero() ? dec.div(yearTotal).times(100) : null;
        return {
          label,
          value: dec.toNumber(),
          previous_year_value: prev ? prev.toNumber() : null,
          absolute_change: absolute ? absolute.toNumber() : null,
          percent_change: pct ? pct.toNumber() : null,
          share_of_year_percent: share ? share.toNumber() : null,
        };
      });
      return {
        year,
        year_total_value: yearTotal.toNumber(),
        top_ranked: sortRows(rows, step.sort, step.limit),
      };
    });

    const rows = rowsByYear.flatMap((y) => {
      const ranked = Array.isArray(y.top_ranked) ? y.top_ranked : [];
      return ranked.map((r, i) => ({ year: y.year, rank: i + 1, label: r.label, value: r.value }));
    });
    return { rows_by_year: rowsByYear, rows };
  }

  const grouped = groupAggregate(selectedRows, dim, step.metric, counters);
  const rows = Array.from(grouped.entries()).map(([label, d]) => ({ label, value: d.toNumber() }));
  return { rows: sortRows(rows, step.sort, step.limit) };
}

function execTrend({ selectedRows, step, counters }) {
  const buckets = new Map();
  const grain = String(step.grain || "year").toLowerCase();
  for (const r of selectedRows) {
    const iso = toIsoDate(r?.[step.date_column]);
    if (!iso) continue;
    let key = iso.slice(0, 4);
    if (grain === "month") key = iso.slice(0, 7);
    if (grain === "day") key = iso;
    if (grain === "quarter") {
      const month = Number(iso.slice(5, 7));
      const q = Math.ceil(month / 3);
      key = `${iso.slice(0, 4)}-Q${q}`;
    }
    const v = metricValueFromRow(r, step.metric, counters);
    if (!v) continue;
    buckets.set(key, (buckets.get(key) || new Decimal(0)).plus(v));
  }

  const sorted = Array.from(buckets.entries())
    .map(([period, d]) => ({ period, dec: d }))
    .sort((a, b) => a.period.localeCompare(b.period));

  const rows = sorted.map((row, idx) => {
    const prev = idx > 0 ? sorted[idx - 1].dec : null;
    const absolute = prev ? row.dec.minus(prev) : null;
    const pct = prev && !prev.isZero() ? absolute.div(prev).times(100) : null;
    const base = {
      period: row.period,
      value: row.dec.toNumber(),
      previous_value: prev ? prev.toNumber() : null,
      absolute_change: absolute ? absolute.toNumber() : null,
      percent_change: pct ? pct.toNumber() : null,
    };
    if (grain === "year") {
      const y = Number(row.period);
      return {
        ...base,
        year: Number.isFinite(y) ? y : row.period,
        previous_year_value: base.previous_value,
      };
    }
    return base;
  });

  return { rows };
}


function execFormulaLike({ selectedRows, step, counters }) {
  const metrics = Array.isArray(step.metrics) ? step.metrics : [];
  const a = metrics[0] ? aggregateRows(selectedRows, metrics[0], counters) : new Decimal(0);
  const b = metrics[1] ? aggregateRows(selectedRows, metrics[1], counters) : new Decimal(0);

  if (step.operation === "variance") {
    return { value: a.minus(b).toNumber() };
  }
  if (b.isZero()) return { value: null };
  return { value: a.div(b).times(100).toNumber() };
}

function executeStep({ rows, step, externalFilters, allowedColumnsSet }) {
  const counters = {
    rows_scanned: 0,
    rows_matched: 0,
    invalid_numeric_rows: 0,
  };

  if (!SAFE_OPS.has(String(step?.operation || ""))) {
    return { ok: false, errorCode: "UNKNOWN_OPERATION", message: `Unsupported operation: ${String(step?.operation || "")}` };
  }

  const auth = checkAllowedColumns(step, allowedColumnsSet);
  if (!auth.ok) {
    return { ok: false, errorCode: "UNAUTHORIZED_COLUMN", message: `Unauthorized columns: ${auth.denied.join(", ")}` };
  }

  const selectionStep = (step.operation === "period_delta" || step.operation === "period_driver_delta" || step.operation === "period_delta_by_dimension")
    ? { ...step, time_range: null }
    : step;
  const selectedRows = applyRowSelection({ rows, step: selectionStep, externalFilters, counters });

  let resultPayload = {};
  if (step.operation === "aggregate") resultPayload = execAggregate({ selectedRows, step, counters });
  else if (step.operation === "period_delta") resultPayload = execPeriodDelta({ selectedRows, step, counters });
  else if (step.operation === "year_over_year") resultPayload = execYearOverYear({ selectedRows, step, counters });
  else if (step.operation === "period_driver_delta") resultPayload = execPeriodDriverDelta({ selectedRows, step, counters });
  else if (step.operation === "period_delta_by_dimension") resultPayload = execPeriodDeltaByDimension({ selectedRows, step, counters });
  else if (step.operation === "ranking") resultPayload = execRanking({ selectedRows, step, counters });
  else if (step.operation === "trend") resultPayload = execTrend({ selectedRows, step, counters });
  else if (step.operation === "ratio" || step.operation === "margin" || step.operation === "variance") resultPayload = execFormulaLike({ selectedRows, step, counters });

  if (resultPayload && resultPayload.__error) {
    return {
      ok: false,
      errorCode: resultPayload.__error.code,
      message: resultPayload.__error.message,
      details: {
        baseline_rows_matched: resultPayload.__error.baseline_rows_matched,
        comparison_rows_matched: resultPayload.__error.comparison_rows_matched,
      },
    };
  }

  return {
    ok: true,
    step_id: String(step.step_id || ""),
    operation: step.operation,
    ...resultPayload,
    metadata: {
      rows_scanned: counters.rows_scanned,
      rows_matched: counters.rows_matched,
      invalid_numeric_rows: counters.invalid_numeric_rows,
      columns_used: {
        metric: step?.metric?.column || null,
        metrics: Array.isArray(step?.metrics) ? step.metrics.map((m) => m.column).filter(Boolean) : [],
        date_column: step?.date_column || null,
        group_by: Array.isArray(step?.group_by) ? step.group_by : [],
        dimension: step?.dimension || null,
        driver_columns: Array.isArray(step?.driver_columns) ? step.driver_columns : [],
      },
      date_range_used: {
        time_range: step?.time_range || null,
        baseline_range: step?.baseline_range || null,
        comparison_range: step?.comparison_range || null,
      },
    },
  };
}

export function executeDeterministicSpreadsheetPlan({
  plan,
  rows = [],
  filters = [],
  userContext = {},
}) {
  if (!plan?.ok) {
    return { ok: false, errorCode: "PLAN_NOT_READY", message: "Deterministic plan is not ready." };
  }

  const safeRows = Array.isArray(rows) ? rows : [];
  const allColumns = safeRows.length > 0 ? Object.keys(safeRows[0] || {}) : [];
  const allowed = Array.isArray(userContext?.allowedColumns) && userContext.allowedColumns.length
    ? userContext.allowedColumns
    : allColumns;
  const allowedSet = new Set(allowed.map((c) => String(c)));

  const steps = Array.isArray(plan?.analysisPlan?.steps)
    ? plan.analysisPlan.steps
    : (plan?.step ? [plan.step] : []);

  if (!steps.length) {
    return { ok: false, errorCode: "NO_EXECUTION_STEPS", message: "No deterministic execution steps were provided." };
  }

  const stepResults = [];
  for (const step of steps) {
    const executed = executeStep({ rows: safeRows, step, externalFilters: filters, allowedColumnsSet: allowedSet });
    if (!executed.ok) return executed;
    stepResults.push(executed);
  }

  const final = stepResults[stepResults.length - 1] || {};
  const outputType = final.operation === "year_over_year"
    ? "yoy_table"
    : (final.operation === "period_delta"
      ? "period_delta"
      : (final.operation === "period_driver_delta"
        ? "drivers"
        : (final.operation === "period_delta_by_dimension" && Array.isArray(final.rows_by_year)
          ? "drivers_yoy"
          : (final.operation === "ranking" || final.operation === "period_delta_by_dimension"
            ? "ranking"
            : (final.operation === "trend" ? "trend" : "scalar")))));

  return {
    ok: true,
    outputType,
    analysis_type: String(plan?.analysisPlan?.analysis_type || "deterministic"),
    step_results: stepResults,
    ...final,
    summary: `Executed ${stepResults.length} deterministic step(s).`,
    metadata: {
      rows_total: safeRows.length,
      steps_executed: stepResults.length,
      columns_allowed: Array.from(allowedSet),
    },
  };
}
