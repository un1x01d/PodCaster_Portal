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
  if (!res.ok) console.log(res);
  assert.equal(res.ok, true);
});

test("driver analysis execution", () => {
  const plan = {
    ok: true,
    operation: "driver_analysis",
    metric: "net_income",
    resolution: { resolvedMappings: { net_income: "net_income", total_revenue: "Revenue" }, optionalMappings: { date: "Date" } },
    comparison: {
      baseline_range: { start: "2022-01-01", end: "2022-12-31" },
      comparison_range: { start: "2023-01-01", end: "2023-12-31" },
    },
    driver_columns: ["Revenue", "COGS"],
  };
  const rows = [
    { Date: "2022-06-01", net_income: 100, Revenue: 200, COGS: 50 },
    { Date: "2023-06-01", net_income: 150, Revenue: 300, COGS: 70 },
  ];
  const userContext = { allowedColumns: ["Date", "Revenue", "COGS", "net_income"] };
  const filters = [];
  const res = executeDeterministicSpreadsheetPlan({ plan, rows, filters, userContext });
  if (!res.ok) console.log(res);
  assert.equal(res.ok, true);
  assert.equal(res.outputType, "driver_analysis");
  assert.equal(res.driver_analysis.base_metric.absolute_change, 50); // 150 - 100
  assert.equal(res.driver_analysis.drivers.length, 2);
  const revDriver = res.driver_analysis.drivers.find(d => d.column === "Revenue");
  assert.equal(revDriver.delta, 100); // 300 - 200
});
