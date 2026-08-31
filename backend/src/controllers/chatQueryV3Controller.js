import { buildDeterministicSpreadsheetPlan } from "../services/ai/deterministicSpreadsheetPlannerV2.js";
import { executeDeterministicSpreadsheetPlan } from "../services/ai/deterministicSpreadsheetExecutor.js";
import { explainDeterministicResults } from "../services/ai/resultExplanationService.js";
import { getConversationAnalysisMemory, storeConversationAnalysisMemory } from "../services/ai/conversationAnalysisMemory.js";
import {
  clarificationKey,
  getPendingClarification,
  setPendingClarification,
  clearPendingClarification,
  resolveClarificationReply,
} from "../services/ai/clarificationManager.js";
import { loadAccessibleRows } from "./chatController.js";

const deps = {
  buildDeterministicSpreadsheetPlan,
  executeDeterministicSpreadsheetPlan,
  explainDeterministicResults,
  getConversationAnalysisMemory,
  storeConversationAnalysisMemory,
  loadAccessibleRows,
  clarificationKey,
  getPendingClarification,
  setPendingClarification,
  clearPendingClarification,
  resolveClarificationReply,
};

export function __setChatQueryV3Deps(overrides = {}) {
  Object.assign(deps, overrides || {});
}

function isUkrainianLocale(locale = "en") {
  return String(locale || "").toLowerCase().startsWith("uk");
}

function isRussianLocale(locale = "en") {
  return String(locale || "").toLowerCase().startsWith("ru");
}

function looksMostlyAsciiEnglish(text = "") {
  const t = String(text || "").trim();
  if (!t) return false;
  const ascii = t.replace(/[^\x00-\x7F]/g, "");
  return ascii.length / t.length > 0.95;
}

function localizeClarificationQuestion(question = "", locale = "en") {
  const q = String(question || "").trim();
  if (isUkrainianLocale(locale)) {
    if (!q) return "Потрібне одне уточнення перед розрахунком.";
    if (looksMostlyAsciiEnglish(q)) return "Уточніть, будь ласка, один параметр для розрахунку:";
    return q;
  }
  if (isRussianLocale(locale)) {
    if (!q) return "Нужно одно уточнение перед расчётом.";
    if (looksMostlyAsciiEnglish(q)) return "Уточните, пожалуйста, один параметр для расчёта:";
    return q;
  }
  return q || "I need one clarification first.";
  return q;
}

function humanizeClarificationOption(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const yearMatch = raw.match(/_(20\d{2})$/);
  const year = yearMatch?.[1] || "";
  const base = year ? raw.slice(0, -yearMatch[0].length) : raw;
  const label = base
    .replace(/_/g, " ")
    .replace(/\bpnl\b/gi, "P&L")
    .replace(/\bavg\b/gi, "Average")
    .replace(/\byoy\b/gi, "year-over-year")
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
  return year ? `${label} for ${year}` : label;
}

function normalizeHistory(history = []) {
  return (Array.isArray(history) ? history : [])
    .slice(-8)
    .map((h) => ({
      role: String(h?.role || "").toLowerCase() === "assistant" ? "assistant" : "user",
      content: String(h?.content || "").slice(0, 4000),
    }))
    .filter((h) => h.content);
}

function buildMemoryFromResult({ question, plan, result }) {
  const last = Array.isArray(result?.step_results) ? result.step_results[result.step_results.length - 1] : null;
  return {
    last_successful_analysis: {
      user_question: String(question || ""),
      analysis_type: String(plan?.analysisPlan?.analysis_type || "single_metric"),
      metrics: plan?.analysisPlan?.steps?.map((s) => s?.metric).filter(Boolean) || [],
      date_column: String(plan?.analysisPlan?.steps?.find((s) => s?.date_column)?.date_column || ""),
      periods: {
        baseline: last?.baseline_value !== undefined ? { value: String(last.baseline_value), start: last?.metadata?.date_range_used?.baseline_range?.[0] || null, end: last?.metadata?.date_range_used?.baseline_range?.[1] || null } : null,
        comparison: last?.comparison_value !== undefined ? { value: String(last.comparison_value), start: last?.metadata?.date_range_used?.comparison_range?.[0] || null, end: last?.metadata?.date_range_used?.comparison_range?.[1] || null } : null,
      },
      result_summary: {
        absolute_change: last?.absolute_change !== undefined ? String(last.absolute_change) : null,
        percent_change: last?.percent_change !== undefined && last?.percent_change !== null ? String(last.percent_change) : null,
      },
      columns_used: Array.from(new Set([
        ...(last?.metadata?.columns_used?.metric ? [last.metadata.columns_used.metric] : []),
        ...(Array.isArray(last?.metadata?.columns_used?.metrics) ? last.metadata.columns_used.metrics : []),
        ...(last?.metadata?.columns_used?.date_column ? [last.metadata.columns_used.date_column] : []),
        ...(Array.isArray(last?.metadata?.columns_used?.group_by) ? last.metadata.columns_used.group_by : []),
      ])).filter(Boolean),
    },
  };
}

async function buildPlanWithContext({
  message,
  headers,
  semanticProfile,
  sampleRows,
  sheetId,
  activeTab,
  conversationHistory,
  memory,
  locale = "en",
}) {
  return deps.buildDeterministicSpreadsheetPlan({
    message,
    headers,
    semanticProfile,
    sampleRows,
    hints: {
      sheetId,
      activeTab,
      conversationHistory: normalizeHistory(conversationHistory),
      context: memory,
      runtime: { locale: String(locale || "en") },
    },
  });
}

export async function chatQueryV3(req, res) {
  const { sheetId: rawSheetId, activeTab = null, message, activeFilters = [], conversationHistory = [], locale = "en", sessionId = null, conversationId = null } = req.body || {};
  const sheetId = String(rawSheetId || "").trim();
  const userId = Number(req.user?.id || 0);
  const tenantId = req.user?.customer_id || null;
  const chatSessionId = String(sessionId || conversationId || req.headers?.["x-chat-session-id"] || req.headers?.["x-conversation-id"] || "default").slice(0, 160);
  const userKey = deps.clarificationKey({ tenantId, userId, sessionId: chatSessionId, sheetId });
  const rawMessage = String(message || "").trim();

  if (!rawMessage) return res.status(400).json({ error: "chat_message_required" });
  if (!sheetId) return res.status(400).json({ error: "sheet_id_required" });

  const sample = await deps.loadAccessibleRows(sheetId, req.user, activeTab || null, 200);
  if (sample?.forbidden) return res.status(403).json({ error: "forbidden" });

  const headers = Array.isArray(sample?.headers) ? sample.headers : [];
  const sampleRows = Array.isArray(sample?.rows) ? sample.rows.slice(0, 120) : [];
  const memory = await deps.getConversationAnalysisMemory({ tenantId, userId, sheetId });

  const pending = await deps.getPendingClarification(userKey);
  let planningMessage = rawMessage;
  let clarificationState = {
    originalQuestion: String(rawMessage),
    resolvedAnswers: [],
  };

  if (pending) {
    const resolved = deps.resolveClarificationReply(pending, rawMessage);
    if (!resolved) {
      const options = (pending.options || []).map((o, i) => `${i + 1}. ${String(o?.value || o?.label || "")}`).join("\n");
      return res.json({
        answer: `${String(pending.question || "Please choose one of the listed options.")}\n${options}`,
        actions: { reset_filters: false, filters: [], chart: null },
        preview_rows: [],
        meta: { phase: "clarification_required", options: (pending.options || []).map((o) => String(o?.value || o?.label || "")) },
      });
    }

    clarificationState = {
      originalQuestion: String(pending.originalQuestion || rawMessage),
      resolvedAnswers: [
        ...(Array.isArray(pending.resolvedAnswers) ? pending.resolvedAnswers : []),
        { field: String(pending.field || "selection"), value: String(resolved) },
      ],
    };

    planningMessage = [
      clarificationState.originalQuestion,
      ...clarificationState.resolvedAnswers.map((a) => `Resolved clarification: ${a.field} = ${a.value}`),
    ].join("\n");
  }

  let compiledPlan = await buildPlanWithContext({
    message: planningMessage,
    headers,
    semanticProfile: sample?.semanticProfile || {},
    sampleRows,
    sheetId,
    activeTab,
    conversationHistory,
    memory,
    locale,
  });

  if (!compiledPlan?.ok && compiledPlan?.clarification_needed) {
    const options = (compiledPlan?.clarification_options || [])
      .map((v) => {
        const value = String(v || "").trim();
        return { value, label: humanizeClarificationOption(value) };
      })
      .filter((v) => v.value);

    const repeatedField = String(compiledPlan?.clarification_field || "selection");
    const alreadyResolved = (clarificationState?.resolvedAnswers || []).find((a) => String(a?.field || "") === repeatedField);
    if (alreadyResolved) {
      const retryMessage = [
        clarificationState.originalQuestion,
        ...clarificationState.resolvedAnswers.map((a) => `Resolved clarification: ${a.field} = ${a.value}`),
        `Use previously resolved value for ${repeatedField}: ${alreadyResolved.value}`,
      ].join("\n");

      const retryPlan = await buildPlanWithContext({
        message: retryMessage,
        headers,
        semanticProfile: sample?.semanticProfile || {},
        sampleRows,
        sheetId,
        activeTab,
        conversationHistory,
        memory,
        locale,
      });

      if (retryPlan?.ok) {
        compiledPlan = retryPlan;
      }
    }

    if (!compiledPlan?.ok && options.length === 1) {
      const auto = String(options[0].value || "");
      const retry = await buildPlanWithContext({
        message: `${planningMessage}\nResolved clarification: ${String(compiledPlan?.clarification_field || "selection")} = ${auto}`,
        headers,
        semanticProfile: sample?.semanticProfile || {},
        sampleRows,
        sheetId,
        activeTab,
        conversationHistory,
        memory,
        locale,
      });
      if (retry?.ok) compiledPlan = retry;
    }

    if (!compiledPlan?.ok) {
      const clarificationQuestion = localizeClarificationQuestion(String(compiledPlan?.clarification_question || "I need one clarification first."), locale);
      await deps.setPendingClarification(userKey, {
        originalQuestion: String(clarificationState.originalQuestion || rawMessage),
        resolvedAnswers: Array.isArray(clarificationState.resolvedAnswers) ? clarificationState.resolvedAnswers : [],
        question: clarificationQuestion,
        field: String(compiledPlan?.clarification_field || "selection"),
        options,
      });
      return res.json({
        answer: `${clarificationQuestion}\n${options.map((o, i) => `${i + 1}. ${o.label}`).join("\n")}`,
        actions: { reset_filters: false, filters: [], chart: null },
        preview_rows: [],
        meta: { phase: "clarification_required", options: options.map((o) => ({ value: o.value, label: o.label })) },
      });
    }
  } else if (!compiledPlan?.ok) {
    return res.json({
      answer: compiledPlan?.message || "I could not produce a safe deterministic plan.",
      actions: { reset_filters: false, filters: [], chart: null },
      preview_rows: [],
      meta: { phase: "planning_failed", reason: compiledPlan?.reason || "unknown" },
    });
  }

  await deps.clearPendingClarification(userKey);

  const full = await deps.loadAccessibleRows(sheetId, req.user, activeTab || null, null);
  if (full?.forbidden) return res.status(403).json({ error: "forbidden" });

  const result = deps.executeDeterministicSpreadsheetPlan({
    plan: compiledPlan,
    rows: Array.isArray(full?.rows) ? full.rows : [],
    filters: Array.isArray(activeFilters) ? activeFilters : [],
    userContext: {
      allowedColumns: Array.isArray(full?.allowedColumns) && full.allowedColumns.length ? full.allowedColumns : headers,
      userId,
      tenantId,
    },
  });

  if (!result?.ok) {
    return res.json({
      answer: result?.message || "Deterministic execution failed.",
      actions: { reset_filters: false, filters: [], chart: null },
      preview_rows: [],
      meta: { phase: "execution_failed", errorCode: result?.errorCode || "unknown", details: result?.details || null },
    });
  }

  const answer = deps.explainDeterministicResults({
    question: planningMessage,
    validatedPlan: compiledPlan,
    computed: result,
    warnings: [],
    memory,
    locale,
  });

  await deps.storeConversationAnalysisMemory({
    tenantId,
    userId,
    sheetId,
    memory: buildMemoryFromResult({ question: planningMessage, plan: compiledPlan, result }),
  });

  return res.json({
    answer,
    actions: { reset_filters: false, filters: [], chart: null },
    preview_rows: [],
    meta: {
      phase: "deterministic_v3",
      plan_operation: compiledPlan.operation,
      calculation_result: result,
      verification: compiledPlan?.verification || null,
    },
  });
}
