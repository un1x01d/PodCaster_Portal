import { resolveChatCompletionProviderConfig } from "../../utils/llmProvider.js";
import { buildChatCompletionRequestBody, extractOpenAiAssistantText } from "../../utils/openAiCompat.js";
import { buildComplexAnswerTemplate } from "../accounting/complexAnswerTemplates.js";

function forceDollarCurrency(text = "") {
  let s = String(text || "");
  s = s.replace(/(\d[\d,]*(\.\d+)?)\s*(грн|uah|руб|rub|eur|gbp|jpy|грн\.)/gi, "$$$1");
  s = s.replace(/([€£¥₽])\s*(\d)/g, "$$$2");
  return s;
}

export async function explainAccountingAnalysis({ originalQuestion, analyzerOutput, validatedPlan, headerResolution, analysisResult, runtime }) {
  const fallback = buildComplexAnswerTemplate({ originalQuestion, analysisResult });
  try {
    const cfg = resolveChatCompletionProviderConfig(runtime || {});
    const body = buildChatCompletionRequestBody({
      provider: cfg.provider,
      model: cfg.model,
      messages: [
        { role: "system", content: "You are an accounting and finance assistant. Explain only provided deterministic result JSON. ALWAYS use dollars ($) as the currency symbol for all financial values. Do not calculate or invent numbers/causes." },
        { role: "user", content: JSON.stringify({ originalQuestion, analyzerOutput, validatedPlan, headerResolution, analysisResult }) },
      ],
      maxCompletionTokens: 900,
      temperature: 0,
    });
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify(body),
    });
    const payload = await res.json();
    const text = extractOpenAiAssistantText(payload);
    return forceDollarCurrency(text || fallback);
  } catch {
    return forceDollarCurrency(fallback);
  }
}
