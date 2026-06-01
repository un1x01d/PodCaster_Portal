import { generateStructuredCalculationPlan } from "./aiCalculationPlanner.js";


function tryParseJsonText(text = "") {
  const t = String(text || "").trim();
  if (!t) return null;
  try { return JSON.parse(t); } catch {}

  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    try { return JSON.parse(fenced[1]); } catch {}
  }

  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first >= 0 && last > first) {
    const slice = t.slice(first, last + 1);
    try { return JSON.parse(slice); } catch {}
  }
  return null;
}

function normalizePlannerPayload(raw) {
  if (raw && typeof raw === "object") return raw;
  const parsed = tryParseJsonText(raw);
  if (parsed && typeof parsed === "object") return parsed;
  // Keep raw payload so downstream schema parser can fail and trigger repair flow.
  return raw;
}

export async function callAiAnalystPlanner({ planningContext, runtime = null, conversationHistory = [], aiPlannerResponse = null }) {
  const raw = aiPlannerResponse || await generateStructuredCalculationPlan({
    question: String(planningContext?.question || ""),
    datasetContext: {
      dataset: planningContext?.dataset || {},
      semantic_candidates: planningContext?.semantic_candidates || {},
      known_mappings: planningContext?.known_mappings || {},
    },
    allowedOperations: planningContext?.allowed_operations || [],
    runtime,
    conversationHistory,
    memory: planningContext?.conversation_memory || null,
  });
  const normalizedRaw = normalizePlannerPayload(raw);
  return normalizedRaw;
}
