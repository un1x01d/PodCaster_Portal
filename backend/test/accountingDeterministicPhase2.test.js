import test from "node:test";
import assert from "node:assert/strict";
import { parseMoney } from "../src/services/accounting/numeric.js";
import { runDeterministicCalculation } from "../src/services/accounting/calculationService.js";

const ctx = { allowedColumns: ["Revenue", "Expenses", "COGS", "Gross Profit", "Net Profit", "Actual", "Budget", "Date", "AR", "AP"] };

function hr(map) { return { ok: true, resolvedMappings: map, optionalMappings: {} }; }

test("A total_revenue", () => {
  const rows = [{ Revenue: 100 }, { Revenue: 200 }, { Revenue: 300 }];
  const r = runDeterministicCalculation({ rows, metric: "total_revenue", headerResolution: hr({ total_revenue: "Revenue" }), userContext: ctx });
  assert.equal(r.ok, true); assert.equal(r.value, 600);
});

test("B money parsing", () => {
  assert.equal(parseMoney("$1,234.56").value, 1234.56);
  assert.equal(parseMoney("1,234.56").value, 1234.56);
  assert.equal(parseMoney("(100.00)").value, -100);
  assert.equal(parseMoney("-25").value, -25);
});

test("C gross_profit revenue-cogs", () => {
  const r = runDeterministicCalculation({ rows: [{ Revenue: 1000, COGS: 600 }], metric: "gross_profit", headerResolution: hr({ total_revenue: "Revenue", cogs: "COGS" }), userContext: ctx });
  assert.equal(r.value, 400);
});

test("D gross_profit existing column", () => {
  const r = runDeterministicCalculation({ rows: [{ "Gross Profit": 400 }, { "Gross Profit": 200 }], metric: "gross_profit", headerResolution: hr({ gross_profit: "Gross Profit" }), userContext: ctx });
  assert.equal(r.value, 600);
});

test("E gross_margin_pct", () => {
  const r = runDeterministicCalculation({ rows: [{ Revenue: 1000, COGS: 600 }], metric: "gross_margin_pct", headerResolution: hr({ total_revenue: "Revenue", cogs: "COGS" }), userContext: ctx });
  assert.equal(r.value, 40);
});

test("F gross_margin divide by zero", () => {
  const r = runDeterministicCalculation({ rows: [{ Revenue: 0, COGS: 600 }], metric: "gross_margin_pct", headerResolution: hr({ total_revenue: "Revenue", cogs: "COGS" }), userContext: ctx });
  assert.equal(r.value, null); assert.match(r.notes.join(" "), /denominator is zero/i);
});

test("G net_income using Net Profit", () => {
  const r = runDeterministicCalculation({ rows: [{ "Net Profit": 100 }, { "Net Profit": 200 }], metric: "net_income", headerResolution: hr({ net_income: "Net Profit" }), userContext: ctx });
  assert.equal(r.value, 300);
});

test("H net_income revenue-expenses", () => {
  const r = runDeterministicCalculation({ rows: [{ Revenue: 1000, Expenses: 700 }], metric: "net_income", headerResolution: hr({ total_revenue: "Revenue", total_expense: "Expenses" }), userContext: ctx });
  assert.equal(r.value, 300);
});

test("I variance_amount", () => {
  const r = runDeterministicCalculation({ rows: [{ Actual: 120, Budget: 100 }], metric: "variance_amount", headerResolution: hr({ actual_amount: "Actual", budget_amount: "Budget" }), userContext: ctx });
  assert.equal(r.value, 20);
});

test("J variance_pct", () => {
  const r = runDeterministicCalculation({ rows: [{ Actual: 120, Budget: 100 }], metric: "variance_pct", headerResolution: hr({ actual_amount: "Actual", budget_amount: "Budget" }), userContext: ctx });
  assert.equal(r.value, 20);
});

test("K variance_pct divide by zero", () => {
  const r = runDeterministicCalculation({ rows: [{ Actual: 120, Budget: 0 }], metric: "variance_pct", headerResolution: hr({ actual_amount: "Actual", budget_amount: "Budget" }), userContext: ctx });
  assert.equal(r.value, null);
});

test("L period filtering", () => {
  const rows = [{ Date: "2023-02-01", Revenue: 100 }, { Date: "2024-03-01", Revenue: 200 }];
  const r = runDeterministicCalculation({ rows, metric: "total_revenue", headerResolution: hr({ total_revenue: "Revenue", date: "Date" }), period: 2024, userContext: ctx });
  assert.equal(r.value, 200);
});

test("M missing required header", () => {
  const r = runDeterministicCalculation({ rows: [{ Revenue: 1000 }], metric: "gross_margin_pct", headerResolution: hr({ total_revenue: "Revenue" }), userContext: ctx });
  assert.equal(r.ok, false);
});

test("N unauthorized required column", () => {
  const r = runDeterministicCalculation({ rows: [{ Revenue: 1000, COGS: 600 }], metric: "gross_margin_pct", headerResolution: hr({ total_revenue: "Revenue", cogs: "COGS" }), userContext: { allowedColumns: ["Revenue"] } });
  assert.equal(r.ok, false); assert.equal(r.errorCode, "UNAUTHORIZED_OR_MISSING_COLUMNS");
});

test("O invalid numeric values", () => {
  const r = runDeterministicCalculation({ rows: [{ Revenue: "N/A" }, { Revenue: 100 }], metric: "total_revenue", headerResolution: hr({ total_revenue: "Revenue" }), userContext: ctx });
  assert.equal(r.value, 100); assert.match(r.notes.join(" "), /invalid numeric/i);
});

test("P no raw rows in explainer payload contract", async () => {
  const mod = await import("../src/services/ai/accountingResultExplainer.js");
  const fnText = String(mod.explainAccountingResult);
  assert.ok(!fnText.includes("raw rows"));
});
