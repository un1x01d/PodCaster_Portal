export const DEFAULT_GROUP_ENTITLEMENTS = {
  maxUsers: null,
  maxReportSources: null,
  maxAiQueriesPerMonth: null,
  aiMonthlyBudgetUsd: null,
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
  const normalizedFeatures = Object.fromEntries(
    Object.entries(rawFeatures).map(([key, rawValue]) => {
      if (typeof rawValue === "string") {
        const normalized = rawValue.trim().toLowerCase();
        if (["false", "0", "no", "off", ""].includes(normalized)) return [key, false];
        if (["true", "1", "yes", "on"].includes(normalized)) return [key, true];
      }
      return [key, rawValue === false ? false : !!rawValue];
    })
  );
  return {
    ...DEFAULT_GROUP_ENTITLEMENTS,
    ...raw,
    maxUsers: raw.maxUsers === null || raw.maxUsers === undefined || raw.maxUsers === ""
      ? null
      : Math.max(1, Number.parseInt(raw.maxUsers, 10) || 1),
    maxReportSources: raw.maxReportSources === null || raw.maxReportSources === undefined || raw.maxReportSources === ""
      ? null
      : Math.max(1, Number.parseInt(raw.maxReportSources, 10) || 1),
    maxAiQueriesPerMonth: raw.maxAiQueriesPerMonth === null || raw.maxAiQueriesPerMonth === undefined || raw.maxAiQueriesPerMonth === ""
      ? null
      : Math.max(1, Number.parseInt(raw.maxAiQueriesPerMonth, 10) || 1),
    aiMonthlyBudgetUsd: raw.aiMonthlyBudgetUsd === null || raw.aiMonthlyBudgetUsd === undefined || raw.aiMonthlyBudgetUsd === ""
      ? null
      : Math.max(0.01, Number.parseFloat(raw.aiMonthlyBudgetUsd) || 0.01),
    maxImportParseMemoryMb: raw.maxImportParseMemoryMb === null || raw.maxImportParseMemoryMb === undefined || raw.maxImportParseMemoryMb === ""
      ? null
      : Math.max(64, Number.parseInt(raw.maxImportParseMemoryMb, 10) || 64),
    features: {
      ...DEFAULT_GROUP_ENTITLEMENTS.features,
      ...normalizedFeatures,
    },
  };
}

export function groupHasFeature(group, featureName) {
  const entitlements = normalizeGroupEntitlements(group?.entitlements || {});
  return entitlements.features?.[featureName] !== false;
}
