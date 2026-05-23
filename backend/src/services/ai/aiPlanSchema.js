import { z } from "zod";

const scalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const filterSchema = z.object({
  column: z.string().default(""),
  operator: z.string().default("="),
  value: z.union([scalar, z.array(scalar)]).default(null),
});

const calcPlanSchema = z.object({
  analysis_type: z.string().default("single_metric"),
  metric: z.object({
    concept: z.string().optional().default(""),
    source_columns: z.array(z.string()).optional().default([]),
    aggregation: z.string().optional().default("sum"),
    formula: z.object({
      operation: z.string().default("none"),
      args: z.array(scalar).default([]),
    }).optional().default({ operation: "none", args: [] }),
  }).nullable().optional().default(null),
  base_metric: z.object({
    business_concept: z.string().optional().default(""),
    source_columns: z.array(z.string()).optional().default([]),
    aggregation: z.string().optional().default("sum"),
  }).nullable().optional().default(null),
  time_range: z.object({
    type: z.string().default("none"),
    date_column: z.string().nullable().optional().default(null),
    start: z.string().nullable().optional().default(null),
    end: z.string().nullable().optional().default(null),
    label: z.string().nullable().optional().default(null),
    grain: z.string().nullable().optional().default(null),
  }).optional().default({ type: "none" }),
  comparison: z.object({
    type: z.string().default("none"),
    period_grain: z.string().optional().default("none"),
    baseline: z.string().optional().default("none"),
    calculation: z.string().optional().default("none"),
    baseline_label: z.string().nullable().optional().default(null),
    comparison_label: z.string().nullable().optional().default(null),
    baseline_range: z.object({ start: z.string(), end: z.string() }).nullable().optional().default(null),
    comparison_range: z.object({ start: z.string(), end: z.string() }).nullable().optional().default(null),
    date_column: z.string().nullable().optional().default(null),
  }).nullable().optional().default(null),
  filters: z.array(filterSchema).optional().default([]),
  group_by: z.array(z.string()).optional().default([]),
  sort: z.object({
    column: z.string().nullable().optional().default(null),
    by: z.string().nullable().optional().default(null),
    direction: z.string().default("desc"),
  }).nullable().optional().default(null),
  limit: z.number().int().nullable().optional().default(5),
  driver_columns: z.array(z.string()).nullable().optional().default([]),
  dimensions: z.array(z.string()).nullable().optional().default([]),
  output: z.object({ format: z.string().default("text") }).nullable().optional().default(null),
});

export const aiPlanSchema = z.object({
  status: z.string().default("ready"),
  intent_summary: z.string().default(""),
  confidence: z.string().default("medium"),
  calculation_plan: calcPlanSchema.nullable().optional().default(null),
  clarification: z.object({
    field: z.string().default(""),
    question: z.string().default(""),
    options: z.array(z.object({
      number: z.number().int(),
      label: z.string(),
      value: z.string(),
    })).default([]),
  }).nullable().optional().default(null),
  not_answerable: z.object({
    reason: z.string().default(""),
    missing_data: z.array(z.string()).default([]),
    best_alternative: z.string().nullable().optional().default(null),
  }).nullable().optional().default(null),
  warnings: z.array(z.string()).default([]),
});

export function parseAiPlanShape(input) {
  try {
    return aiPlanSchema.parse(input || {});
  } catch (e) {
    console.error("[aiPlanSchema] parse_failed", e);
    // Return a safe 'not_answerable' fallback if parsing fails completely
    return {
      status: "not_answerable",
      intent_summary: "Parsing failure",
      confidence: "low",
      calculation_plan: null,
      clarification: null,
      not_answerable: { reason: "Internal parsing error of AI response.", missing_data: [], best_alternative: null },
      warnings: ["Technical validation failed."]
    };
  }
}
