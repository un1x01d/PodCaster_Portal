import { validateAiAnalysisPlan } from "./aiAnalysisPlanValidator.js";

export async function repairPlanOnce({ planner, planningContext, invalidPlan, validation }) {
  const originalQuestion = String(planningContext?.question || "").trim();
  const repairQuestion = [
    originalQuestion ? `Original user question: ${originalQuestion}` : "",
    "Your previous plan failed backend validation.",
    `Validation errors: ${(validation?.details || []).join(", ")}`,
    `Previous invalid plan JSON: ${JSON.stringify(invalidPlan || {})}`,
    "Return corrected strict JSON only.",
    "Keep the same user intent, metric, and period goal.",
    "Do not output SQL/JavaScript.",
  ].filter(Boolean).join("\n");

  const repaired = await planner({
    ...planningContext,
    question: repairQuestion,
  });

  const checked = validateAiAnalysisPlan({
    plan: repaired,
    datasetProfile: planningContext.dataset,
    allowedOperations: planningContext.allowed_operations,
  });

  return { repaired, checked };
}
