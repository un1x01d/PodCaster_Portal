import test from "node:test";
import assert from "node:assert/strict";
import { chatQueryV3, __setChatQueryV3Deps } from "../src/controllers/chatQueryV3Controller.js";

function createRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  return res;
}

test("/chat/query v3 executes mocked year_over_year plan end-to-end", async () => {
  const calls = { planner: 0, executor: 0, explain: 0 };
  __setChatQueryV3Deps({
    loadAccessibleRows: async (_sheetId, _user, _tab, limit = null) => {
      if (limit) {
        return { headers: ["Date", "Revenue"], rows: [{ Date: "2022-01-01", Revenue: 10 }], semanticProfile: {}, allowedColumns: ["Date", "Revenue"], forbidden: false };
      }
      return {
        headers: ["Date", "Revenue"],
        rows: [
          { Date: "2022-01-01", Revenue: 100 },
          { Date: "2023-01-01", Revenue: 130 },
        ],
        semanticProfile: {},
        allowedColumns: ["Date", "Revenue"],
        forbidden: false,
      };
    },
    getConversationAnalysisMemory: async () => ({ last_successful_analysis: null }),
    storeConversationAnalysisMemory: async () => true,
    getPendingClarification: async () => null,
    setPendingClarification: async () => true,
    clearPendingClarification: async () => true,
    buildDeterministicSpreadsheetPlan: async () => {
      calls.planner += 1;
      return {
        ok: true,
        operation: "multi_step_analysis",
        metric: "Revenue",
        analysisPlan: {
          analysis_type: "trend",
          steps: [{
            step_id: "s1",
            operation: "year_over_year",
            metric: { column: "Revenue", aggregation: "sum" },
            metrics: [],
            driver_columns: [],
            dimension: null,
            date_column: "Date",
            filters: [],
            baseline_range: null,
            comparison_range: null,
            time_range: ["2022-01-01", "2023-12-31"],
            grain: "year",
            group_by: [],
            sort: null,
            limit: null,
          }],
        },
      };
    },
    executeDeterministicSpreadsheetPlan: ({ plan }) => {
      calls.executor += 1;
      assert.equal(plan.analysisPlan.steps[0].operation, "year_over_year");
      return {
        ok: true,
        outputType: "yoy_table",
        rows: [
          { year: 2022, value: 100, previous_year_value: null, absolute_change: null, percent_change: null },
          { year: 2023, value: 130, previous_year_value: 100, absolute_change: 30, percent_change: 30 },
        ],
        step_results: [{ step_id: "s1", operation: "year_over_year", metadata: { columns_used: { metric: "Revenue", metrics: [], date_column: "Date", group_by: [] }, date_range_used: {} } }],
      };
    },
    explainDeterministicResults: ({ computed }) => {
      calls.explain += 1;
      return `ok:${computed.rows.length}`;
    },
  });

  const req = {
    user: { id: 99, customer_id: 7 },
    body: { sheetId: "s1", message: "year over year revenue", activeFilters: [], conversationHistory: [] },
  };
  const res = createRes();

  await chatQueryV3(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body?.answer, "ok:2");
  assert.equal(calls.planner, 1);
  assert.equal(calls.executor, 1);
  assert.equal(calls.explain, 1);
});

test("/chat/query v3 returns clarification text when planner needs clarification", async () => {
  __setChatQueryV3Deps({
    loadAccessibleRows: async () => ({ headers: ["Date", "Revenue"], rows: [{ Date: "2022-01-01", Revenue: 10 }], semanticProfile: {}, allowedColumns: ["Date", "Revenue"], forbidden: false }),
    getConversationAnalysisMemory: async () => ({ last_successful_analysis: null }),
    getPendingClarification: async () => null,
    clearPendingClarification: async () => true,
    buildDeterministicSpreadsheetPlan: async () => ({
      ok: false,
      clarification_needed: true,
      clarification_question: "Which metric?",
      clarification_field: "metric",
      clarification_options: ["Revenue", "Net Revenue"],
    }),
    setPendingClarification: async () => true,
  });

  const req = {
    user: { id: 99, customer_id: 7 },
    body: { sheetId: "s1", message: "difference", activeFilters: [], conversationHistory: [] },
  };
  const res = createRes();
  await chatQueryV3(req, res);

  assert.equal(res.statusCode, 200);
  assert.match(String(res.body?.answer || ""), /Which metric\?/);
  assert.match(String(res.body?.answer || ""), /1\. Revenue/);
});


test("/chat/query v3 scopes clarification state by tenant user session and sheet", async () => {
  let capturedScope = null;
  __setChatQueryV3Deps({
    loadAccessibleRows: async () => ({ headers: ["Date", "Revenue"], rows: [{ Date: "2022-01-01", Revenue: 10 }], semanticProfile: {}, allowedColumns: ["Date", "Revenue"], forbidden: false }),
    getConversationAnalysisMemory: async () => ({ last_successful_analysis: null }),
    clarificationKey: (scope) => {
      capturedScope = scope;
      return "scoped-key";
    },
    getPendingClarification: async () => null,
    setPendingClarification: async () => true,
    clearPendingClarification: async () => true,
    buildDeterministicSpreadsheetPlan: async () => ({
      ok: false,
      clarification_needed: true,
      clarification_question: "Which metric?",
      clarification_field: "metric",
      clarification_options: ["Revenue", "Net Revenue"],
    }),
  });

  const req = {
    user: { id: 99, customer_id: 7 },
    body: { sheetId: "sheet-a", sessionId: "session-a", message: "difference", activeFilters: [], conversationHistory: [] },
  };
  const res = createRes();
  await chatQueryV3(req, res);

  assert.deepEqual(capturedScope, { tenantId: 7, userId: 99, sessionId: "session-a", sheetId: "sheet-a" });
});

test("/chat/query v3 resolves pending clarification before planning continuation", async () => {
  let plannerMessage = "";
  __setChatQueryV3Deps({
    loadAccessibleRows: async (_sheetId, _user, _tab, limit = null) => ({
      headers: ["Date", "Revenue", "Net Revenue"],
      rows: limit ? [{ Date: "2022-01-01", Revenue: 10, "Net Revenue": 8 }] : [{ Date: "2022-01-01", Revenue: 10, "Net Revenue": 8 }],
      semanticProfile: {},
      allowedColumns: ["Date", "Revenue", "Net Revenue"],
      forbidden: false,
    }),
    getConversationAnalysisMemory: async () => ({ last_successful_analysis: null }),
    getPendingClarification: async () => ({
      originalQuestion: "compare revenue",
      field: "metric",
      question: "Which metric?",
      options: [{ value: "Revenue" }, { value: "Net Revenue" }],
      resolvedAnswers: [],
    }),
    resolveClarificationReply: (_pending, reply) => reply === "2" ? "Net Revenue" : null,
    clearPendingClarification: async () => true,
    setPendingClarification: async () => true,
    buildDeterministicSpreadsheetPlan: async ({ message }) => {
      plannerMessage = message;
      return {
        ok: true,
        operation: "multi_step_analysis",
        analysisPlan: {
          analysis_type: "single_metric",
          steps: [{ step_id: "s1", operation: "aggregate", metric: { column: "Net Revenue", aggregation: "sum" }, date_column: null, filters: [], group_by: [] }],
        },
      };
    },
    executeDeterministicSpreadsheetPlan: () => ({ ok: true, outputType: "aggregate", value: 8, step_results: [{ operation: "aggregate", value: 8, metadata: { columns_used: { metric: "Net Revenue" } } }] }),
    explainDeterministicResults: () => "answered",
    storeConversationAnalysisMemory: async () => true,
  });

  const req = {
    user: { id: 99, customer_id: 7 },
    body: { sheetId: "s1", sessionId: "session-a", message: "2", activeFilters: [], conversationHistory: [] },
  };
  const res = createRes();
  await chatQueryV3(req, res);

  assert.equal(res.body?.answer, "answered");
  assert.match(plannerMessage, /compare revenue/);
  assert.match(plannerMessage, /Resolved clarification: metric = Net Revenue/);
  assert.notEqual(plannerMessage.trim(), "2");
});

test("/chat/query v3 preserves locale during one-option clarification auto-resolution", async () => {
  const locales = [];
  __setChatQueryV3Deps({
    loadAccessibleRows: async (_sheetId, _user, _tab, limit = null) => ({
      headers: ["Date", "Revenue"],
      rows: limit ? [{ Date: "2022-01-01", Revenue: 10 }] : [{ Date: "2022-01-01", Revenue: 10 }],
      semanticProfile: {},
      allowedColumns: ["Date", "Revenue"],
      forbidden: false,
    }),
    getConversationAnalysisMemory: async () => ({ last_successful_analysis: null }),
    getPendingClarification: async () => null,
    clearPendingClarification: async () => true,
    setPendingClarification: async () => true,
    buildDeterministicSpreadsheetPlan: async ({ hints }) => {
      locales.push(hints?.runtime?.locale);
      if (locales.length === 1) {
        return {
          ok: false,
          clarification_needed: true,
          clarification_question: "Which date column?",
          clarification_field: "date_column",
          clarification_options: ["Date"],
        };
      }
      return {
        ok: true,
        operation: "multi_step_analysis",
        analysisPlan: {
          analysis_type: "single_metric",
          steps: [{ step_id: "s1", operation: "aggregate", metric: { column: "Revenue", aggregation: "sum" }, date_column: "Date", filters: [], group_by: [] }],
        },
      };
    },
    executeDeterministicSpreadsheetPlan: () => ({ ok: true, outputType: "aggregate", value: 10, step_results: [{ operation: "aggregate", value: 10, metadata: { columns_used: { metric: "Revenue", date_column: "Date" } } }] }),
    explainDeterministicResults: () => "відповідь",
    storeConversationAnalysisMemory: async () => true,
  });

  const req = {
    user: { id: 99, customer_id: 7 },
    body: { sheetId: "s1", sessionId: "session-a", message: "дохід", locale: "uk", activeFilters: [], conversationHistory: [] },
  };
  const res = createRes();
  await chatQueryV3(req, res);

  assert.deepEqual(locales, ["uk", "uk"]);
  assert.equal(res.body?.answer, "відповідь");
});
