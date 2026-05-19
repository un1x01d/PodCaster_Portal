export function chatMidHelpersPart2(deps) {
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
  } = deps;

function stripApproximationWords(answer = "") {
  return String(answer || "")
    .replace(/\b(approximately|approx\.?|about)\b/gi, "")
    .replace(/\b(примерно|около)\b/gi, "")
    .replace(/\b(приблизно|близько)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function applyAnswerFormatDirectives(answer = "", message = "") {
  const out = String(answer || "");
  const msg = String(message || "").toLowerCase();
  const yearsAndPercentOnly =
    /\bonly show\b.*\byears?\b.*(%|percent)|\byears?\b.*(%|percent)\b.*\bonly\b|\bjust\b.*\byears?\b.*(%|percent)|\bpercent only\b|только.*(год|рок).*(%|процент)|лише.*(рік|роки).*(%|відсот)/i.test(msg);
  if (!yearsAndPercentOnly) return out;

  const lines = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const compact = [];
  for (const line of lines) {
    const m = line.match(/(\d{4})\s*(?:vs|\/|-|to)\s*(\d{4}).*?([+-]?\d+(?:\.\d+)?)\s*%/i);
    if (m) {
      const pct = Number(m[3]);
      if (Number.isFinite(pct)) compact.push(`${m[1]}: ${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`);
      continue;
    }
    const m2 = line.match(/(\d{4}).*?([+-]?\d+(?:\.\d+)?)\s*%/i);
    if (m2) {
      const pct = Number(m2[2]);
      if (Number.isFinite(pct)) compact.push(`${m2[1]}: ${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`);
    }
  }
  return compact.length ? compact.join("\n") : out;
}

function applyTimeWindowDirectives(answer = "", message = "") {
  const text = String(answer || "");
  const msg = String(message || "").toLowerCase();
  const m = msg.match(/\blast\s+(\d+)\s+years?\b|(?:за|останні|последние)\s+(\d+)\s+(?:рок|лет|years?)/i);
  const n = Number(m?.[1] || m?.[2] || 0);
  if (!Number.isFinite(n) || n < 2) return text;
  const lines = text.split(/\r?\n/);
  const yoyLines = lines.filter((l) => /\b\d{4}\s+vs\s+\d{4}\b/i.test(l));
  if (!yoyLines.length) return text;
  const keep = Math.max(1, n - 1);
  const sliced = yoyLines.slice(-keep);
  const prefix = lines.find((l) => /year over year|анализ год к году|аналіз рік до року|год к году/i.test(l)) || "";
  const rebuilt = [prefix, ...sliced].filter(Boolean).join("\n");
  return rebuilt || text;
}

function applyConversationalAnswerStyle(answer = "", message = "", locale = "en") {
  const text = String(answer || "").trim();
  if (!text) return text;
  const isUk = String(locale || "").toLowerCase().startsWith("uk");
  const isRu = String(locale || "").toLowerCase().startsWith("ru");
  const question = String(message || "").trim();

  const scalar = text.match(/^(Total|Average|Max|Min|Sum|Сумма|Сума|Среднее|Середнє|Максимум|Минимум)\s+([^:\n]+):\s+(.+)$/i);
  if (scalar) {
    const metric = String(scalar[2] || "").trim();
    const value = String(scalar[3] || "").trim();
    const year = extractYearToken(question);
    if (isUk) return year ? `Значення ${metric} за ${year} рік становить ${value}.` : `Значення ${metric} становить ${value}.`;
    if (isRu) return year ? `Значение ${metric} за ${year} год составляет ${value}.` : `Значение ${metric} составляет ${value}.`;
    return year ? `The ${metric} for ${year} is ${value}.` : `The ${metric} is ${value}.`;
  }

  const delta = text.match(/^Delta\s+(.+?)\s+\((\d{4})\s*-\s*(\d{4})\):\s+(.+)$/i);
  if (delta) {
    const metric = String(delta[1] || "").trim();
    const y2 = String(delta[2] || "").trim();
    const y1 = String(delta[3] || "").trim();
    const value = String(delta[4] || "").trim();
    if (isUk) return `Різниця ${metric} між ${y1} і ${y2} становить ${value}.`;
    if (isRu) return `Разница по ${metric} между ${y1} и ${y2} составляет ${value}.`;
    return `The difference in ${metric} between ${y1} and ${y2} is ${value}.`;
  }

  const bareNumeric = text.match(/^[-+]?[$€£¥]?\s*\d[\d,]*(?:\.\d+)?%?$/);
  if (bareNumeric) {
    const metricHint = extractMetricHintFromText(question);
    const year = extractYearToken(question);
    if (metricHint && year && !asksDifferenceBetweenYears(question)) {
      if (isUk) return `${metricHint} за ${year} рік становить ${text}.`;
      if (isRu) return `${metricHint} за ${year} год составляет ${text}.`;
      return `The ${metricHint} for ${year} was ${text}.`;
    }
  }
  if (bareNumeric && asksDifferenceBetweenYears(question)) {
    const years = Array.from(String(question || "").matchAll(/\b(19\d{2}|20\d{2})\b/g), (m) => String(m?.[0] || "")).filter(Boolean);
    const y1 = years[0] || "the first period";
    const y2 = years[1] || "the second period";
    if (isUk) return `Різниця між ${y1} і ${y2} становить ${text}.`;
    if (isRu) return `Разница между ${y1} и ${y2} составляет ${text}.`;
    return `The difference between ${y1} and ${y2} is ${text}.`;
  }

  const bareDriver = text.match(/^([^\n]+?)\s+\(([-+$€£¥\d,.\s]+)\)\s*$/);
  if (bareDriver && !/[.!?]$/.test(text)) {
    const name = String(bareDriver[1] || "").trim();
    const value = String(bareDriver[2] || "").trim();
    if (isUk) return `Найбільший внесок зробив ${name} (${value}).`;
    if (isRu) return `Наибольший вклад внес ${name} (${value}).`;
    return `The largest driver was ${name} (${value}).`;
  }

  const yoyIntent = /\b(yoy|year over year|year-over-year)\b/i.test(question);
  const yearlyRows = text
    .split(/\r?\n/)
    .map((line) => String(line || "").trim().replace(/^[•*-]\s*/, ""))
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^(\d{4})\s*:\s*([$€£¥]?\s*[-+]?\d[\d,]*(?:\.\d+)?)/);
      if (!m) return null;
      return { year: m[1], value: m[2].replace(/\s+/g, " ").trim() };
    })
    .filter(Boolean);
  if (yearlyRows.length >= 2 && yoyIntent) {
    const metricHint = extractMetricHintFromText(question) || "value";
    if (isUk) {
      return yearlyRows.map((r) => `${metricHint} за ${r.year} рік становив ${r.value}.`).join("\n");
    }
    if (isRu) {
      return yearlyRows.map((r) => `${metricHint} за ${r.year} год составил ${r.value}.`).join("\n");
    }
    return yearlyRows.map((r) => `The ${metricHint} for ${r.year} was ${r.value}.`).join("\n");
  }

  return text;
}

function appendSkippedRowsNote(answer = "", skippedRows = 0, locale = "en") {
  const skipped = Number(skippedRows || 0);
  if (!Number.isFinite(skipped) || skipped <= 0) return String(answer || "");
  const lang = String(locale || "en").toLowerCase();
  if (lang.startsWith("uk")) return `${String(answer || "")} (Пропущено нечислових рядків: ${skipped})`;
  if (lang.startsWith("ru")) return `${String(answer || "")} (Пропущено нечисловых строк: ${skipped})`;
  return `${String(answer || "")} (Skipped non-numeric rows: ${skipped})`;
}

function isClarificationOrApologyAnswer(answer = "") {
  const text = String(answer || "").toLowerCase();
  return /(^|\b)(i apologize|sorry|please confirm|please clarify|which metric|what metric|cannot answer|can't answer|do not have a clear|no clear requested metric)\b/i.test(text)
    || /(будь ласка,\s*підтверд|яку метрик|немає чітк|вибач|уточніть|підтвердіть)/i.test(text)
    || /(пожалуйста,\s*подтверд|какую метрик|нет четк|извин|уточните|подтвердите)/i.test(text);
}

function looksLikeDateHeader(header = "") {
  return /date|time|day|month|year|period|quarter/i.test(String(header));
}

function detectDateSyntax(value) {
  const s = String(value || "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return "YYYY-MM-DD";
  if (/^\d{2}-\d{2}-\d{4}$/.test(s)) {
    const [a, b] = s.split("-").map(Number);
    if (a > 12 && b <= 12) return "DD-MM-YYYY";
    if (b > 12 && a <= 12) return "MM-DD-YYYY";
    return "MM-DD-YYYY or DD-MM-YYYY";
  }
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
    const [a, b] = s.split("/").map(Number);
    if (a > 12 && b <= 12) return "DD/MM/YYYY";
    if (b > 12 && a <= 12) return "MM/DD/YYYY";
    return "MM/DD/YYYY or DD/MM/YYYY";
  }
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(s)) return "YYYY/MM/DD";
  if (/^[A-Za-z]{3,9}\s+\d{1,2},\s+\d{4}$/.test(s)) return "Month DD, YYYY";
  return null;
}

function buildDateFormatHints(headers = [], rows = []) {
  const hints = [];
  headers.forEach((h) => {
    if (!looksLikeDateHeader(h)) return;
    const values = rows
      .slice(0, 300)
      .map((r) => r?.[h])
      .filter((v) => v !== null && v !== undefined && String(v).trim() !== "");
    if (!values.length) return;
    const bySyntax = new Map();
    values.forEach((v) => {
      const syntax = detectDateSyntax(v);
      if (!syntax) return;
      bySyntax.set(syntax, (bySyntax.get(syntax) || 0) + 1);
    });
    const winner = Array.from(bySyntax.entries()).sort((a, b) => b[1] - a[1])[0];
    if (!winner) return;
    hints.push({
      column: h,
      syntax: winner[0],
      example: String(values.find((v) => detectDateSyntax(v) === winner[0]) || values[0]),
    });
  });
  return hints;
}

function restrictSemanticProfileToHeaders(profile, headers, sampleRows = []) {
  const allowed = new Set((Array.isArray(headers) ? headers : []).map((h) => String(h)));
  const hasStoredProfile = profile && typeof profile === "object" && !Array.isArray(profile) && Array.isArray(profile.columns);
  const base = hasStoredProfile ? profile : buildSheetSemanticProfile({ headers, sampleRows });
  const keepColumn = (value) => {
    const text = String(value || "").trim();
    return text && allowed.has(text) ? text : null;
  };
  const defaults = base?.defaults && typeof base.defaults === "object" ? base.defaults : {};
  const metricColumns = {};
  Object.entries(defaults.metricColumns || {}).forEach(([meaning, column]) => {
    const safeColumn = keepColumn(column);
    if (safeColumn) metricColumns[meaning] = safeColumn;
  });
  return {
    ...base,
    defaults: {
      ...defaults,
      metricColumns,
      dateColumn: keepColumn(defaults.dateColumn),
      driverDimensionColumn: keepColumn(defaults.driverDimensionColumn),
      dimensions: Array.isArray(defaults.dimensions) ? defaults.dimensions.map(keepColumn).filter(Boolean) : [],
      metrics: Array.isArray(defaults.metrics) ? defaults.metrics.map(keepColumn).filter(Boolean) : [],
    },
    columns: (Array.isArray(base.columns) ? base.columns : []).filter((col) => keepColumn(col?.name)),
  };
}

function compactSemanticProfileForPrompt(profile) {
  return {
    defaults: profile?.defaults || {},
    columns: (Array.isArray(profile?.columns) ? profile.columns : []).map((col) => ({
      name: col.name,
      roles: col.roles || [],
      meanings: col.meanings || [],
      confidence: col.confidence,
    })),
  };
}

function uniqueColumnSamples(rows = [], header, limit = HEADER_AI_SAMPLE_VALUES_PER_COLUMN) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const raw = row?.[header];
    const value = String(raw ?? "").trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value.slice(0, 120));
    if (out.length >= limit) break;
  }
  return out;
}

function buildHeaderAiContext(headers = [], rows = []) {
  const limitedRows = Array.isArray(rows) ? rows.slice(0, HEADER_AI_SAMPLE_ROWS) : [];
  return (Array.isArray(headers) ? headers : []).map((header) => ({
    header: String(header),
    sample_values: uniqueColumnSamples(limitedRows, header, HEADER_AI_SAMPLE_VALUES_PER_COLUMN),
  }));
}

function applyHeaderUnderstandingToProfile(profile = {}, headerUnderstanding = []) {
  const base = profile && typeof profile === "object" ? profile : {};
  const next = { ...base };
  const columns = Array.isArray(base.columns) ? base.columns.map((c) => ({ ...c, roles: Array.isArray(c.roles) ? [...c.roles] : [], meanings: Array.isArray(c.meanings) ? [...c.meanings] : [] })) : [];
  const defaults = { ...(base.defaults || {}) };
  const metricColumns = { ...(defaults.metricColumns || {}) };
  const dimensions = new Set(Array.isArray(defaults.dimensions) ? defaults.dimensions : []);
  const metrics = new Set(Array.isArray(defaults.metrics) ? defaults.metrics : []);
  let dateColumn = defaults.dateColumn || null;
  let serviceLineColumn = defaults.serviceLineColumn || null;
  let revenueModelColumn = defaults.revenueModelColumn || null;
  let driverDimensionColumn = defaults.driverDimensionColumn || null;

  const byName = new Map(columns.map((c) => [String(c.name), c]));
  for (const item of (Array.isArray(headerUnderstanding) ? headerUnderstanding : [])) {
    const header = String(item?.header || "").trim();
    if (!header || !byName.has(header)) continue;
    const col = byName.get(header);
    const meaning = String(item?.meaning || "").trim();
    const role = String(item?.role || "").trim();
    if (meaning && !col.meanings.includes(meaning)) col.meanings.push(meaning);
    if (role && !col.roles.includes(role)) col.roles.push(role);
    if (role === "metric") metrics.add(header);
    if (role === "dimension") dimensions.add(header);
    if (role === "date" && !dateColumn) dateColumn = header;
    if (meaning === "revenue") metricColumns.revenue = metricColumns.revenue || header;
    if (meaning === "cost") metricColumns.cost = metricColumns.cost || header;
    if (meaning === "profit") metricColumns.profit = metricColumns.profit || header;
    if (meaning === "quantity") metricColumns.quantity = metricColumns.quantity || header;
    if (meaning === "serviceLine") serviceLineColumn = serviceLineColumn || header;
    if (meaning === "revenueModel") revenueModelColumn = revenueModelColumn || header;
    if (!driverDimensionColumn && (meaning === "serviceLine" || meaning === "product" || meaning === "customer" || meaning === "category" || meaning === "region")) {
      driverDimensionColumn = header;
    }
  }

  next.columns = columns;
  next.defaults = {
    ...defaults,
    metricColumns,
    dateColumn,
    serviceLineColumn,
    revenueModelColumn,
    driverDimensionColumn,
    dimensions: Array.from(dimensions).slice(0, 20),
    metrics: Array.from(metrics).slice(0, 20),
  };
  next.learned = {
    ...(base.learned || {}),
    header_understanding: Array.isArray(headerUnderstanding) ? headerUnderstanding : [],
    header_understanding_updated_at: new Date().toISOString(),
  };
  return next;
}

async function inferHeaderUnderstandingWithAi({ headers = [], sampleRows = [], runtime = null }) {
  const { provider, model, baseUrl, apiKey } = resolveChatCompletionProviderConfig(runtime || {});
  if (!apiKey) return [];
  const context = buildHeaderAiContext(headers, sampleRows);
  if (!context.length) return [];
  const system = [
    "Classify spreadsheet headers for deterministic analytics.",
    "Use only provided header names and sample values.",
    "Return strict JSON only.",
    "Allowed meanings: revenue,cost,profit,quantity,customer,serviceLine,revenueModel,product,region,category,owner,period,other",
    "Allowed roles: metric,dimension,date,id,other",
  ].join(" ");
  const user = JSON.stringify({
    task: "Map each header to at most one meaning and one role.",
    headers: context,
    output_schema: {
      mappings: [{ header: "string", meaning: "string", role: "string", confidence: "0..1" }],
    },
  });
  const requestBody = buildChatCompletionRequestBody({
    model,
    provider,
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    responseFormat: { type: "json_object" },
    maxCompletionTokens: minCompletionTokensForModel(model, 800, 800, 768),
    temperature: 0,
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(runtime?.openaiTimeoutMs || OPENAI_TIMEOUT_MS));
  try {
    const response = await fetch(`${String(baseUrl).replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
    if (!response.ok) return [];
    const payload = await response.json().catch(() => ({}));
    const raw = String(extractOpenAiAssistantText(payload) || "").trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const mappings = Array.isArray(parsed?.mappings) ? parsed.mappings : [];
    const headerSet = new Set((Array.isArray(headers) ? headers : []).map((h) => String(h)));
    return mappings
      .map((m) => ({
        header: String(m?.header || "").trim(),
        meaning: String(m?.meaning || "other").trim(),
        role: String(m?.role || "other").trim(),
        confidence: Math.max(0, Math.min(1, Number(m?.confidence || 0))),
      }))
      .filter((m) => m.header && headerSet.has(m.header));
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function ensureAiHeaderUnderstanding({ sheetId, headers = [], sampleRows = [], semanticProfile = {}, runtime = null }) {
  const hasExisting = Array.isArray(semanticProfile?.learned?.header_understanding) && semanticProfile.learned.header_understanding.length > 0;
  if (hasExisting) {
    return applyHeaderUnderstandingToProfile(semanticProfile, semanticProfile.learned.header_understanding);
  }
  const inferred = await inferHeaderUnderstandingWithAi({ headers, sampleRows, runtime });
  if (!inferred.length) return semanticProfile;
  const nextProfile = applyHeaderUnderstandingToProfile(semanticProfile, inferred);
  try {
    await query(
      `UPDATE sheets
          SET semantic_profile = $2::jsonb,
              semantic_profile_updated_at = CURRENT_TIMESTAMP
        WHERE id = $1`,
      [sheetId, JSON.stringify(nextProfile)]
    );
  } catch {}
  return nextProfile;
}

  return {
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
  };
}
