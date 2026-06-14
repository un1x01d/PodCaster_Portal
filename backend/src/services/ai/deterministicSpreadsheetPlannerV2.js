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

function pickColumnByPatterns(columns = [], patterns = []) {
  const list = Array.isArray(columns) ? columns : [];
  for (const p of Array.isArray(patterns) ? patterns : []) {
    const hit = list.find((name) => p.test(String(name || "")));
    if (hit) return String(hit);
  }
  return null;
}

function pickBestNumericColumn(dataset = null, patterns = []) {
  const cols = Array.isArray(dataset?.columns) ? dataset.columns : [];
  const names = cols.map((c) => String(c?.name || "")).filter(Boolean);
  const byPattern = pickColumnByPatterns(names, patterns);
  if (byPattern) return byPattern;
  const numeric = cols.find((c) => {
    const guess = String(c?.type_guess || "").toLowerCase();
    const ratio = Number(c?.profile?.number_like_ratio || 0);
    return guess === "number" || ratio >= 0.5;
  });
  return String(numeric?.name || "").trim() || null;
}

function parseYearFromValue(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value >= 1900 && value <= 2200) return Math.floor(value);
    if (value > 20000 && value < 80000) {
      const excelEpoch = Date.UTC(1899, 11, 30);
      const d = new Date(excelEpoch + Math.round(value * 86400000));
      if (!Number.isNaN(d.getTime())) return d.getUTCFullYear();
    }
  }
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d{4}$/.test(raw)) return Number(raw);
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.getUTCFullYear();
}

function inferLatestCompleteVsPriorRanges({ rows = [], dateColumn = "" }) {
  const col = String(dateColumn || "").trim();
  if (!col) return null;
  const years = Array.from(new Set(
    (Array.isArray(rows) ? rows : [])
      .map((r) => parseYearFromValue(r?.[col]))
      .filter((y) => Number.isFinite(y) && y >= 1900 && y <= 2200)
  )).sort((a, b) => a - b);
  if (!years.length) return null;

  const currentYear = new Date().getUTCFullYear();
  const completeCandidates = years.filter((y) => y < currentYear);
  const latest = completeCandidates.length ? completeCandidates[completeCandidates.length - 1] : years[years.length - 1];
  const prior = years.includes(latest - 1)
    ? latest - 1
    : years.filter((y) => y < latest).slice(-1)[0];
  if (!Number.isFinite(prior)) return null;

  return {
    latestYear: latest,
    priorYear: prior,
    latestRange: [`${latest}-01-01`, `${latest}-12-31`],
    priorRange: [`${prior}-01-01`, `${prior}-12-31`],
  };
}

function isNetIncomeDriverConcentrationIntent(question = "") {
  const q = String(question || "").toLowerCase();
  const hasNetIncome = /(net\s*income|net\s*profit|прибут|чистий\s*прибуток|чистая\s*прибыль)/i.test(q);
  const hasDriver = /(top\s*\d+\s*drivers?|drivers?|variance|change|decomposition|вплив|драйвер|драйверы)/i.test(q);
  const hasConcentration = /(concentration|share|> ?15%|15%|customer\s*risk|dependency|концентрац|частк|ризик)/i.test(q);
  const hasPriorYear = /(prior\s*year|vs\s*prior\s*year|year\s*over\s*year|yoy|минулий\s*рік|попередній\s*рік)/i.test(q);
  return hasNetIncome && hasDriver && hasConcentration && hasPriorYear;
}

function buildNetIncomeDriverConcentrationFallbackPlan({ question = "", dataset = null, semanticProfile = {}, rows = [] }) {
  if (!isNetIncomeDriverConcentrationIntent(question)) return null;

  const cols = (Array.isArray(dataset?.columns) ? dataset.columns : []).map((c) => String(c?.name || "")).filter(Boolean);
  if (!cols.length) return null;
  const dateColumn = findBestDateColumn({ dataset, semanticProfile, steps: [] });
  if (!dateColumn) return null;

  const period = inferLatestCompleteVsPriorRanges({ rows, dateColumn });
  if (!period?.latestRange || !period?.priorRange) return null;

  const netIncomeColumn = pickBestNumericColumn(dataset, [
    /net\s*income/i,
    /net\s*profit/i,
    /^profit$/i,
    /profit/i,
    /income/i,
  ]);
  const revenueColumn = pickBestNumericColumn(dataset, [
    /net\s*revenue/i,
    /revenue\s*total/i,
    /\brevenue\b/i,
    /\bsales\b/i,
  ]);
  const customerColumn = pickColumnByPatterns(cols, [
    /^customer$/i,
    /customer\s*name/i,
    /customer/i,
    /client/i,
    /account/i,
  ]);

  if (!netIncomeColumn || !revenueColumn || !customerColumn) return null;

  return {
    status: "ready",
    intent_summary: "Deterministic fallback: net income drivers and customer concentration risk",
    confidence: "medium",
    analysis_plan: {
      analysis_type: "driver_analysis",
      steps: [
        {
          step_id: "fallback_period_delta_net_income",
          operation: "period_delta",
          metric: { column: netIncomeColumn, aggregation: "sum" },
          metrics: [],
          driver_columns: [],
          dimension: null,
          date_column: dateColumn,
          filters: [],
          baseline_range: period.priorRange,
          comparison_range: period.latestRange,
          time_range: null,
          grain: "year",
          group_by: [],
          sort: null,
          limit: null,
        },
        {
          step_id: "fallback_top3_net_income_drivers_customer",
          operation: "period_delta_by_dimension",
          metric: { column: netIncomeColumn, aggregation: "sum" },
          metrics: [],
          driver_columns: [],
          dimension: customerColumn,
          date_column: dateColumn,
          filters: [],
          baseline_range: period.priorRange,
          comparison_range: period.latestRange,
          time_range: null,
          grain: "year",
          group_by: [customerColumn],
          sort: { by: "value", direction: "desc" },
          limit: 3,
        },
        {
          step_id: "fallback_customer_concentration_risk",
          operation: "ranking",
          metric: { column: revenueColumn, aggregation: "sum" },
          metrics: [],
          driver_columns: [],
          dimension: customerColumn,
          date_column: dateColumn,
          filters: [],
          baseline_range: null,
          comparison_range: null,
          time_range: period.priorRange[0] <= period.latestRange[1] ? [period.priorRange[0], period.latestRange[1]] : null,
          grain: "year",
          group_by: [customerColumn],
          sort: { by: "value", direction: "desc" },
          limit: 25,
        },
      ],
      final_response_instruction: { style: "business_explanation", include_tables: true, include_causation_warning: true },
    },
    clarification: null,
    not_answerable: null,
    warnings: ["deterministic_intent_fallback_applied"],
  };
}

function hasPerYearRankingIntent(question = "") {
  const q = String(question || "").toLowerCase();
  return /(for every year|each year|per year|by year|every year|for each year|по роках|кожен рік|каждый год|по годам)/i.test(q);
}

function findBestDateColumn({ dataset = null, semanticProfile = {}, steps = [] }) {
  const datasetColumns = Array.isArray(dataset?.columns) ? dataset.columns : [];
  const names = datasetColumns.map((c) => String(c?.name || "")).filter(Boolean);
  if (!names.length) return null;
  const namesLower = new Set(names.map((n) => n.toLowerCase()));

  for (const step of Array.isArray(steps) ? steps : []) {
    const op = String(step?.operation || "").toLowerCase();
    const c = String(step?.date_column || "").trim();
    if (!c) continue;
    if (!namesLower.has(c.toLowerCase())) continue;
    if (["year_over_year", "period_delta", "period_driver_delta", "period_delta_by_dimension", "trend"].includes(op)) {
      return c;
    }
  }

  const semanticDate = String(semanticProfile?.defaults?.dateColumn || "").trim();
  if (semanticDate && namesLower.has(semanticDate.toLowerCase())) return semanticDate;

  const dateLike = datasetColumns.find((c) => {
    const guess = String(c?.type_guess || "").toLowerCase();
    const ratio = Number(c?.profile?.date_like_ratio || 0);
    return guess === "date" || ratio >= 0.4;
  });
  if (String(dateLike?.name || "").trim()) return String(dateLike.name);

  const byName = names.find((n) => /\b(date|month|quarter|year|period)\b/i.test(n));
  return byName || null;
}

function applyDeterministicPlanHeuristics({ question = "", plan = null, dataset = null, semanticProfile = {} }) {
  const p = plan && typeof plan === "object" ? plan : null;
  if (!p || String(p.status || "") !== "ready") return p;
  const steps = Array.isArray(p?.analysis_plan?.steps) ? p.analysis_plan.steps : [];
  if (!steps.length) return p;

  if (hasPerYearRankingIntent(question)) {
    const bestDate = findBestDateColumn({ dataset, semanticProfile, steps });
    for (const step of steps) {
      if (String(step?.operation || "").toLowerCase() !== "ranking") continue;
      if (!step.date_column && bestDate) step.date_column = bestDate;
      if (!step.grain || String(step.grain).toLowerCase() === "none") step.grain = "year";
    }
  }
  return p;
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
  aiPlan = applyDeterministicPlanHeuristics({ question, plan: aiPlan, dataset, semanticProfile });

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
      aiPlan = applyDeterministicPlanHeuristics({ question, plan: aiPlan, dataset, semanticProfile });
    }
  }

  let validation = validateAiAnalysisPlan({
    plan: aiPlan,
    datasetProfile: dataset,
    allowedOperations: planningContext.allowed_operations,
  });

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
    aiPlan = applyDeterministicPlanHeuristics({ question, plan: aiPlan, dataset, semanticProfile });
    validation = validateAiAnalysisPlan({
      plan: aiPlan,
      datasetProfile: dataset,
      allowedOperations: planningContext.allowed_operations,
    });
  }

  if (!validation.ok && !hints?.aiPlannerResponse) {
    const fallbackPlan = buildNetIncomeDriverConcentrationFallbackPlan({
      question,
      dataset,
      semanticProfile,
      rows: sampleRows,
    });
    if (fallbackPlan) {
      aiPlan = applyDeterministicPlanHeuristics({ question, plan: fallbackPlan, dataset, semanticProfile });
      validation = validateAiAnalysisPlan({
        plan: aiPlan,
        datasetProfile: dataset,
        allowedOperations: planningContext.allowed_operations,
      });
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
