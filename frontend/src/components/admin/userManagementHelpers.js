export const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

export const normalizeReviewLabelRules = (value) => {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      parsed = {};
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return Object.fromEntries(
    Object.entries(parsed)
      .map(([label, enabled]) => [String(label || "").trim(), !!enabled])
      .filter(([label]) => !!label)
  );
};

export const normalizeSourceLabels = (source) => {
  const labels = Array.isArray(source?.file_labels) ? source.file_labels : [];
  const syncLabel = String(source?.sync_file_label || "").trim();
  return Array.from(new Set([...labels, syncLabel].map((label) => String(label || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
};

/** ---------------------------
 * Local templates (frontend-only)
 * --------------------------- */
export const LS_KEY = "permTemplates:v1";
export const CUSTOMER_FEATURE_OPTIONS = [
  ["manageUsers", "Manage users"],
  ["managePermissions", "Permissions"],
  ["manageGroupAdmins", "Promote admins"],
  ["chatAi", "Chat AI"],
  ["chatAudioAi", "Chat Audio AI"],
  ["dashboardTranslationAi", "Dashboard Translation AI"],
  ["exports", "Exports"],
  ["imports", "Imports"],
  ["approvalFlow", "Review rules"],
  ["auditLogs", "Audit logs"],
  ["sso", "SSO / SAML"],
  ["googleDrive", "Google Drive"],
  ["dropbox", "Dropbox"],
  ["oneDrive", "OneDrive"],
  ["quickbooks", "QuickBooks"],
  ["dlp", "DLP"],
];
export const PRODUCT_BUNDLES = [
  { key: "core", label: "Core", description: "Essential sharing" },
  { key: "growth", label: "Growth", description: "Governed operations" },
  { key: "enterprise", label: "Enterprise", description: "Full controls" },
];
export const BUNDLE_KEYS = PRODUCT_BUNDLES.map((bundle) => bundle.key);
export const BUNDLE_DEFAULT_FEATURES = {
  core: {
    manageUsers: true,
    managePermissions: true,
    manageGroupAdmins: false,
    chatAi: true,
    chatAudioAi: false,
    dashboardTranslationAi: false,
    exports: true,
    imports: true,
    approvalFlow: false,
    auditLogs: false,
    sso: false,
    googleDrive: true,
    dropbox: false,
    oneDrive: false,
    quickbooks: false,
    dlp: false,
  },
  growth: {
    manageUsers: true,
    managePermissions: true,
    manageGroupAdmins: true,
    chatAi: true,
    chatAudioAi: false,
    dashboardTranslationAi: false,
    exports: true,
    imports: true,
    approvalFlow: true,
    auditLogs: false,
    sso: true,
    googleDrive: true,
    dropbox: true,
    oneDrive: true,
    quickbooks: false,
    dlp: false,
  },
  enterprise: {
    manageUsers: true,
    managePermissions: true,
    manageGroupAdmins: true,
    chatAi: true,
    chatAudioAi: false,
    dashboardTranslationAi: false,
    exports: true,
    imports: true,
    approvalFlow: true,
    auditLogs: true,
    sso: true,
    googleDrive: true,
    dropbox: true,
    oneDrive: true,
    quickbooks: true,
    dlp: true,
  },
};
export const BUNDLE_AI_LIMITS = {
  core: { maxAiQueriesPerMonth: 2000, aiMonthlyBudgetUsd: 25 },
  growth: { maxAiQueriesPerMonth: 10000, aiMonthlyBudgetUsd: 150 },
  enterprise: { maxAiQueriesPerMonth: 50000, aiMonthlyBudgetUsd: 1000 },
};
export const BUNDLE_DEFAULT_CAPACITY_LIMITS = {
  core: { maxUsers: 10, maxReportSources: 3 },
  growth: { maxUsers: 50, maxReportSources: 15 },
  enterprise: { maxUsers: 250, maxReportSources: 100 },
};
export const BUNDLE_AI_PRICING = {
  core: { openaiModel: "gpt-5-nano", openaiInputCostPer1M: 0.05, openaiOutputCostPer1M: 0.40 },
  growth: { openaiModel: "gpt-5-nano", openaiInputCostPer1M: 0.05, openaiOutputCostPer1M: 0.40 },
  enterprise: { openaiModel: "gpt-5-nano", openaiInputCostPer1M: 0.05, openaiOutputCostPer1M: 0.40 },
};
export const AI_MODEL_PRICING = {
  "gpt-5-nano": { openaiInputCostPer1M: 0.05, openaiOutputCostPer1M: 0.40 },
  "gpt-4.1-nano": { openaiInputCostPer1M: 0.10, openaiOutputCostPer1M: 0.40 },
  "gpt-4.1-mini": { openaiInputCostPer1M: 0.40, openaiOutputCostPer1M: 1.60 },
  "gpt-4.1": { openaiInputCostPer1M: 2.00, openaiOutputCostPer1M: 8.00 },
  "gemini-2.5-flash": { openaiInputCostPer1M: 0, openaiOutputCostPer1M: 0 },
  "gemini-2.5-pro": { openaiInputCostPer1M: 0, openaiOutputCostPer1M: 0 },
  "gemini-1.5-flash": { openaiInputCostPer1M: 0, openaiOutputCostPer1M: 0 },
  "llama3.2": { openaiInputCostPer1M: 0, openaiOutputCostPer1M: 0 },
  "llama3.1": { openaiInputCostPer1M: 0, openaiOutputCostPer1M: 0 },
  "mistral": { openaiInputCostPer1M: 0, openaiOutputCostPer1M: 0 },
};
export function getAiModelPricing(model) {
  return AI_MODEL_PRICING[String(model || "").trim()] || AI_MODEL_PRICING["gpt-5-nano"];
}
export const BUSINESS_CLASSIFICATION_RUNTIME_DEFAULTS = {
  businessClassificationEnabled: false,
  businessClassificationModel: "gpt-5-nano",
  businessClassificationApplyUploads: true,
  businessClassificationApplyEmailIngest: true,
  businessClassificationApplyAutosync: true,
  businessClassificationMaxSampleRows: 20,
  businessClassificationMaxPromptChars: 12000,
  businessClassificationMaxOutputTokens: 512,
};
export const AI_FEATURE_RUNTIME_DEFAULTS = {
  globalAiDisabled: false,
  chatEnabled: false,
  chatAudioEnabled: false,
  dashboardTranslationEnabled: false,
  insightAiEnabled: false,
  importStreamingEnabled: false,
};
export const AI_PROVIDER_RUNTIME_DEFAULTS = {
  aiProvider: "openai",
};
export const AI_PROVIDER_CONFIG_DEFAULTS = {
  openai: { model: "gpt-5-nano", baseUrl: "https://api.openai.com/v1", inputCostPer1M: 0.05, outputCostPer1M: 0.40 },
  gemini: { model: "gemini-2.5-flash", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", inputCostPer1M: 0, outputCostPer1M: 0 },
  ollama: { model: "llama3.2", baseUrl: "http://localhost:11434/v1", inputCostPer1M: 0, outputCostPer1M: 0 },
};
export function normalizeAiProviderConfigMap(value = {}) {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const next = {};
  Object.entries(AI_PROVIDER_CONFIG_DEFAULTS).forEach(([provider, defaults]) => {
    const current = raw[provider] && typeof raw[provider] === "object" ? raw[provider] : {};
    next[provider] = {
      model: String(current.model || defaults.model),
      baseUrl: String(current.baseUrl || defaults.baseUrl),
      inputCostPer1M: Number(current.inputCostPer1M ?? defaults.inputCostPer1M),
      outputCostPer1M: Number(current.outputCostPer1M ?? defaults.outputCostPer1M),
    };
  });
  return next;
}
export const AI_RUNTIME_PRESETS = {
  micro: {
    aiRuntimePreset: "micro",
    ...AI_PROVIDER_RUNTIME_DEFAULTS,
    providerConfigs: AI_PROVIDER_CONFIG_DEFAULTS,
    ...AI_FEATURE_RUNTIME_DEFAULTS,
    ...BUSINESS_CLASSIFICATION_RUNTIME_DEFAULTS,
    chatMaxInputChars: 1500,
    chatPromptBudgetEnabled: true,
    chatHistoryWindowMessages: 1,
    dashboardTranslateMaxItems: 20,
    dashboardTranslateMaxCharsPerItem: 125,
    llmMaxOutputTokens: 100,
    openaiModel: "gpt-5-nano",
    openaiBaseUrl: "https://api.openai.com/v1",
    openaiTimeoutMs: 15000,
    openaiTemperature: 0.1,
    openaiMaxOutputTokens: 768,
    openaiInputCostPer1M: 0.05,
    openaiOutputCostPer1M: 0.40,
    translationOpenaiModel: "gpt-5-nano",
    insightAiModel: "gpt-5-nano",
    translationTemperature: 0,
    translationMaxOutputTokens: 512,
    insightAiMaxSeriesPoints: 6,
    insightAiMaxPromptChars: 4000,
    chatAudioMaxChars: 3000,
    chatAudioTtsModelEn: "tts-1",
    chatAudioTtsModelDefault: "tts-1",
    chatAudioTtsVoice: "nova",
    chatAudioTtsSpeed: 0.85,
    aiBaseUrlAllowlistEnabled: true,
    aiBaseUrlAllowlistBypass: false,
    aiBaseUrlAllowlist: ["api.openai.com", "generativelanguage.googleapis.com"],
  },
  tiny: {
    aiRuntimePreset: "tiny",
    ...AI_PROVIDER_RUNTIME_DEFAULTS,
    providerConfigs: AI_PROVIDER_CONFIG_DEFAULTS,
    ...AI_FEATURE_RUNTIME_DEFAULTS,
    ...BUSINESS_CLASSIFICATION_RUNTIME_DEFAULTS,
    chatMaxInputChars: 3000,
    chatPromptBudgetEnabled: true,
    chatHistoryWindowMessages: 2,
    dashboardTranslateMaxItems: 40,
    dashboardTranslateMaxCharsPerItem: 250,
    llmMaxOutputTokens: 200,
    openaiModel: "gpt-5-nano",
    openaiBaseUrl: "https://api.openai.com/v1",
    openaiTimeoutMs: 30000,
    openaiTemperature: 0.1,
    openaiMaxOutputTokens: 896,
    openaiInputCostPer1M: 0.05,
    openaiOutputCostPer1M: 0.40,
    translationOpenaiModel: "gpt-5-nano",
    insightAiModel: "gpt-5-nano",
    translationTemperature: 0,
    translationMaxOutputTokens: 576,
    insightAiMaxSeriesPoints: 12,
    insightAiMaxPromptChars: 8000,
    chatAudioMaxChars: 6000,
    chatAudioTtsModelEn: "tts-1",
    chatAudioTtsModelDefault: "tts-1",
    chatAudioTtsVoice: "nova",
    chatAudioTtsSpeed: 0.9,
    aiBaseUrlAllowlistEnabled: true,
    aiBaseUrlAllowlistBypass: false,
    aiBaseUrlAllowlist: ["api.openai.com", "generativelanguage.googleapis.com"],
  },
  low: {
    aiRuntimePreset: "low",
    ...AI_PROVIDER_RUNTIME_DEFAULTS,
    providerConfigs: AI_PROVIDER_CONFIG_DEFAULTS,
    ...AI_FEATURE_RUNTIME_DEFAULTS,
    ...BUSINESS_CLASSIFICATION_RUNTIME_DEFAULTS,
    chatMaxInputChars: 6000,
    chatPromptBudgetEnabled: true,
    chatHistoryWindowMessages: 4,
    dashboardTranslateMaxItems: 80,
    dashboardTranslateMaxCharsPerItem: 250,
    llmMaxOutputTokens: 400,
    openaiModel: "gpt-5-nano",
    openaiBaseUrl: "https://api.openai.com/v1",
    openaiTimeoutMs: 30000,
    openaiTemperature: 0.1,
    openaiMaxOutputTokens: 1024,
    openaiInputCostPer1M: 0.05,
    openaiOutputCostPer1M: 0.40,
    translationOpenaiModel: "gpt-5-nano",
    insightAiModel: "gpt-5-nano",
    translationTemperature: 0,
    translationMaxOutputTokens: 640,
    insightAiMaxSeriesPoints: 12,
    insightAiMaxPromptChars: 8000,
    chatAudioMaxChars: 6000,
    chatAudioTtsModelEn: "tts-1",
    chatAudioTtsModelDefault: "tts-1",
    chatAudioTtsVoice: "nova",
    chatAudioTtsSpeed: 0.95,
    aiBaseUrlAllowlistEnabled: true,
    aiBaseUrlAllowlistBypass: false,
    aiBaseUrlAllowlist: ["api.openai.com", "generativelanguage.googleapis.com"],
  },
  mid: {
    aiRuntimePreset: "mid",
    ...AI_PROVIDER_RUNTIME_DEFAULTS,
    providerConfigs: AI_PROVIDER_CONFIG_DEFAULTS,
    ...AI_FEATURE_RUNTIME_DEFAULTS,
    ...BUSINESS_CLASSIFICATION_RUNTIME_DEFAULTS,
    chatMaxInputChars: 12000,
    chatPromptBudgetEnabled: true,
    chatHistoryWindowMessages: 8,
    dashboardTranslateMaxItems: 200,
    dashboardTranslateMaxCharsPerItem: 500,
    llmMaxOutputTokens: 800,
    openaiModel: "gpt-5-nano",
    openaiBaseUrl: "https://api.openai.com/v1",
    openaiTimeoutMs: 60000,
    openaiTemperature: 0.1,
    openaiMaxOutputTokens: 1280,
    openaiInputCostPer1M: 0.05,
    openaiOutputCostPer1M: 0.40,
    translationOpenaiModel: "gpt-5-nano",
    insightAiModel: "gpt-5-nano",
    translationTemperature: 0,
    translationMaxOutputTokens: 704,
    insightAiMaxSeriesPoints: 18,
    insightAiMaxPromptChars: 12000,
    chatAudioMaxChars: 8000,
    chatAudioTtsModelEn: "tts-1",
    chatAudioTtsModelDefault: "tts-1",
    chatAudioTtsVoice: "nova",
    chatAudioTtsSpeed: 1.0,
    aiBaseUrlAllowlistEnabled: true,
    aiBaseUrlAllowlistBypass: false,
    aiBaseUrlAllowlist: ["api.openai.com", "generativelanguage.googleapis.com"],
  },
  high: {
    aiRuntimePreset: "high",
    ...AI_PROVIDER_RUNTIME_DEFAULTS,
    providerConfigs: AI_PROVIDER_CONFIG_DEFAULTS,
    ...AI_FEATURE_RUNTIME_DEFAULTS,
    ...BUSINESS_CLASSIFICATION_RUNTIME_DEFAULTS,
    chatMaxInputChars: 24000,
    chatPromptBudgetEnabled: true,
    chatHistoryWindowMessages: 16,
    dashboardTranslateMaxItems: 400,
    dashboardTranslateMaxCharsPerItem: 1000,
    llmMaxOutputTokens: 1600,
    openaiModel: "gpt-5-nano",
    openaiBaseUrl: "https://api.openai.com/v1",
    openaiTimeoutMs: 120000,
    openaiTemperature: 0.1,
    openaiMaxOutputTokens: 1600,
    openaiInputCostPer1M: 0.05,
    openaiOutputCostPer1M: 0.40,
    translationOpenaiModel: "gpt-5-nano",
    insightAiModel: "gpt-5-nano",
    translationTemperature: 0,
    translationMaxOutputTokens: 768,
    insightAiMaxSeriesPoints: 32,
    insightAiMaxPromptChars: 24000,
    chatAudioMaxChars: 12000,
    chatAudioTtsModelEn: "tts-1",
    chatAudioTtsModelDefault: "tts-1",
    chatAudioTtsVoice: "nova",
    chatAudioTtsSpeed: 1.05,
    aiBaseUrlAllowlistEnabled: true,
    aiBaseUrlAllowlistBypass: false,
    aiBaseUrlAllowlist: ["api.openai.com", "generativelanguage.googleapis.com"],
  },
};
export function loadTemplates() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const arr = JSON.parse(raw || "[]");
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
export function saveTemplates(arr) {
  localStorage.setItem(LS_KEY, JSON.stringify(arr || []));
}

