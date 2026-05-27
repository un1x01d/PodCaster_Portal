import test from "node:test";
import assert from "node:assert/strict";

import { resolveMetricHeaders } from "../src/services/ai/headerResolver.js";
import { closeDbPool } from "../src/config/db.js";

test.after(async () => {
  await closeDbPool();
});

test("profit in 2024 resolves to net_income when only Net Profit exists", async () => {
  const headers = ["Transaction Date", "Net Profit", "Net Sales"];
  const resolution = await resolveMetricHeaders({
    metricKey: "net_income",
    headers,
    fieldMetadata: {},
    message: "What was profit in 2024?",
  });
  assert.equal(resolution.resolvedMappings.net_income, "Net Profit");
  assert.equal(resolution.optionalMappings.date, "Transaction Date");
});

test("profit mapping can resolve net income when both Gross Profit and Net Profit exist", async () => {
  const headers = ["Date", "Gross Profit", "Net Profit"];
  const resolution = await resolveMetricHeaders({
    metricKey: "net_income",
    headers,
    fieldMetadata: {},
    message: "What was profit in 2024?",
  });
  assert.equal(resolution.resolvedMappings.net_income, "Net Profit");
});

test("gross margin can operate without hard-required revenue/cogs mappings", async () => {
  const headers = ["Date", "Revenue"];
  const resolution = await resolveMetricHeaders({
    metricKey: "gross_margin_pct",
    headers,
    fieldMetadata: {},
    message: "What was gross margin?",
  });
  assert.equal(Array.isArray(resolution.missingRequired), true);
  assert.equal(resolution.missingRequired.length, 0);
});

test("gross margin optional mapping picks known cost/revenue headers when present", async () => {
  const headers = ["Invoice Date", "Revenue Total", "Cost Total"];
  const resolution = await resolveMetricHeaders({
    metricKey: "gross_margin_pct",
    headers,
    fieldMetadata: {},
    message: "What is gross margin for 2022?",
  });
  assert.equal(resolution.optionalMappings.date, "Invoice Date");
  assert.ok(!resolution.missingRequired?.length);
});
