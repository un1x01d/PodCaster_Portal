import test from "node:test";
import assert from "node:assert/strict";

import { resolveMetricHeaders } from "../src/services/ai/headerResolver.js";
import { resolveField } from "../src/services/ai/fieldResolver.js";

function buildHeaderExplanation(resolution) {
  const lines = [];
  Object.entries(resolution.resolvedMappings || {}).forEach(([k, v]) => lines.push(`${k} -> ${v}`));
  if (resolution.missingRequired?.length) lines.push(`missing: ${resolution.missingRequired.join(",")}`);
  if (resolution.ambiguous?.length) lines.push("ambiguous");
  return lines.join(" | ");
}

test("profit in 2024 resolves to net_income when only Net Profit exists", () => {
  const headers = ["Transaction Date", "Net Profit", "Net Sales"];
  const resolution = resolveMetricHeaders({
    metricKey: "net_income",
    headers,
    fieldMetadata: {},
    message: "What was profit in 2024?",
  });
  assert.equal(resolution.resolvedMappings.net_income, "Net Profit");
  assert.equal(resolution.optionalMappings.date, "Transaction Date");
  assert.equal(resolution.ambiguous.length, 0);
});

test("profit in 2024 is ambiguous when Gross Profit and Net Profit both exist", () => {
  const headers = ["Date", "Gross Profit", "Net Profit"];
  const gross = resolveField({ canonicalField: "gross_profit", headers, message: "What was profit in 2024?" });
  const net = resolveField({ canonicalField: "net_income", headers, message: "What was profit in 2024?" });
  assert.equal(gross.status, "ambiguous");
  assert.equal(net.status, "ambiguous");
});

test("gross margin identifies missing COGS requirement", () => {
  const headers = ["Date", "Revenue"];
  const resolution = resolveMetricHeaders({
    metricKey: "gross_margin_pct",
    headers,
    fieldMetadata: {},
    message: "What was gross margin?",
  });
  const text = buildHeaderExplanation(resolution);
  assert.equal(resolution.resolvedMappings.total_revenue, "Revenue");
  assert.ok(resolution.missingRequired.includes("cogs"));
  assert.match(text, /missing: cogs/);
});

test("gross margin resolves COGS from Cost Total", () => {
  const headers = ["Invoice Date", "Revenue Total", "Cost Total"];
  const resolution = resolveMetricHeaders({
    metricKey: "gross_margin_pct",
    headers,
    fieldMetadata: {},
    message: "What is gross margin for 2022?",
  });
  assert.equal(resolution.resolvedMappings.total_revenue, "Revenue Total");
  assert.equal(resolution.resolvedMappings.cogs, "Cost Total");
  assert.equal(resolution.missingRequired.length, 0);
  assert.equal(resolution.ambiguous.length, 0);
});
