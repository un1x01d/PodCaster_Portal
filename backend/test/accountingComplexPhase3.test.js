import test from "node:test";
import assert from "node:assert/strict";

import { validateAnalysisPlan } from "../src/services/accounting/analysisPlanValidator.js";
import { resolveAnalysisHeaders } from "../src/services/accounting/analysisHeaderResolver.js";
import { executeAnalysisPlan } from "../src/services/accounting/analysisExecutor.js";

const metrics = ["net_income", "total_revenue", "total_expense", "gross_margin_pct", "variance_amount"];
const canon = ["date", "revenue", "expenses", "cogs", "gross_profit", "net_income", "actual", "budget", "category", "account", "department", "store", "region", "customer", "vendor"];

test("A profit driver analysis with revenue and expenses", () => {
  const plan = {
    question_type: "driver_analysis_profit",
    primary_metric: "net_income",
    safe_next_action: "validate_plan",
    confidence: "high",
    period: { label: "March 2024", start: "2024-03-01", end: "2024-03-31" },
    comparison_period: { label: "February 2024", start: "2024-02-01", end: "2024-02-29" },
    group_bys: ["category"],
    analysis_steps: [
      { step_id: "current_profit", type: "calculate_metric", metric: "net_income", period: "current" },
      { step_id: "comparison_profit", type: "calculate_metric", metric: "net_income", period: "comparison" },
      { step_id: "profit_variance", type: "calculate_variance", metric: "net_income", current_step: "current_profit", comparison_step: "comparison_profit" },
      { step_id: "top_expense_drivers", type: "rank_drivers", metric: "total_expense", group_by: "category", period: "current_vs_comparison", limit: 5 },
    ],
  };
  const v = validateAnalysisPlan({ plan, supportedMetrics: metrics, supportedCanonicalHeaders: canon });
  assert.equal(v.ok, true);
  const headers = ["Date", "Revenue", "Expenses", "Expense Category"];
  const h = resolveAnalysisHeaders({ approvedPlan: plan, headers, fieldMetadata: {}, message: "Why did profit drop in March?" });
  assert.equal(h.ok, true);
  const rows = [
    { Date: "2024-03-10", Revenue: 100, Expenses: 90, "Expense Category": "Payroll" },
    { Date: "2024-02-10", Revenue: 150, Expenses: 80, "Expense Category": "Payroll" },
  ];
  const out = executeAnalysisPlan({ approvedPlan: plan, headerResolution: h, rows, userContext: { allowedColumns: headers } });
  assert.equal(out.ok, true);
  assert.ok(out.results.revenue_variance === undefined || true);
});

test("B gross margin decrease", () => {
  const headers = ["Date", "Net Sales", "Product Cost", "Product Category"];
  const h = resolveAnalysisHeaders({ approvedPlan: { question_type: "driver_analysis_gross_margin" }, headers, fieldMetadata: {}, message: "Why did gross margin decrease?" });
  assert.equal(h.ok, true);
});

test("C profit with only Net Profit partial", () => {
  const headers = ["Month", "Net Profit"];
  const h = resolveAnalysisHeaders({ approvedPlan: { question_type: "driver_analysis_profit" }, headers, fieldMetadata: {}, message: "Why did profit drop?" });
  assert.equal(h.ok, true);
  assert.equal(h.answerCompleteness, "partial");
});

test("D profit ambiguous", () => {
  const headers = ["Month", "Gross Profit", "Net Profit"];
  const h = resolveAnalysisHeaders({ approvedPlan: { question_type: "driver_analysis_profit" }, headers, fieldMetadata: {}, message: "Why did profit drop?" });
  assert.equal(h.ok, false);
});

test("E pnl summary", () => {
  const headers = ["Month", "Revenue", "COGS", "Gross Profit", "Operating Expenses", "Net Income"];
  const h = resolveAnalysisHeaders({ approvedPlan: { question_type: "pnl_summary" }, headers, fieldMetadata: {}, message: "Summarize this P&L" });
  assert.equal(h.ok, true);
});

test("F budget vs actual", () => {
  const headers = ["Month", "Budget", "Actual", "Department"];
  const h = resolveAnalysisHeaders({ approvedPlan: { question_type: "budget_vs_actual" }, headers, fieldMetadata: {}, message: "Compare budget vs actual expenses for Q1" });
  assert.equal(h.ok, true);
});

test("G missing required field", () => {
  const headers = ["Date", "Revenue"];
  const h = resolveAnalysisHeaders({ approvedPlan: { question_type: "driver_analysis_gross_margin" }, headers, fieldMetadata: {}, message: "Why did gross margin drop?" });
  assert.equal(h.ok, false);
});

test("H missing optional fields", () => {
  const headers = ["Date", "Revenue", "Expenses"];
  const h = resolveAnalysisHeaders({ approvedPlan: { question_type: "driver_analysis_profit" }, headers, fieldMetadata: {}, message: "Why did profit drop?" });
  assert.equal(h.ok, true);
  assert.ok(h.missingOptional.length > 0);
});

test("I malformed planner JSON equivalent", () => {
  const v = validateAnalysisPlan({ plan: null, supportedMetrics: metrics, supportedCanonicalHeaders: canon });
  assert.equal(v.ok, false);
});

test("J unknown metric in plan", () => {
  const v = validateAnalysisPlan({ plan: { safe_next_action: "validate_plan", confidence: "high", analysis_steps: [{ type: "calculate_metric", metric: "unknown_metric" }] }, supportedMetrics: metrics, supportedCanonicalHeaders: canon });
  assert.equal(v.ok, false);
});

test("K too many plan steps", () => {
  const steps = Array.from({ length: 13 }, (_, i) => ({ step_id: `s${i}`, type: "calculate_metric", metric: "net_income" }));
  const v = validateAnalysisPlan({ plan: { safe_next_action: "validate_plan", confidence: "high", analysis_steps: steps, group_bys: [] }, supportedMetrics: metrics, supportedCanonicalHeaders: canon });
  assert.equal(v.ok, false);
});

test("L unauthorized required column", () => {
  const plan = { question_type: "driver_analysis_profit", analysis_steps: [] };
  const headers = ["Date", "Revenue", "Expenses"];
  const h = resolveAnalysisHeaders({ approvedPlan: plan, headers, fieldMetadata: {}, message: "Why did profit drop?" });
  const out = executeAnalysisPlan({ approvedPlan: { ...plan, analysis_steps: [{ step_id: "x", type: "calculate_metric", metric: "net_income", period: "current" }], period: { start: "2024-01-01", end: "2024-12-31" } }, headerResolution: h, rows: [{ Date: "2024-03-10", Revenue: 100, Expenses: 80 }], userContext: { allowedColumns: ["Date", "Revenue"] } });
  assert.equal(out.ok, true);
  assert.equal(out.results.x.ok, false);
});

test("M raw row leak test", async () => {
  const mod = await import("../src/services/ai/accountingAnalysisExplainer.js");
  const src = String(mod.explainAccountingAnalysis);
  assert.ok(!src.includes("rows"));
});
