const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";
const GEMINI_DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
const OLLAMA_DEFAULT_BASE_URL = "http://localhost:11434/v1";

function normalizeOllamaFlag(v) {
  return String(v || "").trim().toLowerCase() === "true";
}

function isOllamaEnabled() {
  return normalizeOllamaFlag(process.env.ALLOW_OLLAMA_PROVIDER) || normalizeOllamaFlag(process.env.OLLAMA_ENABLED);
}

function sanitizeBaseUrl(raw, fallback) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return String(fallback || "").replace(/\/+$/, "");

  const normalized = trimmed.endsWith("/") ? trimmed.replace(/\/+$/, "") : trimmed;
  const withProtocol = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(normalized)
    ? normalized
    : `https://${normalized}`;

  try {
    const url = new URL(withProtocol);
    if (!url.hostname) return String(fallback || "").replace(/\/+$/, "");
    return url.origin + url.pathname.replace(/\/+$/, "");
  } catch {
    return String(fallback || "").replace(/\/+$/, "");
  }
}

function safeHostname(raw = "") {
  try {
    const normalized = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(String(raw || "").trim())
      ? String(raw || "").trim()
      : `https://${String(raw || "").trim()}`;
    return new URL(normalized).hostname || "";
  } catch {
    return "";
  }
}

function auditAiUrlPolicyDeny(metadata = {}) {
  Promise.resolve()
    .then(() => import("../config/db.js"))
    .then(({ query }) => query(
      `INSERT INTO audit_logs (action, resource_type, resource_id, metadata)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [
        "ai_runtime.url_policy_denied",
        "ai_runtime",
        "provider_base_url",
        JSON.stringify(metadata || {}),
      ]
    ))
    .catch(() => {});
}

function isOllamaBaseUrl(raw) {
  const value = String(raw || "").toLowerCase();
  return value.includes("localhost:11434") || value.includes("127.0.0.1:11434") || value.includes("ollama");
}

function looksLikeOpenAiModel(raw = "") {
  const model = String(raw || "").trim().toLowerCase();
  if (!model) return false;
  return model.includes("gpt") || model.startsWith("o1-") || model.startsWith("o3-") || model.startsWith("chatgpt") || model.startsWith("text-");
}

function looksLikeGeminiModel(raw = "") {
  const model = String(raw || "").trim().toLowerCase();
  if (!model) return false;
  return model.includes("gemini") || model.includes("palm") || model.includes("models/");
}

function looksLikeOllamaModel(raw = "") {
  const model = String(raw || "").trim().toLowerCase();
  if (!model) return false;
  return model.includes("llama") || model.includes("mistral") || model.includes("mixtral") || model.includes("qwen")
    || model.includes("phi") || model.includes("gemma") || model.includes("yi") || model.includes("mistral-small")
    || model.includes("qwen2") || model.includes("dbrx") || model.includes("orca") || model.includes("nous");
}

function normalizeModelForProvider(provider, model, fallbackModel = "") {
  const normalized = String(model || "").trim();
  if (!normalized) return String(fallbackModel || "").trim();
  const fallback = String(fallbackModel || "").trim();
  if (provider === "openai" && (looksLikeOllamaModel(normalized) || looksLikeGeminiModel(normalized))) return fallback;
  if (provider === "gemini" && (looksLikeOllamaModel(normalized) || looksLikeOpenAiModel(normalized))) return fallback;
  if (provider === "ollama" && (looksLikeGeminiModel(normalized) || looksLikeOpenAiModel(normalized))) return fallback;
  return normalized;
}

export function normalizeAiProvider(provider = "") {
  const value = String(provider || "").trim().toLowerCase();
  if (value === "gemini" || value === "google" || value === "google_gemini") return "gemini";
  if ((value === "ollama" || value === "local") && isOllamaEnabled()) return "ollama";
  return "openai";
}

export function inferAiProvider({ provider = "", baseUrl = "", model = "" } = {}) {
  const explicit = String(provider || "").trim();
  if (explicit) return normalizeAiProvider(explicit);
  const url = String(baseUrl || "").toLowerCase();
  const name = String(model || "").toLowerCase();
  if (url.includes("generativelanguage.googleapis.com") || name.startsWith("gemini")) return "gemini";
  if (isOllamaEnabled() && (url.includes("localhost:11434") || url.includes("127.0.0.1:11434") || url.includes("ollama"))) return "ollama";
  return "openai";
}

export function defaultModelForProvider(provider = "openai") {
  const normalized = normalizeAiProvider(provider);
  if (normalized === "gemini") return String(process.env.GEMINI_MODEL || "gemini-2.5-flash").trim();
  if (normalized === "ollama") return String(process.env.OLLAMA_MODEL || "llama3.2").trim();
  return String(process.env.OPENAI_MODEL || "gpt-5-nano").trim();
}

export function defaultBaseUrlForProvider(provider = "openai") {
  const normalized = normalizeAiProvider(provider);
  if (normalized === "gemini") {
    return sanitizeBaseUrl(process.env.GEMINI_BASE_URL, GEMINI_DEFAULT_BASE_URL);
  }
  if (normalized === "ollama") {
    return sanitizeBaseUrl(process.env.OLLAMA_BASE_URL, OLLAMA_DEFAULT_BASE_URL);
  }
  return sanitizeBaseUrl(process.env.OPENAI_BASE_URL, OPENAI_DEFAULT_BASE_URL);
}

export function apiKeyForProvider(provider = "openai") {
  const normalized = normalizeAiProvider(provider);
  if (normalized === "gemini") return String(process.env.GEMINI_API_KEY || "").trim();
  if (normalized === "ollama") return String(process.env.OLLAMA_API_KEY || "ollama").trim();
  return String(process.env.OPENAI_API_KEY || "").trim();
}

export function resolveChatCompletionProviderConfig(runtime = {}, modelOverride = null) {
  const provider = normalizeAiProvider(runtime?.aiProvider || process.env.AI_PROVIDER || process.env.LLM_PROVIDER || "");
  const providerRuntimeConfig = runtime?.providerConfigs?.[provider] || {};
  const model = normalizeModelForProvider(
    provider,
    modelOverride || providerRuntimeConfig.model || runtime?.openaiModel,
    providerRuntimeConfig.model || defaultModelForProvider(provider)
  );
  const candidateBaseUrl = providerRuntimeConfig.baseUrl || runtime?.openaiBaseUrl;
  const policyBlockedOllamaForOpenAi = !isOllamaEnabled() && provider === "openai" && isOllamaBaseUrl(candidateBaseUrl);
  const rawCandidate = policyBlockedOllamaForOpenAi ? "" : candidateBaseUrl;
  const fallbackBase = defaultBaseUrlForProvider(provider);
  const baseUrl = sanitizeBaseUrl(rawCandidate, fallbackBase);
  const candidateText = String(candidateBaseUrl || "").trim();
  const fallbackText = String(fallbackBase || "").trim();
  if (candidateText) {
    const denied = policyBlockedOllamaForOpenAi || (baseUrl === fallbackText && sanitizeBaseUrl(candidateText, fallbackText) !== candidateText.replace(/\/+$/, ""));
    if (denied) {
      auditAiUrlPolicyDeny({
        provider,
        requestedBaseUrl: candidateText,
        resolvedBaseUrl: baseUrl,
        hostname: safeHostname(candidateText),
        reason: policyBlockedOllamaForOpenAi ? "ollama_not_enabled_for_openai" : "sanitized_to_fallback",
      });
    }
  }
  const apiKey = apiKeyForProvider(provider);
  return { provider, model, baseUrl, apiKey };
}

export function resolveProviderModel(runtime = {}, configuredModel = "") {
  const provider = normalizeAiProvider(runtime?.aiProvider || process.env.AI_PROVIDER || process.env.LLM_PROVIDER || "");
  const providerRuntimeConfig = runtime?.providerConfigs?.[provider] || {};
  const model = normalizeModelForProvider(
    provider,
    configuredModel || providerRuntimeConfig.model || runtime?.openaiModel,
    providerRuntimeConfig.model || defaultModelForProvider(provider)
  );
  return { provider, model };
}
