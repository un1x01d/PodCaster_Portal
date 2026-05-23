import { generateStructuredCalculationPlan } from "./aiCalculationPlanner.js";
import { validateCalculationPlan } from "./calculationPlanValidator.js";

function inferColumnTypeFromSamples(sampleValues = []) {
  const vals = Array.isArray(sampleValues) ? sampleValues : [];
  if (!vals.length) return "unknown";
  let numeric = 0;
  let dateLike = 0;
  for (const v of vals) {
    const s = String(v ?? "").trim();
    if (!s) continue;
    const n = Number(s.replace(/[$,%\s,]/g, ""));
    if (Number.isFinite(n)) numeric += 1;
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) dateLike += 1;
  }
  const denom = Math.max(1, vals.length);
  if (dateLike / denom >= 0.6) return "date";
  if (numeric / denom >= 0.6) return "number";
  return "string";
}

function buildSafeDatasetContext({ headers = [], sampleRows = [], fieldMetadata = {} }) {
  const list = Array.isArray(headers) ? headers.map((h) => String(h || "")).filter(Boolean) : [];
  const dateHeader = String(fieldMetadata?.date || "").trim();
  let dateRange = null;
  if (dateHeader && Array.isArray(sampleRows) && sampleRows.length > 0) {
    const dates = sampleRows
      .map(r => {
        const val = r[dateHeader];
        if (!val) return null;
        const d = new Date(val);
        return isNaN(d.getTime()) ? null : d;
      })
      .filter(Boolean)
      .sort((a, b) => a - b);
    if (dates.length >= 2) {
      dateRange = { 
        start: dates[0].toISOString().slice(0, 10), 
        end: dates[dates.length - 1].toISOString().slice(0, 10) 
      };
    }
  }

  const columns = list.map((name) => {
    const values = (Array.isArray(sampleRows) ? sampleRows : [])
      .slice(0, 20)
      .map((r) => r?.[name])
      .filter((v) => v !== null && v !== undefined && String(v).trim() !== "");
    return {
      name,
      type: inferColumnTypeFromSamples(values),
      sample_values: values.slice(0, 6),
    };
  });
  return {
    table_name: "sheet",
    columns,
    known_mappings: {
      date: String(fieldMetadata?.date || "").trim() || undefined,
      revenue: String(fieldMetadata?.total_revenue || fieldMetadata?.net_revenue || "").trim() || undefined,
      net_revenue: String(fieldMetadata?.net_revenue || "").trim() || undefined,
      expense: String(fieldMetadata?.total_expense || "").trim() || undefined,
      cost: String(fieldMetadata?.cogs || "").trim() || undefined,
    },
    date_range: dateRange,
  };
}

function mapAiConceptToMetricKey(concept = "") {
  const c = String(concept || "").toLowerCase().replace(/\s+/g, "_");
  const map = {
    revenue: "total_revenue",
    sales: "total_revenue",
    income: "total_revenue",
    net_revenue: "net_revenue",
    "net_revenue": "net_revenue",
    "net revenue": "net_revenue",
    gross_revenue: "total_revenue",
    expense: "total_expense",
    cost: "total_expense",
    cogs: "cogs",
    gross_profit: "gross_profit",
    net_profit: "net_income",
    net_income: "net_income",
    profit: "net_income",
    margin: "gross_margin_pct",
    gross_margin: "gross_margin_pct",
    count: "total_revenue",
    average: "total_revenue",
    other_income: "total_revenue",
  };
  return map[c] || null;
}

function makeClarification(reason, question, options = []) {
  return {
    ok: false,
    clarification_needed: true,
    reason: String(reason || "clarification_needed"),
    clarification_question: String(question || "").trim(),
    clarification_options: Array.isArray(options) ? options.map((o) => String(o)).filter(Boolean).slice(0, 8) : [],
  };
}

function buildInvalidDateClarification(datasetContext = {}) {
  const columns = Array.isArray(datasetContext?.columns) ? datasetContext.columns : [];
  const dateCandidates = columns
    .filter((c) => String(c?.type || "").toLowerCase() === "date")
    .map((c) => String(c?.name || "").trim())
    .filter(Boolean);
  const dateOptions = dateCandidates.length > 1 ? dateCandidates : [];
  const question = dateOptions.length
    ? "I need one clarification before running this comparison: which date column should I use, and which years should I compare?"
    : "I need one clarification before running this comparison: which years should I compare?";
  return makeClarification("invalid_date_range", question, dateOptions);
}

function normalizeClarification(aiPlan) {
  if (
    aiPlan
    && aiPlan.status === "needs_clarification"
    && aiPlan.clarification
    && Array.isArray(aiPlan.clarification.options)
    && aiPlan.clarification.options.length === 1
  ) {
    const opt = aiPlan.clarification.options[0];
    return {
      autoResolved: true,
      field: String(aiPlan.clarification.field || "").trim(),
      value: String(opt?.value || opt?.label || "").trim(),
    };
  }
  return { autoResolved: false };
}

function toLegacyPlanFromAi({ aiPlan = {}, plannerState = null, headers = [], sampleRows = [], fieldMetadata = {} }) {
  if (aiPlan?.status === "needs_clarification") {
    const options = Array.isArray(aiPlan?.clarification?.options)
      ? aiPlan.clarification.options.map((o) => String(o?.value || o?.label || "").trim()).filter(Boolean)
      : [];
    const out = makeClarification(
      "ai_needs_clarification",
      String(aiPlan?.clarification?.question || "I can answer that, but I need one clarification first."),
      options
    );
    out.clarification_field = String(aiPlan?.clarification?.field || "").trim() || null;
    out.planner_state = plannerState || null;
    return out;
  }
  if (aiPlan?.status === "not_answerable") {
    return {
      ok: false,
      clarification_needed: false,
      reason: "ai_not_answerable",
      message: String(aiPlan?.not_answerable?.reason || "This dataset cannot answer that question safely."),
    };
  }

  const calc = aiPlan?.calculation_plan || {};

  if (String(calc?.analysis_type || "").toLowerCase() === "driver_analysis") {
    return {
      ok: true,
      operation: "driver_analysis",
      metric: mapAiConceptToMetricKey(calc?.base_metric?.business_concept) || "total_revenue",
      base_metric: calc?.base_metric || {},
      comparison: calc?.comparison || {},
      driver_columns: calc?.driver_columns || [],
      dimensions: calc?.dimensions || [],
      verification: {
        method: "ai_structured_planner_v2",
        confidence: aiPlan?.confidence === "high" ? 0.92 : (aiPlan?.confidence === "medium" ? 0.8 : 0.72),
        fallback_used: false,
        evidence: { analysisType: "driver_analysis" },
      },
    };
  }

  const metric = calc?.metric || {};
  const sourceColumns = Array.isArray(metric?.source_columns) ? metric.source_columns.map((c) => String(c || "").trim()).filter(Boolean) : [];
  const sourceColumn = sourceColumns[0] || "";
  const metricKey = mapAiConceptToMetricKey(metric?.concept);
  if (!metricKey) {
    return {
      ok: false,
      clarification_needed: false,
      reason: "ai_metric_not_executable",
      message: "AI plan metric concept is not executable. Please restate the metric clearly.",
    };
  }
  const tr = calc?.time_range || {};
  const dateColumn = String(tr?.date_column || "").trim();
  const groupBy = Array.isArray(calc?.group_by) ? calc.group_by.map((g) => String(g || "").trim()).filter(Boolean) : [];
  const limit = Number.isFinite(Number(calc?.limit)) ? Math.max(1, Math.min(50, Number(calc.limit))) : 5;
  const startYear = Number(String(tr?.start || "").slice(0, 4));
  const endYear = Number(String(tr?.end || "").slice(0, 4));
  const filters = Array.isArray(calc?.filters) ? [...calc.filters] : [];
  if (!filters.length && dateColumn && tr?.start && tr?.end) {
    filters.push({ column: dateColumn, operator: "between", value: [String(tr.start), String(tr.end)] });
  }

  const resolution = {
    resolvedMappings: sourceColumn ? { [metricKey]: sourceColumn } : {},
    optionalMappings: dateColumn ? { date: dateColumn } : {},
  };

  const comparisonType = String(calc?.comparison?.type || "").toLowerCase();
  const isTrend = String(calc?.analysis_type || "").toLowerCase() === "trend";
  const isYoy = (isTrend || comparisonType === "year_over_year")
    && ((Number.isFinite(startYear) && Number.isFinite(endYear) && startYear !== endYear) || isTrend || groupBy.includes(dateColumn));

  const maxDataYear = buildSafeDatasetContext({ headers, sampleRows, fieldMetadata }).date_range?.end ? Number(buildSafeDatasetContext({ headers, sampleRows, fieldMetadata }).date_range.end.slice(0, 4)) : 2026;
  const targetYears = [];
  if (startYear > maxDataYear) targetYears.push(startYear);
  if (endYear > maxDataYear && endYear !== startYear) targetYears.push(endYear);
  
  // If the user asks for "next 3 years", the LLM might only set one year in start/end.
  // We can look at the intent summary or just assume if one future year is requested, check if it implies a series.
  const isProjection = targetYears.length > 0 || (isTrend && (startYear > maxDataYear || endYear > maxDataYear));

  if (isProjection) {
    const finalTargetYears = [...targetYears];
    if (isTrend && endYear > startYear) {
      for (let y = startYear; y <= endYear; y++) {
        if (y > maxDataYear && !finalTargetYears.includes(y)) finalTargetYears.push(y);
      }
    }
    if (finalTargetYears.length === 0 && (startYear > maxDataYear || endYear > maxDataYear)) {
       finalTargetYears.push(startYear > maxDataYear ? startYear : endYear);
    }

    return {
      ok: true,
      operation: "metric_projection",
      metric: metricKey,
      targetYears: finalTargetYears.sort((a, b) => a - b),
      targetYear: finalTargetYears[0], // backward compatibility
      dateHeader: dateColumn,
      resolution,
      filters,
      verification: {
        method: "ai_structured_planner_v2",
        confidence: aiPlan?.confidence === "high" ? 0.92 : (aiPlan?.confidence === "medium" ? 0.8 : 0.72),
        fallback_used: false,
        evidence: { dateColumn, sourceColumns, analysisType: "projection", targetYears: finalTargetYears },
      },
    };
  }

  if (isTrend || isYoy) {
    return {
      ok: true,
      operation: "yoy_series",
      metric: metricKey,
      years: (isYoy || isTrend) ? [Math.min(startYear || 1900, endYear || 2200), Math.max(startYear || 1900, endYear || 2200)] : [],
      period: (!isYoy && !isTrend && Number.isFinite(startYear) && startYear === endYear) ? startYear : null,
      resolution,
      filters,
      verification: {
        method: "ai_structured_planner_v2",
        confidence: aiPlan?.confidence === "high" ? 0.92 : (aiPlan?.confidence === "medium" ? 0.8 : 0.72),
        fallback_used: false,
        evidence: { dateColumn, sourceColumns, analysisType: calc?.analysis_type || "" },
      },
    };
  }

  if (groupBy.length > 0) {
    return {
      ok: true,
      operation: "top_n_by_dimension",
      metric: metricKey,
      dimensionHeader: groupBy[0],
      valueHeader: sourceColumn || "",
      limit,
      direction: String(calc?.sort?.direction || "desc").toLowerCase() === "asc" ? "asc" : "desc",
      accountOnly: false,
      resolution,
      filters,
      verification: {
        method: "ai_structured_planner_v2",
        confidence: aiPlan?.confidence === "high" ? 0.92 : (aiPlan?.confidence === "medium" ? 0.8 : 0.72),
        fallback_used: false,
        evidence: { dateColumn, sourceColumns, groupBy, analysisType: calc?.analysis_type || "" },
      },
    };
  }

  return {
    ok: true,
    operation: "single_period",
    metric: metricKey,
    years: [],
    period: Number.isFinite(startYear) && startYear === endYear ? startYear : null,
    resolution,
    filters,
    verification: {
      method: "ai_structured_planner_v2",
      confidence: aiPlan?.confidence === "high" ? 0.92 : (aiPlan?.confidence === "medium" ? 0.8 : 0.72),
      fallback_used: false,
      evidence: { dateColumn, sourceColumns, analysisType: calc?.analysis_type || "" },
    },
  };
}

async function continuePlanWithClarification({
  originalQuestion = "",
  previousPlan = null,
  clarificationField = "",
  clarificationValue = "",
  datasetContext = {},
  allowedOperations = [],
  runtime = null,
  conversationHistory = [],
  memory = null,
  aiPlannerFollowupResponse = null,
}) {
  const continuationPrompt = [
    "You are continuing a spreadsheet planning conversation.",
    `Original question: ${String(originalQuestion || "").trim()}`,
    `Previous partial plan: ${JSON.stringify(previousPlan || {})}`,
    `Resolved clarification: ${String(clarificationField || "").trim()} = ${String(clarificationValue || "").trim()}`,
    "Return a complete updated plan.",
    "If complete, return status='ready'.",
    "If another clarification is required, return status='needs_clarification'.",
    "Do not ask clarification with one option.",
    "Return strict JSON only.",
  ].join("\n");
  return aiPlannerFollowupResponse || generateStructuredCalculationPlan({
    question: continuationPrompt,
    datasetContext,
    allowedOperations,
    runtime,
    conversationHistory,
    memory,
  });
}

export async function buildDeterministicSpreadsheetPlan({
  message = "",
  headers = [],
  semanticProfile = {},
  sampleRows = [],
  hints = {},
}) {
  const useAiPlanner = hints?.useAiPlanner !== false;
  if (!useAiPlanner) {
    return {
      ok: false,
      clarification_needed: false,
      reason: "ai_planner_required",
      message: "AI planner is required for semantic interpretation.",
    };
  }

  const fieldMetadata = { ...(semanticProfile?.headerMappings || {}) };
  const datasetContext = buildSafeDatasetContext({ headers, sampleRows, fieldMetadata });
  const allowedOperations = [
    "sum", "count", "avg", "min", "max",
    "filter", "date_between", "group_by", "sort", "limit",
    "subtract", "divide", "ratio",
  ];

  const questionBase = String(message || "").trim();
  const continuation = hints?.clarificationContinuation && typeof hints.clarificationContinuation === "object"
    ? hints.clarificationContinuation
    : null;
  let aiPlan;
  if (
    continuation?.plannerState
    && continuation?.resolvedValue
  ) {
    aiPlan = await continuePlanWithClarification({
      originalQuestion: continuation?.plannerState?.originalQuestion || questionBase,
      previousPlan: continuation?.plannerState?.partialPlan || null,
      clarificationField: continuation?.plannerState?.clarificationField || continuation?.field || "",
      clarificationValue: continuation?.resolvedValue || "",
      datasetContext,
      allowedOperations,
      runtime: hints?.runtime || null,
      conversationHistory: hints?.conversationHistory || [],
      memory: hints?.context || null,
      aiPlannerFollowupResponse: hints?.aiPlannerFollowupResponse || null,
    });
  } else {
    aiPlan = hints?.aiPlannerResponse || await generateStructuredCalculationPlan({
      question: message,
      datasetContext,
      allowedOperations,
      runtime: hints?.runtime || null,
      conversationHistory: hints?.conversationHistory || [],
    });
  }

  const auto = normalizeClarification(aiPlan);
  if (auto.autoResolved) {
    aiPlan = await continuePlanWithClarification({
      originalQuestion: questionBase,
      previousPlan: aiPlan,
      clarificationField: auto.field,
      clarificationValue: auto.value,
      datasetContext,
      allowedOperations,
      runtime: hints?.runtime || null,
      conversationHistory: hints?.conversationHistory || [],
      memory: hints?.context || null,
      aiPlannerFollowupResponse: hints?.aiPlannerFollowupResponse || null,
    });
  }

  let validation = validateCalculationPlan(aiPlan, datasetContext, { allowed_columns: headers });
  if (!validation.ok && !hints?.aiPlannerResponse) {
    const detailText = Array.isArray(validation.details) && validation.details.length
      ? `Validation details: ${validation.details.join(", ")}`
      : "";
    aiPlan = await generateStructuredCalculationPlan({
      question: [
        "The previous AI plan was rejected by backend validator.",
        `Validation code: ${String(validation.code || validation.reason || "invalid_plan")}`,
        detailText,
        `Original question: ${questionBase}`,
        `Invalid plan: ${JSON.stringify(aiPlan)}`,
        "Return corrected strict JSON plan.",
      ].filter(Boolean).join("\n"),
      datasetContext,
      allowedOperations,
      runtime: hints?.runtime || null,
      conversationHistory: hints?.conversationHistory || [],
    });
    validation = validateCalculationPlan(aiPlan, datasetContext, { allowed_columns: headers });
  }
  if (!validation.ok) {
    if (String(validation.code || "") === "invalid_date_range") {
      return buildInvalidDateClarification(datasetContext);
    }
    return {
      ok: false,
      clarification_needed: false,
      reason: "ai_plan_validation_failed",
      message: `AI plan rejected by validator: ${String(validation.code || validation.reason || "invalid_plan")}.`,
      validation_details: Array.isArray(validation.details) ? validation.details : [],
    };
  }
  const plannerState = aiPlan?.status === "needs_clarification"
    ? {
      originalQuestion: questionBase,
      partialPlan: aiPlan,
      clarificationField: String(aiPlan?.clarification?.field || "").trim() || null,
    }
    : null;
  return toLegacyPlanFromAi({ aiPlan, plannerState, headers, sampleRows, fieldMetadata });
}
