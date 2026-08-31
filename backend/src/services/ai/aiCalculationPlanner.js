import { resolveChatCompletionProviderConfig } from "../../utils/llmProvider.js";
import {
  buildChatCompletionRequestBody,
  extractOpenAiAssistantText,
  minCompletionTokensForModel,
} from "../../utils/openAiCompat.js";
import { buildSpreadsheetPlannerSystemPrompt } from "./spreadsheetPlannerPrompt.js";

const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
const OPENAI_TIMEOUT_MS = Number.parseInt(process.env.OPENAI_TIMEOUT_MS || "60000", 10);

const metricSchema = {
  type: "object",
  additionalProperties: false,
  required: ["column", "aggregation"],
  properties: {
    column: { type: "string" },
    aggregation: { type: "string", enum: ["sum", "count", "avg", "min", "max", "calculated"] },
  },
};

const filterSchema = {
  type: "object",
  additionalProperties: false,
  required: ["column", "operator", "value"],
  properties: {
    column: { type: "string" },
    operator: { type: "string", enum: ["=", "!=", ">", ">=", "<", "<=", "between", "in", "contains"] },
    value: {
      anyOf: [
        { type: "string" },
        { type: "number" },
        { type: "boolean" },
        { type: "array", items: { anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }] } },
      ],
    },
  },
};

const stepSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "step_id", "operation", "metric", "metrics", "driver_columns", "dimension", "date_column",
    "filters", "baseline_range", "comparison_range", "time_range", "grain", "group_by", "sort", "limit",
  ],
  properties: {
    step_id: { type: "string" },
    operation: { type: "string", enum: ["aggregate", "period_delta", "year_over_year", "period_driver_delta", "period_delta_by_dimension", "ranking", "trend", "ratio", "margin", "variance"] },
    metric: { anyOf: [metricSchema, { type: "null" }] },
    metrics: { type: "array", items: metricSchema },
    driver_columns: { type: "array", items: { type: "string" } },
    dimension: { anyOf: [{ type: "string" }, { type: "null" }] },
    date_column: { anyOf: [{ type: "string" }, { type: "null" }] },
    filters: { type: "array", items: filterSchema },
    baseline_range: { anyOf: [{ type: "array", minItems: 2, maxItems: 2, items: { type: "string" } }, { type: "null" }] },
    comparison_range: { anyOf: [{ type: "array", minItems: 2, maxItems: 2, items: { type: "string" } }, { type: "null" }] },
    time_range: { anyOf: [{ type: "array", minItems: 2, maxItems: 2, items: { type: "string" } }, { type: "null" }] },
    grain: { type: "string", enum: ["none", "day", "week", "month", "quarter", "year"] },
    group_by: { type: "array", items: { type: "string" } },
    sort: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["by", "direction"],
          properties: {
            by: { type: "string" },
            direction: { type: "string", enum: ["asc", "desc"] },
          },
        },
        { type: "null" },
      ],
    },
    limit: { anyOf: [{ type: "integer", minimum: 1, maximum: 100 }, { type: "null" }] },
  },
};

const ANALYSIS_PLAN_SCHEMA = {
  name: "spreadsheet_analysis_plan",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["status", "intent_summary", "confidence", "analysis_plan", "clarification", "not_answerable", "warnings"],
    properties: {
      status: { type: "string", enum: ["ready", "needs_clarification", "not_answerable"] },
      intent_summary: { type: "string" },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
      analysis_plan: {
        anyOf: [
          {
            type: "object",
            additionalProperties: false,
            required: ["analysis_type", "steps", "final_response_instruction"],
            properties: {
              analysis_type: { type: "string", enum: ["single_metric", "comparison", "trend", "driver_analysis", "contribution_analysis", "ranking", "explanation"] },
              steps: { type: "array", items: stepSchema },
              final_response_instruction: {
                type: "object",
                additionalProperties: false,
                required: ["style", "include_tables", "include_causation_warning"],
                properties: {
                  style: { type: "string", enum: ["business_explanation", "concise_number", "table_summary", "chart_summary"] },
                  include_tables: { type: "boolean" },
                  include_causation_warning: { type: "boolean" },
                },
              },
            },
          },
          { type: "null" },
        ],
      },
      clarification: {
        anyOf: [
          {
            type: "object",
            additionalProperties: false,
            required: ["field", "question", "options"],
            properties: {
              field: { type: "string" },
              question: { type: "string" },
              options: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["number", "label", "value"],
                  properties: {
                    number: { type: "integer" },
                    label: { type: "string" },
                    value: { type: "string" },
                  },
                },
              },
            },
          },
          { type: "null" },
        ],
      },
      not_answerable: {
        anyOf: [
          {
            type: "object",
            additionalProperties: false,
            required: ["reason", "missing_data", "best_available_alternative"],
            properties: {
              reason: { type: "string" },
              missing_data: { type: "array", items: { type: "string" } },
              best_available_alternative: { anyOf: [{ type: "string" }, { type: "null" }] },
            },
          },
          { type: "null" },
        ],
      },
      warnings: { type: "array", items: { type: "string" } },
    },
  },
};

function normalizePlannerResponse(parsed) {
  if (!parsed || typeof parsed !== "object") throw new Error("planner_invalid_json");
  return parsed;
}

export async function generateStructuredCalculationPlan({
  question = "",
  datasetContext = {},
  allowedOperations = [],
  runtime = null,
  conversationHistory = [],
  memory = null,
}) {
  const { provider, model, baseUrl, apiKey } = resolveChatCompletionProviderConfig(runtime);
  if (!apiKey) throw new Error("no_api_key");
  const timeoutMs = Number(runtime?.openaiTimeoutMs || OPENAI_TIMEOUT_MS);
  const safeTemperature = 0;
  const effectiveMaxTokens = minCompletionTokensForModel(model, 1800, 1800, 1800);

  const userPayload = {
    question: String(question || ""),
    requested_response_language: String(runtime?.locale || "en"),
    dataset_context: datasetContext,
    allowed_operations: Array.isArray(allowedOperations) ? allowedOperations : [],
    conversation_history: Array.isArray(conversationHistory) ? conversationHistory.slice(-8) : [],
    memory: memory || null,
  };

  const requestBody = buildChatCompletionRequestBody({
    provider,
    model,
    maxCompletionTokens: effectiveMaxTokens,
    temperature: safeTemperature,
    responseFormat: {
      type: "json_schema",
      json_schema: {
        name: ANALYSIS_PLAN_SCHEMA.name,
        schema: ANALYSIS_PLAN_SCHEMA.schema,
        strict: true,
      },
    },
    messages: [
      { role: "system", content: buildSpreadsheetPlannerSystemPrompt() },
      { role: "user", content: JSON.stringify(userPayload) },
    ],
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const targetUrl = `${String(baseUrl || OPENAI_BASE_URL).replace(/\/+$/, "")}/chat/completions`;
  try {
    const resp = await fetch(targetUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
    if (!resp.ok) {
      throw new Error(`planner_upstream_error:${resp.status}`);
    }
    const data = await resp.json();
    const text = extractOpenAiAssistantText(data);
    const parsed = JSON.parse(text || "{}");
    return normalizePlannerResponse(parsed);
  } finally {
    clearTimeout(timeout);
  }
}
