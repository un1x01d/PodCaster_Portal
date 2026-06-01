import { buildWorkbookProfile } from "./workbookProfiler.js";
import { buildSemanticCandidateHints } from "./semanticCandidateProvider.js";
import { buildAiPlanningContext } from "./aiPlanningContextBuilder.js";
import { callAiAnalystPlanner } from "./aiAnalystPlannerClient.js";
import { validateAiAnalysisPlan } from "./aiAnalysisPlanValidator.js";
import { repairPlanOnce } from "./planRepairService.js";
import { parseAiAnalysisPlan } from "./aiAnalysisPlanSchema.js";

function makeClarification(question, options = [], field = "") {
  return {
    ok: false,
    clarification_needed: true,
    reason: "ai_needs_clarification",
    clarification_question: String(question || "I can answer that, but I need one clarification first."),
    clarification_options: Array.isArray(options) ? options.map((o) => String(o?.value || o?.label || o)).filter(Boolean) : [],
    clarification_field: String(field || "").trim() || null,
  };
}

export async function buildDeterministicSpreadsheetPlan({
  message = "",
  headers = [],
  semanticProfile = {},
  sampleRows = [],
  hints = {},
}) {
  const question = String(message || "").trim();
  if (!question) {
    return {
      ok: false,
      clarification_needed: false,
      reason: "empty_question",
      message: "Please ask a question about this spreadsheet.",
    };
  }

  const dataset = buildWorkbookProfile({
    workbookId: hints?.sheetId || "sheet",
    sheetId: hints?.sheetId || "sheet",
    sheetName: hints?.activeTab || "Sheet",
    headers,
    rows: sampleRows,
    allowedColumns: headers,
  });

  const semanticCandidates = await buildSemanticCandidateHints({
    headers,
    question,
    profile: semanticProfile,
    groupId: hints?.groupId || null,
  });

  const planningContext = buildAiPlanningContext({
    question,
    dataset,
    semanticCandidates,
    knownMappings: semanticProfile?.headerMappings || {},
    memory: hints?.context || { last_successful_analysis: null },
  });

  let aiPlan = await callAiAnalystPlanner({
    planningContext,
    runtime: hints?.runtime || null,
    conversationHistory: hints?.conversationHistory || [],
    aiPlannerResponse: hints?.aiPlannerResponse || null,
  });

  const rawPlannerPlan = aiPlan;
  const parsed = parseAiAnalysisPlan(aiPlan);
  aiPlan = parsed.plan;

  if (!parsed.ok && !hints?.aiPlannerResponse) {
    const repairedFromSchema = await repairPlanOnce({
      planner: async ({ question: repairQuestion }) => callAiAnalystPlanner({
        planningContext: { ...planningContext, question: repairQuestion },
        runtime: hints?.runtime || null,
        conversationHistory: hints?.conversationHistory || [],
        aiPlannerResponse: hints?.aiPlannerFollowupResponse || null,
      }),
      planningContext,
      invalidPlan: rawPlannerPlan,
      validation: { details: parsed.errors || ["schema_validation_failed"] },
    });
    if (repairedFromSchema?.checked?.ok) {
      aiPlan = repairedFromSchema.repaired;
    }
  }

  let validation = validateAiAnalysisPlan({
    plan: aiPlan,
    datasetProfile: dataset,
    allowedOperations: planningContext.allowed_operations,
  });

  if (!validation.ok && !hints?.aiPlannerResponse) {
    const repaired = await repairPlanOnce({
      planner: async ({ question: repairQuestion }) => callAiAnalystPlanner({
        planningContext: { ...planningContext, question: repairQuestion },
        runtime: hints?.runtime || null,
        conversationHistory: hints?.conversationHistory || [],
        aiPlannerResponse: hints?.aiPlannerFollowupResponse || null,
      }),
      planningContext,
      invalidPlan: aiPlan,
      validation,
    });
    aiPlan = repaired.repaired;
    validation = repaired.checked;
  }

  if (!validation.ok) {
    return {
      ok: false,
      clarification_needed: false,
      reason: "ai_plan_validation_failed",
      message: `AI plan rejected by validator: ${String(validation.code || "invalid_plan")}.`,
      validation_details: validation.details || [],
    };
  }

  if (aiPlan.status === "needs_clarification") {
    const options = Array.isArray(aiPlan?.clarification?.options) ? aiPlan.clarification.options : [];
    if (options.length === 1) {
      return {
        ok: false,
        clarification_needed: true,
        reason: "auto_resolve_single_option",
        clarification_question: String(aiPlan?.clarification?.question || ""),
        clarification_options: [String(options[0]?.value || options[0]?.label || "")],
        clarification_field: String(aiPlan?.clarification?.field || ""),
        planner_state: {
          originalQuestion: question,
          partialPlan: aiPlan,
          clarificationField: String(aiPlan?.clarification?.field || "").trim() || null,
        },
      };
    }
    return makeClarification(aiPlan?.clarification?.question, options, aiPlan?.clarification?.field);
  }

  if (aiPlan.status === "not_answerable") {
    return {
      ok: false,
      clarification_needed: false,
      reason: "ai_not_answerable",
      message: String(aiPlan?.not_answerable?.reason || "This dataset cannot answer that safely."),
    };
  }

  return {
    ok: true,
    operation: "multi_step_analysis",
    metric: String(aiPlan?.analysis_plan?.steps?.[0]?.metric?.column || "value"),
    analysisPlan: aiPlan.analysis_plan,
    aiPlan,
    datasetProfile: dataset,
    verification: {
      method: "ai_analyst_planner_v3",
      confidence: aiPlan?.confidence === "high" ? 0.95 : (aiPlan?.confidence === "medium" ? 0.82 : 0.7),
      fallback_used: false,
      evidence: { steps: aiPlan?.analysis_plan?.steps?.length || 0, analysis_type: aiPlan?.analysis_plan?.analysis_type || null },
    },
  };
}
