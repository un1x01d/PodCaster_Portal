// UserManagement.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import CustomerFormModal from "./components/admin/CustomerFormModal.jsx";
import PasswordResetModal from "./components/admin/PasswordResetModal.jsx";
import IntegrationSettingsPanel from "./components/admin/IntegrationSettingsPanel.jsx";
import {
  INTEGRATION_LOGOS,
  QUICKBOOKS_DATA_TYPE_OPTIONS,
  STORAGE_PROVIDER_DEFS,
  createInitialStorageState,
  createStorageProviderState,
  generateAdminPassword,
  normalizeGroupEntitlements,
} from "./components/admin/userManagementConfig.js";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

const normalizeReviewLabelRules = (value) => {
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

const normalizeSourceLabels = (source) => {
  const labels = Array.isArray(source?.file_labels) ? source.file_labels : [];
  const syncLabel = String(source?.sync_file_label || "").trim();
  return Array.from(new Set([...labels, syncLabel].map((label) => String(label || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
};

/** ---------------------------
 * Local templates (frontend-only)
 * --------------------------- */
const LS_KEY = "permTemplates:v1";
const CUSTOMER_FEATURE_OPTIONS = [
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
const PRODUCT_BUNDLES = [
  { key: "core", label: "Core", description: "Essential sharing" },
  { key: "growth", label: "Growth", description: "Governed operations" },
  { key: "enterprise", label: "Enterprise", description: "Full controls" },
];
const BUNDLE_KEYS = PRODUCT_BUNDLES.map((bundle) => bundle.key);
const BUNDLE_DEFAULT_FEATURES = {
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
const BUNDLE_AI_LIMITS = {
  core: { maxAiQueriesPerMonth: 2000, aiMonthlyBudgetUsd: 25 },
  growth: { maxAiQueriesPerMonth: 10000, aiMonthlyBudgetUsd: 150 },
  enterprise: { maxAiQueriesPerMonth: 50000, aiMonthlyBudgetUsd: 1000 },
};
const BUNDLE_DEFAULT_CAPACITY_LIMITS = {
  core: { maxUsers: 10, maxReportSources: 3 },
  growth: { maxUsers: 50, maxReportSources: 15 },
  enterprise: { maxUsers: 250, maxReportSources: 100 },
};
const BUNDLE_AI_PRICING = {
  core: { openaiModel: "gpt-5-nano", openaiInputCostPer1M: 0.05, openaiOutputCostPer1M: 0.40 },
  growth: { openaiModel: "gpt-5-nano", openaiInputCostPer1M: 0.05, openaiOutputCostPer1M: 0.40 },
  enterprise: { openaiModel: "gpt-5-nano", openaiInputCostPer1M: 0.05, openaiOutputCostPer1M: 0.40 },
};
const AI_MODEL_PRICING = {
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
function getAiModelPricing(model) {
  return AI_MODEL_PRICING[String(model || "").trim()] || AI_MODEL_PRICING["gpt-5-nano"];
}
const BUSINESS_CLASSIFICATION_RUNTIME_DEFAULTS = {
  businessClassificationEnabled: false,
  businessClassificationModel: "gpt-5-nano",
  businessClassificationApplyUploads: true,
  businessClassificationApplyEmailIngest: true,
  businessClassificationApplyAutosync: true,
  businessClassificationMaxSampleRows: 20,
  businessClassificationMaxPromptChars: 12000,
  businessClassificationMaxOutputTokens: 512,
};
const AI_FEATURE_RUNTIME_DEFAULTS = {
  globalAiDisabled: false,
  chatEnabled: false,
  chatAudioEnabled: false,
  dashboardTranslationEnabled: false,
  insightAiEnabled: false,
  importStreamingEnabled: false,
};
const AI_PROVIDER_RUNTIME_DEFAULTS = {
  aiProvider: "openai",
};
const AI_PROVIDER_CONFIG_DEFAULTS = {
  openai: { model: "gpt-5-nano", baseUrl: "https://api.openai.com/v1", inputCostPer1M: 0.05, outputCostPer1M: 0.40 },
  gemini: { model: "gemini-2.5-flash", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", inputCostPer1M: 0, outputCostPer1M: 0 },
  ollama: { model: "llama3.2", baseUrl: "http://localhost:11434/v1", inputCostPer1M: 0, outputCostPer1M: 0 },
};
function normalizeAiProviderConfigMap(value = {}) {
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
const AI_RUNTIME_PRESETS = {
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
function loadTemplates() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const arr = JSON.parse(raw || "[]");
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
function saveTemplates(arr) {
  localStorage.setItem(LS_KEY, JSON.stringify(arr || []));
}


export default function UserManagement({ token, user, sheetId }) {
  const trunc = (s, n) => (s && s.length > n ? s.slice(0, n) + "..." : s);
  const [users, setUsers] = useState([]);
  const [newUser, setNewUser] = useState({ firstName: "", lastName: "", company: "", email: "" });
  const [passwordResetModal, setPasswordResetModal] = useState({
    open: false,
    userId: null,
    label: "",
    password: "",
    repeat: "",
  });
  const [googleOauthMeta, setGoogleOauthMeta] = useState({
    hasClientId: false,
    hasClientSecret: false,
    clientIdMasked: "",
    clientSecretMasked: "",
    redirectUri: "",
    frontendUrl: "",
  });
  const [googleOauthForm, setGoogleOauthForm] = useState({
    clientId: "",
    clientSecret: "",
    redirectUri: "",
    frontendUrl: "",
  });
  const [googleOauthSaving, setGoogleOauthSaving] = useState(false);
  const [googleOauthSaved, setGoogleOauthSaved] = useState(false);
  const [googleOauthTesting, setGoogleOauthTesting] = useState(false);
  const [dropboxOauthMeta, setDropboxOauthMeta] = useState({
    hasClientId: false,
    hasClientSecret: false,
    clientIdMasked: "",
    clientSecretMasked: "",
    redirectUri: "",
    frontendUrl: "",
  });
  const [dropboxOauthForm, setDropboxOauthForm] = useState({
    clientId: "",
    clientSecret: "",
    redirectUri: "",
    frontendUrl: "",
  });
  const [dropboxOauthSaving, setDropboxOauthSaving] = useState(false);
  const [dropboxOauthSaved, setDropboxOauthSaved] = useState(false);
  const [dropboxOauthTesting, setDropboxOauthTesting] = useState(false);
  const [oneDriveOauthMeta, setOneDriveOauthMeta] = useState({
    hasClientId: false,
    hasClientSecret: false,
    clientIdMasked: "",
    clientSecretMasked: "",
    redirectUri: "",
    frontendUrl: "",
  });
  const [oneDriveOauthForm, setOneDriveOauthForm] = useState({
    clientId: "",
    clientSecret: "",
    redirectUri: "",
    frontendUrl: "",
  });
  const [oneDriveOauthSaving, setOneDriveOauthSaving] = useState(false);
  const [oneDriveOauthSaved, setOneDriveOauthSaved] = useState(false);
  const [oneDriveOauthTesting, setOneDriveOauthTesting] = useState(false);
  const [quickbooksOauthMeta, setQuickbooksOauthMeta] = useState({
    hasClientId: false,
    hasClientSecret: false,
    clientIdMasked: "",
    clientSecretMasked: "",
    redirectUri: "",
    frontendUrl: "",
    environment: "production",
    companyId: "",
    selectedDataTypes: [],
  });
  const [quickbooksOauthForm, setQuickbooksOauthForm] = useState({
    clientId: "",
    clientSecret: "",
    redirectUri: "",
    frontendUrl: "",
    environment: "production",
    companyId: "",
    selectedDataTypes: [],
  });
  const [quickbooksOauthSaving, setQuickbooksOauthSaving] = useState(false);
  const [quickbooksOauthSaved, setQuickbooksOauthSaved] = useState(false);
  const [quickbooksOauthTesting, setQuickbooksOauthTesting] = useState(false);
  const [samlMeta, setSamlMeta] = useState({
    idpSsoUrl: "",
    idpEntityId: "",
    spEntityId: "",
    acsUrl: "",
    nameIdFormat: "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
    x509Certificate: "",
    defaultRelayState: "",
    hasX509Certificate: false,
  });
  const [samlForm, setSamlForm] = useState({
    idpSsoUrl: "",
    idpEntityId: "",
    spEntityId: "",
    acsUrl: "",
    nameIdFormat: "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
    x509Certificate: "",
    defaultRelayState: "",
  });
  const [samlSaving, setSamlSaving] = useState(false);
  const [samlSaved, setSamlSaved] = useState(false);
  const [samlTesting, setSamlTesting] = useState(false);
  const [integrationOpen, setIntegrationOpen] = useState({ google: false, dropbox: false, onedrive: false, quickbooks: false, saml: false, emailIngest: false });
  const [integrationTestStatus, setIntegrationTestStatus] = useState({ google: null, dropbox: null, onedrive: null, quickbooks: null, saml: null });
  const [smtpMeta, setSmtpMeta] = useState({
    hasPassword: false,
    passwordMasked: "",
    host: "",
    port: 587,
    secure: false,
    username: "",
    fromEmail: "",
    fromName: "",
  });
  const [smtpForm, setSmtpForm] = useState({
    host: "",
    port: 587,
    secure: false,
    username: "",
    password: "",
    fromEmail: "",
    fromName: "",
  });
  const [smtpSaving, setSmtpSaving] = useState(false);
  const [smtpSaved, setSmtpSaved] = useState(false);
  const [inviteEmailTemplate, setInviteEmailTemplate] = useState({
    subject: "",
    html: "",
    text: "",
    logoUrl: "",
  });
  const [inviteEmailSaving, setInviteEmailSaving] = useState(false);
  const [inviteEmailSaved, setInviteEmailSaved] = useState(false);
  const [inviteEmailPreviewLoading, setInviteEmailPreviewLoading] = useState(false);
  const [inviteEmailPreview, setInviteEmailPreview] = useState({ subject: "", html: "", text: "" });
  const [pendingInvitations, setPendingInvitations] = useState([]);
  const [invitationsLoading, setInvitationsLoading] = useState(false);
  const [inviteActionBusyId, setInviteActionBusyId] = useState(null);
  const [invitePolicy, setInvitePolicy] = useState({ ttlHours: 72, retentionDays: 30 });
  const [invitePolicySaving, setInvitePolicySaving] = useState(false);
  const [invitePolicySaved, setInvitePolicySaved] = useState(false);
  const [insightTranslationCache, setInsightTranslationCache] = useState({ ttlMinutes: 60 });
  const [insightTranslationCacheSaving, setInsightTranslationCacheSaving] = useState(false);
  const [insightTranslationCacheSaved, setInsightTranslationCacheSaved] = useState(false);
  const [dlpSettings, setDlpSettings] = useState({
    enabled: true,
    mode: "block",
    checkSsn: true,
    checkCreditCard: true,
    checkEmail: true,
    checkPhone: true,
    checkIban: true,
    maskDetectedColumns: false,
    configured: false,
  });
  const [dlpSettingsSaving, setDlpSettingsSaving] = useState(false);
  const [dlpSettingsSaved, setDlpSettingsSaved] = useState(false);
  const [dlpSettingsOpen, setDlpSettingsOpen] = useState(false);
  const [smtpSettingsOpen, setSmtpSettingsOpen] = useState(false);
  const [metricsExposure, setMetricsExposure] = useState({ enabled: false });
  const [metricsExposureSaving, setMetricsExposureSaving] = useState(false);
  const [autosyncInterval, setAutosyncInterval] = useState({ intervalMinutes: 5 });
  const [autosyncIntervalSaving, setAutosyncIntervalSaving] = useState(false);
  const [autosyncIntervalSaved, setAutosyncIntervalSaved] = useState(false);
  const [importPipelineSettings, setImportPipelineSettings] = useState({
    importStreamingEnabled: false,
    queuedImportStreamingV2Enabled: false,
    importStagingWriteEnabled: false,
    importStagingFinalizeEnabled: false,
  });
  const [importPipelineSaving, setImportPipelineSaving] = useState(false);
  const [importPipelineSaved, setImportPipelineSaved] = useState(false);
  const [revisionCompareSettings, setRevisionCompareSettings] = useState({ maxRows: 100000, maxAllowedRows: 100000 });
  const [revisionCompareSaving, setRevisionCompareSaving] = useState(false);
  const [revisionCompareSaved, setRevisionCompareSaved] = useState(false);
  const [aiRuntimeSettings, setAiRuntimeSettingsState] = useState({ ...AI_RUNTIME_PRESETS.mid });
  const aiRuntimeSettingsRef = useRef(aiRuntimeSettings);
  const setAiRuntimeSettings = useCallback((updater) => {
    setAiRuntimeSettingsState((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      aiRuntimeSettingsRef.current = next;
      return next;
    });
  }, []);
  const [aiRuntimeSaving, setAiRuntimeSaving] = useState(false);
  const [aiRuntimeSaved, setAiRuntimeSaved] = useState(false);
  const aiRuntimeRequestSeqRef = useRef(0);
  useEffect(() => {
    aiRuntimeSettingsRef.current = aiRuntimeSettings;
  }, [aiRuntimeSettings]);
  const [aiUsagePeriodMonth, setAiUsagePeriodMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [aiUsageSummary, setAiUsageSummary] = useState({ periodMonth: "", totals: null, groups: [] });
  const [aiUsageLoading, setAiUsageLoading] = useState(false);
  const [aiUsageError, setAiUsageError] = useState("");
  const [twoFactorTotpSettings, setTwoFactorTotpSettings] = useState({
    issuer: "",
    digits: 6,
    period: 30,
  });
  const [twoFactorTotpSaving, setTwoFactorTotpSaving] = useState(false);
  const [twoFactorTotpSaved, setTwoFactorTotpSaved] = useState(false);
  const [smsOtpSettings, setSmsOtpSettings] = useState({
    provider: "twilio",
    enabled: true,
    accountSid: "",
    authToken: "",
    hasAuthToken: false,
    fromNumber: "",
    messagingServiceSid: "",
  });
  const [smsOtpSaving, setSmsOtpSaving] = useState(false);
  const [smsOtpSaved, setSmsOtpSaved] = useState(false);
  const [twoFactorSettingsOpen, setTwoFactorSettingsOpen] = useState(false);
  const [aiSelfLearningSettings, setAiSelfLearningSettings] = useState({
    enabled: false,
    autoApplyApprovedRules: true,
    autoApproveAllCandidates: false,
    minConfidence: 0.75,
  });
  const [aiSelfLearningSaving, setAiSelfLearningSaving] = useState(false);
  const [aiSelfLearningSaved, setAiSelfLearningSaved] = useState(false);
  const [aiLearningCandidates, setAiLearningCandidates] = useState([]);
  const [aiLearningApprovedCandidates, setAiLearningApprovedCandidates] = useState([]);
  const [aiLearningFeedbackPending, setAiLearningFeedbackPending] = useState([]);
  const [aiLearningCandidatesLoading, setAiLearningCandidatesLoading] = useState(false);
  const [aiLearningReviewBusyId, setAiLearningReviewBusyId] = useState(null);
  const [aiLearningApprovedOpen, setAiLearningApprovedOpen] = useState(true);
  const [aiLearningImpact, setAiLearningImpact] = useState({ days: 30, intents: [] });
  const metricsUrl = useMemo(() => `${String(API || "").replace(/\/+$/, "")}/metrics`, []);
  const [emailIngestConfig, setEmailIngestConfig] = useState({
    enabled: true,
    provider: "google_workspace",
    inboundDomain: "",
    routeMailbox: "",
    addressPrefix: "customer",
    addressMode: "slug",
    routingMode: "catch_all",
    requireApprovedSenders: true,
    allowedSenderDomains: [],
    notes: "",
  });
  const [emailIngestSaving, setEmailIngestSaving] = useState(false);
  const [emailIngestSaved, setEmailIngestSaved] = useState(false);
  const [storageSettings, setStorageSettings] = useState(() => createInitialStorageState());

  // user-level permissions UI (select a sheet from user's groups)
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [userSheets, setUserSheets] = useState([]);                // latest 10 for selected user
  const [selectedUserSheetId, setSelectedUserSheetId] = useState(null);
  const [selectedReportSourceId, setSelectedReportSourceId] = useState(null);
  const [userSheetHeaders, setUserSheetHeaders] = useState([]);
  const [userAllowedCols, setUserAllowedCols] = useState(new Set());
  const [userRowFilters, setUserRowFilters] = useState([{ key: "", value: "" }]);
  const [userDefaultViewId, setUserDefaultViewId] = useState("");

  // groups
  const [groups, setGroups] = useState([]);
  const [newGroupName, setNewGroupName] = useState("");
  const [newCustomerFirstName, setNewCustomerFirstName] = useState("");
  const [newCustomerLastName, setNewCustomerLastName] = useState("");
  const [newCustomerCompanyName, setNewCustomerCompanyName] = useState("");
  const [newCustomerEmail, setNewCustomerEmail] = useState("");
  const [newCustomerPhone, setNewCustomerPhone] = useState("");
  const [customerFormOpen, setCustomerFormOpen] = useState(false);
  const [customerFormMode, setCustomerFormMode] = useState("create");
  const [editingCustomerId, setEditingCustomerId] = useState(null);
  const [selectedGroupId, setSelectedGroupId] = useState(() => {
    try {
      const raw = localStorage.getItem("admin:selectedGroupId");
      const parsed = Number.parseInt(String(raw || ""), 10);
      return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
    } catch {
      return null;
    }
  });
  const [groupMembers, setGroupMembers] = useState([]);
  const [groupAddUserId, setGroupAddUserId] = useState("");
  const [groupSettingsDraft, setGroupSettingsDraft] = useState(null);
  const [selectedProductBundle, setSelectedProductBundle] = useState("");
  const [groupSettingsDirty, setGroupSettingsDirty] = useState(false);
  const lastLoadedGroupIdRef = useRef(null);
  const [groupSettingsSaving, setGroupSettingsSaving] = useState(false);
  const [groupSettingsSaved, setGroupSettingsSaved] = useState(false);

  const ensureBundleFeatureSets = (bundleFeatureSets, baseFeatures) => {
    const normalizedBase = { ...(baseFeatures || {}) };
    const source = bundleFeatureSets && typeof bundleFeatureSets === "object" && !Array.isArray(bundleFeatureSets)
      ? bundleFeatureSets
      : {};
    return Object.fromEntries(
      BUNDLE_KEYS.map((key) => {
        const existing = source[key] && typeof source[key] === "object" && !Array.isArray(source[key]) ? source[key] : null;
        const defaults = BUNDLE_DEFAULT_FEATURES[key] || {};
        return [key, { ...normalizedBase, ...defaults, ...(existing || {}) }];
      })
    );
  };

  const ensureBundleCapacityLimits = (bundleCapacityLimits, fallbackLimits = {}) => {
    const source = bundleCapacityLimits && typeof bundleCapacityLimits === "object" && !Array.isArray(bundleCapacityLimits)
      ? bundleCapacityLimits
      : {};
    return Object.fromEntries(
      BUNDLE_KEYS.map((key) => {
        const existing = source[key] && typeof source[key] === "object" && !Array.isArray(source[key]) ? source[key] : {};
        const defaults = BUNDLE_DEFAULT_CAPACITY_LIMITS[key] || {};
        return [key, {
          maxUsers: existing.maxUsers ?? fallbackLimits.maxUsers ?? defaults.maxUsers ?? "",
          maxReportSources: existing.maxReportSources ?? fallbackLimits.maxReportSources ?? defaults.maxReportSources ?? "",
        }];
      })
    );
  };

  // customer permissions (per-sheet)
  const [groupAllowedCols, setGroupAllowedCols] = useState(new Set());
  const [groupRowFilters, setGroupRowFilters] = useState([{ key: "", value: "" }]);

  // report source selection drives the current sheet used by existing permission enforcement
  const [reportSources, setReportSources] = useState([]);
  const [reviewPolicySavingId, setReviewPolicySavingId] = useState("");
  const [reportSourceDeletingId, setReportSourceDeletingId] = useState("");
  const [reviewRulesOpen, setReviewRulesOpen] = useState(false);
  const [expandedReviewSourceId, setExpandedReviewSourceId] = useState("");
  const [reportSourceDeletionOpen, setReportSourceDeletionOpen] = useState(false);
  const [reviewRuleDraftLabelBySource, setReviewRuleDraftLabelBySource] = useState({});
  const [groupSheetHeaders, setGroupSheetHeaders] = useState([]);

  // Templates (now scoped by group)
  const [templates, setTemplates] = useState(loadTemplates());

  // ... rest of state
  const [newTplNameUser, setNewTplNameUser] = useState("");
  const [newTplNameGroup, setNewTplNameGroup] = useState("");
  const [selectedTplUser, setSelectedTplUser] = useState("");
  const [selectedTplGroup, setSelectedTplGroup] = useState("");

  // Views
  const [views, setViews] = useState([]);
  const [userViews, setUserViews] = useState(new Set());
  const [draftUserViewIds, setDraftUserViewIds] = useState([]);
  const [viewAssignmentOpen, setViewAssignmentOpen] = useState(false);
  const [viewAssignmentSaving, setViewAssignmentSaving] = useState(false);
  const [viewAssignmentSaved, setViewAssignmentSaved] = useState(false);
  const [selectedUserGroupIds, setSelectedUserGroupIds] = useState(new Set());
  const [userGroupMap, setUserGroupMap] = useState({});
  const [editingUserId, setEditingUserId] = useState(null);
  const [editingUserForm, setEditingUserForm] = useState({ firstName: "", lastName: "", company: "", email: "" });

  const userById = useMemo(() => {
    const m = new Map();
    (users || []).forEach((u) => {
        if (u && u.id) m.set(u.id, u);
    });
    return m;
  }, [users]);

  const uniqueGroupMembers = useMemo(() => {
    const m = new Map();
    (groupMembers || []).forEach((mem) => {
        if (mem && mem.id) m.set(mem.id, mem);
    });
    return Array.from(m.values());
  }, [groupMembers]);

  const uniqueUsers = useMemo(() => {
    const m = new Map();
    (users || []).forEach((u) => {
        if (u && u.id) m.set(u.id, u);
    });
    return Array.from(m.values());
  }, [users]);

  const roleLower = String(user?.role || "").toLowerCase();
  const isSuperAdmin = (
    roleLower === "admin"
    || roleLower === "super_admin"
    || roleLower === "superadmin"
    || !!user?.is_admin
    || !!user?.super_admin
  );
  const isCustomerAdmin = !!(user?.is_group_admin || user?.group_admin || user?.is_admin);
  const canManageIntegrations = isSuperAdmin || isCustomerAdmin;
  const googleConfigured = googleOauthMeta.hasClientId && googleOauthMeta.hasClientSecret && googleOauthMeta.redirectUri;
  const dropboxConfigured = dropboxOauthMeta.hasClientId && dropboxOauthMeta.hasClientSecret && dropboxOauthMeta.redirectUri;
  const oneDriveConfigured = oneDriveOauthMeta.hasClientId && oneDriveOauthMeta.hasClientSecret && oneDriveOauthMeta.redirectUri;
  const quickbooksConfigured = quickbooksOauthMeta.hasClientId
    && quickbooksOauthMeta.hasClientSecret
    && quickbooksOauthMeta.redirectUri
    && quickbooksOauthMeta.companyId;
  const samlConfigured = !!(
    samlMeta.idpSsoUrl
    && samlMeta.idpEntityId
    && samlMeta.spEntityId
    && samlMeta.acsUrl
  );

  const integrationScopeParams = useMemo(() => {
    const gid = Number(selectedGroupId);
    if (Number.isInteger(gid) && gid > 0) return { groupId: gid };
    return {};
  }, [selectedGroupId]);
  const emailIngestScopeParams = useMemo(() => {
    const gid = Number(selectedGroupId);
    if (Number.isInteger(gid) && gid > 0) return { groupId: gid };
    if (!isSuperAdmin && Array.isArray(groups) && groups.length === 1) return { groupId: Number(groups[0].id) };
    return {};
  }, [selectedGroupId, groups, isSuperAdmin]);
  const storageScopeParams = useMemo(() => {
    const gid = Number(selectedGroupId);
    if (Number.isInteger(gid) && gid > 0) return { groupId: gid };
    if (!isSuperAdmin && Array.isArray(groups) && groups.length === 1) return { groupId: Number(groups[0].id) };
    return {};
  }, [selectedGroupId, groups, isSuperAdmin]);

  const updateStorageProvider = (providerKey, updater) => {
    setStorageSettings((prev) => {
      const providerDef = STORAGE_PROVIDER_DEFS.find((def) => def.key === providerKey);
      const current = prev[providerKey] || (providerDef ? createStorageProviderState(providerDef) : { form: {}, meta: {}, open: false, saving: false, testing: false, testStatus: null });
      const nextValue = typeof updater === "function" ? updater(current) : { ...current, ...updater };
      return { ...prev, [providerKey]: nextValue };
    });
  };
  const coerceBoolean = (value) => {
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["false", "0", "no", "off", ""].includes(normalized)) return false;
      if (["true", "1", "yes", "on"].includes(normalized)) return true;
    }
    return !!value;
  };

  const fetchStorageSetting = async (provider) => {
    if (!canManageIntegrations) return;
    if (!storageScopeParams.groupId) {
      updateStorageProvider(provider.key, (current) => ({
        ...createStorageProviderState(provider),
        open: !!current?.open,
      }));
      return;
    }
    try {
      const res = await axios.get(`${API}/admin/settings/${provider.apiBase}`, {
        headers: { Authorization: `Bearer ${token}` },
        params: storageScopeParams,
      });
      const data = res?.data || {};
      updateStorageProvider(provider.key, (current) => {
        const next = { ...current };
        next.meta = {
          ...current.meta,
          ...(provider.fields || []).reduce((acc, field) => {
            if (field.secret) acc[field.metaKey] = !!data[field.metaKey];
            return acc;
          }, {}),
        };
        next.form = {
          ...current.form,
          ...provider.fields.reduce((acc, field) => {
            if (field.secret) {
              acc[field.name] = "";
              return acc;
            }
            if (field.type === "checkbox") {
              acc[field.name] = coerceBoolean(data[field.name]);
              return acc;
            }
            if (field.type === "number") {
              acc[field.name] = data[field.name] ?? field.defaultValue ?? "";
              return acc;
            }
            acc[field.name] = data[field.name] ?? field.defaultValue ?? "";
            return acc;
          }, {}),
        };
        next.testStatus = null;
        return next;
      });
    } catch (e) {
      console.error(`fetchStorageSetting(${provider.key}) failed`, e);
    }
  };

  const saveStorageSetting = async (provider) => {
    if (!canManageIntegrations) return;
    const current = storageSettings[provider.key];
    if (!current || current.saving) return;
    if (!storageScopeParams.groupId) {
      alert("Select a customer first.");
      return;
    }
    updateStorageProvider(provider.key, { saving: true, saved: false });
    try {
      const payload = { ...storageScopeParams, enabled: !!current.form.enabled };
      for (const field of provider.fields) {
        if (field.name === "enabled") continue;
        if (field.secret) {
          const hasExisting = !!current.meta?.[field.metaKey];
          const value = current.form[field.name] || (hasExisting ? "***" : "");
          payload[field.name] = value;
          continue;
        }
        payload[field.name] = current.form[field.name];
      }
      const res = await axios.patch(`${API}/admin/settings/${provider.apiBase}`, payload, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = res?.data || {};
      updateStorageProvider(provider.key, (prev) => ({
        ...prev,
        meta: {
          ...prev.meta,
          ...(provider.fields || []).reduce((acc, field) => {
            if (field.secret) acc[field.metaKey] = !!data[field.metaKey];
            return acc;
          }, {}),
        },
        form: {
          ...prev.form,
          ...provider.fields.reduce((acc, field) => {
            if (field.secret) {
              acc[field.name] = "";
              return acc;
            }
            acc[field.name] = data[field.name] ?? prev.form[field.name];
            return acc;
          }, {}),
        },
        testStatus: null,
      }));
      updateStorageProvider(provider.key, { saved: true });
      setTimeout(() => updateStorageProvider(provider.key, { saved: false }), 1800);
    } catch (e) {
      alert(e.response?.data?.error || `Failed to update ${provider.title} settings`);
    } finally {
      updateStorageProvider(provider.key, { saving: false });
    }
  };

  const testStorageSetting = async (provider) => {
    if (!canManageIntegrations) return;
    const current = storageSettings[provider.key];
    if (!current || current.testing) return;
    if (!storageScopeParams.groupId) {
      alert("Select a customer first.");
      return;
    }
    updateStorageProvider(provider.key, { testing: true });
    try {
      const res = await axios.post(`${API}/admin/settings/${provider.apiBase}/test`, { ...storageScopeParams }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      updateStorageProvider(provider.key, { testStatus: "success" });
      alert(res?.data?.message === "storage_probe_success" ? `${provider.title} connection validated.` : `${provider.title} probe completed.`);
    } catch (e) {
      updateStorageProvider(provider.key, { testStatus: "error" });
      alert(e.response?.data?.error || `${provider.title} connection test failed`);
    } finally {
      updateStorageProvider(provider.key, { testing: false });
    }
  };

  const fetchReportSources = async () => {
    try {
      const res = await axios.get(`${API}/report-sources`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setReportSources(Array.isArray(res.data) ? res.data : []);
    } catch (e) {
      console.error("fetchReportSources failed", e);
    }
  };

  const saveReviewPolicy = async (source, patch = {}) => {
    if (!canManageIntegrations || !source?.id || reviewPolicySavingId) return;
    const currentRules = normalizeReviewLabelRules(source.review_label_rules);
    const nextPolicy = {
      review_required: patch.review_required !== undefined ? !!patch.review_required : !!source.review_required,
      review_schema_changes: patch.review_schema_changes !== undefined ? !!patch.review_schema_changes : source.review_schema_changes !== false,
      review_label_rules: patch.review_label_rules !== undefined ? normalizeReviewLabelRules(patch.review_label_rules) : currentRules,
    };
    const sourceId = String(source.id);
    setReviewPolicySavingId(sourceId);
    setReportSources((prev) => (prev || []).map((item) => (
      String(item.id) === sourceId ? { ...item, ...nextPolicy } : item
    )));
    try {
      const res = await axios.patch(`${API}/report-sources/${source.id}/review-policy`, nextPolicy, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const updated = res.data || {};
      setReportSources((prev) => (prev || []).map((item) => (
        String(item.id) === sourceId ? { ...item, ...nextPolicy, ...updated } : item
      )));
    } catch (e) {
      alert(e.response?.data?.error || "Failed to save review rules");
      fetchReportSources();
    } finally {
      setReviewPolicySavingId("");
    }
  };

  const deleteReportSource = async (source) => {
    if (!canManageIntegrations || !source?.id || reportSourceDeletingId) return;
    const sourceId = String(source.id);
    const sourceName = String(source?.name || `Source ${sourceId}`);
    const confirmed = window.confirm(
      `Delete report source "${sourceName}"?\n\nThis will remove the source and its linked revisions.`
    );
    if (!confirmed) return;
    setReportSourceDeletingId(sourceId);
    try {
      await axios.delete(`${API}/report-sources/${source.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setReportSources((prev) => (prev || []).filter((item) => String(item.id) !== sourceId));
      if (String(selectedReportSourceId || "") === sourceId) {
        setSelectedReportSourceId(null);
      }
    } catch (e) {
      if (e?.response?.status === 404) {
        await fetchReportSources();
        alert("Report source already removed. Refreshed list.");
      } else {
        alert(e.response?.data?.error || "Failed to delete report source");
        fetchReportSources();
      }
    } finally {
      setReportSourceDeletingId("");
    }
  };

  // fetch users
  const fetchUsers = async () => {
    try {
      const res = await axios.get(`${API}/users`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setUsers(res.data || []);
    } catch (e) {
      console.error("fetchUsers failed", e);
    }
  };

  const fetchGroups = async () => {
    try {
      const res = await axios.get(`${API}/groups`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setGroups(res.data || []);
    } catch (e) {
      console.error("fetchGroups failed", e);
    }
  };

  const fetchGoogleOauthSetting = async () => {
    if (!canManageIntegrations) return;
    if (!isSuperAdmin && !selectedGroupId) return;
    try {
      const res = await axios.get(`${API}/admin/settings/google-oauth`, {
        headers: { Authorization: `Bearer ${token}` },
        params: integrationScopeParams,
      });
      const data = res?.data || {};
      setGoogleOauthMeta({
        hasClientId: !!data.hasClientId,
        hasClientSecret: !!data.hasClientSecret,
        clientIdMasked: data.clientIdMasked || "",
        clientSecretMasked: data.clientSecretMasked || "",
        redirectUri: data.redirectUri || "",
        frontendUrl: data.frontendUrl || "",
      });
      setGoogleOauthForm((prev) => ({
        ...prev,
        clientId: "",
        clientSecret: "",
        redirectUri: data.redirectUri || "",
        frontendUrl: data.frontendUrl || "",
      }));
      setIntegrationTestStatus((prev) => ({ ...prev, google: null }));
    } catch (e) {
      console.error("fetchGoogleOauthSetting failed", e);
    }
  };

  const testGoogleOauthSetting = async () => {
    if (!canManageIntegrations || googleOauthTesting) return;
    if (!isSuperAdmin && !selectedGroupId) {
      alert("Select a customer first.");
      return;
    }
    setGoogleOauthTesting(true);
    try {
      const res = await axios.post(`${API}/admin/settings/google-oauth/test`, { ...integrationScopeParams }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setIntegrationTestStatus((prev) => ({ ...prev, google: "success" }));
      alert(res?.data?.message === "oauth_credentials_valid_code_rejected"
        ? "Google OAuth credentials validated."
        : "Google OAuth probe completed.");
    } catch (e) {
      setIntegrationTestStatus((prev) => ({ ...prev, google: "error" }));
      alert(e.response?.data?.error || "Google OAuth test failed");
    } finally {
      setGoogleOauthTesting(false);
    }
  };

  const saveGoogleOauthSetting = async () => {
    if (!canManageIntegrations || googleOauthSaving) return;
    if (!isSuperAdmin && !selectedGroupId) {
      alert("Select a customer first.");
      return;
    }
    setGoogleOauthSaving(true);
    setGoogleOauthSaved(false);
    try {
      const payload = {
        clientId: googleOauthForm.clientId || "***",
        clientSecret: googleOauthForm.clientSecret || "***",
        redirectUri: googleOauthForm.redirectUri || "",
        frontendUrl: googleOauthForm.frontendUrl || "",
        ...integrationScopeParams,
      };
      const res = await axios.patch(`${API}/admin/settings/google-oauth`, payload, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = res?.data || {};
      setGoogleOauthMeta({
        hasClientId: !!data.hasClientId,
        hasClientSecret: !!data.hasClientSecret,
        clientIdMasked: data.clientIdMasked || "",
        clientSecretMasked: data.clientSecretMasked || "",
        redirectUri: data.redirectUri || "",
        frontendUrl: data.frontendUrl || "",
      });
      setGoogleOauthForm((prev) => ({
        ...prev,
        clientId: "",
        clientSecret: "",
      }));
      setIntegrationTestStatus((prev) => ({ ...prev, google: null }));
      setGoogleOauthSaved(true);
      setTimeout(() => setGoogleOauthSaved(false), 1800);
    } catch (e) {
      alert(e.response?.data?.error || "Failed to update Google OAuth settings");
    } finally {
      setGoogleOauthSaving(false);
    }
  };

  const fetchDropboxOauthSetting = async () => {
    if (!canManageIntegrations) return;
    if (!isSuperAdmin && !selectedGroupId) return;
    try {
      const res = await axios.get(`${API}/admin/settings/dropbox-oauth`, {
        headers: { Authorization: `Bearer ${token}` },
        params: integrationScopeParams,
      });
      const data = res?.data || {};
      setDropboxOauthMeta({
        hasClientId: !!data.hasClientId,
        hasClientSecret: !!data.hasClientSecret,
        clientIdMasked: data.clientIdMasked || "",
        clientSecretMasked: data.clientSecretMasked || "",
        redirectUri: data.redirectUri || "",
        frontendUrl: data.frontendUrl || "",
      });
      setDropboxOauthForm((prev) => ({
        ...prev,
        clientId: "",
        clientSecret: "",
        redirectUri: data.redirectUri || "",
        frontendUrl: data.frontendUrl || "",
      }));
      setIntegrationTestStatus((prev) => ({ ...prev, dropbox: null }));
    } catch (e) {
      console.error("fetchDropboxOauthSetting failed", e);
    }
  };

  const testDropboxOauthSetting = async () => {
    if (!canManageIntegrations || dropboxOauthTesting) return;
    if (!isSuperAdmin && !selectedGroupId) {
      alert("Select a customer first.");
      return;
    }
    setDropboxOauthTesting(true);
    try {
      const res = await axios.post(`${API}/admin/settings/dropbox-oauth/test`, { ...integrationScopeParams }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setIntegrationTestStatus((prev) => ({ ...prev, dropbox: "success" }));
      alert(res?.data?.message === "oauth_credentials_valid_code_rejected"
        ? "Dropbox OAuth credentials validated."
        : "Dropbox OAuth probe completed.");
    } catch (e) {
      setIntegrationTestStatus((prev) => ({ ...prev, dropbox: "error" }));
      alert(e.response?.data?.error || "Dropbox OAuth test failed");
    } finally {
      setDropboxOauthTesting(false);
    }
  };

  const saveDropboxOauthSetting = async () => {
    if (!canManageIntegrations || dropboxOauthSaving) return;
    if (!isSuperAdmin && !selectedGroupId) {
      alert("Select a customer first.");
      return;
    }
    setDropboxOauthSaving(true);
    setDropboxOauthSaved(false);
    try {
      const payload = {
        clientId: dropboxOauthForm.clientId || "***",
        clientSecret: dropboxOauthForm.clientSecret || "***",
        redirectUri: dropboxOauthForm.redirectUri || "",
        frontendUrl: dropboxOauthForm.frontendUrl || "",
        ...integrationScopeParams,
      };
      const res = await axios.patch(`${API}/admin/settings/dropbox-oauth`, payload, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = res?.data || {};
      setDropboxOauthMeta({
        hasClientId: !!data.hasClientId,
        hasClientSecret: !!data.hasClientSecret,
        clientIdMasked: data.clientIdMasked || "",
        clientSecretMasked: data.clientSecretMasked || "",
        redirectUri: data.redirectUri || "",
        frontendUrl: data.frontendUrl || "",
      });
      setDropboxOauthForm((prev) => ({
        ...prev,
        clientId: "",
        clientSecret: "",
      }));
      setIntegrationTestStatus((prev) => ({ ...prev, dropbox: null }));
      setDropboxOauthSaved(true);
      setTimeout(() => setDropboxOauthSaved(false), 1800);
    } catch (e) {
      alert(e.response?.data?.error || "Failed to update Dropbox OAuth settings");
    } finally {
      setDropboxOauthSaving(false);
    }
  };

  const fetchOneDriveOauthSetting = async () => {
    if (!canManageIntegrations) return;
    if (!isSuperAdmin && !selectedGroupId) return;
    try {
      const res = await axios.get(`${API}/admin/settings/onedrive-oauth`, {
        headers: { Authorization: `Bearer ${token}` },
        params: integrationScopeParams,
      });
      const data = res?.data || {};
      setOneDriveOauthMeta({
        hasClientId: !!data.hasClientId,
        hasClientSecret: !!data.hasClientSecret,
        clientIdMasked: data.clientIdMasked || "",
        clientSecretMasked: data.clientSecretMasked || "",
        redirectUri: data.redirectUri || "",
        frontendUrl: data.frontendUrl || "",
      });
      setOneDriveOauthForm((prev) => ({
        ...prev,
        clientId: "",
        clientSecret: "",
        redirectUri: data.redirectUri || "",
        frontendUrl: data.frontendUrl || "",
      }));
      setIntegrationTestStatus((prev) => ({ ...prev, onedrive: null }));
    } catch (e) {
      console.error("fetchOneDriveOauthSetting failed", e);
    }
  };

  const testOneDriveOauthSetting = async () => {
    if (!canManageIntegrations || oneDriveOauthTesting) return;
    if (!isSuperAdmin && !selectedGroupId) {
      alert("Select a customer first.");
      return;
    }
    setOneDriveOauthTesting(true);
    try {
      const res = await axios.post(`${API}/admin/settings/onedrive-oauth/test`, { ...integrationScopeParams }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setIntegrationTestStatus((prev) => ({ ...prev, onedrive: "success" }));
      alert(res?.data?.message === "oauth_credentials_valid_code_rejected"
        ? "OneDrive OAuth credentials validated."
        : "OneDrive OAuth probe completed.");
    } catch (e) {
      setIntegrationTestStatus((prev) => ({ ...prev, onedrive: "error" }));
      alert(e.response?.data?.error || "OneDrive OAuth test failed");
    } finally {
      setOneDriveOauthTesting(false);
    }
  };

  const saveOneDriveOauthSetting = async () => {
    if (!canManageIntegrations || oneDriveOauthSaving) return;
    if (!isSuperAdmin && !selectedGroupId) {
      alert("Select a customer first.");
      return;
    }
    setOneDriveOauthSaving(true);
    setOneDriveOauthSaved(false);
    try {
      const payload = {
        clientId: oneDriveOauthForm.clientId || "***",
        clientSecret: oneDriveOauthForm.clientSecret || "***",
        redirectUri: oneDriveOauthForm.redirectUri || "",
        frontendUrl: oneDriveOauthForm.frontendUrl || "",
        ...integrationScopeParams,
      };
      const res = await axios.patch(`${API}/admin/settings/onedrive-oauth`, payload, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = res?.data || {};
      setOneDriveOauthMeta({
        hasClientId: !!data.hasClientId,
        hasClientSecret: !!data.hasClientSecret,
        clientIdMasked: data.clientIdMasked || "",
        clientSecretMasked: data.clientSecretMasked || "",
        redirectUri: data.redirectUri || "",
        frontendUrl: data.frontendUrl || "",
      });
      setOneDriveOauthForm((prev) => ({
        ...prev,
        clientId: "",
        clientSecret: "",
      }));
      setIntegrationTestStatus((prev) => ({ ...prev, onedrive: null }));
      setOneDriveOauthSaved(true);
      setTimeout(() => setOneDriveOauthSaved(false), 1800);
    } catch (e) {
      alert(e.response?.data?.error || "Failed to update OneDrive OAuth settings");
    } finally {
      setOneDriveOauthSaving(false);
    }
  };

  const fetchQuickbooksOauthSetting = async () => {
    if (!canManageIntegrations) return;
    if (!isSuperAdmin && !selectedGroupId) return;
    try {
      const res = await axios.get(`${API}/admin/settings/quickbooks-oauth`, {
        headers: { Authorization: `Bearer ${token}` },
        params: integrationScopeParams,
      });
      const data = res?.data || {};
      const selectedDataTypes = Array.isArray(data.selectedDataTypes) ? data.selectedDataTypes : [];
      setQuickbooksOauthMeta({
        hasClientId: !!data.hasClientId,
        hasClientSecret: !!data.hasClientSecret,
        clientIdMasked: data.clientIdMasked || "",
        clientSecretMasked: data.clientSecretMasked || "",
        redirectUri: data.redirectUri || "",
        frontendUrl: data.frontendUrl || "",
        environment: data.environment === "sandbox" ? "sandbox" : "production",
        companyId: data.companyId || "",
        selectedDataTypes,
      });
      setQuickbooksOauthForm((prev) => ({
        ...prev,
        clientId: "",
        clientSecret: "",
        redirectUri: data.redirectUri || "",
        frontendUrl: data.frontendUrl || "",
        environment: data.environment === "sandbox" ? "sandbox" : "production",
        companyId: data.companyId || "",
        selectedDataTypes,
      }));
      setIntegrationTestStatus((prev) => ({ ...prev, quickbooks: null }));
    } catch (e) {
      console.error("fetchQuickbooksOauthSetting failed", e);
    }
  };

  const testQuickbooksOauthSetting = async () => {
    if (!canManageIntegrations || quickbooksOauthTesting) return;
    if (!isSuperAdmin && !selectedGroupId) {
      alert("Select a customer first.");
      return;
    }
    setQuickbooksOauthTesting(true);
    try {
      const res = await axios.post(`${API}/admin/settings/quickbooks-oauth/test`, { ...integrationScopeParams }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setIntegrationTestStatus((prev) => ({ ...prev, quickbooks: "success" }));
      alert(res?.data?.message === "oauth_credentials_valid_code_rejected"
        ? "QuickBooks OAuth credentials validated."
        : "QuickBooks OAuth probe completed.");
    } catch (e) {
      setIntegrationTestStatus((prev) => ({ ...prev, quickbooks: "error" }));
      alert(e.response?.data?.error || "QuickBooks OAuth test failed");
    } finally {
      setQuickbooksOauthTesting(false);
    }
  };

  const saveQuickbooksOauthSetting = async () => {
    if (!canManageIntegrations || quickbooksOauthSaving) return;
    if (!isSuperAdmin && !selectedGroupId) {
      alert("Select a customer first.");
      return;
    }
    setQuickbooksOauthSaving(true);
    setQuickbooksOauthSaved(false);
    try {
      const payload = {
        clientId: quickbooksOauthForm.clientId || "***",
        clientSecret: quickbooksOauthForm.clientSecret || "***",
        redirectUri: quickbooksOauthForm.redirectUri || "",
        frontendUrl: quickbooksOauthForm.frontendUrl || "",
        environment: quickbooksOauthForm.environment === "sandbox" ? "sandbox" : "production",
        companyId: quickbooksOauthForm.companyId || "",
        selectedDataTypes: Array.isArray(quickbooksOauthForm.selectedDataTypes) ? quickbooksOauthForm.selectedDataTypes : [],
        ...integrationScopeParams,
      };
      const res = await axios.patch(`${API}/admin/settings/quickbooks-oauth`, payload, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = res?.data || {};
      const selectedDataTypes = Array.isArray(data.selectedDataTypes) ? data.selectedDataTypes : [];
      setQuickbooksOauthMeta({
        hasClientId: !!data.hasClientId,
        hasClientSecret: !!data.hasClientSecret,
        clientIdMasked: data.clientIdMasked || "",
        clientSecretMasked: data.clientSecretMasked || "",
        redirectUri: data.redirectUri || "",
        frontendUrl: data.frontendUrl || "",
        environment: data.environment === "sandbox" ? "sandbox" : "production",
        companyId: data.companyId || "",
        selectedDataTypes,
      });
      setQuickbooksOauthForm((prev) => ({
        ...prev,
        clientId: "",
        clientSecret: "",
        environment: data.environment === "sandbox" ? "sandbox" : "production",
        companyId: data.companyId || "",
        selectedDataTypes,
      }));
      setIntegrationTestStatus((prev) => ({ ...prev, quickbooks: null }));
      setQuickbooksOauthSaved(true);
      setTimeout(() => setQuickbooksOauthSaved(false), 1800);
    } catch (e) {
      alert(e.response?.data?.error || "Failed to update QuickBooks OAuth settings");
    } finally {
      setQuickbooksOauthSaving(false);
    }
  };

  const fetchSamlSetting = async () => {
    if (!canManageIntegrations) return;
    if (!isSuperAdmin && !selectedGroupId) return;
    try {
      const res = await axios.get(`${API}/admin/settings/saml-sso`, {
        headers: { Authorization: `Bearer ${token}` },
        params: integrationScopeParams,
      });
      const data = res?.data || {};
      setSamlMeta({
        idpSsoUrl: data.idpSsoUrl || "",
        idpEntityId: data.idpEntityId || "",
        spEntityId: data.spEntityId || "",
        acsUrl: data.acsUrl || "",
        nameIdFormat: data.nameIdFormat || "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
        x509Certificate: data.x509Certificate || "",
        defaultRelayState: data.defaultRelayState || "",
        hasX509Certificate: !!data.hasX509Certificate,
      });
      setSamlForm({
        idpSsoUrl: data.idpSsoUrl || "",
        idpEntityId: data.idpEntityId || "",
        spEntityId: data.spEntityId || "",
        acsUrl: data.acsUrl || "",
        nameIdFormat: data.nameIdFormat || "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
        x509Certificate: data.x509Certificate || "",
        defaultRelayState: data.defaultRelayState || "",
      });
      setIntegrationTestStatus((prev) => ({ ...prev, saml: null }));
    } catch (e) {
      console.error("fetchSamlSetting failed", e);
    }
  };

  const saveSamlSetting = async () => {
    if (!canManageIntegrations || samlSaving) return;
    if (!isSuperAdmin && !selectedGroupId) {
      alert("Select a customer first.");
      return;
    }
    setSamlSaving(true);
    setSamlSaved(false);
    try {
      const payload = {
        idpSsoUrl: samlForm.idpSsoUrl || "",
        idpEntityId: samlForm.idpEntityId || "",
        spEntityId: samlForm.spEntityId || "",
        acsUrl: samlForm.acsUrl || "",
        nameIdFormat: samlForm.nameIdFormat || "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
        x509Certificate: samlForm.x509Certificate || "",
        defaultRelayState: samlForm.defaultRelayState || "",
        ...integrationScopeParams,
      };
      const res = await axios.patch(`${API}/admin/settings/saml-sso`, payload, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = res?.data || {};
      setSamlMeta({
        idpSsoUrl: data.idpSsoUrl || "",
        idpEntityId: data.idpEntityId || "",
        spEntityId: data.spEntityId || "",
        acsUrl: data.acsUrl || "",
        nameIdFormat: data.nameIdFormat || "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
        x509Certificate: data.x509Certificate || "",
        defaultRelayState: data.defaultRelayState || "",
        hasX509Certificate: !!data.hasX509Certificate,
      });
      setIntegrationTestStatus((prev) => ({ ...prev, saml: null }));
      setSamlSaved(true);
      setTimeout(() => setSamlSaved(false), 1800);
    } catch (e) {
      alert(e.response?.data?.error || "Failed to update SAML settings");
    } finally {
      setSamlSaving(false);
    }
  };

  const testSamlSetting = async () => {
    if (!canManageIntegrations || samlTesting) return;
    if (!isSuperAdmin && !selectedGroupId) {
      alert("Select a customer first.");
      return;
    }
    setSamlTesting(true);
    try {
      const res = await axios.post(`${API}/admin/settings/saml-sso/test`, { ...integrationScopeParams }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setIntegrationTestStatus((prev) => ({ ...prev, saml: "success" }));
      alert(res?.data?.message === "saml_configuration_valid"
        ? "SAML configuration validated."
        : "SAML probe completed.");
    } catch (e) {
      setIntegrationTestStatus((prev) => ({ ...prev, saml: "error" }));
      alert(e.response?.data?.error || "SAML test failed");
    } finally {
      setSamlTesting(false);
    }
  };

  const fetchSmtpSetting = async () => {
    if (!isSuperAdmin) return;
    try {
      const res = await axios.get(`${API}/admin/settings/smtp`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = res?.data || {};
      setSmtpMeta({
        hasPassword: !!data.hasPassword,
        passwordMasked: data.passwordMasked || "",
        host: data.host || "",
        port: Number(data.port || 587),
        secure: !!data.secure,
        username: data.username || "",
        fromEmail: data.fromEmail || "",
        fromName: data.fromName || "",
      });
      setSmtpForm((prev) => ({
        ...prev,
        host: data.host || "",
        port: Number(data.port || 587),
        secure: !!data.secure,
        username: data.username || "",
        password: "",
        fromEmail: data.fromEmail || "",
        fromName: data.fromName || "",
      }));
    } catch (e) {
      console.error("fetchSmtpSetting failed", e);
    }
  };

  const saveSmtpSetting = async () => {
    if (!isSuperAdmin || smtpSaving) return;
    setSmtpSaving(true);
    setSmtpSaved(false);
    try {
      const payload = {
        host: smtpForm.host || "",
        port: Number.parseInt(smtpForm.port, 10) || 587,
        secure: !!smtpForm.secure,
        username: smtpForm.username || "",
        password: smtpForm.password || "***",
        fromEmail: smtpForm.fromEmail || "",
        fromName: smtpForm.fromName || "",
      };
      const res = await axios.patch(`${API}/admin/settings/smtp`, payload, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = res?.data || {};
      setSmtpMeta({
        hasPassword: !!data.hasPassword,
        passwordMasked: data.passwordMasked || "",
        host: data.host || "",
        port: Number(data.port || 587),
        secure: !!data.secure,
        username: data.username || "",
        fromEmail: data.fromEmail || "",
        fromName: data.fromName || "",
      });
      setSmtpForm((prev) => ({ ...prev, password: "" }));
      setSmtpSaved(true);
      setTimeout(() => setSmtpSaved(false), 1800);
    } catch (e) {
      alert(e.response?.data?.error || "Failed to update SMTP settings");
    } finally {
      setSmtpSaving(false);
    }
  };

  const fetchInviteEmailTemplate = async () => {
    if (!isSuperAdmin) return;
    try {
      const res = await axios.get(`${API}/admin/settings/invite-email-template`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = res?.data || {};
      setInviteEmailTemplate({
        subject: data.subject || "",
        html: data.html || "",
        text: data.text || "",
        logoUrl: data.logoUrl || "",
      });
    } catch (e) {
      console.error("fetchInviteEmailTemplate failed", e);
    }
  };

  const saveInviteEmailTemplate = async () => {
    if (!isSuperAdmin || inviteEmailSaving) return;
    setInviteEmailSaving(true);
    setInviteEmailSaved(false);
    try {
      const payload = {
        subject: inviteEmailTemplate.subject || "",
        html: inviteEmailTemplate.html || "",
        text: inviteEmailTemplate.text || "",
        logoUrl: inviteEmailTemplate.logoUrl || "",
      };
      const res = await axios.patch(`${API}/admin/settings/invite-email-template`, payload, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = res?.data || payload;
      setInviteEmailTemplate({
        subject: data.subject || "",
        html: data.html || "",
        text: data.text || "",
        logoUrl: data.logoUrl || "",
      });
      setInviteEmailSaved(true);
      setTimeout(() => setInviteEmailSaved(false), 1800);
    } catch (e) {
      alert(e.response?.data?.error || "Failed to save invite email template");
    } finally {
      setInviteEmailSaving(false);
    }
  };

  const previewInviteEmail = async () => {
    if (!isSuperAdmin || inviteEmailPreviewLoading) return;
    setInviteEmailPreviewLoading(true);
    try {
      const payload = {
        subject: inviteEmailTemplate.subject || "",
        html: inviteEmailTemplate.html || "",
        text: inviteEmailTemplate.text || "",
        logoUrl: inviteEmailTemplate.logoUrl || "",
      };
      const res = await axios.post(`${API}/admin/settings/invite-email-template/preview`, payload, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = res?.data || {};
      setInviteEmailPreview({
        subject: data.subject || "",
        html: data.html || "",
        text: data.text || "",
      });
    } catch (e) {
      alert(e.response?.data?.error || "Failed to preview invite email template");
    } finally {
      setInviteEmailPreviewLoading(false);
    }
  };

  const fetchInvitationPolicy = async () => {
    if (!isSuperAdmin) return;
    try {
      const res = await axios.get(`${API}/admin/settings/customer-invitations`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setInvitePolicy({
        ttlHours: Number(res?.data?.ttlHours || 72),
        retentionDays: Number(res?.data?.retentionDays || 30),
      });
    } catch (e) {
      console.error("fetchInvitationPolicy failed", e);
    }
  };

  const saveInvitationPolicy = async () => {
    if (!isSuperAdmin || invitePolicySaving) return;
    setInvitePolicySaving(true);
    setInvitePolicySaved(false);
    try {
      const payload = {
        ttlHours: Number.parseInt(String(invitePolicy.ttlHours || "").trim(), 10) || 72,
        retentionDays: Number.parseInt(String(invitePolicy.retentionDays || "").trim(), 10) || 30,
      };
      const res = await axios.patch(`${API}/admin/settings/customer-invitations`, payload, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setInvitePolicy({
        ttlHours: Number(res?.data?.ttlHours || payload.ttlHours),
        retentionDays: Number(res?.data?.retentionDays || payload.retentionDays),
      });
      setInvitePolicySaved(true);
      setTimeout(() => setInvitePolicySaved(false), 1800);
    } catch (e) {
      alert(e.response?.data?.error || "Failed to save invitation policy");
    } finally {
      setInvitePolicySaving(false);
    }
  };

  const fetchInsightTranslationCacheSetting = async () => {
    if (!isSuperAdmin) return;
    try {
      const res = await axios.get(`${API}/admin/settings/insight-translation-cache`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setInsightTranslationCache({
        ttlMinutes: Number(res?.data?.ttlMinutes || 60),
      });
    } catch (e) {
      console.error("fetchInsightTranslationCacheSetting failed", e);
    }
  };

  const fetchDlpSetting = async () => {
    if (!isSuperAdmin) return;
    try {
      const res = await axios.get(`${API}/admin/settings/dlp`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = res?.data || {};
      setDlpSettings({
        enabled: data.enabled !== false,
        mode: data.mode || "block",
        checkSsn: data.checkSsn !== false,
        checkCreditCard: data.checkCreditCard !== false,
        checkEmail: data.checkEmail !== false,
        checkPhone: data.checkPhone !== false,
        checkIban: data.checkIban !== false,
        maskDetectedColumns: data.maskDetectedColumns === true,
        configured: data.configured === true,
      });
    } catch (e) {
      console.error("fetchDlpSetting failed", e);
    }
  };

  const fetchMetricsExposureSetting = async () => {
    if (!isSuperAdmin) return;
    try {
      const res = await axios.get(`${API}/admin/settings/metrics-exposure`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setMetricsExposure({
        enabled: res?.data?.enabled === true,
      });
    } catch (e) {
      console.error("fetchMetricsExposureSetting failed", e);
    }
  };

  const fetchAutosyncIntervalSetting = async () => {
    if (!isSuperAdmin) return;
    try {
      const res = await axios.get(`${API}/admin/settings/autosync-interval`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setAutosyncInterval({
        intervalMinutes: Number(res?.data?.intervalMinutes || 5),
      });
    } catch (e) {
      console.error("fetchAutosyncIntervalSetting failed", e);
    }
  };

  const fetchImportPipelineSetting = async () => {
    if (!isSuperAdmin) return;
    try {
      const res = await axios.get(`${API}/admin/settings/import-pipeline`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = res?.data || {};
      setImportPipelineSettings({
        importStreamingEnabled: data.importStreamingEnabled === true,
        queuedImportStreamingV2Enabled: data.queuedImportStreamingV2Enabled === true,
        importStagingWriteEnabled: data.importStagingWriteEnabled === true,
        importStagingFinalizeEnabled: data.importStagingFinalizeEnabled === true,
      });
      setAiRuntimeSettings((prev) => ({ ...prev, importStreamingEnabled: data.importStreamingEnabled === true }));
    } catch (e) {
      console.error("fetchImportPipelineSetting failed", e);
    }
  };

  const fetchRevisionCompareSetting = async () => {
    if (!isSuperAdmin) return;
    try {
      const res = await axios.get(`${API}/admin/settings/revision-compare`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = res?.data || {};
      setRevisionCompareSettings({
        maxRows: Number(data.maxRows || 100000),
        maxAllowedRows: Number(data.maxAllowedRows || 100000),
      });
    } catch (e) {
      console.error("fetchRevisionCompareSetting failed", e);
    }
  };

  const fetchAiRuntimeSetting = async () => {
    if (!isSuperAdmin) return;
    const requestSeq = ++aiRuntimeRequestSeqRef.current;
    try {
      const res = await axios.get(`${API}/admin/settings/ai-runtime`, {
        headers: { Authorization: `Bearer ${token}` },
        params: integrationScopeParams,
      });
      if (requestSeq !== aiRuntimeRequestSeqRef.current) return;
      const data = res?.data || {};
      const aiProvider = String(data.aiProvider || AI_RUNTIME_PRESETS.mid.aiProvider || "openai").toLowerCase();
      const providerConfigs = normalizeAiProviderConfigMap(data.providerConfigs || AI_RUNTIME_PRESETS.mid.providerConfigs);
      const activeProviderConfig = providerConfigs[aiProvider] || {};
      const effectiveModel = String(data.openaiModel || activeProviderConfig.model || "").trim();
      const effectiveModelPricing = getAiModelPricing(effectiveModel || activeProviderConfig.model);
      const modelPricing = {
        openaiInputCostPer1M: Number(activeProviderConfig.inputCostPer1M ?? effectiveModelPricing.openaiInputCostPer1M),
        openaiOutputCostPer1M: Number(activeProviderConfig.outputCostPer1M ?? effectiveModelPricing.openaiOutputCostPer1M),
      };
      setAiRuntimeSettings({
        aiRuntimePreset: String(data.aiRuntimePreset || AI_RUNTIME_PRESETS.mid.aiRuntimePreset),
        aiProvider,
        providerConfigs,
        globalAiDisabled: data.globalAiDisabled === true,
        chatEnabled: data.chatEnabled === true,
        chatAudioEnabled: data.chatAudioEnabled === true,
        dashboardTranslationEnabled: data.dashboardTranslationEnabled === true,
        insightAiEnabled: data.insightAiEnabled === true,
        importStreamingEnabled: data.importStreamingEnabled === true,
        businessClassificationEnabled: data.businessClassificationEnabled === true,
        businessClassificationModel: String(data.businessClassificationModel || AI_RUNTIME_PRESETS.mid.businessClassificationModel),
        businessClassificationApplyUploads: data.businessClassificationApplyUploads !== false,
        businessClassificationApplyEmailIngest: data.businessClassificationApplyEmailIngest !== false,
        businessClassificationApplyAutosync: data.businessClassificationApplyAutosync !== false,
        businessClassificationMaxSampleRows: Number(data.businessClassificationMaxSampleRows || AI_RUNTIME_PRESETS.mid.businessClassificationMaxSampleRows),
        businessClassificationMaxPromptChars: Number(data.businessClassificationMaxPromptChars || AI_RUNTIME_PRESETS.mid.businessClassificationMaxPromptChars),
        businessClassificationMaxOutputTokens: Number(data.businessClassificationMaxOutputTokens || AI_RUNTIME_PRESETS.mid.businessClassificationMaxOutputTokens),
        chatMaxInputChars: Number(data.chatMaxInputChars || AI_RUNTIME_PRESETS.mid.chatMaxInputChars),
        chatPromptBudgetEnabled: data.chatPromptBudgetEnabled !== false,
        chatHistoryWindowMessages: Number(data.chatHistoryWindowMessages || AI_RUNTIME_PRESETS.mid.chatHistoryWindowMessages),
        dashboardTranslateMaxItems: Number(data.dashboardTranslateMaxItems || AI_RUNTIME_PRESETS.mid.dashboardTranslateMaxItems),
        dashboardTranslateMaxCharsPerItem: Number(data.dashboardTranslateMaxCharsPerItem || AI_RUNTIME_PRESETS.mid.dashboardTranslateMaxCharsPerItem),
        llmMaxOutputTokens: Number(data.llmMaxOutputTokens || AI_RUNTIME_PRESETS.mid.llmMaxOutputTokens),
        openaiModel: effectiveModel,
        openaiBaseUrl: String(data.openaiBaseUrl || AI_RUNTIME_PRESETS.mid.openaiBaseUrl),
        openaiTimeoutMs: Number(data.openaiTimeoutMs || AI_RUNTIME_PRESETS.mid.openaiTimeoutMs),
        openaiTemperature: Number(data.openaiTemperature || AI_RUNTIME_PRESETS.mid.openaiTemperature),
        openaiMaxOutputTokens: Number(data.openaiMaxOutputTokens || AI_RUNTIME_PRESETS.mid.openaiMaxOutputTokens),
        openaiInputCostPer1M: modelPricing.openaiInputCostPer1M,
        openaiOutputCostPer1M: modelPricing.openaiOutputCostPer1M,
        translationOpenaiModel: String(data.translationOpenaiModel || AI_RUNTIME_PRESETS.mid.translationOpenaiModel),
        insightAiModel: String(data.insightAiModel || AI_RUNTIME_PRESETS.mid.insightAiModel),
        translationTemperature: Number(data.translationTemperature ?? AI_RUNTIME_PRESETS.mid.translationTemperature),
        translationMaxOutputTokens: Number(data.translationMaxOutputTokens || AI_RUNTIME_PRESETS.mid.translationMaxOutputTokens),
        insightAiMaxSeriesPoints: Number(data.insightAiMaxSeriesPoints || AI_RUNTIME_PRESETS.mid.insightAiMaxSeriesPoints),
        insightAiMaxPromptChars: Number(data.insightAiMaxPromptChars || AI_RUNTIME_PRESETS.mid.insightAiMaxPromptChars),
        chatAudioMaxChars: Number(data.chatAudioMaxChars || AI_RUNTIME_PRESETS.mid.chatAudioMaxChars),
        chatAudioTtsModelEn: String(data.chatAudioTtsModelEn || AI_RUNTIME_PRESETS.mid.chatAudioTtsModelEn),
        chatAudioTtsModelDefault: String(data.chatAudioTtsModelDefault || AI_RUNTIME_PRESETS.mid.chatAudioTtsModelDefault),
        chatAudioTtsVoice: String(data.chatAudioTtsVoice || AI_RUNTIME_PRESETS.mid.chatAudioTtsVoice),
        chatAudioTtsSpeed: Number(data.chatAudioTtsSpeed ?? AI_RUNTIME_PRESETS.mid.chatAudioTtsSpeed),
      });
    } catch (e) {
      console.error("fetchAiRuntimeSetting failed", e);
    }
  };
  const fetchAiSelfLearningSetting = async () => {
    if (!isSuperAdmin) return;
    try {
      const res = await axios.get(`${API}/admin/settings/ai-self-learning`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = res?.data || {};
      setAiSelfLearningSettings({
        enabled: data.enabled === true,
        autoApplyApprovedRules: data.autoApplyApprovedRules !== false,
        autoApproveAllCandidates: data.autoApproveAllCandidates === true,
        minConfidence: Number(data.minConfidence ?? 0.75),
      });
    } catch (e) {
      console.error("fetchAiSelfLearningSetting failed", e);
    }
  };
  const fetchAiUsageSummary = async (periodMonth = aiUsagePeriodMonth) => {
    if (!isSuperAdmin) return;
    const month = String(periodMonth || "").trim() || new Date().toISOString().slice(0, 7);
    setAiUsageLoading(true);
    setAiUsageError("");
    try {
      const res = await axios.get(`${API}/admin/ai-usage-summary`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { periodMonth: month },
      });
      const data = res?.data || {};
      setAiUsageSummary({
        periodMonth: String(data.periodMonth || month),
        totals: data.totals || null,
        source: String(data.source || ""),
        openAi: data.openAi || null,
        appLocal: data.appLocal || null,
        groups: Array.isArray(data.groups) ? data.groups : [],
      });
    } catch (e) {
      setAiUsageError(e.response?.data?.error || "Failed to load AI usage stats");
    } finally {
      setAiUsageLoading(false);
    }
  };
  const fetchAiLearningCandidates = async () => {
    if (!isSuperAdmin) return;
    setAiLearningCandidatesLoading(true);
    try {
      const [pendingRes, approvedRes] = await Promise.all([
        axios.get(`${API}/admin/ai-learning/candidates`, {
          headers: { Authorization: `Bearer ${token}` },
          params: { status: "pending" },
        }),
        axios.get(`${API}/admin/ai-learning/candidates`, {
          headers: { Authorization: `Bearer ${token}` },
          params: { status: "approved" },
        }),
      ]);
      setAiLearningCandidates(Array.isArray(pendingRes?.data?.items) ? pendingRes.data.items : []);
      setAiLearningApprovedCandidates(Array.isArray(approvedRes?.data?.items) ? approvedRes.data.items : []);
    } catch (e) {
      console.error("fetchAiLearningCandidates failed", e);
    } finally {
      setAiLearningCandidatesLoading(false);
    }
  };
  const fetchAiLearningFeedbackPending = async () => {
    if (!isSuperAdmin) return;
    setAiLearningCandidatesLoading(true);
    try {
      const res = await axios.get(`${API}/admin/ai-learning/feedback`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { status: "pending" },
      });
      setAiLearningFeedbackPending(Array.isArray(res?.data?.items) ? res.data.items : []);
    } catch (e) {
      console.error("fetchAiLearningFeedbackPending failed", e);
    } finally {
      setAiLearningCandidatesLoading(false);
    }
  };
  const fetchAiLearningImpact = async () => {
    if (!isSuperAdmin) return;
    try {
      const res = await axios.get(`${API}/admin/ai-learning/impact`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { days: 30 },
      });
      setAiLearningImpact({
        days: Number(res?.data?.days || 30),
        intents: Array.isArray(res?.data?.intents) ? res.data.intents : [],
      });
    } catch (e) {
      console.error("fetchAiLearningImpact failed", e);
    }
  };

  const fetchTwoFactorTotpSetting = async () => {
    if (!isSuperAdmin || !token) return;
    try {
      const res = await axios.get(`${API}/admin/settings/two-factor-totp`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = res?.data || {};
      setTwoFactorTotpSettings({
        issuer: String(data.issuer || ""),
        digits: Number(data.digits || 6),
        period: Number(data.period || 30),
      });
    } catch (e) {
      if (e?.response?.status === 401) return;
      console.error("fetchTwoFactorTotpSetting failed", e);
    }
  };

  const fetchSmsOtpSetting = async () => {
    if (!isSuperAdmin || !token) return;
    try {
      const res = await axios.get(`${API}/admin/settings/sms-otp`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = res?.data || {};
      setSmsOtpSettings({
        provider: "twilio",
        enabled: data.enabled !== false,
        accountSid: String(data.accountSid || ""),
        authToken: "",
        hasAuthToken: data.hasAuthToken === true,
        fromNumber: String(data.fromNumber || ""),
        messagingServiceSid: String(data.messagingServiceSid || ""),
      });
    } catch (e) {
      if (e?.response?.status === 401) return;
      console.error("fetchSmsOtpSetting failed", e);
    }
  };

  const fetchEmailIngestSetting = async () => {
    if (!canManageIntegrations) return;
    if (!isSuperAdmin && !inviteGroupId) return;
    try {
      const res = await axios.get(`${API}/admin/settings/email-ingest`, {
        headers: { Authorization: `Bearer ${token}` },
        params: emailIngestScopeParams,
      });
      const data = res?.data || {};
      setEmailIngestConfig({
        enabled: data.enabled !== false,
        provider: data.provider || "google_workspace",
        inboundDomain: data.inboundDomain || "",
        routeMailbox: data.routeMailbox || "",
        addressPrefix: data.addressPrefix || "customer",
        addressMode: data.addressMode || "slug",
        routingMode: data.routingMode || "catch_all",
        requireApprovedSenders: data.requireApprovedSenders !== false,
        allowedSenderDomains: Array.isArray(data.allowedSenderDomains) ? data.allowedSenderDomains : [],
        notes: data.notes || "",
      });
    } catch (e) {
      console.error("fetchEmailIngestSetting failed", e);
    }
  };

  const saveMetricsExposureSetting = async (enabledOverride = null) => {
    if (!isSuperAdmin || metricsExposureSaving) return;
    setMetricsExposureSaving(true);
    try {
      const payload = { enabled: enabledOverride == null ? metricsExposure.enabled !== false : !!enabledOverride };
      const res = await axios.patch(`${API}/admin/settings/metrics-exposure`, payload, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setMetricsExposure({ enabled: res?.data?.enabled === true });
    } catch (e) {
      alert(e.response?.data?.error || "Failed to save metrics exposure setting");
    } finally {
      setMetricsExposureSaving(false);
    }
  };

  const saveInsightTranslationCacheSetting = async () => {
    if (!isSuperAdmin || insightTranslationCacheSaving) return;
    setInsightTranslationCacheSaving(true);
    setInsightTranslationCacheSaved(false);
    try {
      const payload = {
        ttlMinutes: Number.parseInt(String(insightTranslationCache.ttlMinutes || "").trim(), 10) || 60,
      };
      const res = await axios.patch(`${API}/admin/settings/insight-translation-cache`, payload, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setInsightTranslationCache({
        ttlMinutes: Number(res?.data?.ttlMinutes || payload.ttlMinutes),
      });
      setInsightTranslationCacheSaved(true);
      setTimeout(() => setInsightTranslationCacheSaved(false), 1800);
    } catch (e) {
      alert(e.response?.data?.error || "Failed to save insight translation cache settings");
    } finally {
      setInsightTranslationCacheSaving(false);
    }
  };

  const saveDlpSetting = async () => {
    if (!isSuperAdmin || dlpSettingsSaving) return;
    setDlpSettingsSaving(true);
    setDlpSettingsSaved(false);
    try {
      const payload = {
        enabled: dlpSettings.enabled !== false,
        mode: ["block", "warn", "mask"].includes(dlpSettings.mode) ? dlpSettings.mode : "block",
        checkSsn: dlpSettings.checkSsn !== false,
        checkCreditCard: dlpSettings.checkCreditCard !== false,
        checkEmail: dlpSettings.checkEmail !== false,
        checkPhone: dlpSettings.checkPhone !== false,
        checkIban: dlpSettings.checkIban !== false,
        maskDetectedColumns: dlpSettings.mode === "mask",
      };
      const res = await axios.patch(`${API}/admin/settings/dlp`, payload, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = res?.data || payload;
      setDlpSettings({
        enabled: data.enabled !== false,
        mode: data.mode || "block",
        checkSsn: data.checkSsn !== false,
        checkCreditCard: data.checkCreditCard !== false,
        checkEmail: data.checkEmail !== false,
        checkPhone: data.checkPhone !== false,
        checkIban: data.checkIban !== false,
        maskDetectedColumns: data.maskDetectedColumns === true,
        configured: true,
      });
      setDlpSettingsSaved(true);
      setTimeout(() => setDlpSettingsSaved(false), 1800);
    } catch (e) {
      alert(e.response?.data?.error || "Failed to save DLP settings");
    } finally {
      setDlpSettingsSaving(false);
    }
  };

  const saveAutosyncIntervalSetting = async () => {
    if (!isSuperAdmin || autosyncIntervalSaving) return;
    setAutosyncIntervalSaving(true);
    setAutosyncIntervalSaved(false);
    try {
      const payload = {
        intervalMinutes: Number.parseInt(String(autosyncInterval.intervalMinutes || "").trim(), 10) || 5,
      };
      const res = await axios.patch(`${API}/admin/settings/autosync-interval`, payload, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setAutosyncInterval({
        intervalMinutes: Number(res?.data?.intervalMinutes || payload.intervalMinutes),
      });
      setAutosyncIntervalSaved(true);
      setTimeout(() => setAutosyncIntervalSaved(false), 1800);
    } catch (e) {
      alert(e.response?.data?.error || "Failed to save autosync interval settings");
    } finally {
      setAutosyncIntervalSaving(false);
    }
  };

  const saveImportPipelineSetting = async () => {
    if (!isSuperAdmin || importPipelineSaving) return;
    setImportPipelineSaving(true);
    setImportPipelineSaved(false);
    try {
      const payload = {
        importStreamingEnabled: importPipelineSettings.importStreamingEnabled === true,
        queuedImportStreamingV2Enabled: importPipelineSettings.queuedImportStreamingV2Enabled === true,
        importStagingWriteEnabled: importPipelineSettings.importStagingWriteEnabled === true,
        importStagingFinalizeEnabled: importPipelineSettings.importStagingFinalizeEnabled === true,
      };
      const res = await axios.patch(`${API}/admin/settings/import-pipeline`, payload, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = res?.data || payload;
      setImportPipelineSettings({
        importStreamingEnabled: data.importStreamingEnabled === true,
        queuedImportStreamingV2Enabled: data.queuedImportStreamingV2Enabled === true,
        importStagingWriteEnabled: data.importStagingWriteEnabled === true,
        importStagingFinalizeEnabled: data.importStagingFinalizeEnabled === true,
      });
      setAiRuntimeSettings((prev) => ({ ...prev, importStreamingEnabled: data.importStreamingEnabled === true }));
      setImportPipelineSaved(true);
      setTimeout(() => setImportPipelineSaved(false), 1800);
    } catch (e) {
      alert(e.response?.data?.error || "Failed to save import pipeline settings");
    } finally {
      setImportPipelineSaving(false);
    }
  };

  const saveRevisionCompareSetting = async () => {
    if (!isSuperAdmin || revisionCompareSaving) return;
    setRevisionCompareSaving(true);
    setRevisionCompareSaved(false);
    try {
      const payload = {
        maxRows: Number.parseInt(String(revisionCompareSettings.maxRows || "").trim(), 10) || 100000,
      };
      const res = await axios.patch(`${API}/admin/settings/revision-compare`, payload, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setRevisionCompareSettings({
        maxRows: Number(res?.data?.maxRows || payload.maxRows),
        maxAllowedRows: Number(res?.data?.maxAllowedRows || 100000),
      });
      setRevisionCompareSaved(true);
      setTimeout(() => setRevisionCompareSaved(false), 1800);
    } catch (e) {
      alert(e.response?.data?.error || "Failed to save revision compare settings");
    } finally {
      setRevisionCompareSaving(false);
    }
  };

  const saveAiRuntimeSetting = async (preset = null) => {
    if (!isSuperAdmin || aiRuntimeSaving) return;
    const requestSeq = ++aiRuntimeRequestSeqRef.current;
    setAiRuntimeSaving(true);
    setAiRuntimeSaved(false);
    try {
      const runtimeDraft = aiRuntimeSettingsRef.current || aiRuntimeSettings || {};
      const selectedAiProvider = String(runtimeDraft.aiProvider || AI_RUNTIME_PRESETS.mid.aiProvider || "openai").trim().toLowerCase();
      const selectedModel = String(
        runtimeDraft.providerConfigs?.[selectedAiProvider]?.model ||
        runtimeDraft.openaiModel ||
        ""
      ).trim();
      const providerConfigs = normalizeAiProviderConfigMap(runtimeDraft.providerConfigs || AI_RUNTIME_PRESETS.mid.providerConfigs);
      const fallbackSelectedModelPricing = getAiModelPricing(selectedModel);
      const selectedModelPricing = {
        openaiInputCostPer1M: Number(providerConfigs[selectedAiProvider]?.inputCostPer1M ?? fallbackSelectedModelPricing.openaiInputCostPer1M),
        openaiOutputCostPer1M: Number(providerConfigs[selectedAiProvider]?.outputCostPer1M ?? fallbackSelectedModelPricing.openaiOutputCostPer1M),
      };
      providerConfigs[selectedAiProvider] = {
        ...providerConfigs[selectedAiProvider],
        model: selectedModel,
        baseUrl: String(runtimeDraft.openaiBaseUrl || providerConfigs[selectedAiProvider]?.baseUrl || AI_RUNTIME_PRESETS.mid.openaiBaseUrl).trim(),
        inputCostPer1M: selectedModelPricing.openaiInputCostPer1M,
        outputCostPer1M: selectedModelPricing.openaiOutputCostPer1M,
      };
      const next = preset && AI_RUNTIME_PRESETS[preset]
        ? {
            ...AI_RUNTIME_PRESETS[preset],
            aiProvider: selectedAiProvider,
            providerConfigs,
            openaiModel: selectedModel,
            openaiBaseUrl: String(runtimeDraft.openaiBaseUrl || "").trim() || AI_RUNTIME_PRESETS.mid.openaiBaseUrl,
            businessClassificationModel: String(runtimeDraft.businessClassificationModel || "").trim() || selectedModel,
            translationOpenaiModel: String(runtimeDraft.translationOpenaiModel || "").trim() || selectedModel,
            insightAiModel: String(runtimeDraft.insightAiModel || "").trim() || selectedModel,
            importStreamingEnabled: runtimeDraft.importStreamingEnabled === true,
          }
        : {
            chatEnabled: runtimeDraft.chatEnabled === true,
            aiRuntimePreset: String(runtimeDraft.aiRuntimePreset || preset || "mid").toLowerCase(),
            aiProvider: selectedAiProvider,
            providerConfigs,
            globalAiDisabled: runtimeDraft.globalAiDisabled === true,
            chatAudioEnabled: runtimeDraft.chatAudioEnabled === true,
            dashboardTranslationEnabled: runtimeDraft.dashboardTranslationEnabled === true,
            insightAiEnabled: runtimeDraft.insightAiEnabled === true,
            importStreamingEnabled: runtimeDraft.importStreamingEnabled === true,
            businessClassificationEnabled: runtimeDraft.businessClassificationEnabled === true,
            businessClassificationModel: String(runtimeDraft.businessClassificationModel || "").trim() || AI_RUNTIME_PRESETS.mid.businessClassificationModel,
            businessClassificationApplyUploads: runtimeDraft.businessClassificationApplyUploads !== false,
            businessClassificationApplyEmailIngest: runtimeDraft.businessClassificationApplyEmailIngest !== false,
            businessClassificationApplyAutosync: runtimeDraft.businessClassificationApplyAutosync !== false,
            businessClassificationMaxSampleRows: Number.parseInt(String(runtimeDraft.businessClassificationMaxSampleRows || "").trim(), 10) || AI_RUNTIME_PRESETS.mid.businessClassificationMaxSampleRows,
            businessClassificationMaxPromptChars: Number.parseInt(String(runtimeDraft.businessClassificationMaxPromptChars || "").trim(), 10) || AI_RUNTIME_PRESETS.mid.businessClassificationMaxPromptChars,
            businessClassificationMaxOutputTokens: Number.parseInt(String(runtimeDraft.businessClassificationMaxOutputTokens || "").trim(), 10) || AI_RUNTIME_PRESETS.mid.businessClassificationMaxOutputTokens,
            chatMaxInputChars: Number.parseInt(String(runtimeDraft.chatMaxInputChars || "").trim(), 10) || AI_RUNTIME_PRESETS.mid.chatMaxInputChars,
            chatPromptBudgetEnabled: runtimeDraft.chatPromptBudgetEnabled !== false,
            chatHistoryWindowMessages: Number.parseInt(String(runtimeDraft.chatHistoryWindowMessages || "").trim(), 10) || AI_RUNTIME_PRESETS.mid.chatHistoryWindowMessages,
            dashboardTranslateMaxItems: Number.parseInt(String(runtimeDraft.dashboardTranslateMaxItems || "").trim(), 10) || AI_RUNTIME_PRESETS.mid.dashboardTranslateMaxItems,
            dashboardTranslateMaxCharsPerItem: Number.parseInt(String(runtimeDraft.dashboardTranslateMaxCharsPerItem || "").trim(), 10) || AI_RUNTIME_PRESETS.mid.dashboardTranslateMaxCharsPerItem,
            llmMaxOutputTokens: Number.parseInt(String(runtimeDraft.llmMaxOutputTokens || "").trim(), 10) || AI_RUNTIME_PRESETS.mid.llmMaxOutputTokens,
            openaiModel: selectedModel,
            openaiBaseUrl: String(runtimeDraft.openaiBaseUrl || "").trim() || AI_RUNTIME_PRESETS.mid.openaiBaseUrl,
            openaiTimeoutMs: Number.parseInt(String(runtimeDraft.openaiTimeoutMs || "").trim(), 10) || AI_RUNTIME_PRESETS.mid.openaiTimeoutMs,
            openaiTemperature: Number.parseFloat(String(runtimeDraft.openaiTemperature || "").trim()) || AI_RUNTIME_PRESETS.mid.openaiTemperature,
            openaiMaxOutputTokens: Number.parseInt(String(runtimeDraft.openaiMaxOutputTokens || "").trim(), 10) || AI_RUNTIME_PRESETS.mid.openaiMaxOutputTokens,
            openaiInputCostPer1M: selectedModelPricing.openaiInputCostPer1M,
            openaiOutputCostPer1M: selectedModelPricing.openaiOutputCostPer1M,
            translationOpenaiModel: String(runtimeDraft.translationOpenaiModel || "").trim() || AI_RUNTIME_PRESETS.mid.translationOpenaiModel,
            insightAiModel: String(runtimeDraft.insightAiModel || "").trim() || AI_RUNTIME_PRESETS.mid.insightAiModel,
            translationTemperature: Number.parseFloat(String(runtimeDraft.translationTemperature || "").trim()) || 0,
            translationMaxOutputTokens: Number.parseInt(String(runtimeDraft.translationMaxOutputTokens || "").trim(), 10) || AI_RUNTIME_PRESETS.mid.translationMaxOutputTokens,
            insightAiMaxSeriesPoints: Number.parseInt(String(runtimeDraft.insightAiMaxSeriesPoints || "").trim(), 10) || AI_RUNTIME_PRESETS.mid.insightAiMaxSeriesPoints,
            insightAiMaxPromptChars: Number.parseInt(String(runtimeDraft.insightAiMaxPromptChars || "").trim(), 10) || AI_RUNTIME_PRESETS.mid.insightAiMaxPromptChars,
            chatAudioMaxChars: Number.parseInt(String(runtimeDraft.chatAudioMaxChars || "").trim(), 10) || AI_RUNTIME_PRESETS.mid.chatAudioMaxChars,
            chatAudioTtsModelEn: String(runtimeDraft.chatAudioTtsModelEn || "").trim() || AI_RUNTIME_PRESETS.mid.chatAudioTtsModelEn,
            chatAudioTtsModelDefault: String(runtimeDraft.chatAudioTtsModelDefault || "").trim() || AI_RUNTIME_PRESETS.mid.chatAudioTtsModelDefault,
            chatAudioTtsVoice: String(runtimeDraft.chatAudioTtsVoice || "").trim() || AI_RUNTIME_PRESETS.mid.chatAudioTtsVoice,
            chatAudioTtsSpeed: Number.parseFloat(String(runtimeDraft.chatAudioTtsSpeed || "").trim()) || AI_RUNTIME_PRESETS.mid.chatAudioTtsSpeed,
            aiBaseUrlAllowlistEnabled: runtimeDraft.aiBaseUrlAllowlistEnabled !== false,
            aiBaseUrlAllowlistBypass: runtimeDraft.aiBaseUrlAllowlistBypass === true,
            aiBaseUrlAllowlist: Array.isArray(runtimeDraft.aiBaseUrlAllowlist)
              ? runtimeDraft.aiBaseUrlAllowlist
              : String(runtimeDraft.aiBaseUrlAllowlist || "")
                .split(/[\n,]/)
                .map((v) => String(v || "").trim().toLowerCase())
                .filter(Boolean),
          };
      const fallbackSavedPricingForModel = getAiModelPricing(next.openaiModel);
      const savedProviderConfigForModel = next.providerConfigs?.[next.aiProvider] || {};
      const savedPricingForModel = {
        openaiInputCostPer1M: Number(savedProviderConfigForModel.inputCostPer1M ?? fallbackSavedPricingForModel.openaiInputCostPer1M),
        openaiOutputCostPer1M: Number(savedProviderConfigForModel.outputCostPer1M ?? fallbackSavedPricingForModel.openaiOutputCostPer1M),
      };
      next.openaiInputCostPer1M = savedPricingForModel.openaiInputCostPer1M;
      next.openaiOutputCostPer1M = savedPricingForModel.openaiOutputCostPer1M;
      const res = await axios.patch(`${API}/admin/settings/ai-runtime`, { ...next }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (requestSeq !== aiRuntimeRequestSeqRef.current) return;
      const data = res?.data || next;
      const savedAiProvider = String(data.aiProvider || next.aiProvider || "openai").toLowerCase();
      const savedProviderConfigs = normalizeAiProviderConfigMap(data.providerConfigs || next.providerConfigs);
      const savedModel = String(data.openaiModel || next.openaiModel);
      const fallbackSavedModelPricing = getAiModelPricing(savedModel);
      const savedActiveProviderConfig = savedProviderConfigs[savedAiProvider] || {};
      const savedModelPricing = {
        openaiInputCostPer1M: Number(savedActiveProviderConfig.inputCostPer1M ?? fallbackSavedModelPricing.openaiInputCostPer1M),
        openaiOutputCostPer1M: Number(savedActiveProviderConfig.outputCostPer1M ?? fallbackSavedModelPricing.openaiOutputCostPer1M),
      };
      setAiRuntimeSettings({
        aiRuntimePreset: String(data.aiRuntimePreset || next.aiRuntimePreset || "mid"),
        aiProvider: savedAiProvider,
        providerConfigs: savedProviderConfigs,
        globalAiDisabled: data.globalAiDisabled === true,
        chatEnabled: data.chatEnabled === true,
        chatAudioEnabled: data.chatAudioEnabled === true,
        dashboardTranslationEnabled: data.dashboardTranslationEnabled === true,
        insightAiEnabled: data.insightAiEnabled === true,
        importStreamingEnabled: data.importStreamingEnabled === true,
        businessClassificationEnabled: data.businessClassificationEnabled === true,
        businessClassificationModel: String(data.businessClassificationModel || next.businessClassificationModel),
        businessClassificationApplyUploads: data.businessClassificationApplyUploads !== false,
        businessClassificationApplyEmailIngest: data.businessClassificationApplyEmailIngest !== false,
        businessClassificationApplyAutosync: data.businessClassificationApplyAutosync !== false,
        businessClassificationMaxSampleRows: Number(data.businessClassificationMaxSampleRows || next.businessClassificationMaxSampleRows),
        businessClassificationMaxPromptChars: Number(data.businessClassificationMaxPromptChars || next.businessClassificationMaxPromptChars),
        businessClassificationMaxOutputTokens: Number(data.businessClassificationMaxOutputTokens || next.businessClassificationMaxOutputTokens),
        chatMaxInputChars: Number(data.chatMaxInputChars || next.chatMaxInputChars),
        chatPromptBudgetEnabled: data.chatPromptBudgetEnabled !== false,
        chatHistoryWindowMessages: Number(data.chatHistoryWindowMessages || next.chatHistoryWindowMessages),
        dashboardTranslateMaxItems: Number(data.dashboardTranslateMaxItems || next.dashboardTranslateMaxItems),
        dashboardTranslateMaxCharsPerItem: Number(data.dashboardTranslateMaxCharsPerItem || next.dashboardTranslateMaxCharsPerItem),
        llmMaxOutputTokens: Number(data.llmMaxOutputTokens || next.llmMaxOutputTokens),
        openaiModel: savedModel,
        openaiBaseUrl: String(data.openaiBaseUrl || next.openaiBaseUrl),
        openaiTimeoutMs: Number(data.openaiTimeoutMs || next.openaiTimeoutMs),
        openaiTemperature: Number(data.openaiTemperature || next.openaiTemperature),
        openaiMaxOutputTokens: Number(data.openaiMaxOutputTokens || next.openaiMaxOutputTokens),
        openaiInputCostPer1M: savedModelPricing.openaiInputCostPer1M,
        openaiOutputCostPer1M: savedModelPricing.openaiOutputCostPer1M,
        translationOpenaiModel: String(data.translationOpenaiModel || next.translationOpenaiModel),
        insightAiModel: String(data.insightAiModel || next.insightAiModel || AI_RUNTIME_PRESETS.mid.insightAiModel),
        translationTemperature: Number(data.translationTemperature ?? next.translationTemperature),
        translationMaxOutputTokens: Number(data.translationMaxOutputTokens || next.translationMaxOutputTokens),
        insightAiMaxSeriesPoints: Number(data.insightAiMaxSeriesPoints || next.insightAiMaxSeriesPoints),
        insightAiMaxPromptChars: Number(data.insightAiMaxPromptChars || next.insightAiMaxPromptChars),
        chatAudioMaxChars: Number(data.chatAudioMaxChars || next.chatAudioMaxChars),
        chatAudioTtsModelEn: String(data.chatAudioTtsModelEn || next.chatAudioTtsModelEn),
        chatAudioTtsModelDefault: String(data.chatAudioTtsModelDefault || next.chatAudioTtsModelDefault),
        chatAudioTtsVoice: String(data.chatAudioTtsVoice || next.chatAudioTtsVoice),
        chatAudioTtsSpeed: Number(data.chatAudioTtsSpeed ?? next.chatAudioTtsSpeed),
        aiBaseUrlAllowlistEnabled: data.aiBaseUrlAllowlistEnabled !== false,
        aiBaseUrlAllowlistBypass: data.aiBaseUrlAllowlistBypass === true,
        aiBaseUrlAllowlist: Array.isArray(data.aiBaseUrlAllowlist) ? data.aiBaseUrlAllowlist : (Array.isArray(next.aiBaseUrlAllowlist) ? next.aiBaseUrlAllowlist : []),
      });
      setAiRuntimeSaved(true);
      setTimeout(() => setAiRuntimeSaved(false), 1800);
    } catch (e) {
      alert(e.response?.data?.error || "Failed to save AI runtime settings");
    } finally {
      setAiRuntimeSaving(false);
    }
  };
  const saveAiSelfLearningSetting = async () => {
    if (!isSuperAdmin || aiSelfLearningSaving) return;
    setAiSelfLearningSaving(true);
    try {
      const payload = {
        enabled: aiSelfLearningSettings.enabled === true,
        autoApplyApprovedRules: aiSelfLearningSettings.autoApplyApprovedRules !== false,
        autoApproveAllCandidates: aiSelfLearningSettings.autoApproveAllCandidates === true,
        minConfidence: Number(aiSelfLearningSettings.minConfidence ?? 0.75),
      };
      const res = await axios.patch(`${API}/admin/settings/ai-self-learning`, payload, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = res?.data || payload;
      setAiSelfLearningSettings({
        enabled: data.enabled === true,
        autoApplyApprovedRules: data.autoApplyApprovedRules !== false,
        autoApproveAllCandidates: data.autoApproveAllCandidates === true,
        minConfidence: Number(data.minConfidence ?? 0.75),
      });
      setAiSelfLearningSaved(true);
      setTimeout(() => setAiSelfLearningSaved(false), 1800);
    } catch (e) {
      alert(e.response?.data?.error || "Failed to save AI self-learning settings");
    } finally {
      setAiSelfLearningSaving(false);
    }
  };
  const reviewAiLearningCandidate = async (id, action) => {
    if (!isSuperAdmin || !id || !action) return;
    setAiLearningReviewBusyId(id);
    try {
      await axios.post(`${API}/admin/ai-learning/candidates/${id}/review`, { action }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      await fetchAiLearningCandidates();
      await fetchAiLearningImpact();
    } catch (e) {
      alert(e.response?.data?.error || "Failed to review learning candidate");
    } finally {
      setAiLearningReviewBusyId(null);
    }
  };
  const reviewAiLearningFeedback = async (id, action) => {
    if (!isSuperAdmin || !id || !action) return;
    setAiLearningReviewBusyId(`fb-${id}`);
    try {
      await axios.post(`${API}/admin/ai-learning/feedback/${id}/review`, { action }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      await Promise.all([fetchAiLearningFeedbackPending(), fetchAiLearningCandidates(), fetchAiLearningImpact()]);
    } catch (e) {
      alert(e.response?.data?.error || "Failed to review learning feedback");
    } finally {
      setAiLearningReviewBusyId(null);
    }
  };

  const applyAiRuntimePreset = (preset) => {
    if (!preset || !AI_RUNTIME_PRESETS[preset]) return;
    const presetModel = normalizeAiProviderConfigMap(aiRuntimeSettings.providerConfigs || {})[aiRuntimeSettings.aiProvider || AI_RUNTIME_PRESETS[preset].aiProvider || "openai"]?.model || "";
    setAiRuntimeSettings((prev) => ({
      ...prev,
      ...AI_RUNTIME_PRESETS[preset],
      aiRuntimePreset: preset,
      aiProvider: prev.aiProvider || AI_RUNTIME_PRESETS[preset].aiProvider,
      providerConfigs: normalizeAiProviderConfigMap(prev.providerConfigs || AI_RUNTIME_PRESETS[preset].providerConfigs),
      openaiModel: prev.openaiModel || presetModel,
      openaiBaseUrl: prev.openaiBaseUrl || AI_RUNTIME_PRESETS[preset].openaiBaseUrl,
      businessClassificationModel: prev.businessClassificationModel || AI_RUNTIME_PRESETS[preset].businessClassificationModel,
      translationOpenaiModel: prev.translationOpenaiModel || AI_RUNTIME_PRESETS[preset].translationOpenaiModel,
      insightAiModel: prev.insightAiModel || AI_RUNTIME_PRESETS[preset].insightAiModel,
    }));
  };

  const saveTwoFactorTotpSetting = async () => {
    if (!isSuperAdmin || twoFactorTotpSaving) return;
    setTwoFactorTotpSaving(true);
    setTwoFactorTotpSaved(false);
    try {
      const payload = {
        issuer: String(twoFactorTotpSettings.issuer || "").trim(),
        digits: Number.parseInt(String(twoFactorTotpSettings.digits || "").trim(), 10) || 6,
        period: Number.parseInt(String(twoFactorTotpSettings.period || "").trim(), 10) || 30,
      };
      const res = await axios.patch(`${API}/admin/settings/two-factor-totp`, payload, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setTwoFactorTotpSettings({
        issuer: String(res?.data?.issuer || payload.issuer),
        digits: Number(res?.data?.digits || payload.digits),
        period: Number(res?.data?.period || payload.period),
      });
      setTwoFactorTotpSaved(true);
      setTimeout(() => setTwoFactorTotpSaved(false), 1800);
    } catch (e) {
      alert(e.response?.data?.error || "Failed to save 2FA TOTP settings");
    } finally {
      setTwoFactorTotpSaving(false);
    }
  };

  const saveSmsOtpSetting = async () => {
    if (!isSuperAdmin || smsOtpSaving) return;
    setSmsOtpSaving(true);
    setSmsOtpSaved(false);
    try {
      const payload = {
        provider: "twilio",
        enabled: smsOtpSettings.enabled !== false,
        accountSid: String(smsOtpSettings.accountSid || "").trim(),
        authToken: String(smsOtpSettings.authToken || "").trim() || "***",
        fromNumber: String(smsOtpSettings.fromNumber || "").trim(),
        messagingServiceSid: String(smsOtpSettings.messagingServiceSid || "").trim(),
      };
      const res = await axios.patch(`${API}/admin/settings/sms-otp`, payload, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = res?.data || {};
      setSmsOtpSettings((prev) => ({
        ...prev,
        provider: "twilio",
        enabled: data.enabled !== false,
        accountSid: String(data.accountSid || payload.accountSid),
        authToken: "",
        hasAuthToken: data.hasAuthToken === true,
        fromNumber: String(data.fromNumber || payload.fromNumber),
        messagingServiceSid: String(data.messagingServiceSid || payload.messagingServiceSid),
      }));
      setSmsOtpSaved(true);
      setTimeout(() => setSmsOtpSaved(false), 1800);
    } catch (e) {
      alert(e.response?.data?.error || "Failed to save 2FA SMS settings");
    } finally {
      setSmsOtpSaving(false);
    }
  };

  const saveEmailIngestSetting = async () => {
    if (!canManageIntegrations || emailIngestSaving) return;
    if (!isSuperAdmin && !inviteGroupId) return;
    setEmailIngestSaving(true);
    setEmailIngestSaved(false);
    try {
      const payload = {
        enabled: emailIngestConfig.enabled !== false,
        provider: "google_workspace",
        inboundDomain: String(emailIngestConfig.inboundDomain || "").trim().toLowerCase(),
        routeMailbox: String(emailIngestConfig.routeMailbox || "").trim().toLowerCase(),
        addressPrefix: String(emailIngestConfig.addressPrefix || "customer").trim(),
        addressMode: emailIngestConfig.addressMode === "id" ? "id" : "slug",
        routingMode: emailIngestConfig.routingMode === "default_routing" ? "default_routing" : "catch_all",
        requireApprovedSenders: emailIngestConfig.requireApprovedSenders !== false,
        allowedSenderDomains: Array.isArray(emailIngestConfig.allowedSenderDomains)
          ? emailIngestConfig.allowedSenderDomains
          : String(emailIngestConfig.allowedSenderDomains || "").split(/[\n,]+/).map((v) => v.trim()).filter(Boolean),
        notes: String(emailIngestConfig.notes || "").trim(),
      };
      const res = await axios.patch(`${API}/admin/settings/email-ingest`, payload, {
        headers: { Authorization: `Bearer ${token}` },
        params: emailIngestScopeParams,
      });
      const data = res?.data || {};
      setEmailIngestConfig({
        enabled: data.enabled !== false,
        provider: data.provider || "google_workspace",
        inboundDomain: data.inboundDomain || "",
        routeMailbox: data.routeMailbox || "",
        addressPrefix: data.addressPrefix || "customer",
        addressMode: data.addressMode || "slug",
        routingMode: data.routingMode || "catch_all",
        requireApprovedSenders: data.requireApprovedSenders !== false,
        allowedSenderDomains: Array.isArray(data.allowedSenderDomains) ? data.allowedSenderDomains : [],
        notes: data.notes || "",
      });
      setEmailIngestSaved(true);
      setTimeout(() => setEmailIngestSaved(false), 1800);
    } catch (e) {
      alert(e.response?.data?.error || "Failed to save email ingest settings");
    } finally {
      setEmailIngestSaving(false);
    }
  };

  const fetchPendingInvitations = async (gid = selectedGroupId) => {
    if (!gid) {
      setPendingInvitations([]);
      return;
    }
    setInvitationsLoading(true);
    try {
      const res = await axios.get(`${API}/users/invitations`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { groupId: Number(gid) },
      });
      setPendingInvitations(Array.isArray(res.data) ? res.data : []);
    } catch (e) {
      console.error("fetchPendingInvitations failed", e);
      setPendingInvitations([]);
    } finally {
      setInvitationsLoading(false);
    }
  };

  const resendInvitation = async (invitationId) => {
    if (!invitationId || inviteActionBusyId) return;
    setInviteActionBusyId(`resend:${invitationId}`);
    try {
      await axios.post(`${API}/users/invitations/${invitationId}/resend`, {}, {
        headers: { Authorization: `Bearer ${token}` },
      });
      alert("Invitation resent");
      fetchPendingInvitations();
    } catch (e) {
      alert(e.response?.data?.error || "Failed to resend invitation");
    } finally {
      setInviteActionBusyId(null);
    }
  };

  const revokeInvitation = async (invitationId) => {
    if (!invitationId || inviteActionBusyId) return;
    if (!window.confirm("Revoke this pending invitation?")) return;
    setInviteActionBusyId(`revoke:${invitationId}`);
    try {
      await axios.post(`${API}/users/invitations/${invitationId}/revoke`, {}, {
        headers: { Authorization: `Bearer ${token}` },
      });
      fetchPendingInvitations();
    } catch (e) {
      alert(e.response?.data?.error || "Failed to revoke invitation");
    } finally {
      setInviteActionBusyId(null);
    }
  };

  const fetchGroupMembers = async (gid) => {
    if (!gid) return setGroupMembers([]);
    try {
      const res = await axios.get(`${API}/groups/${gid}/users`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setGroupMembers(res.data || []);
    } catch (e) {
      console.error("fetchGroupMembers failed", e);
    }
  };

  // Fetch all groups a given user belongs to — single DB-side JOIN, O(1) request
  const getGroupsForUser = async (uid) => {
    try {
      const res = await axios.get(`${API}/users/${uid}/groups`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return (res.data || []).map((g) => g.id);
    } catch (e) {
      console.error("getGroupsForUser failed:", e);
      return [];
    }
  };

  // latest 10 sheets for the SELECTED USER (based on their groups)
  const fetchUserGroupMap = async () => {
    if (!uniqueUsers.length) {
      setUserGroupMap({});
      return;
    }
    const pairs = await Promise.all(uniqueUsers.map(async (u) => {
      const gids = await getGroupsForUser(u.id);
      const names = gids
        .map((gid) => Array.isArray(groups) && groups.find((g) => Number(g.id) === Number(gid))?.name || String(gid))
        .filter(Boolean);
      return [u.id, names];
    }));
    setUserGroupMap(Object.fromEntries(pairs));
  };

  const fetchUserSheets = async (uid) => {
    if (!uid) { setUserSheets([]); return; }
    try {
      const gids = await getGroupsForUser(uid);
      const agg = [];
      for (const gid of gids) {
        try {
          const res = await axios.get(`${API}/groups/${gid}/sheets`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          // Keep group context on each sheet record
          (res.data || []).forEach((r) => agg.push({ ...r, _group_id: gid }));
        } catch (e) {
          console.error("fetchGroupSheets(for user) failed", e);
        }
      }
      // dedupe by sheet id, sort desc, take latest 10
      const map = new Map();
      agg.forEach((s) => { map.set(String(s.id), s); });
      const uniq = Array.from(map.values()).sort(
        (a, b) => new Date(b.uploaded_at) - new Date(a.uploaded_at)
      );
      setUserSheets(uniq.slice(0, 10));
    } catch (e) {
      console.error("fetchUserSheets failed", e);
      setUserSheets([]);
    }
  };

  const loadUserPermissions = async (uid, sid, reportSourceId = selectedReportSourceId) => {
    if (!uid || !sid) {
      setUserAllowedCols(new Set());
      setUserRowFilters([{ key: "", value: "" }]);
      return;
    }
    const endpoint = reportSourceId ? `${API}/report-source-permissions` : `${API}/permissions`;
    const params = reportSourceId
      ? { userId: uid, reportSourceId }
      : { userId: uid, sheetId: sid };
    const res = await axios.get(endpoint, {
      headers: { Authorization: `Bearer ${token}` },
      params
    });
    const allowed = res.data?.allowed_columns || [];
    const filters = res.data?.row_filters || {};
    setUserAllowedCols(new Set(allowed));
    // Convert object to array of {key, value} pairs
    const filterArray = Object.entries(filters).map(([key, value]) => ({ key, value }));
    setUserRowFilters(filterArray.length > 0 ? filterArray : [{ key: "", value: "" }]);
  };

  // load user sheet headers
  const fetchUserSheetHeaders = async (sid) => {
    if (!sid) { setUserSheetHeaders([]); return; }
    const res = await axios.get(`${API}/sheets/${sid}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const h = res.data?.headers || [];
    setUserSheetHeaders(Array.isArray(h) ? h : []);
  };

  // group perms helpers
  const loadGroupPermissions = async (gid, sid, reportSourceId = selectedReportSourceId) => {
    if (!gid || !sid) {
      setGroupAllowedCols(new Set());
      setGroupRowFilters([{ key: "", value: "" }]);
      return;
    }
    const endpoint = reportSourceId ? `${API}/report-source-group-permissions` : `${API}/group-permissions`;
    const params = reportSourceId
      ? { groupId: gid, reportSourceId }
      : { groupId: gid, sheetId: sid };
    const res = await axios.get(endpoint, {
      headers: { Authorization: `Bearer ${token}` },
      params
    });
    const allowed = res.data?.allowed_columns || [];
    const filters = res.data?.row_filters || {};
    setGroupAllowedCols(new Set(allowed));
    // Convert object to array of {key, value} pairs
    const filterArray = Object.entries(filters).map(([key, value]) => ({ key, value }));
    setGroupRowFilters(filterArray.length > 0 ? filterArray : [{ key: "", value: "" }]);
  };

  const fetchGroupSheetHeaders = async (sid) => {
    if (!sid) { setGroupSheetHeaders([]); return; }
    const res = await axios.get(`${API}/sheets/${sid}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const h = res.data?.headers || [];
    setGroupSheetHeaders(Array.isArray(h) ? h : []);
  };

  useEffect(() => {
    if (token) {
      fetchUsers();
      fetchGroups();
      fetchAllViews();
      fetchReportSources();
      fetchGoogleOauthSetting();
      fetchDropboxOauthSetting();
      fetchOneDriveOauthSetting();
      fetchQuickbooksOauthSetting();
      fetchSamlSetting();
      STORAGE_PROVIDER_DEFS.forEach((provider) => { void fetchStorageSetting(provider); });
      fetchEmailIngestSetting();
      fetchSmtpSetting();
      fetchInviteEmailTemplate();
      fetchInvitationPolicy();
      fetchInsightTranslationCacheSetting();
      fetchDlpSetting();
      fetchMetricsExposureSetting();
      fetchAutosyncIntervalSetting();
      fetchImportPipelineSetting();
      fetchRevisionCompareSetting();
      fetchAiRuntimeSetting();
      fetchAiSelfLearningSetting();
      fetchAiLearningCandidates();
      fetchAiLearningFeedbackPending();
      fetchAiLearningImpact();
      fetchAiUsageSummary();
    }
  }, [token]);

  useEffect(() => {
    try {
      if (Number.isInteger(Number(selectedGroupId)) && Number(selectedGroupId) > 0) {
        localStorage.setItem("admin:selectedGroupId", String(selectedGroupId));
      } else {
        localStorage.removeItem("admin:selectedGroupId");
      }
    } catch {
      // Ignore storage persistence errors in restricted browser contexts.
    }
  }, [selectedGroupId]);

  useEffect(() => {
    if (!token || !canManageIntegrations) return;
    fetchGoogleOauthSetting();
    fetchDropboxOauthSetting();
    fetchOneDriveOauthSetting();
    fetchQuickbooksOauthSetting();
    fetchSamlSetting();
    STORAGE_PROVIDER_DEFS.forEach((provider) => { void fetchStorageSetting(provider); });
    fetchEmailIngestSetting();
    fetchSmtpSetting();
    fetchInviteEmailTemplate();
    fetchInsightTranslationCacheSetting();
    fetchDlpSetting();
    fetchMetricsExposureSetting();
    fetchAutosyncIntervalSetting();
    fetchImportPipelineSetting();
    fetchRevisionCompareSetting();
    fetchAiRuntimeSetting();
    fetchAiSelfLearningSetting();
    fetchAiLearningCandidates();
    fetchAiLearningImpact();
    fetchAiUsageSummary();
  }, [token, canManageIntegrations, selectedGroupId, groups, isSuperAdmin]);

  useEffect(() => {
    if (!token || !isSuperAdmin || !twoFactorSettingsOpen) return;
    fetchTwoFactorTotpSetting();
    fetchSmsOtpSetting();
  }, [token, isSuperAdmin, twoFactorSettingsOpen]);



  const fetchAllViews = async () => {
    try {
      const res = await axios.get(`${API}/views`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setViews(res.data || []);
    } catch (e) {
      console.error("fetchAllViews failed", e);
    }
  };

  const handleDeleteView = async (viewId) => {
    if (!isSuperAdmin || !viewId) return;
    if (!window.confirm("Delete this view?")) return;
    try {
      await axios.delete(`${API}/views/${viewId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      await fetchAllViews();
      if (selectedUserId) await fetchUserViews(selectedUserId);
    } catch (e) {
      console.error("delete view failed", e);
      alert(e?.response?.data?.error || "Failed to delete view");
    }
  };

  const fetchUserViews = async (userId) => {
    if (!userId) return;
    try {
      const res = await axios.get(`${API}/views/user-permissions/${userId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setUserViews(new Set((res.data || []).map((v) => v.id)));
    } catch (e) {
      if (e?.response?.status === 401) {
        setUserViews(new Set());
        return;
      }
      console.error("fetchUserViews failed", e);
      setUserViews(new Set());
    }
  };

  const toggleUserViewPerm = async (viewId) => {
    if (!selectedUserId) return;
    const hasPerm = userViews.has(viewId) || userViews.has(String(viewId)) || userViews.has(Number(viewId));
    try {
      if (hasPerm) {
        await axios.delete(`${API}/views/user-permissions/${viewId}/${selectedUserId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
      } else {
        await axios.post(`${API}/views/user-permissions`, { viewId, userId: selectedUserId }, {
          headers: { Authorization: `Bearer ${token}` },
        });
      }
      fetchUserViews(selectedUserId);
    } catch (e) {
      console.error("toggleUserViewPerm failed", e);
    }
  };

  const syncUserAssignedViews = async (selectedIds) => {
    if (!selectedUserId) return;
    const desired = new Set((selectedIds || []).map((id) => String(id)));
    const current = new Set(Array.from(userViews || []).map((id) => String(id)));
    try {
      for (const id of desired) {
        if (!current.has(id)) {
          await axios.post(`${API}/views/user-permissions`, { viewId: Number(id), userId: selectedUserId }, {
            headers: { Authorization: `Bearer ${token}` },
          });
        }
      }
      for (const id of current) {
        if (!desired.has(id)) {
          await axios.delete(`${API}/views/user-permissions/${id}/${selectedUserId}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
        }
      }
      fetchUserViews(selectedUserId);
    } catch (e) {
      console.error("syncUserAssignedViews failed", e);
      return;
    }
  };

  const fetchSelectedUserGroups = async (uid) => {
    if (!uid) {
      setSelectedUserGroupIds(new Set());
      return;
    }
    const gids = await getGroupsForUser(uid);
    setSelectedUserGroupIds(new Set(gids.map((g) => Number(g))));
  };

  // when user changes, reload their 10 sheets and reset user-perms state
  useEffect(() => {
    if (selectedUserId) {
      fetchUserSheets(selectedUserId);
      fetchUserViews(selectedUserId);
      fetchSelectedUserGroups(selectedUserId);
      setViewAssignmentOpen(true);
      setSelectedUserSheetId(null);
      setSelectedReportSourceId(null);
      setUserSheetHeaders([]);
      setUserAllowedCols(new Set());
      setUserRowFilters([{ key: "", value: "" }]);
      setSelectedTplUser("");
    } else {
      setSelectedUserGroupIds(new Set());
      setViewAssignmentOpen(false);
    }
  }, [selectedUserId]);
  useEffect(() => {
    setDraftUserViewIds(Array.from(userViews || []).map((id) => String(id)));
  }, [userViews, selectedUserId]);
  useEffect(() => {
    fetchUserGroupMap();
  }, [users, groups]);

  // when user sheet changes, load headers and that user's perms for that sheet
  useEffect(() => {
    if (selectedUserSheetId && selectedUserId) {
      fetchUserSheetHeaders(selectedUserSheetId);
    } else {
      setUserSheetHeaders([]);
      setUserAllowedCols(new Set());
      setUserRowFilters([{ key: "", value: "" }]);
    }
  }, [selectedUserSheetId, selectedUserId, selectedReportSourceId]);

  // when group changes, reload members & sheets, reset group-perms state
  useEffect(() => {
    if (selectedGroupId) {
      fetchGroupMembers(selectedGroupId);
      fetchPendingInvitations(selectedGroupId);
      setGroupAllowedCols(new Set());
      setGroupRowFilters([{ key: "", value: "" }]);
      setGroupSheetHeaders([]);
      setSelectedTplGroup("");
    } else {
      setPendingInvitations([]);
    }
  }, [selectedGroupId]);

  // customer overrides use the SAME selected sheet as user overrides
  useEffect(() => {
    if (!selectedUserSheetId || !selectedGroupId) {
      setGroupSheetHeaders([]);
      setGroupAllowedCols(new Set());
      setGroupRowFilters([{ key: "", value: "" }]);
      return;
    }
    fetchGroupSheetHeaders(selectedUserSheetId);
  }, [selectedUserSheetId, selectedGroupId, selectedReportSourceId]);

  const toggleUserAllowed = (h) => {
    setUserAllowedCols(prev => {
      const next = new Set(prev);
      if (next.has(h)) next.delete(h); else next.add(h);
      return next;
    });
  };

  const toggleGroupAllowed = (h) => {
    setGroupAllowedCols(prev => {
      const next = new Set(prev);
      if (next.has(h)) next.delete(h); else next.add(h);
      return next;
    });
  };

  // --- Actions: users ---
  const addUser = async () => {
    if (!String(newUser.firstName || "").trim() || !String(newUser.lastName || "").trim() || !String(newUser.company || "").trim() || !String(newUser.email || "").trim()) {
      alert("First name, last name, company, and email are required.");
      return;
    }
    if (!inviteGroupId) {
      alert("Select a customer before inviting a customer user.");
      return;
    }
    try {
      await axios.post(`${API}/users/invitations`, {
        firstName: newUser.firstName,
        lastName: newUser.lastName,
        company: newUser.company,
        email: newUser.email,
        groupId: Number(inviteGroupId),
      }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      alert("Invitation sent.");
      setNewUser({ firstName: "", lastName: "", company: "", email: "" });
      fetchUsers();
      if (inviteGroupId) fetchPendingInvitations(inviteGroupId);
    } catch (e) {
      alert(e.response?.data?.error || "Failed to invite/create user");
    }
  };

  const openPasswordResetModal = (id, label = "this user") => {
    if (!id) return;
    setPasswordResetModal({
      open: true,
      userId: id,
      label,
      password: "",
      repeat: "",
    });
  };

  const closePasswordResetModal = () => {
    setPasswordResetModal({
      open: false,
      userId: null,
      label: "",
      password: "",
      repeat: "",
    });
  };

  const fillGeneratedResetPassword = () => {
    const password = generateAdminPassword();
    setPasswordResetModal((prev) => ({ ...prev, password, repeat: password }));
  };

  const copyResetPassword = async () => {
    const password = String(passwordResetModal.password || "");
    if (!password) {
      alert("Generate or enter a password first.");
      return;
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(password);
      } else {
        const input = document.createElement("textarea");
        input.value = password;
        input.setAttribute("readonly", "");
        input.style.position = "fixed";
        input.style.opacity = "0";
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        document.body.removeChild(input);
      }
      alert("Password copied.");
    } catch {
      alert("Could not copy password.");
    }
  };

  const submitPasswordReset = async () => {
    const id = passwordResetModal.userId;
    const password = String(passwordResetModal.password || "");
    const repeat = String(passwordResetModal.repeat || "");
    if (!id) return;
    if (password.length < RESET_PASSWORD_LENGTH) {
      alert(`Password must be at least ${RESET_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== repeat) {
      alert("Passwords do not match.");
      return;
    }
    try {
      await axios.patch(`${API}/users/${id}`, { reset: true, password }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      alert("Password reset. The user will be required to change it after login.");
      closePasswordResetModal();
      fetchUsers();
      if (selectedGroupId) fetchGroupMembers(selectedGroupId);
    } catch (e) {
      alert(e.response?.data?.error || "Failed to reset password");
    }
  };

  const changeRole = async (id, role) => {
    await axios.patch(`${API}/users/${id}`, { role }, {
      headers: { Authorization: `Bearer ${token}` },
    });
    fetchUsers();
  };

  const beginEditUser = (u) => {
    setEditingUserId(u.id);
    setEditingUserForm({
      firstName: u.first_name || "",
      lastName: u.last_name || "",
      company: u.company || "",
      email: u.email || "",
    });
  };
  const cancelEditUser = () => {
    setEditingUserId(null);
    setEditingUserForm({ firstName: "", lastName: "", company: "", email: "" });
  };
  const saveEditUser = async (id) => {
    if (!String(editingUserForm.firstName || "").trim() || !String(editingUserForm.lastName || "").trim() || !String(editingUserForm.company || "").trim() || !String(editingUserForm.email || "").trim()) {
      alert("First name, last name, company, and email are required.");
      return;
    }
    try {
      await axios.patch(`${API}/users/${id}`, {
        firstName: editingUserForm.firstName,
        lastName: editingUserForm.lastName,
        company: editingUserForm.company,
        email: editingUserForm.email,
      }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      cancelEditUser();
      fetchUsers();
    } catch (e) {
      alert(e.response?.data?.error || "Failed to update user");
    }
  };
  const toggleUserGroupMembership = async (uid, gid, shouldAdd) => {
    try {
      if (shouldAdd) {
        await axios.post(`${API}/groups/${gid}/users`, { userId: Number(uid) }, {
          headers: { Authorization: `Bearer ${token}` },
        });
      } else {
        await axios.delete(`${API}/groups/${gid}/users/${uid}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
      }
      await fetchSelectedUserGroups(uid);
      await fetchUserGroupMap();
    } catch (e) {
      alert(e.response?.data?.error || "Failed to update customer membership");
    }
  };
  const saveUserPermissions = async () => {
    if (!selectedUserId || !selectedUserSheetId) {
      alert("Pick a user and a report source first.");
      return;
    }
    const allowed_columns = Array.from(userAllowedCols);
    const row_filters = {};
    userRowFilters.forEach(f => {
      if (f.key && f.value) row_filters[f.key] = f.value;
    });
    try {
      const endpoint = selectedReportSourceId ? `${API}/report-source-permissions` : `${API}/permissions`;
      await axios.post(endpoint, {
        ...(selectedReportSourceId ? { reportSourceId: selectedReportSourceId } : { sheetId: selectedUserSheetId }),
        userId: selectedUserId,
        allowed: allowed_columns,
        rowFilters: row_filters,
        allowed_columns,
        row_filters
      }, { headers: { Authorization: `Bearer ${token}` } });
      return true;
    } catch (e) {
      alert(e.response?.data?.error || "Failed to save user permissions");
    }
  };

  // --- Actions: groups ---
  const createGroup = async () => {
    const firstName = String(newCustomerFirstName || "").trim();
    const lastName = String(newCustomerLastName || "").trim();
    const companyName = String(newCustomerCompanyName || "").trim();
    const customerEmail = String(newCustomerEmail || "").trim();
    const customerPhone = String(newCustomerPhone || "").trim();
    if (!firstName || !lastName || !companyName || !customerEmail) {
      alert("Customer first name, last name, company name, and email are required.");
      return;
    }
    try {
      await axios.post(`${API}/groups`, {
        name: companyName,
        customerFirstName: firstName,
        customerLastName: lastName,
        customerCompanyName: companyName,
        customerEmail,
        customerPhone,
      }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setNewGroupName("");
      setNewCustomerFirstName("");
      setNewCustomerLastName("");
      setNewCustomerCompanyName("");
      setNewCustomerEmail("");
      setNewCustomerPhone("");
      fetchGroups();
    } catch (e) {
      alert(e.response?.data?.error || "Failed to create customer");
    }
  };

  const openCreateCustomerForm = () => {
    setCustomerFormMode("create");
    setEditingCustomerId(null);
    setNewCustomerFirstName("");
    setNewCustomerLastName("");
    setNewCustomerCompanyName("");
    setNewCustomerEmail("");
    setNewCustomerPhone("");
    setCustomerFormOpen(true);
  };

  const openEditCustomerForm = (group) => {
    if (!group?.id) return;
    setCustomerFormMode("edit");
    setEditingCustomerId(group.id);
    setNewCustomerFirstName(group.customer_first_name || "Customer");
    setNewCustomerLastName(group.customer_last_name || "Admin");
    setNewCustomerCompanyName(group.customer_company_name || group.name || "Customer Company");
    setNewCustomerEmail(group.customer_email || `customer${group.id}@example.com`);
    setNewCustomerPhone(group.customer_phone || "");
    setCustomerFormOpen(true);
  };

  const saveCustomerForm = async () => {
    const firstName = String(newCustomerFirstName || "").trim();
    const lastName = String(newCustomerLastName || "").trim();
    const companyName = String(newCustomerCompanyName || "").trim();
    const customerEmail = String(newCustomerEmail || "").trim();
    const customerPhone = String(newCustomerPhone || "").trim();
    if (!firstName || !lastName || !companyName || !customerEmail) {
      alert("Customer first name, last name, company name, and email are required.");
      return;
    }
    try {
      const payload = {
        name: companyName,
        customerFirstName: firstName,
        customerLastName: lastName,
        customerCompanyName: companyName,
        customerEmail,
        customerPhone,
      };
      if (customerFormMode === "edit" && editingCustomerId) {
        await axios.patch(`${API}/groups/${editingCustomerId}`, payload, {
          headers: { Authorization: `Bearer ${token}` },
        });
      } else {
        await axios.post(`${API}/groups`, payload, {
          headers: { Authorization: `Bearer ${token}` },
        });
      }
      setCustomerFormOpen(false);
      setEditingCustomerId(null);
      setNewCustomerFirstName("");
      setNewCustomerLastName("");
      setNewCustomerCompanyName("");
      setNewCustomerEmail("");
      setNewCustomerPhone("");
      fetchGroups();
    } catch (e) {
      alert(e.response?.data?.error || "Failed to save customer");
    }
  };

  const updateGroup = async (gid, data) => {
    try {
      await axios.patch(`${API}/groups/${gid}`, data, {
        headers: { Authorization: `Bearer ${token}` },
      });
      fetchGroups();
    } catch (e) {
      alert(e.response?.data?.error || "Failed to update customer");
    }
  };

  const addUserToGroup = async () => {
    if (!selectedGroupId || !groupAddUserId) return;
    try {
      await axios.post(`${API}/groups/${selectedGroupId}/users`, { userId: Number(groupAddUserId) }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setGroupAddUserId("");
      fetchGroupMembers(selectedGroupId);
    } catch (e) {
      alert(e.response?.data?.error || "Failed to add user to customer");
    }
  };

  const removeUserFromGroup = async (uid) => {
    if (!selectedGroupId) return;
    if (!window.confirm("Remove this user from the selected customer?")) return;
    try {
      await axios.delete(`${API}/groups/${selectedGroupId}/users/${uid}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      fetchGroupMembers(selectedGroupId);
    } catch (e) {
      alert(e.response?.data?.error || "Failed to remove user from customer");
    }
  };

  const toggleGroupAdmin = async (uid, isAdmin) => {
    if (!selectedGroupId) return;
    try {
      await axios.post(`${API}/groups/${selectedGroupId}/users/${uid}/admin`, { isAdmin: !isAdmin }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      fetchGroupMembers(selectedGroupId);
    } catch (e) {
      alert(e.response?.data?.error || "Failed to toggle customer admin");
    }
  };

  const saveGroupPermissions = async () => {
    if (!selectedGroupId || !selectedUserSheetId) {
      alert("Pick a customer and a report source first.");
      return;
    }
    const allowed_columns = Array.from(groupAllowedCols);
    // Convert filter array to object, filtering out empty entries
    const row_filters = {};
    groupRowFilters.forEach(f => {
      if (f.key && f.value) row_filters[f.key] = f.value;
    });
    const endpoint = selectedReportSourceId ? `${API}/report-source-group-permissions` : `${API}/group-permissions`;
    await axios.post(endpoint, {
      ...(selectedReportSourceId ? { reportSourceId: selectedReportSourceId } : { sheetId: selectedUserSheetId }),
      groupId: selectedGroupId,
      allowed: allowed_columns,
      rowFilters: row_filters,
      allowed_columns,
      row_filters
    }, { headers: { Authorization: `Bearer ${token}` } });
    return true;
  };

  // NEW: delete group (with confirm) from Groups panel
  const deleteGroup = async (gid) => {
    if (!gid) return;
    if (!confirm("Delete this customer and its memberships/permissions?")) return;
    try {
      await axios.delete(`${API}/groups/${gid}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (Number(selectedGroupId) === Number(gid)) {
        setSelectedGroupId(null);
        setGroupMembers([]);
        setGroupAllowedCols(new Set());
        setGroupRowFilters([{ key: "", value: "" }]);
        setGroupSheetHeaders([]);
        setSelectedTplGroup("");
      }
      fetchGroups();
    } catch (e) {
      console.error("delete customer failed", e);
      alert(e.response?.data?.message || e.response?.data?.error || "❌ Could not delete customer");
    }
  };

  /** ---------------------------
   * Template: create / apply / delete
   * (scoped per group)
   * --------------------------- */
  const makeTemplate = (name, columns, row_filters, groupId) => ({
    id: Date.now().toString(36),
    name: String(name || "").trim(),
    columns: Array.from(new Set(columns || [])),
    row_filters: row_filters && typeof row_filters === "object" ? row_filters : {},
    groupId: Number.isInteger(groupId) ? groupId : null,
    created_at: new Date().toISOString()
  });

  // Determine current groupId for selected user sheet
  const currentUserSheetGroupId = useMemo(() => {
    if (!selectedUserSheetId) return null;
    const s = userSheets.find(ss => String(ss.id) === String(selectedUserSheetId));
    return s?._group_id ?? null;
  }, [selectedUserSheetId, userSheets]);

  // Visible templates (filtered by group) for user panel
  const visibleUserTemplates = useMemo(() => {
    if (!currentUserSheetGroupId) return [];
    return (templates || []).filter(t => t.groupId === currentUserSheetGroupId);
  }, [templates, currentUserSheetGroupId]);

  // Visible templates (filtered by group) for group panel
  const visibleGroupTemplates = useMemo(() => {
    if (!selectedGroupId) return [];
    return (templates || []).filter(t => t.groupId === selectedGroupId);
  }, [templates, selectedGroupId]);

  // User panel: save template
  const handleSaveTemplateFromUser = () => {
    if (!newTplNameUser.trim()) { alert("Enter template name"); return; }
    if (!currentUserSheetGroupId) { alert("Select a sheet (with customer) first"); return; }
    const tpl = makeTemplate(
      newTplNameUser,
      Array.from(userAllowedCols),
      // Convert filter array to object
      Object.fromEntries(userRowFilters.filter(f => f.key && f.value).map(f => [f.key, f.value])),
      currentUserSheetGroupId
    );
    const next = [tpl, ...templates];
    setTemplates(next);
    saveTemplates(next);
    setNewTplNameUser("");
    return true;
  };

  const handleApplyTemplateToUser = (tplId) => {
    setSelectedTplUser(tplId);
    const tpl = templates.find(t => t.id === tplId);
    if (!tpl) return;
    // Intersect template columns with CURRENT sheet headers
    const cols = (tpl.columns || []).filter(c => userSheetHeaders.includes(c));
    setUserAllowedCols(new Set(cols));
    // Convert template filters object to array
    const filterArray = Object.entries(tpl.row_filters || {}).map(([key, value]) => ({ key, value }));
    setUserRowFilters(filterArray.length > 0 ? filterArray : [{ key: "", value: "" }]);
  };

  const handleDeleteTemplate = (tplId) => {
    const next = templates.filter(t => t.id !== tplId);
    setTemplates(next);
    saveTemplates(next);
    if (selectedTplUser === tplId) setSelectedTplUser("");
    if (selectedTplGroup === tplId) setSelectedTplGroup("");
  };

  // Group panel: save template
  const handleSaveTemplateFromGroup = () => {
    if (!newTplNameGroup.trim()) { alert("Enter template name"); return; }
    if (!selectedGroupId) { alert("Select a customer first"); return; }
    const tpl = makeTemplate(
      newTplNameGroup,
      Array.from(groupAllowedCols),
      // Convert filter array to object
      Object.fromEntries(groupRowFilters.filter(f => f.key && f.value).map(f => [f.key, f.value])),
      selectedGroupId
    );
    const next = [tpl, ...templates];
    setTemplates(next);
    saveTemplates(next);
    setNewTplNameGroup("");
    return true;
  };

  const handleApplyTemplateToGroup = (tplId) => {
    setSelectedTplGroup(tplId);
    const tpl = templates.find(t => t.id === tplId);
    if (!tpl) return;
    // Intersect template columns with CURRENT sheet headers
    const cols = (tpl.columns || []).filter(c => groupSheetHeaders.includes(c));
    setGroupAllowedCols(new Set(cols));
    // Convert template filters object to array
    const filterArray = Object.entries(tpl.row_filters || {}).map(([key, value]) => ({ key, value }));
    setGroupRowFilters(filterArray.length > 0 ? filterArray : [{ key: "", value: "" }]);
  };

  // Auto re-apply selected template after switching sheets (user scope)
  useEffect(() => {
    if (!selectedUserSheetId || !selectedTplUser) return;
    const tpl = templates.find(t => t.id === selectedTplUser);
    if (!tpl) return;
    const cols = (tpl.columns || []).filter(c => userSheetHeaders.includes(c));
    setUserAllowedCols(new Set(cols));
    // Convert template filters object to array
    const filterArray = Object.entries(tpl.row_filters || {}).map(([key, value]) => ({ key, value }));
    setUserRowFilters(filterArray.length > 0 ? filterArray : [{ key: "", value: "" }]);
  }, [selectedUserSheetId, selectedTplUser, userSheetHeaders, templates]);

  // Auto re-apply selected template after switching sheets (group scope)
  useEffect(() => {
    if (!selectedUserSheetId || !selectedTplGroup) return;
    const tpl = templates.find(t => t.id === selectedTplGroup);
    if (!tpl) return;
    const cols = (tpl.columns || []).filter(c => groupSheetHeaders.includes(c));
    setGroupAllowedCols(new Set(cols));
    // Convert template filters object to array
    const filterArray = Object.entries(tpl.row_filters || {}).map(([key, value]) => ({ key, value }));
    setGroupRowFilters(filterArray.length > 0 ? filterArray : [{ key: "", value: "" }]);
  }, [selectedUserSheetId, selectedTplGroup, groupSheetHeaders, templates]);

  const reportSourceOptions = useMemo(() => {
    return (reportSources || [])
      .filter((source) => source && !source.is_inferred && source.current_sheet_id)
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  }, [reportSources]);
  const reviewSourceOptions = useMemo(() => {
    return (reportSources || [])
      .filter((source) => source && !source.is_inferred && source.id)
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  }, [reportSources]);
  const selectedReportSource = useMemo(() => {
    return reportSourceOptions.find((source) => String(source.id) === String(selectedReportSourceId)) || null;
  }, [reportSourceOptions, selectedReportSourceId]);
  const isSplitScreenView = (view) => {
    const cfg = (view && typeof view.config === "string")
      ? (() => { try { return JSON.parse(view.config); } catch { return {}; } })()
      : (view?.config || {});
    return !!cfg?.splitContext?.secondarySheetId;
  };
  const selectReportSourceForPermissions = (value) => {
    const source = reportSourceOptions.find((item) => String(item.id) === String(value));
    setSelectedReportSourceId(source ? String(source.id) : null);
    setSelectedUserSheetId(source?.current_sheet_id || null);
  };

  const authBadgeClass = (provider) => (
    provider === "google"
      ? "bg-blue-50 text-blue-700 border-blue-200"
      : "bg-slate-50 text-slate-600 border-slate-200"
  );

  const canManageGroupAdmins = useMemo(() => {
    if (user?.role === "admin") return true;
    return uniqueGroupMembers.some((m) => Number(m.id) === Number(user?.id) && !!m.is_admin);
  }, [user, uniqueGroupMembers]);
  const selectedGroup = useMemo(
    () => (Array.isArray(groups) ? groups.find((g) => Number(g.id) === Number(selectedGroupId)) : null),
    [groups, selectedGroupId]
  );
  const reportSourcesForDeletion = useMemo(() => {
    const all = Array.isArray(reviewSourceOptions) ? reviewSourceOptions : [];
    const gid = Number.parseInt(String(selectedGroupId || ""), 10);
    if (!Number.isInteger(gid) || gid <= 0) return all;
    const scoped = all.filter((source) => Number(source?.sync_group_id) === gid);
    return scoped.length ? scoped : all;
  }, [reviewSourceOptions, selectedGroupId]);
  const inviteGroupId = useMemo(() => {
    if (Number.isInteger(Number(selectedGroupId)) && Number(selectedGroupId) > 0) return Number(selectedGroupId);
    if (!isSuperAdmin && Array.isArray(groups) && groups.length === 1) return Number(groups[0].id);
    return null;
  }, [selectedGroupId, groups, isSuperAdmin]);
  const selectedGroupEntitlements = useMemo(
    () => normalizeGroupEntitlements(selectedGroup?.entitlements || {}),
    [selectedGroup]
  );
  useEffect(() => {
    if (!selectedGroup) {
      setGroupSettingsDraft(null);
      setGroupSettingsDirty(false);
      lastLoadedGroupIdRef.current = null;
      return;
    }
    const selectedId = Number(selectedGroup.id);
    const sameGroup = Number(lastLoadedGroupIdRef.current) === selectedId;
    if (sameGroup && groupSettingsDirty) return;
    const ent = normalizeGroupEntitlements(selectedGroup.entitlements || {});
    const bundleTier = BUNDLE_KEYS.includes(String(ent.bundleTier || "").toLowerCase())
      ? String(ent.bundleTier || "").toLowerCase()
      : "";
    const bundleFeatureSets = ensureBundleFeatureSets(ent.bundleFeatureSets, ent.features || {});
    const activeFeatures = bundleTier ? (bundleFeatureSets[bundleTier] || ent.features || {}) : (ent.features || {});
    const bundleCapacityLimits = ensureBundleCapacityLimits(ent.bundleCapacityLimits, {
      maxUsers: ent.maxUsers ?? "",
      maxReportSources: ent.maxReportSources ?? "",
    });
    const activeCapacityLimits = bundleTier ? (bundleCapacityLimits[bundleTier] || {}) : {
      maxUsers: ent.maxUsers ?? "",
      maxReportSources: ent.maxReportSources ?? "",
    };
    setGroupSettingsDraft({
      maxFileSizeMb: String(selectedGroup.max_file_size_mb || 100),
      maxTotalStorageMb: String(selectedGroup.max_total_storage_mb || 10240),
      maxUsers: activeCapacityLimits.maxUsers ?? "",
      maxReportSources: activeCapacityLimits.maxReportSources ?? "",
      maxAiQueriesPerMonth: ent.maxAiQueriesPerMonth ?? "",
      aiMonthlyBudgetUsd: ent.aiMonthlyBudgetUsd ?? "",
      maxImportParseMemoryMb: ent.maxImportParseMemoryMb ?? "",
      bundleTier,
      bundleFeatureSets,
      bundleCapacityLimits,
      features: { ...activeFeatures },
    });
    setSelectedProductBundle(bundleTier);
    setGroupSettingsDirty(false);
    lastLoadedGroupIdRef.current = selectedId;
  }, [selectedGroup, groupSettingsDirty]);

  const updateGroupSettingsDraft = (patch) => {
    setGroupSettingsDirty(true);
    setGroupSettingsDraft((prev) => {
      const current = prev || {
        maxFileSizeMb: "",
        maxTotalStorageMb: "",
        maxUsers: "",
        maxReportSources: "",
        maxAiQueriesPerMonth: "",
        aiMonthlyBudgetUsd: "",
        maxImportParseMemoryMb: "",
        bundleTier: "",
        bundleFeatureSets: {},
        bundleCapacityLimits: {},
        features: {},
      };
      return {
        ...current,
        ...patch,
        bundleFeatureSets: {
          ...(current.bundleFeatureSets || {}),
          ...(patch.bundleFeatureSets || {}),
        },
        bundleCapacityLimits: {
          ...(current.bundleCapacityLimits || {}),
          ...(patch.bundleCapacityLimits || {}),
        },
        features: {
          ...(current.features || {}),
          ...(patch.features || {}),
        },
      };
    });
  };

  const saveGroupSettings = async () => {
    if (!selectedGroupId || (!isSuperAdmin && user?.role !== "admin") || !groupSettingsDraft || groupSettingsSaving) return;
    setGroupSettingsSaved(false);
    setGroupSettingsSaving(true);
    try {
      const maxFileSizeMb = Number.parseInt(String(groupSettingsDraft.maxFileSizeMb || "").trim(), 10);
      const maxTotalStorageMb = Number.parseInt(String(groupSettingsDraft.maxTotalStorageMb || "").trim(), 10);
      const draftBundleTier = BUNDLE_KEYS.includes(String(groupSettingsDraft.bundleTier || "").toLowerCase())
        ? String(groupSettingsDraft.bundleTier || "").toLowerCase()
        : "";
      const bundleCapacityLimits = ensureBundleCapacityLimits(groupSettingsDraft.bundleCapacityLimits, {
        maxUsers: groupSettingsDraft.maxUsers ?? "",
        maxReportSources: groupSettingsDraft.maxReportSources ?? "",
      });
      const activeCapacityLimits = draftBundleTier ? (bundleCapacityLimits[draftBundleTier] || {}) : {
        maxUsers: groupSettingsDraft.maxUsers ?? "",
        maxReportSources: groupSettingsDraft.maxReportSources ?? "",
      };
      const entitlements = normalizeGroupEntitlements({
        ...selectedGroupEntitlements,
        maxUsers: activeCapacityLimits.maxUsers === "" ? null : Number(activeCapacityLimits.maxUsers),
        maxReportSources: activeCapacityLimits.maxReportSources === "" ? null : Number(activeCapacityLimits.maxReportSources),
        maxAiQueriesPerMonth: groupSettingsDraft.maxAiQueriesPerMonth === "" ? null : Number(groupSettingsDraft.maxAiQueriesPerMonth),
        aiMonthlyBudgetUsd: groupSettingsDraft.aiMonthlyBudgetUsd === "" ? null : Number(groupSettingsDraft.aiMonthlyBudgetUsd),
        maxImportParseMemoryMb: groupSettingsDraft.maxImportParseMemoryMb === "" ? null : Number(groupSettingsDraft.maxImportParseMemoryMb),
        bundleTier: draftBundleTier || null,
        bundleFeatureSets: ensureBundleFeatureSets(
          groupSettingsDraft.bundleFeatureSets,
          groupSettingsDraft.features || {}
        ),
        bundleCapacityLimits,
        features: { ...(groupSettingsDraft.features || {}) },
      });
      const saveRes = await axios.patch(`${API}/groups/${selectedGroupId}`, {
        maxFileSizeMb: Number.isInteger(maxFileSizeMb) && maxFileSizeMb > 0 ? maxFileSizeMb : 100,
        maxTotalStorageMb: Number.isInteger(maxTotalStorageMb) && maxTotalStorageMb > 0 ? maxTotalStorageMb : 10240,
        entitlements,
      }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const savedGroup = saveRes?.data || {};
      const savedEntitlements = normalizeGroupEntitlements(savedGroup?.entitlements || entitlements);
      const savedBundleTier = BUNDLE_KEYS.includes(String(savedEntitlements.bundleTier || "").toLowerCase())
        ? String(savedEntitlements.bundleTier || "").toLowerCase()
        : "";
      const savedBundleFeatureSets = ensureBundleFeatureSets(
        savedEntitlements.bundleFeatureSets,
        savedEntitlements.features || {}
      );
      const savedBundleCapacityLimits = ensureBundleCapacityLimits(savedEntitlements.bundleCapacityLimits, {
        maxUsers: savedEntitlements.maxUsers ?? "",
        maxReportSources: savedEntitlements.maxReportSources ?? "",
      });
      const savedActiveCapacityLimits = savedBundleTier ? (savedBundleCapacityLimits[savedBundleTier] || {}) : {
        maxUsers: savedEntitlements.maxUsers ?? "",
        maxReportSources: savedEntitlements.maxReportSources ?? "",
      };
      const savedActiveFeatures = savedBundleTier
        ? (savedBundleFeatureSets[savedBundleTier] || savedEntitlements.features || {})
        : (savedEntitlements.features || {});
      setGroups((prev) => (Array.isArray(prev) ? prev.map((g) => (
        Number(g?.id) === Number(selectedGroupId)
          ? {
              ...g,
              ...savedGroup,
              entitlements: savedEntitlements,
            }
          : g
      )) : prev));
      setGroupSettingsDraft((prev) => prev ? {
        ...prev,
        maxFileSizeMb: String(savedGroup?.max_file_size_mb || (Number.isInteger(maxFileSizeMb) && maxFileSizeMb > 0 ? maxFileSizeMb : 100)),
        maxTotalStorageMb: String(savedGroup?.max_total_storage_mb || (Number.isInteger(maxTotalStorageMb) && maxTotalStorageMb > 0 ? maxTotalStorageMb : 10240)),
        maxUsers: savedActiveCapacityLimits.maxUsers ?? "",
        maxReportSources: savedActiveCapacityLimits.maxReportSources ?? "",
        maxAiQueriesPerMonth: savedEntitlements.maxAiQueriesPerMonth ?? "",
        aiMonthlyBudgetUsd: savedEntitlements.aiMonthlyBudgetUsd ?? "",
        maxImportParseMemoryMb: savedEntitlements.maxImportParseMemoryMb ?? "",
        bundleTier: savedBundleTier,
        bundleFeatureSets: savedBundleFeatureSets,
        bundleCapacityLimits: savedBundleCapacityLimits,
        features: { ...savedActiveFeatures },
      } : prev);
      setSelectedProductBundle(savedBundleTier);
      setGroupSettingsDirty(false);
      lastLoadedGroupIdRef.current = Number(selectedGroupId);
      await fetchGroups();
      setGroupSettingsSaved(true);
      setTimeout(() => setGroupSettingsSaved(false), 1800);
    } catch (e) {
      alert(e.response?.data?.error || "Failed to save customer settings");
    } finally {
      setGroupSettingsSaving(false);
    }
  };
  const [collapsedSections, setCollapsedSections] = useState({
    users: false,
    groups: false,
    integrations: false,
    permissions: true,
  });
  const toggleSection = (key) => {
    setCollapsedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };
  const formatBytes = (bytes) => {
    const n = Number(bytes || 0);
    if (!Number.isFinite(n) || n <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let v = n;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024;
      i += 1;
    }
    return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
  };
  const formatMb = (mb) => formatBytes(Number(mb || 0) * 1024 * 1024);
  const displayNameFromEmail = (email) => {
    const local = String(email || "").split("@")[0] || "";
    return local
      .replace(/[._-]+/g, " ")
      .trim()
      .replace(/\b\w/g, (c) => c.toUpperCase()) || "User";
  };
  const displayNameForUser = (u) => {
    const full = [String(u?.first_name || "").trim(), String(u?.last_name || "").trim()].filter(Boolean).join(" ");
    return full || displayNameFromEmail(u?.email);
  };
  useEffect(() => {
    if (selectedUserId || selectedGroupId) {
      setCollapsedSections((prev) => ({ ...prev, permissions: false }));
    } else {
      setCollapsedSections((prev) => ({ ...prev, permissions: true }));
      setSelectedUserSheetId(null);
    }
  }, [selectedUserId, selectedGroupId]);

  return (
    <div className="admin-modern admin-compact p-4 lg:p-5 bg-slate-100 min-h-full overflow-auto">
      <div className="max-w-7xl mx-auto space-y-4">
      <div className="px-1 py-1 text-slate-100">
        <div className="rounded-sm bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Administration Console</h2>
            <p className="text-sm text-slate-300 mt-1">Manage identity, customers, storage boundaries, and data permissions.</p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="rounded-md border border-slate-600 bg-slate-800 px-2.5 py-1 font-medium">Users {users.length}</span>
            <span className="rounded-md border border-slate-600 bg-slate-800 px-2.5 py-1 font-medium">Customers {groups.length}</span>
            <span className="rounded-md border border-slate-600 bg-slate-800 px-2.5 py-1 font-medium">Sources {reportSourceOptions.length}</span>
          </div>
        </div>
      </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
      {/* 1. USERS PANEL */}
      <section className="lg:col-span-5 flex flex-col">
        <div className="flex items-center justify-between mb-4 border-b border-slate-300 pb-2">
          <h3 className="font-semibold text-base text-slate-900">User Management</h3>
          <div className="flex items-center gap-2">
            <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600">{users.length} total</span>
            <button className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50" onClick={() => toggleSection("users")}>
              {collapsedSections.users ? "Expand" : "Collapse"}
            </button>
          </div>
        </div>
        {!collapsedSections.users && (
        <>

        {/* Quick Add User */}
        <div className="flex flex-col gap-4 mb-6 bg-slate-50 p-4 rounded-md border border-slate-200">
          <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 ml-1">Create User</label>
          <div className="grid grid-cols-2 gap-2">
            <input
              className="input-premium"
              placeholder="First name"
              value={newUser.firstName}
              onChange={e => setNewUser({ ...newUser, firstName: e.target.value })}
            />
            <input
              className="input-premium"
              placeholder="Last name"
              value={newUser.lastName}
              onChange={e => setNewUser({ ...newUser, lastName: e.target.value })}
            />
          </div>
          <input
            className="input-premium"
            placeholder="Company"
            value={newUser.company}
            onChange={e => setNewUser({ ...newUser, company: e.target.value })}
          />
          <input
            className="input-premium"
            placeholder="Email address"
            value={newUser.email}
            onChange={e => setNewUser({ ...newUser, email: e.target.value })}
          />
          <div className="flex items-center gap-3">
            <div className="min-w-[180px] text-[10px] font-semibold text-slate-500 truncate px-1">
              {(Array.isArray(groups) && groups.find((g) => Number(g.id) === Number(inviteGroupId))?.name) || (isSuperAdmin ? "Select customer below" : "Customer")}
            </div>
            <button
              className="btn-premium bg-slate-900 hover:bg-slate-800 text-white flex-1 py-2.5 shadow-sm"
              onClick={addUser}
            >
              Send Customer Invitation
            </button>
          </div>
        </div>

        <div className="mt-5 rounded-md border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-500">Customer Management</div>
            <span className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600">{groups.length} total</span>
          </div>
          <div className="mb-3 flex justify-end">
            <button className="btn-premium bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-1.5 text-[11px]" onClick={openCreateCustomerForm}>New Customer</button>
          </div>
          <div className="space-y-2 max-h-48 overflow-auto pr-1 custom-scrollbar">
            {groups.map(g => (
              <div key={g.id} className={`group flex items-center justify-between p-3 rounded-md border cursor-pointer ${selectedGroupId === g.id ? "bg-emerald-600 border-emerald-600 text-white" : "bg-white border-slate-200 hover:bg-slate-50"}`} onClick={() => setSelectedGroupId((prev) => (prev === g.id ? null : g.id))}>
                <div className="min-w-0 flex items-center gap-3">
                  <div className="text-xs font-semibold truncate">{g.name}</div>
                  <div className={`text-[10px] whitespace-nowrap ${selectedGroupId === g.id ? "text-emerald-100" : "text-slate-500"}`}>
                    {formatBytes(g.used_storage_bytes)} / {formatMb(g.max_total_storage_mb || 10240)} total
                  </div>
                </div>
                {isSuperAdmin && (
                  <div className="flex items-center gap-1">
                    <button className={`text-xs px-2 py-1 rounded ${selectedGroupId === g.id ? "hover:bg-white/20" : "hover:bg-slate-100 text-slate-600 hover:text-slate-900"}`} onClick={(e) => { e.stopPropagation(); openEditCustomerForm(g); }}>Edit</button>
                    <button className={`text-xs px-2 py-1 rounded ${selectedGroupId === g.id ? "hover:bg-white/20" : "hover:bg-red-50 text-slate-500 hover:text-red-500"}`} onClick={(e) => { e.stopPropagation(); deleteGroup(g.id); }}>Delete</button>
                  </div>
                )}
              </div>
            ))}
          </div>
          {selectedGroupId && (
            <div className="mt-3 rounded-md border border-slate-200 bg-white p-3">
              <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 mb-2">
                Customer Users: {(Array.isArray(groups) && groups.find((g) => Number(g.id) === Number(selectedGroupId))?.name) || selectedGroupId}
              </div>
              <div className="flex gap-2 mb-2">
                <select
                  className="input-premium py-1.5 text-[11px] font-semibold flex-1"
                  value={groupAddUserId}
                  onChange={(e) => setGroupAddUserId(e.target.value)}
                >
                  <option value="">Select user…</option>
                  {uniqueUsers
                    .filter((u) => !uniqueGroupMembers.some((m) => String(m.id) === String(u.id)))
                    .map((u) => (
                      <option key={String(u.id)} value={u.id}>
                        {u.email} ({u.auth_provider === "google" ? "Google" : "Local"})
                      </option>
                    ))}
                </select>
                <button className="btn-premium bg-slate-800 text-white px-2.5 py-1.5 text-[11px] font-semibold" onClick={addUserToGroup}>Add</button>
              </div>
              <div className="space-y-1.5 max-h-36 overflow-auto pr-1 custom-scrollbar">
                {uniqueGroupMembers.map((m) => {
                  const full = uniqueUsers.find((u) => Number(u.id) === Number(m.id)) || m;
                  return (
                    <div
                      key={String(m.id)}
                      className={`flex items-center justify-between p-1.5 rounded-md border cursor-pointer ${Number(selectedUserId) === Number(m.id) ? "border-indigo-400 bg-indigo-50" : "border-slate-200"}`}
                      onClick={() => setSelectedUserId((prev) => (Number(prev) === Number(m.id) ? null : Number(m.id)))}
                    >
                    <div className="flex items-center gap-2 min-w-0 flex-1 pr-3">
                        <span className="text-[11px] font-semibold text-slate-700 truncate">{displayNameForUser(full)}</span>
                        <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded border ${authBadgeClass(m.auth_provider)}`}>
                          {m.auth_provider === "google" ? "Google" : "Local"}
                        </span>
                        {m.is_admin && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded border border-emerald-200 text-emerald-700 bg-emerald-50">Admin</span>}
                      </div>
                      <div className="flex items-center gap-0.5 shrink-0">
                        <button
                          className="gm-action-btn h-[14px] min-w-[28px] px-1 leading-none text-[5px] font-semibold rounded-sm border border-slate-300 text-slate-600 hover:bg-slate-100"
                          onClick={(e) => {
                            e.stopPropagation();
                            beginEditUser(full);
                          }}
                        >
                          Edit
                        </button>
                        <button
                          className="gm-action-btn h-[14px] min-w-[30px] px-1 leading-none text-[5px] font-semibold rounded-sm border border-amber-200 text-amber-700 hover:bg-amber-50"
                          onClick={(e) => {
                            e.stopPropagation();
                            openPasswordResetModal(m.id, displayNameForUser(full));
                          }}
                        >
                          Reset
                        </button>
                        {canManageGroupAdmins && (
                          <button
                            className="gm-action-btn h-[14px] min-w-[34px] px-1 leading-none text-[5px] font-semibold rounded-sm border border-slate-300 text-slate-600 hover:bg-slate-100"
                            onClick={(e) => { e.stopPropagation(); toggleGroupAdmin(m.id, m.is_admin); }}
                          >
                            {m.is_admin ? "Unadmin" : "Admin"}
                          </button>
                        )}
                        <button
                          className="gm-action-btn h-[14px] min-w-[30px] px-1 leading-none text-[5px] font-semibold rounded-sm border border-red-200 text-red-600 hover:bg-red-50"
                          onClick={(e) => { e.stopPropagation(); removeUserFromGroup(m.id); }}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  );
                })}
                {!uniqueGroupMembers.length && <div className="text-[10px] text-slate-400 italic">No users in this customer.</div>}
              </div>
              <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-2.5">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-500">Pending Invitations</div>
                  <button
                    type="button"
                    className="text-[10px] font-semibold text-slate-600 hover:text-slate-900"
                    onClick={() => fetchPendingInvitations(selectedGroupId)}
                  >
                    Refresh
                  </button>
                </div>
                {invitationsLoading ? (
                  <div className="text-[10px] text-slate-500">Loading invitations...</div>
                ) : pendingInvitations.length ? (
                  <div className="space-y-1.5 max-h-36 overflow-auto pr-1 custom-scrollbar">
                    {pendingInvitations.map((inv) => (
                      <div key={inv.id} className="flex items-center justify-between rounded-md border border-slate-200 bg-white p-1.5">
                        <div className="min-w-0 pr-2">
                          <div className="text-[11px] font-semibold text-slate-700 truncate">{inv.email}</div>
                          <div className="text-[9px] text-slate-500">
                            Expires {inv.expires_at ? new Date(inv.expires_at).toLocaleString() : "-"}
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            className={`text-[9px] font-semibold px-1.5 py-1 rounded border border-slate-300 text-slate-600 hover:bg-slate-100 ${inviteActionBusyId ? "opacity-60 cursor-not-allowed" : ""}`}
                            disabled={!!inviteActionBusyId}
                            onClick={() => resendInvitation(inv.id)}
                          >
                            {inviteActionBusyId === `resend:${inv.id}` ? "Resending..." : "Resend"}
                          </button>
                          <button
                            type="button"
                            className={`text-[9px] font-semibold px-1.5 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50 ${inviteActionBusyId ? "opacity-60 cursor-not-allowed" : ""}`}
                            disabled={!!inviteActionBusyId}
                            onClick={() => revokeInvitation(inv.id)}
                          >
                            {inviteActionBusyId === `revoke:${inv.id}` ? "Revoking..." : "Revoke"}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-[10px] text-slate-400 italic">No pending invitations.</div>
                )}
              </div>
              <div className="mt-3 rounded-md border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-200">
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold text-slate-800">View Assignment</div>
                    <div className="text-[10px] text-slate-500 truncate">
                      {(Array.isArray(groups) && groups.find(g => g.id === selectedGroupId)?.name) || selectedGroupId || "-"}
                    </div>
                  </div>
                  <button
                    type="button"
                    className={`rounded-md border px-2.5 py-1 text-[10px] font-semibold ${selectedUserId ? "border-slate-300 text-slate-700 hover:bg-slate-50" : "border-slate-200 text-slate-400 cursor-not-allowed"}`}
                    disabled={!selectedUserId}
                    onClick={() => setViewAssignmentOpen((prev) => !prev)}
                  >
                    {viewAssignmentOpen ? "Collapse" : "Expand"}
                  </button>
                </div>
                {viewAssignmentOpen ? (
                  <div className="p-3 space-y-3 bg-slate-50">
                    <div className="rounded-md border border-slate-200 bg-white p-3 space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-600">User Assigned Views</div>
                        <div className="text-[10px] text-slate-500 truncate">
                          {selectedUserId ? (userById instanceof Map ? (userById.get(selectedUserId)?.email || selectedUserId) : selectedUserId) : "Select a user above"}
                        </div>
                      </div>
                      {selectedUserId ? (
                        Array.isArray(views) && views.length ? (
                          <>
                            <select
                              multiple
                              className="input-premium h-36 py-1.5 text-[11px] leading-5"
                              value={draftUserViewIds}
                              onChange={(e) => {
                                const ids = Array.from(e.target.selectedOptions).map((opt) => opt.value);
                                setDraftUserViewIds(ids);
                              }}
                            >
                              {views.map((v) => (
                                <option key={`u-opt-${v.id}`} value={String(v.id)}>
                                  {v.name}{isSplitScreenView(v) ? " (split screen)" : ""}
                                </option>
                              ))}
                            </select>
                            <div className="flex items-center justify-end gap-2 pt-1">
                              <button
                                type="button"
                                className={`rounded-md px-3 py-1.5 text-[11px] font-semibold text-white ${viewAssignmentSaved ? "bg-emerald-600 hover:bg-emerald-600" : "bg-slate-900 hover:bg-slate-800"} ${viewAssignmentSaving ? "opacity-60 cursor-not-allowed" : ""}`}
                                disabled={viewAssignmentSaving}
                                onClick={async () => {
                                  if (!selectedUserId) return;
                                  setViewAssignmentSaving(true);
                                  setViewAssignmentSaved(false);
                                  try {
                                    await syncUserAssignedViews(draftUserViewIds);
                                    setViewAssignmentSaved(true);
                                    setTimeout(() => setViewAssignmentSaved(false), 1800);
                                  } catch {
                                    alert("Failed to save user assigned views");
                                  } finally {
                                    setViewAssignmentSaving(false);
                                  }
                                }}
                              >
                                {viewAssignmentSaving ? "Saving..." : viewAssignmentSaved ? "Saved" : "Save"}
                              </button>
                            </div>
                          </>
                        ) : <div className="text-[10px] text-slate-400 italic">No existing views found.</div>
                      ) : (
                        <div className="text-[10px] text-slate-400 italic">Pick a user in this customer to assign views.</div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="px-3 py-2.5 text-[10px] text-slate-400 italic bg-slate-50">
                    {selectedUserId ? "View assignment is collapsed." : "Select a user to manage view assignment."}
                  </div>
                )}
              </div>
              {editingUserId && (
                <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 space-y-2">
                  <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-500">Edit Selected User</div>
                  <div className="grid grid-cols-2 gap-2">
                    <input className="input-premium py-1.5 text-[11px] font-semibold" placeholder="First name" value={editingUserForm.firstName} onChange={(e) => setEditingUserForm((p) => ({ ...p, firstName: e.target.value }))} />
                    <input className="input-premium py-1.5 text-[11px] font-semibold" placeholder="Last name" value={editingUserForm.lastName} onChange={(e) => setEditingUserForm((p) => ({ ...p, lastName: e.target.value }))} />
                  </div>
                  <input className="input-premium py-1.5 text-[11px] font-semibold" placeholder="Company" value={editingUserForm.company} onChange={(e) => setEditingUserForm((p) => ({ ...p, company: e.target.value }))} />
                  <input className="input-premium py-1.5 text-[11px] font-semibold" placeholder="Email" value={editingUserForm.email} onChange={(e) => setEditingUserForm((p) => ({ ...p, email: e.target.value }))} />
                  <div className="flex justify-end gap-2">
                    <button className="px-2.5 py-1 text-[10px] font-semibold rounded-md border border-slate-300 text-slate-600 hover:bg-slate-100" onClick={cancelEditUser}>Cancel</button>
                    <button className="px-2.5 py-1 text-[10px] font-semibold rounded-md bg-slate-900 text-white hover:bg-slate-800" onClick={() => saveEditUser(editingUserId)}>Save</button>
                  </div>
                </div>
              )}
              {isSuperAdmin && (
                <div className="mt-3 grid grid-cols-2 gap-2 items-center">
                  <label className="text-[10px] font-semibold text-slate-500">Per File Limit (MB)</label>
                  <input
                    type="number"
                    className="input-premium py-1.5"
                    value={groupSettingsDraft?.maxFileSizeMb ?? ""}
                    onChange={(e) => updateGroupSettingsDraft({ maxFileSizeMb: e.target.value })}
                  />
                  <label className="text-[10px] font-semibold text-slate-500">Total Storage (MB)</label>
                  <input
                    type="number"
                    className="input-premium py-1.5"
                    value={groupSettingsDraft?.maxTotalStorageMb ?? ""}
                    onChange={(e) => updateGroupSettingsDraft({ maxTotalStorageMb: e.target.value })}
                  />
                  <label className="text-[10px] font-semibold text-slate-500">AI Queries / Month</label>
                  <input
                    type="number"
                    className="input-premium py-1.5"
                    value={groupSettingsDraft?.maxAiQueriesPerMonth ?? ""}
                    placeholder="Unlimited"
                    onChange={(e) => updateGroupSettingsDraft({ maxAiQueriesPerMonth: e.target.value })}
                  />
                  <label className="text-[10px] font-semibold text-slate-500">AI Budget / Month ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    className="input-premium py-1.5"
                    value={groupSettingsDraft?.aiMonthlyBudgetUsd ?? ""}
                    placeholder="Unlimited"
                    onChange={(e) => updateGroupSettingsDraft({ aiMonthlyBudgetUsd: e.target.value })}
                  />
                  <label className="text-[10px] font-semibold text-slate-500">Import Parse Memory (MB)</label>
                  <input
                    type="number"
                    min="64"
                    className="input-premium py-1.5"
                    value={groupSettingsDraft?.maxImportParseMemoryMb ?? ""}
                    placeholder="Default"
                    onChange={(e) => updateGroupSettingsDraft({ maxImportParseMemoryMb: e.target.value })}
                  />
                  <div className="col-span-2 mt-2 rounded-md border border-slate-200 bg-white p-2">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-2">Product Bundle</div>
                    <div className="grid grid-cols-3 gap-2 mb-3">
                      {PRODUCT_BUNDLES.map((bundle) => (
                        <button
                          key={bundle.key}
                          type="button"
                          onClick={() => {
                            setSelectedProductBundle(bundle.key);
                            setGroupSettingsDirty(true);
                            setGroupSettingsDraft((prev) => {
                              const current = prev || {};
                              const currentFeatures = { ...(current.features || {}) };
                              const currentSets = ensureBundleFeatureSets(current.bundleFeatureSets, currentFeatures);
                              const currentCapacity = {
                                maxUsers: current.maxUsers ?? "",
                                maxReportSources: current.maxReportSources ?? "",
                              };
                              const currentCapacitySets = ensureBundleCapacityLimits(current.bundleCapacityLimits, currentCapacity);
                              const nextSets = {
                                ...currentSets,
                                ...(current.bundleTier ? { [current.bundleTier]: { ...currentFeatures } } : {}),
                              };
                              const nextCapacitySets = {
                                ...currentCapacitySets,
                                ...(current.bundleTier ? { [current.bundleTier]: { ...currentCapacity } } : {}),
                              };
                              const targetFeatures = { ...(nextSets[bundle.key] || currentFeatures) };
                              const aiLimits = BUNDLE_AI_LIMITS[bundle.key] || {};
                              const targetCapacity = nextCapacitySets[bundle.key] || currentCapacity;
                              const aiPricing = BUNDLE_AI_PRICING[bundle.key] || {};
                              setAiRuntimeSettings((prevRuntime) => ({
                                ...prevRuntime,
                                ...(aiPricing.openaiModel ? { openaiModel: aiPricing.openaiModel } : {}),
                                ...(Number.isFinite(aiPricing.openaiInputCostPer1M) ? { openaiInputCostPer1M: aiPricing.openaiInputCostPer1M } : {}),
                                ...(Number.isFinite(aiPricing.openaiOutputCostPer1M) ? { openaiOutputCostPer1M: aiPricing.openaiOutputCostPer1M } : {}),
                              }));
                              return {
                                ...current,
                                bundleTier: bundle.key,
                                bundleFeatureSets: nextSets,
                                bundleCapacityLimits: nextCapacitySets,
                                features: targetFeatures,
                                maxUsers: targetCapacity.maxUsers ?? "",
                                maxReportSources: targetCapacity.maxReportSources ?? "",
                                maxAiQueriesPerMonth: aiLimits.maxAiQueriesPerMonth ?? current.maxAiQueriesPerMonth ?? "",
                                aiMonthlyBudgetUsd: aiLimits.aiMonthlyBudgetUsd ?? current.aiMonthlyBudgetUsd ?? "",
                              };
                            });
                          }}
                          className={`rounded-md border px-2 py-1.5 text-left ${selectedProductBundle === bundle.key ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
                        >
                          <div className="text-[10px] font-semibold uppercase tracking-wide">{bundle.label}</div>
                          <div className={`text-[10px] ${selectedProductBundle === bundle.key ? "text-slate-200" : "text-slate-500"}`}>{bundle.description}</div>
                        </button>
                      ))}
                    </div>
                    {selectedProductBundle && (
                      <div className="mb-3 rounded-md border border-slate-200 bg-slate-50 p-2">
                        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                          {PRODUCT_BUNDLES.find((bundle) => bundle.key === selectedProductBundle)?.label || "Bundle"} Limits
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <label className="text-[10px] font-semibold text-slate-500">
                            Max Users
                            <input
                              type="number"
                              className="input-premium mt-1 py-1.5"
                              value={groupSettingsDraft?.maxUsers ?? ""}
                              placeholder="Unlimited"
                              onChange={(e) => {
                                const value = e.target.value;
                                setGroupSettingsDirty(true);
                                setGroupSettingsDraft((prev) => {
                                  const current = prev || {};
                                  const bundleTier = String(current.bundleTier || selectedProductBundle || "");
                                  const currentCapacity = {
                                    maxUsers: value,
                                    maxReportSources: current.maxReportSources ?? "",
                                  };
                                  return {
                                    ...current,
                                    maxUsers: value,
                                    bundleCapacityLimits: {
                                      ...(current.bundleCapacityLimits || {}),
                                      ...(BUNDLE_KEYS.includes(bundleTier) ? { [bundleTier]: currentCapacity } : {}),
                                    },
                                  };
                                });
                              }}
                            />
                          </label>
                          <label className="text-[10px] font-semibold text-slate-500">
                            Max Sources
                            <input
                              type="number"
                              className="input-premium mt-1 py-1.5"
                              value={groupSettingsDraft?.maxReportSources ?? ""}
                              placeholder="Unlimited"
                              onChange={(e) => {
                                const value = e.target.value;
                                setGroupSettingsDirty(true);
                                setGroupSettingsDraft((prev) => {
                                  const current = prev || {};
                                  const bundleTier = String(current.bundleTier || selectedProductBundle || "");
                                  const currentCapacity = {
                                    maxUsers: current.maxUsers ?? "",
                                    maxReportSources: value,
                                  };
                                  return {
                                    ...current,
                                    maxReportSources: value,
                                    bundleCapacityLimits: {
                                      ...(current.bundleCapacityLimits || {}),
                                      ...(BUNDLE_KEYS.includes(bundleTier) ? { [bundleTier]: currentCapacity } : {}),
                                    },
                                  };
                                });
                              }}
                            />
                          </label>
                        </div>
                      </div>
                    )}
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-2">Customer Features</div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {CUSTOMER_FEATURE_OPTIONS.map(([key, label]) => (
                        <label key={key} className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-600">
                          <input
                            type="checkbox"
                            checked={groupSettingsDraft?.features?.[key] !== false}
                            onChange={(e) => setGroupSettingsDraft((prev) => {
                              const current = prev || {};
                              const nextFeatures = {
                                ...(current.features || {}),
                                [key]: e.target.checked,
                              };
                              const nextBundleTier = String(current.bundleTier || "");
                              const nextSets = ensureBundleFeatureSets(current.bundleFeatureSets, nextFeatures);
                              if (BUNDLE_KEYS.includes(nextBundleTier)) {
                                nextSets[nextBundleTier] = { ...nextFeatures };
                              }
                              setGroupSettingsDirty(true);
                              return {
                                ...current,
                                features: nextFeatures,
                                bundleFeatureSets: nextSets,
                              };
                            })}
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={saveGroupSettings}
                      disabled={groupSettingsSaving}
                      className={`mt-3 btn-premium text-white w-full py-2 ${groupSettingsSaved ? "bg-emerald-600 hover:bg-emerald-600" : "bg-slate-800"} ${groupSettingsSaving ? "opacity-60 cursor-not-allowed" : ""}`}
                    >
                      {groupSettingsSaving ? "Saving..." : groupSettingsSaved ? "Saved" : "Save Customer Settings"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        {isSuperAdmin && (
          <div className="mt-5 rounded-md border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-500">System Settings</div>
              <span className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600">Super Admin</span>
            </div>
            <div className="rounded-md border border-slate-200 bg-white p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">2FA Configuration</div>
                <button
                  type="button"
                  className="text-[10px] font-semibold text-slate-600 hover:text-slate-900"
                  onClick={() => setTwoFactorSettingsOpen((prev) => !prev)}
                >
                  {twoFactorSettingsOpen ? "Collapse" : "Expand"}
                </button>
              </div>
              {twoFactorSettingsOpen && (
                <>
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-2 space-y-2">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">TOTP</div>
                    <div className="text-[10px] text-slate-500">
                      Set the two TOTP values used by authenticator apps:
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Code Digits</label>
                        <input
                          className="input-premium py-1.5 text-[11px] font-semibold"
                          type="number"
                          min="6"
                          max="8"
                          placeholder="6"
                          value={twoFactorTotpSettings.digits}
                          onChange={(e) => setTwoFactorTotpSettings((prev) => ({ ...prev, digits: e.target.value }))}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Period (Seconds)</label>
                        <input
                          className="input-premium py-1.5 text-[11px] font-semibold"
                          type="number"
                          min="15"
                          max="120"
                          placeholder="30"
                          value={twoFactorTotpSettings.period}
                          onChange={(e) => setTwoFactorTotpSettings((prev) => ({ ...prev, period: e.target.value }))}
                        />
                      </div>
                    </div>
                    <div className="text-[10px] text-slate-500">
                      Issuer is used as the app label: <span className="font-semibold text-slate-700">{twoFactorTotpSettings.issuer || "TFORN Insights"}</span>
                    </div>
                    <button
                      type="button"
                      onClick={saveTwoFactorTotpSetting}
                      disabled={twoFactorTotpSaving}
                      className={`btn-premium text-white w-full py-1.5 text-[11px] ${twoFactorTotpSaved ? "bg-emerald-600 hover:bg-emerald-600" : "bg-slate-800"} ${twoFactorTotpSaving ? "opacity-60 cursor-not-allowed" : ""}`}
                    >
                      {twoFactorTotpSaving ? "Saving..." : twoFactorTotpSaved ? "Saved" : "Save TOTP Settings"}
                    </button>
                  </div>
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-2 space-y-2">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">SMS OTP (Twilio)</div>
                    <label className="inline-flex items-center gap-2 text-[11px] font-semibold text-slate-700">
                      <input
                        type="checkbox"
                        checked={smsOtpSettings.enabled !== false}
                        onChange={(e) => setSmsOtpSettings((prev) => ({ ...prev, enabled: e.target.checked }))}
                      />
                      Enabled
                    </label>
                    <input
                      className="input-premium py-1.5 text-[11px] font-semibold"
                      placeholder="Twilio Account SID"
                      value={smsOtpSettings.accountSid}
                      onChange={(e) => setSmsOtpSettings((prev) => ({ ...prev, accountSid: e.target.value }))}
                    />
                    <input
                      type="password"
                      className="input-premium py-1.5 text-[11px] font-semibold"
                      placeholder={smsOtpSettings.hasAuthToken ? "***" : "Twilio Auth Token"}
                      value={smsOtpSettings.authToken}
                      onChange={(e) => setSmsOtpSettings((prev) => ({ ...prev, authToken: e.target.value }))}
                      autoComplete="new-password"
                    />
                    <input
                      className="input-premium py-1.5 text-[11px] font-semibold"
                      placeholder="From Number (+15551234567)"
                      value={smsOtpSettings.fromNumber}
                      onChange={(e) => setSmsOtpSettings((prev) => ({ ...prev, fromNumber: e.target.value }))}
                    />
                    <input
                      className="input-premium py-1.5 text-[11px] font-semibold"
                      placeholder="Messaging Service SID (optional)"
                      value={smsOtpSettings.messagingServiceSid}
                      onChange={(e) => setSmsOtpSettings((prev) => ({ ...prev, messagingServiceSid: e.target.value }))}
                    />
                    <button
                      type="button"
                      onClick={saveSmsOtpSetting}
                      disabled={smsOtpSaving}
                      className={`btn-premium text-white w-full py-1.5 text-[11px] ${smsOtpSaved ? "bg-emerald-600 hover:bg-emerald-600" : "bg-slate-800"} ${smsOtpSaving ? "opacity-60 cursor-not-allowed" : ""}`}
                    >
                      {smsOtpSaving ? "Saving..." : smsOtpSaved ? "Saved" : "Save SMS OTP Settings"}
                    </button>
                  </div>
                </>
              )}
            </div>
            <div className="rounded-md border border-slate-200 bg-white p-3 space-y-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">AI Self-Learning</div>
              <div className="text-[10px] text-slate-500">Capture chat feedback and apply only admin-approved learning rules.</div>
              <label className="inline-flex items-center gap-2 text-[11px] font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={aiSelfLearningSettings.enabled === true}
                  onChange={(e) => setAiSelfLearningSettings((prev) => ({ ...prev, enabled: e.target.checked }))}
                />
                Enabled
              </label>
              <label className="inline-flex items-center gap-2 pl-6 text-[11px] font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={aiSelfLearningSettings.autoApplyApprovedRules !== false}
                  onChange={(e) => setAiSelfLearningSettings((prev) => ({ ...prev, autoApplyApprovedRules: e.target.checked }))}
                />
                Auto-apply approved rules
              </label>
              <label className="inline-flex items-center gap-2 pl-6 text-[11px] font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={aiSelfLearningSettings.autoApproveAllCandidates === true}
                  onChange={(e) => setAiSelfLearningSettings((prev) => ({ ...prev, autoApproveAllCandidates: e.target.checked }))}
                />
                Approve all candidates by default
              </label>
              <div className="space-y-1">
                <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Minimum Confidence</label>
                <input
                  className="input-premium py-1.5 text-[11px] font-semibold"
                  type="number"
                  min="0"
                  max="1"
                  step="0.01"
                  value={aiSelfLearningSettings.minConfidence}
                  onChange={(e) => setAiSelfLearningSettings((prev) => ({ ...prev, minConfidence: e.target.value }))}
                />
              </div>
              <button
                type="button"
                onClick={saveAiSelfLearningSetting}
                disabled={aiSelfLearningSaving}
                className={`btn-premium text-white w-full py-1.5 text-[11px] ${aiSelfLearningSaved ? "bg-emerald-600 hover:bg-emerald-600" : "bg-slate-800"} ${aiSelfLearningSaving ? "opacity-60 cursor-not-allowed" : ""}`}
              >
                {aiSelfLearningSaving ? "Saving..." : aiSelfLearningSaved ? "Saved" : "Save AI Self-Learning Settings"}
              </button>
              <div className="rounded-md border border-slate-200 bg-slate-50 p-2 space-y-2">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Learning Impact (Last {aiLearningImpact.days || 30} Days)</div>
                {(aiLearningImpact.intents || []).slice(0, 6).map((row) => {
                  const total = Number(row?.total || 0);
                  const ok = Number(row?.ok_count || 0);
                  const okRate = total > 0 ? ((ok / total) * 100).toFixed(1) : "0.0";
                  return (
                    <div key={`${row?.detected_intent || "unknown"}-${total}`} className="flex items-center justify-between text-[10px]">
                      <span className="font-semibold text-slate-700">{String(row?.detected_intent || "unknown")}</span>
                      <span className="text-slate-500">ok {ok}/{total} ({okRate}%)</span>
                    </div>
                  );
                })}
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 p-2 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Pending Learning Feedback</div>
                  <button
                    type="button"
                    onClick={fetchAiLearningFeedbackPending}
                    className="text-[10px] font-semibold text-slate-600 hover:text-slate-900"
                  >
                    Refresh
                  </button>
                </div>
                {aiLearningCandidatesLoading && <div className="text-[10px] text-slate-500">Loading…</div>}
                {!aiLearningCandidatesLoading && (aiLearningFeedbackPending || []).slice(0, 12).map((item) => (
                  <div key={`feedback-${item.id}`} className="rounded border border-slate-200 bg-white p-2 space-y-1">
                    <div className="text-[10px] font-semibold text-slate-700">{item.question}</div>
                    <div className="text-[10px] text-slate-500">expected: {item.expected_answer}</div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => reviewAiLearningFeedback(item.id, "approve")}
                        disabled={aiLearningReviewBusyId === `fb-${item.id}`}
                        className={`px-2 py-1 rounded text-[10px] font-semibold ${aiLearningReviewBusyId === `fb-${item.id}` ? "bg-slate-300 text-slate-500" : "bg-emerald-600 text-white hover:bg-emerald-700"}`}
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => reviewAiLearningFeedback(item.id, "reject")}
                        disabled={aiLearningReviewBusyId === `fb-${item.id}`}
                        className={`px-2 py-1 rounded text-[10px] font-semibold ${aiLearningReviewBusyId === `fb-${item.id}` ? "bg-slate-300 text-slate-500" : "bg-slate-700 text-white hover:bg-slate-800"}`}
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
                {!aiLearningCandidatesLoading && (!aiLearningFeedbackPending || aiLearningFeedbackPending.length === 0) && (
                  <div className="text-[10px] text-slate-500">No pending feedback.</div>
                )}
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 p-2 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Pending Learning Candidates</div>
                  <button
                    type="button"
                    onClick={fetchAiLearningCandidates}
                    className="text-[10px] font-semibold text-slate-600 hover:text-slate-900"
                  >
                    Refresh
                  </button>
                </div>
                {aiLearningCandidatesLoading && <div className="text-[10px] text-slate-500">Loading…</div>}
                {!aiLearningCandidatesLoading && (aiLearningCandidates || []).slice(0, 12).map((item) => (
                  <div key={item.id} className="rounded border border-slate-200 bg-white p-2 space-y-1">
                    <div className="text-[10px] font-semibold text-slate-700">{item.phrase}</div>
                    <div className="text-[10px] text-slate-500">intent: {item.suggested_intent} • evidence: {item.evidence_count}</div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => reviewAiLearningCandidate(item.id, "approve")}
                        disabled={aiLearningReviewBusyId === item.id}
                        className={`px-2 py-1 rounded text-[10px] font-semibold ${aiLearningReviewBusyId === item.id ? "bg-slate-300 text-slate-500" : "bg-emerald-600 text-white hover:bg-emerald-700"}`}
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => reviewAiLearningCandidate(item.id, "reject")}
                        disabled={aiLearningReviewBusyId === item.id}
                        className={`px-2 py-1 rounded text-[10px] font-semibold ${aiLearningReviewBusyId === item.id ? "bg-slate-300 text-slate-500" : "bg-slate-700 text-white hover:bg-slate-800"}`}
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
                {!aiLearningCandidatesLoading && (!aiLearningCandidates || aiLearningCandidates.length === 0) && (
                  <div className="text-[10px] text-slate-500">No pending candidates.</div>
                )}
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 p-2 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Recently Approved Learning</div>
                  <button
                    type="button"
                    onClick={() => setAiLearningApprovedOpen((prev) => !prev)}
                    className="text-[10px] font-semibold text-slate-600 hover:text-slate-900"
                  >
                    {aiLearningApprovedOpen ? "Collapse" : "Expand"}
                  </button>
                </div>
                {aiLearningApprovedOpen && (
                  <>
                    {aiLearningCandidatesLoading && <div className="text-[10px] text-slate-500">Loading…</div>}
                    {!aiLearningCandidatesLoading && (aiLearningApprovedCandidates || []).slice(0, 12).map((item) => (
                      <div key={`approved-${item.id}`} className="text-[10px] text-emerald-800">
                        • <span className="font-semibold">{item.phrase}</span>
                        <span className="text-emerald-700"> — {item.suggested_intent} (evidence {item.evidence_count})</span>
                      </div>
                    ))}
                    {!aiLearningCandidatesLoading && (!aiLearningApprovedCandidates || aiLearningApprovedCandidates.length === 0) && (
                      <div className="text-[10px] text-slate-500">No approved learning yet.</div>
                    )}
                  </>
                )}
              </div>
            </div>
            <div className="rounded-md border border-slate-200 bg-white p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Metrics Exposure</div>
                <button
                  type="button"
                  onClick={() => saveMetricsExposureSetting(!(metricsExposure.enabled === true))}
                  disabled={metricsExposureSaving}
                  className={`btn-premium min-w-[84px] h-7 rounded-md px-3 text-[10px] font-semibold ${metricsExposure.enabled === true ? "bg-emerald-600 text-white hover:bg-emerald-700" : "bg-slate-200 text-slate-700 hover:bg-slate-300"} ${metricsExposureSaving ? "opacity-60 cursor-not-allowed" : ""}`}
                >
                  {metricsExposureSaving ? "Saving..." : (metricsExposure.enabled === true ? "ON" : "OFF")}
                </button>
              </div>
              {metricsExposure.enabled === true && (
                <div className="text-[10px] text-slate-500">
                  Metrics URL: <span className="font-semibold text-slate-700">{metricsUrl}</span>
                </div>
              )}
            </div>
            <div className="rounded-md border border-slate-200 bg-white p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">DLP Rules</div>
                  <span className={`text-[10px] font-semibold ${dlpSettings.enabled === false ? "text-red-600" : dlpSettings.configured ? "text-emerald-600" : "text-slate-400"}`}>
                    {dlpSettings.enabled === false ? "Disabled" : dlpSettings.configured ? "Configured" : "Not configured"}
                  </span>
                </div>
                <button
                  type="button"
                  className="text-[10px] font-semibold text-slate-600 hover:text-slate-900"
                  onClick={() => setDlpSettingsOpen((prev) => !prev)}
                >
                  {dlpSettingsOpen ? "Collapse" : "Expand"}
                </button>
              </div>
              {dlpSettingsOpen && (
                <>
                  <label className="inline-flex items-center gap-2 text-[11px] font-semibold text-slate-700 border border-slate-200 rounded-md px-2 py-1">
                    <input
                      type="checkbox"
                      checked={dlpSettings.enabled !== false}
                      onChange={(e) => setDlpSettings((prev) => ({ ...prev, enabled: e.target.checked }))}
                    />
                    DLP Enabled
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {["block", "warn", "mask"].map((mode) => (
                      <label key={mode} className="inline-flex items-center gap-2 text-[10px] font-semibold text-slate-700 border border-slate-200 rounded-md px-2 py-1">
                        <input
                          type="radio"
                          name="dlp-mode"
                          checked={dlpSettings.mode === mode}
                          onChange={() => setDlpSettings((prev) => ({ ...prev, mode }))}
                        />
                        {mode.toUpperCase()}
                      </label>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="inline-flex items-center gap-2 text-[11px] font-semibold text-slate-700">
                      <input type="checkbox" checked={dlpSettings.checkSsn !== false} onChange={(e) => setDlpSettings((prev) => ({ ...prev, checkSsn: e.target.checked }))} />
                      Detect SSN
                    </label>
                    <label className="inline-flex items-center gap-2 text-[11px] font-semibold text-slate-700">
                      <input type="checkbox" checked={dlpSettings.checkCreditCard !== false} onChange={(e) => setDlpSettings((prev) => ({ ...prev, checkCreditCard: e.target.checked }))} />
                      Detect Credit Cards
                    </label>
                    <label className="inline-flex items-center gap-2 text-[11px] font-semibold text-slate-700">
                      <input type="checkbox" checked={dlpSettings.checkEmail !== false} onChange={(e) => setDlpSettings((prev) => ({ ...prev, checkEmail: e.target.checked }))} />
                      Detect Email
                    </label>
                    <label className="inline-flex items-center gap-2 text-[11px] font-semibold text-slate-700">
                      <input type="checkbox" checked={dlpSettings.checkPhone !== false} onChange={(e) => setDlpSettings((prev) => ({ ...prev, checkPhone: e.target.checked }))} />
                      Detect Phone
                    </label>
                    <label className="inline-flex items-center gap-2 text-[11px] font-semibold text-slate-700">
                      <input type="checkbox" checked={dlpSettings.checkIban !== false} onChange={(e) => setDlpSettings((prev) => ({ ...prev, checkIban: e.target.checked }))} />
                      Detect IBAN
                    </label>
                  </div>
                  <button
                    type="button"
                    onClick={saveDlpSetting}
                    disabled={dlpSettingsSaving}
                    className={`btn-premium text-white w-full py-1.5 text-[11px] ${dlpSettingsSaved ? "bg-emerald-600 hover:bg-emerald-600" : "bg-slate-800"} ${dlpSettingsSaving ? "opacity-60 cursor-not-allowed" : ""}`}
                  >
                    {dlpSettingsSaving ? "Saving..." : dlpSettingsSaved ? "Saved" : "Save DLP Settings"}
                  </button>
                </>
              )}
            </div>
            <div className="rounded-md border border-slate-200 bg-white p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">SMTP Configuration</div>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-semibold ${smtpMeta.host && smtpMeta.username && smtpMeta.hasPassword ? "text-emerald-600" : "text-slate-400"}`}>
                    {smtpMeta.host && smtpMeta.username && smtpMeta.hasPassword ? "Configured" : "Not configured"}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSmtpSettingsOpen((prev) => !prev)}
                    className="text-[10px] font-semibold text-slate-600 hover:text-slate-900"
                  >
                    {smtpSettingsOpen ? "Collapse" : "Expand"}
                  </button>
                </div>
              </div>
              {smtpSettingsOpen && (
                <>
                  <input className="input-premium py-1.5 text-[11px] font-semibold" placeholder="SMTP Host" value={smtpForm.host} onChange={(e) => setSmtpForm((prev) => ({ ...prev, host: e.target.value }))} />
                  <div className="grid grid-cols-2 gap-2">
                    <input className="input-premium py-1.5 text-[11px] font-semibold" type="number" min="1" placeholder="Port" value={smtpForm.port} onChange={(e) => setSmtpForm((prev) => ({ ...prev, port: e.target.value }))} />
                    <label className="inline-flex items-center gap-2 text-[11px] font-semibold text-slate-700 px-2 py-1 rounded-md border border-slate-200">
                      <input type="checkbox" checked={!!smtpForm.secure} onChange={(e) => setSmtpForm((prev) => ({ ...prev, secure: e.target.checked }))} />
                      Use TLS
                    </label>
                  </div>
                  <input className="input-premium py-1.5 text-[11px] font-semibold" placeholder="SMTP Username" value={smtpForm.username} onChange={(e) => setSmtpForm((prev) => ({ ...prev, username: e.target.value }))} />
                  <input type="password" className="input-premium py-1.5 text-[11px] font-semibold" placeholder={smtpMeta.hasPassword ? "***" : "SMTP Password"} value={smtpForm.password} onChange={(e) => setSmtpForm((prev) => ({ ...prev, password: e.target.value }))} autoComplete="new-password" />
                  <input className="input-premium py-1.5 text-[11px] font-semibold" placeholder="From Email" value={smtpForm.fromEmail} onChange={(e) => setSmtpForm((prev) => ({ ...prev, fromEmail: e.target.value }))} />
                  <input className="input-premium py-1.5 text-[11px] font-semibold" placeholder="From Name" value={smtpForm.fromName} onChange={(e) => setSmtpForm((prev) => ({ ...prev, fromName: e.target.value }))} />
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-[11px] text-slate-600">
                    <a
                      className="text-blue-700 hover:underline"
                      href="https://support.google.com/a/answer/176600?hl=en"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Google SMTP server documentation
                    </a>
                  </div>
                  <button
                    type="button"
                    onClick={saveSmtpSetting}
                    disabled={smtpSaving}
                    className={`btn-premium text-white w-full py-1.5 text-[11px] ${smtpSaved ? "bg-emerald-600 hover:bg-emerald-600" : "bg-slate-800"} ${smtpSaving ? "opacity-60 cursor-not-allowed" : ""}`}
                  >
                    {smtpSaving ? "Saving..." : smtpSaved ? "Saved" : "Save SMTP Settings"}
                  </button>
                </>
              )}
            </div>
            <div className="rounded-md border border-slate-200 bg-white p-3 space-y-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Insight Translation Cache</div>
              <input
                className="input-premium py-1.5 text-[11px] font-semibold"
                type="number"
                min="1"
                max="1440"
                placeholder="TTL Minutes"
                value={insightTranslationCache.ttlMinutes}
                onChange={(e) => setInsightTranslationCache((prev) => ({ ...prev, ttlMinutes: e.target.value }))}
              />
              <div className="text-[10px] text-slate-500">
                Cache translated insight-feed ticket text for this many minutes. Manual Refresh in Insight Feed bypasses cache.
              </div>
              <button
                type="button"
                onClick={saveInsightTranslationCacheSetting}
                disabled={insightTranslationCacheSaving}
                className={`btn-premium text-white w-full py-1.5 text-[11px] ${insightTranslationCacheSaved ? "bg-emerald-600 hover:bg-emerald-600" : "bg-slate-800"} ${insightTranslationCacheSaving ? "opacity-60 cursor-not-allowed" : ""}`}
              >
                {insightTranslationCacheSaving ? "Saving..." : insightTranslationCacheSaved ? "Saved" : "Save Insight Cache Settings"}
              </button>
            </div>
          </div>
        )}
        </>
        )}
      </section>

      {/* 2. CUSTOMERS PANEL */}
      <div className="hidden xl:col-span-3 rounded-md border border-slate-300 bg-white p-5 md:p-6 h-full flex flex-col shadow-sm">
        <div className="flex items-center justify-between mb-6 border-b border-slate-200 pb-4">
          <h3 className="font-semibold text-lg text-slate-900 flex items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-slate-900 text-[10px] font-bold text-white">02</span>
            Customers
          </h3>
          <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600">{groups.length} total</span>
        </div>
        <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 mb-4">Customer User Management</div>

        {selectedGroupId && (
          <div className="mb-6 bg-slate-50 p-4 rounded-md border border-slate-200 animate-in fade-in zoom-in duration-300">
            <h4 className="font-bold text-xs text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>Customer Settings</h4>

            {isSuperAdmin && (
              <div className="mb-6 space-y-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Max File Size (MB)</label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    className="input-premium py-2 w-24"
                    key={selectedGroupId}
                    defaultValue={groups.find(g => g.id === selectedGroupId)?.max_file_size_mb || 100}
                    onBlur={(e) => {
                      const val = parseInt(e.target.value, 10);
                      if (!isNaN(val)) {
                        if (window.confirm(`Update limit to ${val}MB?`)) {
                          updateGroup(selectedGroupId, { maxFileSizeMb: val });
                        }
                      }
                    }}
                  />
                  <span className="text-xs text-slate-400 self-center font-bold">MB</span>
                </div>
              </div>
            )}

            <div className="space-y-4">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Manage Members</label>
              <div className="flex gap-2">
                <select
                  className="input-premium py-2 flex-1"
                  value={groupAddUserId}
                  onChange={e => setGroupAddUserId(e.target.value)}
                >
                  <option value="">Select user…</option>
                  {uniqueUsers
                    .filter(u => !uniqueGroupMembers.some(m => String(m.id) === String(u.id)))
                    .map(u => (
                      <option key={String(u.id)} value={u.id}>
                        {u.email} ({u.auth_provider === "google" ? "Google" : "Local"})
                      </option>
                    ))
                  }
                </select>
                <button
                  className="btn-premium bg-slate-800 text-white px-4 py-2"
                  onClick={addUserToGroup}
                >
                  Add
                </button>
              </div>

              <div className="space-y-2 max-h-32 overflow-auto pr-1 custom-scrollbar">
                {uniqueGroupMembers.map(m => (
                  <div key={String(m.id)} className="group flex items-center justify-between p-3 rounded-md bg-white border border-slate-200 hover:bg-white transition-all">
                    <div className="flex items-center gap-2 overflow-hidden">
                      <div className="text-xs font-bold text-slate-700 truncate max-w-[120px]">{m.email}</div>
                      <div className={`text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border ${authBadgeClass(m.auth_provider)}`}>
                        {m.auth_provider === "google" ? "Google" : "Manual"}
                      </div>
                      {m.is_admin && (
                        <div className="text-[8px] font-black text-amber-500 uppercase tracking-widest bg-amber-50 px-1.5 py-0.5 rounded-md border border-amber-100">Admin</div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {canManageGroupAdmins && (
                        <button
                          onClick={() => toggleGroupAdmin(m.id, m.is_admin)}
                          className={`p-1.5 rounded-lg transition-all ${
                            m.is_admin
                              ? "text-amber-500 hover:bg-amber-50"
                              : "text-slate-300 hover:text-amber-500 hover:bg-indigo-50"
                          }`}
                          title={m.is_admin ? "Remove Customer Admin" : "Make Customer Admin"}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill={m.is_admin ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                        </button>
                      )}
                      <button
                        className="p-1.5 text-slate-300 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
                        onClick={() => openPasswordResetModal(m.id, m.email || "this user")}
                        title="Reset password"
                      >
                        Reset
                      </button>
                      <button
                        className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                        onClick={() => removeUserFromGroup(m.id)}
                        title="Remove from customer"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                      </button>
                    </div>
                  </div>
                ))}
                {!uniqueGroupMembers.length && <div className="text-[10px] text-slate-400 italic text-center p-2">No members yet</div>}
              </div>
            </div>
          </div>
        )}

        <div className="mb-8 flex justify-end">
          <button
            className="btn-premium bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-1.5 text-[11px] shadow-sm"
            onClick={openCreateCustomerForm}
          >
            New Customer
          </button>
        </div>

        <div className="space-y-3 overflow-auto pr-2 custom-scrollbar flex-1 mb-6">
          {groups.map(g => (
            <div
              key={g.id}
              className={`group flex items-center justify-between p-4 rounded-md border transition-all cursor-pointer ${
                selectedGroupId === g.id
                  ? "bg-emerald-600 border-emerald-600 text-white shadow-sm translate-x-1"
                  : "bg-white border-slate-200 hover:border-emerald-300 hover:bg-slate-50"
              }`}
              onClick={() => setSelectedGroupId((prev) => (prev === g.id ? null : g.id))}
            >
              <div className="min-w-0">
                <div className={`font-bold text-sm truncate max-w-[140px] ${selectedGroupId === g.id ? "text-white" : "text-slate-900"}`}>{g.name}</div>
                <div className="flex gap-2 items-center mt-0.5">
                  <div className={`text-[10px] uppercase tracking-widest font-bold ${selectedGroupId === g.id ? "text-emerald-100" : "text-slate-400"}`}>ID: {g.id}</div>
                  <div className={`text-[10px] uppercase tracking-widest font-bold border-l pl-2 ${selectedGroupId === g.id ? "border-white/20 text-emerald-100" : "border-slate-100 text-emerald-400"}`}>Limit: {g.max_file_size_mb || 100}MB</div>
                </div>
              </div>
              {isSuperAdmin && (
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                  <button
                    className={`text-[10px] font-semibold px-2 py-1 rounded ${
                      selectedGroupId === g.id ? "hover:bg-white/20 text-white" : "text-slate-600 hover:bg-slate-100"
                    }`}
                    title="Edit customer"
                    onClick={(e) => { e.stopPropagation(); openEditCustomerForm(g); }}
                  >
                    Edit
                  </button>
                  <button
                    className={`p-2 rounded-lg transition-colors ${
                      selectedGroupId === g.id ? "hover:bg-white/20 text-white" : "hover:bg-red-50 text-slate-400 hover:text-red-500"
                    }`}
                    title="Delete customer"
                    onClick={(e) => { e.stopPropagation(); deleteGroup(g.id); }}
                  >
                    🗑️
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
        {isSuperAdmin && (
          <div className="mt-2 space-y-3">
            <div className="rounded-md border border-slate-200 bg-white p-3 space-y-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Customer Invitation Policy</div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  className="input-premium"
                  type="number"
                  min="1"
                  max="720"
                  placeholder="TTL Hours"
                  value={invitePolicy.ttlHours}
                  onChange={(e) => setInvitePolicy((prev) => ({ ...prev, ttlHours: e.target.value }))}
                />
                <input
                  className="input-premium"
                  type="number"
                  min="1"
                  max="365"
                  placeholder="Retention Days"
                  value={invitePolicy.retentionDays}
                  onChange={(e) => setInvitePolicy((prev) => ({ ...prev, retentionDays: e.target.value }))}
                />
              </div>
              <div className="text-[10px] text-slate-500">
                TTL controls invitation expiry. Retention controls cleanup of old accepted/revoked/expired records.
              </div>
              <button
                type="button"
                onClick={saveInvitationPolicy}
                disabled={invitePolicySaving}
                className={`btn-premium text-white w-full py-2 ${invitePolicySaved ? "bg-emerald-600 hover:bg-emerald-600" : "bg-slate-800"} ${invitePolicySaving ? "opacity-60 cursor-not-allowed" : ""}`}
              >
                {invitePolicySaving ? "Saving..." : invitePolicySaved ? "Saved" : "Save Invitation Policy"}
              </button>
            </div>
            <div className="rounded-md border border-slate-200 bg-white p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Revision Compare</div>
                <span className="rounded-md border border-blue-100 bg-blue-50 px-2 py-1 text-[10px] font-semibold text-blue-700">
                  Up to {Number(revisionCompareSettings.maxAllowedRows || 100000).toLocaleString("en-US")} rows
                </span>
              </div>
              <input
                className="input-premium"
                type="number"
                min="1000"
                max={Number(revisionCompareSettings.maxAllowedRows || 100000)}
                step="1000"
                placeholder="Max rows"
                value={revisionCompareSettings.maxRows}
                onChange={(e) => setRevisionCompareSettings((prev) => ({ ...prev, maxRows: e.target.value }))}
              />
              <div className="text-[10px] text-slate-500">
                Controls how many rows a revision-to-revision file comparison can load. Default is 100,000.
              </div>
              <button
                type="button"
                onClick={saveRevisionCompareSetting}
                disabled={revisionCompareSaving}
                className={`btn-premium text-white w-full py-2 ${revisionCompareSaved ? "bg-emerald-600 hover:bg-emerald-600" : "bg-slate-800"} ${revisionCompareSaving ? "opacity-60 cursor-not-allowed" : ""}`}
              >
                {revisionCompareSaving ? "Saving..." : revisionCompareSaved ? "Saved" : "Save Revision Compare Settings"}
              </button>
            </div>
            <div className="rounded-md border border-slate-200 bg-white p-3 space-y-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Invite Email Template</div>
              <input
                className="input-premium"
                placeholder="Email Subject"
                value={inviteEmailTemplate.subject}
                onChange={(e) => setInviteEmailTemplate((prev) => ({ ...prev, subject: e.target.value }))}
              />
              <input
                className="input-premium"
                placeholder="Logo URL"
                value={inviteEmailTemplate.logoUrl}
                onChange={(e) => setInviteEmailTemplate((prev) => ({ ...prev, logoUrl: e.target.value }))}
              />
              <textarea
                className="input-premium min-h-[160px]"
                placeholder="HTML template"
                value={inviteEmailTemplate.html}
                onChange={(e) => setInviteEmailTemplate((prev) => ({ ...prev, html: e.target.value }))}
              />
              <textarea
                className="input-premium min-h-[120px]"
                placeholder="Text template"
                value={inviteEmailTemplate.text}
                onChange={(e) => setInviteEmailTemplate((prev) => ({ ...prev, text: e.target.value }))}
              />
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={saveInviteEmailTemplate}
                  disabled={inviteEmailSaving}
                  className={`btn-premium text-white w-full py-2 ${inviteEmailSaved ? "bg-emerald-600 hover:bg-emerald-600" : "bg-slate-800"} ${inviteEmailSaving ? "opacity-60 cursor-not-allowed" : ""}`}
                >
                  {inviteEmailSaving ? "Saving..." : inviteEmailSaved ? "Saved" : "Save Invite Template"}
                </button>
                <button
                  type="button"
                  onClick={previewInviteEmail}
                  disabled={inviteEmailPreviewLoading}
                  className={`btn-premium bg-indigo-600 text-white w-full py-2 ${inviteEmailPreviewLoading ? "opacity-60 cursor-not-allowed" : ""}`}
                >
                  {inviteEmailPreviewLoading ? "Loading..." : "Preview Invite Email"}
                </button>
              </div>
              {inviteEmailPreview.html ? (
                <div className="rounded-md border border-slate-200 bg-slate-50 p-2 space-y-2">
                  <div className="text-[10px] font-semibold text-slate-600">Preview Subject: {inviteEmailPreview.subject}</div>
                  <pre className="rounded-md border border-slate-200 bg-white p-2 max-h-[280px] overflow-auto text-[11px] leading-5 whitespace-pre-wrap break-words">
                    {String(inviteEmailPreview.html || "")}
                  </pre>
                </div>
              ) : null}
            </div>
          </div>
        )}

      </div>

      {/* 3. INTEGRATIONS PANEL */}
      <section className="lg:col-span-7 flex flex-col">
        <div className="flex items-center justify-between mb-4 border-b border-slate-300 pb-2">
          <h3 className="font-semibold text-base text-slate-900">Integrations</h3>
          <div className="flex items-center gap-2">
            <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600">{reportSourceOptions.length} sources</span>
            <button className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50" onClick={() => toggleSection("integrations")}>
              {collapsedSections.integrations ? "Expand" : "Collapse"}
            </button>
          </div>
        </div>
        {!collapsedSections.integrations && (
        <>
        <div className="mb-4 rounded-md border border-slate-200 bg-white p-3 shadow-sm">
          <button
            type="button"
            onClick={() => setReviewRulesOpen((prev) => !prev)}
            className="flex w-full items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-left"
          >
            <div>
              <div className="text-[11px] font-semibold text-slate-800">Review Rules</div>
              <div className="text-[10px] text-slate-500">Source publish controls</div>
            </div>
            <div className="text-[10px] font-semibold text-slate-600">{reviewRulesOpen ? "Hide" : "Show"}</div>
          </button>

          {reviewRulesOpen && (
            <>
              {!canManageIntegrations ? (
                <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-2 text-[11px] font-medium text-slate-500">
                  Available to customer admins and super admins.
                </div>
              ) : reviewSourceOptions.length ? (
                <div className="mt-2 space-y-1.5">
                  {reviewSourceOptions.map((source) => {
                    const sourceId = String(source.id);
                    const saving = reviewPolicySavingId === sourceId;
                    const isExpanded = expandedReviewSourceId === sourceId;
                    const labelRules = normalizeReviewLabelRules(source.review_label_rules);
                    const sourceLabels = normalizeSourceLabels(source);
                    const configuredLabels = Object.keys(labelRules || {}).filter((label) => String(label || "").trim());
                    const availableLabels = sourceLabels.filter((label) => {
                      const target = String(label || "").trim().toLowerCase();
                      if (!target) return false;
                      return !configuredLabels.some((existing) => String(existing || "").trim().toLowerCase() === target);
                    });
                    const draftLabel = String(reviewRuleDraftLabelBySource[sourceId] || "");
                    return (
                      <div key={`review-policy-${sourceId}`} className="rounded-md border border-slate-200 bg-slate-50">
                        <button
                          type="button"
                          onClick={() => setExpandedReviewSourceId((prev) => (prev === sourceId ? "" : sourceId))}
                          className="flex w-full items-center justify-between px-2.5 py-1.5 text-left"
                        >
                          <div className="min-w-0">
                            <div className="truncate text-[11px] font-semibold text-slate-800">{source.name || `Source ${sourceId}`}</div>
                            <div className="text-[9px] text-slate-500">{Number(source.import_count || 0).toLocaleString("en-US")} revisions</div>
                          </div>
                          <div className="text-[10px] font-semibold text-slate-600">{isExpanded ? "−" : "+"}</div>
                        </button>

                        {isExpanded && (
                          <div className="border-t border-slate-200 bg-white px-2.5 py-2 space-y-2">
                            <label className={`flex items-center gap-1.5 text-[10px] font-semibold text-slate-700 ${saving ? "opacity-60" : ""}`}>
                              <input
                                type="checkbox"
                                className="h-3.5 w-3.5 rounded border-slate-300 text-amber-600 focus:ring-amber-200"
                                checked={!!source.review_required}
                                disabled={saving}
                                onChange={(e) => saveReviewPolicy(source, { review_required: e.target.checked })}
                              />
                              Hold every revision
                            </label>
                            <label className={`flex items-center gap-1.5 text-[10px] font-semibold text-slate-700 ${saving ? "opacity-60" : ""}`}>
                              <input
                                type="checkbox"
                                className="h-3.5 w-3.5 rounded border-slate-300 text-amber-600 focus:ring-amber-200"
                                checked={source.review_schema_changes !== false}
                                disabled={saving}
                                onChange={(e) => saveReviewPolicy(source, { review_schema_changes: e.target.checked })}
                              />
                              Hold schema changes
                            </label>

                            <div className="pt-1 border-t border-slate-100">
                              <div className="mb-1 flex items-center justify-between gap-2">
                                <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                                  Label-specific holds {saving ? "• Saving..." : ""}
                                </div>
                                {Object.keys(labelRules || {}).length > 0 && (
                                  <button
                                    type="button"
                                    disabled={saving}
                                    onClick={() => saveReviewPolicy(source, { review_label_rules: {} })}
                                    className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${
                                      saving
                                        ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
                                        : "border-red-200 bg-white text-red-600 hover:bg-red-50"
                                    }`}
                                  >
                                    Clear all
                                  </button>
                                )}
                              </div>
                              {configuredLabels.length ? (
                                <div className="rounded border border-slate-200 bg-slate-50 divide-y divide-slate-200">
                                  {configuredLabels.map((label) => {
                                    const deleteRule = () => {
                                      const trimmed = String(label || "").trim();
                                      const candidateKeys = [
                                        trimmed,
                                        trimmed.toLowerCase(),
                                      ];
                                      const cleaned = { ...labelRules };
                                      candidateKeys.forEach((key) => {
                                        if (Object.prototype.hasOwnProperty.call(cleaned, key)) {
                                          delete cleaned[key];
                                        }
                                      });
                                      saveReviewPolicy(source, { review_label_rules: cleaned });
                                    };
                                    return (
                                      <div key={`${sourceId}-${label}`} className={`flex items-center justify-between gap-2 px-2 py-1.5 ${saving ? "opacity-60" : ""}`}>
                                        <span className="truncate text-[11px] font-medium text-slate-700">{label}</span>
                                        <button
                                          type="button"
                                          disabled={saving}
                                          onClick={deleteRule}
                                          className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold leading-tight shrink-0 ${
                                            saving
                                              ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
                                              : "border-slate-200 bg-white text-slate-600 hover:bg-red-50 hover:text-red-600 hover:border-red-200"
                                          }`}
                                          title={`Delete review rule for ${label}`}
                                        >
                                          Delete
                                        </button>
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : (
                                <div className="text-[10px] text-slate-500">No label-specific rules.</div>
                              )}
                              {availableLabels.length > 0 && (
                                <div className="mt-2 flex items-center gap-2">
                                  <select
                                    className="input-premium py-1 text-[11px] font-medium flex-1"
                                    value={draftLabel}
                                    onChange={(e) => setReviewRuleDraftLabelBySource((prev) => ({ ...prev, [sourceId]: e.target.value }))}
                                    disabled={saving}
                                  >
                                    <option value="">Add label rule…</option>
                                    {availableLabels.map((label) => (
                                      <option key={`${sourceId}-available-${label}`} value={label}>{label}</option>
                                    ))}
                                  </select>
                                  <button
                                    type="button"
                                    disabled={saving || !draftLabel}
                                    onClick={() => {
                                      const nextRules = { ...labelRules, [draftLabel]: true };
                                      saveReviewPolicy(source, { review_label_rules: nextRules });
                                      setReviewRuleDraftLabelBySource((prev) => ({ ...prev, [sourceId]: "" }));
                                    }}
                                    className={`rounded border px-2 py-1 text-[10px] font-semibold ${
                                      saving || !draftLabel
                                        ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
                                        : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                                    }`}
                                  >
                                    Add
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-2 text-[11px] font-medium text-slate-500">
                  No governed sources yet.
                </div>
              )}
            </>
          )}
        </div>

        <div className="mb-4 rounded-md border border-slate-200 bg-white p-3 shadow-sm">
          <button
            type="button"
            onClick={() => setReportSourceDeletionOpen((prev) => !prev)}
            className="flex w-full items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-left"
          >
            <div>
              <div className="text-[11px] font-semibold text-slate-800">Report Source Deletion</div>
              <div className="text-[10px] text-slate-500">Delete source and linked revisions</div>
            </div>
            <div className="text-[10px] font-semibold text-slate-600">
              {reportSourceDeletionOpen ? "Hide" : "Show"} • {reportSourcesForDeletion.length}
            </div>
          </button>
          {reportSourceDeletionOpen && (
            <div className="mt-2">
              {reportSourcesForDeletion.length ? (
                <div className="space-y-1.5 max-h-48 overflow-auto pr-1 custom-scrollbar">
                  {reportSourcesForDeletion.map((source) => {
                    const sourceId = String(source.id);
                    const deleting = reportSourceDeletingId === sourceId;
                    const saving = reviewPolicySavingId === sourceId;
                    return (
                      <div key={`right-source-${sourceId}`} className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5">
                        <div className="min-w-0">
                          <div className="truncate text-[11px] font-semibold text-slate-700">{source.name || `Source ${sourceId}`}</div>
                          <div className="text-[9px] text-slate-500">{Number(source.import_count || 0).toLocaleString("en-US")} revisions</div>
                        </div>
                        <button
                          type="button"
                          disabled={deleting || saving}
                          onClick={() => deleteReportSource(source)}
                          className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-semibold ${deleting || saving ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400" : "border-red-200 bg-white text-red-600 hover:bg-red-50"}`}
                          title={`Delete ${source.name || `Source ${sourceId}`}`}
                        >
                          {deleting ? "..." : "Delete"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-[10px] text-slate-400 italic">No sources available.</div>
              )}
            </div>
          )}
        </div>

        <IntegrationSettingsPanel
          canManageIntegrations={canManageIntegrations}
          isSuperAdmin={isSuperAdmin}
          selectedGroupId={selectedGroupId}
          selectedGroupBundleTier={selectedGroupEntitlements?.bundleTier || ""}
          reportSourceOptions={reportSourceOptions}
          autosyncInterval={autosyncInterval}
          autosyncIntervalSaving={autosyncIntervalSaving}
          autosyncIntervalSaved={autosyncIntervalSaved}
          setAutosyncInterval={setAutosyncInterval}
          saveAutosyncIntervalSetting={saveAutosyncIntervalSetting}
          importPipelineSettings={importPipelineSettings}
          setImportPipelineSettings={setImportPipelineSettings}
          importPipelineSaving={importPipelineSaving}
          importPipelineSaved={importPipelineSaved}
          saveImportPipelineSetting={saveImportPipelineSetting}
          INTEGRATION_LOGOS={INTEGRATION_LOGOS}
          emailIngestConfig={emailIngestConfig}
          emailIngestSaving={emailIngestSaving}
          emailIngestSaved={emailIngestSaved}
          integrationOpen={integrationOpen}
          setIntegrationOpen={setIntegrationOpen}
          setEmailIngestConfig={setEmailIngestConfig}
          saveEmailIngestSetting={saveEmailIngestSetting}
          googleConfigured={googleConfigured}
          googleOauthMeta={googleOauthMeta}
          googleOauthForm={googleOauthForm}
          googleOauthSaving={googleOauthSaving}
          googleOauthSaved={googleOauthSaved}
          googleOauthTesting={googleOauthTesting}
          setGoogleOauthForm={setGoogleOauthForm}
          saveGoogleOauthSetting={saveGoogleOauthSetting}
          testGoogleOauthSetting={testGoogleOauthSetting}
          dropboxConfigured={dropboxConfigured}
          dropboxOauthMeta={dropboxOauthMeta}
          dropboxOauthForm={dropboxOauthForm}
          dropboxOauthSaving={dropboxOauthSaving}
          dropboxOauthSaved={dropboxOauthSaved}
          dropboxOauthTesting={dropboxOauthTesting}
          setDropboxOauthForm={setDropboxOauthForm}
          saveDropboxOauthSetting={saveDropboxOauthSetting}
          testDropboxOauthSetting={testDropboxOauthSetting}
          oneDriveConfigured={oneDriveConfigured}
          oneDriveOauthMeta={oneDriveOauthMeta}
          oneDriveOauthForm={oneDriveOauthForm}
          oneDriveOauthSaving={oneDriveOauthSaving}
          oneDriveOauthSaved={oneDriveOauthSaved}
          oneDriveOauthTesting={oneDriveOauthTesting}
          setOneDriveOauthForm={setOneDriveOauthForm}
          saveOneDriveOauthSetting={saveOneDriveOauthSetting}
          testOneDriveOauthSetting={testOneDriveOauthSetting}
          quickbooksConfigured={quickbooksConfigured}
          quickbooksOauthMeta={quickbooksOauthMeta}
          quickbooksOauthForm={quickbooksOauthForm}
          quickbooksOauthSaving={quickbooksOauthSaving}
          quickbooksOauthSaved={quickbooksOauthSaved}
          quickbooksOauthTesting={quickbooksOauthTesting}
          samlConfigured={samlConfigured}
          samlMeta={samlMeta}
          samlForm={samlForm}
          samlSaving={samlSaving}
          samlSaved={samlSaved}
          samlTesting={samlTesting}
          QUICKBOOKS_DATA_TYPE_OPTIONS={QUICKBOOKS_DATA_TYPE_OPTIONS}
          setQuickbooksOauthForm={setQuickbooksOauthForm}
          saveQuickbooksOauthSetting={saveQuickbooksOauthSetting}
          testQuickbooksOauthSetting={testQuickbooksOauthSetting}
          setSamlForm={setSamlForm}
          saveSamlSetting={saveSamlSetting}
          testSamlSetting={testSamlSetting}
          integrationTestStatus={integrationTestStatus}
          STORAGE_PROVIDER_DEFS={STORAGE_PROVIDER_DEFS}
          createStorageProviderState={createStorageProviderState}
          storageSettings={storageSettings}
          updateStorageProvider={updateStorageProvider}
          saveStorageSetting={saveStorageSetting}
          testStorageSetting={testStorageSetting}
          aiRuntimeSettings={aiRuntimeSettings}
          setAiRuntimeSettings={setAiRuntimeSettings}
          aiRuntimeSaving={aiRuntimeSaving}
          aiRuntimeSaved={aiRuntimeSaved}
          saveAiRuntimeSetting={saveAiRuntimeSetting}
          applyAiRuntimePreset={applyAiRuntimePreset}
          aiUsagePeriodMonth={aiUsagePeriodMonth}
          setAiUsagePeriodMonth={setAiUsagePeriodMonth}
          aiUsageSummary={aiUsageSummary}
          aiUsageLoading={aiUsageLoading}
          aiUsageError={aiUsageError}
          fetchAiUsageSummary={fetchAiUsageSummary}
        />

        </>
        )}
      </section>

      </div>
      <CustomerFormModal
        open={customerFormOpen}
        mode={customerFormMode}
        firstName={newCustomerFirstName}
        lastName={newCustomerLastName}
        companyName={newCustomerCompanyName}
        email={newCustomerEmail}
        phone={newCustomerPhone}
        onClose={() => setCustomerFormOpen(false)}
        onSave={saveCustomerForm}
        onFirstNameChange={setNewCustomerFirstName}
        onLastNameChange={setNewCustomerLastName}
        onCompanyNameChange={setNewCustomerCompanyName}
        onEmailChange={setNewCustomerEmail}
        onPhoneChange={setNewCustomerPhone}
      />
      <PasswordResetModal
        open={passwordResetModal.open}
        label={passwordResetModal.label}
        password={passwordResetModal.password}
        repeat={passwordResetModal.repeat}
        onPasswordChange={(value) => setPasswordResetModal((prev) => ({ ...prev, password: value }))}
        onRepeatChange={(value) => setPasswordResetModal((prev) => ({ ...prev, repeat: value }))}
        onClose={closePasswordResetModal}
        onGenerate={fillGeneratedResetPassword}
        onCopy={copyResetPassword}
        onSubmit={submitPasswordReset}
      />
      </div>
    </div>
  );
}
