import test from "node:test";
import assert from "node:assert/strict";
import { validateCalculationPlan } from "../src/services/ai/calculationPlanValidator.js";
import { executeDeterministicSpreadsheetPlan } from "../src/services/ai/deterministicSpreadsheetExecutor.js";

test("driver analysis plan validation", () => {
  const plan = {
    status: "ready",
    calculation_plan: {
      analysis_type: "driver_analysis",
      base_metric: { business_concept: "net_income", source_columns: ["net_income"], aggregation: "sum" },
      comparison: {
        type: "period_vs_period",
        baseline_range: { start: "2022-01-01", end: "2022-12-31" },
        comparison_range: { start: "2023-01-01", end: "2023-12-31" },
        date_column: "Date"
      },
      driver_columns: ["Revenue", "COGS"],
      dimensions: ["Region"]
    }
  };
  const context = { columns: [{ name: "Date" }, { name: "net_income" }, { name: "Revenue" }, { name: "COGS" }, { name: "Region" }] };
  const res = validateCalculationPlan(plan, context, { allowed_columns: ["Date", "net_income", "Revenue", "COGS", "Region"] });
  assert.equal(res.ok, true);
});

test("driver analysis execution", () => {
  const plan = {
    ok: true,
    analysisPlan: {
      analysis_type: "driver_analysis",
      steps: [
        {
          step_id: "s1",
          operation: "period_driver_delta",
          date_column: "Date",
          driver_columns: ["Revenue", "COGS"],
          baseline_range: ["2022-01-01", "2022-12-31"],
          comparison_range: ["2023-01-01", "2023-12-31"],
          filters: [],
        },
      ],
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
