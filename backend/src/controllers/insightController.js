import { createHash } from "crypto";
import { query } from "../config/db.js";
import { isEnglishLocale, normalizeLocale, translateDashboardCards } from "../utils/dashboardLocalization.js";
import { checkSheetAccess, hasReportSourceOwnerAccess, loadSheetPermissionSets } from "../utils/authorization.js";

const INSIGHT_MAX_ROWS = Number.parseInt(process.env.INSIGHT_MAX_ROWS || "300000", 10);
const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const OPENAI_TIMEOUT_MS = Number.parseInt(process.env.OPENAI_TIMEOUT_MS || "60000", 10);
const INSIGHT_AI_MAX_SERIES_POINTS = Number.parseInt(process.env.INSIGHT_AI_MAX_SERIES_POINTS || "18", 10);
const INSIGHT_AI_MAX_PROMPT_CHARS = Number.parseInt(process.env.INSIGHT_AI_MAX_PROMPT_CHARS || "12000", 10);
const INSIGHT_CACHE = new Map();
const INSIGHT_CACHE_TTL_MS = Number.parseInt(process.env.INSIGHT_CACHE_TTL_MS || `${10 * 60 * 1000}`, 10);
const INSIGHT_CACHE_MAX_ENTRIES = Number.parseInt(process.env.INSIGHT_CACHE_MAX_ENTRIES || "200", 10);
const INSIGHT_TRANSLATION_CACHE = new Map();
const INSIGHT_TRANSLATION_CACHE_MAX_ENTRIES = Number.parseInt(process.env.INSIGHT_TRANSLATION_CACHE_MAX_ENTRIES || "1000", 10);
const INSIGHT_TRANSLATION_CACHE_SETTINGS_KEY = "insight_translation_cache_settings";
const DEFAULT_INSIGHT_TRANSLATION_CACHE_TTL_MS = Number.parseInt(
  process.env.INSIGHT_TRANSLATION_CACHE_TTL_MS || `${60 * 60 * 1000}`,
  10
);
const INSIGHT_TRANSLATION_SETTINGS_LOCAL_TTL_MS = Number.parseInt(
  process.env.INSIGHT_TRANSLATION_SETTINGS_LOCAL_TTL_MS || `${60 * 1000}`,
  10
);
let INSIGHT_TRANSLATION_SETTINGS_LOCAL_CACHE = {
  loadedAt: 0,
  value: { ttlMs: DEFAULT_INSIGHT_TRANSLATION_CACHE_TTL_MS },
};

function getInsightCacheEntry(cacheKey) {
  const found = INSIGHT_CACHE.get(cacheKey);
  if (!found) return null;
  if (Date.now() > Number(found.expiresAt || 0)) {
    INSIGHT_CACHE.delete(cacheKey);
    return null;
  }
  return found.payload;
}

function setInsightCacheEntry(cacheKey, payload) {
  INSIGHT_CACHE.set(cacheKey, { payload, expiresAt: Date.now() + INSIGHT_CACHE_TTL_MS });
  while (INSIGHT_CACHE.size > INSIGHT_CACHE_MAX_ENTRIES) {
    const oldest = INSIGHT_CACHE.keys().next().value;
    if (!oldest) break;
    INSIGHT_CACHE.delete(oldest);
  }
}

function parseBooleanLike(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "y";
}

function clampInsightTranslationCacheTtlMs(valueMs) {
  const parsed = Number.parseInt(String(valueMs || ""), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_INSIGHT_TRANSLATION_CACHE_TTL_MS;
  return Math.max(60 * 1000, Math.min(24 * 60 * 60 * 1000, parsed));
}

async function loadInsightTranslationCacheSettings() {
  const now = Date.now();
  if (now - Number(INSIGHT_TRANSLATION_SETTINGS_LOCAL_CACHE.loadedAt || 0) <= INSIGHT_TRANSLATION_SETTINGS_LOCAL_TTL_MS) {
    return INSIGHT_TRANSLATION_SETTINGS_LOCAL_CACHE.value;
  }
  try {
    const rows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [INSIGHT_TRANSLATION_CACHE_SETTINGS_KEY]);
    const raw = rows?.[0]?.value;
    const ttlMinutes = Number.parseInt(String(raw?.ttlMinutes ?? ""), 10);
    const ttlMs = clampInsightTranslationCacheTtlMs(Number.isFinite(ttlMinutes) ? ttlMinutes * 60 * 1000 : DEFAULT_INSIGHT_TRANSLATION_CACHE_TTL_MS);
    INSIGHT_TRANSLATION_SETTINGS_LOCAL_CACHE = {
      loadedAt: now,
      value: { ttlMs },
    };
  } catch (_) {
    INSIGHT_TRANSLATION_SETTINGS_LOCAL_CACHE = {
      loadedAt: now,
      value: { ttlMs: DEFAULT_INSIGHT_TRANSLATION_CACHE_TTL_MS },
    };
  }
  return INSIGHT_TRANSLATION_SETTINGS_LOCAL_CACHE.value;
}

function makeInsightTranslationCacheKey({ cacheKey, locale, context = "dashboard" }) {
  return `${cacheKey}::${normalizeLocale(locale)}::${String(context || "dashboard")}`;
}

function getInsightTranslationCacheEntry(cacheKey) {
  const found = INSIGHT_TRANSLATION_CACHE.get(cacheKey);
  if (!found) return null;
  if (Date.now() > Number(found.expiresAt || 0)) {
    INSIGHT_TRANSLATION_CACHE.delete(cacheKey);
    return null;
  }
  return found.cards;
}

function setInsightTranslationCacheEntry(cacheKey, cards, ttlMs) {
  INSIGHT_TRANSLATION_CACHE.set(cacheKey, {
    cards,
    expiresAt: Date.now() + clampInsightTranslationCacheTtlMs(ttlMs),
  });
  while (INSIGHT_TRANSLATION_CACHE.size > INSIGHT_TRANSLATION_CACHE_MAX_ENTRIES) {
    const oldest = INSIGHT_TRANSLATION_CACHE.keys().next().value;
    if (!oldest) break;
    INSIGHT_TRANSLATION_CACHE.delete(oldest);
  }
}

function clearInsightTranslationCacheByPrefix(prefix) {
  for (const key of INSIGHT_TRANSLATION_CACHE.keys()) {
    if (String(key).startsWith(prefix)) {
      INSIGHT_TRANSLATION_CACHE.delete(key);
    }
  }
}

async function localizeInsightCards({ locale, cards, context, cacheKey, forceRefresh = false }) {
  if (isEnglishLocale(locale)) return cards;
  const normalizedLocale = normalizeLocale(locale);
  const translationCacheKey = makeInsightTranslationCacheKey({ cacheKey, locale: normalizedLocale, context });
  if (!forceRefresh) {
    const cached = getInsightTranslationCacheEntry(translationCacheKey);
    if (cached) return cached;
  }
  const translatedCards = await translateDashboardCards({
    locale: normalizedLocale,
    cards: cards || [],
    context: "insight-cards",
  });
  const settings = await loadInsightTranslationCacheSettings();
  setInsightTranslationCacheEntry(translationCacheKey, translatedCards, settings.ttlMs);
  return translatedCards;
}

function parseNum(v) {
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

function toLocalDateFromExcelSerial(serial) {
  if (!Number.isFinite(serial)) return null;
  const ms = (serial - 25569) * 86400 * 1000;
  const d = new Date(Date.UTC(1970, 0, 1) + ms);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toLocalCalendarDate(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null;
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function parseDate(v) {
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

function monthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function addMonthsToKey(periodKey, deltaMonths = 1) {
  const [y, m] = String(periodKey || "").split("-").map((x) => Number(x));
  if (!Number.isFinite(y) || !Number.isFinite(m)) return periodKey;
  const d = new Date(y, m - 1 + deltaMonths, 1);
  return monthKey(d);
}

function quantile(sortedAsc, q) {
  if (!Array.isArray(sortedAsc) || sortedAsc.length === 0) return null;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const pos = (sortedAsc.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const a = sortedAsc[base];
  const b = sortedAsc[base + 1] ?? a;
  return a + (b - a) * rest;
}

function toPct(v) {
  if (!Number.isFinite(v)) return "0.0%";
  return `${v.toFixed(1)}%`;
}

function hashObject(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function truncateText(value, maxChars = 160) {
  const text = String(value ?? "").trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}...`;
}

function compactInsightSeries(series, maxPoints = INSIGHT_AI_MAX_SERIES_POINTS) {
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

function buildSeriesStats(series) {
  const values = Array.isArray(series)
    ? series.map((point) => Number(point?.value)).filter(Number.isFinite)
    : [];
  const first = Array.isArray(series) && series.length ? series[0] : null;
  const latest = Array.isArray(series) && series.length ? series[series.length - 1] : null;
  return {
    total_periods: Array.isArray(series) ? series.length : 0,
    first_period: first ? { period: truncateText(first.period, 24), value: Number(first.value) } : null,
    latest_period: latest ? { period: truncateText(latest.period, 24), value: Number(latest.value) } : null,
    min_value: values.length ? Math.min(...values) : null,
    max_value: values.length ? Math.max(...values) : null,
  };
}

function buildRowFilterWhereClause(rowFiltersList = [], startParamIndex = 1) {
  const normalized = Array.isArray(rowFiltersList) ? rowFiltersList : [];
  const hasAllowAll = normalized.some((f) => !f || Object.keys(f).length === 0);
  if (hasAllowAll) return { sql: "", params: [] };

  const groups = [];
  const params = [];
  let paramIdx = startParamIndex;
  normalized.forEach((filters) => {
    const entries = Object.entries(filters || {}).filter(([k]) => !!k);
    if (!entries.length) return;
    const predicates = entries.map(([k, v]) => {
      params.push(k, String(v));
      const sql = `(row_data->>$${paramIdx}) = $${paramIdx + 1}`;
      paramIdx += 2;
      return sql;
    });
    if (predicates.length) groups.push(`(${predicates.join(" AND ")})`);
  });
  if (!groups.length) return { sql: " AND 1 = 0", params };
  return { sql: ` AND (${groups.join(" OR ")})`, params };
}

function money(v) {
  if (!Number.isFinite(v)) return "$0";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  return `${sign}$${Math.round(abs).toLocaleString()}`;
}

function formatPeriodLabel(periodKey) {
  return String(periodKey || "").trim();
}

function buildHeuristicForecast(series) {
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

async function callOpenAIInsightForecast({ metricCol, dateCol, series, context }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
  try {
    const compactSeries = compactInsightSeries(series);
    const payload = {
      metric_column: truncateText(metricCol, 120),
      date_column: truncateText(dateCol, 120),
      context: truncateText(context, 40),
      history_series: compactSeries,
      historical_summary: buildSeriesStats(series),
      instructions: [
        "Forecast the next 3 periods using the compact recent trend and aggregate history stats provided.",
        "Return JSON only.",
        "The periods should match the same monthly period format as the input series.",
        "Base the decision on the provided trend pattern and summary stats, not raw rows.",
        "Write a concise recommendation aimed at an operator or analyst.",
        "Explain the trend basis with a short phrase, such as sustained rise, sustained decline, flat range, or mixed volatility.",
        "Do not mention that you are an AI model."
      ],
      output_schema: {
        trend_direction: "up|down|flat",
        confidence: "number",
        summary: "string",
        trend_basis: "string",
        recommendation: "string",
        forecast_periods: [{ period: "string", value: "number" }]
      }
    };
    const userContent = JSON.stringify(payload);
    if (userContent.length > INSIGHT_AI_MAX_PROMPT_CHARS) {
      console.warn(`[insights] forecast ai skipped: prompt_chars=${userContent.length} max=${INSIGHT_AI_MAX_PROMPT_CHARS}`);
      return null;
    }

    const isReasoningModel = OPENAI_MODEL.startsWith("o");
    const resp = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: isReasoningModel ? 1 : 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              "You are a forecasting assistant for spreadsheet analytics.",
              "Return only valid JSON.",
              "Base predictions only on the full spreadsheet history provided.",
              "Use the historical trend pattern to justify the forecast decision.",
              "Make the recommendation specific and actionable."
            ].join(" "),
          },
          { role: "user", content: userContent },
        ],
      }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`openai_error_${resp.status}: ${body.slice(0, 400)}`);
    }

    const json = await resp.json();
    const content = json?.choices?.[0]?.message?.content || "{}";
    return JSON.parse(content);
  } catch (e) {
    console.error("insight forecast ai failed:", e?.message || e);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function callOpenAIInsightRecommendations({
  metricCol,
  dateCol,
  categoryCol,
  series,
  context,
  topCategoryDriver,
  categoryDeltas,
  attentionDrivers,
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
  try {
    const recentSeries = compactInsightSeries(series, 6);
    const latestPoint = series[series.length - 1] || null;
    const previousPoint = series[series.length - 2] || null;
    const payload = {
      metric_column: truncateText(metricCol, 120),
      date_column: truncateText(dateCol, 120),
      category_column: categoryCol ? truncateText(categoryCol, 120) : null,
      context: truncateText(context, 40),
      summary: {
        latest_point: latestPoint ? { period: truncateText(latestPoint.period, 24), value: Number(latestPoint.value) } : null,
        previous_point: previousPoint ? { period: truncateText(previousPoint.period, 24), value: Number(previousPoint.value) } : null,
        latest_period: latestPoint?.period || null,
        latest_value: latestPoint?.value ?? null,
        recent_series: recentSeries,
        historical_summary: buildSeriesStats(series),
        top_category_driver: topCategoryDriver || null,
        category_deltas: categoryDeltas.slice(0, 5).map((item) => ({
          key: truncateText(item?.key, 120),
          current: Number(item?.current),
          prev: Number(item?.prev),
          delta: Number(item?.delta),
        })),
        attention_titles: attentionDrivers.slice(0, 3).map((card) => truncateText(card.title, 160)),
      },
      instructions: [
        "You are a senior business analyst.",
        "Return only valid JSON.",
        "Write 3 distinct recommendations based on the provided data.",
        "Each recommendation must focus on a different thing if possible: one risk or problem to fix, one segment or driver to act on, and one operational control or next step.",
        "Anchor the recommendations on the latest spreadsheet period and its immediate prior period.",
        "Do not repeat a forecast or restate the projection.",
        "Use concrete values and column names from the data.",
        "Avoid vague advice like 'monitor closely' unless it is paired with a specific reason and action.",
      ],
      output_schema: {
        title: "string",
        summary: "string",
        recommendations: [{
          area: "string",
          action: "string",
          evidence: "string"
        }]
      }
    };
    const userContent = JSON.stringify(payload);
    if (userContent.length > INSIGHT_AI_MAX_PROMPT_CHARS) {
      console.warn(`[insights] recommendations ai skipped: prompt_chars=${userContent.length} max=${INSIGHT_AI_MAX_PROMPT_CHARS}`);
      return null;
    }

    const isReasoningModel = OPENAI_MODEL.startsWith("o");
    const resp = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: isReasoningModel ? 1 : 0.25,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              "You are an analyst that converts spreadsheet data into specific business recommendations.",
              "Return only JSON.",
              "Do not repeat forecast language or restate the chart.",
              "Use the latest spreadsheet period as the primary anchor for the recommendation.",
              "Return exactly 3 recommendations with distinct focus areas: one risk/problem, one segment/driver opportunity, and one operational next step.",
              "Tie each recommendation to exact values, segments, or periods from the supplied summary.",
              "Use concise, concrete phrasing. No vague advice.",
            ].join(" "),
          },
          { role: "user", content: userContent },
        ],
      }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`openai_error_${resp.status}: ${body.slice(0, 400)}`);
    }

    const json = await resp.json();
    const content = json?.choices?.[0]?.message?.content || "{}";
    return JSON.parse(content);
  } catch (e) {
    console.error("insight recommendations ai failed:", e?.message || e);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function buildHeuristicRecommendations({ metricCol, categoryCol, series, topCategoryDriver, categoryDeltas, attentionDrivers }) {
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

function getInsightCacheKey({ sheetId, context, settings, headers, rows }) {
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

function resolveColumn(headers, requested) {
  if (!requested || !headers?.length) return null;
  const exact = headers.find((h) => h.toLowerCase() === String(requested).toLowerCase());
  if (exact) return exact;
  return headers.find((h) => h.toLowerCase().includes(String(requested).toLowerCase())) || null;
}

async function loadAccessibleRows(sheetId, user) {
  const sheet = await query("SELECT headers FROM sheets WHERE id = $1", [sheetId]);
  if (!sheet.length) return { headers: [], rows: [], tooLarge: false, forbidden: false };
  const headers = Array.isArray(sheet[0].headers) ? sheet[0].headers : JSON.parse(sheet[0].headers || "[]");
  let visibleHeaders = headers;
  let columnSelection = "row_data";
  const params = [sheetId];
  let where = "WHERE sheet_id = $1";

  const hasFullAccess = user.role === "admin" || await hasReportSourceOwnerAccess(sheetId, user.id);
  if (!hasFullAccess) {
    const { allPerms, validCols: validColsArray, rowFiltersList } = await loadSheetPermissionSets(sheetId, user.id);
    if (!allPerms.length) return { headers: [], rows: [], tooLarge: false, forbidden: true };
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
      const filterClause = buildRowFilterWhereClause(rowFiltersList, params.length + 1);
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
    return { headers: visibleHeaders, rows: [], tooLarge: true, forbidden: false };
  }

  const rows = allRows.map((r) => (typeof r.row_data === "string" ? JSON.parse(r.row_data) : r.row_data));
  return { headers: visibleHeaders, rows, tooLarge: false, forbidden: false };
}

function detectColumns(headers, rows, settings = {}) {
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

function computeSeries(rows, dateCol, metricCol) {
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

function computeCategoryDeltas(rows, dateCol, metricCol, categoryCol, currentPeriod, previousPeriod) {
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

async function buildInsights({ rows, headers, settings, context }) {
  const out = [];
  const detected = detectColumns(headers, rows, settings);
  const { dateCol, metricCol, categoryCol } = detected;
  let categoryDeltas = [];
  let topCategoryDriver = null;
  if (!metricCol || !dateCol) {
    return {
      cards: [{
        id: "ins-no-temporal",
        type: "status",
        title: "Not enough structured data for automatic insights",
        bullets: [
          "Need at least one date-like column and one numeric metric column.",
          "You can set preferred columns in Insight Settings.",
        ],
        impact: "low",
        urgency: "low",
        confidence: 0.6,
        relevance: 1.0,
        score: 0.2,
        graph: { labels: [], values: [] },
        actions: null,
      }],
      detected,
    };
  }

  const series = computeSeries(rows, dateCol, metricCol);
  const minImpact = Number(settings.min_impact_percent ?? 5);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];

  if (last) {
    const recentGraph = series.slice(-Math.min(6, series.length));
    const changePct = last && prev && prev.value !== 0 ? ((last.value - prev.value) / Math.abs(prev.value)) * 100 : null;
    const snapshotBullets = [
      `Latest period: ${last.period} at ${money(last.value)}.`,
    ];
    if (prev) {
      snapshotBullets.push(
        `Recent change: ${prev.period} to ${last.period}${changePct !== null ? ` (${changePct >= 0 ? "+" : ""}${toPct(changePct)}).` : "."}`
      );
    }
    snapshotBullets.push(`Based on ${series.length} historical periods in the sheet.`);
    out.push({
      id: "ins-snapshot",
      type: "status",
      title: `${metricCol} snapshot`,
      bullets: snapshotBullets,
      impact: "low",
      urgency: "low",
      confidence: 0.88,
      relevance: 1.0,
      score: 0.9,
      graph: {
        labels: recentGraph.map((p) => p.period),
        values: recentGraph.map((p) => p.value),
      },
      actions: {
        chart: { dateColumn: dateCol, valueColumn: metricCol, segmentBy: null, aggregation: "sum" },
      },
    });
  }

  if (last && prev && prev.value !== 0) {
    const delta = last.value - prev.value;
    const deltaPct = (delta / Math.abs(prev.value)) * 100;
    if (Math.abs(deltaPct) >= minImpact) {
      out.push({
        id: "ins-change-alert",
        type: "change_alert",
        title: `${metricCol} ${delta >= 0 ? "increased" : "decreased"} ${toPct(Math.abs(deltaPct))} vs prior month`,
        bullets: [
          `Current period (${last.period}): ${money(last.value)}`,
          `Previous period (${prev.period}): ${money(prev.value)}`,
          `Absolute delta: ${delta >= 0 ? "+" : "-"}${money(Math.abs(delta))}`,
        ],
        impact: Math.abs(deltaPct) >= 20 ? "high" : "medium",
        urgency: Math.abs(deltaPct) >= 15 ? "high" : "medium",
        confidence: 0.92,
        relevance: context === "dashboard" ? 1 : 0.9,
        score: Math.min(1, (Math.abs(deltaPct) / 100) * 0.65 + 0.3),
        delta,
        deltaPct,
        direction: delta >= 0 ? "up" : "down",
        graph: {
          labels: [prev.period, last.period],
          values: [prev.value, last.value],
        },
        actions: {
          chart: { dateColumn: dateCol, valueColumn: metricCol, segmentBy: null, aggregation: "sum" },
          saveViewName: `${metricCol} trend (${last.period})`,
        },
      });
    }
  }

  if (categoryCol && last) {
    categoryDeltas = computeCategoryDeltas(rows, dateCol, metricCol, categoryCol, last.period, prev?.period || null);

    if (categoryDeltas.length) {
      const top = categoryDeltas[0];
      topCategoryDriver = top;
        out.push({
          id: "ins-driver",
          type: "driver_breakdown",
          title: `Top driver: ${top.key} (${metricCol})`,
          bullets: [
          `${top.key} changed by ${top.delta >= 0 ? "+" : "-"}${money(Math.abs(top.delta))} vs prior period.`,
          `Current value: ${money(top.current)}${prev ? ` | Previous: ${money(top.prev)}` : ""}`,
          `This is the largest contributor in ${categoryCol}.`,
        ],
          impact: Math.abs(top.delta) > 0 ? "medium" : "low",
          urgency: "medium",
          confidence: 0.88,
          relevance: 0.95,
          score: 0.7,
          delta: top.delta,
          direction: top.delta >= 0 ? "up" : "down",
          graph: {
            labels: prev ? [prev.period, last.period] : [last.period],
            values: prev ? [top.prev, top.current] : [top.current],
          },
        actions: {
          filter: { column: categoryCol, value: top.key },
          chart: { dateColumn: dateCol, valueColumn: metricCol, segmentBy: categoryCol, aggregation: "sum" },
          saveViewName: `${top.key} driver view`,
        },
      });
    }
  }

  const thresholds = settings.thresholds && typeof settings.thresholds === "object" ? settings.thresholds : {};
  if (last && Number.isFinite(Number(thresholds[metricCol]))) {
    const threshold = Number(thresholds[metricCol]);
    const breached = last.value < threshold;
    if (breached) {
        out.push({
          id: "ins-threshold",
          type: "threshold_breach",
          title: `${metricCol} is below threshold`,
          bullets: [
          `Latest value (${last.period}) is ${money(last.value)}.`,
          `Configured threshold is ${money(threshold)}.`,
          `Gap to threshold: ${money(threshold - last.value)}.`,
        ],
          impact: "medium",
          urgency: "high",
          confidence: 0.95,
          relevance: 1.0,
          score: 0.82,
          direction: "down",
          graph: {
            labels: ["Threshold", "Latest"],
            values: [threshold, last.value],
          },
        actions: {
          chart: { dateColumn: dateCol, valueColumn: metricCol, segmentBy: null, aggregation: "sum" },
          saveViewName: `${metricCol} threshold watch`,
        },
      });
    }
  }

  if (series.length >= 3) {
    const aiForecast = (await callOpenAIInsightForecast({ metricCol, dateCol, series, context })) || buildHeuristicForecast(series);
    if (aiForecast?.forecast_periods?.length >= 3) {
      const history = series.slice(-Math.min(6, series.length));
      const forecastPeriods = aiForecast.forecast_periods.slice(0, 3).map((p, idx) => ({
        period: formatPeriodLabel(p.period) || addMonthsToKey(history[history.length - 1].period, idx + 1),
        value: Number(p.value),
      })).filter((p) => Number.isFinite(p.value));
      if (forecastPeriods.length >= 3) {
        const forecastGraphLabels = [...history.map((point) => point.period), ...forecastPeriods.map((point) => point.period)];
        const forecastGraphValues = [...history.map((point) => point.value), ...forecastPeriods.map((point) => point.value)];
        const first = forecastPeriods[0];
        const third = forecastPeriods[2];
        const summaryText = typeof aiForecast.summary === "string" && aiForecast.summary.trim()
          ? aiForecast.summary.trim()
          : `Forecast indicates ${aiForecast.trend_direction || "directional"} movement over the next three periods.`;
        const basisText = typeof aiForecast.trend_basis === "string" && aiForecast.trend_basis.trim()
          ? aiForecast.trend_basis.trim()
          : `Based on ${series.length} historical periods from the spreadsheet.`;
        const confidence = Number.isFinite(Number(aiForecast.confidence))
          ? Math.max(0.5, Math.min(0.99, Number(aiForecast.confidence)))
          : 0.74;

        out.push({
          id: "ins-projection",
          type: "ai_projection",
          title: `AI projection for ${metricCol} (next 3 periods)`,
          bullets: [
            basisText,
            summaryText,
            `Projected ${first.period}: ${money(first.value)}.`,
            `Projected ${third.period}: ${money(third.value)}.`,
          ],
          impact: "medium",
          urgency: "medium",
          confidence,
          relevance: 0.94,
          score: 0.98,
          projectedDelta: third.value - history[history.length - 1].value,
          projectedPct: history[history.length - 1].value !== 0
            ? ((third.value - history[history.length - 1].value) / Math.abs(history[history.length - 1].value)) * 100
            : null,
          direction: third.value >= history[history.length - 1].value ? "up" : "down",
          graph: {
            labels: forecastGraphLabels,
            values: forecastGraphValues,
            forecastStartIndex: history.length,
          },
          actions: {
            chart: { dateColumn: dateCol, valueColumn: metricCol, segmentBy: null, aggregation: "sum" },
          },
        });
      }
    }
  }

  const attentionDrivers = out
    .filter((card) => {
      if (card.type === "change_alert") return Number(card.delta || 0) < 0;
      if (card.type === "ai_projection") {
        const projectedPct = Number(card.projectedPct);
        return Number(card.projectedDelta || 0) < 0 && Number.isFinite(projectedPct) && projectedPct <= -minImpact;
      }
      return false;
    })
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
    .slice(0, 3);
  const recentGraph = series.slice(-Math.min(6, series.length));

  const aiRecommendations = (await callOpenAIInsightRecommendations({
    metricCol,
    dateCol,
    categoryCol,
    series,
    context,
    topCategoryDriver,
    categoryDeltas,
    attentionDrivers,
  })) || buildHeuristicRecommendations({
    metricCol,
    categoryCol,
    series,
    topCategoryDriver,
    categoryDeltas,
    attentionDrivers,
  });

  if (aiRecommendations) {
    const recBullets = Array.isArray(aiRecommendations.recommendations) && aiRecommendations.recommendations.length
      ? aiRecommendations.recommendations.slice(0, 3).map((item) => {
          const area = String(item?.area || "Action").trim();
          const action = String(item?.action || "").trim();
          const evidence = String(item?.evidence || "").trim();
          return evidence ? `${area}: ${action} (${evidence})` : `${area}: ${action}`;
        }).filter(Boolean)
      : [];
    if (!recBullets.length) {
      recBullets.push("No recommendation items were returned.");
    }
    const latestPoint = series[series.length - 1] || null;
    const priorPoint = series[series.length - 2] || null;
    const latestLabel = latestPoint?.period ? `Latest period: ${latestPoint.period} at ${money(latestPoint.value)}.` : "Latest spreadsheet period unavailable.";
    const priorLabel = latestPoint && priorPoint
      ? `Compared with ${priorPoint.period}: ${money(priorPoint.value)}.`
      : "No prior period was available for comparison.";
    out.unshift({
      id: "ins-ai-recommendation",
      type: "ai_recommendation",
      title: aiRecommendations.title || `Recommended actions for latest ${metricCol}`,
      bullets: [
        latestLabel,
        priorLabel,
        aiRecommendations.summary || "Action plan based on the latest values.",
        ...recBullets,
      ],
      impact: "medium",
      urgency: "medium",
      confidence: 0.9,
      relevance: 1.0,
      score: 1.01,
      graph: {
        labels: recentGraph.map((p) => p.period),
        values: recentGraph.map((p) => p.value),
      },
      actions: {
        chart: { dateColumn: dateCol, valueColumn: metricCol, segmentBy: null, aggregation: "sum" },
        saveViewName: `${metricCol} recommendations`,
      },
    });
  }

  const updatedAttentionDrivers = out
    .filter((card) => {
      if (card.type === "change_alert") return Number(card.delta || 0) < 0;
      if (card.type === "ai_projection") {
        const projectedPct = Number(card.projectedPct);
        return Number(card.projectedDelta || 0) < 0 && Number.isFinite(projectedPct) && projectedPct <= -minImpact;
      }
      return false;
    })
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
    .slice(0, 3);
  const topDriver = updatedAttentionDrivers[0];
  const attentionBullets = [];

  if (topDriver) {
    attentionBullets.push(`Downside signal: ${topDriver.title || topDriver.type}.`);
    attentionBullets.push(...updatedAttentionDrivers.map((card) => card.title).slice(0, 3));
  }

  if (topDriver) {
    attentionBullets.push("Review this first before drilling into lower-priority cards.");
    out.unshift({
      id: "ins-attention",
      type: "attention",
      title: "Needs attention",
      bullets: attentionBullets,
      impact: "high",
      urgency: "high",
      confidence: 0.93,
      relevance: 1.0,
      score: 1.02,
      graph: {
        labels: recentGraph.map((p) => p.period),
        values: recentGraph.map((p) => p.value),
      },
      actions: {
        chart: { dateColumn: dateCol, valueColumn: metricCol, segmentBy: null, aggregation: "sum" },
      },
    });
  }

  const ranked = out
    .map((c) => ({ ...c, score: Number(c.score || 0) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 7);

  if (!ranked.length) {
    ranked.push({
      id: "ins-stable",
      type: "status",
      title: `${metricCol} is stable in recent periods`,
      bullets: [
        "No major swings crossed configured alert thresholds.",
        "Use Insight Settings to lower sensitivity or impact threshold.",
      ],
      impact: "low",
      urgency: "low",
      confidence: 0.85,
      relevance: 0.8,
      score: 0.18,
      graph: {
        labels: series.slice(-6).map((p) => p.period),
        values: series.slice(-6).map((p) => p.value),
      },
      actions: {
        chart: { dateColumn: dateCol, valueColumn: metricCol, segmentBy: null, aggregation: "sum" },
      },
    });
  }

  const preservedTerms = [
    ...headers,
    dateCol,
    metricCol,
    categoryCol,
    ...categoryDeltas.map((item) => item?.key).filter(Boolean),
    ...series.map((point) => point?.period).filter(Boolean),
  ]
    .map((term) => String(term || "").trim())
    .filter(Boolean);

  return { cards: ranked, detected };
}

async function getInsightSettings(sheetId) {
  const [row] = await query(
    `SELECT sheet_id, sensitivity, min_impact_percent, muted_metrics, preferred_date_column, preferred_metric_column, thresholds
     FROM insight_settings
     WHERE sheet_id = $1`,
    [sheetId]
  );
  if (row) {
    return {
      sensitivity: Number(row.sensitivity ?? 1),
      min_impact_percent: Number(row.min_impact_percent ?? 5),
      muted_metrics: Array.isArray(row.muted_metrics) ? row.muted_metrics : [],
      preferred_date_column: row.preferred_date_column || null,
      preferred_metric_column: row.preferred_metric_column || null,
      thresholds: row.thresholds && typeof row.thresholds === "object" ? row.thresholds : {},
    };
  }
  return {
    sensitivity: 1,
    min_impact_percent: 5,
    muted_metrics: [],
    preferred_date_column: null,
    preferred_metric_column: null,
    thresholds: {},
  };
}

export async function getInsights(req, res) {
  const { sheetId } = req.params;
  const context = req.query.context === "workspace" ? "workspace" : "dashboard";
  const locale = normalizeLocale(req.query.locale || req.query.lang || "en");
  const forceRefresh = parseBooleanLike(req.query.forceRefresh) || parseBooleanLike(req.query.refresh);
  if (!sheetId) return res.status(400).json({ error: "sheet_id_required" });
  const hasAccess = await checkSheetAccess(sheetId, req.user);
  if (!hasAccess) return res.status(403).json({ error: "Forbidden" });

  const loaded = await loadAccessibleRows(sheetId, req.user);
  if (loaded.forbidden) return res.status(403).json({ error: "Forbidden" });
  if (loaded.tooLarge) return res.status(413).json({ error: "sheet_too_large_for_insights", maxRows: INSIGHT_MAX_ROWS });

  const settings = await getInsightSettings(sheetId);
  const cacheKey = getInsightCacheKey({
    sheetId,
    context,
    settings,
    headers: loaded.headers || [],
    rows: loaded.rows || [],
  });
  if (forceRefresh) {
    clearInsightTranslationCacheByPrefix(`${cacheKey}::`);
  }
  const cached = forceRefresh ? null : getInsightCacheEntry(cacheKey);
  if (cached) {
    const localizedCards = await localizeInsightCards({
      locale,
      cards: cached.cards || [],
      context,
      cacheKey,
      forceRefresh: false,
    });
    return res.json({
      ...cached,
      cards: localizedCards,
    });
  }

  const generated = await buildInsights({ rows: loaded.rows || [], headers: loaded.headers || [], settings, context });

  const payload = {
    sheetId,
    generatedAt: new Date().toISOString(),
    settings,
    cards: generated.cards,
    available: {
      dateColumns: generated.detected?.dateCols || [],
      metricColumns: generated.detected?.numericCols || [],
    },
    meta: {
      totalRows: loaded.rows.length,
      context,
    },
  };
  setInsightCacheEntry(cacheKey, payload);
  const translatedCards = await localizeInsightCards({
    locale,
    cards: payload.cards || [],
    context,
    cacheKey,
    forceRefresh,
  });
  return res.json({
    ...payload,
    cards: translatedCards,
  });
}

export async function updateInsightSettings(req, res) {
  const { sheetId } = req.params;
  if (!sheetId) return res.status(400).json({ error: "sheet_id_required" });
  if (req.user?.role !== "admin") return res.status(403).json({ error: "Forbidden" });

  const incoming = req.body || {};
  const sensitivity = Number.isFinite(Number(incoming.sensitivity)) ? Number(incoming.sensitivity) : 1;
  const minImpact = Number.isFinite(Number(incoming.min_impact_percent)) ? Number(incoming.min_impact_percent) : 5;
  const mutedMetrics = Array.isArray(incoming.muted_metrics) ? incoming.muted_metrics.map((x) => String(x)) : [];
  const preferredDate = incoming.preferred_date_column ? String(incoming.preferred_date_column) : null;
  const preferredMetric = incoming.preferred_metric_column ? String(incoming.preferred_metric_column) : null;
  const thresholds = incoming.thresholds && typeof incoming.thresholds === "object" ? incoming.thresholds : {};

  await query(
    `INSERT INTO insight_settings
      (sheet_id, sensitivity, min_impact_percent, muted_metrics, preferred_date_column, preferred_metric_column, thresholds)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7::jsonb)
     ON CONFLICT (sheet_id)
     DO UPDATE SET
      sensitivity = EXCLUDED.sensitivity,
      min_impact_percent = EXCLUDED.min_impact_percent,
     muted_metrics = EXCLUDED.muted_metrics,
     preferred_date_column = EXCLUDED.preferred_date_column,
     preferred_metric_column = EXCLUDED.preferred_metric_column,
      thresholds = EXCLUDED.thresholds,
      updated_at = CURRENT_TIMESTAMP`,
    [
      sheetId,
      Math.max(0.5, Math.min(2.5, sensitivity)),
      Math.max(1, Math.min(100, minImpact)),
      JSON.stringify(mutedMetrics),
      preferredDate,
      preferredMetric,
      JSON.stringify(thresholds),
    ]
  );

  const settings = await getInsightSettings(sheetId);
  return res.json({ ok: true, settings });
}
