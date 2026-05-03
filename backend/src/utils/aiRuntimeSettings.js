import { query } from "../config/db.js";

const AI_RUNTIME_SETTINGS_KEY = "ai_runtime_settings";

const DEFAULTS = {
  aiRuntimePreset: "mid",
  chatEnabled: true,
  chatAudioEnabled: false,
  dashboardTranslationEnabled: false,
  chatMaxInputChars: 12000,
  chatHistoryWindowMessages: 8,
  dashboardTranslateMaxItems: 200,
  dashboardTranslateMaxCharsPerItem: 500,
  llmMaxOutputTokens: 800,
  openaiModel: String(process.env.OPENAI_MODEL || "gpt-4.1-nano"),
  openaiBaseUrl: String(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, ""),
  openaiTimeoutMs: Number.parseInt(process.env.OPENAI_TIMEOUT_MS || "60000", 10) || 60000,
  openaiTemperature: Number.parseFloat(process.env.OPENAI_TEMPERATURE || "0.1") || 0.1,
  openaiMaxOutputTokens: Number.parseInt(process.env.OPENAI_MAX_OUTPUT_TOKENS || "900", 10) || 900,
  openaiInputCostPer1M: Number.parseFloat(process.env.OPENAI_INPUT_COST_PER_1M || "0.10") || 0.10,
  openaiOutputCostPer1M: Number.parseFloat(process.env.OPENAI_OUTPUT_COST_PER_1M || "0.40") || 0.40,
  insightAiMaxSeriesPoints: Number.parseInt(process.env.INSIGHT_AI_MAX_SERIES_POINTS || "18", 10) || 18,
  insightAiMaxPromptChars: Number.parseInt(process.env.INSIGHT_AI_MAX_PROMPT_CHARS || "12000", 10) || 12000,
  chatAudioMaxChars: Number.parseInt(process.env.CHAT_AUDIO_MAX_CHARS || "8000", 10) || 8000,
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

export function normalizeAiRuntimeSettings(raw = {}) {
  const cfg = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return {
    aiRuntimePreset: toPreset(cfg.aiRuntimePreset, DEFAULTS.aiRuntimePreset),
    chatEnabled: toBool(cfg.chatEnabled, DEFAULTS.chatEnabled),
    chatAudioEnabled: toBool(cfg.chatAudioEnabled, DEFAULTS.chatAudioEnabled),
    dashboardTranslationEnabled: toBool(cfg.dashboardTranslationEnabled, DEFAULTS.dashboardTranslationEnabled),
    chatMaxInputChars: toInt(cfg.chatMaxInputChars, DEFAULTS.chatMaxInputChars, 500, 200000),
    chatHistoryWindowMessages: toInt(cfg.chatHistoryWindowMessages, DEFAULTS.chatHistoryWindowMessages, 1, 40),
    dashboardTranslateMaxItems: toInt(cfg.dashboardTranslateMaxItems, DEFAULTS.dashboardTranslateMaxItems, 1, 2000),
    dashboardTranslateMaxCharsPerItem: toInt(cfg.dashboardTranslateMaxCharsPerItem, DEFAULTS.dashboardTranslateMaxCharsPerItem, 10, 10000),
    llmMaxOutputTokens: toInt(cfg.llmMaxOutputTokens, DEFAULTS.llmMaxOutputTokens, 32, 4096),
    openaiModel: toModel(cfg.openaiModel, DEFAULTS.openaiModel),
    openaiBaseUrl: toBaseUrl(cfg.openaiBaseUrl, DEFAULTS.openaiBaseUrl),
    openaiTimeoutMs: toInt(cfg.openaiTimeoutMs, DEFAULTS.openaiTimeoutMs, 1000, 300000),
    openaiTemperature: toFloat(cfg.openaiTemperature, DEFAULTS.openaiTemperature, 0, 2),
    openaiMaxOutputTokens: toInt(cfg.openaiMaxOutputTokens, DEFAULTS.openaiMaxOutputTokens, 32, 4096),
    openaiInputCostPer1M: toFloat(cfg.openaiInputCostPer1M, DEFAULTS.openaiInputCostPer1M, 0, 1000),
    openaiOutputCostPer1M: toFloat(cfg.openaiOutputCostPer1M, DEFAULTS.openaiOutputCostPer1M, 0, 1000),
    insightAiMaxSeriesPoints: toInt(cfg.insightAiMaxSeriesPoints, DEFAULTS.insightAiMaxSeriesPoints, 4, 200),
    insightAiMaxPromptChars: toInt(cfg.insightAiMaxPromptChars, DEFAULTS.insightAiMaxPromptChars, 1000, 200000),
    chatAudioMaxChars: toInt(cfg.chatAudioMaxChars, DEFAULTS.chatAudioMaxChars, 1000, 100000),
  };
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
