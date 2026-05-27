import { generateStructuredCalculationPlan } from "./aiCalculationPlanner.js";


function tryParseJsonText(text = "") {
  const t = String(text || "").trim();
  if (!t) return null;
  try { return JSON.parse(t); } catch {}

  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    try { return JSON.parse(fenced[1]); } catch {}
  }

  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first >= 0 && last > first) {
    const slice = t.slice(first, last + 1);
    try { return JSON.parse(slice); } catch {}
  }
  return null;
}

function normalizePlannerPayload(raw) {
  if (raw && typeof raw === "object") return raw;
  const parsed = tryParseJsonText(raw);
  if (parsed && typeof parsed === "object") return parsed;
  // Keep raw payload so downstream schema parser can fail and trigger repair flow.
  return raw;
}

function convertLegacyPlanShape(plan = {}) {
  if (!plan || typeof plan !== "object") return plan;
  if (plan.analysis_plan) return plan;
  const calc = plan.calculation_plan;
  if (!calc) return plan;

  const comparisonType = String(calc?.comparison?.type || "").toLowerCase();
  const hasExplicitRanges = Boolean(calc?.comparison?.baseline_range?.start && calc?.comparison?.baseline_range?.end
    && calc?.comparison?.comparison_range?.start && calc?.comparison?.comparison_range?.end);
  const analysisType = String(calc?.analysis_type || "");
  const hasDriverColumns = Array.isArray(calc?.driver_columns) && calc.driver_columns.length > 0;
  const hasDimensionGrouping = (Array.isArray(calc?.group_by) && calc.group_by.length > 0)
    || (Array.isArray(calc?.dimensions) && calc.dimensions.length > 0);

  const operation = analysisType === "driver_analysis"
    ? (hasDriverColumns
      ? "period_driver_delta"
      : (hasDimensionGrouping ? "period_delta_by_dimension" : "ranking"))
    : (analysisType === "trend" ? "trend"
      : ((comparisonType === "year_over_year" && !hasDimensionGrouping)
        ? "year_over_year"
        : ((analysisType === "comparison" || hasExplicitRanges || comparisonType === "period_vs_period" || comparisonType === "period_over_period")
          ? (hasDimensionGrouping ? "period_delta_by_dimension" : "period_delta")
          : (Array.isArray(calc?.group_by) && calc.group_by.length ? "ranking" : "aggregate"))));

  const step = {
    step_id: "step_1",
    operation,
    metric: calc?.metric?.source_columns?.[0] ? { column: String(calc.metric.source_columns[0]), aggregation: String(calc?.metric?.aggregation || "sum") } : null,
    metrics: Array.isArray(calc?.metric?.source_columns) ? calc.metric.source_columns.map((c) => ({ column: String(c), aggregation: String(calc?.metric?.aggregation || "sum") })) : [],
    driver_columns: Array.isArray(calc?.driver_columns) ? calc.driver_columns : [],
    dimension: Array.isArray(calc?.group_by) && calc.group_by.length
      ? String(calc.group_by[0])
      : (Array.isArray(calc?.dimensions) && calc.dimensions.length ? String(calc.dimensions[0]) : null),
    date_column: String(calc?.time_range?.date_column || "") || null,
    filters: Array.isArray(calc?.filters) ? calc.filters : [],
    baseline_range: calc?.comparison?.baseline_range ? [calc.comparison.baseline_range.start, calc.comparison.baseline_range.end] : null,
    comparison_range: calc?.comparison?.comparison_range ? [calc.comparison.comparison_range.start, calc.comparison.comparison_range.end] : null,
    time_range: calc?.time_range?.start && calc?.time_range?.end ? [calc.time_range.start, calc.time_range.end] : null,
    grain: String(calc?.time_range?.grain || "none"),
    group_by: Array.isArray(calc?.group_by) ? calc.group_by : [],
    sort: calc?.sort ? { by: String(calc?.sort?.by || "metric"), direction: String(calc?.sort?.direction || "desc") } : null,
    limit: Number.isInteger(calc?.limit) ? calc.limit : null,
  };

  return {
    status: plan.status,
    intent_summary: plan.intent_summary,
    confidence: plan.confidence,
    analysis_plan: {
      analysis_type: String(calc?.analysis_type || "single_metric"),
      steps: [step],
      final_response_instruction: { style: "business_explanation", include_tables: true, include_causation_warning: true },
    },
    clarification: plan.clarification || null,
    not_answerable: plan.not_answerable
      ? {
        reason: plan.not_answerable.reason,
        missing_data: plan.not_answerable.missing_data || [],
        best_available_alternative: plan.not_answerable.best_alternative || null,
      }
      : null,
    warnings: plan.warnings || [],
  };
}

export async function callAiAnalystPlanner({ planningContext, runtime = null, conversationHistory = [], aiPlannerResponse = null }) {
  const raw = aiPlannerResponse || await generateStructuredCalculationPlan({
    question: String(planningContext?.question || ""),
    datasetContext: {
      dataset: planningContext?.dataset || {},
      semantic_candidates: planningContext?.semantic_candidates || {},
      known_mappings: planningContext?.known_mappings || {},
    },
    allowedOperations: planningContext?.allowed_operations || [],
    runtime,
    conversationHistory,
    memory: planningContext?.conversation_memory || null,
  });
  const normalizedRaw = normalizePlannerPayload(raw);
  return convertLegacyPlanShape(normalizedRaw);
}
