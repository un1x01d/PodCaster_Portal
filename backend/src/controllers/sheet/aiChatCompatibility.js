function normalizeSheetCellValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "";
    const numLike = Number(trimmed.replace(/[$,%\s]/g, ""));
    if (!Number.isNaN(numLike)) return numLike;
    const dt = new Date(trimmed);
    if (!Number.isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);
    return trimmed;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

function toPeriodKeyFromValue(value) {
  const normalized = normalizeSheetCellValue(value);
  const text = String(normalized || "").trim();
  if (!text) return null;
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[1]}-${iso[2]}`;
  const dt = new Date(text);
  if (Number.isNaN(dt.getTime())) return null;
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function toNumericOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number.parseFloat(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(num) ? num : null;
}

function isDateLikeHeaderName(header = "") {
  return /date|period|month|year|quarter|time|day/i.test(String(header || ""));
}

export function evaluateAiChatCompatibilityForImport({ semanticProfile = {}, sampleRows = [] }) {
  const defaults = semanticProfile && typeof semanticProfile === "object" ? (semanticProfile.defaults || {}) : {};
  const dateColumn = String(defaults?.dateColumn || "").trim();
  const metricColumnsMap = defaults?.metricColumns && typeof defaults.metricColumns === "object"
    ? Object.fromEntries(
      Object.entries(defaults.metricColumns)
        .map(([k, v]) => [String(k || "").trim(), String(v || "").trim()])
        .filter(([k, v]) => k && v)
    )
    : [];
  const metricColumns = Object.values(metricColumnsMap);
  const rows = Array.isArray(sampleRows) ? sampleRows.slice(0, 300) : [];
  const availableHeaders = rows.length ? Object.keys(rows[0] || {}).filter(Boolean) : [];

  const missing = [];
  if (!dateColumn) {
    missing.push("Expected reporting date column does not exist. Expected one of: Date, Month, Quarter, Year.");
  }
  if (!metricColumns.length) {
    missing.push("Expected metric columns do not exist. Expected at least one of: Revenue, Cost, Profit, Net Income, Total Expense.");
  }
  const dateHeaderLooksLikePeriod = !dateColumn || isDateLikeHeaderName(dateColumn);
  if (dateColumn && !dateHeaderLooksLikePeriod) {
    missing.push(`Expected reporting date column, but found "${dateColumn}". Expected a period column like Date, Month, Quarter, or Year.`);
  }

  if (dateColumn && dateHeaderLooksLikePeriod) {
    const dateVals = rows
      .map((r) => r?.[dateColumn])
      .filter((v) => v !== null && v !== undefined && String(v).trim() !== "");
    const dateHits = dateVals.filter((v) => !!toPeriodKeyFromValue(v)).length;
    const dateRatio = dateVals.length ? (dateHits / dateVals.length) : 0;
    if (dateVals.length < 5 || dateRatio < 0.6) {
      missing.push(`Expected valid reporting dates in "${dateColumn}", but values do not match a usable reporting period format.`);
    }
  }

  if (metricColumns.length) {
    let hasValidMetric = false;
    const colStats = new Map();
    for (const col of metricColumns) {
      const vals = rows
        .map((r) => r?.[col])
        .filter((v) => v !== null && v !== undefined && String(v).trim() !== "");
      if (vals.length < 5) continue;
      const numericHits = vals.filter((v) => toNumericOrNull(v) !== null).length;
      const numericRatio = vals.length ? (numericHits / vals.length) : 0;
      colStats.set(col, { count: vals.length, ratio: numericRatio });
      if (numericRatio >= 0.6) {
        hasValidMetric = true;
      }
    }
    const strictCanonicals = ["revenue", "profit", "cost", "expense", "income", "net_income", "total_revenue", "total_expense"];
    for (const [canonical, mappedCol] of Object.entries(metricColumnsMap)) {
      if (!strictCanonicals.some((k) => canonical.toLowerCase().includes(k))) continue;
      const stats = colStats.get(mappedCol);
      if (!stats || stats.count < 5 || stats.ratio < 0.6) {
        missing.push(`Expected amount values for "${canonical}" in "${mappedCol}", but this column is missing valid numeric amounts.`);
      }
    }
    if (!hasValidMetric) {
      missing.push("Expected at least one valid amount column, but none of the mapped metric columns contain usable numeric amounts.");
    }
  }

  return {
    ready: missing.length === 0,
    missing,
  };
}

export function normalizeCompatibilityMissingReasons(reasons = []) {
  const list = Array.isArray(reasons) ? reasons.map((r) => String(r || "").trim()).filter(Boolean) : [];
  return list.map((reason) => {
    const lower = reason.toLowerCase();
    if (lower.includes("metric mappings are missing")) {
      return "Expected metric columns do not exist. Expected at least one of: Revenue, Cost, Profit, Net Income, Total Expense.";
    }
    if (lower.includes("date/year mapping is missing")) {
      return "Expected reporting date column does not exist. Expected one of: Date, Month, Quarter, Year.";
    }
    if (lower.includes("does not look like a date/period header") || lower.includes("date/year mapping points to")) {
      const match = reason.match(/'([^']+)'|\"([^\"]+)\"/);
      const found = (match?.[1] || match?.[2] || "").trim();
      return found
        ? `Expected reporting date column, but found "${found}". Expected a period column like Date, Month, Quarter, or Year.`
        : "Expected reporting date column, but found a non-period field. Expected a period column like Date, Month, Quarter, or Year.";
    }
    if (lower.includes("values are not consistently valid dates") || lower.includes("valid ratio")) {
      const match = reason.match(/'([^']+)'|\"([^\"]+)\"/);
      const found = (match?.[1] || match?.[2] || "").trim();
      return found
        ? `Expected valid reporting dates in "${found}", but values do not match a usable reporting period format.`
        : "Expected valid reporting dates, but values do not match a usable reporting period format.";
    }
    return reason;
  });
}

export function canApproveWithMaskedDlp({ semanticProfile = {}, compatibility = {} }) {
  const allowMaskOverride = ["1", "true", "yes", "on"].includes(
    String(process.env.AI_CHAT_COMPATIBILITY_ALLOW_MASK_OVERRIDE || "false").trim().toLowerCase()
  );
  if (!allowMaskOverride) return false;
  const mode = String(semanticProfile?.dlp?.mode || "").trim().toLowerCase();
  if (mode !== "mask") return false;
  if (compatibility?.ready === true) return true;

  const defaults = semanticProfile && typeof semanticProfile === "object" ? (semanticProfile.defaults || {}) : {};
  const dateColumn = String(defaults?.dateColumn || "").trim();
  const metricColumnsMap = defaults?.metricColumns && typeof defaults.metricColumns === "object"
    ? Object.fromEntries(
      Object.entries(defaults.metricColumns)
        .map(([k, v]) => [String(k || "").trim(), String(v || "").trim()])
        .filter(([k, v]) => k && v)
    )
    : {};
  const metricColumns = Object.values(metricColumnsMap);
  if (!dateColumn || !isDateLikeHeaderName(dateColumn) || !metricColumns.length) return false;

  const missing = Array.isArray(compatibility?.missing) ? compatibility.missing.map((m) => String(m || "").toLowerCase()) : [];
  if (!missing.length) return true;
  const hasStructuralFailure = missing.some((m) =>
    m.includes("mapping is missing")
    || m.includes("metric mappings are missing")
    || m.includes("does not look like a date/period header")
    || m.includes("points to")
  );
  return !hasStructuralFailure;
}
