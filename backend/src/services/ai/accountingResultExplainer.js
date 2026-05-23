import { resolveChatCompletionProviderConfig } from "../../utils/llmProvider.js";
import { buildChatCompletionRequestBody, extractOpenAiAssistantText } from "../../utils/openAiCompat.js";
import { buildSimpleDeterministicAnswer } from "../accounting/simpleAnswerTemplates.js";

export async function explainAccountingResult({ originalQuestion, analysis, headerResolution, calculationResult, runtime }) {
  const fallback = buildSimpleDeterministicAnswer({ metric: calculationResult?.metric, result: calculationResult, periodLabel: calculationResult?.period?.label || "selected period" });
  try {
    const providerConfig = resolveChatCompletionProviderConfig(runtime || {});
    const prompt = {
      originalQuestion,
      analysis,
      headerResolution,
      calculationResult,
    };
    const body = buildChatCompletionRequestBody({
      provider: providerConfig.provider,
      model: providerConfig.model,
      messages: [
        { 
          role: "system", 
          content: `You are an accounting and finance assistant. Your goal is to explain the provided calculation results in a concise, professional, and conversational narrative. 
          - Respond in the language requested (${runtime?.locale || 'en'}). 
          - ALWAYS use dollars ($) as the currency symbol for all financial values, regardless of the language.
          - Do not invent new numbers. Do not mention "calculation_result" or "JSON".
          - Focus on the key metric, the period, and any significant notes. 
          - Maximum 2 sentences.` 
        }, 
        { 
          role: "user", 
          content: `Question: ${originalQuestion}\nData: ${JSON.stringify(calculationResult)}` 
        }
      ],
      maxCompletionTokens: 500,
      temperature: 0,
    });

    const res = await fetch(`${providerConfig.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${providerConfig.apiKey}` },
      body: JSON.stringify(body),
    });
    const payload = await res.json();
    const text = extractOpenAiAssistantText(payload);
    return text || fallback;
  } catch {
    return fallback;
  }
}
