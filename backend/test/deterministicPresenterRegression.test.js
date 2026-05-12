import test from "node:test";
import assert from "node:assert/strict";
import { presentDeterministicSpreadsheetResult } from "../src/services/ai/deterministicSpreadsheetPresenter.js";

test("single_period scalar is formatted even when message keyword has typo", async () => {
  const answer = await presentDeterministicSpreadsheetResult({
    message: "revebue for 2023",
    plan: { operation: "single_period", metric: "total_revenue" },
    calcResult: {
      ok: true,
      value: 54753.48,
      outputType: "currency",
      period: { label: "2023" },
    },
    accountingIntent: {},
    runtime: {},
  });
  assert.equal(answer, "$54,753.48");
});
