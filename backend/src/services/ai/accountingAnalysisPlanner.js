import { resolveChatCompletionProviderConfig } from "../../utils/llmProvider.js";
import { buildChatCompletionRequestBody, extractOpenAiAssistantText } from "../../utils/openAiCompat.js";

const FALLBACK = {
  question_type: "unknown",
  answer_depth: "diagnostic",
  primary_metric: null,
  period: null,
  comparison_period: null,
  required_metrics: [],
  optional_driver_metrics: [],
  required_canonical_headers: [],
  optional_canonical_headers: [],
  group_bys: [],
  analysis_steps: [],
  safe_next_action: "ask_followup",
  needs_followup: true,
  missing_information: ["Please clarify period and metric focus."],
  confidence: "medium",
};

function safeParse(raw = "") { try { return JSON.parse(raw); } catch { return null; } }

export async function buildAccountingAnalysisPlan({ message, analyzerResult, availableHeaders, cachedFieldMetadata, supportedMetricKeys, metricHeaderRequirements, complexQuestionRequirements, runtime }) {
  const providerConfig = resolveChatCompletionProviderConfig(runtime || {});
  const prompt = {
    message,
    analyzerResult,
    availableHeaders,
    cachedFieldMetadata: cachedFieldMetadata || {},
    supportedMetricKeys,
    metricHeaderRequirements,
    complexQuestionRequirements,
  };
  try {
    const body = buildChatCompletionRequestBody({
      provider: providerConfig.provider,
      model: providerConfig.model,
      messages: [
        { role: "system", content: "You are an accounting and finance analysis planner. Return strict JSON only. Do not calculate numbers. Do not invent data, headers, formulas, or unrestricted raw data access." },
        { role: "user", content: JSON.stringify(prompt) },
      ],
      responseFormat: { type: "json_object" },
      maxCompletionTokens: 1000,
      temperature: 0,
    });
    const response = await fetch(`${providerConfig.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${providerConfig.apiKey}` },
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    const parsed = safeParse(extractOpenAiAssistantText(payload));
    if (!parsed || typeof parsed !== "object") return FALLBACK;
    return { ...FALLBACK, ...parsed };
  } catch {
    return FALLBACK;
  }
}
