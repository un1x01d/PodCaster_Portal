import { resolveChatCompletionProviderConfig } from "../../utils/llmProvider.js";
import {
  buildChatCompletionRequestBody,
  extractOpenAiAssistantText,
  minCompletionTokensForModel,
} from "../../utils/openAiCompat.js";
import { parseAiPlanShape } from "./aiPlanSchema.js";
import { buildSpreadsheetPlannerSystemPrompt } from "./spreadsheetPlannerPrompt.js";

const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
const OPENAI_TIMEOUT_MS = Number.parseInt(process.env.OPENAI_TIMEOUT_MS || "60000", 10);

const CALC_PLAN_SCHEMA = {
  name: "spreadsheet_calculation_plan",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["status", "intent_summary", "confidence", "calculation_plan", "clarification", "not_answerable", "warnings"],
    properties: {
      status: { type: "string", enum: ["ready", "needs_clarification", "not_answerable"] },
      intent_summary: { type: "string" },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
      calculation_plan: {
        anyOf: [
          {
            type: "object",
            additionalProperties: false,
            required: [
              "analysis_type", "metric", "base_metric", "time_range", "comparison", 
              "filters", "group_by", "sort", "limit", "driver_columns", "dimensions", "output"
            ],
            properties: {
              analysis_type: { type: "string", enum: ["single_metric", "grouped_summary", "trend", "comparison", "variance", "margin", "explanation", "driver_analysis", "contribution_analysis", "ranking"] },
              metric: {
                anyOf: [
                  {
                    type: "object",
                    additionalProperties: false,
                    required: ["concept", "source_columns", "aggregation", "formula"],
                    properties: {
                      concept: { type: "string" },
                      source_columns: { type: "array", items: { type: "string" } },
                      aggregation: { type: "string", enum: ["sum", "count", "avg", "min", "max", "calculated"] },
                      formula: {
                        type: "object",
                        additionalProperties: false,
                        required: ["operation", "args"],
                        properties: {
                          operation: { type: "string", enum: ["sum", "subtract", "divide", "ratio", "none"] },
                          args: {
                            type: "array",
                            items: {
                              anyOf: [
                                { type: "string" },
                                { type: "number" },
                                { type: "boolean" },
                                { type: "null" }
                              ]
                            },
                          },
                        },
                      },
                    },
                  },
                  { type: "null" }
                ]
              },
              base_metric: {
                anyOf: [
                  {
                    type: "object",
                    additionalProperties: false,
                    required: ["business_concept", "source_columns", "aggregation"],
                    properties: {
                      business_concept: { type: "string" },
                      source_columns: { type: "array", items: { type: "string" } },
                      aggregation: { type: "string", enum: ["sum", "count", "avg", "min", "max", "calculated"] },
                    },
                  },
                  { type: "null" }
                ]
              },
              time_range: {
                type: "object",
                additionalProperties: false,
                required: ["type", "date_column", "start", "end", "label", "grain"],
                properties: {
                  type: { type: "string", enum: ["explicit", "month", "quarter", "year", "all_time", "none"] },
                  date_column: { anyOf: [{ type: "string" }, { type: "null" }] },
                  start: { anyOf: [{ type: "string" }, { type: "null" }] },
                  end: { anyOf: [{ type: "string" }, { type: "null" }] },
                  label: { anyOf: [{ type: "string" }, { type: "null" }] },
                  grain: { anyOf: [{ type: "string", enum: ["none", "day", "week", "month", "quarter", "year"] }, { type: "null" }] },
                },
              },
              comparison: {
                anyOf: [
                  {
                    type: "object",
                    additionalProperties: false,
                    required: [
                      "type", "period_grain", "baseline", "calculation", 
                      "baseline_label", "comparison_label", "baseline_range", "comparison_range", "date_column"
                    ],
                    properties: {
                      type: { type: "string", enum: ["none", "year_over_year", "period_over_period", "month_over_month", "quarter_over_quarter", "custom", "period_vs_period"] },
                      period_grain: { type: "string", enum: ["none", "month", "quarter", "year"] },
                      baseline: { type: "string", enum: ["previous_period", "previous_year", "custom", "none"] },
                      calculation: { type: "string", enum: ["absolute_change", "percent_change", "both", "none"] },
                      baseline_label: { anyOf: [{ type: "string" }, { type: "null" }] },
                      comparison_label: { anyOf: [{ type: "string" }, { type: "null" }] },
                      baseline_range: {
                        anyOf: [
                          {
                            type: "object",
                            additionalProperties: false,
                            required: ["start", "end"],
                            properties: { start: { type: "string" }, end: { type: "string" } }
                          },
                          { type: "null" }
                        ]
                      },
                      comparison_range: {
                        anyOf: [
                          {
                            type: "object",
                            additionalProperties: false,
                            required: ["start", "end"],
                            properties: { start: { type: "string" }, end: { type: "string" } }
                          },
                          { type: "null" }
                        ]
                      },
                      date_column: { anyOf: [{ type: "string" }, { type: "null" }] },
                    },
                  },
                  { type: "null" }
                ],
              },
              filters: {
                type: "array",
                items: {
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
                        { type: "null" },
                        {
                          type: "array",
                          items: {
                            anyOf: [
                              { type: "string" },
                              { type: "number" },
                              { type: "boolean" },
                              { type: "null" }
                            ]
                          },
                        },
                      ],
                    },
                  },
                },
              },
              group_by: { type: "array", items: { type: "string" } },
              sort: {
                anyOf: [
                  {
                    type: "object",
                    additionalProperties: false,
                    required: ["column", "by", "direction"],
                    properties: {
                      column: { anyOf: [{ type: "string" }, { type: "null" }] },
                      by: { anyOf: [{ type: "string" }, { type: "null" }] },
                      direction: { type: "string", enum: ["asc", "desc"] },
                    },
                  },
                  { type: "null" }
                ],
              },
              limit: { anyOf: [{ type: "integer" }, { type: "null" }] },
              driver_columns: { anyOf: [{ type: "array", items: { type: "string" } }, { type: "null" }] },
              dimensions: { anyOf: [{ type: "array", items: { type: "string" } }, { type: "null" }] },
              output: {
                anyOf: [
                  {
                    type: "object",
                    additionalProperties: false,
                    required: ["format"],
                    properties: { format: { type: "string" } },
                  },
                  { type: "null" }
                ]
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
            required: ["reason", "missing_data", "best_alternative"],
            properties: {
              reason: { type: "string" },
              missing_data: { type: "array", items: { type: "string" } },
              best_alternative: { anyOf: [{ type: "string" }, { type: "null" }] },
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
  return parseAiPlanShape(parsed);
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
  const effectiveMaxTokens = minCompletionTokensForModel(model, 900, 900, 900);

  const userPayload = {
    question: String(question || ""),
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
        name: CALC_PLAN_SCHEMA.name,
        schema: CALC_PLAN_SCHEMA.schema,
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
      const body = await resp.text().catch(() => "");
      throw new Error(`planner_upstream_error:${resp.status}:${body}`);
    }
    const data = await resp.json();
    const text = extractOpenAiAssistantText(data);
    const parsed = JSON.parse(text || "{}");
    return normalizePlannerResponse(parsed);
  } finally {
    clearTimeout(timeout);
  }
}
