export function chatPreludeHelpersPart3(deps) {
  const {
    query,
    buildRowFilterWhereClause,
    loadEffectiveAiRuntimeSettings,
    resolveChatCompletionProviderConfig,
    buildChatCompletionRequestBody,
    minCompletionTokensForModel,
    extractOpenAiAssistantText,
    enforceAiPromptBudget,
    getClient,
    writeAuditLog,
    CHAT_RUNTIME_RULES_DEFAULTS,
    AI_DEBUG_LOGS,
    CHAT_SQL_AGG_MAX_ROWS,
    CHAT_MAX_ROWS,
    OPENAI_BASE_URL,
    OPENAI_TIMEOUT_MS,
    parseNumericLoose,
    sampleTypeStats,
    evaluatePredefinedChatCompatibility,
    sleep,
    withLearningDbRetry,
    resolveOpenAIRequestFailureReason,
    aiError,
    detectIntentLabel,
    toRuleFlag,
    recordRuleHit,
    compileDeterministicQueryPlan,
    recordLearningEvent,
    isLearnablePhrase,
    upsertLearningCandidate,
    loadChatTtsSettings,
    loadChatRuntimeRules,
    toNum,
    looksLikeDateText,
    toSqlDateLiteral,
    buildSqlSafeDateExpr,
    buildSqlSafeNumericExpr,
    parseDateValue,
    detectQuarterFromText,
    quarterFromDate,
    augmentRowsWithQuarter,
    formatValue,
    normalizeActiveDashboardFilters,
    computeSqlAggregation,
    inferAggregateBucketFromMessage,
    isDateRelatedQuestion,
    isTemporalHeaderName,
    sheetHasTemporalColumn,
    noDateColumnAnswer,
    inferAggregateOperationFromMessage,
  } = deps;

function detectQueryMetricIntent(message = "", rules = CHAT_RUNTIME_RULES_DEFAULTS) {
  const msg = String(message || "").toLowerCase();
  if (runtimeRegex(rules, "metricIntentRevenueRegex", CHAT_RUNTIME_RULES_DEFAULTS.metricIntentRevenueRegex).test(msg)) return "revenue";
  if (runtimeRegex(rules, "metricIntentExpenseRegex", CHAT_RUNTIME_RULES_DEFAULTS.metricIntentExpenseRegex).test(msg)) return "expense";
  if (runtimeRegex(rules, "metricIntentProfitRegex", CHAT_RUNTIME_RULES_DEFAULTS.metricIntentProfitRegex).test(msg)) return "profit";
  return null;
}

function classifyColumnMetricCategory(column = "") {
  const c = String(column || "").toLowerCase();
  if (!c) return null;
  if (/\b(revenue|sales|income|turnover)\b|выручк|доход|дохід|продаж/i.test(c)) return "revenue";
  if (/\b(expense|cost|spend|cogs|opex)\b|расход|витрат/i.test(c)) return "expense";
  if (/\b(profit|margin|ebit|ebitda)\b|прибут|прибыл/i.test(c)) return "profit";
  return null;
}

function isDriverRankingQuery(message = "", rules = CHAT_RUNTIME_RULES_DEFAULTS) {
  const msg = String(message || "").toLowerCase();
  const rankingIntent = runtimeRegex(rules, "driverRankingIntentRegex", CHAT_RUNTIME_RULES_DEFAULTS.driverRankingIntentRegex).test(msg);
  const valueIntent = runtimeRegex(rules, "driverValueIntentRegex", CHAT_RUNTIME_RULES_DEFAULTS.driverValueIntentRegex).test(msg);
  return rankingIntent && valueIntent;
}

function extractYearToken(message = "") {
  const m = String(message || "").match(/\b(19\d{2}|20\d{2})\b/);
  return m ? String(m[1]) : null;
}

function wantsRevenueIntent(message = "") {
  return /\b(revenue|sales|income|turnover|выручк|доход|дохід|продаж)\b/i.test(String(message || ""));
}

function wantsMostProfitableCustomer(message = "") {
  const msg = String(message || "").toLowerCase();
  return /\b(most\s+profitable\s+customer|profitable\s+customer|top\s+profitable\s+customers?)\b/.test(msg);
}

function findRevenueMetric(headers = []) {
  const list = Array.isArray(headers) ? headers : [];
  const prefs = [/net\s*revenue/i, /revenue\s*total/i, /\brevenue\b/i, /\bincome\b/i, /\bsales\b/i];
  for (const rx of prefs) {
    const hit = list.find((h) => rx.test(String(h || "")));
    if (hit) return hit;
  }
  return null;
}

function isHighConfidenceSqlHotPathQuery(message = "", rules = CHAT_RUNTIME_RULES_DEFAULTS) {
  const msg = String(message || "").toLowerCase();
  const op = inferAggregateOperationFromMessage(msg, {}, rules);
  if (op !== "sum") return false;
  if (isDriverRankingQuery(msg, rules)) return false;
  if (asksExplicitBreakdown(msg, rules)) return false;
  if (/\b(compare|comparison|versus|vs|yoy|year over year|trend|over time|monthly|quarterly)\b/i.test(msg)) return false;
  return true;
}

function resolveSqlHotPathMetricColumn({ message = "", headers = [], sampleRows = [], semanticProfile = null, rules = CHAT_RUNTIME_RULES_DEFAULTS }) {
  const intent = detectQueryMetricIntent(message, rules);
  const metricCandidates = [];
  if (intent === "revenue") metricCandidates.push("net revenue", "revenue total", "revenue", "income", "sales");
  if (intent === "expense") metricCandidates.push("expense", "expenses", "cost", "cogs", "opex", "spend");
  if (intent === "profit") metricCandidates.push("net profit", "profit total", "gross profit", "profit", "margin", "ebitda");
  const profileMetric = resolveProfileMetric(semanticProfile, message, metricCandidates);
  return profileMetric || inferLikelyMetricColumn(headers, sampleRows, message, metricCandidates);
}

function asksExplicitBreakdown(message = "", rules = CHAT_RUNTIME_RULES_DEFAULTS) {
  const msg = String(message || "").toLowerCase();
  return runtimeRegex(rules, "breakdownIntentRegex", CHAT_RUNTIME_RULES_DEFAULTS.breakdownIntentRegex).test(msg);
}

function inferLikelyMetricColumn(headers = [], sampleRows = [], message = "", candidates = []) {
  const headerList = Array.isArray(headers) ? headers : [];
  const sampleList = Array.isArray(sampleRows) ? sampleRows : [];
  const isUsableMetricColumn = (header) => {
    const name = String(header || "").toLowerCase();
    const samples = sampleList.slice(0, 20).map((row) => row?.[header]).filter((v) => v !== null && v !== undefined && String(v).trim() !== "");
    const numericHits = samples.filter((v) => toNum(v) !== null).length;
    const metricName = /\b(revenue|sales|income|profit|amount|total|cost|expense|spend|margin|balance|cash|budget|fee|tax|payment|order|qty|quantity|units?)\b/i.test(name);
    return metricName || numericHits >= Math.max(1, Math.ceil(samples.length / 3));
  };
  for (const candidate of (Array.isArray(candidates) ? candidates : []).map((c) => String(c || "").trim()).filter(Boolean)) {
    const exact = headerList.find((h) => String(h).trim().toLowerCase() === candidate.toLowerCase());
    if (exact && isUsableMetricColumn(exact)) return exact;
    const loose = headerList.find((h) => String(h).trim().toLowerCase().includes(candidate.toLowerCase()));
    if (loose && isUsableMetricColumn(loose)) return loose;
  }

  const msg = String(message || "").toLowerCase();
  const ranked = headerList
    .map((header) => {
      const samples = sampleList.slice(0, 20).map((row) => row?.[header]).filter((v) => v !== null && v !== undefined && String(v).trim() !== "");
      const numericHits = samples.filter((v) => toNum(v) !== null).length;
      const dateHits = samples.filter((v) => parseDateValue(v) !== null).length;
      const name = String(header || "").toLowerCase();
      const businessMatch = /\b(revenue|sales|income|profit|amount|total|cost|expense|spend|margin|balance|cash|budget|fee|tax|payment|order|qty|quantity|units?)\b/i.test(name)
        ? 6
        : 0;
      const messageMatch = /\b(revenue|sales|income|profit|amount|total|cost|expense|spend|margin|balance|cash|budget|fee|tax|payment|order|qty|quantity|units?)\b/i.test(msg)
        && /\b(revenue|sales|income|profit|amount|total|cost|expense|spend|margin|balance|cash|budget|fee|tax|payment|order|qty|quantity|units?)\b/i.test(name)
        ? 8
        : 0;
      return {
        header,
        score: (numericHits * 4) + businessMatch + messageMatch + (samples.length ? Math.min(samples.length, 8) : 0) - (dateHits * 3),
      };
    })
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.score > 0 ? ranked[0].header : null;
}

function inferLikelyDimensionColumn(headers = [], sampleRows = [], excludedColumns = []) {
  const headerList = Array.isArray(headers) ? headers : [];
  const excluded = new Set((Array.isArray(excludedColumns) ? excludedColumns : []).map((c) => String(c || "").toLowerCase()));
  const usable = headerList.filter((h) => !excluded.has(String(h || "").toLowerCase()));
  if (!usable.length) return null;

  const productLike = findProductLikeColumn(usable);
  if (productLike) return productLike;

  const ranked = usable
    .map((header) => {
      const samples = (Array.isArray(sampleRows) ? sampleRows : []).slice(0, 30).map((row) => row?.[header]).filter((v) => v !== null && v !== undefined && String(v).trim() !== "");
      if (!samples.length) return { header, score: 0 };
      const stringSamples = samples.filter((v) => typeof v === "string" && v.trim() !== "");
      const numericHits = samples.filter((v) => toNum(v) !== null).length;
      const dateHits = samples.filter((v) => parseDateValue(v) !== null).length;
      const uniqueCount = new Set(samples.map((v) => String(v).trim().toLowerCase())).size;
      const diversityScore = Math.min(uniqueCount, samples.length) / samples.length;
      const name = String(header || "").toLowerCase();
      const nameScore = /\b(customer|client|account|vendor|supplier|region|country|category|product|item|type|segment|department|team|owner|status)\b/i.test(name) ? 8 : 0;
      return {
        header,
        score: (stringSamples.length * 2) + (diversityScore * 10) + nameScore - (numericHits * 2) - (dateHits * 3),
      };
    })
    .sort((a, b) => b.score - a.score);

  return ranked[0]?.score > 0 ? ranked[0].header : null;
}

function enrichGroupedLabelWithName(groupBy = "", label = "", rows = []) {
  const group = String(groupBy || "").toLowerCase();
  const rawLabel = String(label || "").trim();
  if (!rawLabel) return rawLabel;
  const looksLikeIdGrouping = /\b(customer\s*id|client\s*id|account\s*id|id)\b/i.test(group);
  if (!looksLikeIdGrouping) return rawLabel;
  const match = (Array.isArray(rows) ? rows : []).find((r) => String(r?.[groupBy] ?? "").trim() === rawLabel);
  if (!match || typeof match !== "object") return rawLabel;
  const keys = Object.keys(match);
  const nameKey = keys.find((k) => /\b(customer\s*name|client\s*name|account\s*name|company|organization|org\s*name|name)\b/i.test(String(k || "")) && !/\bid\b/i.test(String(k || "")));
  if (!nameKey) return rawLabel;
  const name = String(match?.[nameKey] || "").trim();
  if (!name || name.toLowerCase() === rawLabel.toLowerCase()) return rawLabel;
  return `${name} (${rawLabel})`;
}

function inferLikelyPeriodColumn(headers = [], sampleRows = [], candidates = []) {
  const headerList = Array.isArray(headers) ? headers : [];
  const sampleList = Array.isArray(sampleRows) ? sampleRows : [];
  const normalizedCandidates = (Array.isArray(candidates) ? candidates : [])
    .map((c) => String(c || "").trim())
    .filter(Boolean);
  const seen = new Set();

  const classify = (header, samples) => {
    const name = String(header || "").toLowerCase();
    const sampleVals = Array.isArray(samples) ? samples : [];
    const yearHits = sampleVals.filter((v) => {
      const n = Number(String(v || "").trim());
      return Number.isInteger(n) && n >= 1900 && n <= 2200;
    }).length;
    const quarterHits = sampleVals.filter((v) => /^(q[1-4]|[1-4]\s*quarter|quarter\s*[1-4]|[ivx]{1,4}\s*quarter|[1-4]\s*квартал|q[1-4]\s*\d{4})$/i.test(String(v || "").trim())).length;
    const monthHits = sampleVals.filter((v) => parseDateValue(v) !== null && /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|янв|фев|мар|апр|май|июн|июл|авг|сен|окт|ноя|дек|січ|лют|бер|кві|трав|чер|лип|сер|вер|жов|лис|груд)/i.test(String(v || "").trim()) || /month/i.test(name)).length;
    const dateHits = sampleVals.filter((v) => parseDateValue(v) !== null).length;
    if (/year/i.test(name) || yearHits >= Math.max(2, Math.ceil(sampleVals.length / 2))) return { column: header, mode: "year" };
    if (/quarter/i.test(name) || quarterHits >= Math.max(2, Math.ceil(sampleVals.length / 2))) return { column: header, mode: "quarter" };
    if (/month|period/i.test(name) || monthHits >= Math.max(2, Math.ceil(sampleVals.length / 2))) return { column: header, mode: "month" };
    if (dateHits >= Math.max(2, Math.ceil(sampleVals.length / 2))) return { column: header, mode: "date" };
    return null;
  };

  for (const candidate of normalizedCandidates) {
    if (seen.has(candidate.toLowerCase())) continue;
    seen.add(candidate.toLowerCase());
    const resolved = headerList.find((h) => String(h).trim().toLowerCase() === candidate.toLowerCase())
      || headerList.find((h) => String(h).trim().toLowerCase().includes(candidate.toLowerCase()))
      || null;
    if (!resolved) continue;
    const samples = sampleList.slice(0, 20).map((row) => row?.[resolved]).filter((v) => v !== null && v !== undefined && String(v).trim() !== "");
    const classified = classify(resolved, samples);
    if (classified) return classified;
  }

  for (const header of headerList) {
    const samples = sampleList.slice(0, 20).map((row) => row?.[header]).filter((v) => v !== null && v !== undefined && String(v).trim() !== "");
    const classified = classify(header, samples);
    if (classified) return classified;
  }
  return null;
}

async function inferLikelyDateColumn(headers = [], sampleRows = [], candidates = []) {
  const headerList = Array.isArray(headers) ? headers : [];
  const sampleList = Array.isArray(sampleRows) ? sampleRows : [];
  const seen = new Set();
  const tryCandidate = async (candidate) => {
    const raw = String(candidate || "").trim();
    if (!raw || seen.has(raw.toLowerCase())) return null;
    seen.add(raw.toLowerCase());
    const resolved = headerList.find((h) => String(h).trim().toLowerCase() === raw.toLowerCase())
      || headerList.find((h) => String(h).trim().toLowerCase().includes(raw.toLowerCase()))
      || null;
    if (!resolved) return null;
    const samples = sampleList.slice(0, 20).map((row) => row?.[resolved]).filter((v) => v !== null && v !== undefined && String(v).trim() !== "");
    if (!samples.length) return null;
    const dateHits = samples.filter((v) => parseDateValue(v) !== null).length;
    return dateHits >= Math.max(2, Math.ceil(samples.length / 2)) ? resolved : null;
  };

  for (const candidate of candidates) {
    const hit = await tryCandidate(candidate);
    if (hit) return hit;
  }

  const hinted = headerList.filter((h) => looksLikeDateHeader(h));
  for (const candidate of hinted) {
    const hit = await tryCandidate(candidate);
    if (hit) return hit;
  }

  for (const header of headerList) {
    const hit = await tryCandidate(header);
    if (hit) return hit;
  }
  return null;
}

function buildChatWhereClause({ tabName = null, filters = [], rowFiltersList = [], startParamIndex = 1 }) {
  const params = [];
  let where = "WHERE sheet_id = $1";

  if (tabName) {
    where += ` AND tab_name = $${params.length + 2}`;
    params.push(tabName);
  }

  const rowFilterSql = buildRowFilterWhereClause(rowFiltersList, params.length + 2);
  if (rowFilterSql.sql) {
    where += rowFilterSql.sql;
    params.push(...rowFilterSql.params);
  }

  filters.forEach((f) => {
    if (!f?.column) return;
    if (f.operator === "in") {
      const values = Array.isArray(f.values) ? f.values.map((v) => String(v ?? "")).filter((v) => v !== "") : [];
      if (!values.length) return;
      const colIdx = params.length + 2;
      const valIdx = params.length + 3;
      params.push(f.column, values);
      where += ` AND ((row_data->>$${colIdx}) = ANY($${valIdx}::text[]))`;
      return;
    }
    if (f.value === undefined) return;

    let colSql = `row_data->>$${params.length + 2}`;
    if (f.column === "Year") colSql = `EXTRACT(YEAR FROM (CAST(row_data->>$${params.length + 2} AS DATE)))::text`;
    if (f.column === "Month") colSql = `TO_CHAR(CAST(row_data->>$${params.length + 2} AS DATE), 'Month')`;
    if (f.column === "Quarter") colSql = `'Q' || TO_CHAR(CAST(row_data->>$${params.length + 2} AS DATE), 'Q YYYY')`;

    const valIdx = params.length + 3;
    params.push(f.column === "Year" || f.column === "Month" || f.column === "Quarter" ? "Date" : f.column, String(f.value));
    const numericFilterVal = toNum(f.value);
    const dateFilterVal = toSqlDateLiteral(f.value);
    const isVirtualDateCol = f.column === "Year" || f.column === "Month" || f.column === "Quarter";
    const useDateComparators = !isVirtualDateCol && !!dateFilterVal && (
      looksLikeDateText(f.value) ||
      /date|time|day|month|year|period|quarter|дата|період|рік|год/i.test(String(f.column || ""))
    );
    const safeDateExpr = buildSqlSafeDateExpr(colSql);

    switch (f.operator) {
      case "year_equals":
        where += ` AND (
          CASE
            WHEN (${colSql}) ~ '^\\s*\\d{4}\\s*$' THEN CAST(TRIM(${colSql}) AS INT)
            WHEN (${colSql}) ~ '^\\s*\\d{4}[-/]\\d{2}[-/]\\d{2}\\s*$' THEN EXTRACT(YEAR FROM CAST(REPLACE(TRIM(${colSql}), '/', '-') AS DATE))::INT
            WHEN (${colSql}) ~ '^\\s*\\d{2}[-/]\\d{2}[-/]\\d{4}\\s*$' THEN CAST(RIGHT(TRIM(${colSql}), 4) AS INT)
            ELSE NULL
          END
        ) = $${valIdx}::int`;
        break;
      case "gt":
        if (useDateComparators) {
          params[params.length - 1] = dateFilterVal;
          where += ` AND (${safeDateExpr} > $${valIdx}::date)`;
        } else if (numericFilterVal !== null) {
          params[params.length - 1] = String(numericFilterVal);
          where += ` AND (${buildSqlSafeNumericExpr(colSql)} > $${valIdx}::numeric)`;
        } else {
          where += ` AND (${colSql} > $${valIdx})`;
        }
        break;
      case "gte":
        if (useDateComparators) {
          params[params.length - 1] = dateFilterVal;
          where += ` AND (${safeDateExpr} >= $${valIdx}::date)`;
        } else if (numericFilterVal !== null) {
          params[params.length - 1] = String(numericFilterVal);
          where += ` AND (${buildSqlSafeNumericExpr(colSql)} >= $${valIdx}::numeric)`;
        } else {
          where += ` AND (${colSql} >= $${valIdx})`;
        }
        break;
      case "lt":
        if (useDateComparators) {
          params[params.length - 1] = dateFilterVal;
          where += ` AND (${safeDateExpr} < $${valIdx}::date)`;
        } else if (numericFilterVal !== null) {
          params[params.length - 1] = String(numericFilterVal);
          where += ` AND (${buildSqlSafeNumericExpr(colSql)} < $${valIdx}::numeric)`;
        } else {
          where += ` AND (${colSql} < $${valIdx})`;
        }
        break;
      case "lte":
        if (useDateComparators) {
          params[params.length - 1] = dateFilterVal;
          where += ` AND (${safeDateExpr} <= $${valIdx}::date)`;
        } else if (numericFilterVal !== null) {
          params[params.length - 1] = String(numericFilterVal);
          where += ` AND (${buildSqlSafeNumericExpr(colSql)} <= $${valIdx}::numeric)`;
        } else {
          where += ` AND (${colSql} <= $${valIdx})`;
        }
        break;
      case "equals":
        where += ` AND (${colSql} = $${valIdx})`;
        break;
      default:
        where += ` AND (${colSql} ILIKE $${valIdx})`;
        params[params.length - 1] = `%${f.value}%`;
        break;
    }
  });

  return { where, params };
}

  return {
    detectQueryMetricIntent,
    classifyColumnMetricCategory,
    isDriverRankingQuery,
    extractYearToken,
    wantsRevenueIntent,
    wantsMostProfitableCustomer,
    findRevenueMetric,
    isHighConfidenceSqlHotPathQuery,
    resolveSqlHotPathMetricColumn,
    asksExplicitBreakdown,
    inferLikelyMetricColumn,
    inferLikelyDimensionColumn,
    enrichGroupedLabelWithName,
    inferLikelyPeriodColumn,
    inferLikelyDateColumn,
    buildChatWhereClause,
  };
}
