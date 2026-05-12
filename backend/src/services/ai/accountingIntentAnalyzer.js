import { findRequestedCanonicalTerms } from "./accountingGlossary.js";
import { buildChatCompletionRequestBody, extractOpenAiAssistantText } from "../../utils/openAiCompat.js";
import { resolveChatCompletionProviderConfig } from "../../utils/llmProvider.js";
import { checkPhraseOverride } from "./semanticKnowledgeService.js";

const DEFAULT_OUTPUT = {
  intent: "unknown",
  question_type: "unknown",
  accounting_topic: "unknown",
  metric_requested: null,
  requires_data: true,
  requires_calculation: false,
  period_requested: null,
  comparison_period: null,
  group_by: null,
  filters: [],
  requested_terms: [],
  required_canonical_headers: [],
  optional_canonical_headers: [],
  ambiguity_level: "low",
  missing_information: [],
  user_question_rewritten: "",
  safe_next_action: "ask_followup",
  confidence: "medium",
};

function safeJsonParse(raw = "") {
  try { return JSON.parse(raw); } catch { return null; }
}

function validateShape(obj) {
  if (!obj || typeof obj !== "object") return false;
  return typeof obj.intent === "string" && typeof obj.safe_next_action === "string" && Array.isArray(obj.requested_terms);
}

export async function analyzeAccountingIntent({ message = "", runtime = {} }) {
  const locale = runtime?.locale || "en";
  const override = await checkPhraseOverride(message, locale);
  const quickTerms = await findRequestedCanonicalTerms(message);

  if (override) {
    return {
      ...DEFAULT_OUTPUT,
      intent: override.intent,
      safe_next_action: "execute_deterministic_plan",
      ...(override.payload || {}),
      requested_terms: Array.from(new Set([...(override.payload?.requested_terms || []), ...quickTerms])),
      confidence: "high",
      is_override: true,
    };
  }

  const isAccounting = quickTerms.length > 0 || /\b(revenue|profit|margin|expense|cogs|income|payable|receivable|budget|actual|variance|sales|cash)\b/i.test(String(message));
  if (!isAccounting) return { ...DEFAULT_OUTPUT, requested_terms: quickTerms, safe_next_action: "continue_default_chat" };

  const providerConfig = resolveChatCompletionProviderConfig(runtime);
  const system = `Classify accounting/finance user intent. Return strict JSON only.
  Available Metric Keys:
  - Finance: total_revenue, total_expense, net_income, gross_margin_pct, cash
  - Trucking: trucking_rpm (Rate Per Mile), fuel_efficiency
  - Manufacturing: mfg_unit_cost, inventory_turnover
  - Real Estate: re_noi (Net Operating Income), re_cap_rate
  `;

  const user = `Message: ${message}`;
  const schemaHint = JSON.stringify(DEFAULT_OUTPUT, null, 2);
  try {
    const body = buildChatCompletionRequestBody({
      provider: providerConfig.provider,
      model: providerConfig.model,
      messages: [{ role: "system", content: `${system}\nJSON shape:\n${schemaHint}` }, { role: "user", content: user }],
      responseFormat: { type: "json_object" },
      maxCompletionTokens: 700,
      temperature: 0,
    });
    const response = await fetch(`${providerConfig.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${providerConfig.apiKey}` },
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    const text = extractOpenAiAssistantText(payload);
    const parsed = safeJsonParse(text);
    if (!validateShape(parsed)) return { ...DEFAULT_OUTPUT, requested_terms: quickTerms, safe_next_action: "ask_followup" };
    return { ...DEFAULT_OUTPUT, ...parsed, requested_terms: Array.from(new Set([...(parsed.requested_terms || []), ...quickTerms])) };
  } catch {
    return { ...DEFAULT_OUTPUT, requested_terms: quickTerms, safe_next_action: "ask_followup" };
  }
}
