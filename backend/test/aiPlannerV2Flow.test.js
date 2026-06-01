import test from "node:test";
import assert from "node:assert/strict";

import { buildDeterministicSpreadsheetPlan } from "../src/services/ai/deterministicSpreadsheetPlannerV2.js";

function baseReadyPlan(step, analysisType = "single_metric") {
  return {
    status: "ready",
    intent_summary: "planner response",
    confidence: "high",
    analysis_plan: {
      analysis_type: analysisType,
      steps: [step],
      final_response_instruction: { style: "business_explanation", include_tables: true, include_causation_warning: true },
    },
    clarification: null,
    not_answerable: null,
    warnings: [],
  };
}

test("v2 planner forwards needs_clarification from AI planner response", async () => {
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

test("v2 planner rejects invalid non-ISO date range plan without local repair", async () => {
  const plan = await buildDeterministicSpreadsheetPlan({
    message: "compare q2 2022 vs q3 2023 revenue",
    headers: ["Date", "Net Revenue", "Region"],
    sampleRows: [{ Date: "2022-01-01", "Net Revenue": "10", Region: "EU" }],
    semanticProfile: {},
    hints: {
      aiPlannerResponse: baseReadyPlan({
        step_id: "s1",
        operation: "period_delta_by_dimension",
        metric: { column: "Net Revenue", aggregation: "sum" },
        metrics: [],
        driver_columns: [],
        dimension: "Region",
        date_column: "Date",
        filters: [],
        baseline_range: ["Q2 2022", "Q2 2022"],
        comparison_range: ["Q3 2023", "Q3 2023"],
        time_range: null,
        grain: "quarter",
        group_by: ["Region"],
        sort: { by: "metric", direction: "desc" },
        limit: 2,
      }, "comparison"),
    },
  });
  assert.equal(plan?.ok, false);
  assert.equal(plan?.clarification_needed, false);
  assert.equal(String(plan?.reason || ""), "ai_plan_validation_failed");
});

test("v2 planner accepts ready single metric analysis_plan", async () => {
  const plan = await buildDeterministicSpreadsheetPlan({
    message: "net revenue for 2023",
    headers: ["Transaction Date", "Net Revenue"],
    sampleRows: [{ "Transaction Date": "2023-03-10", "Net Revenue": "150" }],
    semanticProfile: {},
    hints: {
      aiPlannerResponse: baseReadyPlan({
        step_id: "s1",
        operation: "aggregate",
        metric: { column: "Net Revenue", aggregation: "sum" },
        metrics: [],
        driver_columns: [],
        dimension: null,
        date_column: null,
        filters: [{ column: "Transaction Date", operator: "between", value: ["2023-01-01", "2023-12-31"] }],
        baseline_range: null,
        comparison_range: null,
        time_range: null,
        grain: "none",
        group_by: [],
        sort: null,
        limit: null,
      }),
    },
  });
  assert.equal(plan?.ok, true);
  assert.equal(String(plan?.operation || ""), "multi_step_analysis");
  assert.equal(typeof plan?.analysisPlan, "object");
});

test("v2 planner exposes single-option clarification for route-level continuation", async () => {
  const plan = await buildDeterministicSpreadsheetPlan({
    message: "year over year net revenue",
    headers: ["Date", "Net Revenue"],
    sampleRows: [{ Date: "2021-01-01", "Net Revenue": "10" }, { Date: "2024-12-31", "Net Revenue": "20" }],
    semanticProfile: {},
    hints: {
      aiPlannerResponse: {
        status: "needs_clarification",
        intent_summary: "Need date column",
        confidence: "medium",
        analysis_plan: null,
        clarification: {
          field: "date_column",
          question: "Which date column should be used?",
          options: [{ number: 1, label: "Date", value: "Date" }],
        },
        not_answerable: null,
        warnings: [],
      },
    },
  });
  assert.equal(plan?.ok, false);
  assert.equal(plan?.clarification_needed, true);
  assert.equal(String(plan?.reason || ""), "auto_resolve_single_option");
});

test("v2 planner returns not_answerable safely when planner cannot continue", async () => {
  const plan = await buildDeterministicSpreadsheetPlan({
    message: "year over year net revenue",
    headers: ["Date", "Net Revenue"],
    sampleRows: [{ Date: "2021-01-01", "Net Revenue": "10" }, { Date: "2024-12-31", "Net Revenue": "20" }],
    semanticProfile: {},
    hints: {
      aiPlannerResponse: {
        status: "not_answerable",
        intent_summary: "missing context",
        confidence: "low",
        analysis_plan: null,
        clarification: null,
        not_answerable: { reason: "Need follow-up context", missing_data: ["prior selection"], best_available_alternative: null },
        warnings: [],
      },
    },
  });
  assert.equal(plan?.ok, false);
  assert.equal(String(plan?.reason || ""), "ai_not_answerable");
});
