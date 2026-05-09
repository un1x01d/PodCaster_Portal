import React from "react";
import StorageOptionCard from "../common/StorageOptionCard.jsx";

const AI_MODEL_OPTIONS = [
  { provider: "openai", value: "gpt-5-nano", label: "GPT-5 nano", openaiInputCostPer1M: 0.05, openaiOutputCostPer1M: 0.40 },
  { provider: "openai", value: "gpt-4.1-nano", label: "GPT-4.1 nano", openaiInputCostPer1M: 0.10, openaiOutputCostPer1M: 0.40 },
  { provider: "openai", value: "gpt-4.1-mini", label: "GPT-4.1 mini", openaiInputCostPer1M: 0.40, openaiOutputCostPer1M: 1.60 },
  { provider: "openai", value: "gpt-4.1", label: "GPT-4.1", openaiInputCostPer1M: 2.00, openaiOutputCostPer1M: 8.00 },
  { provider: "gemini", value: "gemini-2.5-flash", label: "Gemini 2.5 Flash", openaiInputCostPer1M: 0, openaiOutputCostPer1M: 0 },
  { provider: "gemini", value: "gemini-2.5-pro", label: "Gemini 2.5 Pro", openaiInputCostPer1M: 0, openaiOutputCostPer1M: 0 },
  { provider: "gemini", value: "gemini-1.5-flash", label: "Gemini 1.5 Flash", openaiInputCostPer1M: 0, openaiOutputCostPer1M: 0 },
  { provider: "ollama", value: "llama3.2", label: "Llama 3.2", openaiInputCostPer1M: 0, openaiOutputCostPer1M: 0 },
  { provider: "ollama", value: "llama3.1", label: "Llama 3.1", openaiInputCostPer1M: 0, openaiOutputCostPer1M: 0 },
  { provider: "ollama", value: "mistral", label: "Mistral", openaiInputCostPer1M: 0, openaiOutputCostPer1M: 0 },
];
const AI_PROVIDER_OPTIONS = [
  { value: "openai", label: "GPT", model: "gpt-5-nano", baseUrl: "https://api.openai.com/v1" },
  { value: "gemini", label: "Gemini", model: "gemini-2.5-flash", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai" },
  { value: "ollama", label: "Ollama", model: "llama3.2", baseUrl: "http://localhost:11434/v1" },
];
const AI_PROVIDER_DEFAULTS = Object.fromEntries(AI_PROVIDER_OPTIONS.map((option) => [option.value, option]));
const AI_PROVIDER_CONFIG_DEFAULTS = Object.fromEntries(AI_PROVIDER_OPTIONS.map((option) => [
  option.value,
  {
    model: option.model,
    baseUrl: option.baseUrl,
    inputCostPer1M: getAiModelPricing(option.model).openaiInputCostPer1M,
    outputCostPer1M: getAiModelPricing(option.model).openaiOutputCostPer1M,
  },
]));

function getAiModelPricing(model, provider = "") {
  const configured = AI_MODEL_OPTIONS.find((option) => option.value === model);
  if (configured) return configured;
  if (provider === "ollama" || provider === "gemini") {
    return { openaiInputCostPer1M: 0, openaiOutputCostPer1M: 0 };
  }
  return AI_MODEL_OPTIONS[0];
}

function normalizeAiProvider(provider) {
  return AI_PROVIDER_DEFAULTS[String(provider || "").trim().toLowerCase()] ? String(provider).trim().toLowerCase() : "openai";
}

export default function IntegrationSettingsPanel(props) {
  const {
    canManageIntegrations,
    isSuperAdmin,
    selectedGroupId,
    selectedGroupBundleTier,
    reportSourceOptions,
    autosyncInterval,
    autosyncIntervalSaving,
    autosyncIntervalSaved,
    setAutosyncInterval,
    saveAutosyncIntervalSetting,
    INTEGRATION_LOGOS,
    emailIngestConfig,
    emailIngestSaving,
    emailIngestSaved,
    integrationOpen,
    setIntegrationOpen,
    setEmailIngestConfig,
    saveEmailIngestSetting,
    googleConfigured,
    googleOauthMeta,
    googleOauthForm,
    googleOauthSaving,
    googleOauthSaved,
    googleOauthTesting,
    setGoogleOauthForm,
    saveGoogleOauthSetting,
    testGoogleOauthSetting,
    dropboxConfigured,
    dropboxOauthMeta,
    dropboxOauthForm,
    dropboxOauthSaving,
    dropboxOauthSaved,
    dropboxOauthTesting,
    setDropboxOauthForm,
    saveDropboxOauthSetting,
    testDropboxOauthSetting,
    oneDriveConfigured,
    oneDriveOauthMeta,
    oneDriveOauthForm,
    oneDriveOauthSaving,
    oneDriveOauthSaved,
    oneDriveOauthTesting,
    setOneDriveOauthForm,
    saveOneDriveOauthSetting,
    testOneDriveOauthSetting,
    quickbooksConfigured,
    quickbooksOauthMeta,
    quickbooksOauthForm,
    quickbooksOauthSaving,
    quickbooksOauthSaved,
    quickbooksOauthTesting,
    samlConfigured,
    samlMeta,
    samlForm,
    samlSaving,
    samlSaved,
    samlTesting,
    QUICKBOOKS_DATA_TYPE_OPTIONS,
    setQuickbooksOauthForm,
    saveQuickbooksOauthSetting,
    testQuickbooksOauthSetting,
    setSamlForm,
    saveSamlSetting,
    testSamlSetting,
    integrationTestStatus,
    STORAGE_PROVIDER_DEFS,
    createStorageProviderState,
    storageSettings,
    updateStorageProvider,
    saveStorageSetting,
    testStorageSetting,
    aiRuntimeSettings,
    setAiRuntimeSettings,
    aiRuntimeSaving,
    aiRuntimeSaved,
    saveAiRuntimeSetting,
    applyAiRuntimePreset,
    aiUsagePeriodMonth,
    setAiUsagePeriodMonth,
    aiUsageSummary,
    aiUsageLoading,
    aiUsageError,
    fetchAiUsageSummary,
  } = props;

  if (!canManageIntegrations) return null;
  const bundleTier = String(selectedGroupBundleTier || "").toLowerCase();
  const enterpriseOnlyLocked = !isSuperAdmin && Number(selectedGroupId) > 0 && bundleTier !== "enterprise";
  const enterpriseOnlyStorageKeys = new Set(["sftp", "gcs", "s3", "azure"]);
  const selectedAiProvider = normalizeAiProvider(aiRuntimeSettings.aiProvider || "openai");
  const providerConfigs = {
    ...AI_PROVIDER_CONFIG_DEFAULTS,
    ...(aiRuntimeSettings.providerConfigs || {}),
  };
  const modelOptionsForProvider = (provider = selectedAiProvider, currentModel = "") => {
    const options = AI_MODEL_OPTIONS.filter((option) => option.provider === provider);
    const current = String(currentModel || "").trim();
    if (current && !options.some((option) => option.value === current)) {
      return [{ provider, value: current, label: current, openaiInputCostPer1M: 0, openaiOutputCostPer1M: 0 }, ...options];
    }
    return options;
  };
  const updateActiveProviderModel = (model) => {
    const pricing = getAiModelPricing(model, selectedAiProvider);
    updateProviderConfig(selectedAiProvider, {
      model,
      inputCostPer1M: pricing.openaiInputCostPer1M,
      outputCostPer1M: pricing.openaiOutputCostPer1M,
    });
    setAiRuntimeSettings((prev) => ({
      ...prev,
      openaiModel: model,
      openaiInputCostPer1M: pricing.openaiInputCostPer1M,
      openaiOutputCostPer1M: pricing.openaiOutputCostPer1M,
    }));
  };
  const updateProviderConfig = (provider, patch = {}) => {
    const normalized = normalizeAiProvider(provider);
    setAiRuntimeSettings((prev) => {
      const previousConfigs = { ...AI_PROVIDER_CONFIG_DEFAULTS, ...(prev.providerConfigs || {}) };
      const nextConfig = { ...previousConfigs[normalized], ...patch };
      const next = {
        ...prev,
        providerConfigs: {
          ...previousConfigs,
          [normalized]: nextConfig,
        },
      };
      if (normalizeAiProvider(prev.aiProvider || selectedAiProvider) === normalized) {
        next.openaiModel = nextConfig.model;
        next.openaiBaseUrl = nextConfig.baseUrl;
        next.openaiInputCostPer1M = nextConfig.inputCostPer1M;
        next.openaiOutputCostPer1M = nextConfig.outputCostPer1M;
      }
      return next;
    });
  };
  const activateProvider = (provider) => {
    const normalized = normalizeAiProvider(provider);
    const defaults = AI_PROVIDER_DEFAULTS[normalized] || AI_PROVIDER_DEFAULTS.openai;
    const config = providerConfigs[normalized] || AI_PROVIDER_CONFIG_DEFAULTS[normalized] || {};
    const model = String(config.model || defaults.model);
    const pricing = getAiModelPricing(model, normalized);
    const inputCost = Number(config.inputCostPer1M ?? pricing.openaiInputCostPer1M);
    const outputCost = Number(config.outputCostPer1M ?? pricing.openaiOutputCostPer1M);
    setAiRuntimeSettings((prev) => ({
      ...prev,
      aiProvider: normalized,
      providerConfigs: {
        ...AI_PROVIDER_CONFIG_DEFAULTS,
        ...(prev.providerConfigs || {}),
        [normalized]: {
          model,
          baseUrl: String(config.baseUrl || defaults.baseUrl),
          inputCostPer1M: inputCost,
          outputCostPer1M: outputCost,
        },
      },
      openaiModel: model,
      openaiBaseUrl: String(config.baseUrl || defaults.baseUrl),
      businessClassificationModel: model,
      translationOpenaiModel: model,
      insightAiModel: model,
      openaiInputCostPer1M: inputCost,
      openaiOutputCostPer1M: outputCost,
    }));
  };

  return (
    <div className="mb-4 rounded-md border border-slate-200 bg-slate-50 p-4 space-y-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">AI Options</div>
      {!isSuperAdmin && !selectedGroupId && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
          Select a customer to configure scoped integration credentials.
        </div>
      )}
      {(
        <div className="rounded-md border border-slate-200 bg-white p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-4 w-4 items-center justify-center rounded-sm bg-white border border-slate-200">
                <svg viewBox="0 0 24 24" className="h-3 w-3 text-slate-600" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8L12 3z" />
                  <path d="M19 14l.9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9L19 14z" />
                </svg>
              </span>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">AI Runtime Controls</div>
            </div>
            <div className="flex items-center gap-2">
              {integrationOpen.aiRuntime && (
                <div className="flex gap-1">
                  <button type="button" onClick={() => applyAiRuntimePreset("micro")} disabled={aiRuntimeSaving} className={`px-2 py-1 rounded border text-[10px] font-semibold ${aiRuntimeSettings.aiRuntimePreset === "micro" ? "bg-emerald-600 border-emerald-600 text-white" : "border-slate-300 text-slate-700 hover:bg-slate-100"} ${aiRuntimeSaving ? "opacity-60 cursor-not-allowed" : ""}`}>Micro</button>
                  <button type="button" onClick={() => applyAiRuntimePreset("tiny")} disabled={aiRuntimeSaving} className={`px-2 py-1 rounded border text-[10px] font-semibold ${aiRuntimeSettings.aiRuntimePreset === "tiny" ? "bg-emerald-600 border-emerald-600 text-white" : "border-slate-300 text-slate-700 hover:bg-slate-100"} ${aiRuntimeSaving ? "opacity-60 cursor-not-allowed" : ""}`}>Tiny</button>
                  <button type="button" onClick={() => applyAiRuntimePreset("low")} disabled={aiRuntimeSaving} className={`px-2 py-1 rounded border text-[10px] font-semibold ${aiRuntimeSettings.aiRuntimePreset === "low" ? "bg-emerald-600 border-emerald-600 text-white" : "border-slate-300 text-slate-700 hover:bg-slate-100"} ${aiRuntimeSaving ? "opacity-60 cursor-not-allowed" : ""}`}>Low</button>
                  <button type="button" onClick={() => applyAiRuntimePreset("mid")} disabled={aiRuntimeSaving} className={`px-2 py-1 rounded border text-[10px] font-semibold ${aiRuntimeSettings.aiRuntimePreset === "mid" ? "bg-emerald-600 border-emerald-600 text-white" : "border-slate-300 text-slate-700 hover:bg-slate-100"} ${aiRuntimeSaving ? "opacity-60 cursor-not-allowed" : ""}`}>Mid</button>
                  <button type="button" onClick={() => applyAiRuntimePreset("high")} disabled={aiRuntimeSaving} className={`px-2 py-1 rounded border text-[10px] font-semibold ${aiRuntimeSettings.aiRuntimePreset === "high" ? "bg-emerald-600 border-emerald-600 text-white" : "border-slate-300 text-slate-700 hover:bg-slate-100"} ${aiRuntimeSaving ? "opacity-60 cursor-not-allowed" : ""}`}>High</button>
                </div>
              )}
              <button type="button" className="text-[12px] font-bold text-slate-900 hover:text-slate-900" onClick={() => setIntegrationOpen((prev) => ({ ...prev, aiRuntime: !prev.aiRuntime }))}>
                {integrationOpen.aiRuntime ? "Collapse" : "Expand"}
              </button>
            </div>
          </div>
          {integrationOpen.aiRuntime && (
          <>
          <div className="flex flex-col gap-1">
            <label className="inline-flex items-center gap-2 text-[11px] font-semibold text-red-700 px-2 py-1 rounded-md border border-red-200 bg-red-50">
              <input type="checkbox" checked={aiRuntimeSettings.globalAiDisabled === true} onChange={(e) => setAiRuntimeSettings((prev) => ({ ...prev, globalAiDisabled: e.target.checked }))} />
              <span>Global AI Disabled</span>
            </label>
            <label className="inline-flex items-center gap-2 text-[11px] font-semibold text-slate-700 px-2 py-1 rounded-md border border-slate-200">
              <input type="checkbox" disabled={aiRuntimeSettings.globalAiDisabled === true} checked={aiRuntimeSettings.chatEnabled === true} onChange={(e) => setAiRuntimeSettings((prev) => ({ ...prev, chatEnabled: e.target.checked }))} />
              <span>Chat AI Enabled</span>
            </label>
            <label className="inline-flex items-center gap-2 text-[11px] font-semibold text-slate-700 px-2 py-1 rounded-md border border-slate-200">
              <input type="checkbox" disabled={aiRuntimeSettings.globalAiDisabled === true} checked={aiRuntimeSettings.chatAudioEnabled === true} onChange={(e) => setAiRuntimeSettings((prev) => ({ ...prev, chatAudioEnabled: e.target.checked }))} />
              <span>Chat Audio AI Enabled</span>
            </label>
            <label className="inline-flex items-center gap-2 text-[11px] font-semibold text-slate-700 px-2 py-1 rounded-md border border-slate-200">
              <input type="checkbox" disabled={aiRuntimeSettings.globalAiDisabled === true} checked={aiRuntimeSettings.dashboardTranslationEnabled === true} onChange={(e) => setAiRuntimeSettings((prev) => ({ ...prev, dashboardTranslationEnabled: e.target.checked }))} />
              <span>Dashboard Translation AI Enabled</span>
            </label>
            <label className="inline-flex items-center gap-2 text-[11px] font-semibold text-slate-700 px-2 py-1 rounded-md border border-slate-200">
              <input type="checkbox" disabled={aiRuntimeSettings.globalAiDisabled === true} checked={aiRuntimeSettings.insightAiEnabled === true} onChange={(e) => setAiRuntimeSettings((prev) => ({ ...prev, insightAiEnabled: e.target.checked }))} />
              <span>Insight AI Enabled</span>
            </label>
            <label className="inline-flex items-center gap-2 text-[11px] font-semibold text-slate-700 px-2 py-1 rounded-md border border-slate-200">
              <input type="checkbox" disabled={aiRuntimeSettings.globalAiDisabled === true} checked={aiRuntimeSettings.businessClassificationEnabled === true} onChange={(e) => setAiRuntimeSettings((prev) => ({ ...prev, businessClassificationEnabled: e.target.checked }))} />
              <span>Business Type Detection Enabled</span>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Provider</div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Model</div>
            <select
              className="input-premium py-1.5 text-[11px] font-semibold"
              value={selectedAiProvider}
              onChange={(e) => {
                activateProvider(e.target.value);
              }}
            >
              {AI_PROVIDER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            {selectedAiProvider === "ollama" ? (
              <input
                className="input-premium py-1.5 text-[11px] font-semibold"
                placeholder="llama3.2"
                value={aiRuntimeSettings.openaiModel || providerConfigs[selectedAiProvider]?.model || AI_PROVIDER_DEFAULTS[selectedAiProvider].model}
                onChange={(e) => updateActiveProviderModel(e.target.value)}
              />
            ) : (
              <select
                className="input-premium py-1.5 text-[11px] font-semibold"
                value={aiRuntimeSettings.openaiModel || providerConfigs[selectedAiProvider]?.model || AI_PROVIDER_DEFAULTS[selectedAiProvider].model}
                onChange={(e) => updateActiveProviderModel(e.target.value)}
              >
                {modelOptionsForProvider(selectedAiProvider, aiRuntimeSettings.openaiModel).map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            )}
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">LLM Timeout (ms)</div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">LLM Temperature</div>
            <input className="input-premium py-1.5 text-[11px] font-semibold" type="number" min="1000" max="300000" placeholder="LLM Timeout (ms)" value={aiRuntimeSettings.openaiTimeoutMs} onChange={(e) => setAiRuntimeSettings((prev) => ({ ...prev, openaiTimeoutMs: e.target.value }))} />
            <input className="input-premium py-1.5 text-[11px] font-semibold" type="number" min="0" max="2" step="0.1" placeholder="LLM Temperature" value={aiRuntimeSettings.openaiTemperature} onChange={(e) => setAiRuntimeSettings((prev) => ({ ...prev, openaiTemperature: e.target.value }))} />
            <div className="col-span-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Provider Base URL</div>
            <input className="input-premium py-1.5 text-[11px] font-semibold col-span-2" placeholder="Provider Base URL" value={aiRuntimeSettings.openaiBaseUrl || ""} onChange={(e) => {
              updateProviderConfig(selectedAiProvider, { baseUrl: e.target.value });
              setAiRuntimeSettings((prev) => ({ ...prev, openaiBaseUrl: e.target.value }));
            }} />
            <div className="col-span-2 mt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">All Provider Model Configs</div>
            <div className="col-span-2 overflow-x-auto border-y border-slate-200">
              <div className="grid min-w-[840px] grid-cols-[90px_150px_150px_minmax(220px,1fr)_90px_90px] gap-2 bg-slate-100/70 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                <div>Provider</div>
                <div>Preset</div>
                <div>Model</div>
                <div>Base URL</div>
                <div>Input / 1M</div>
                <div>Output / 1M</div>
              </div>
              {AI_PROVIDER_OPTIONS.map((providerOption) => {
                const providerConfig = providerConfigs[providerOption.value] || AI_PROVIDER_CONFIG_DEFAULTS[providerOption.value];
                const isActive = selectedAiProvider === providerOption.value;
                return (
                  <div key={providerOption.value} className="grid min-w-[840px] grid-cols-[90px_150px_150px_minmax(220px,1fr)_90px_90px] items-center gap-2 border-t border-slate-200 px-2 py-2">
                    <button
                      type="button"
                      className={`text-left text-[11px] font-bold ${isActive ? "text-emerald-700" : "text-slate-700 hover:text-slate-950"}`}
                      onClick={() => activateProvider(providerOption.value)}
                    >
                      {providerOption.label}
                    </button>
                    <select
                      className="input-premium py-1.5 text-[11px] font-semibold"
                      value={providerConfig.model}
                      onChange={(e) => {
                        const model = e.target.value;
                        const pricing = getAiModelPricing(model, providerOption.value);
                        updateProviderConfig(providerOption.value, {
                          model,
                          inputCostPer1M: pricing.openaiInputCostPer1M,
                          outputCostPer1M: pricing.openaiOutputCostPer1M,
                        });
                      }}
                    >
                      {modelOptionsForProvider(providerOption.value, providerConfig.model).map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                    <input className="input-premium py-1.5 text-[11px] font-semibold" placeholder="Custom model" value={providerConfig.model || ""} onChange={(e) => updateProviderConfig(providerOption.value, { model: e.target.value })} />
                    <input className="input-premium py-1.5 text-[11px] font-semibold" placeholder="Base URL" value={providerConfig.baseUrl || ""} onChange={(e) => updateProviderConfig(providerOption.value, { baseUrl: e.target.value })} />
                    <input className="input-premium py-1.5 text-[11px] font-semibold" type="number" min="0" step="0.0001" placeholder="Input / 1M" value={providerConfig.inputCostPer1M ?? 0} onChange={(e) => updateProviderConfig(providerOption.value, { inputCostPer1M: e.target.value })} />
                    <input className="input-premium py-1.5 text-[11px] font-semibold" type="number" min="0" step="0.0001" placeholder="Output / 1M" value={providerConfig.outputCostPer1M ?? 0} onChange={(e) => updateProviderConfig(providerOption.value, { outputCostPer1M: e.target.value })} />
                  </div>
                );
              })}
            </div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">LLM Max Output Tokens</div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Insight Max Series Points</div>
            <input className="input-premium py-1.5 text-[11px] font-semibold" type="number" min="32" max="4096" placeholder="OpenAI Max Output Tokens" value={aiRuntimeSettings.openaiMaxOutputTokens} onChange={(e) => setAiRuntimeSettings((prev) => ({ ...prev, openaiMaxOutputTokens: e.target.value }))} />
            <input className="input-premium py-1.5 text-[11px] font-semibold" type="number" min="4" max="200" placeholder="Insight Max Series Points" value={aiRuntimeSettings.insightAiMaxSeriesPoints} onChange={(e) => setAiRuntimeSettings((prev) => ({ ...prev, insightAiMaxSeriesPoints: e.target.value }))} />
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Insight Max Prompt Chars</div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Chat Audio Max Chars</div>
            <input className="input-premium py-1.5 text-[11px] font-semibold" type="number" min="1000" max="200000" placeholder="Insight Max Prompt Chars" value={aiRuntimeSettings.insightAiMaxPromptChars} onChange={(e) => setAiRuntimeSettings((prev) => ({ ...prev, insightAiMaxPromptChars: e.target.value }))} />
            <input className="input-premium py-1.5 text-[11px] font-semibold" type="number" min="1000" max="100000" placeholder="Chat Audio Max Chars" value={aiRuntimeSettings.chatAudioMaxChars} onChange={(e) => setAiRuntimeSettings((prev) => ({ ...prev, chatAudioMaxChars: e.target.value }))} />
            <div className="col-span-2 mt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Business Type Detection</div>
            <select className="input-premium py-1.5 text-[11px] font-semibold col-span-2" value={aiRuntimeSettings.businessClassificationModel || AI_PROVIDER_DEFAULTS[selectedAiProvider].model} onChange={(e) => setAiRuntimeSettings((prev) => ({ ...prev, businessClassificationModel: e.target.value }))}>
              {modelOptionsForProvider(selectedAiProvider, aiRuntimeSettings.businessClassificationModel).map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <label className="inline-flex items-center gap-2 text-[11px] font-semibold text-slate-700 px-2 py-1 rounded-md border border-slate-200">
              <input type="checkbox" checked={aiRuntimeSettings.businessClassificationApplyUploads !== false} onChange={(e) => setAiRuntimeSettings((prev) => ({ ...prev, businessClassificationApplyUploads: e.target.checked }))} />
              <span>Uploads</span>
            </label>
            <label className="inline-flex items-center gap-2 text-[11px] font-semibold text-slate-700 px-2 py-1 rounded-md border border-slate-200">
              <input type="checkbox" checked={aiRuntimeSettings.businessClassificationApplyEmailIngest !== false} onChange={(e) => setAiRuntimeSettings((prev) => ({ ...prev, businessClassificationApplyEmailIngest: e.target.checked }))} />
              <span>Email Ingest</span>
            </label>
            <label className="inline-flex items-center gap-2 text-[11px] font-semibold text-slate-700 px-2 py-1 rounded-md border border-slate-200 col-span-2">
              <input type="checkbox" checked={aiRuntimeSettings.businessClassificationApplyAutosync !== false} onChange={(e) => setAiRuntimeSettings((prev) => ({ ...prev, businessClassificationApplyAutosync: e.target.checked }))} />
              <span>Autosync</span>
            </label>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Sample Rows</div>
            <input className="input-premium py-1.5 text-[11px] font-semibold" type="number" min="0" max="100" placeholder="Sample Rows" value={aiRuntimeSettings.businessClassificationMaxSampleRows} onChange={(e) => setAiRuntimeSettings((prev) => ({ ...prev, businessClassificationMaxSampleRows: e.target.value }))} />
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Prompt Chars</div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Output Tokens</div>
            <input className="input-premium py-1.5 text-[11px] font-semibold" type="number" min="1000" max="50000" placeholder="Prompt Chars" value={aiRuntimeSettings.businessClassificationMaxPromptChars} onChange={(e) => setAiRuntimeSettings((prev) => ({ ...prev, businessClassificationMaxPromptChars: e.target.value }))} />
            <input className="input-premium py-1.5 text-[11px] font-semibold" type="number" min="128" max="2048" placeholder="Output Tokens" value={aiRuntimeSettings.businessClassificationMaxOutputTokens} onChange={(e) => setAiRuntimeSettings((prev) => ({ ...prev, businessClassificationMaxOutputTokens: e.target.value }))} />
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Input Cost / 1M Tokens (USD)</div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Output Cost / 1M Tokens (USD)</div>
            <input className="input-premium py-1.5 text-[11px] font-semibold bg-slate-50 text-slate-500" readOnly value={Number(aiRuntimeSettings.openaiInputCostPer1M || 0).toFixed(4)} />
            <input className="input-premium py-1.5 text-[11px] font-semibold bg-slate-50 text-slate-500" readOnly value={Number(aiRuntimeSettings.openaiOutputCostPer1M || 0).toFixed(4)} />
            <div className="col-span-2 mt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Translation Model</div>
            <select className="input-premium py-1.5 text-[11px] font-semibold col-span-2" value={aiRuntimeSettings.translationOpenaiModel || AI_PROVIDER_DEFAULTS[selectedAiProvider].model} onChange={(e) => setAiRuntimeSettings((prev) => ({ ...prev, translationOpenaiModel: e.target.value }))}>
              {modelOptionsForProvider(selectedAiProvider, aiRuntimeSettings.translationOpenaiModel).map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <div className="col-span-2 mt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Insight AI Model</div>
            <select className="input-premium py-1.5 text-[11px] font-semibold col-span-2" value={aiRuntimeSettings.insightAiModel || AI_PROVIDER_DEFAULTS[selectedAiProvider].model} onChange={(e) => setAiRuntimeSettings((prev) => ({ ...prev, insightAiModel: e.target.value }))}>
              {modelOptionsForProvider(selectedAiProvider, aiRuntimeSettings.insightAiModel).map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Translation Temperature</div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Translation Max Output Tokens</div>
            <input className="input-premium py-1.5 text-[11px] font-semibold" type="number" min="0" max="2" step="0.1" placeholder="Translation Temperature" value={aiRuntimeSettings.translationTemperature} onChange={(e) => setAiRuntimeSettings((prev) => ({ ...prev, translationTemperature: e.target.value }))} />
            <input className="input-premium py-1.5 text-[11px] font-semibold" type="number" min="32" max="4096" placeholder="Translation Max Output Tokens" value={aiRuntimeSettings.translationMaxOutputTokens} onChange={(e) => setAiRuntimeSettings((prev) => ({ ...prev, translationMaxOutputTokens: e.target.value }))} />
            <div className="col-span-2 mt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Text-To-Voice Models</div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">TTS Model (English)</div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">TTS Model (Default)</div>
            <select className="input-premium py-1.5 text-[11px] font-semibold" value={aiRuntimeSettings.chatAudioTtsModelEn || "tts-1"} onChange={(e) => setAiRuntimeSettings((prev) => ({ ...prev, chatAudioTtsModelEn: e.target.value }))}>
              <option value="tts-1">tts-1</option>
              <option value="tts-1-hd">tts-1-hd</option>
            </select>
            <select className="input-premium py-1.5 text-[11px] font-semibold" value={aiRuntimeSettings.chatAudioTtsModelDefault || "tts-1"} onChange={(e) => setAiRuntimeSettings((prev) => ({ ...prev, chatAudioTtsModelDefault: e.target.value }))}>
              <option value="tts-1">tts-1</option>
              <option value="tts-1-hd">tts-1-hd</option>
            </select>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">TTS Voice</div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">TTS Speed</div>
            <input className="input-premium py-1.5 text-[11px] font-semibold" placeholder="nova" value={aiRuntimeSettings.chatAudioTtsVoice || "nova"} onChange={(e) => setAiRuntimeSettings((prev) => ({ ...prev, chatAudioTtsVoice: e.target.value }))} />
            <input className="input-premium py-1.5 text-[11px] font-semibold" type="number" min="0.25" max="4" step="0.05" placeholder="0.9" value={aiRuntimeSettings.chatAudioTtsSpeed} onChange={(e) => setAiRuntimeSettings((prev) => ({ ...prev, chatAudioTtsSpeed: e.target.value }))} />
          </div>
          <button
            type="button"
            onClick={() => saveAiRuntimeSetting(null)}
            disabled={aiRuntimeSaving}
            className={`btn-premium text-white w-full py-2 ${aiRuntimeSaved ? "bg-emerald-600 hover:bg-emerald-600" : "bg-slate-800"} ${aiRuntimeSaving ? "opacity-60 cursor-not-allowed" : ""}`}
          >
            {aiRuntimeSaving ? "Saving..." : aiRuntimeSaved ? "Saved" : "Save AI Runtime Settings"}
          </button>
          <div className="rounded-md border border-slate-200 bg-slate-50 p-2 space-y-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-600">AI Usage Stats</div>
            <div className="flex items-center gap-2">
              <input
                type="month"
                className="input-premium py-1.5 text-[11px] font-semibold"
                value={aiUsagePeriodMonth || ""}
                onChange={(e) => setAiUsagePeriodMonth(e.target.value)}
              />
              <button
                type="button"
                onClick={() => fetchAiUsageSummary(aiUsagePeriodMonth)}
                disabled={aiUsageLoading}
                className={`btn-premium bg-slate-800 text-white px-3 py-2 ${aiUsageLoading ? "opacity-60 cursor-not-allowed" : ""}`}
              >
                {aiUsageLoading ? "Loading..." : "Refresh"}
              </button>
            </div>
            {aiUsageError ? (
              <div className="text-[10px] font-semibold text-red-600">{aiUsageError}</div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-700">
                  <div>Queries: <span className="font-semibold">{Number(aiUsageSummary?.totals?.queryCount || aiUsageSummary?.appLocal?.queryCount || 0)}</span></div>
                  <div>Estimated Cost: <span className="font-semibold">${Number(aiUsageSummary?.totals?.estimatedCostUsd || aiUsageSummary?.appLocal?.estimatedCostUsd || 0).toFixed(2)}</span></div>
                  <div>Prompt Tokens: <span className="font-semibold">{Number(aiUsageSummary?.totals?.promptTokens || aiUsageSummary?.appLocal?.promptTokens || 0)}</span></div>
                  <div>Completion Tokens: <span className="font-semibold">{Number(aiUsageSummary?.totals?.completionTokens || aiUsageSummary?.appLocal?.completionTokens || 0)}</span></div>
                  {aiUsageSummary?.openAi?.source === "openai" ? (
                    <div>OpenAI Requests: <span className="font-semibold">{Number(aiUsageSummary?.openAi?.queryCount || 0)}</span></div>
                  ) : null}
                  {aiUsageSummary?.openAi?.source === "openai" ? (
                    <div>OpenAI Actual Cost: <span className="font-semibold">${Number(aiUsageSummary?.openAi?.actualCostUsd || 0).toFixed(2)}</span></div>
                  ) : null}
                </div>
                {aiUsageSummary?.openAi?.source === "openai" && aiUsageSummary?.openAi?.error ? (
                  <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-800">
                    OpenAI usage issue: {aiUsageSummary.openAi.error}
                  </div>
                ) : null}
                {Array.isArray(aiUsageSummary?.openAi?.lineItems) && aiUsageSummary.openAi.lineItems.length ? (
                  <div className="max-h-28 overflow-auto rounded border border-slate-200 bg-white">
                    {aiUsageSummary.openAi.lineItems.map((item) => (
                      <div key={item.lineItem || "Uncategorized"} className="flex items-center justify-between gap-2 px-2 py-1 text-[10px] border-b border-slate-100 last:border-b-0">
                        <div className="truncate text-slate-700">{item.lineItem || "Uncategorized"}</div>
                        <div className="shrink-0 font-semibold text-slate-700">${Number(item.costUsd || 0).toFixed(2)}</div>
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="max-h-40 overflow-auto rounded border border-slate-200 bg-white">
                  {(Array.isArray(aiUsageSummary?.groups) && aiUsageSummary.groups.length)
                    ? aiUsageSummary.groups.map((row) => (
                      <div key={`${row.groupId}-${row.model || "n/a"}`} className="flex items-center justify-between gap-2 px-2 py-1 text-[10px] border-b border-slate-100 last:border-b-0">
                        <div className="truncate text-slate-700">{row.groupName}</div>
                        <div className="shrink-0 text-slate-500">{Number(row.queryCount || 0)} q</div>
                        <div className="shrink-0 font-semibold text-slate-700">${Number(row.estimatedCostUsd || 0).toFixed(2)}</div>
                      </div>
                    ))
                    : <div className="px-2 py-2 text-[10px] text-slate-500">No AI usage records for this month.</div>}
                </div>
              </>
            )}
          </div>
          </>
          )}
        </div>
      )}


      <div className="pt-1">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Authentication Options</div>
      </div>

      {/* Google */}
      <div className={`rounded-md border bg-white p-3 space-y-2 ${googleConfigured && integrationTestStatus.google === "success" ? "border-emerald-400" : "border-slate-200"}`}>
        <div className="flex items-center justify-between"><div className="flex items-center gap-2"><img src={INTEGRATION_LOGOS.google} alt="Google logo" className="h-4 w-4 rounded-sm object-contain bg-white" loading="lazy" /><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Google OAuth Configuration</div><span className={`text-[10px] font-semibold ${googleConfigured ? "text-emerald-600" : "text-slate-400"}`}>{googleConfigured ? "Configured" : "Not configured"}</span>{integrationTestStatus.google === "success" && <span className="text-[10px] font-semibold text-emerald-600">Tested</span>}</div><button type="button" className="text-[12px] font-bold text-slate-900 hover:text-slate-900" onClick={() => setIntegrationOpen((prev) => ({ ...prev, google: !prev.google }))}>{integrationOpen.google ? "Collapse" : "Expand"}</button></div>
        {integrationOpen.google && <><input type="password" className="input-premium" placeholder={googleOauthMeta.hasClientId ? "***" : "Google Client ID"} value={googleOauthForm.clientId} onChange={(e) => setGoogleOauthForm((prev) => ({ ...prev, clientId: e.target.value }))} autoComplete="new-password" /><input type="password" className="input-premium" placeholder={googleOauthMeta.hasClientSecret ? "***" : "Google Client Secret"} value={googleOauthForm.clientSecret} onChange={(e) => setGoogleOauthForm((prev) => ({ ...prev, clientSecret: e.target.value }))} autoComplete="new-password" /><input className="input-premium" placeholder="Redirect URI" value={googleOauthForm.redirectUri} onChange={(e) => setGoogleOauthForm((prev) => ({ ...prev, redirectUri: e.target.value }))} /><input className="input-premium" placeholder="Frontend URL" value={googleOauthForm.frontendUrl} onChange={(e) => setGoogleOauthForm((prev) => ({ ...prev, frontendUrl: e.target.value }))} /><div className="grid grid-cols-2 gap-2"><button type="button" onClick={saveGoogleOauthSetting} disabled={googleOauthSaving} className={`btn-premium text-white w-full py-2 ${googleOauthSaved ? "bg-emerald-600 hover:bg-emerald-600" : "bg-slate-800"} ${googleOauthSaving ? "opacity-60 cursor-not-allowed" : ""}`}>{googleOauthSaving ? "Saving..." : googleOauthSaved ? "Saved" : "Save Google OAuth"}</button><button type="button" onClick={testGoogleOauthSetting} disabled={googleOauthTesting} className={`btn-premium bg-indigo-600 text-white w-full py-2 ${googleOauthTesting ? "opacity-60 cursor-not-allowed" : ""}`}>{googleOauthTesting ? "Testing..." : "Test Google OAuth"}</button></div></>}
      </div>

      {/* SAML */}
      <div className={`rounded-md border bg-white p-3 space-y-2 ${samlConfigured && integrationTestStatus.saml === "success" ? "border-emerald-400" : "border-slate-200"}`}>
        <div className="flex items-center justify-between"><div className="flex items-center gap-2"><img src={INTEGRATION_LOGOS.saml} alt="SAML icon" className="h-4 w-4 rounded-sm object-contain bg-white" loading="lazy" /><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">SAML SSO Configuration</div><span className={`text-[10px] font-semibold ${samlConfigured ? "text-emerald-600" : "text-slate-400"}`}>{samlConfigured ? "Configured" : "Not configured"}</span>{integrationTestStatus.saml === "success" && <span className="text-[10px] font-semibold text-emerald-600">Tested</span>}</div><button type="button" className="text-[12px] font-bold text-slate-900 hover:text-slate-900" onClick={() => setIntegrationOpen((prev) => ({ ...prev, saml: !prev.saml }))}>{integrationOpen.saml ? "Collapse" : "Expand"}</button></div>
        {integrationOpen.saml && <><input className="input-premium" placeholder="IdP SSO URL" value={samlForm.idpSsoUrl} onChange={(e) => setSamlForm((prev) => ({ ...prev, idpSsoUrl: e.target.value }))} /><input className="input-premium" placeholder="IdP Entity ID (Issuer)" value={samlForm.idpEntityId} onChange={(e) => setSamlForm((prev) => ({ ...prev, idpEntityId: e.target.value }))} /><input className="input-premium" placeholder="SP Entity ID (Audience)" value={samlForm.spEntityId} onChange={(e) => setSamlForm((prev) => ({ ...prev, spEntityId: e.target.value }))} /><input className="input-premium" placeholder="ACS URL" value={samlForm.acsUrl} onChange={(e) => setSamlForm((prev) => ({ ...prev, acsUrl: e.target.value }))} /><input className="input-premium" placeholder="NameID Format URI" value={samlForm.nameIdFormat} onChange={(e) => setSamlForm((prev) => ({ ...prev, nameIdFormat: e.target.value }))} /><textarea className="input-premium min-h-[110px]" placeholder={samlMeta.hasX509Certificate ? "X.509 certificate configured (edit to replace)" : "IdP X.509 Certificate"} value={samlForm.x509Certificate} onChange={(e) => setSamlForm((prev) => ({ ...prev, x509Certificate: e.target.value }))} /><input className="input-premium" placeholder="Default Relay State (optional)" value={samlForm.defaultRelayState} onChange={(e) => setSamlForm((prev) => ({ ...prev, defaultRelayState: e.target.value }))} /><div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-[11px] text-slate-600 space-y-1"><div className="font-semibold text-slate-700">SAML setup docs</div><a className="block text-blue-700 hover:underline" href="https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/add-application-portal-setup-sso" target="_blank" rel="noreferrer">Microsoft Entra SAML setup</a><a className="block text-blue-700 hover:underline" href="https://help.okta.com/en-us/content/topics/apps/apps_app_integration_wizard_saml.htm" target="_blank" rel="noreferrer">Okta SAML app integration</a><a className="block text-blue-700 hover:underline" href="https://samltool.com/" target="_blank" rel="noreferrer">SAML tools and metadata validation</a></div><div className="grid grid-cols-2 gap-2"><button type="button" onClick={saveSamlSetting} disabled={samlSaving} className={`btn-premium text-white w-full py-2 ${samlSaved ? "bg-emerald-600 hover:bg-emerald-600" : "bg-slate-800"} ${samlSaving ? "opacity-60 cursor-not-allowed" : ""}`}>{samlSaving ? "Saving..." : samlSaved ? "Saved" : "Save SAML Settings"}</button><button type="button" onClick={testSamlSetting} disabled={samlTesting} className={`btn-premium bg-indigo-600 text-white w-full py-2 ${samlTesting ? "opacity-60 cursor-not-allowed" : ""}`}>{samlTesting ? "Testing..." : "Test SAML Settings"}</button></div></>}
      </div>

      <div className="pt-1">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Data Source Integrations</div>
      </div>

      <div className="rounded-md border border-slate-200 bg-white p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Autosync Check Interval</div>
          <span className="text-[10px] font-semibold text-slate-400">{autosyncInterval.intervalMinutes || 5} min</span>
        </div>
        <input className="input-premium py-1.5 text-[11px] font-semibold" type="number" min="1" max="1440" placeholder="Interval in minutes" value={autosyncInterval.intervalMinutes} onChange={(e) => setAutosyncInterval((prev) => ({ ...prev, intervalMinutes: e.target.value }))} />
        <div className="text-[10px] text-slate-500">Cloud drive sources are checked for file updates on this interval.</div>
        <button type="button" onClick={saveAutosyncIntervalSetting} disabled={autosyncIntervalSaving} className={`btn-premium text-white w-full py-1.5 text-[11px] ${autosyncIntervalSaved ? "bg-emerald-600 hover:bg-emerald-600" : "bg-slate-800"} ${autosyncIntervalSaving ? "opacity-60 cursor-not-allowed" : ""}`}>{autosyncIntervalSaving ? "Saving..." : autosyncIntervalSaved ? "Saved" : "Save Autosync Interval"}</button>
      </div>

      {/* Dropbox */}
      <div className={`rounded-md border bg-white p-3 space-y-2 ${dropboxConfigured && integrationTestStatus.dropbox === "success" ? "border-emerald-400" : "border-slate-200"}`}>
        <div className="flex items-center justify-between"><div className="flex items-center gap-2"><img src={INTEGRATION_LOGOS.dropbox} alt="Dropbox logo" className="h-4 w-4 rounded-sm object-contain bg-white" loading="lazy" /><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Dropbox OAuth Configuration</div><span className={`text-[10px] font-semibold ${dropboxConfigured ? "text-emerald-600" : "text-slate-400"}`}>{dropboxConfigured ? "Configured" : "Not configured"}</span>{integrationTestStatus.dropbox === "success" && <span className="text-[10px] font-semibold text-emerald-600">Tested</span>}</div><button type="button" className="text-[12px] font-bold text-slate-900 hover:text-slate-900" onClick={() => setIntegrationOpen((prev) => ({ ...prev, dropbox: !prev.dropbox }))}>{integrationOpen.dropbox ? "Collapse" : "Expand"}</button></div>
        {integrationOpen.dropbox && <><input type="password" className="input-premium" placeholder={dropboxOauthMeta.hasClientId ? "***" : "Dropbox App Key (Client ID)"} value={dropboxOauthForm.clientId} onChange={(e) => setDropboxOauthForm((prev) => ({ ...prev, clientId: e.target.value }))} autoComplete="new-password" /><input type="password" className="input-premium" placeholder={dropboxOauthMeta.hasClientSecret ? "***" : "Dropbox App Secret (Client Secret)"} value={dropboxOauthForm.clientSecret} onChange={(e) => setDropboxOauthForm((prev) => ({ ...prev, clientSecret: e.target.value }))} autoComplete="new-password" /><input className="input-premium" placeholder="Redirect URI" value={dropboxOauthForm.redirectUri} onChange={(e) => setDropboxOauthForm((prev) => ({ ...prev, redirectUri: e.target.value }))} /><input className="input-premium" placeholder="Frontend URL" value={dropboxOauthForm.frontendUrl} onChange={(e) => setDropboxOauthForm((prev) => ({ ...prev, frontendUrl: e.target.value }))} /><div className="grid grid-cols-2 gap-2"><button type="button" onClick={saveDropboxOauthSetting} disabled={dropboxOauthSaving} className={`btn-premium text-white w-full py-2 ${dropboxOauthSaved ? "bg-emerald-600 hover:bg-emerald-600" : "bg-slate-800"} ${dropboxOauthSaving ? "opacity-60 cursor-not-allowed" : ""}`}>{dropboxOauthSaving ? "Saving..." : dropboxOauthSaved ? "Saved" : "Save Dropbox OAuth"}</button><button type="button" onClick={testDropboxOauthSetting} disabled={dropboxOauthTesting} className={`btn-premium bg-indigo-600 text-white w-full py-2 ${dropboxOauthTesting ? "opacity-60 cursor-not-allowed" : ""}`}>{dropboxOauthTesting ? "Testing..." : "Test Dropbox OAuth"}</button></div></>}
      </div>

      {/* OneDrive */}
      <div className={`rounded-md border bg-white p-3 space-y-2 ${oneDriveConfigured && integrationTestStatus.onedrive === "success" ? "border-emerald-400" : "border-slate-200"}`}>
        <div className="flex items-center justify-between"><div className="flex items-center gap-2"><img src={INTEGRATION_LOGOS.onedrive} alt="OneDrive logo" className="h-4 w-4 rounded-sm object-contain bg-white" loading="lazy" /><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">OneDrive OAuth Configuration</div><span className={`text-[10px] font-semibold ${oneDriveConfigured ? "text-emerald-600" : "text-slate-400"}`}>{oneDriveConfigured ? "Configured" : "Not configured"}</span>{integrationTestStatus.onedrive === "success" && <span className="text-[10px] font-semibold text-emerald-600">Tested</span>}</div><button type="button" className="text-[12px] font-bold text-slate-900 hover:text-slate-900" onClick={() => setIntegrationOpen((prev) => ({ ...prev, onedrive: !prev.onedrive }))}>{integrationOpen.onedrive ? "Collapse" : "Expand"}</button></div>
        {integrationOpen.onedrive && <><input type="password" className="input-premium" placeholder={oneDriveOauthMeta.hasClientId ? "***" : "Microsoft Application (Client) ID"} value={oneDriveOauthForm.clientId} onChange={(e) => setOneDriveOauthForm((prev) => ({ ...prev, clientId: e.target.value }))} autoComplete="new-password" /><input type="password" className="input-premium" placeholder={oneDriveOauthMeta.hasClientSecret ? "***" : "Microsoft Client Secret"} value={oneDriveOauthForm.clientSecret} onChange={(e) => setOneDriveOauthForm((prev) => ({ ...prev, clientSecret: e.target.value }))} autoComplete="new-password" /><input className="input-premium" placeholder="Redirect URI" value={oneDriveOauthForm.redirectUri} onChange={(e) => setOneDriveOauthForm((prev) => ({ ...prev, redirectUri: e.target.value }))} /><input className="input-premium" placeholder="Frontend URL" value={oneDriveOauthForm.frontendUrl} onChange={(e) => setOneDriveOauthForm((prev) => ({ ...prev, frontendUrl: e.target.value }))} /><div className="grid grid-cols-2 gap-2"><button type="button" onClick={saveOneDriveOauthSetting} disabled={oneDriveOauthSaving} className={`btn-premium text-white w-full py-2 ${oneDriveOauthSaved ? "bg-emerald-600 hover:bg-emerald-600" : "bg-slate-800"} ${oneDriveOauthSaving ? "opacity-60 cursor-not-allowed" : ""}`}>{oneDriveOauthSaving ? "Saving..." : oneDriveOauthSaved ? "Saved" : "Save OneDrive OAuth"}</button><button type="button" onClick={testOneDriveOauthSetting} disabled={oneDriveOauthTesting} className={`btn-premium bg-indigo-600 text-white w-full py-2 ${oneDriveOauthTesting ? "opacity-60 cursor-not-allowed" : ""}`}>{oneDriveOauthTesting ? "Testing..." : "Test OneDrive OAuth"}</button></div></>}
      </div>

      {/* QuickBooks */}
      <div className={`rounded-md border bg-white p-3 space-y-2 ${quickbooksConfigured && integrationTestStatus.quickbooks === "success" ? "border-emerald-400" : "border-slate-200"}`}>
        <div className="flex items-center justify-between"><div className="flex items-center gap-2"><img src={INTEGRATION_LOGOS.quickbooks} alt="QuickBooks logo" className="h-4 w-4 rounded-sm object-contain bg-white" loading="lazy" /><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">QuickBooks OAuth Configuration</div><span className={`text-[10px] font-semibold ${quickbooksConfigured ? "text-emerald-600" : "text-slate-400"}`}>{quickbooksConfigured ? "Configured" : "Not configured"}</span>{integrationTestStatus.quickbooks === "success" && <span className="text-[10px] font-semibold text-emerald-600">Tested</span>}{enterpriseOnlyLocked && <span className="text-[10px] font-semibold text-amber-700">Enterprise only</span>}</div><button type="button" className="text-[12px] font-bold text-slate-900 hover:text-slate-900" onClick={() => setIntegrationOpen((prev) => ({ ...prev, quickbooks: !prev.quickbooks }))}>{integrationOpen.quickbooks ? "Collapse" : "Expand"}</button></div>
        {integrationOpen.quickbooks && <><input type="password" className="input-premium" placeholder={quickbooksOauthMeta.hasClientId ? "***" : "QuickBooks Client ID"} value={quickbooksOauthForm.clientId} onChange={(e) => setQuickbooksOauthForm((prev) => ({ ...prev, clientId: e.target.value }))} autoComplete="new-password" disabled={enterpriseOnlyLocked} /><input type="password" className="input-premium" placeholder={quickbooksOauthMeta.hasClientSecret ? "***" : "QuickBooks Client Secret"} value={quickbooksOauthForm.clientSecret} onChange={(e) => setQuickbooksOauthForm((prev) => ({ ...prev, clientSecret: e.target.value }))} autoComplete="new-password" disabled={enterpriseOnlyLocked} /><input className="input-premium" placeholder="Redirect URI" value={quickbooksOauthForm.redirectUri} onChange={(e) => setQuickbooksOauthForm((prev) => ({ ...prev, redirectUri: e.target.value }))} disabled={enterpriseOnlyLocked} /><input className="input-premium" placeholder="Frontend URL" value={quickbooksOauthForm.frontendUrl} onChange={(e) => setQuickbooksOauthForm((prev) => ({ ...prev, frontendUrl: e.target.value }))} disabled={enterpriseOnlyLocked} /><select className="input-premium" value={quickbooksOauthForm.environment} onChange={(e) => setQuickbooksOauthForm((prev) => ({ ...prev, environment: e.target.value === "sandbox" ? "sandbox" : "production" }))} disabled={enterpriseOnlyLocked}><option value="production">Production</option><option value="sandbox">Sandbox</option></select><input className="input-premium" placeholder="Company ID (Realm ID)" value={quickbooksOauthForm.companyId} onChange={(e) => setQuickbooksOauthForm((prev) => ({ ...prev, companyId: e.target.value }))} disabled={enterpriseOnlyLocked} /><div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-[11px] text-slate-600 space-y-2"><div className="font-semibold text-slate-700">Read-only import data types</div><div className="grid grid-cols-2 gap-1">{QUICKBOOKS_DATA_TYPE_OPTIONS.map((dataType) => {const selected = quickbooksOauthForm.selectedDataTypes.includes(dataType);return (<label key={dataType} className="flex items-center gap-1.5 text-[12px] font-bold text-slate-900"><input type="checkbox" checked={selected} disabled={enterpriseOnlyLocked} onChange={(e) => setQuickbooksOauthForm((prev) => {const current = Array.isArray(prev.selectedDataTypes) ? prev.selectedDataTypes : [];const next = e.target.checked ? Array.from(new Set([...current, dataType])) : current.filter((entry) => entry !== dataType);return { ...prev, selectedDataTypes: next };})}/>{dataType}</label>);})}</div></div><div className="grid grid-cols-2 gap-2"><button type="button" onClick={saveQuickbooksOauthSetting} disabled={quickbooksOauthSaving || enterpriseOnlyLocked} className={`btn-premium text-white w-full py-2 ${quickbooksOauthSaved ? "bg-emerald-600 hover:bg-emerald-600" : "bg-slate-800"} ${(quickbooksOauthSaving || enterpriseOnlyLocked) ? "opacity-60 cursor-not-allowed" : ""}`}>{quickbooksOauthSaving ? "Saving..." : quickbooksOauthSaved ? "Saved" : "Save QuickBooks OAuth"}</button><button type="button" onClick={testQuickbooksOauthSetting} disabled={quickbooksOauthTesting || enterpriseOnlyLocked} className={`btn-premium bg-indigo-600 text-white w-full py-2 ${(quickbooksOauthTesting || enterpriseOnlyLocked) ? "opacity-60 cursor-not-allowed" : ""}`}>{quickbooksOauthTesting ? "Testing..." : "Test QuickBooks OAuth"}</button></div></>}
      </div>

      <div className="rounded-md border border-slate-200 bg-white p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <img src={INTEGRATION_LOGOS.email} alt="Email icon" className="h-4 w-4 rounded-sm object-contain bg-white" loading="lazy" />
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Email Ingest</div>
            <span className={`text-[10px] font-semibold ${emailIngestConfig.enabled !== false ? "text-emerald-600" : "text-slate-400"}`}>{emailIngestConfig.enabled !== false ? "Enabled" : "Disabled"}</span>
            {!emailIngestConfig.enabled && <span className="text-[10px] font-semibold text-slate-400">Configured</span>}
            {enterpriseOnlyLocked && <span className="text-[10px] font-semibold text-amber-700">Enterprise only</span>}
          </div>
          <button type="button" className="text-[12px] font-bold text-slate-900 hover:text-slate-900" onClick={() => setIntegrationOpen((prev) => ({ ...prev, emailIngest: !prev.emailIngest }))}>{integrationOpen.emailIngest ? "Collapse" : "Expand"}</button>
        </div>
        {integrationOpen.emailIngest && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <label className="inline-flex items-center gap-2 text-[11px] font-semibold text-slate-700 px-2 py-1 rounded-md border border-slate-200">
                <input type="checkbox" checked={emailIngestConfig.enabled !== false} disabled={!isSuperAdmin || enterpriseOnlyLocked} onChange={(e) => setEmailIngestConfig((prev) => ({ ...prev, enabled: e.target.checked }))} />Enable email ingestion
              </label>
              <label className="inline-flex items-center gap-2 text-[11px] font-semibold text-slate-700 px-2 py-1 rounded-md border border-slate-200">
                <input type="checkbox" checked={emailIngestConfig.requireApprovedSenders !== false} disabled={!isSuperAdmin || enterpriseOnlyLocked} onChange={(e) => setEmailIngestConfig((prev) => ({ ...prev, requireApprovedSenders: e.target.checked }))} />Require approved senders
              </label>
            </div>
            <input className="input-premium py-1.5 text-[11px] font-semibold" placeholder="Inbound domain (e.g. reports.example.com)" value={emailIngestConfig.inboundDomain} disabled={!isSuperAdmin || enterpriseOnlyLocked} onChange={(e) => setEmailIngestConfig((prev) => ({ ...prev, inboundDomain: e.target.value }))} />
            <input className="input-premium py-1.5 text-[11px] font-semibold" placeholder="Inbound mailbox / catch-all destination (e.g. imports@reports.example.com)" value={emailIngestConfig.routeMailbox} disabled={!isSuperAdmin || enterpriseOnlyLocked} onChange={(e) => setEmailIngestConfig((prev) => ({ ...prev, routeMailbox: e.target.value }))} />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <input className="input-premium py-1.5 text-[11px] font-semibold" placeholder="Customer address prefix (e.g. customer)" value={emailIngestConfig.addressPrefix} disabled={!isSuperAdmin || enterpriseOnlyLocked} onChange={(e) => setEmailIngestConfig((prev) => ({ ...prev, addressPrefix: e.target.value }))} />
              <select className="input-premium py-1.5 text-[11px] font-semibold" value={emailIngestConfig.addressMode} disabled={!isSuperAdmin || enterpriseOnlyLocked} onChange={(e) => setEmailIngestConfig((prev) => ({ ...prev, addressMode: e.target.value }))}><option value="slug">Use customer slug</option><option value="id">Use customer ID</option></select>
            </div>
            <select className="input-premium py-1.5 text-[11px] font-semibold" value={emailIngestConfig.routingMode} disabled={!isSuperAdmin || enterpriseOnlyLocked} onChange={(e) => setEmailIngestConfig((prev) => ({ ...prev, routingMode: e.target.value }))}><option value="catch_all">Google Workspace catch-all routing</option><option value="default_routing">Google Workspace default routing</option></select>
            <textarea className="input-premium py-1.5 text-[11px] font-semibold min-h-[84px]" placeholder="Allowed sender domains, one per line or comma-separated (e.g. customer.com)" value={Array.isArray(emailIngestConfig.allowedSenderDomains) ? emailIngestConfig.allowedSenderDomains.join("\n") : String(emailIngestConfig.allowedSenderDomains || "")} disabled={enterpriseOnlyLocked} onChange={(e) => setEmailIngestConfig((prev) => ({ ...prev, allowedSenderDomains: String(e.target.value || "").split(/[\n,]+/).map((v) => v.trim()).filter(Boolean) }))} />
            <input className="input-premium py-1.5 text-[11px] font-semibold" placeholder="Internal notes" value={emailIngestConfig.notes} disabled={!isSuperAdmin || enterpriseOnlyLocked} onChange={(e) => setEmailIngestConfig((prev) => ({ ...prev, notes: e.target.value }))} />
            <div className="text-[10px] text-slate-500">Allowed sender domains are applied to the selected customer when a customer is selected; otherwise they update the global default.</div>
            <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-[11px] text-slate-600 space-y-1">
              <div className="font-semibold text-slate-700">Google Workspace setup</div>
              <a className="block text-blue-700 hover:underline" href="https://support.google.com/a/answer/7502379?hl=en" target="_blank" rel="noreferrer">Add a domain or domain alias</a>
              <a className="block text-blue-700 hover:underline" href="https://support.google.com/a/answer/2368153?hl=en" target="_blank" rel="noreferrer">Set up Default routing for your organization</a>
              <a className="block text-blue-700 hover:underline" href="https://support.google.com/a/answer/12943537?hl=en" target="_blank" rel="noreferrer">Get misaddressed email in a catch-all mailbox</a>
              <div className="text-slate-500">This address should route inbound attachments to the mailbox the app watches. Generated customer addresses can be derived from the prefix + customer slug or ID.</div>
            </div>
            <button type="button" onClick={saveEmailIngestSetting} disabled={emailIngestSaving || enterpriseOnlyLocked} className={`btn-premium text-white w-full py-1.5 text-[11px] ${emailIngestSaved ? "bg-emerald-600 hover:bg-emerald-600" : "bg-slate-800"} ${(emailIngestSaving || enterpriseOnlyLocked) ? "opacity-60 cursor-not-allowed" : ""}`}>{emailIngestSaving ? "Saving..." : emailIngestSaved ? "Saved" : "Save Email Ingest Settings"}</button>
          </>
        )}
      </div>

      {STORAGE_PROVIDER_DEFS.map((provider) => {
        const state = storageSettings[provider.key] || createStorageProviderState(provider);
        const providerEnterpriseLocked = enterpriseOnlyLocked && enterpriseOnlyStorageKeys.has(provider.key);
        const configured = !!state.form.enabled && provider.fields
          .filter((field) => field.name !== "enabled")
          .every((field) => {
            if (field.secret) return !!state.meta?.[field.metaKey] || !!String(state.form[field.name] || "").trim();
            if (field.type === "checkbox") return true;
            if (field.type === "number") return Number.parseInt(state.form[field.name], 10) > 0;
            return !!String(state.form[field.name] || "").trim();
          });
        return (
          <StorageOptionCard
            key={provider.key}
            title={provider.title}
            logoUrl={provider.logoUrl}
            logoAlt={`${provider.title} logo`}
            summary={provider.summary(state)}
            configured={configured}
            tested={state.testStatus === "success"}
            open={state.open}
            onToggleOpen={() => updateStorageProvider(provider.key, (prev) => ({ ...prev, open: !prev.open }))}
            enabled={!!state.form.enabled}
            form={state.form}
            meta={state.meta}
            fields={provider.fields.map((field) => ({ ...field, disabled: field.disabled || providerEnterpriseLocked }))}
            onChange={(fieldName, fieldValue, fieldDef) => {
              if (providerEnterpriseLocked) return;
              updateStorageProvider(provider.key, (prev) => ({
                ...prev,
                form: { ...prev.form, [fieldName]: fieldValue },
                ...(fieldDef?.secret ? { meta: { ...prev.meta, [fieldDef.metaKey]: prev.meta?.[fieldDef.metaKey] } } : {}),
              }));
            }}
            onSave={() => { if (!providerEnterpriseLocked) saveStorageSetting(provider); }}
            onTest={() => { if (!providerEnterpriseLocked) testStorageSetting(provider); }}
            saving={!!state.saving}
            saved={!!state.saved}
            testing={!!state.testing}
            saveLabel={providerEnterpriseLocked ? "Enterprise only" : `Save ${provider.title}`}
            testLabel="Test Connection"
            helpLinks={provider.helpLinks}
            enterpriseOnly={providerEnterpriseLocked}
          />
        );
      })}
    </div>
  );
}
