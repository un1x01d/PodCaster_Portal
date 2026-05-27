import { z } from "zod";

const AGG = ["sum", "count", "avg", "min", "max", "calculated"];
const OP = ["aggregate", "period_delta", "year_over_year", "period_driver_delta", "period_delta_by_dimension", "ranking", "trend", "ratio", "margin", "variance"];
const FILTER_OP = ["=", "!=", ">", ">=", "<", "<=", "between", "in", "contains"];

const metricSchema = z.object({
  column: z.string().default(""),
  aggregation: z.enum(AGG).default("sum"),
});

const filterSchema = z.object({
  column: z.string().default(""),
  operator: z.enum(FILTER_OP).default("="),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number(), z.boolean()]))]),
});

const stepSchema = z.object({
  step_id: z.string().min(1),
  operation: z.enum(OP),
  metric: metricSchema.nullable().optional().default(null),
  metrics: z.array(metricSchema).optional().default([]),
  driver_columns: z.array(z.string()).optional().default([]),
  dimension: z.string().nullable().optional().default(null),
  date_column: z.string().nullable().optional().default(null),
  filters: z.array(filterSchema).optional().default([]),
  baseline_range: z.tuple([z.string(), z.string()]).nullable().optional().default(null),
  comparison_range: z.tuple([z.string(), z.string()]).nullable().optional().default(null),
  time_range: z.tuple([z.string(), z.string()]).nullable().optional().default(null),
  grain: z.enum(["none", "day", "week", "month", "quarter", "year"]).optional().default("none"),
  group_by: z.array(z.string()).optional().default([]),
  sort: z.object({ by: z.string().default("metric"), direction: z.enum(["asc", "desc"]).default("desc") }).nullable().optional().default(null),
  limit: z.number().int().positive().max(100).nullable().optional().default(null),
});

export const aiAnalysisPlanSchema = z.object({
  status: z.enum(["ready", "needs_clarification", "not_answerable"]).default("not_answerable"),
  intent_summary: z.string().default(""),
  confidence: z.enum(["high", "medium", "low"]).default("low"),
  analysis_plan: z.object({
    analysis_type: z.enum(["single_metric", "comparison", "trend", "driver_analysis", "contribution_analysis", "ranking", "explanation"]),
    steps: z.array(stepSchema).default([]),
    final_response_instruction: z.object({
      style: z.enum(["business_explanation", "concise_number", "table_summary", "chart_summary"]).default("business_explanation"),
      include_tables: z.boolean().default(true),
      include_causation_warning: z.boolean().default(true),
    }).optional().default({ style: "business_explanation", include_tables: true, include_causation_warning: true }),
  }).nullable().optional().default(null),
  clarification: z.object({
    field: z.string().default(""),
    question: z.string().default(""),
    options: z.array(z.object({ number: z.number().int(), label: z.string(), value: z.string() })).default([]),
  }).nullable().optional().default(null),
  not_answerable: z.object({
    reason: z.string().default(""),
    missing_data: z.array(z.string()).default([]),
    best_available_alternative: z.string().nullable().optional().default(null),
  }).nullable().optional().default(null),
  warnings: z.array(z.string()).default([]),
});

export function parseAiAnalysisPlan(input) {
  const parsed = aiAnalysisPlanSchema.safeParse(input || {});
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => `${i.path.join(".") || "root"}:${i.message}`),
      plan: {
        status: "not_answerable",
        intent_summary: "Invalid planner response",
        confidence: "low",
        analysis_plan: null,
        clarification: null,
        not_answerable: { reason: "Planner response failed schema validation.", missing_data: [], best_available_alternative: null },
        warnings: ["schema_validation_failed"],
      },
    };
  }
  return { ok: true, errors: [], plan: parsed.data };
}
