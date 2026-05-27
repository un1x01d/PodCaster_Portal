import { buildWorkbookProfile } from "./workbookProfiler.js";
import { buildSemanticCandidateHints } from "./semanticCandidateProvider.js";
import { buildAiPlanningContext } from "./aiPlanningContextBuilder.js";
import { callAiAnalystPlanner } from "./aiAnalystPlannerClient.js";
import { validateAiAnalysisPlan } from "./aiAnalysisPlanValidator.js";
import { repairPlanOnce } from "./planRepairService.js";
import { parseAiAnalysisPlan } from "./aiAnalysisPlanSchema.js";

function makeClarification(question, options = [], field = "") {
  return {
    ok: false,
    clarification_needed: true,
    reason: "ai_needs_clarification",
    clarification_question: String(question || "I can answer that, but I need one clarification first."),
    clarification_options: Array.isArray(options) ? options.map((o) => String(o?.value || o?.label || o)).filter(Boolean) : [],
    clarification_field: String(field || "").trim() || null,
  };
}

function buildDimensionClarificationFromDataset(dataset = {}) {
  const cols = Array.isArray(dataset?.columns) ? dataset.columns : [];
  const options = cols
    .filter((c) => String(c?.type_guess || "").toLowerCase() === "category")
    .map((c) => String(c?.name || "").trim())
    .filter(Boolean)
    .slice(0, 8);
  if (!options.length) return null;
  return makeClarification(
    "Which business dimension should be used for driver analysis?",
    options,
    "dimension"
  );
}

function pickDefaultDriverDimension(dataset = {}) {
  const cols = Array.isArray(dataset?.columns) ? dataset.columns : [];
  const preferred = ["account group", "account", "region", "product line", "business unit", "customer segment"];
  for (const key of preferred) {
    const hit = cols.find((c) => String(c?.name || "").toLowerCase() === key || String(c?.name || "").toLowerCase().includes(key));
    if (hit && String(hit?.type_guess || "").toLowerCase() === "category") return String(hit.name);
  }
  const firstCategory = cols.find((c) => String(c?.type_guess || "").toLowerCase() === "category");
  return firstCategory ? String(firstCategory.name) : null;
}

function ensureYoYDriverStep(plan = null, dataset = {}) {
  if (!plan || plan?.status !== "ready" || !plan?.analysis_plan) return plan;
  const steps = Array.isArray(plan.analysis_plan.steps) ? plan.analysis_plan.steps : [];
  if (!steps.length) return plan;

  const hasYoY = steps.some((s) => String(s?.operation || "") === "year_over_year");
  if (!hasYoY) return plan;

  const hasDriver = steps.some((s) => ["period_delta_by_dimension", "period_driver_delta", "ranking"].includes(String(s?.operation || "")));
  if (hasDriver) return plan;

  const yoyStep = steps.find((s) => String(s?.operation || "") === "year_over_year");
  const dimension = pickDefaultDriverDimension(dataset);
  if (!dimension || !yoyStep?.metric?.column || !yoyStep?.date_column) return plan;

  const next = JSON.parse(JSON.stringify(plan));
  next.analysis_plan.steps.push({
    step_id: `step_driver_auto_${next.analysis_plan.steps.length + 1}`,
    operation: "period_delta_by_dimension",
    metric: { column: String(yoyStep.metric.column), aggregation: String(yoyStep.metric.aggregation || "sum") },
    metrics: [],
    driver_columns: [],
    dimension: String(dimension),
    date_column: String(yoyStep.date_column),
    filters: Array.isArray(yoyStep.filters) ? yoyStep.filters : [],
    baseline_range: null,
    comparison_range: null,
    time_range: Array.isArray(yoyStep.time_range) ? yoyStep.time_range : null,
    grain: "year",
    group_by: [String(dimension)],
    sort: { by: "metric", direction: "desc" },
    limit: 1,
  });
  return next;
}

function buildSafeYoYFallbackPlan({ originalPlan, dataset, question = "" }) {
  const q = String(question || "").toLowerCase();
  if (!(q.includes("year over year") || q.includes("yoy") || q.includes("рік-до-року") || q.includes("год-к-году"))) return null;

  const cols = Array.isArray(dataset?.columns) ? dataset.columns : [];
  const dateCol = cols.find((c) => String(c?.type_guess || "").toLowerCase() === "date")?.name
    || cols.find((c) => Number(c?.profile?.date_like_ratio || 0) >= 0.4)?.name
    || null;
  const metricCol = cols.find((c) => String(c?.name || "").toLowerCase().includes("net revenue"))?.name
    || cols.find((c) => String(c?.name || "").toLowerCase().includes("revenue"))?.name
    || cols.find((c) => String(c?.type_guess || "").toLowerCase() === "number")?.name
    || null;

  if (!dateCol || !metricCol) return null;

  const years = cols.find((c) => String(c?.name || "") === dateCol)?.profile || null;
  const timeRange = years?.min_sample && years?.max_sample ? [String(years.min_sample), String(years.max_sample)] : null;

  return {
    status: "ready",
    intent_summary: String(originalPlan?.intent_summary || "YoY analysis"),
    confidence: String(originalPlan?.confidence || "medium"),
    analysis_plan: {
      analysis_type: "trend",
      steps: (() => {
        const baseSteps = [{
          step_id: "step_yoy_fallback_1",
          operation: "year_over_year",
          metric: { column: String(metricCol), aggregation: "sum" },
          metrics: [],
          driver_columns: [],
          dimension: null,
          date_column: String(dateCol),
          filters: [],
          baseline_range: null,
          comparison_range: null,
          time_range: Array.isArray(timeRange) ? timeRange : null,
          grain: "year",
          group_by: [],
          sort: null,
          limit: null,
        }];
        const dimension = pickDefaultDriverDimension(dataset);
        if (dimension) {
          baseSteps.push({
            step_id: "step_yoy_fallback_driver_2",
            operation: "period_delta_by_dimension",
            metric: { column: String(metricCol), aggregation: "sum" },
            metrics: [],
            driver_columns: [],
            dimension: String(dimension),
            date_column: String(dateCol),
            filters: [],
            baseline_range: null,
            comparison_range: null,
            time_range: Array.isArray(timeRange) ? timeRange : null,
            grain: "year",
            group_by: [String(dimension)],
            sort: { by: "metric", direction: "desc" },
            limit: 1,
          });
        }
        return baseSteps;
      })(),
      final_response_instruction: { style: "business_explanation", include_tables: true, include_causation_warning: true },
    },
    clarification: null,
    not_answerable: null,
    warnings: ["yoy_safe_fallback_used"],
  };
}

function normalizePlanForValidation({ plan, validation }) {
  if (!plan || plan?.status !== "ready") return plan;
  const details = Array.isArray(validation?.details) ? validation.details : [];
  if (!details.length) return plan;

  const cloned = JSON.parse(JSON.stringify(plan));
  const byStep = new Map((cloned?.analysis_plan?.steps || []).map((s) => [String(s?.step_id || ""), s]));

  for (const d of details) {
    const msg = String(d || "");

    const nonNumericDriver = msg.match(/^non_numeric_driver_column:([^:]+):/);
    if (nonNumericDriver) {
      const stepId = nonNumericDriver[1];
      const step = byStep.get(stepId);
      if (step && String(step.operation || "") === "period_driver_delta") {
        const drivers = Array.isArray(step.driver_columns) ? step.driver_columns.filter(Boolean) : [];
        const dimension = String(step.dimension || drivers[0] || "").trim();
        if (dimension) {
          step.operation = "period_delta_by_dimension";
          step.dimension = dimension;
          step.group_by = Array.isArray(step.group_by) && step.group_by.length ? step.group_by : [dimension];
          step.driver_columns = [];
        }
      }
      continue;
    }

    const missingDrivers = msg.match(/^missing_driver_columns:([^:]+)$/);
    if (missingDrivers) {
      const stepId = missingDrivers[1];
      const step = byStep.get(stepId);
      if (step && String(step.operation || "") === "period_driver_delta") {
        const dimension = String(step.dimension || (Array.isArray(step.group_by) ? step.group_by[0] : "") || "").trim();
        if (dimension) {
          step.operation = "period_delta_by_dimension";
          step.group_by = Array.isArray(step.group_by) && step.group_by.length ? step.group_by : [dimension];
          step.dimension = dimension;
          step.driver_columns = [];
        } else {
          step.operation = "year_over_year";
          step.driver_columns = [];
          step.group_by = [];
          step.dimension = null;
        }
      }
      continue;
    }

    const missingRanges = msg.match(/^period_driver_delta_missing_ranges:([^:]+)$/);
    if (missingRanges) {
      const stepId = missingRanges[1];
      const step = byStep.get(stepId);
      if (step && String(step.operation || "") === "period_driver_delta") {
        const tr = Array.isArray(step.time_range) ? step.time_range : null;
        if (tr && tr.length === 2) {
          step.operation = "year_over_year";
          step.driver_columns = [];
          step.group_by = [];
          step.dimension = null;
          step.baseline_range = null;
          step.comparison_range = null;
        }
      }
      continue;
    }

    const nonDate = msg.match(/^non_date_column_for_date_operation:([^:]+):(.+)$/);
    if (nonDate) {
      const stepId = nonDate[1];
      const step = byStep.get(stepId);
      if (!step) continue;
      const fallbackDate = (cloned?.analysis_plan?.steps || [])
        .map((s) => String(s?.date_column || "").trim())
        .find(Boolean);
      if (fallbackDate) step.date_column = fallbackDate;
    }
  }

  return cloned;
}


export async function buildDeterministicSpreadsheetPlan({
  message = "",
  headers = [],
  semanticProfile = {},
  sampleRows = [],
  hints = {},
}) {
  const question = String(message || "").trim();
  if (!question) {
    return {
      ok: false,
      clarification_needed: false,
      reason: "empty_question",
      message: "Please ask a question about this spreadsheet.",
    };
  }

  const dataset = buildWorkbookProfile({
    workbookId: hints?.sheetId || "sheet",
    sheetId: hints?.sheetId || "sheet",
    sheetName: hints?.activeTab || "Sheet",
    headers,
    rows: sampleRows,
    allowedColumns: headers,
  });

  const semanticCandidates = await buildSemanticCandidateHints({
    headers,
    question,
    profile: semanticProfile,
    groupId: hints?.groupId || null,
  });

  const planningContext = buildAiPlanningContext({
    question,
    dataset,
    semanticCandidates,
    knownMappings: semanticProfile?.headerMappings || {},
    memory: hints?.context || { last_successful_analysis: null },
  });

  let aiPlan = await callAiAnalystPlanner({
    planningContext,
    runtime: hints?.runtime || null,
    conversationHistory: hints?.conversationHistory || [],
    aiPlannerResponse: hints?.aiPlannerResponse || null,
  });

  const rawPlannerPlan = aiPlan;
  const parsed = parseAiAnalysisPlan(aiPlan);
  aiPlan = parsed.plan;

  if (!parsed.ok && !hints?.aiPlannerResponse) {
    const repairedFromSchema = await repairPlanOnce({
      planner: async ({ question: repairQuestion }) => callAiAnalystPlanner({
        planningContext: { ...planningContext, question: repairQuestion },
        runtime: hints?.runtime || null,
        conversationHistory: hints?.conversationHistory || [],
        aiPlannerResponse: hints?.aiPlannerFollowupResponse || null,
      }),
      planningContext,
      invalidPlan: rawPlannerPlan,
      validation: { details: parsed.errors || ["schema_validation_failed"] },
    });
    if (repairedFromSchema?.checked?.ok) {
      aiPlan = repairedFromSchema.repaired;
    }
  }

  let validation = validateAiAnalysisPlan({
    plan: aiPlan,
    datasetProfile: dataset,
    allowedOperations: planningContext.allowed_operations,
  });

  if (!validation.ok && aiPlan?.status === "ready") {
    const normalizedPlan = normalizePlanForValidation({ plan: aiPlan, validation });
    if (normalizedPlan !== aiPlan) {
      const normalizedValidation = validateAiAnalysisPlan({
        plan: normalizedPlan,
        datasetProfile: dataset,
        allowedOperations: planningContext.allowed_operations,
      });
      if (normalizedValidation.ok) {
        aiPlan = normalizedPlan;
        validation = normalizedValidation;
      }
    }
  }

  if (!validation.ok && !hints?.aiPlannerResponse) {
    const repaired = await repairPlanOnce({
      planner: async ({ question: repairQuestion }) => callAiAnalystPlanner({
        planningContext: { ...planningContext, question: repairQuestion },
        runtime: hints?.runtime || null,
        conversationHistory: hints?.conversationHistory || [],
        aiPlannerResponse: hints?.aiPlannerFollowupResponse || null,
      }),
      planningContext,
      invalidPlan: aiPlan,
      validation,
    });
    aiPlan = repaired.repaired;
    validation = repaired.checked;

    if (!validation.ok && aiPlan?.status === "ready") {
      const normalizedPlan = normalizePlanForValidation({ plan: aiPlan, validation });
      const normalizedValidation = validateAiAnalysisPlan({
        plan: normalizedPlan,
        datasetProfile: dataset,
        allowedOperations: planningContext.allowed_operations,
      });
      if (normalizedValidation.ok) {
        aiPlan = normalizedPlan;
        validation = normalizedValidation;
      }
    }
  }

  if (!validation.ok) {
    const details = Array.isArray(validation?.details) ? validation.details : [];
    if (details.some((d) => String(d).startsWith("date_like_dimension_not_allowed:"))) {
      const clarification = buildDimensionClarificationFromDataset(dataset);
      if (clarification) return clarification;
    }

    const yoyFallback = buildSafeYoYFallbackPlan({ originalPlan: aiPlan, dataset, question });
    if (yoyFallback) {
      const yoyValidation = validateAiAnalysisPlan({
        plan: yoyFallback,
        datasetProfile: dataset,
        allowedOperations: planningContext.allowed_operations,
      });
      if (yoyValidation.ok) {
        aiPlan = yoyFallback;
        validation = yoyValidation;
      }
    }

    if (!validation.ok) {
      return {
        ok: false,
        clarification_needed: false,
        reason: "ai_plan_validation_failed",
        message: `AI plan rejected by validator: ${String(validation.code || "invalid_plan")}.`,
        validation_details: validation.details || [],
      };
    }
  }

  if (validation.ok && aiPlan?.status === "ready") {
    const withDriver = ensureYoYDriverStep(aiPlan, dataset);
    if (withDriver !== aiPlan) {
      const v2 = validateAiAnalysisPlan({
        plan: withDriver,
        datasetProfile: dataset,
        allowedOperations: planningContext.allowed_operations,
      });
      if (v2.ok) {
        aiPlan = withDriver;
        validation = v2;
      }
    }
  }

  if (aiPlan.status === "needs_clarification") {
    const options = Array.isArray(aiPlan?.clarification?.options) ? aiPlan.clarification.options : [];
    if (options.length === 1) {
      return {
        ok: false,
        clarification_needed: true,
        reason: "auto_resolve_single_option",
        clarification_question: String(aiPlan?.clarification?.question || ""),
        clarification_options: [String(options[0]?.value || options[0]?.label || "")],
        clarification_field: String(aiPlan?.clarification?.field || ""),
        planner_state: {
          originalQuestion: question,
          partialPlan: aiPlan,
          clarificationField: String(aiPlan?.clarification?.field || "").trim() || null,
        },
      };
    }
    return makeClarification(aiPlan?.clarification?.question, options, aiPlan?.clarification?.field);
  }

  if (aiPlan.status === "not_answerable") {
    return {
      ok: false,
      clarification_needed: false,
      reason: "ai_not_answerable",
      message: String(aiPlan?.not_answerable?.reason || "This dataset cannot answer that safely."),
    };
  }

  return {
    ok: true,
    operation: "multi_step_analysis",
    metric: String(aiPlan?.analysis_plan?.steps?.[0]?.metric?.column || "value"),
    analysisPlan: aiPlan.analysis_plan,
    aiPlan,
    datasetProfile: dataset,
    verification: {
      method: "ai_analyst_planner_v3",
      confidence: aiPlan?.confidence === "high" ? 0.95 : (aiPlan?.confidence === "medium" ? 0.82 : 0.7),
      fallback_used: false,
      evidence: { steps: aiPlan?.analysis_plan?.steps?.length || 0, analysis_type: aiPlan?.analysis_plan?.analysis_type || null },
    },
  };
}
