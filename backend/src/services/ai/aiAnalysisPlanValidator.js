import { parseAiAnalysisPlan } from "./aiAnalysisPlanSchema.js";

function isValidIsoDate(value = "") {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function validateAiAnalysisPlan({ plan, datasetProfile, allowedOperations = [] }) {
  const schema = parseAiAnalysisPlan(plan);
  if (!schema.ok) return { ok: false, code: "invalid_plan_schema", details: schema.errors };
  const p = schema.plan;
  if (p.status === "ready" && (!p.analysis_plan || !Array.isArray(p.analysis_plan.steps) || !p.analysis_plan.steps.length)) {
    return { ok: false, code: "ready_missing_steps", details: ["analysis_plan.steps_required"] };
  }
  if (p.status === "needs_clarification" && !p.clarification) {
    return { ok: false, code: "clarification_missing", details: ["clarification_required"] };
  }
  if (p.status === "not_answerable" && !p.not_answerable?.reason) {
    return { ok: false, code: "not_answerable_missing_reason", details: ["not_answerable.reason_required"] };
  }
  if (p.status !== "ready") return { ok: true, plan: p };

  const cols = new Map((datasetProfile?.columns || []).map((c) => [String(c.name || "").toLowerCase(), c]));
  const ops = new Set((Array.isArray(allowedOperations) ? allowedOperations : []).map((o) => String(o)));
  const stepIds = new Set();
  const details = [];

  const checkCol = (name, tag) => {
    const col = String(name || "").trim();
    if (!col) return;
    if (!cols.has(col.toLowerCase())) details.push(`${tag}:unknown_column:${col}`);
  };

  const isNumericColumn = (name) => {
    const c = cols.get(String(name || "").toLowerCase());
    const ratio = Number(c?.profile?.number_like_ratio || 0);
    const guess = String(c?.type_guess || "").toLowerCase();
    return guess === "number" || ratio >= 0.5;
  };
  const isDateLikeColumn = (name) => {
    const c = cols.get(String(name || "").toLowerCase());
    const ratio = Number(c?.profile?.date_like_ratio || 0);
    const guess = String(c?.type_guess || "").toLowerCase();
    return guess === "date" || ratio >= 0.4;
  };

  for (const step of p.analysis_plan.steps) {
    if (stepIds.has(step.step_id)) details.push(`duplicate_step_id:${step.step_id}`);
    stepIds.add(step.step_id);
    if (!ops.has(step.operation)) details.push(`unknown_operation:${step.operation}`);
    if (/\b(select|insert|update|delete|drop|function|=>|eval|javascript)\b/i.test(JSON.stringify(step))) details.push(`unsafe_content:${step.step_id}`);

    checkCol(step.metric?.column, "metric");
    for (const m of (step.metrics || [])) checkCol(m?.column, "metrics");
    for (const c of (step.driver_columns || [])) checkCol(c, "driver");
    for (const g of (step.group_by || [])) checkCol(g, "group_by");
    checkCol(step.dimension, "dimension");
    checkCol(step.date_column, "date_column");
    for (const f of (step.filters || [])) checkCol(f?.column, "filter");


    if (step.operation === "period_delta") {
      const b = step.baseline_range;
      const c = step.comparison_range;
      if (!Array.isArray(b) || b.length !== 2 || !Array.isArray(c) || c.length !== 2) {
        details.push(`period_delta_missing_ranges:${step.step_id}`);
      } else {
        const sameRange = String(b[0]) === String(c[0]) && String(b[1]) === String(c[1]);
        if (sameRange) details.push(`period_delta_identical_ranges:${step.step_id}`);
      }
    }


    const isDateOp = step.operation === "period_delta" || step.operation === "year_over_year" || step.operation === "period_driver_delta" || step.operation === "period_delta_by_dimension" || step.operation === "trend";
    if (isDateOp) {
      if (!step.date_column) {
        details.push(`missing_date_column:${step.step_id}`);
      } else {
        const dc = cols.get(String(step.date_column).toLowerCase());
        const dateLike = Number(dc?.profile?.date_like_ratio || 0);
        const typeGuess = String(dc?.type_guess || "").toLowerCase();
        if (!(typeGuess === "date" || dateLike >= 0.4)) {
          details.push(`non_date_column_for_date_operation:${step.step_id}:${step.date_column}`);
        }
      }
    }


    if (step.metric?.column && ["sum", "avg", "min", "max", "calculated"].includes(String(step.metric?.aggregation || "sum").toLowerCase()) && !isNumericColumn(step.metric.column)) {
      details.push(`non_numeric_metric_column:${step.step_id}:${step.metric.column}`);
    }

    if (step.operation === "period_delta_by_dimension") {
      const dim = String(step.dimension || step.group_by?.[0] || "").trim();
      if (!dim) {
        details.push(`missing_dimension:${step.step_id}`);
      } else if (isDateLikeColumn(dim)) {
        details.push(`date_like_dimension_not_allowed:${step.step_id}:${dim}`);
      }
    }

    if (step.operation === "period_driver_delta") {
      const drivers = Array.isArray(step.driver_columns) ? step.driver_columns.filter(Boolean) : [];
      if (!drivers.length) {
        details.push(`missing_driver_columns:${step.step_id}`);
      }
      for (const driver of drivers) {
        if (!isNumericColumn(driver)) details.push(`non_numeric_driver_column:${step.step_id}:${driver}`);
      }
      if (!Array.isArray(step.baseline_range) || step.baseline_range.length !== 2 || !Array.isArray(step.comparison_range) || step.comparison_range.length !== 2) {
        details.push(`period_driver_delta_missing_ranges:${step.step_id}`);
      }
    }

    const ranges = [step.baseline_range, step.comparison_range, step.time_range].filter(Boolean);
    for (const r of ranges) {
      if (!Array.isArray(r) || r.length !== 2 || !isValidIsoDate(r[0]) || !isValidIsoDate(r[1])) {
        details.push(`invalid_date_range:${step.step_id}`);
      } else if (new Date(`${r[0]}T00:00:00Z`) > new Date(`${r[1]}T00:00:00Z`)) {
        details.push(`start_after_end:${step.step_id}`);
      }
    }
  }

  if (details.length) return { ok: false, code: "invalid_plan", details };
  return { ok: true, plan: p };
}
