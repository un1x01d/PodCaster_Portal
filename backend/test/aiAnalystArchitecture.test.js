import test from "node:test";
import assert from "node:assert/strict";

import { buildDeterministicSpreadsheetPlan } from "../src/services/ai/deterministicSpreadsheetPlannerV2.js";
import { executeDeterministicSpreadsheetPlan } from "../src/services/ai/deterministicSpreadsheetExecutor.js";
import { validateAiAnalysisPlan } from "../src/services/ai/aiAnalysisPlanValidator.js";
import { resolveClarificationReply } from "../src/services/ai/clarificationManager.js";
import { getConversationAnalysisMemory, storeConversationAnalysisMemory } from "../src/services/ai/conversationAnalysisMemory.js";
import { explainDeterministicResults } from "../src/services/ai/resultExplanationService.js";

test("planner path uses AI response for YoY question without local intent parsing", async () => {
  const aiPlannerResponse = {
    status: "ready",
    intent_summary: "YoY net revenue",
    confidence: "high",
    analysis_plan: {
      analysis_type: "trend",
      steps: [{
        step_id: "s1",
        operation: "year_over_year",
        metric: { column: "Net Revenue", aggregation: "sum" },
        metrics: [],
        driver_columns: [],
        dimension: null,
        date_column: "Date",
        filters: [],
        baseline_range: null,
        comparison_range: null,
        time_range: ["2022-01-01", "2024-12-31"],
        grain: "year",
        group_by: [],
        sort: null,
        limit: null,
      }],
      final_response_instruction: { style: "business_explanation", include_tables: true, include_causation_warning: true },
    },
    clarification: null,
    not_answerable: null,
    warnings: [],
  };

  const plan = await buildDeterministicSpreadsheetPlan({
    message: "year over year net revenue",
    headers: ["Date", "Net Revenue"],
    sampleRows: [{ Date: "2022-01-10", "Net Revenue": 10 }],
    hints: { aiPlannerResponse },
  });

  assert.equal(plan.ok, true);
  assert.equal(plan.operation, "multi_step_analysis");
  assert.equal(plan.analysisPlan.steps[0].operation, "year_over_year");
});

test("validator rejects unknown and unauthorized-like columns", () => {
  const plan = {
    status: "ready",
    intent_summary: "",
    confidence: "medium",
    analysis_plan: {
      analysis_type: "single_metric",
      steps: [{ step_id: "a", operation: "aggregate", metric: { column: "Secret Margin", aggregation: "sum" }, metrics: [], driver_columns: [], dimension: null, date_column: null, filters: [], baseline_range: null, comparison_range: null, time_range: null, grain: "none", group_by: [], sort: null, limit: null }],
      final_response_instruction: { style: "business_explanation", include_tables: true, include_causation_warning: true },
    },
    clarification: null,
    not_answerable: null,
    warnings: [],
  };
  const out = validateAiAnalysisPlan({
    plan,
    datasetProfile: { columns: [{ name: "Date" }, { name: "Net Revenue" }] },
    allowedOperations: ["aggregate"],
  });
  assert.equal(out.ok, false);
  assert.match(out.details.join("|"), /unknown_column/i);
});

test("validator rejects invalid ISO date", () => {
  const plan = {
    status: "ready",
    intent_summary: "",
    confidence: "medium",
    analysis_plan: {
      analysis_type: "comparison",
      steps: [{ step_id: "a", operation: "period_delta", metric: { column: "Net Income", aggregation: "sum" }, metrics: [], driver_columns: [], dimension: null, date_column: "Date", filters: [], baseline_range: ["2023-02-29", "2023-12-31"], comparison_range: ["2024-01-01", "2024-12-31"], time_range: null, grain: "year", group_by: [], sort: null, limit: null }],
      final_response_instruction: { style: "business_explanation", include_tables: true, include_causation_warning: true },
    },
    clarification: null,
    not_answerable: null,
    warnings: [],
  };
  const out = validateAiAnalysisPlan({
    plan,
    datasetProfile: { columns: [{ name: "Date" }, { name: "Net Income" }] },
    allowedOperations: ["period_delta"],
  });
  assert.equal(out.ok, false);
  assert.match(out.details.join("|"), /invalid_date_range/);
});

test("clarification resolver maps numeric and label replies", () => {
  const pending = { options: [{ value: "Revenue Total" }, { value: "Net Revenue" }] };
  assert.equal(resolveClarificationReply(pending, "2"), "Net Revenue");
  assert.equal(resolveClarificationReply(pending, "the second one"), "Net Revenue");
  assert.equal(resolveClarificationReply(pending, "Net Revenue"), "Net Revenue");
});

test("year-over-year execution produces rows and divide-by-zero percent as null", () => {
  const plan = {
    ok: true,
    operation: "multi_step_analysis",
    metric: "Net Revenue",
    analysisPlan: {
      analysis_type: "trend",
      steps: [{
        step_id: "s1", operation: "year_over_year", metric: { column: "Net Revenue", aggregation: "sum" }, metrics: [], driver_columns: [], dimension: null,
        date_column: "Date", filters: [], baseline_range: null, comparison_range: null, time_range: ["2022-01-01", "2024-12-31"], grain: "year", group_by: [], sort: null, limit: null,
      }],
    },
  };
  const rows = [
    { Date: "2022-03-01", "Net Revenue": 0 },
    { Date: "2023-03-01", "Net Revenue": 100 },
    { Date: "2024-03-01", "Net Revenue": 200 },
  ];
  const out = executeDeterministicSpreadsheetPlan({ plan, rows, filters: [], userContext: {} });
  assert.equal(out.ok, true);
  assert.equal(out.outputType, "yoy_table");
  assert.equal(Array.isArray(out.rows), true);
  const y2023 = out.rows.find((r) => r.year === 2023);
  assert.equal(y2023.percent_change, null);
});

test("ranking with year grain returns top-N per year", () => {
  const plan = {
    ok: true,
    operation: "multi_step_analysis",
    metric: "Net Revenue",
    analysisPlan: {
      analysis_type: "ranking",
      steps: [{
        step_id: "s_rank_year",
        operation: "ranking",
        metric: { column: "Net Revenue", aggregation: "sum" },
        metrics: [],
        driver_columns: [],
        dimension: "Customer",
        date_column: "Date",
        filters: [],
        baseline_range: null,
        comparison_range: null,
        time_range: null,
        grain: "year",
        group_by: ["Customer"],
        sort: { by: "value", direction: "desc" },
        limit: 2,
      }],
    },
  };
  const rows = [
    { Date: "2023-01-05", Customer: "A", "Net Revenue": 100 },
    { Date: "2023-01-06", Customer: "B", "Net Revenue": 80 },
    { Date: "2023-01-07", Customer: "C", "Net Revenue": 60 },
    { Date: "2024-02-05", Customer: "A", "Net Revenue": 70 },
    { Date: "2024-02-06", Customer: "B", "Net Revenue": 140 },
    { Date: "2024-02-07", Customer: "C", "Net Revenue": 120 },
  ];
  const out = executeDeterministicSpreadsheetPlan({ plan, rows, filters: [], userContext: {} });
  assert.equal(out.ok, true);
  assert.equal(out.outputType, "ranking");
  assert.equal(Array.isArray(out.rows_by_year), true);
  assert.equal(out.rows_by_year.length, 2);
  assert.deepEqual(out.rows_by_year[0].top_ranked.map((r) => r.label), ["A", "B"]);
  assert.deepEqual(out.rows_by_year[1].top_ranked.map((r) => r.label), ["B", "C"]);
  assert.equal(Number.isFinite(Number(out.rows_by_year[0].year_total_value)), true);
  assert.equal(Number.isFinite(Number(out.rows_by_year[1].top_ranked[0].share_of_year_percent)), true);
  assert.equal(out.rows_by_year[1].top_ranked[0].percent_change > 0, true);
});

test("period delta by dimension excludes zero-impact rows", () => {
  const plan = {
    ok: true,
    operation: "multi_step_analysis",
    metric: "Net Revenue",
    analysisPlan: {
      analysis_type: "driver_analysis",
      steps: [{
        step_id: "s_dim_delta",
        operation: "period_delta_by_dimension",
        metric: { column: "Net Revenue", aggregation: "sum" },
        metrics: [],
        driver_columns: [],
        dimension: "Customer",
        date_column: "Date",
        filters: [],
        baseline_range: ["2023-01-01", "2023-12-31"],
        comparison_range: ["2024-01-01", "2024-12-31"],
        time_range: null,
        grain: "year",
        group_by: ["Customer"],
        sort: { by: "value", direction: "desc" },
        limit: 10,
      }],
    },
  };
  const rows = [
    { Date: "2023-01-10", Customer: "A", "Net Revenue": 100 },
    { Date: "2024-02-10", Customer: "A", "Net Revenue": 100 },
    { Date: "2023-03-10", Customer: "B", "Net Revenue": 20 },
    { Date: "2024-04-10", Customer: "B", "Net Revenue": 55 },
    { Date: "2023-05-10", Customer: "C", "Net Revenue": 30 },
  ];
  const out = executeDeterministicSpreadsheetPlan({ plan, rows, filters: [], userContext: {} });
  assert.equal(out.ok, true);
  assert.equal(Array.isArray(out.rows), true);
  assert.equal(out.rows.some((r) => r.label === "A"), false);
  assert.equal(out.rows.some((r) => r.label === "B"), true);
  assert.equal(out.rows.some((r) => r.label === "C"), true);
});

test("period delta memory stores compact analysis summary", async () => {
  const memory = {
    last_successful_analysis: {
      user_question: "difference in net income between 2022 and 2023",
      analysis_type: "comparison",
      metrics: [{ column: "Net Income", aggregation: "sum", business_concept: "net_income" }],
      date_column: "Date",
      periods: {
        baseline: { label: "2022", start: "2022-01-01", end: "2022-12-31", value: "757082.16" },
        comparison: { label: "2023", start: "2023-01-01", end: "2023-12-31", value: "1294973.17" },
      },
      result_summary: { absolute_change: "537891.01", percent_change: "71.05" },
      columns_used: ["Date", "Net Income"],
    },
  };
  await storeConversationAnalysisMemory({ tenantId: 1, userId: 7, sheetId: 11, memory });
  const loaded = await getConversationAnalysisMemory({ tenantId: 1, userId: 7, sheetId: 11 });
  assert.equal(loaded.last_successful_analysis.metrics[0].column, "Net Income");
});

test("explanation layer uses computed values and includes causation warning for drivers", () => {
  const answer = explainDeterministicResults({
    question: "what caused the change",
    computed: {
      ok: true,
      outputType: "drivers",
      base_change: 120,
      top_positive: [{ label: "Region A", delta: 80 }],
      top_negative: [{ label: "Region B", delta: -20 }],
    },
  });
  assert.match(answer, /measurable spreadsheet drivers, not guaranteed causation/i);
  assert.match(answer, /120|Region A|Region B/i);
});
