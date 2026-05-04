const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";
const GEMINI_DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
const OLLAMA_DEFAULT_BASE_URL = "http://localhost:11434/v1";

export function normalizeAiProvider(provider = "") {
  const value = String(provider || "").trim().toLowerCase();
  if (value === "gemini" || value === "google" || value === "google_gemini") return "gemini";
  if (value === "ollama" || value === "local") return "ollama";
  return "openai";
}

export function inferAiProvider({ provider = "", baseUrl = "", model = "" } = {}) {
  const explicit = String(provider || "").trim();
  if (explicit) return normalizeAiProvider(explicit);
  const url = String(baseUrl || "").toLowerCase();
  const name = String(model || "").toLowerCase();
  if (url.includes("generativelanguage.googleapis.com") || name.startsWith("gemini")) return "gemini";
  if (url.includes("localhost:11434") || url.includes("127.0.0.1:11434") || url.includes("ollama")) return "ollama";
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
  if (normalized === "gemini") return String(process.env.GEMINI_BASE_URL || GEMINI_DEFAULT_BASE_URL).replace(/\/+$/, "");
  if (normalized === "ollama") return String(process.env.OLLAMA_BASE_URL || OLLAMA_DEFAULT_BASE_URL).replace(/\/+$/, "");
  return String(process.env.OPENAI_BASE_URL || OPENAI_DEFAULT_BASE_URL).replace(/\/+$/, "");
}

export function apiKeyForProvider(provider = "openai") {
  const normalized = normalizeAiProvider(provider);
  if (normalized === "gemini") return String(process.env.GEMINI_API_KEY || "").trim();
  if (normalized === "ollama") return String(process.env.OLLAMA_API_KEY || "ollama").trim();
  return String(process.env.OPENAI_API_KEY || "").trim();
}

export function resolveChatCompletionProviderConfig(runtime = {}, modelOverride = null) {
  const provider = inferAiProvider({
    provider: runtime?.aiProvider || process.env.AI_PROVIDER || process.env.LLM_PROVIDER || "",
    baseUrl: runtime?.openaiBaseUrl || "",
    model: modelOverride || runtime?.openaiModel || "",
  });
  const providerRuntimeConfig = runtime?.providerConfigs?.[provider] || {};
  const model = String(modelOverride || providerRuntimeConfig.model || runtime?.openaiModel || defaultModelForProvider(provider)).trim();
  const baseUrl = String(providerRuntimeConfig.baseUrl || runtime?.openaiBaseUrl || defaultBaseUrlForProvider(provider)).replace(/\/+$/, "");
  const apiKey = apiKeyForProvider(provider);
  return { provider, model, baseUrl, apiKey };
}

export function resolveProviderModel(runtime = {}, configuredModel = "") {
  const provider = inferAiProvider({
    provider: runtime?.aiProvider || process.env.AI_PROVIDER || process.env.LLM_PROVIDER || "",
    baseUrl: runtime?.openaiBaseUrl || "",
    model: configuredModel || runtime?.openaiModel || "",
  });
  const model = String(configuredModel || runtime?.providerConfigs?.[provider]?.model || defaultModelForProvider(provider)).trim();
  return { provider, model };
}
