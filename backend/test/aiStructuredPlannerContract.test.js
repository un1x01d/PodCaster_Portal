import test from "node:test";
import assert from "node:assert/strict";

import { validateAiAnalysisPlan } from "../src/services/ai/aiAnalysisPlanValidator.js";
import { buildDeterministicSpreadsheetPlan } from "../src/services/ai/deterministicSpreadsheetPlannerV2.js";

const datasetProfile = {
  columns: [
    { name: "Transaction Date", type_guess: "date", profile: { date_like_ratio: 1, number_like_ratio: 0 } },
    { name: "Net Revenue", type_guess: "number", profile: { date_like_ratio: 0, number_like_ratio: 1 } },
    { name: "Region", type_guess: "category", profile: { date_like_ratio: 0, number_like_ratio: 0 } },
  ],
};
const allowedOperations = ["aggregate", "period_delta", "year_over_year", "period_driver_delta", "period_delta_by_dimension", "ranking", "trend", "ratio", "margin", "variance"];

function readyPlan(step) {
  return {
    status: "ready",
    intent_summary: "test plan",
    confidence: "high",
    analysis_plan: {
      analysis_type: "single_metric",
      steps: [step],
      final_response_instruction: { style: "business_explanation", include_tables: true, include_causation_warning: true },
    },
    clarification: null,
    not_answerable: null,
    warnings: [],
  };
}

test("analysis-plan validator accepts ready quarter plan with AI-provided dates", () => {
  const out = validateAiAnalysisPlan({
    plan: readyPlan({
      step_id: "s1",
      operation: "aggregate",
      metric: { column: "Net Revenue", aggregation: "sum" },
      metrics: [],
      driver_columns: [],
      dimension: null,
      date_column: null,
      filters: [{ column: "Transaction Date", operator: "between", value: ["2022-01-01", "2022-03-31"] }],
      baseline_range: null,
      comparison_range: null,
      time_range: null,
      grain: "none",
      group_by: [],
      sort: null,
      limit: null,
    }),
    datasetProfile,
    allowedOperations,
  });
  assert.equal(out.ok, true);
});

test("analysis-plan validator rejects unknown or unauthorized columns", () => {
  const out = validateAiAnalysisPlan({
    plan: readyPlan({
      step_id: "s1",
      operation: "aggregate",
      metric: { column: "Secret Revenue", aggregation: "sum" },
      metrics: [],
      driver_columns: [],
      dimension: null,
      date_column: null,
      filters: [],
      baseline_range: null,
      comparison_range: null,
      time_range: null,
      grain: "none",
      group_by: [],
      sort: null,
      limit: null,
    }),
    datasetProfile,
    allowedOperations,
  });
  assert.equal(out.ok, false);
  assert.match(out.details.join("|"), /unknown_column:Secret Revenue/);
});

test("analysis-plan validator rejects non-ISO date strings from planner", () => {
  const out = validateAiAnalysisPlan({
    plan: readyPlan({
      step_id: "s1",
      operation: "period_delta",
      metric: { column: "Net Revenue", aggregation: "sum" },
      metrics: [],
      driver_columns: [],
      dimension: null,
      date_column: "Transaction Date",
      filters: [],
      baseline_range: ["Q2 2022", "Q3 2023"],
      comparison_range: ["2023-01-01", "2023-12-31"],
      time_range: null,
      grain: "quarter",
      group_by: [],
      sort: null,
      limit: null,
    }),
    datasetProfile,
    allowedOperations,
  });
  assert.equal(out.ok, false);
  assert.match(out.details.join("|"), /invalid_date_range/);
});

test("analysis-plan validator rejects invalid leap date", () => {
  const out = validateAiAnalysisPlan({
    plan: readyPlan({
      step_id: "s1",
      operation: "period_delta",
      metric: { column: "Net Revenue", aggregation: "sum" },
      metrics: [],
      driver_columns: [],
      dimension: null,
      date_column: "Transaction Date",
      filters: [],
      baseline_range: ["2023-02-29", "2023-12-31"],
      comparison_range: ["2024-01-01", "2024-12-31"],
      time_range: null,
      grain: "year",
      group_by: [],
      sort: null,
      limit: null,
    }),
    datasetProfile,
    allowedOperations,
  });
  assert.equal(out.ok, false);
  assert.match(out.details.join("|"), /invalid_date_range/);
});

test("planner returns deterministic clarification state from AI status", async () => {
  const plan = await buildDeterministicSpreadsheetPlan({
    message: "total revenue for q1 2022",
    headers: ["Transaction Date", "Revenue Total", "Net Revenue"],
    sampleRows: [{ "Transaction Date": "2022-01-11", "Revenue Total": "100", "Net Revenue": "90" }],
    semanticProfile: {},
    hints: {
      aiPlannerResponse: {
        status: "needs_clarification",
        intent_summary: "Need metric clarification",
        confidence: "medium",
        analysis_plan: null,
        clarification: {
          field: "metric.column",
          question: "Which revenue column should I use?",
          options: [
            { number: 1, label: "Revenue Total", value: "Revenue Total" },
            { number: 2, label: "Net Revenue", value: "Net Revenue" },
          ],
        },
        not_answerable: null,
        warnings: [],
      },
    },
  });
  assert.equal(plan?.clarification_needed, true);
  assert.equal(String(plan?.clarification_field || ""), "metric.column");
});

test("planner does not silently fall back to local interpretation when AI planner fails", async () => {
  const plan = await buildDeterministicSpreadsheetPlan({
    message: "year over year revenue",
    headers: ["Date", "Revenue Total", "Net Revenue"],
    sampleRows: [{ Date: "2022-01-10", "Revenue Total": "100", "Net Revenue": "90" }],
    semanticProfile: {},
    hints: { aiPlannerResponse: "not-an-object" },
  });
  assert.equal(plan?.ok, false);
  assert.equal(String(plan?.reason || ""), "ai_not_answerable");
});

test("planner returns provider failure when no planner response or API key is provided", async () => {
  await assert.rejects(
    () => buildDeterministicSpreadsheetPlan({
      message: "year over year revenue",
      headers: ["Date", "Revenue Total", "Net Revenue"],
      sampleRows: [{ Date: "2022-01-10", "Revenue Total": "100", "Net Revenue": "90" }],
      semanticProfile: {},
      hints: {},
    }),
    /no_api_key/
  );
});
