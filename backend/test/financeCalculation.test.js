import test from "node:test";
import assert from "node:assert/strict";
import { mapIntentToMetric } from "../src/services/finance/intentToMetric.js";
import { calculateFinanceMetric } from "../src/services/finance/calculationService.js";

const rows = [
  { "Revenue Total": 1000, "Expense Billed": 700, "COGS": 400, "Date": "2024-01-05" },
  { "Revenue Total": 1500, "Expense Billed": 900, "COGS": 650, "Date": "2024-02-10" },
  { "Revenue Total": "bad", "Expense Billed": 100, "COGS": 50, "Date": "2024-02-20" },
];
const headers = ["Revenue Total", "Expense Billed", "COGS", "Date"];

const fullPerm = { allowedColumns: headers, rowFiltersList: [] };

test("maps ambiguous metric request", () => {
  const out = mapIntentToMetric("show me numbers");
  assert.equal(out.ok, false);
  assert.equal(out.errorCode, "AMBIGUOUS_METRIC");
});

test("calculates total revenue", async () => {
  const out = await calculateFinanceMetric({ rows, headers, metricKey: "total_revenue", permissionContext: fullPerm, period: null, filters: {} });
  assert.equal(out.ok, true);
  assert.equal(out.value, 2500);
});

test("calculates gross profit", async () => {
  const out = await calculateFinanceMetric({ rows, headers, metricKey: "gross_profit", permissionContext: fullPerm, period: null, filters: {} });
  assert.equal(out.ok, true);
  assert.equal(out.value, 1400);
});

test("calculates gross margin", async () => {
  const out = await calculateFinanceMetric({ rows, headers, metricKey: "gross_margin_pct", permissionContext: fullPerm, period: null, filters: {} });
  assert.equal(out.ok, true);
  assert.ok(Math.abs(out.value - 56) < 0.0001);
});

test("calculates net income", async () => {
  const out = await calculateFinanceMetric({ rows, headers, metricKey: "net_income", permissionContext: fullPerm, period: null, filters: {} });
  assert.equal(out.ok, true);
  assert.equal(out.value, 800);
});

test("rejects unauthorized cogs column for gross margin", async () => {
  const out = await calculateFinanceMetric({
    rows,
    headers,
    metricKey: "gross_margin_pct",
    permissionContext: { allowedColumns: ["Revenue Total", "Expense Billed", "Date"], rowFiltersList: [] },
    period: null,
    filters: {},
  });
  assert.equal(out.ok, false);
  assert.equal(out.errorCode, "UNAUTHORIZED_OR_MISSING_COLUMNS");
});

test("applies period row filtering before calculation", async () => {
  const out = await calculateFinanceMetric({
    rows,
    headers,
    metricKey: "total_expense",
    permissionContext: fullPerm,
    period: { start: "2024-02-01", end: "2024-02-29" },
    filters: {},
  });
  assert.equal(out.ok, true);
  assert.equal(out.rowCount, 2);
  assert.equal(out.value, 1000);
});
