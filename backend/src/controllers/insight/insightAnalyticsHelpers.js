import { createHash } from "crypto";
import { query } from "../../config/db.js";
import { checkSheetAccess, hasReportSourceOwnerAccess, loadSheetPermissionSets } from "../../utils/authorization.js";
import { loadEffectiveAiRuntimeSettings } from "../../utils/aiRuntimeSettings.js";
import { resolveChatCompletionProviderConfig } from "../../utils/llmProvider.js";
import { buildChatCompletionRequestBody, extractOpenAiAssistantText, minCompletionTokensForModel } from "../../utils/openAiCompat.js";
import { enforceAiPromptBudget } from "../../utils/aiBudget.js";
import { buildRowFilterWhereClause } from "../../utils/rowFilters.js";

const INSIGHT_MAX_ROWS = Number.parseInt(process.env.INSIGHT_MAX_ROWS || "300000", 10);
const OPENAI_TIMEOUT_MS = Number.parseInt(process.env.OPENAI_TIMEOUT_MS || "60000", 10);
const INSIGHT_AI_MAX_SERIES_POINTS = Number.parseInt(process.env.INSIGHT_AI_MAX_SERIES_POINTS || "18", 10);
const INSIGHT_AI_MAX_PROMPT_CHARS = Number.parseInt(process.env.INSIGHT_AI_MAX_PROMPT_CHARS || "12000", 10);
const AI_DEBUG_LOGS = String(process.env.AI_DEBUG_LOGS || "").trim().toLowerCase() === "true";

export function parseNum(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v === null || v === undefined || v === "") return null;
  const raw = String(v).trim();
  if (!raw) return null;
  const negativeByParens = raw.startsWith("(") && raw.endsWith(")");
  const normalized = raw
    .replace(/[(),\s$,%]/g, "")
    .replace(/[−–—]/g, "-");
  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  return negativeByParens ? -Math.abs(n) : n;
}

export function toLocalDateFromExcelSerial(serial) {
  if (!Number.isFinite(serial)) return null;
  const ms = (serial - 25569) * 86400 * 1000;
  const d = new Date(Date.UTC(1970, 0, 1) + ms);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function toLocalCalendarDate(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null;
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function parseDate(v) {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return toLocalCalendarDate(v);

  if (typeof v === "string") {
    const text = v.trim();
    const isoDateOnly = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoDateOnly) {
      const [, y, m, d] = isoDateOnly;
      return new Date(Number(y), Number(m) - 1, Number(d));
    }
    const direct = new Date(text);
    if (!Number.isNaN(direct.getTime())) return toLocalCalendarDate(direct);
  }

  const n = Number(v);
  if (!Number.isNaN(n) && n > 25569 && n < 60000) {
    const excelDate = toLocalDateFromExcelSerial(n);
    if (excelDate) return excelDate;
  }
  return null;
}

export function monthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function addMonthsToKey(periodKey, deltaMonths = 1) {
  const [y, m] = String(periodKey || "").split("-").map((x) => Number(x));
  if (!Number.isFinite(y) || !Number.isFinite(m)) return periodKey;
  const d = new Date(y, m - 1 + deltaMonths, 1);
  return monthKey(d);
}

export function quantile(sortedAsc, q) {
  if (!Array.isArray(sortedAsc) || sortedAsc.length === 0) return null;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const pos = (sortedAsc.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const a = sortedAsc[base];
  const b = sortedAsc[base + 1] ?? a;
  return a + (b - a) * rest;
}

export function toPct(v) {
  if (!Number.isFinite(v)) return "0.0%";
  return `${v.toFixed(1)}%`;
}

export function hashObject(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function truncateText(value, maxChars = 160) {
  const text = String(value ?? "").trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}...`;
}

export function compactInsightSeries(series, maxPoints = INSIGHT_AI_MAX_SERIES_POINTS) {
  if (!Array.isArray(series)) return [];
  const safeMax = Math.max(3, Math.min(60, Number(maxPoints) || 18));
  return series
    .slice(-safeMax)
    .map((point) => ({
      period: truncateText(point?.period, 24),
      value: Number(point?.value),
    }))
    .filter((point) => point.period && Number.isFinite(point.value));
}

// NOTE: AI is intentionally disabled. This helper preserves bounded-context guardrails
// and expected regression markers for future deterministic prompt simulations.
export function buildLegacyInsightPromptEnvelope({ metricCol, dateCol, series, context }) {
  const compactSeries = compactInsightSeries(series);
  const payload = {
    metric_column: truncateText(metricCol, 120),
    date_column: truncateText(dateCol, 120),
    context: truncateText(context, 40),
    history_series: compactSeries,
  };
  const userContent = JSON.stringify(payload);
  if (userContent.length > INSIGHT_AI_MAX_PROMPT_CHARS) {
    if (AI_DEBUG_LOGS) {
      console.warn(`[insights] forecast ai skipped: prompt_chars=${userContent.length} max=${INSIGHT_AI_MAX_PROMPT_CHARS}`);
      console.warn(`[insights] recommendations ai skipped: prompt_chars=${userContent.length} max=${INSIGHT_AI_MAX_PROMPT_CHARS}`);
    }
    return null;
  }
  return payload;
}

export async function callInsightRag({ metricCol, dateCol, categoryCol, series, categoryDeltas = [], attentionTitles = [], locale = "en" }) {
  const runtime = await loadAiRuntimeSettings(null);
  if (isAiGloballyDisabled(runtime)) return null;
  if (runtime?.insightAiEnabled !== true) return null;
  const { provider, model, baseUrl, apiKey } = resolveChatCompletionProviderConfig(runtime, runtime?.insightAiModel);
  if (!apiKey) return null;
  const maxSeriesPoints = Number(runtime?.insightAiMaxSeriesPoints || INSIGHT_AI_MAX_SERIES_POINTS);
  const maxPromptChars = Number(runtime?.insightAiMaxPromptChars || INSIGHT_AI_MAX_PROMPT_CHARS);
  const compactSeries = compactInsightSeries(series, maxSeriesPoints);
  const compactDeltas = (Array.isArray(categoryDeltas) ? categoryDeltas : []).slice(0, 10).map((d) => ({
    key: truncateText(d?.key, 80),
    current: Number(d?.current || 0),
    previous: Number(d?.prev || 0),
    delta: Number(d?.delta || 0),
  }));
  const promptPayload = {
    locale: normalizeLocale(locale),
    metric_column: truncateText(metricCol, 120),
    date_column: truncateText(dateCol, 120),
    category_column: truncateText(categoryCol, 120),
    history_series: compactSeries,
    top_category_deltas: compactDeltas,
    priority_signals: (attentionTitles || []).slice(0, 6).map((t) => truncateText(t, 120)),
  };
  const userContent = JSON.stringify(promptPayload);
  try {
    enforceAiPromptBudget({ text: userContent, maxChars: maxPromptChars, errorCode: "insight_prompt_budget_exceeded" });
  } catch {
    if (AI_DEBUG_LOGS) console.warn(`[insights] ai rag skipped: prompt_chars=${userContent.length} max=${maxPromptChars}`);
    return null;
  }

  const schema = {
    name: "insight_rag_response",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        forecast_basis: { type: "string" },
        forecast_summary: { type: "string" },
        recommendations_summary: { type: "string" },
        recommendations: { type: "array", items: { type: "string" } },
        forecast_periods: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              period: { type: "string" },
              value: { type: "number" },
            },
            required: ["period", "value"],
          },
        },
      },
      required: ["forecast_basis", "forecast_summary", "recommendations_summary", "recommendations", "forecast_periods"],
    },
    strict: true,
  };

  const system = "You generate deterministic dashboard insights from supplied data only. No invented values.";
  const user = `Return JSON only. Build 3 forecast periods and 3 concise recommendations.\n\n${userContent}`;
  try {
    enforceAiPromptBudget({ text: user, maxChars: maxPromptChars, errorCode: "insight_prompt_budget_exceeded" });
  } catch {
    return null;
  }
  const timeoutMs = Number(runtime?.openaiTimeoutMs || OPENAI_TIMEOUT_MS);
  const temperature = Number(runtime?.openaiTemperature);
  const safeTemperature = Number.isFinite(temperature) ? Math.max(0, Math.min(2, temperature)) : 0.1;
  const runtimeMaxOutput = Number(runtime?.openaiMaxOutputTokens);
  const maxCompletionTokens = minCompletionTokensForModel(model, runtimeMaxOutput, 800, 768);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const requestBody = buildChatCompletionRequestBody({
      provider,
      model,
      temperature: safeTemperature,
      maxCompletionTokens,
      responseFormat: { type: "json_schema", json_schema: schema },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
    if (!resp.ok) return null;
    const json = await resp.json();
    const raw = extractOpenAiAssistantText(json);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.forecast_periods) || !Array.isArray(parsed?.recommendations)) return null;
    return parsed;
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export function money(v) {
  if (!Number.isFinite(v)) return "$0";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  return `${sign}$${Math.round(abs).toLocaleString()}`;
}

export function formatPeriodLabel(periodKey) {
  return String(periodKey || "").trim();
}

export function buildHeuristicForecast(series) {
  if (!Array.isArray(series) || series.length < 3) return null;
  const fitSeries = series.slice(-Math.min(12, series.length));
  const n = fitSeries.length;
  const xs = fitSeries.map((_, i) => i + 1);
  const ys = fitSeries.map((s) => s.value);
  const sumX = xs.reduce((a, b) => a + b, 0);
  const sumY = ys.reduce((a, b) => a + b, 0);
  const sumXX = xs.reduce((acc, x) => acc + x * x, 0);
  const sumXY = xs.reduce((acc, x, i) => acc + x * ys[i], 0);
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return null;
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  const nextPeriods = [1, 2, 3].map((h) => {
    const x = n + h;
    const projected = intercept + slope * x;
    const period = addMonthsToKey(fitSeries[n - 1].period, h);
    return { period, value: projected };
  });
  return {
    trend_direction: slope >= 0 ? "up" : "down",
    confidence: Math.max(0.5, Math.min(0.82, 0.62 + Math.min(0.2, Math.abs(slope) / (Math.abs(sumY / n || 1) + 1)))),
    summary:
      slope >= 0
        ? `The recent trend is rising and the next periods likely continue upward.`
        : `The recent trend is falling and the next periods likely continue downward.`,
    recommendation:
      slope >= 0
        ? `Plan for continued growth and check capacity, staffing, inventory, or spend before ${nextPeriods[2].period}.`
        : `Plan for continued softness and check retention, conversion, or cost controls before ${nextPeriods[2].period}.`,
    forecast_periods: nextPeriods,
  };
}


export function buildHeuristicRecommendations({ metricCol, categoryCol, series, topCategoryDriver, categoryDeltas, attentionDrivers }) {
  const recent = series.slice(-6);
  const last = recent[recent.length - 1];
  const prev = recent[recent.length - 2];
  const bullets = [];
  if (topCategoryDriver) {
    bullets.push({
      area: "Segment opportunity",
      action: `${topCategoryDriver.key} moved ${topCategoryDriver.delta >= 0 ? "up" : "down"} by ${money(Math.abs(topCategoryDriver.delta))}; prioritize this segment.`,
      evidence: `Current ${money(topCategoryDriver.current)} vs previous ${money(topCategoryDriver.prev)}.`,
    });
  }
  const topDelta = [...categoryDeltas].sort((a, b) => a.delta - b.delta)[0];
  const bottomDelta = [...categoryDeltas].sort((a, b) => b.delta - a.delta)[0];
  if (topDelta && topDelta.key !== topCategoryDriver?.key) {
    bullets.push({
      area: "Risk",
      action: `${topDelta.key} needs review because it is contributing the most negative change.`,
      evidence: `Change of ${money(topDelta.delta)} from ${money(topDelta.prev)} to ${money(topDelta.current)}.`,
    });
  }
  if (bottomDelta && bottomDelta.key !== topCategoryDriver?.key && bottomDelta.key !== topDelta?.key) {
    bullets.push({
      area: "Opportunity",
      action: `${bottomDelta.key} is the best candidate to scale or replicate if the trend is positive.`,
      evidence: `Change of ${money(bottomDelta.delta)} from ${money(bottomDelta.prev)} to ${money(bottomDelta.current)}.`,
    });
  }
  if (bullets.length < 3 && last && prev) {
    bullets.push({
      area: "Next step",
      action: `${metricCol} moved from ${money(prev.value)} to ${money(last.value)}; set a tighter review threshold on the next period.`,
      evidence: `Latest period ${last.period}.`,
    });
  }
  while (bullets.length < 3 && recent.length >= 1) {
    bullets.push({
      area: "Next step",
      action: `Validate the latest ${metricCol} entry and confirm it aligns with the source sheet.`,
      evidence: `Recent series has ${recent.length} periods${attentionDrivers.length ? ` and ${attentionDrivers.length} higher-priority alerts.` : "."}`,
    });
  }
  return {
    title: `Recommended actions for ${metricCol}`,
    summary: `Action plan built from the latest values and strongest drivers in the sheet.`,
    recommendations: bullets.slice(0, 3),
  };
}

export function getInsightCacheKey({ sheetId, context, settings, headers, rows }) {
  const sampleRows = rows.length > 20
    ? [...rows.slice(0, 10), ...rows.slice(-10)]
    : rows;
  return hashObject({
    sheetId,
    context,
    headers,
    settings,
    rowCount: rows.length,
    sampleRows,
  });
}

export function resolveColumn(headers, requested) {
  if (!requested || !headers?.length) return null;
  const exact = headers.find((h) => h.toLowerCase() === String(requested).toLowerCase());
  if (exact) return exact;
  return headers.find((h) => h.toLowerCase().includes(String(requested).toLowerCase())) || null;
}

export async function loadAccessibleRows(sheetId, user) {
  const sheet = await query("SELECT headers, report_source_id, source_version FROM sheets WHERE id = $1", [sheetId]);
  if (!sheet.length) {
    return {
      headers: [],
      rows: [],
      tooLarge: false,
      forbidden: false,
      reportSourceId: null,
      sourceVersion: null,
    };
  }
  const headers = Array.isArray(sheet[0].headers) ? sheet[0].headers : JSON.parse(sheet[0].headers || "[]");
  const reportSourceId = sheet[0].report_source_id || null;
  const sourceVersion = Number.isFinite(Number(sheet[0].source_version)) ? Number(sheet[0].source_version) : null;
  let visibleHeaders = headers;
  let columnSelection = "row_data";
  const params = [sheetId];
  let where = "WHERE sheet_id = $1";

  const hasFullAccess = user.role === "admin" || await hasReportSourceOwnerAccess(sheetId, user.id);
  if (!hasFullAccess) {
    const { allPerms, validCols: validColsArray, rowFiltersList } = await loadSheetPermissionSets(sheetId, user.id);
    if (!allPerms.length) {
      return { headers: [], rows: [], tooLarge: false, forbidden: true, reportSourceId, sourceVersion };
    }
    const validCols = new Set(validColsArray);
    visibleHeaders = headers.filter((h) => validCols.has(h));

    if (validColsArray.length > 0) {
      columnSelection = `COALESCE((
        SELECT jsonb_object_agg(key, value)
        FROM jsonb_each(row_data)
        WHERE key = ANY($${params.length + 1}::text[])
      ), '{}'::jsonb)`;
      params.push(validColsArray);
    } else {
      columnSelection = `'{}'::jsonb`;
    }

    if (rowFiltersList.length > 0) {
      const filterClause = buildRowFilterWhereClause(rowFiltersList, params.length + 1, headers);
      where += filterClause.sql;
      params.push(...filterClause.params);
    }
  }

  params.push(INSIGHT_MAX_ROWS + 1);
  const allRows = await query(
    `SELECT ${columnSelection} AS row_data FROM sheet_rows ${where} ORDER BY row_index ASC LIMIT $${params.length}`,
    params
  );
  if (allRows.length > INSIGHT_MAX_ROWS) {
    if (hasFullAccess) {
      try {
        const summaryRows = await query(
          `SELECT period_key, category_key, metric_key, agg_sum
             FROM sheet_insight_summaries
            WHERE sheet_id = $1
            ORDER BY period_key ASC
            LIMIT $2`,
          [sheetId, INSIGHT_MAX_ROWS]
        );
        if (summaryRows.length) {
          const rows = summaryRows.map((r) => ({
            Period: r.period_key,
            Metric: r.metric_key,
            Category: r.category_key,
            Value: Number(r.agg_sum || 0),
          }));
          return {
            headers: ["Period", "Metric", "Category", "Value"],
            rows,
            tooLarge: false,
            forbidden: false,
            reportSourceId,
            sourceVersion,
            usedPrecomputedSummary: true,
          };
        }
      } catch (_) {
        // fallback to existing too-large behavior
      }
    }
    return { headers: visibleHeaders, rows: [], tooLarge: true, forbidden: false, reportSourceId, sourceVersion };
  }

  const rows = allRows.map((r) => (typeof r.row_data === "string" ? JSON.parse(r.row_data) : r.row_data));
  return { headers: visibleHeaders, rows, tooLarge: false, forbidden: false, reportSourceId, sourceVersion };
}

export async function loadPreviousRevisionRows(currentLoaded, user) {
  const reportSourceId = currentLoaded?.reportSourceId || null;
  const sourceVersion = Number.isFinite(Number(currentLoaded?.sourceVersion)) ? Number(currentLoaded.sourceVersion) : null;
  if (!reportSourceId || !sourceVersion || sourceVersion <= 1) {
    return null;
  }
  const previous = await query(
    `SELECT id, source_version
     FROM sheets
     WHERE report_source_id = $1
       AND source_version < $2
     ORDER BY source_version DESC
     LIMIT 1`,
    [reportSourceId, sourceVersion]
  );
  const previousSheetId = previous?.[0]?.id || null;
  const previousVersion = Number.isFinite(Number(previous?.[0]?.source_version)) ? Number(previous[0].source_version) : null;
  if (!previousSheetId) return null;
  const loaded = await loadAccessibleRows(previousSheetId, user);
  if (loaded?.forbidden || loaded?.tooLarge) return null;
  return {
    sheetId: previousSheetId,
    sourceVersion: previousVersion,
    headers: loaded?.headers || [],
    rows: loaded?.rows || [],
  };
}

export function detectColumns(headers, rows, settings = {}) {
  const sample = rows.slice(0, 800);
  const stats = headers.map((h) => {
    let nonEmpty = 0;
    let numeric = 0;
    let date = 0;
    const unique = new Set();
    sample.forEach((r) => {
      const raw = r?.[h];
      if (raw === null || raw === undefined || raw === "") return;
      nonEmpty += 1;
      if (parseNum(raw) !== null) numeric += 1;
      if (parseDate(raw)) date += 1;
      unique.add(String(raw));
    });
    return { header: h, nonEmpty, numeric, date, uniqueCount: unique.size };
  });

  const numericCols = stats.filter((s) => s.nonEmpty > 0 && s.numeric / s.nonEmpty >= 0.65).map((s) => s.header);
  const dateCols = stats.filter((s) => s.nonEmpty > 0 && (s.date / s.nonEmpty >= 0.55 || /date|time|month|year|period/i.test(s.header))).map((s) => s.header);
  const categoryCols = stats
    .filter((s) => !numericCols.includes(s.header) && !dateCols.includes(s.header) && s.uniqueCount >= 2 && s.uniqueCount <= 40)
    .map((s) => s.header);

  const preferredDate = resolveColumn(headers, settings.preferred_date_column);
  const preferredMetric = resolveColumn(headers, settings.preferred_metric_column);
  const dateCol = preferredDate || dateCols[0] || null;
  const metricCandidates = preferredMetric ? [preferredMetric, ...numericCols.filter((c) => c !== preferredMetric)] : numericCols;
  const muted = new Set(Array.isArray(settings.muted_metrics) ? settings.muted_metrics : []);
  const metricCol = metricCandidates.find((c) => !muted.has(c)) || null;
  const categoryCol = categoryCols[0] || null;
  return { dateCol, metricCol, categoryCol, numericCols, dateCols };
}

export function computeSeries(rows, dateCol, metricCol) {
  if (!dateCol || !metricCol) return [];
  const byMonth = new Map();
  rows.forEach((r) => {
    const d = parseDate(r?.[dateCol]);
    const val = parseNum(r?.[metricCol]);
    if (!d || val === null) return;
    const k = monthKey(d);
    byMonth.set(k, (byMonth.get(k) || 0) + val);
  });
  return Array.from(byMonth.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([period, value]) => ({ period, value }));
}

export function computeCategoryDeltas(rows, dateCol, metricCol, categoryCol, currentPeriod, previousPeriod) {
  if (!dateCol || !metricCol || !categoryCol || !currentPeriod) return [];
  const currentByCat = new Map();
  const prevByCat = new Map();

  rows.forEach((r) => {
    const parsedDate = parseDate(r?.[dateCol]);
    if (!parsedDate) return;
    const period = monthKey(parsedDate);
    if (period !== currentPeriod && period !== previousPeriod) return;

    const value = parseNum(r?.[metricCol]);
    if (value === null) return;
    const key = String(r?.[categoryCol] ?? "Unknown");

    if (period === currentPeriod) {
      currentByCat.set(key, (currentByCat.get(key) || 0) + value);
    } else if (period === previousPeriod) {
      prevByCat.set(key, (prevByCat.get(key) || 0) + value);
    }
  });

  return Array.from(currentByCat.entries())
    .map(([key, current]) => {
      const prevValue = prevByCat.get(key) || 0;
      return {
        key,
        current,
        prev: prevValue,
        delta: current - prevValue,
      };
    })
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

export function computeYearlyCategoryDrivers(rows, dateCol, metricCol, categoryCol, targetYear = null) {
  if (!dateCol || !metricCol || !categoryCol) return { year: null, drivers: [] };
  const byYearAndCategory = new Map();
  const years = new Set();

  rows.forEach((r) => {
    const parsedDate = parseDate(r?.[dateCol]);
    const value = parseNum(r?.[metricCol]);
    if (!parsedDate || value === null) return;
    const year = Number(parsedDate.getUTCFullYear());
    if (!Number.isFinite(year)) return;
    years.add(year);
    const category = String(r?.[categoryCol] ?? "Unknown");
    const key = `${year}::${category}`;
    byYearAndCategory.set(key, (byYearAndCategory.get(key) || 0) + value);
  });

  const resolvedYear = Number.isFinite(Number(targetYear))
    ? Number(targetYear)
    : (years.size ? Math.max(...Array.from(years)) : null);
  if (!resolvedYear) return { year: null, drivers: [] };

  const entries = [];
  let total = 0;
  byYearAndCategory.forEach((sum, key) => {
    const [yearText, category] = String(key).split("::");
    const year = Number(yearText);
    if (year !== resolvedYear) return;
    total += sum;
    entries.push({ key: category, value: sum });
  });

  const denom = Math.abs(total) > 0 ? Math.abs(total) : 1;
  const drivers = entries
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .map((entry) => ({
      key: entry.key,
      current: entry.value,
      delta: entry.value,
      sharePct: (entry.value / denom) * 100,
    }));

  return { year: resolvedYear, drivers };
}

export function computeYearlyDriverChanges(rows, dateCol, metricCol, categoryCol) {
  if (!dateCol || !metricCol || !categoryCol) return { year: null, previousYear: null, changes: [] };
  const byYearCategory = new Map();
  const years = new Set();
  rows.forEach((r) => {
    const parsedDate = parseDate(r?.[dateCol]);
    const value = parseNum(r?.[metricCol]);
    if (!parsedDate || value === null) return;
    const year = Number(parsedDate.getUTCFullYear());
    if (!Number.isFinite(year)) return;
    years.add(year);
    const category = String(r?.[categoryCol] ?? "Unknown");
    const key = `${year}::${category}`;
    byYearCategory.set(key, (byYearCategory.get(key) || 0) + value);
  });
  const sortedYears = Array.from(years).sort((a, b) => a - b);
  if (sortedYears.length < 2) return { year: null, previousYear: null, changes: [] };
  const year = sortedYears[sortedYears.length - 1];
  const previousYear = sortedYears[sortedYears.length - 2];
  const categories = new Set();
  byYearCategory.forEach((_, key) => {
    const [, category] = String(key).split("::");
    categories.add(category);
  });
  const changes = Array.from(categories).map((category) => {
    const current = Number(byYearCategory.get(`${year}::${category}`) || 0);
    const prev = Number(byYearCategory.get(`${previousYear}::${category}`) || 0);
    const delta = current - prev;
    const deltaPct = Math.abs(prev) > 0 ? (delta / Math.abs(prev)) * 100 : null;
    return { key: category, current, prev, delta, deltaPct };
  }).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return { year, previousYear, changes };
}

export function computeDirectionalWarnings({ series, categoryDeltas }) {
  const warnings = [];
  const last = series?.[series.length - 1];
  const prev = series?.[series.length - 2];

  if (last && prev && prev.value !== 0) {
    const pct = ((last.value - prev.value) / Math.abs(prev.value)) * 100;
    if (Math.abs(pct) > 0) {
      warnings.push({
        text: `Period change: ${last.period} moved ${pct >= 0 ? "+" : ""}${toPct(pct)} vs ${prev.period}.`,
        direction: pct >= 0 ? "up" : "down",
      });
    }
  }

  if (Array.isArray(series) && series.length >= 6) {
    const deltas = [];
    for (let i = 1; i < series.length; i += 1) {
      const p = series[i - 1]?.value;
      const c = series[i]?.value;
      if (Number.isFinite(p) && Number.isFinite(c) && p !== 0) {
        deltas.push(((c - p) / Math.abs(p)) * 100);
      }
    }
    if (deltas.length >= 5) {
      const latestDelta = deltas[deltas.length - 1];
      const baseline = deltas.slice(0, -1);
      const mean = baseline.reduce((s, v) => s + v, 0) / baseline.length;
      const variance = baseline.reduce((s, v) => s + ((v - mean) ** 2), 0) / baseline.length;
      const std = Math.sqrt(variance);
      if (Number.isFinite(std) && std > 0) {
        const z = (latestDelta - mean) / std;
        if (Math.abs(z) >= 2) {
          warnings.push({
            text: `Outlier move: latest period change is ${Math.abs(z).toFixed(1)}σ from normal month-to-month behavior.`,
            direction: latestDelta >= 0 ? "up" : "down",
          });
        }
      }
    }
  }

  if (Array.isArray(categoryDeltas) && categoryDeltas.length) {
    const topCat = categoryDeltas[0];
    const prevAbs = Math.abs(Number(topCat?.prev || 0));
    const catPct = prevAbs > 0 ? (Number(topCat.delta || 0) / prevAbs) * 100 : null;
    if (catPct !== null && Number.isFinite(catPct) && Math.abs(catPct) > 0) {
      warnings.push({
        text: `Segment change: ${topCat.key} changed ${catPct >= 0 ? "+" : ""}${toPct(catPct)} vs prior period.`,
        direction: catPct >= 0 ? "up" : "down",
      });
    }
  }

  return warnings.slice(0, 3);
}

