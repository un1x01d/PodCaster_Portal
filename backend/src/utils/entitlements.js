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
  },
};

export function normalizeGroupEntitlements(value = {}) {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const rawFeatures = raw.features && typeof raw.features === "object" && !Array.isArray(raw.features)
    ? raw.features
    : {};
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
      ...rawFeatures,
    },
  };
}

export function groupHasFeature(group, featureName) {
  const entitlements = normalizeGroupEntitlements(group?.entitlements || {});
  return entitlements.features?.[featureName] !== false;
}
