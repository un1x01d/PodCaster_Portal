import { query } from "../config/db.js";
import { defaultBaseUrlForProvider, defaultModelForProvider, normalizeAiProvider } from "./llmProvider.js";

const AI_RUNTIME_SETTINGS_KEY = "ai_runtime_settings";
const DEFAULT_AI_PROVIDER = normalizeAiProvider(process.env.AI_PROVIDER || process.env.LLM_PROVIDER || "openai");
const AI_PROVIDER_KEYS = ["openai", "gemini", "ollama"];

function defaultProviderConfigs() {
  return {
    openai: {
      model: defaultModelForProvider("openai"),
      baseUrl: defaultBaseUrlForProvider("openai"),
      inputCostPer1M: Number.parseFloat(process.env.OPENAI_INPUT_COST_PER_1M || "0.05") || 0.05,
      outputCostPer1M: Number.parseFloat(process.env.OPENAI_OUTPUT_COST_PER_1M || "0.40") || 0.40,
    },
    gemini: {
      model: defaultModelForProvider("gemini"),
      baseUrl: defaultBaseUrlForProvider("gemini"),
      inputCostPer1M: Number.parseFloat(process.env.GEMINI_INPUT_COST_PER_1M || "0") || 0,
      outputCostPer1M: Number.parseFloat(process.env.GEMINI_OUTPUT_COST_PER_1M || "0") || 0,
    },
    ollama: {
      model: defaultModelForProvider("ollama"),
      baseUrl: defaultBaseUrlForProvider("ollama"),
      inputCostPer1M: Number.parseFloat(process.env.OLLAMA_INPUT_COST_PER_1M || "0") || 0,
      outputCostPer1M: Number.parseFloat(process.env.OLLAMA_OUTPUT_COST_PER_1M || "0") || 0,
    },
  };
}

const DEFAULTS = {
  aiRuntimePreset: "mid",
  aiProvider: DEFAULT_AI_PROVIDER,
  providerConfigs: defaultProviderConfigs(),
  globalAiDisabled: false,
  chatEnabled: false,
  chatAudioEnabled: false,
  dashboardTranslationEnabled: false,
  businessClassificationEnabled: false,
  insightAiEnabled: false,
  chatMaxInputChars: 12000,
  chatHistoryWindowMessages: 8,
  dashboardTranslateMaxItems: 200,
  dashboardTranslateMaxCharsPerItem: 500,
  businessClassificationModel: String(process.env.OPENAI_BUSINESS_CLASSIFICATION_MODEL || defaultModelForProvider(DEFAULT_AI_PROVIDER)),
  businessClassificationApplyUploads: true,
  businessClassificationApplyEmailIngest: true,
  businessClassificationApplyAutosync: true,
  businessClassificationMaxSampleRows: 20,
  businessClassificationMaxPromptChars: 12000,
  businessClassificationMaxOutputTokens: 512,
  llmMaxOutputTokens: 800,
  openaiModel: String(defaultModelForProvider(DEFAULT_AI_PROVIDER)),
  openaiBaseUrl: String(defaultBaseUrlForProvider(DEFAULT_AI_PROVIDER)).replace(/\/+$/, ""),
  openaiTimeoutMs: Number.parseInt(process.env.OPENAI_TIMEOUT_MS || "60000", 10) || 60000,
  openaiTemperature: Number.parseFloat(process.env.OPENAI_TEMPERATURE || "0.1") || 0.1,
  openaiMaxOutputTokens: Number.parseInt(process.env.OPENAI_MAX_OUTPUT_TOKENS || "900", 10) || 900,
  openaiInputCostPer1M: Number.parseFloat(process.env.OPENAI_INPUT_COST_PER_1M || "0.05") || 0.05,
  openaiOutputCostPer1M: Number.parseFloat(process.env.OPENAI_OUTPUT_COST_PER_1M || "0.40") || 0.40,
  translationOpenaiModel: String(process.env.OPENAI_TRANSLATION_MODEL || defaultModelForProvider(DEFAULT_AI_PROVIDER)),
  translationTemperature: Number.parseFloat(process.env.OPENAI_TRANSLATION_TEMPERATURE || "0") || 0,
  translationMaxOutputTokens: Number.parseInt(process.env.OPENAI_TRANSLATION_MAX_OUTPUT_TOKENS || "512", 10) || 512,
  insightAiMaxSeriesPoints: Number.parseInt(process.env.INSIGHT_AI_MAX_SERIES_POINTS || "18", 10) || 18,
  insightAiMaxPromptChars: Number.parseInt(process.env.INSIGHT_AI_MAX_PROMPT_CHARS || "12000", 10) || 12000,
  chatAudioMaxChars: Number.parseInt(process.env.CHAT_AUDIO_MAX_CHARS || "8000", 10) || 8000,
  chatAudioTtsModelEn: String(process.env.OPENAI_TTS_MODEL_EN || "tts-1"),
  chatAudioTtsModelDefault: String(process.env.OPENAI_TTS_MODEL_DEFAULT || "tts-1"),
  chatAudioTtsVoice: String(process.env.OPENAI_TTS_VOICE || "nova"),
  chatAudioTtsSpeed: Number.parseFloat(process.env.OPENAI_TTS_SPEED || "0.9") || 0.9,
};

function toBool(v, fallback) {
  if (v === undefined || v === null) return fallback;
  return v === true;
}

function toInt(v, fallback, min, max) {
  const n = Number.parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function toFloat(v, fallback, min, max) {
  const n = Number.parseFloat(String(v ?? "").trim());
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function toModel(v, fallback) {
  const s = String(v ?? "").trim();
  return s || fallback;
}
function toBaseUrl(v, fallback) {
  const s = String(v ?? "").trim().replace(/\/+$/, "");
  return s || fallback;
}
function toPreset(v, fallback) {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "micro" || s === "tiny" || s === "low" || s === "mid" || s === "high") return s;
  return fallback;
}

function normalizeProviderConfigs(raw = {}) {
  const cfg = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const defaults = defaultProviderConfigs();
  const out = {};
  AI_PROVIDER_KEYS.forEach((provider) => {
    const source = cfg[provider] && typeof cfg[provider] === "object" ? cfg[provider] : {};
    out[provider] = {
      model: toModel(source.model, defaults[provider].model),
      baseUrl: toBaseUrl(source.baseUrl, defaults[provider].baseUrl),
      inputCostPer1M: toFloat(source.inputCostPer1M, defaults[provider].inputCostPer1M, 0, 1000),
      outputCostPer1M: toFloat(source.outputCostPer1M, defaults[provider].outputCostPer1M, 0, 1000),
    };
  });
  return out;
}

export function normalizeAiRuntimeSettings(raw = {}) {
  const cfg = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const aiProvider = normalizeAiProvider(cfg.aiProvider || DEFAULTS.aiProvider);
  const providerConfigs = normalizeProviderConfigs(cfg.providerConfigs || DEFAULTS.providerConfigs);
  if (cfg.openaiModel || cfg.openaiBaseUrl || cfg.openaiInputCostPer1M !== undefined || cfg.openaiOutputCostPer1M !== undefined) {
    providerConfigs[aiProvider] = {
      ...providerConfigs[aiProvider],
      model: toModel(cfg.openaiModel, providerConfigs[aiProvider].model),
      baseUrl: toBaseUrl(cfg.openaiBaseUrl, providerConfigs[aiProvider].baseUrl),
      inputCostPer1M: toFloat(cfg.openaiInputCostPer1M, providerConfigs[aiProvider].inputCostPer1M, 0, 1000),
      outputCostPer1M: toFloat(cfg.openaiOutputCostPer1M, providerConfigs[aiProvider].outputCostPer1M, 0, 1000),
    };
  }
  const providerDefaultModel = providerConfigs[aiProvider]?.model || defaultModelForProvider(aiProvider);
  const providerDefaultBaseUrl = providerConfigs[aiProvider]?.baseUrl || defaultBaseUrlForProvider(aiProvider);
  const providerInputCost = providerConfigs[aiProvider]?.inputCostPer1M ?? DEFAULTS.openaiInputCostPer1M;
  const providerOutputCost = providerConfigs[aiProvider]?.outputCostPer1M ?? DEFAULTS.openaiOutputCostPer1M;
  return {
    aiRuntimePreset: toPreset(cfg.aiRuntimePreset, DEFAULTS.aiRuntimePreset),
    aiProvider,
    providerConfigs,
    globalAiDisabled: toBool(cfg.globalAiDisabled, DEFAULTS.globalAiDisabled),
    chatEnabled: toBool(cfg.chatEnabled, DEFAULTS.chatEnabled),
    chatAudioEnabled: toBool(cfg.chatAudioEnabled, DEFAULTS.chatAudioEnabled),
    dashboardTranslationEnabled: toBool(cfg.dashboardTranslationEnabled, DEFAULTS.dashboardTranslationEnabled),
    businessClassificationEnabled: toBool(cfg.businessClassificationEnabled, DEFAULTS.businessClassificationEnabled),
    insightAiEnabled: toBool(cfg.insightAiEnabled, DEFAULTS.insightAiEnabled),
    chatMaxInputChars: toInt(cfg.chatMaxInputChars, DEFAULTS.chatMaxInputChars, 500, 200000),
    chatHistoryWindowMessages: toInt(cfg.chatHistoryWindowMessages, DEFAULTS.chatHistoryWindowMessages, 1, 40),
    dashboardTranslateMaxItems: toInt(cfg.dashboardTranslateMaxItems, DEFAULTS.dashboardTranslateMaxItems, 1, 2000),
    dashboardTranslateMaxCharsPerItem: toInt(cfg.dashboardTranslateMaxCharsPerItem, DEFAULTS.dashboardTranslateMaxCharsPerItem, 10, 10000),
    businessClassificationModel: toModel(cfg.businessClassificationModel, providerDefaultModel || DEFAULTS.businessClassificationModel),
    businessClassificationApplyUploads: toBool(cfg.businessClassificationApplyUploads, DEFAULTS.businessClassificationApplyUploads),
    businessClassificationApplyEmailIngest: toBool(cfg.businessClassificationApplyEmailIngest, DEFAULTS.businessClassificationApplyEmailIngest),
    businessClassificationApplyAutosync: toBool(cfg.businessClassificationApplyAutosync, DEFAULTS.businessClassificationApplyAutosync),
    businessClassificationMaxSampleRows: toInt(cfg.businessClassificationMaxSampleRows, DEFAULTS.businessClassificationMaxSampleRows, 0, 100),
    businessClassificationMaxPromptChars: toInt(cfg.businessClassificationMaxPromptChars, DEFAULTS.businessClassificationMaxPromptChars, 1000, 50000),
    businessClassificationMaxOutputTokens: toInt(cfg.businessClassificationMaxOutputTokens, DEFAULTS.businessClassificationMaxOutputTokens, 128, 2048),
    llmMaxOutputTokens: toInt(cfg.llmMaxOutputTokens, DEFAULTS.llmMaxOutputTokens, 32, 4096),
    openaiModel: toModel(cfg.openaiModel, providerDefaultModel || DEFAULTS.openaiModel),
    openaiBaseUrl: toBaseUrl(cfg.openaiBaseUrl, providerDefaultBaseUrl || DEFAULTS.openaiBaseUrl),
    openaiTimeoutMs: toInt(cfg.openaiTimeoutMs, DEFAULTS.openaiTimeoutMs, 1000, 300000),
    openaiTemperature: toFloat(cfg.openaiTemperature, DEFAULTS.openaiTemperature, 0, 2),
    openaiMaxOutputTokens: toInt(cfg.openaiMaxOutputTokens, DEFAULTS.openaiMaxOutputTokens, 32, 4096),
    openaiInputCostPer1M: toFloat(cfg.openaiInputCostPer1M, providerInputCost, 0, 1000),
    openaiOutputCostPer1M: toFloat(cfg.openaiOutputCostPer1M, providerOutputCost, 0, 1000),
    translationOpenaiModel: toModel(cfg.translationOpenaiModel, providerDefaultModel || DEFAULTS.translationOpenaiModel),
    translationTemperature: toFloat(cfg.translationTemperature, DEFAULTS.translationTemperature, 0, 2),
    translationMaxOutputTokens: toInt(cfg.translationMaxOutputTokens, DEFAULTS.translationMaxOutputTokens, 32, 4096),
    insightAiMaxSeriesPoints: toInt(cfg.insightAiMaxSeriesPoints, DEFAULTS.insightAiMaxSeriesPoints, 4, 200),
    insightAiMaxPromptChars: toInt(cfg.insightAiMaxPromptChars, DEFAULTS.insightAiMaxPromptChars, 1000, 200000),
    chatAudioMaxChars: toInt(cfg.chatAudioMaxChars, DEFAULTS.chatAudioMaxChars, 1000, 100000),
    chatAudioTtsModelEn: toModel(cfg.chatAudioTtsModelEn, DEFAULTS.chatAudioTtsModelEn),
    chatAudioTtsModelDefault: toModel(cfg.chatAudioTtsModelDefault, DEFAULTS.chatAudioTtsModelDefault),
    chatAudioTtsVoice: toModel(cfg.chatAudioTtsVoice, DEFAULTS.chatAudioTtsVoice),
    chatAudioTtsSpeed: toFloat(cfg.chatAudioTtsSpeed, DEFAULTS.chatAudioTtsSpeed, 0.25, 4),
  };
}

export function isAiGloballyDisabled(runtime = {}) {
  return runtime?.globalAiDisabled === true;
}

function scopedKey(groupId) {
  return Number.isInteger(groupId) && groupId > 0 ? `group:${groupId}:${AI_RUNTIME_SETTINGS_KEY}` : AI_RUNTIME_SETTINGS_KEY;
}

export async function loadAiRuntimeSettings(groupId = null) {
  const rows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [scopedKey(groupId)]);
  return normalizeAiRuntimeSettings(rows?.[0]?.value || {});
}

export async function saveAiRuntimeSettings(groupId = null, next = {}) {
  const normalized = normalizeAiRuntimeSettings(next);
  await query(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
     ON CONFLICT (key)
     DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
    [scopedKey(groupId), JSON.stringify(normalized)]
  );
  return normalized;
}

export { AI_RUNTIME_SETTINGS_KEY, DEFAULTS as DEFAULT_AI_RUNTIME_SETTINGS };
