import { createHash } from "crypto";
import { query } from "../config/db.js";
import { isEnglishLocale, normalizeLocale, translateDashboardCards } from "../utils/dashboardLocalization.js";
import { checkSheetAccess, hasFolderAccess, loadSheetPermissionSets } from "../utils/authorization.js";

const INSIGHT_MAX_ROWS = Number.parseInt(process.env.INSIGHT_MAX_ROWS || "50000", 10);
const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const OPENAI_TIMEOUT_MS = Number.parseInt(process.env.OPENAI_TIMEOUT_MS || "60000", 10);
const INSIGHT_CACHE = new Map();
const INSIGHT_CACHE_TTL_MS = Number.parseInt(process.env.INSIGHT_CACHE_TTL_MS || `${10 * 60 * 1000}`, 10);
const INSIGHT_CACHE_MAX_ENTRIES = Number.parseInt(process.env.INSIGHT_CACHE_MAX_ENTRIES || "200", 10);
const OIL_PRICE_TTL_MS = 10_000;
let OIL_PRICE_CACHE = null;
const OIL_PRICE_HISTORY = [];
const OIL_METRIC_HISTORY = {
  oil: [],
  diesel: [],
  surcharge: [],
  linehaul: [],
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

function upsertDailyMetricPoint(history, dateKey, value, maxPoints = 14) {
  if (!Array.isArray(history) || !Number.isFinite(value) || !dateKey) return;
  const last = history[history.length - 1];
  if (last && last.label === dateKey) {
    last.value = value;
  } else {
    history.push({ label: dateKey, value });
    while (history.length > maxPoints) history.shift();
  }
}

function toIsoDateKey(d) {
  return d.toISOString().slice(0, 10);
}

function buildLastWeekSeries(history, fallbackValue) {
  const out = [];
  const safeFallback = Number.isFinite(fallbackValue) ? fallbackValue : 0;
  const known = Array.isArray(history) ? history : [];
  const valueByDate = new Map(known.map((p) => [String(p?.label || ""), Number(p?.value)]));
  let carry = Number.isFinite(known[known.length - 1]?.value) ? Number(known[known.length - 1].value) : safeFallback;

  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const dateKey = toIsoDateKey(d);
    const dayValue = valueByDate.get(dateKey);
    if (Number.isFinite(dayValue)) carry = dayValue;
    out.push({ label: dateKey, value: Number.isFinite(carry) ? carry : safeFallback });
  }
  return out;
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

function money(v) {
  if (!Number.isFinite(v)) return "$0";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  return `${sign}$${Math.round(abs).toLocaleString()}`;
}

function formatPeriodLabel(periodKey) {
  return String(periodKey || "").trim();
}

async function fetchLiveOilPrice() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
  try {
    const payload = {
      instruction: "Return current trucking fuel market snapshot values in USD, including last 7 daily points.",
      output_schema: {
        oil_price_usd: "number",
        diesel_price_usd_per_gallon: "number",
        fuel_surcharge_percent: "number",
        linehaul_spot_rate_usd_per_mile: "number",
        label: "string",
        daily_history: [
          {
            date: "YYYY-MM-DD",
            oil_price_usd: "number",
            diesel_price_usd_per_gallon: "number",
            fuel_surcharge_percent: "number",
            linehaul_spot_rate_usd_per_mile: "number",
          },
        ],
      },
    };
    const resp = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Return only valid JSON with realistic current trucking fuel market values and a 7-day daily history. Use real-world plausible day-to-day movement; do not keep all days identical.",
          },
          { role: "user", content: JSON.stringify(payload) },
        ],
      }),
    });
    if (!resp.ok) return null;
    const json = await resp.json();
    const content = json?.choices?.[0]?.message?.content || "{}";
    const parsed = JSON.parse(content);
    const oil = Number(parsed?.oil_price_usd);
    const diesel = Number(parsed?.diesel_price_usd_per_gallon);
    const surcharge = Number(parsed?.fuel_surcharge_percent);
    const linehaul = Number(parsed?.linehaul_spot_rate_usd_per_mile);
    const dailyHistoryRaw = Array.isArray(parsed?.daily_history) ? parsed.daily_history : [];
    if (!Number.isFinite(oil) || oil <= 0) return null;
    const dailyHistory = dailyHistoryRaw
      .map((row) => {
        const date = String(row?.date || "").trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
        const dayOil = Number(row?.oil_price_usd);
        const dayDiesel = Number(row?.diesel_price_usd_per_gallon);
        const daySurcharge = Number(row?.fuel_surcharge_percent);
        const dayLinehaul = Number(row?.linehaul_spot_rate_usd_per_mile);
        return {
          date,
          oil: Number.isFinite(dayOil) && dayOil > 0 ? dayOil : null,
          diesel: Number.isFinite(dayDiesel) && dayDiesel > 0 ? dayDiesel : null,
          surcharge: Number.isFinite(daySurcharge) ? daySurcharge : null,
          linehaul: Number.isFinite(dayLinehaul) && dayLinehaul > 0 ? dayLinehaul : null,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-7);
    return {
      oil,
      diesel: Number.isFinite(diesel) && diesel > 0 ? diesel : null,
      surcharge: Number.isFinite(surcharge) ? surcharge : null,
      linehaul: Number.isFinite(linehaul) && linehaul > 0 ? linehaul : null,
      label: String(parsed?.label || "Trucking Fuel Snapshot"),
      dailyHistory,
    };
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timeout);
  }
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
    const payload = {
      metric_column: metricCol,
      date_column: dateCol,
      context,
      original_history_series: series,
      history_series: series,
      historical_summary: {
        total_periods: series.length,
        first_period: series[0] || null,
        latest_period: series[series.length - 1] || null,
        min_value: series.length ? Math.min(...series.map((p) => p.value)) : null,
        max_value: series.length ? Math.max(...series.map((p) => p.value)) : null,
      },
      instructions: [
        "Forecast the next 3 periods using the full spreadsheet history provided.",
        "Return JSON only.",
        "The periods should match the same monthly period format as the input series.",
        "Base the decision on the historical trend pattern across the spreadsheet, not just the last point.",
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
          { role: "user", content: JSON.stringify(payload) },
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
    const recentSeries = series.slice(-6);
    const latestPoint = series[series.length - 1] || null;
    const previousPoint = series[series.length - 2] || null;
    const payload = {
      metric_column: metricCol,
      date_column: dateCol,
      category_column: categoryCol || null,
      context,
      summary: {
        latest_point: latestPoint,
        previous_point: previousPoint,
        latest_period: latestPoint?.period || null,
        latest_value: latestPoint?.value ?? null,
        recent_series: recentSeries,
        latest: latestPoint,
        previous: previousPoint,
        top_category_driver: topCategoryDriver || null,
        category_deltas: categoryDeltas.slice(0, 5),
        attention_titles: attentionDrivers.slice(0, 3).map((card) => card.title),
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
          { role: "user", content: JSON.stringify(payload) },
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
  const allRows = await query(
    `SELECT row_data FROM sheet_rows WHERE sheet_id = $1 ORDER BY row_index ASC LIMIT $2`,
    [sheetId, INSIGHT_MAX_ROWS + 1]
  );
  if (allRows.length > INSIGHT_MAX_ROWS) {
    return { headers, rows: [], tooLarge: true, forbidden: false };
  }
  let rows = allRows.map((r) => (typeof r.row_data === "string" ? JSON.parse(r.row_data) : r.row_data));
  if (user.role === "admin") return { headers, rows, tooLarge: false, forbidden: false };

  if (await hasFolderAccess(sheetId, user.id)) {
    return { headers, rows, tooLarge: false, forbidden: false };
  }

  const { allPerms, validCols: validColsArray, rowFiltersList } = await loadSheetPermissionSets(sheetId, user.id);
  if (!allPerms.length) return { headers: [], rows: [], tooLarge: false, forbidden: true };
  const validCols = new Set(validColsArray);

  rows = rows.filter((rowData) => {
    let rowAllowed = false;
    for (const filters of rowFiltersList) {
      const keys = Object.keys(filters);
      if (!keys.length) {
        rowAllowed = true;
        break;
      }
      const match = keys.every((k) => String(rowData?.[k]) === String(filters[k]));
      if (match) {
        rowAllowed = true;
        break;
      }
    }
    return rowAllowed;
  }).map((rowData) => {
    const stripped = {};
    validCols.forEach((k) => {
      stripped[k] = rowData?.[k];
    });
    return stripped;
  });

  return { headers: headers.filter((h) => validCols.has(h)), rows, tooLarge: false, forbidden: false };
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
    const currentBucket = rows.filter((r) => monthKey(parseDate(r?.[dateCol]) || new Date("1970-01-01")) === last.period);
    const prevBucket = prev ? rows.filter((r) => monthKey(parseDate(r?.[dateCol]) || new Date("1970-01-01")) === prev.period) : [];

    const currentByCat = new Map();
    const prevByCat = new Map();
    currentBucket.forEach((r) => {
      const k = String(r?.[categoryCol] ?? "Unknown");
      const v = parseNum(r?.[metricCol]);
      if (v === null) return;
      currentByCat.set(k, (currentByCat.get(k) || 0) + v);
    });
    prevBucket.forEach((r) => {
      const k = String(r?.[categoryCol] ?? "Unknown");
      const v = parseNum(r?.[metricCol]);
      if (v === null) return;
      prevByCat.set(k, (prevByCat.get(k) || 0) + v);
    });

    categoryDeltas = Array.from(currentByCat.entries()).map(([k, v]) => ({
      key: k,
      current: v,
      prev: prevByCat.get(k) || 0,
      delta: v - (prevByCat.get(k) || 0),
    })).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

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
  const cached = getInsightCacheEntry(cacheKey);
  if (cached) {
    if (isEnglishLocale(locale)) {
      return res.json(cached);
    }
    const translatedCards = await translateDashboardCards({
      locale,
      cards: cached.cards || [],
      context: "insight-cards",
    });
    return res.json({
      ...cached,
      cards: translatedCards,
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
  if (isEnglishLocale(locale)) {
    return res.json(payload);
  }
  const translatedCards = await translateDashboardCards({
    locale,
    cards: payload.cards || [],
    context: "insight-cards",
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

export async function getOilMarketCard(req, res) {
  const locale = normalizeLocale(req.query.locale || req.query.lang || "en");
  const now = Date.now();
  if (OIL_PRICE_CACHE && (now - OIL_PRICE_CACHE.ts) < OIL_PRICE_TTL_MS) {
    return res.json(OIL_PRICE_CACHE.payload);
  }

  const live = await fetchLiveOilPrice();
  const fallbackPrice = Number(OIL_PRICE_HISTORY[OIL_PRICE_HISTORY.length - 1]?.value || 0);
  const fallbackDiesel = Number(OIL_METRIC_HISTORY.diesel[OIL_METRIC_HISTORY.diesel.length - 1]?.value || 0);
  const fallbackSurcharge = Number(OIL_METRIC_HISTORY.surcharge[OIL_METRIC_HISTORY.surcharge.length - 1]?.value || 0);
  const fallbackLinehaul = Number(OIL_METRIC_HISTORY.linehaul[OIL_METRIC_HISTORY.linehaul.length - 1]?.value || 0);
  const price = Number(live?.oil || fallbackPrice || 0);
  const diesel = Number.isFinite(Number(live?.diesel)) && Number(live?.diesel) > 0 ? Number(live.diesel) : fallbackDiesel;
  const surcharge = Number.isFinite(Number(live?.surcharge)) ? Number(live.surcharge) : fallbackSurcharge;
  const linehaul = Number.isFinite(Number(live?.linehaul)) && Number(live?.linehaul) > 0 ? Number(live.linehaul) : fallbackLinehaul;
  const pointLabel = toIsoDateKey(new Date());

  if (Number.isFinite(price) && price > 0) {
    upsertDailyMetricPoint(OIL_PRICE_HISTORY, pointLabel, price, 14);
    upsertDailyMetricPoint(OIL_METRIC_HISTORY.oil, pointLabel, price, 14);
  }
  if (Number.isFinite(diesel) && diesel > 0) {
    upsertDailyMetricPoint(OIL_METRIC_HISTORY.diesel, pointLabel, diesel, 14);
  }
  if (Number.isFinite(surcharge)) {
    upsertDailyMetricPoint(OIL_METRIC_HISTORY.surcharge, pointLabel, surcharge, 14);
  }
  if (Number.isFinite(linehaul) && linehaul > 0) {
    upsertDailyMetricPoint(OIL_METRIC_HISTORY.linehaul, pointLabel, linehaul, 14);
  }

  const queriedWeek = Array.isArray(live?.dailyHistory) ? live.dailyHistory : [];
  const oilWeek = queriedWeek.length
    ? queriedWeek.map((d) => ({ label: d.date, value: Number.isFinite(d.oil) ? d.oil : price }))
    : buildLastWeekSeries(OIL_METRIC_HISTORY.oil, price);
  const dieselWeek = queriedWeek.length
    ? queriedWeek.map((d) => ({ label: d.date, value: Number.isFinite(d.diesel) ? d.diesel : diesel }))
    : buildLastWeekSeries(OIL_METRIC_HISTORY.diesel, diesel);
  const surchargeWeek = queriedWeek.length
    ? queriedWeek.map((d) => ({ label: d.date, value: Number.isFinite(d.surcharge) ? d.surcharge : surcharge }))
    : buildLastWeekSeries(OIL_METRIC_HISTORY.surcharge, surcharge);
  const linehaulWeek = queriedWeek.length
    ? queriedWeek.map((d) => ({ label: d.date, value: Number.isFinite(d.linehaul) ? d.linehaul : linehaul }))
    : buildLastWeekSeries(OIL_METRIC_HISTORY.linehaul, linehaul);

  const baseCard = {
    id: "ins-oil-live",
    type: "market_oil",
    title: "AI Live: Trucking Fuel & Market Snapshot",
    bullets: [
      `WTI crude oil: $${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} per barrel`,
      `Diesel (retail): ${Number.isFinite(diesel) ? `$${diesel.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} per gallon` : "N/A"}`,
      `Fuel surcharge baseline: ${Number.isFinite(surcharge) ? `${surcharge.toLocaleString("en-US", { maximumFractionDigits: 2 })}%` : "N/A"}`,
      `Linehaul spot rate: ${Number.isFinite(linehaul) ? `$${linehaul.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} per mile` : "N/A"}`,
    ],
    graph: {
      labels: OIL_PRICE_HISTORY.map((x) => x.label),
      values: OIL_PRICE_HISTORY.map((x) => x.value),
    },
    miniGraphs: [
      {
        labels: oilWeek.map((x) => x.label),
        values: oilWeek.map((x) => x.value),
        unit: "currency",
      },
      {
        labels: dieselWeek.map((x) => x.label),
        values: dieselWeek.map((x) => x.value),
        unit: "currency",
      },
      {
        labels: surchargeWeek.map((x) => x.label),
        values: surchargeWeek.map((x) => x.value),
        unit: "percent",
      },
      {
        labels: linehaulWeek.map((x) => x.label),
        values: linehaulWeek.map((x) => x.value),
        unit: "currency",
      },
    ],
  };

  const card = isEnglishLocale(locale)
    ? baseCard
    : (await translateDashboardCards({
        locale,
        cards: [baseCard],
        preserveTerms: ["USD", "oil", "barrel", ...OIL_PRICE_HISTORY.map((x) => x.label)],
        context: "insight-oil-card",
      }))[0] || baseCard;

  const payload = { card };
  OIL_PRICE_CACHE = { ts: now, payload };
  return res.json(payload);
}
