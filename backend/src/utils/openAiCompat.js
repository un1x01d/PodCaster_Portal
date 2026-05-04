export function isGpt5Family(model) {
  return /^gpt-5/i.test(String(model || ""));
}

export function getReasoningEffortForModel(model) {
  const name = String(model || "").toLowerCase();
  if (!name.startsWith("gpt-5")) return null;
  return name.startsWith("gpt-5.1") ? "none" : "minimal";
}

export function minCompletionTokensForModel(model, requested, fallback = 800, gpt5Minimum = 768) {
  const raw = Number(requested);
  const base = Number.isFinite(raw) && raw > 0 ? raw : Number(fallback);
  const normalized = Number.isFinite(base) && base > 0 ? base : fallback;
  return isGpt5Family(model) ? Math.max(gpt5Minimum, normalized) : normalized;
}

export function buildChatCompletionRequestBody({
  model,
  messages,
  provider = "openai",
  responseFormat = null,
  maxCompletionTokens = null,
  temperature = null,
}) {
  const normalizedProvider = String(provider || "openai").trim().toLowerCase();
  const isOpenAiProvider = normalizedProvider === "openai";
  const body = {
    model,
    messages,
  };
  const maxTokens = Number(maxCompletionTokens);
  if (Number.isFinite(maxTokens) && maxTokens > 0) {
    if (isOpenAiProvider) {
      body.max_completion_tokens = Math.floor(maxTokens);
    } else {
      body.max_tokens = Math.floor(maxTokens);
    }
  }
  if (responseFormat) {
    body.response_format = !isOpenAiProvider && responseFormat?.type === "json_schema"
      ? { type: "json_object" }
      : responseFormat;
  }

  const reasoningEffort = isOpenAiProvider ? getReasoningEffortForModel(model) : null;
  if (reasoningEffort) {
    body.reasoning_effort = reasoningEffort;
  } else {
    const temp = Number(temperature);
    if (Number.isFinite(temp)) body.temperature = temp;
  }
  return body;
}

export function collectTextParts(node, acc = []) {
  if (node === null || node === undefined) return acc;
  if (typeof node === "string") {
    if (node.trim()) acc.push(node);
    return acc;
  }
  if (typeof node === "number" || typeof node === "boolean") {
    acc.push(String(node));
    return acc;
  }
  if (Array.isArray(node)) {
    node.forEach((entry) => collectTextParts(entry, acc));
    return acc;
  }
  if (typeof node === "object") {
    collectTextParts(node.text, acc);
    collectTextParts(node.content, acc);
    collectTextParts(node.output_text, acc);
    collectTextParts(node.value, acc);
    collectTextParts(node.arguments, acc);
    collectTextParts(node.refusal, acc);
    collectTextParts(node.message, acc);
    collectTextParts(node.delta, acc);
  }
  return acc;
}

export function extractOpenAiAssistantText(payload) {
  const choice = payload?.choices?.[0];
  const message = choice?.message;
  const parts = [];
  collectTextParts(message?.content, parts);
  collectTextParts(message?.output_text, parts);
  collectTextParts(choice?.text, parts);
  collectTextParts(payload?.output_text, parts);
  collectTextParts(payload?.output, parts);
  if (Array.isArray(message?.tool_calls)) {
    message.tool_calls.forEach((call) => collectTextParts(call?.function?.arguments, parts));
  }
  return parts.join("").trim();
}

export function getOpenAiResponseDiagnostics(payload) {
  const choice = payload?.choices?.[0];
  const message = choice?.message;
  const content = message?.content;
  const usage = payload?.usage || {};
  const details = usage?.completion_tokens_details || usage?.output_tokens_details || {};
  return [
    `keys=${Object.keys(payload || {}).slice(0, 12).join(",")}`,
    `choices=${Array.isArray(payload?.choices) ? payload.choices.length : "n/a"}`,
    `finish_reason=${choice?.finish_reason || "n/a"}`,
    `message_keys=${message && typeof message === "object" ? Object.keys(message).join(",") : "n/a"}`,
    `content_type=${Array.isArray(content) ? "array" : typeof content}`,
    `prompt_tokens=${Number(usage.prompt_tokens || usage.input_tokens || 0)}`,
    `completion_tokens=${Number(usage.completion_tokens || usage.output_tokens || 0)}`,
    `reasoning_tokens=${Number(details.reasoning_tokens || 0)}`,
  ].join(";");
}
