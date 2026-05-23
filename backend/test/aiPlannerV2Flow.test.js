import test from "node:test";
import assert from "node:assert/strict";

import { buildDeterministicSpreadsheetPlan } from "../src/services/ai/deterministicSpreadsheetPlannerV2.js";

test("v2 planner forwards needs_clarification from AI planner response", async () => {
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
  });
  assert.equal(plan?.clarification_needed, true);
  assert.equal(String(plan?.clarification_field || ""), "metric.source_columns");
});

test("v2 planner returns clarification on invalid non-ISO date range plan", async () => {
  const plan = await buildDeterministicSpreadsheetPlan({
    message: "compare q2 2022 vs q3 2023 revenue",
    headers: ["Date", "Net Revenue", "Region"],
    sampleRows: [{ Date: "2022-01-01", "Net Revenue": "10", Region: "EU" }],
    semanticProfile: {},
    hints: {
      useAiPlanner: true,
      aiPlannerResponse: {
        status: "ready",
        intent_summary: "Comparison",
        confidence: "high",
        calculation_plan: {
          analysis_type: "comparison",
          metric: {
            concept: "net_revenue",
            source_columns: ["Net Revenue"],
            aggregation: "sum",
            formula: { operation: "sum", args: ["Net Revenue"] },
          },
          time_range: {
            type: "quarter",
            date_column: "Date",
            start: "Q2 2022",
            end: "Q3 2023",
            label: "Q2 2022 vs Q3 2023",
          },
          filters: [{ column: "Date", operator: "between", value: ["Q2 2022", "Q3 2023"] }],
          group_by: ["Region"],
          sort: { column: "metric", direction: "desc" },
          limit: 2,
        },
        clarification: null,
        not_answerable: null,
        warnings: [],
      },
    },
  });
  assert.equal(plan?.ok, false);
  assert.equal(plan?.clarification_needed, true);
  assert.equal(String(plan?.reason || ""), "invalid_date_range");
});

test("v2 planner converts ready single metric plan to deterministic single_period", async () => {
  const plan = await buildDeterministicSpreadsheetPlan({
    message: "net revenue for 2023",
    headers: ["Transaction Date", "Net Revenue"],
    sampleRows: [{ "Transaction Date": "2023-03-10", "Net Revenue": "150" }],
    semanticProfile: {},
    hints: {
      useAiPlanner: true,
      aiPlannerResponse: {
        status: "ready",
        intent_summary: "single metric",
        confidence: "high",
        calculation_plan: {
          analysis_type: "single_metric",
          metric: {
            concept: "net_revenue",
            source_columns: ["Net Revenue"],
            aggregation: "sum",
            formula: { operation: "sum", args: ["Net Revenue"] },
          },
          time_range: {
            type: "year",
            date_column: "Transaction Date",
            start: "2023-01-01",
            end: "2023-12-31",
            label: "2023",
          },
          filters: [{ column: "Transaction Date", operator: "between", value: ["2023-01-01", "2023-12-31"] }],
          group_by: [],
          sort: null,
          limit: null,
        },
        clarification: null,
        not_answerable: null,
        warnings: [],
      },
    },
  });
  assert.equal(plan?.ok, true);
  assert.equal(String(plan?.operation || ""), "single_period");
  assert.equal(String(plan?.metric || ""), "net_revenue");
});

test("v2 planner auto-resolves single-option clarification and continues", async () => {
  const plan = await buildDeterministicSpreadsheetPlan({
    message: "year over year net revenue",
    headers: ["Date", "Net Revenue"],
    sampleRows: [{ Date: "2021-01-01", "Net Revenue": "10" }, { Date: "2024-12-31", "Net Revenue": "20" }],
    semanticProfile: {},
    hints: {
      useAiPlanner: true,
      aiPlannerResponse: {
        status: "needs_clarification",
        intent_summary: "Need date column",
        confidence: "medium",
        calculation_plan: null,
        clarification: {
          field: "time_range.date_column",
          question: "Which date column should be used?",
          options: [{ number: 1, label: "Date", value: "Date" }],
        },
        not_answerable: null,
        warnings: [],
      },
      aiPlannerFollowupResponse: {
        status: "ready",
        intent_summary: "YoY net revenue comparison",
        confidence: "high",
        calculation_plan: {
          analysis_type: "comparison",
          comparison: {
            type: "year_over_year",
            period_grain: "year",
            baseline: "previous_year",
            calculation: "both",
          },
          metric: {
            concept: "net_revenue",
            source_columns: ["Net Revenue"],
            aggregation: "sum",
            formula: { operation: "sum", args: ["Net Revenue"] },
          },
          time_range: {
            type: "year",
            date_column: "Date",
            start: "2021-01-01",
            end: "2024-12-31",
            label: "year over year",
            grain: "year",
          },
          filters: [{ column: "Date", operator: "between", value: ["2021-01-01", "2024-12-31"] }],
          group_by: [],
          sort: null,
          limit: null,
        },
        clarification: null,
        not_answerable: null,
        warnings: [],
      },
    },
  });
  assert.equal(plan?.ok, true);
  assert.equal(String(plan?.operation || ""), "yoy_series");
});

test("v2 planner continues from stored clarification state after user option reply", async () => {
  const plan = await buildDeterministicSpreadsheetPlan({
    message: "year over year net revenue",
    headers: ["Date", "Net Revenue"],
    sampleRows: [{ Date: "2021-01-01", "Net Revenue": "10" }, { Date: "2024-12-31", "Net Revenue": "20" }],
    semanticProfile: {},
    hints: {
      useAiPlanner: true,
      clarificationContinuation: {
        resolvedValue: "Date",
        field: "time_range.date_column",
        plannerState: {
          originalQuestion: "year over year net revenue",
          clarificationField: "time_range.date_column",
          partialPlan: {
            status: "needs_clarification",
            intent_summary: "Need date column",
            confidence: "medium",
            calculation_plan: null,
            clarification: {
              field: "time_range.date_column",
              question: "Which date column should be used?",
              options: [{ number: 1, label: "Date", value: "Date" }],
            },
            not_answerable: null,
            warnings: [],
          },
        },
      },
      aiPlannerFollowupResponse: {
        status: "ready",
        intent_summary: "YoY net revenue comparison",
        confidence: "high",
        calculation_plan: {
          analysis_type: "comparison",
          comparison: {
            type: "year_over_year",
            period_grain: "year",
            baseline: "previous_year",
            calculation: "both",
          },
          metric: {
            concept: "net_revenue",
            source_columns: ["Net Revenue"],
            aggregation: "sum",
            formula: { operation: "sum", args: ["Net Revenue"] },
          },
          time_range: {
            type: "year",
            date_column: "Date",
            start: "2021-01-01",
            end: "2024-12-31",
            label: "year over year",
            grain: "year",
          },
          filters: [{ column: "Date", operator: "between", value: ["2021-01-01", "2024-12-31"] }],
          group_by: [],
          sort: null,
          limit: null,
        },
        clarification: null,
        not_answerable: null,
        warnings: [],
      },
    },
  });
  assert.equal(plan?.ok, true);
  assert.equal(String(plan?.operation || ""), "yoy_series");
});
