export function chatMidHelpersPart4(deps) {
  const {
    query,
    getClient,
    writeAuditLog,
    buildSheetSemanticProfile,
    resolveProfileDateColumn,
    resolveProfileDimension,
    resolveProfileMetric,
    loadEffectiveAiRuntimeSettings,
    resolveChatCompletionProviderConfig,
    buildChatCompletionRequestBody,
    extractOpenAiAssistantText,
    minCompletionTokensForModel,
    enforceAiPromptBudget,
    OPENAI_BASE_URL,
    OPENAI_TIMEOUT_MS,
    AI_DEBUG_LOGS,
    CHAT_RUNTIME_RULES_DEFAULTS,
    HEADER_AI_SAMPLE_VALUES_PER_COLUMN,
    reserveAiQueryForSheet,
    resolveAiGroupIdForSheet,
    recordAiUsage,
    estimateOpenAiCostUsd,
    translateDashboardItems,
    isEnglishLocale,
    normalizeLocale,
    hasReportSourceOwnerAccess,
    isPlatformAdminUser,
    loadSheetPermissionSets,
    buildRowFilterWhereClause,
    resolveRuntimeGroupIdForUser,
    checkSheetAccess,
    groupHasFeature,
    computeDeterministicAnswer,
    loadSemanticBrain,
    resolveColumn,
    applyFilters,
    normalizeScopeColumns,
    projectRowsToHeaders,
    extractExplicitYears,
    shouldIncludeTrailingPartialYear,
    dropImplicitTrailingPartialYear,
    cleanAITechnicalNoise,
    normalizeChatMarkdownText,
    formatDenseYoYComparisonBullets,
    formatAnswerWithBullets,
    enforceCommaThousands,
    normalizeDatesAndRemoveTime,
    enforceTwoDecimals,
    stripApproximationWords,
    applyAnswerFormatDirectives,
    applyTimeWindowDirectives,
    applyConversationalAnswerStyle,
    appendSkippedRowsNote,
    isClarificationOrApologyAnswer,
    looksLikeDateHeader,
    detectDateSyntax,
    buildDateFormatHints,
    restrictSemanticProfileToHeaders,
    compactSemanticProfileForPrompt,
    uniqueColumnSamples,
    buildHeaderAiContext,
    applyHeaderUnderstandingToProfile,
    inferHeaderUnderstandingWithAi,
    ensureAiHeaderUnderstanding,
    compactSchemaProfileForPrompt,
    callOpenAI,
    rewriteGroundedScalarAnswer,
    normalizeAiPlan,
    validateAiResponseSchemaStrict,
    repairAiPlanForExecution,
    deriveMetricIntentFromQuestion,
    detectForecastIntent,
    extractMetricHintFromText,
    extractMetricFromAssistantAnswer,
    isShortReasonFollowup,
    isShortYearFollowup,
    parseYearFollowup,
    normalizeRelativeYearInMessage,
    asksExplicitComparisonIntent,
    asksDifferenceBetweenYears,
  } = deps;

function isComparisonIntent(message = "", rules = CHAT_RUNTIME_RULES_DEFAULTS) {
  const s = String(message || "").toLowerCase();
  const explicit = asksExplicitComparisonIntent(s, rules);
  const explicitDelta = asksDifferenceBetweenYears(s);
  const aggregate = runtimeRegex(rules, "aggregateComparisonRegex", CHAT_RUNTIME_RULES_DEFAULTS.aggregateComparisonRegex).test(s);
  return explicit || explicitDelta || aggregate;
}

function isMetricConfirmationFollowup(message = "") {
  const s = String(message || "").trim().toLowerCase();
  return /^(is|was)\s+(this|that|it)\s+(net\s+)?(revenue|income|profit)\??$/.test(s);
}

function asksNumberOnlyResponse(message = "") {
  const s = String(message || "").toLowerCase();
  return /\b(number\s*only|just\s*number|only\s*number|numeric\s*only|digits\s*only)\b/i.test(s);
}

function extractDistinctYearsInOrder(message = "") {
  const years = Array.from(
    String(message || "").matchAll(/\b(19\d{2}|20\d{2})\b/g),
    (m) => Number(m?.[0])
  ).filter((y) => Number.isInteger(y));
  return Array.from(new Set(years));
}

function mergeRecentYears(existingYears = [], incomingYears = [], maxKeep = 4) {
  const merged = [];
  for (const y of [...(Array.isArray(existingYears) ? existingYears : []), ...(Array.isArray(incomingYears) ? incomingYears : [])]) {
    const n = Number(y);
    if (!Number.isInteger(n)) continue;
    if (!merged.includes(n)) merged.push(n);
  }
  if (merged.length <= maxKeep) return merged;
  return merged.slice(-maxKeep);
}

function formatPlainNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "0";
  if (Math.abs(num % 1) < 1e-9) return String(Math.trunc(num));
  return num.toFixed(2);
}

function buildHeaderResolutionBlockedMessage(resolution = null) {
  const missing = resolution?.missingRequired || [];
  const ambiguous = resolution?.ambiguous || [];
  if (missing.length) return `I can’t calculate this yet. Missing required headers: ${missing.join(", ")}.`;
  if (ambiguous.length) return "I can’t calculate this yet. Multiple similar headers were detected; approve a single mapping for this revision.";
  return "I can’t calculate this yet because metric mapping is incomplete for this revision.";
}

function buildHeaderExplanationResponse({ metricKey = null, resolution = null }) {
  const resolved = resolution?.resolvedMappings || {};
  const missing = resolution?.missingRequired || [];
  const ambiguous = resolution?.ambiguous || [];
  const lines = [];
  if (metricKey) lines.push(`Phase 1 mapping for ${metricKey}:`);
  if (Object.keys(resolved).length) {
    lines.push("Resolved headers:");
    Object.entries(resolved).forEach(([k, v]) => lines.push(`- ${k} -> ${v}`));
  }
  if (missing.length) lines.push(`Missing required headers: ${missing.join(", ")}`);
  if (ambiguous.length) {
    lines.push("Ambiguous mappings found. Please choose:");
    ambiguous.forEach((a) => {
      const options = (a.candidates || []).map((c) => c.header).filter(Boolean);
      lines.push(`- ${a.canonicalField}: ${options.join(" / ") || "multiple close matches"}`);
    });
  }
  if (!lines.length) lines.push("I could not resolve required accounting headers.");
  return lines.join("\n");
}

function asksDifferenceFollowupWithoutYears(message = "", rules = CHAT_RUNTIME_RULES_DEFAULTS) {
  const s = String(message || "").toLowerCase();
  const hasAnyYear = /\b(19\d{2}|20\d{2})\b/.test(s);
  if (hasAnyYear) return false;
  const explicitComparison = isComparisonIntent(s, rules);
  if (explicitComparison) return true;
  return /\b(difference|diff|delta|compare|comparison|between (them|those years|years)|between the years)\b/i.test(s)
    || /разниц|дельт|сравн|между (ними|годами)/i.test(s)
    || /різниц|дельт|порівн|між (ними|роками)/i.test(s);
}

function deriveDriverIntentFromQuestion(message = "") {
  const msg = String(message || "").toLowerCase();
  return runtimeRegex(CHAT_RUNTIME_RULES_DEFAULTS, "driverIntentRegex", CHAT_RUNTIME_RULES_DEFAULTS.driverIntentRegex).test(msg);
}

function isRatioIntent(message = "", rules = CHAT_RUNTIME_RULES_DEFAULTS) {
  const msg = String(message || "").toLowerCase();
  return runtimeRegex(rules, "ratioIntentRegex", CHAT_RUNTIME_RULES_DEFAULTS.ratioIntentRegex).test(msg);
}

function computeDeterministicLiquidityRunway(rows = []) {
  const safeRows = Array.isArray(rows) ? rows : [];
  if (!safeRows.length) return null;
  const headers = Object.keys(safeRows[0] || {});
  const findCol = (patterns = []) => {
    for (const rx of patterns) {
      const hit = headers.find((h) => rx.test(String(h || "")));
      if (hit) return hit;
    }
    return null;
  };
  const colAssetCurr = findCol([/\bcurrent\s*assets?\b/i, /activos?\s*circulantes?/i, /оборотн(ые|і)\s*актив/i]);
  const colAssetInv = findCol([/\binventory\b/i, /inventario/i, /запас/i]);
  const colLiabCurr = findCol([/\bcurrent\s*liabilit(y|ies)\b/i, /pasivos?\s*corrientes?/i, /текущ(ие|і)\s*обязат/i]);
  const colCashTotal = findCol([/\b(total\s*)?cash\b/i, /efectivo\s*total/i, /денежн(ых|их)\s*средств/i]);
  const colExpOpex = findCol([/\bopex\b/i, /operating\s*expenses?/i, /gastos?\s*operativos/i, /операционн(ые|і)\s*расход/i]);
  const colRevMonth = findCol([/\bmonthly\s*revenue\b/i, /ingresos?\s*mensuales/i, /ежемесячн(ая|і)\s*выручк/i]);
  if (!colAssetCurr || !colAssetInv || !colLiabCurr || !colCashTotal || !colExpOpex || !colRevMonth) return null;
  const sum = (col) => safeRows.reduce((acc, r) => acc + (toNum(r?.[col]) || 0), 0);
  const ASSET_CURR = sum(colAssetCurr);
  const ASSET_INV = sum(colAssetInv);
  const LIAB_CURR = sum(colLiabCurr);
  const CASH_TOTAL = sum(colCashTotal);
  const EXP_OPEX = sum(colExpOpex);
  const REV_MONTH = sum(colRevMonth);
  const NET_BURN = EXP_OPEX - REV_MONTH;
  const quickRatio = LIAB_CURR === 0 ? "DIV_ZERO_ERR" : Number(((ASSET_CURR - ASSET_INV) / LIAB_CURR).toFixed(2));
  const runwayMonths = NET_BURN === 0 ? "DIV_ZERO_ERR" : Number((CASH_TOTAL / NET_BURN).toFixed(2));
  return {
    QUICK_RATIO: quickRatio,
    NET_BURN: Number(NET_BURN.toFixed(2)),
    RUNWAY_MONTHS: runwayMonths,
  };
}

async function loadFormulaRegistry() {
  const formulas = await query(
    "SELECT code, category, expression, output_unit, precision_digits, denominator_guard_key, enabled FROM formula_registry WHERE enabled = true",
    []
  );
  const keys = await query(
    "SELECT formula_code, key_code, required, header_patterns FROM formula_keys ORDER BY formula_code, id",
    []
  );
  const aliases = await query(
    "SELECT formula_code, language, alias FROM formula_aliases",
    []
  );
  const intents = await query(
    "SELECT language, phrase, intent_code, priority FROM formula_intent_aliases ORDER BY priority ASC, id ASC",
    []
  ).catch(() => []);
  const composites = await query(
    "SELECT code, label, expression, output_unit, precision_digits, enabled FROM formula_composites WHERE enabled = true",
    []
  ).catch(() => []);
  return { formulas, keys, aliases, intents, composites };
}

function pickHeaderByPatterns(headers = [], patterns = []) {
  const list = Array.isArray(headers) ? headers : [];
  for (const pat of (Array.isArray(patterns) ? patterns : [])) {
    let rx = null;
    try { rx = new RegExp(String(pat), "i"); } catch { rx = null; }
    if (!rx) continue;
    const hit = list.find((h) => rx.test(String(h || "")));
    if (hit) return hit;
  }
  return null;
}

function execFormulaExpression(expr = "", values = {}) {
  const safe = String(expr || "");
  const allowed = /^[A-Z0-9_+\-*/().\s]+$/i.test(safe);
  if (!allowed) return null;
  const replaced = safe.replace(/\b[A-Z_][A-Z0-9_]*\b/g, (k) => String(Number(values[k] || 0)));
  try {
    // eslint-disable-next-line no-new-func
    const n = Function(`"use strict"; return (${replaced});`)();
    return Number.isFinite(Number(n)) ? Number(n) : null;
  } catch {
    return null;
  }
}

function detectFormulaIntent(message = "", intents = []) {
  const msg = String(message || "").toLowerCase();
  const rows = Array.isArray(intents) ? intents : [];
  const hit = rows.find((i) => msg.includes(String(i.phrase || "").toLowerCase()));
  return hit ? String(hit.intent_code || "") : null;
}

  return {
    isComparisonIntent,
    isMetricConfirmationFollowup,
    asksNumberOnlyResponse,
    extractDistinctYearsInOrder,
    mergeRecentYears,
    formatPlainNumber,
    buildHeaderResolutionBlockedMessage,
    buildHeaderExplanationResponse,
    asksDifferenceFollowupWithoutYears,
    deriveDriverIntentFromQuestion,
    isRatioIntent,
    computeDeterministicLiquidityRunway,
    loadFormulaRegistry,
    pickHeaderByPatterns,
    execFormulaExpression,
    detectFormulaIntent,
  };
}
