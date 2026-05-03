export const DEFAULT_GROUP_ENTITLEMENTS = {
  maxUsers: null,
  maxReportSources: null,
  maxAiQueriesPerMonth: null,
  aiMonthlyBudgetUsd: null,
  aiChatEnabled: null,
  aiChatAudioEnabled: null,
  aiDashboardTranslationEnabled: null,
  maxImportParseMemoryMb: null,
  features: {
    manageUsers: true,
    managePermissions: true,
    manageGroupAdmins: false,
    ai: true,
    exports: true,
    imports: true,
    approvalFlow: false,
    auditLogs: false,
    sso: true,
    googleDrive: true,
    dropbox: true,
    oneDrive: true,
    quickbooks: true,
    dlp: true,
  },
};

const PRODUCT_BUNDLE_KEYS = new Set(["core", "growth", "enterprise"]);

function normalizeFeatureFlags(rawFeatures = {}) {
  const source = rawFeatures && typeof rawFeatures === "object" && !Array.isArray(rawFeatures)
    ? rawFeatures
    : {};
  return Object.fromEntries(
    Object.entries(source).map(([key, rawValue]) => {
      if (typeof rawValue === "string") {
        const normalized = rawValue.trim().toLowerCase();
        if (["false", "0", "no", "off", ""].includes(normalized)) return [key, false];
        if (["true", "1", "yes", "on"].includes(normalized)) return [key, true];
      }
      return [key, rawValue === false ? false : !!rawValue];
    })
  );
}

function normalizePositiveIntOrNull(value, min = 1) {
  if (value === null || value === undefined || value === "") return null;
  return Math.max(min, Number.parseInt(value, 10) || min);
}

function normalizeBundleFeatureSets(raw = {}) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return Object.fromEntries(
    Object.entries(source)
      .filter(([key]) => PRODUCT_BUNDLE_KEYS.has(String(key || "").toLowerCase()))
      .map(([key, features]) => [String(key).toLowerCase(), normalizeFeatureFlags(features)])
  );
}

function normalizeBundleCapacityLimits(raw = {}) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return Object.fromEntries(
    Object.entries(source)
      .filter(([key]) => PRODUCT_BUNDLE_KEYS.has(String(key || "").toLowerCase()))
      .map(([key, limits]) => {
        const src = limits && typeof limits === "object" && !Array.isArray(limits) ? limits : {};
        return [String(key).toLowerCase(), {
          maxUsers: normalizePositiveIntOrNull(src.maxUsers),
          maxReportSources: normalizePositiveIntOrNull(src.maxReportSources),
        }];
      })
  );
}

export function normalizeGroupEntitlements(value = {}) {
  let raw = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = {};
    }
  }
  raw = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  let rawFeatures = raw.features;
  if (typeof rawFeatures === "string") {
    try {
      rawFeatures = JSON.parse(rawFeatures);
    } catch {
      rawFeatures = {};
    }
  }
  rawFeatures = rawFeatures && typeof rawFeatures === "object" && !Array.isArray(rawFeatures)
    ? rawFeatures
    : {};
  const normalizedFeatures = normalizeFeatureFlags(rawFeatures);
  const normalizeNullableBool = (v) => {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "boolean") return v;
    const normalized = String(v).trim().toLowerCase();
    if (["true", "1", "yes", "on", "enabled"].includes(normalized)) return true;
    if (["false", "0", "no", "off", "disabled"].includes(normalized)) return false;
    return null;
  };
  const bundleTier = PRODUCT_BUNDLE_KEYS.has(String(raw.bundleTier || "").toLowerCase())
    ? String(raw.bundleTier).toLowerCase()
    : null;
  return {
    ...DEFAULT_GROUP_ENTITLEMENTS,
    maxUsers: normalizePositiveIntOrNull(raw.maxUsers),
    maxReportSources: normalizePositiveIntOrNull(raw.maxReportSources),
    maxAiQueriesPerMonth: normalizePositiveIntOrNull(raw.maxAiQueriesPerMonth),
    aiMonthlyBudgetUsd: raw.aiMonthlyBudgetUsd === null || raw.aiMonthlyBudgetUsd === undefined || raw.aiMonthlyBudgetUsd === ""
      ? null
      : Math.max(0.01, Number.parseFloat(raw.aiMonthlyBudgetUsd) || 0.01),
    aiChatEnabled: normalizeNullableBool(raw.aiChatEnabled),
    aiChatAudioEnabled: normalizeNullableBool(raw.aiChatAudioEnabled),
    aiDashboardTranslationEnabled: normalizeNullableBool(raw.aiDashboardTranslationEnabled),
    maxImportParseMemoryMb: raw.maxImportParseMemoryMb === null || raw.maxImportParseMemoryMb === undefined || raw.maxImportParseMemoryMb === ""
      ? null
      : Math.max(64, Number.parseInt(raw.maxImportParseMemoryMb, 10) || 64),
    features: {
      ...DEFAULT_GROUP_ENTITLEMENTS.features,
      ...normalizedFeatures,
    },
    bundleTier,
    bundleFeatureSets: normalizeBundleFeatureSets(raw.bundleFeatureSets),
    bundleCapacityLimits: normalizeBundleCapacityLimits(raw.bundleCapacityLimits),
  };
}

export function groupHasFeature(group, featureName) {
  const entitlements = normalizeGroupEntitlements(group?.entitlements || {});
  return entitlements.features?.[featureName] !== false;
}
