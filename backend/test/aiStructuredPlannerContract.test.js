import test from "node:test";
import assert from "node:assert/strict";

import { validateCalculationPlan, isValidIsoDate } from "../src/services/ai/calculationPlanValidator.js";
import { buildDeterministicSpreadsheetPlan } from "../src/services/ai/deterministicSpreadsheetPlanner.js";

const datasetContext = {
  columns: [
    { name: "Transaction Date", type: "date" },
    { name: "Net Revenue", type: "number" },
    { name: "Region", type: "string" },
  ],
};

test("validator accepts ready quarter plan with valid dates", () => {
  const plan = {
    status: "ready",
    calculation_plan: {
      analysis_type: "single_metric",
      metric: {
        concept: "net_revenue",
        source_columns: ["Net Revenue"],
        aggregation: "sum",
        formula: { operation: "sum", args: ["Net Revenue"] },
      },
      time_range: {
        type: "quarter",
        date_column: "Transaction Date",
        start: "2022-01-01",
        end: "2022-03-31",
        label: "Q1 2022",
      },
      filters: [{ column: "Transaction Date", operator: "between", value: ["2022-01-01", "2022-03-31"] }],
      group_by: [],
      sort: null,
      limit: null,
    },
  };
  const out = validateCalculationPlan(plan, datasetContext, { allowed_columns: ["Transaction Date", "Net Revenue", "Region"] });
  assert.equal(out.ok, true);
});

test("validator rejects unauthorized column", () => {
  const plan = {
    status: "ready",
    calculation_plan: {
      analysis_type: "single_metric",
      metric: { concept: "net_revenue", source_columns: ["Secret Revenue"], aggregation: "sum", formula: { operation: "sum", args: ["Secret Revenue"] } },
      time_range: { type: "all_time", date_column: null, start: null, end: null, label: null },
      filters: [],
      group_by: [],
      sort: null,
      limit: null,
    },
  };
  const out = validateCalculationPlan(plan, datasetContext, { allowed_columns: ["Transaction Date", "Net Revenue", "Region"] });
  assert.equal(out.ok, false);
});

test("validator rejects invalid quarter range", () => {
  const plan = {
    status: "ready",
    calculation_plan: {
      analysis_type: "single_metric",
      metric: { concept: "net_revenue", source_columns: ["Net Revenue"], aggregation: "sum", formula: { operation: "sum", args: ["Net Revenue"] } },
      time_range: { type: "quarter", date_column: "Transaction Date", start: "2022-01-01", end: "2022-04-30", label: "Q1 2022" },
      filters: [{ column: "Transaction Date", operator: "between", value: ["2022-01-01", "2022-04-30"] }],
      group_by: [],
      sort: null,
      limit: null,
    },
  };
  const out = validateCalculationPlan(plan, datasetContext, { allowed_columns: ["Transaction Date", "Net Revenue", "Region"] });
  assert.equal(out.ok, false);
});

test("date helper rejects invalid leap date", () => {
  assert.equal(isValidIsoDate("2023-02-29"), false);
  assert.equal(isValidIsoDate("2024-02-29"), true);
});

test("planner returns deterministic clarification state from AI status", async () => {
  const plan = await buildDeterministicSpreadsheetPlan({
    message: "total revenue for q1 2022",
    headers: ["Transaction Date", "Revenue Total", "Net Revenue"],
    sampleRows: [{ "Transaction Date": "2022-01-11", "Revenue Total": "100", "Net Revenue": "90" }],
    semanticProfile: {},
    hints: {
      useAiPlanner: true,
      aiPlannerResponse: {
        status: "needs_clarification",
        intent_summary: "Need metric clarification",
        confidence: "medium",
        calculation_plan: null,
        clarification: {
          field: "metric.source_columns",
          question: "Which revenue column should I use?",
          options: [
            { number: 1, label: "Revenue Total", value: "Revenue Total" },
            { number: 2, label: "Net Revenue", value: "Net Revenue" },
          ],
        },
        not_answerable: null,
        warnings: [],
      },
    },
    context: {},
  });
  assert.equal(plan?.clarification_needed, true);
  assert.equal(String(plan?.clarification_field || ""), "metric.source_columns");
});

test("planner does not silently fall back to legacy interpreter by default when AI planner fails", async () => {
  const plan = await buildDeterministicSpreadsheetPlan({
    message: "year over year revenue",
    headers: ["Date", "Revenue Total", "Net Revenue"],
    sampleRows: [{ Date: "2022-01-10", "Revenue Total": "100", "Net Revenue": "90" }],
    semanticProfile: {},
    hints: {
      useAiPlanner: true,
      aiPlannerResponse: "not-an-object",
    },
    context: {},
  });
  assert.equal(plan?.ok, false);
  assert.equal(String(plan?.reason || ""), "ai_plan_validation_failed");
});

test("validator rejects non-ISO date strings from planner", () => {
  const plan = {
    status: "ready",
    calculation_plan: {
      analysis_type: "comparison",
      metric: { concept: "net_revenue", source_columns: ["Net Revenue"], aggregation: "sum", formula: { operation: "sum", args: ["Net Revenue"] } },
      time_range: { type: "quarter", date_column: "Transaction Date", start: "Q2 2022", end: "Q3 2023", label: "Q2 2022 vs Q3 2023" },
      filters: [{ column: "Transaction Date", operator: "between", value: ["Q2 2022", "Q3 2023"] }],
      group_by: ["Region"],
      sort: { column: "Region", direction: "desc" },
      limit: 2,
    },
  };
  const out = validateCalculationPlan(plan, datasetContext, { allowed_columns: ["Transaction Date", "Net Revenue", "Region"] });
  assert.equal(out.ok, false);
  assert.equal(String(out.reason || ""), "invalid_date_range");
});

test("planner can use legacy interpreter only when explicitly enabled", async () => {
  const plan = await buildDeterministicSpreadsheetPlan({
    message: "year over year revenue",
    headers: ["Date", "Revenue Total", "Net Revenue"],
    sampleRows: [{ Date: "2022-01-10", "Revenue Total": "100", "Net Revenue": "90" }],
    semanticProfile: {},
    hints: {
      useAiPlanner: true,
      allowLegacyInterpreterFallback: true,
      // Force planner throw by omitting runtime/api and no aiPlannerResponse mock.
    },
    context: {},
  });
  // With fallback enabled, plan should continue through legacy path and produce a valid plan or clarification.
  assert.equal(typeof plan, "object");
  assert.equal(Boolean(plan?.ok) || Boolean(plan?.clarification_needed) || Boolean(plan?.message), true);
});
