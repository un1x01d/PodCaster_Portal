import test from "node:test";
import assert from "node:assert/strict";
import { resolveField } from "../src/services/ai/fieldResolver.js";
import { closeDbPool } from "../src/config/db.js";

test.after(async () => {
  await closeDbPool();
});

const sampleRows = [
  { Revenue: 120000, Expense: -70000, "Net Revenue": 110000, Date: "2024-01-01" },
  { Revenue: 125000, Expense: -72000, "Net Revenue": 113000, Date: "2024-02-01" },
  { Revenue: 130000, Expense: -75000, "Net Revenue": 117000, Date: "2024-03-01" },
  { Revenue: 128000, Expense: -74000, "Net Revenue": 116000, Date: "2024-04-01" },
];

test("resolveField uses multi-signal scoring and returns signal evidence", async () => {
  const out = await resolveField({
    canonicalField: "total_revenue",
    headers: ["Revenue", "Expense", "Net Revenue", "Date"],
    fieldMetadata: {},
    message: "show revenue",
    sampleRows,
    resolvedMappings: {},
  });
  assert.equal(out.status, "resolved");
  assert.equal(out.header, "Revenue");
  assert.ok(Array.isArray(out.candidates));
  if (out.candidates.length) {
    assert.ok(out.candidates[0]?.signals);
    assert.ok(typeof out.candidates[0].signals.lexical === "number");
    assert.ok(typeof out.candidates[0].signals.semantic === "number");
  }
});

test("resolveField prefers expense column for total_expense using sign/semantic signals", async () => {
  const out = await resolveField({
    canonicalField: "total_expense",
    headers: ["Revenue", "Expense", "Date"],
    fieldMetadata: {},
    message: "total expenses",
    sampleRows,
    resolvedMappings: {},
  });
  assert.equal(out.status, "resolved");
  assert.equal(out.header, "Expense");
  assert.ok(Number(out.confidence) >= 0.7);
});

test("resolveField returns ambiguity delta metadata when ambiguous", async () => {
  const out = await resolveField({
    canonicalField: "net_revenue",
    headers: ["Net Revenue", "Revenue Net", "Date"],
    fieldMetadata: {},
    message: "net revenue",
    sampleRows,
    resolvedMappings: {},
  });
  if (out.status === "ambiguous" || out.status === "ask_followup") {
    assert.ok(Number.isFinite(Number(out.ambiguityDelta)));
  } else {
    assert.equal(out.status, "resolved");
  }
});
