import test from "node:test";
import assert from "node:assert/strict";
import { buildDeterministicSpreadsheetPlan } from "../src/services/ai/deterministicSpreadsheetPlanner.js";
import { executeDeterministicSpreadsheetPlan } from "../src/services/ai/deterministicSpreadsheetExecutor.js";
import { validateDeterministicPlanContract } from "../src/services/ai/deterministicOperationContract.js";

const headers = ["Date", "Revenue", "Account", "Customer"];
const sampleRows = [
  { Date: "2021-01-15", Revenue: 100, Account: "A", Customer: "C1" },
  { Date: "2021-03-10", Revenue: 200, Account: "B", Customer: "C2" },
  { Date: "2022-01-20", Revenue: 500, Account: "A", Customer: "C1" },
  { Date: "2022-06-05", Revenue: 150, Account: "B", Customer: "C2" },
  { Date: "2023-02-11", Revenue: 300, Account: "A", Customer: "C1" },
];

test("maps YoY prompt variants to same deterministic operation", async () => {
  const variants = [
    "revenue year over year",
    "year over year revenue",
    "yoy revenue",
  ];
  for (const message of variants) {
    const plan = await buildDeterministicSpreadsheetPlan({ message, headers, sampleRows, semanticProfile: {} });
    assert.equal(plan.ok, true);
    assert.equal(plan.operation, "yoy_series");
    assert.equal(plan.metric, "total_revenue");
    const checked = validateDeterministicPlanContract(plan);
    assert.equal(checked.ok, true);
  }
});

test("maps top revenue year prompt variants to top_n_by_year", async () => {
  const variants = [
    "top revenue year?",
    "which year had the top revenue?",
    "highest revenue year",
  ];
  for (const message of variants) {
    const plan = await buildDeterministicSpreadsheetPlan({ message, headers, sampleRows, semanticProfile: {} });
    assert.equal(plan.ok, true);
    assert.equal(plan.operation, "top_n_by_year");
    assert.equal(plan.valueHeader, "Revenue");
    assert.equal(plan.dateHeader, "Date");
    const checked = validateDeterministicPlanContract(plan);
    assert.equal(checked.ok, true);
  }
});

test("maps driver growth question to driver_year_change", async () => {
  const variants = [
    "driver for growth in revenue in 2022?",
    "what drove the increase in revenue in 2022?",
    "which account drove revenue growth in 2022?",
  ];
  for (const message of variants) {
    const plan = await buildDeterministicSpreadsheetPlan({ message, headers, sampleRows, semanticProfile: {} });
    assert.equal(plan.ok, true);
    assert.equal(plan.operation, "driver_year_change");
    assert.equal(plan.year, 2022);
    assert.equal(plan.valueHeader, "Revenue");
    assert.equal(plan.dateHeader, "Date");
    const checked = validateDeterministicPlanContract(plan);
    assert.equal(checked.ok, true);
  }
});

test("driver_year_change execution returns top contributor delta", () => {
  const plan = {
    ok: true,
    operation: "driver_year_change",
    year: 2022,
    direction: "growth",
    dateHeader: "Date",
    dimensionHeader: "Account",
    valueHeader: "Revenue",
    limit: 1,
  };
  const out = executeDeterministicSpreadsheetPlan({ plan, rows: sampleRows, filters: [], userContext: { allowedColumns: headers } });
  assert.equal(out.ok, true);
  assert.equal(Array.isArray(out.ranking), true);
  assert.equal(out.ranking[0].label, "A");
  assert.equal(out.ranking[0].value, 400);
});

test("contract rejects unsupported operation and requests clarification", () => {
  const checked = validateDeterministicPlanContract({ ok: true, operation: "unknown_op" });
  assert.equal(checked.ok, false);
  assert.equal(checked.plan?.clarification_needed, true);
  assert.match(String(checked.plan?.clarification_question || ""), /clarification/i);
});

test("difference between years uses carried metric hint", async () => {
  const plan = await buildDeterministicSpreadsheetPlan({
    message: "difference between 2023 and 2024?",
    headers,
    sampleRows,
    semanticProfile: {},
    hints: { metric: "revenue" },
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.operation, "two_year_delta");
  assert.equal(plan.metric, "total_revenue");
});

test("explicit revenue in message beats conflicting analyzer metric", async () => {
  const plan = await buildDeterministicSpreadsheetPlan({
    message: "difference in revenue between 2022 and 2023?",
    headers,
    sampleRows,
    semanticProfile: {},
    accountingIntent: { metric_requested: "gross_margin_pct" },
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.operation, "two_year_delta");
  assert.equal(plan.metric, "total_revenue");
});

test("cause follow-up resolves from deterministic context", async () => {
  const plan = await buildDeterministicSpreadsheetPlan({
    message: "what caused it?",
    headers,
    sampleRows,
    semanticProfile: {},
    context: {
      lastOperation: "two_year_delta",
      lastMetric: "total_revenue",
      lastYears: [2022, 2023],
    },
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.operation, "driver_year_change");
  assert.equal(plan.year, 2023);
  assert.equal(plan.valueHeader, "Revenue");
});

test("explicit profit in message overrides revenue hint", async () => {
  const plan = await buildDeterministicSpreadsheetPlan({
    message: "difference in profit between 2022 and 2023",
    headers: ["Date", "Revenue", "COGS", "Gross Profit", "Account"],
    sampleRows,
    semanticProfile: {},
    hints: { metric: "revenue" },
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.operation, "two_year_delta");
  assert.equal(plan.metric, "gross_profit");
});

test("driver follow-up prefers context metric when message metric is implicit", async () => {
  const plan = await buildDeterministicSpreadsheetPlan({
    message: "what's the main driver?",
    headers: ["Date", "Revenue", "Gross Profit", "Account"],
    sampleRows,
    semanticProfile: {},
    context: {
      lastOperation: "two_year_delta",
      lastMetric: "gross_profit",
      lastYears: [2022, 2023],
    },
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.operation, "driver_year_change");
  assert.equal(plan.valueHeader, "Gross Profit");
  assert.equal(plan.year, 2023);
});

test("driver default grouping prefers Account over Account Group", async () => {
  const plan = await buildDeterministicSpreadsheetPlan({
    message: "what's the driver?",
    headers: ["Date", "Region", "Account Group", "Account", "Revenue"],
    sampleRows,
    semanticProfile: {},
    context: {
      lastOperation: "two_year_delta",
      lastMetric: "total_revenue",
      lastYears: [2022, 2023],
    },
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.operation, "driver_year_change");
  assert.equal(plan.dimensionHeader, "Account");
});
