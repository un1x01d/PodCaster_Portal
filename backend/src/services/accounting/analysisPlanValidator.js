import { z } from "zod";
import { ALLOWED_SAFE_NEXT, ALLOWED_STEP_TYPES, MAX_ANALYSIS_STEPS, MAX_GROUP_BYS, MAX_RANK_LIMIT } from "./analysisPlanSchema.js";

const stepSchema = z.object({
  step_id: z.string().optional(),
  type: z.string(),
  metric: z.string().optional(),
  group_by: z.string().optional(),
  limit: z.number().int().positive().optional(),
}).passthrough();

const planSchema = z.object({
  safe_next_action: z.string(),
  confidence: z.string().optional(),
  group_bys: z.array(z.string()).optional(),
  analysis_steps: z.array(stepSchema).optional(),
}).passthrough();

export function validateAnalysisPlan({ plan, supportedMetrics = [], supportedCanonicalHeaders = [] }) {
  const warnings = [];
  const rejectedSteps = [];
  const parsed = planSchema.safeParse(plan);
  if (!parsed.success) return { ok: false, errorCode: "INVALID_ANALYSIS_PLAN", message: "The analysis plan was not safe to execute.", warnings, rejectedSteps };
  const p = parsed.data;
  if (!ALLOWED_SAFE_NEXT.has(String(p.safe_next_action || ""))) return { ok: false, errorCode: "INVALID_ANALYSIS_PLAN", message: "The analysis plan was not safe to execute.", warnings, rejectedSteps };
  if (String(p.confidence || "").toLowerCase() === "low") return { ok: false, errorCode: "INVALID_ANALYSIS_PLAN", message: "The analysis plan was not safe to execute.", warnings, rejectedSteps };
  if ((p.group_bys || []).length > MAX_GROUP_BYS) return { ok: false, errorCode: "INVALID_ANALYSIS_PLAN", message: "The analysis plan was not safe to execute.", warnings, rejectedSteps };
  const steps = Array.isArray(p.analysis_steps) ? p.analysis_steps : [];
  if (steps.length > MAX_ANALYSIS_STEPS) return { ok: false, errorCode: "INVALID_ANALYSIS_PLAN", message: "The analysis plan was not safe to execute.", warnings, rejectedSteps };
  const metricSet = new Set(supportedMetrics);
  const headerSet = new Set(supportedCanonicalHeaders);
  for (const step of steps) {
    if (!ALLOWED_STEP_TYPES.has(String(step?.type || ""))) { rejectedSteps.push(step); continue; }
    if (step?.metric && !metricSet.has(String(step.metric))) { rejectedSteps.push(step); continue; }
    if (step?.group_by && !headerSet.has(String(step.group_by))) { rejectedSteps.push(step); continue; }
    if (Number(step?.limit || 0) > MAX_RANK_LIMIT) { rejectedSteps.push(step); continue; }
  }
  if (rejectedSteps.length) return { ok: false, errorCode: "INVALID_ANALYSIS_PLAN", message: "The analysis plan was not safe to execute.", warnings, rejectedSteps };
  return { ok: true, approvedPlan: { ...p, analysis_steps: steps }, warnings, rejectedSteps };
}
