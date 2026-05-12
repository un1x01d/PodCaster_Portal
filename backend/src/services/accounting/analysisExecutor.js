import { runDeterministicCalculation } from "./calculationService.js";
import { safeDivide, roundCurrency, roundPercent } from "./numeric.js";

function groupVariance(rows, dimensionHeader, valueHeader, dateHeader, period, comparisonPeriod) {
  const result = new Map();
  const inRange = (d, p) => {
    if (!p) return true;
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return false;
    return dt >= new Date(`${p.start}T00:00:00Z`) && dt <= new Date(`${p.end}T23:59:59Z`);
  };
  for (const row of rows) {
    const key = String(row?.[dimensionHeader] || "Unknown");
    const val = Number(String(row?.[valueHeader] ?? "").replace(/[^0-9.+-]/g, ""));
    if (!Number.isFinite(val)) continue;
    const entry = result.get(key) || { current: 0, comparison: 0 };
    if (inRange(row?.[dateHeader], period)) entry.current += val;
    if (inRange(row?.[dateHeader], comparisonPeriod)) entry.comparison += val;
    result.set(key, entry);
  }
  return Array.from(result.entries()).map(([group, v]) => {
    const varianceAmount = v.current - v.comparison;
    const pct = safeDivide(varianceAmount, v.comparison);
    return { group, current: roundCurrency(v.current), comparison: roundCurrency(v.comparison), varianceAmount: roundCurrency(varianceAmount), variancePct: pct.ok ? roundPercent(pct.value * 100) : null };
  }).sort((a,b)=>Math.abs(b.varianceAmount)-Math.abs(a.varianceAmount));
}

export function executeAnalysisPlan({ approvedPlan, headerResolution, rows = [], userContext = {} }) {
  try {
    const required = headerResolution?.requiredMappings || {};
    const optional = headerResolution?.optionalMappings || {};
    const asHR = (map) => ({ ok: true, resolvedMappings: map, optionalMappings: {} });
    const period = approvedPlan?.period || null;
    const comparisonPeriod = approvedPlan?.comparison_period || null;

    const results = {};
    const stepsExecuted = [];

    for (const step of (approvedPlan.analysis_steps || [])) {
      if (step.type === "calculate_metric") {
        const map = {
          total_revenue: { total_revenue: required.revenue?.header || required.total_revenue?.header, date: required.date?.header },
          total_expense: { total_expense: required.expenses?.header || required.total_expense?.header, date: required.date?.header },
          net_income: { net_income: required.net_income?.header, total_revenue: required.revenue?.header, total_expense: required.expenses?.header, date: required.date?.header },
          gross_margin_pct: { total_revenue: required.revenue?.header, cogs: required.cogs?.header, gross_profit: required.gross_profit?.header, date: required.date?.header },
        }[step.metric] || {};
        const cleanMap = Object.fromEntries(Object.entries(map).filter(([,v]) => !!v));
        const calc = runDeterministicCalculation({ rows, metric: step.metric, headerResolution: asHR(cleanMap), period: step.period === "comparison" ? comparisonPeriod : period, comparisonPeriod, userContext });
        results[step.step_id] = calc;
        stepsExecuted.push(step.step_id);
      }
      if (step.type === "calculate_variance") {
        const a = results[step.current_step] || null;
        const b = results[step.comparison_step] || null;
        const current = Number(a?.value ?? 0);
        const comparison = Number(b?.value ?? 0);
        const varianceAmount = current - comparison;
        const pct = safeDivide(varianceAmount, comparison);
        results[step.step_id] = { metric: step.metric, current: roundCurrency(current), comparison: roundCurrency(comparison), varianceAmount: roundCurrency(varianceAmount), variancePct: pct.ok ? roundPercent(pct.value * 100) : null };
        stepsExecuted.push(step.step_id);
      }
      if (step.type === "rank_drivers") {
        const gb = optional?.[step.group_by]?.header || required?.[step.group_by]?.header;
        const metricHeader = required.expenses?.header || required.revenue?.header || required.net_income?.header;
        const dateHeader = required.date?.header;
        if (!gb || !metricHeader || !dateHeader) continue;
        const ranked = groupVariance(rows, gb, metricHeader, dateHeader, period, comparisonPeriod).slice(0, Math.min(Number(step.limit || 5), 10));
        results[step.step_id] = ranked;
        stepsExecuted.push(step.step_id);
      }
    }

    return {
      ok: true,
      analysisType: approvedPlan.question_type,
      primaryMetric: approvedPlan.primary_metric,
      period,
      comparisonPeriod: comparisonPeriod,
      answerCompleteness: headerResolution?.answerCompleteness || "full",
      results,
      headersUsed: Object.fromEntries(Object.entries({ ...required, ...optional }).map(([k,v]) => [k, v?.header]).filter(([,v]) => !!v)),
      rowCounts: { current: Array.isArray(rows) ? rows.length : 0, comparison: Array.isArray(rows) ? rows.length : 0 },
      limitations: headerResolution?.limitations || [],
      notes: [],
      stepsExecuted,
      missingOptionalFields: headerResolution?.missingOptional || [],
    };
  } catch (e) {
    return { ok: false, errorCode: "ANALYSIS_EXECUTION_FAILED", message: "Unable to complete the analysis safely.", details: [String(e?.message || e)] };
  }
}
