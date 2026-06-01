import test from "node:test";
import assert from "node:assert/strict";
import { validateAiAnalysisPlan } from "../src/services/ai/aiAnalysisPlanValidator.js";
import { executeDeterministicSpreadsheetPlan } from "../src/services/ai/deterministicSpreadsheetExecutor.js";

const driverStep = {
  step_id: "s1",
  operation: "period_driver_delta",
  metric: { column: "net_income", aggregation: "sum" },
  metrics: [],
  driver_columns: ["Revenue", "COGS"],
  dimension: null,
  date_column: "Date",
  filters: [],
  baseline_range: ["2022-01-01", "2022-12-31"],
  comparison_range: ["2023-01-01", "2023-12-31"],
  time_range: null,
  grain: "year",
  group_by: [],
  sort: null,
  limit: null,
};

test("driver analysis plan validation uses analysis_plan contract", () => {
  const plan = {
    status: "ready",
    intent_summary: "driver analysis",
    confidence: "high",
    analysis_plan: {
      analysis_type: "driver_analysis",
      steps: [driverStep],
      final_response_instruction: { style: "business_explanation", include_tables: true, include_causation_warning: true },
    },
    clarification: null,
    not_answerable: null,
    warnings: [],
  };
  const context = {
    columns: [
      { name: "Date", type_guess: "date", profile: { date_like_ratio: 1, number_like_ratio: 0 } },
      { name: "net_income", type_guess: "number", profile: { date_like_ratio: 0, number_like_ratio: 1 } },
      { name: "Revenue", type_guess: "number", profile: { date_like_ratio: 0, number_like_ratio: 1 } },
      { name: "COGS", type_guess: "number", profile: { date_like_ratio: 0, number_like_ratio: 1 } },
      { name: "Region", type_guess: "category", profile: { date_like_ratio: 0, number_like_ratio: 0 } },
    ],
  };
  const res = validateAiAnalysisPlan({
    plan,
    datasetProfile: context,
    allowedOperations: ["period_driver_delta"],
  });
  assert.equal(res.ok, true);
});

test("driver analysis execution", () => {
  const plan = {
    ok: true,
    analysisPlan: {
      analysis_type: "driver_analysis",
      steps: [driverStep],
    },
  };

  const rows = [
    { Date: "2022-06-01", net_income: 100, Revenue: 200, COGS: 50 },
    { Date: "2023-06-01", net_income: 150, Revenue: 300, COGS: 70 },
  ];
  const userContext = { allowedColumns: ["Date", "Revenue", "COGS", "net_income"] };
  const res = executeDeterministicSpreadsheetPlan({ plan, rows, filters: [], userContext });

  assert.equal(res.ok, true);
  assert.equal(res.outputType, "drivers");
  assert.equal(Array.isArray(res.rows), true);
  assert.equal(res.rows.length, 2);

  const revDriver = res.rows.find((d) => d.label === "Revenue");
  assert.equal(revDriver.delta, 100);
});
