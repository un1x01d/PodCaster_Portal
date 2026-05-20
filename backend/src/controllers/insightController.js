import { createHash } from "crypto";
import { query } from "../config/db.js";
import { isEnglishLocale, normalizeLocale, translateDashboardCards } from "../utils/dashboardLocalization.js";
import { checkSheetAccess, hasReportSourceOwnerAccess, isPlatformAdminUser, loadSheetPermissionSets } from "../utils/authorization.js";
import { synthesizeChatAudioBuffer } from "./chatController.js";
import { resolveAiGroupIdForSheet } from "../utils/aiQuota.js";
import { isAiGloballyDisabled, loadAiRuntimeSettings, loadEffectiveAiRuntimeSettings } from "../utils/aiRuntimeSettings.js";
import { resolveChatCompletionProviderConfig } from "../utils/llmProvider.js";
import { buildChatCompletionRequestBody, extractOpenAiAssistantText, minCompletionTokensForModel } from "../utils/openAiCompat.js";
import { enforceAiPromptBudget } from "../utils/aiBudget.js";
import { buildRowFilterWhereClause } from "../utils/rowFilters.js";

const INSIGHT_MAX_ROWS = Number.parseInt(process.env.INSIGHT_MAX_ROWS || "300000", 10);
const OPENAI_TIMEOUT_MS = Number.parseInt(process.env.OPENAI_TIMEOUT_MS || "60000", 10);
const INSIGHT_FEED_MAX_CARDS = Number.parseInt(process.env.INSIGHT_FEED_MAX_CARDS || "4", 10);
// Compatibility caps retained for regression guards.
const INSIGHT_AI_MAX_SERIES_POINTS = Number.parseInt(process.env.INSIGHT_AI_MAX_SERIES_POINTS || "18", 10);
const INSIGHT_AI_MAX_PROMPT_CHARS = Number.parseInt(process.env.INSIGHT_AI_MAX_PROMPT_CHARS || "12000", 10);
const INSIGHT_CACHE = new Map();
const INSIGHT_CACHE_TTL_MS = Number.parseInt(process.env.INSIGHT_CACHE_TTL_MS || `${10 * 60 * 1000}`, 10);
const INSIGHT_CACHE_MAX_ENTRIES = Number.parseInt(process.env.INSIGHT_CACHE_MAX_ENTRIES || "200", 10);
const INSIGHT_TRANSLATION_CACHE = new Map();
const INSIGHT_TRANSLATION_CACHE_MAX_ENTRIES = Number.parseInt(process.env.INSIGHT_TRANSLATION_CACHE_MAX_ENTRIES || "1000", 10);
const INSIGHT_TRANSLATION_CACHE_SETTINGS_KEY = "insight_translation_cache_settings";
const AI_DEBUG_LOGS = String(process.env.AI_DEBUG_LOGS || "").trim().toLowerCase() === "true";
const DEFAULT_INSIGHT_TRANSLATION_CACHE_TTL_MS = Number.parseInt(
  process.env.INSIGHT_TRANSLATION_CACHE_TTL_MS || `${60 * 60 * 1000}`,
  10
);
const INSIGHT_TRANSLATION_SETTINGS_LOCAL_TTL_MS = Number.parseInt(
  process.env.INSIGHT_TRANSLATION_SETTINGS_LOCAL_TTL_MS || `${60 * 1000}`,
  10
);
const INSIGHT_AUDIO_CACHE_RETENTION_DAYS = Number.parseInt(process.env.INSIGHT_AUDIO_CACHE_RETENTION_DAYS || "90", 10);
const INSIGHT_AUDIO_MAX_CHARS = Number.parseInt(process.env.INSIGHT_AUDIO_MAX_CHARS || "8000", 10);
let INSIGHT_TRANSLATION_SETTINGS_LOCAL_CACHE = {
  loadedAt: 0,
  value: { ttlMs: DEFAULT_INSIGHT_TRANSLATION_CACHE_TTL_MS },
};
let INSIGHT_AUDIO_CACHE_SCHEMA_READY = false;
let INSIGHT_TRANSLATION_CACHE_SCHEMA_READY = false;

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

async function ensureInsightTranslationCacheSchema() {
  if (INSIGHT_TRANSLATION_CACHE_SCHEMA_READY) return;
  await query(`
    CREATE TABLE IF NOT EXISTS insight_translation_cache (
      cache_key TEXT PRIMARY KEY,
      sheet_id TEXT NOT NULL,
      revision_key TEXT NOT NULL,
      locale TEXT NOT NULL,
      context TEXT NOT NULL,
      cards_json JSONB NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await query(
    `CREATE INDEX IF NOT EXISTS idx_insight_translation_cache_sheet_revision_locale
       ON insight_translation_cache(sheet_id, revision_key, locale);`
  );
  await query(
    `CREATE INDEX IF NOT EXISTS idx_insight_translation_cache_updated_at
       ON insight_translation_cache(updated_at DESC);`
  );
  INSIGHT_TRANSLATION_CACHE_SCHEMA_READY = true;
}

async function getInsightTranslationCacheEntryDb({ translationCacheKey, ttlMs }) {
  const cutoff = new Date(Date.now() - clampInsightTranslationCacheTtlMs(ttlMs)).toISOString();
  const rows = await query(
    `SELECT cards_json
       FROM insight_translation_cache
      WHERE cache_key = $1
        AND updated_at >= $2
      LIMIT 1`,
    [translationCacheKey, cutoff]
  );
  const cards = rows?.[0]?.cards_json;
  return Array.isArray(cards) ? cards : null;
}

async function setInsightTranslationCacheEntryDb({ translationCacheKey, sheetId, cacheKey, locale, context, cards }) {
  await query(
    `INSERT INTO insight_translation_cache
      (cache_key, sheet_id, revision_key, locale, context, cards_json, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT (cache_key)
     DO UPDATE SET
       cards_json = EXCLUDED.cards_json,
       updated_at = CURRENT_TIMESTAMP`,
    [translationCacheKey, String(sheetId), String(cacheKey), String(locale), String(context || "dashboard"), JSON.stringify(Array.isArray(cards) ? cards : [])]
  );
}

async function clearInsightTranslationCacheByPrefixDb(prefix) {
  await ensureInsightTranslationCacheSchema();
  await query("DELETE FROM insight_translation_cache WHERE cache_key LIKE $1", [`${prefix}%`]);
}

function insightCardTextSignature(cards = []) {
  return JSON.stringify((Array.isArray(cards) ? cards : []).map((card) => ({
    title: String(card?.title || ""),
    bullets: (Array.isArray(card?.bullets) ? card.bullets : []).map((bullet) => String(bullet || "")),
  })));
}

async function localizeInsightCards({ sheetId, locale, cards, context, cacheKey, forceRefresh = false }) {
  if (isEnglishLocale(locale)) return { cards, localized: false, locale: normalizeLocale(locale), source: "english" };
  const normalizedLocale = normalizeLocale(locale);
  const runtime = await loadAiRuntimeSettings(null).catch(() => ({}));
  if (isAiGloballyDisabled(runtime)) {
    return { cards: cards || [], localized: false, locale: normalizedLocale, source: "global_ai_disabled" };
  }
  if (runtime?.dashboardTranslationEnabled !== true) {
    return { cards: cards || [], localized: false, locale: normalizedLocale, source: "disabled" };
  }
  const translationCacheKey = makeInsightTranslationCacheKey({ cacheKey, locale: normalizedLocale, context });
  const settings = await loadInsightTranslationCacheSettings();
  await ensureInsightTranslationCacheSchema();
  if (!forceRefresh) {
    const cached = getInsightTranslationCacheEntry(translationCacheKey);
    if (cached) return { cards: cached, localized: true, locale: normalizedLocale, source: "memory-cache" };
    const persisted = await getInsightTranslationCacheEntryDb({
      translationCacheKey,
      ttlMs: settings.ttlMs,
    });
    if (persisted) {
      setInsightTranslationCacheEntry(translationCacheKey, persisted, settings.ttlMs);
      return { cards: persisted, localized: true, locale: normalizedLocale, source: "db-cache" };
    }
  }
  const translatedCards = await translateDashboardCards({
    locale: normalizedLocale,
    cards: cards || [],
    context: "insight-cards",
  });
  const localized = insightCardTextSignature(cards || []) !== insightCardTextSignature(translatedCards);
  if (!localized) {
    return { cards: cards || [], localized: false, locale: normalizedLocale, source: "untranslated" };
  }
  setInsightTranslationCacheEntry(translationCacheKey, translatedCards, settings.ttlMs);
  await setInsightTranslationCacheEntryDb({
    translationCacheKey,
    sheetId,
    cacheKey,
    locale: normalizedLocale,
    context,
    cards: translatedCards,
  });
  return { cards: translatedCards, localized: true, locale: normalizedLocale, source: "openai" };
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

// NOTE: AI is intentionally disabled. This helper preserves bounded-context guardrails
// and expected regression markers for future deterministic prompt simulations.
function buildLegacyInsightPromptEnvelope({ metricCol, dateCol, series, context }) {
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

async function callInsightRag({ metricCol, dateCol, categoryCol, series, categoryDeltas = [], attentionTitles = [], locale = "en" }) {
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

  const hasFullAccess = isPlatformAdminUser(user) || await hasReportSourceOwnerAccess(sheetId, user.id);
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

async function loadPreviousRevisionRows(currentLoaded, user) {
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

function computeYearlyCategoryDrivers(rows, dateCol, metricCol, categoryCol, targetYear = null) {
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

function computeYearlyDriverChanges(rows, dateCol, metricCol, categoryCol) {
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

function computeDirectionalWarnings({ series, categoryDeltas }) {
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

async function buildInsights({ rows, headers, settings, context, revisionContext = null }) {
  const out = [];
  const detected = detectColumns(headers, rows, settings);
  const { dateCol, metricCol, categoryCol, numericCols } = detected;
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
  const previousSeries = revisionContext?.previousRows?.length
    ? computeSeries(revisionContext.previousRows, dateCol, metricCol)
    : [];
  const previousByPeriod = new Map(previousSeries.map((point) => [point.period, point.value]));
  const latestForRevision = series[series.length - 1] || null;
  const previousRevisionValue = latestForRevision ? previousByPeriod.get(latestForRevision.period) : null;
  const hasRevisionComparison = latestForRevision && Number.isFinite(previousRevisionValue);
  const revisionBasisBullet = hasRevisionComparison
    ? `Revision basis: compared with last revision for ${latestForRevision.period} (${money(previousRevisionValue)} -> ${money(latestForRevision.value)}).`
    : "Revision basis: last revision comparison unavailable; using current revision data only.";
  const minImpact = Number(settings.min_impact_percent ?? 5);
  const last = series[series.length - 1];
  const prev = series[series.length - 2];

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
          revisionBasisBullet,
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

  // Explicit month-to-month cards for revenue/income when those metrics exist.
  const explicitMetricRequests = ["revenue", "income"];
  const explicitMetrics = explicitMetricRequests
    .map((name) => resolveColumn(numericCols || [], name))
    .filter(Boolean);
  const explicitSeen = new Set();
  explicitMetrics.forEach((explicitMetric) => {
    const metricKey = String(explicitMetric).toLowerCase();
    if (explicitSeen.has(metricKey)) return;
    explicitSeen.add(metricKey);
    const explicitSeries = computeSeries(rows, dateCol, explicitMetric);
    const explicitLast = explicitSeries[explicitSeries.length - 1];
    const explicitPrev = explicitSeries[explicitSeries.length - 2];
    if (!explicitLast || !explicitPrev || explicitPrev.value === 0) return;
    const delta = explicitLast.value - explicitPrev.value;
    const deltaPct = (delta / Math.abs(explicitPrev.value)) * 100;
    out.push({
      id: `ins-change-${metricKey}`,
      type: "change_alert",
      title: `${explicitMetric} ${delta >= 0 ? "increased" : "decreased"} ${toPct(Math.abs(deltaPct))} vs prior month`,
      bullets: [
        `Current period (${explicitLast.period}): ${money(explicitLast.value)}`,
        `Previous period (${explicitPrev.period}): ${money(explicitPrev.value)}`,
        `Absolute delta: ${delta >= 0 ? "+" : "-"}${money(Math.abs(delta))}`,
        revisionBasisBullet,
      ],
      impact: Math.abs(deltaPct) >= 20 ? "high" : "medium",
      urgency: Math.abs(deltaPct) >= 15 ? "high" : "medium",
      confidence: 0.93,
      relevance: 1.0,
      score: 0.96,
      delta,
      deltaPct,
      direction: delta >= 0 ? "up" : "down",
      graph: {
        labels: [explicitPrev.period, explicitLast.period],
        values: [explicitPrev.value, explicitLast.value],
      },
      actions: {
        chart: { dateColumn: dateCol, valueColumn: explicitMetric, segmentBy: null, aggregation: "sum" },
        saveViewName: `${explicitMetric} MoM (${explicitLast.period})`,
      },
    });
  });

  if (categoryCol && last) {
    const yearlyChanges = computeYearlyDriverChanges(rows, dateCol, metricCol, categoryCol);
    if (yearlyChanges.year && yearlyChanges.previousYear && yearlyChanges.changes.length) {
      const topChanges = yearlyChanges.changes.slice(0, 6);
      const gained = topChanges.filter((item) => Number(item.delta) > 0);
      const lost = topChanges.filter((item) => Number(item.delta) < 0);
      const bulletLines = [
        `Compared ${yearlyChanges.year} vs ${yearlyChanges.previousYear} for ${metricCol}.`,
        `Drivers gained: ${gained.length ? gained.map((item) => `${item.key} (+${money(Math.abs(item.delta))}${Number.isFinite(item.deltaPct) ? `, +${toPct(Math.abs(item.deltaPct))}` : ""})`).join("; ") : "none in top changes"}.`,
        `Drivers lost: ${lost.length ? lost.map((item) => `${item.key} (-${money(Math.abs(item.delta))}${Number.isFinite(item.deltaPct) ? `, -${toPct(Math.abs(item.deltaPct))}` : ""})`).join("; ") : "none in top changes"}.`,
        "Method: yearly sums per driver, then delta between latest and previous fiscal years.",
        revisionBasisBullet,
      ];
      out.push({
        id: "ins-driver-change",
        type: "driver_changes",
        title: `Drivers gained or lost: ${yearlyChanges.year} vs ${yearlyChanges.previousYear}`,
        bullets: bulletLines,
        impact: "medium",
        urgency: "medium",
        confidence: 0.91,
        relevance: 1,
        score: 0.97,
        direction: gained.length >= lost.length ? "up" : "down",
        graph: { labels: [], values: [] },
        actions: {
          chart: { dateColumn: dateCol, valueColumn: metricCol, segmentBy: categoryCol, aggregation: "sum" },
        },
      });
    }

    categoryDeltas = computeCategoryDeltas(rows, dateCol, metricCol, categoryCol, last.period, prev?.period || null);
    const { year: latestYear, drivers: yearlyDrivers } = computeYearlyCategoryDrivers(rows, dateCol, metricCol, categoryCol);
    const topYearlyDrivers = yearlyDrivers.slice(0, 5);

    if (topYearlyDrivers.length) {
      const top = topYearlyDrivers[0];
      topCategoryDriver = top;
      out.push({
        id: "ins-driver",
        type: "driver_breakdown",
        title: `Top drivers for ${latestYear}: ${metricCol}`,
        bullets: topYearlyDrivers.map((driver, idx) => (
          `${idx + 1}. ${driver.key}: ${money(driver.current)} (${toPct(driver.sharePct)} of yearly total)`
        )),
        impact: Math.abs(top.delta) > 0 ? "medium" : "low",
        urgency: "medium",
        confidence: 0.9,
        relevance: 0.95,
        score: 0.74,
        delta: top.delta,
        direction: top.delta >= 0 ? "up" : "down",
        graph: {
          labels: topYearlyDrivers.map((d) => d.key),
          values: topYearlyDrivers.map((d) => d.current),
        },
        actions: {
          filter: { column: categoryCol, value: top.key },
          chart: { dateColumn: dateCol, valueColumn: metricCol, segmentBy: categoryCol, aggregation: "sum" },
          saveViewName: `${latestYear} top drivers`,
        },
      });
    } else if (categoryDeltas.length) {
      const top = categoryDeltas[0];
      topCategoryDriver = top;
    }
  }

  const directionalWarnings = computeDirectionalWarnings({ series, categoryDeltas });
  if (directionalWarnings.length) {
    const recentGraph = series.slice(-Math.min(6, series.length));
    const warningDirections = directionalWarnings.map((w) => w.direction).filter(Boolean);
    const hasUp = warningDirections.includes("up");
    const hasDown = warningDirections.includes("down");
    const direction = hasUp && hasDown ? "neutral" : (hasDown ? "down" : "up");
    out.unshift({
      id: "ins-major-change-warning",
      type: "major_warning",
      title: direction === "down" ? "Downward changes detected" : direction === "up" ? "Upward changes detected" : "Directional changes detected",
      bullets: [
        ...directionalWarnings.map((w) => w.text),
        "These warnings are derived directly from your data (non-AI).",
        revisionBasisBullet,
      ],
      impact: "high",
      urgency: "high",
      confidence: 0.94,
      relevance: 1.0,
      score: 1.03,
      direction,
      graph: {
        labels: recentGraph.map((p) => p.period),
        values: recentGraph.map((p) => p.value),
      },
      actions: {
        chart: { dateColumn: dateCol, valueColumn: metricCol, segmentBy: null, aggregation: "sum" },
      },
    });
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
          revisionBasisBullet,
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

  const ragInsight = await callInsightRag({
    metricCol,
    dateCol,
    categoryCol,
    series,
    categoryDeltas,
    attentionTitles: [],
    locale: "en",
  });

  if (series.length >= 3) {
    const trendForecast = (ragInsight?.forecast_periods?.length >= 3)
      ? {
        forecast_periods: ragInsight.forecast_periods,
        summary: ragInsight.forecast_summary,
        trend_basis: ragInsight.forecast_basis,
        confidence: 0.83,
      }
      : buildHeuristicForecast(series);
    if (trendForecast?.forecast_periods?.length >= 3) {
      const history = series.slice(-Math.min(6, series.length));
      const forecastPeriods = trendForecast.forecast_periods.slice(0, 3).map((p, idx) => ({
        period: formatPeriodLabel(p.period) || addMonthsToKey(history[history.length - 1].period, idx + 1),
        value: Number(p.value),
      })).filter((p) => Number.isFinite(p.value));
      if (forecastPeriods.length >= 3) {
        const forecastGraphLabels = [...history.map((point) => point.period), ...forecastPeriods.map((point) => point.period)];
        const forecastGraphValues = [...history.map((point) => point.value), ...forecastPeriods.map((point) => point.value)];
        const first = forecastPeriods[0];
        const third = forecastPeriods[2];
        const summaryText = typeof trendForecast.summary === "string" && trendForecast.summary.trim()
          ? trendForecast.summary.trim()
          : `Forecast indicates ${trendForecast.trend_direction || "directional"} movement over the next three periods.`;
        const basisText = typeof trendForecast.trend_basis === "string" && trendForecast.trend_basis.trim()
          ? trendForecast.trend_basis.trim()
          : `Based on ${series.length} historical periods from the spreadsheet.`;
        const confidence = Number.isFinite(Number(trendForecast.confidence))
          ? Math.max(0.5, Math.min(0.99, Number(trendForecast.confidence)))
          : 0.74;

        out.push({
          id: "ins-projection",
          type: "projection",
          title: `Trend projection for ${metricCol} (next 3 periods)`,
          bullets: [
            basisText,
            summaryText,
            `Projected ${first.period}: ${money(first.value)}.`,
            `Projected ${third.period}: ${money(third.value)}.`,
            revisionBasisBullet,
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
      if (card.type === "projection") {
        const projectedPct = Number(card.projectedPct);
        return Number(card.projectedDelta || 0) < 0 && Number.isFinite(projectedPct) && projectedPct <= -minImpact;
      }
      return false;
    })
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
    .slice(0, 3);
  const recentGraph = series.slice(-Math.min(6, series.length));

  const attentionTitles = attentionDrivers.map((card) => card.title).filter(Boolean);
  const trendRecommendations = ragInsight
    ? {
      title: `Recommended actions for ${metricCol}`,
      summary: String(ragInsight.recommendations_summary || "").trim() || `Action plan built from current data context.`,
      recommendations: ragInsight.recommendations.slice(0, 3).map((line, idx) => ({ area: attentionTitles[idx] ? "Priority signal" : "Action", action: String(line || ""), evidence: attentionTitles[idx] || "" })),
    }
    : buildHeuristicRecommendations({
    metricCol,
    categoryCol,
    series,
    topCategoryDriver,
    categoryDeltas,
    attentionDrivers,
  });

  if (trendRecommendations) {
    const recBullets = Array.isArray(trendRecommendations.recommendations) && trendRecommendations.recommendations.length
      ? trendRecommendations.recommendations.slice(0, 3).map((item) => {
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
      id: "ins-recommendation",
      type: "recommendation",
      title: trendRecommendations.title || `Recommended actions for latest ${metricCol}`,
      bullets: [
        latestLabel,
        priorLabel,
        trendRecommendations.summary || "Action plan based on the latest values.",
        revisionBasisBullet,
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
      if (card.type === "projection") {
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

  out.forEach((card) => {
    if (!card || typeof card !== "object" || !Array.isArray(card.bullets)) return;
    const hasBasis = card.bullets.some((line) => String(line || "").toLowerCase().startsWith("revision basis:"));
    if (!hasBasis) card.bullets.push(revisionBasisBullet);
  });

  const ranked = out
    .map((c) => ({ ...c, score: Number(c.score || 0) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Number.isFinite(INSIGHT_FEED_MAX_CARDS) ? INSIGHT_FEED_MAX_CARDS : 4));

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
    await clearInsightTranslationCacheByPrefixDb(`${cacheKey}::`);
  }
  const cached = forceRefresh ? null : getInsightCacheEntry(cacheKey);
  if (cached) {
    const localization = await localizeInsightCards({
      sheetId,
      locale,
      cards: cached.cards || [],
      context,
      cacheKey,
      forceRefresh: false,
    });
    return res.json({
      ...cached,
      cards: localization.cards,
      meta: {
        ...(cached.meta || {}),
        locale: localization.locale,
        localized: localization.localized,
        localizationSource: localization.source,
      },
    });
  }

  const previousRevision = await loadPreviousRevisionRows(loaded, req.user);
  const generated = await buildInsights({
    rows: loaded.rows || [],
    headers: loaded.headers || [],
    settings,
    context,
    revisionContext: {
      currentSourceVersion: loaded?.sourceVersion || null,
      previousSourceVersion: previousRevision?.sourceVersion || null,
      previousRows: previousRevision?.rows || [],
    },
  });

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
      revisionKey: cacheKey,
      currentSourceVersion: loaded?.sourceVersion || null,
      previousSourceVersion: previousRevision?.sourceVersion || null,
    },
  };
  setInsightCacheEntry(cacheKey, payload);
  const localization = await localizeInsightCards({
    sheetId,
    locale,
    cards: payload.cards || [],
    context,
    cacheKey,
    forceRefresh,
  });
  return res.json({
    ...payload,
    cards: localization.cards,
    meta: {
      ...(payload.meta || {}),
      locale: localization.locale,
      localized: localization.localized,
      localizationSource: localization.source,
    },
  });
}

function buildInsightNarrationText({ title, bullets }) {
  const safeTitle = String(title || "").trim();
  const safeBullets = Array.isArray(bullets)
    ? bullets.map((line) => String(line || "").trim()).filter(Boolean)
    : [];
  const joinedBullets = safeBullets.join(". ");
  return [safeTitle, joinedBullets].filter(Boolean).join(". ");
}

async function ensureInsightAudioCacheSchema() {
  if (INSIGHT_AUDIO_CACHE_SCHEMA_READY) return;
  await query(`
    CREATE TABLE IF NOT EXISTS insight_audio_cache (
      cache_key TEXT PRIMARY KEY,
      sheet_id TEXT NOT NULL,
      revision_key TEXT NOT NULL,
      locale TEXT NOT NULL,
      card_id TEXT NOT NULL,
      text_hash TEXT NOT NULL,
      audio_bytes BYTEA NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_insight_audio_cache_sheet_revision_locale ON insight_audio_cache(sheet_id, revision_key, locale);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_insight_audio_cache_updated_at ON insight_audio_cache(updated_at DESC);`);
  INSIGHT_AUDIO_CACHE_SCHEMA_READY = true;
}

export async function getInsightCardAudio(req, res) {
  const sheetId = String(req.params.sheetId || "").trim();
  const locale = normalizeLocale(req.body?.locale || "en");
  const revisionKey = String(req.body?.revisionKey || "").trim();
  const cardId = String(req.body?.cardId || "").trim();
  const title = req.body?.title;
  const bullets = req.body?.bullets;
  if (!sheetId || !revisionKey || !cardId) {
    return res.status(400).json({ error: "missing_params" });
  }
  await ensureInsightAudioCacheSchema();

  const hasAccess = await checkSheetAccess(sheetId, req.user);
  if (!hasAccess) return res.status(403).json({ error: "Forbidden" });

  const narrationText = buildInsightNarrationText({ title, bullets });
  if (!narrationText) return res.status(400).json({ error: "missing_narration_text" });
  const runtimeGroupId = await resolveAiGroupIdForSheet({ sheetId, user: req.user }).catch(() => null);
  const { runtime } = await loadEffectiveAiRuntimeSettings(runtimeGroupId || null).catch(() => ({ runtime: {} }));
  if (isAiGloballyDisabled(runtime)) return res.status(403).json({ error: "global_ai_disabled" });
  if (runtime?.chatAudioEnabled !== true) return res.status(403).json({ error: "chat_audio_disabled" });
  const maxChars = Number(runtime?.chatAudioMaxChars || INSIGHT_AUDIO_MAX_CHARS);
  if (narrationText.length > maxChars) {
    return res.status(413).json({ error: "text_too_large", maxChars });
  }

  const textHash = createHash("sha256").update(narrationText).digest("hex");
  const cacheKey = createHash("sha256")
    .update(`${sheetId}|${revisionKey}|${locale}|${cardId}|${textHash}`)
    .digest("hex");

  const cachedRows = await query(
    `SELECT audio_bytes
       FROM insight_audio_cache
      WHERE cache_key = $1
      LIMIT 1`,
    [cacheKey]
  );
  const cachedBytes = cachedRows?.[0]?.audio_bytes;
  if (cachedBytes) {
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("X-Insight-Audio-Cache", "hit");
    return res.status(200).send(cachedBytes);
  }

  const audioBuffer = await synthesizeChatAudioBuffer({ text: narrationText, locale, runtime });
  if (!audioBuffer?.length) {
    return res.status(502).json({ error: "tts_empty_response" });
  }

  await query(
    `INSERT INTO insight_audio_cache
      (cache_key, sheet_id, revision_key, locale, card_id, text_hash, audio_bytes, created_at, updated_at)
     VALUES
      ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT (cache_key)
     DO UPDATE SET
       audio_bytes = EXCLUDED.audio_bytes,
       updated_at = CURRENT_TIMESTAMP`,
    [cacheKey, sheetId, revisionKey, locale, cardId, textHash, audioBuffer]
  );

  await query(
    `DELETE FROM insight_audio_cache
      WHERE updated_at < (CURRENT_TIMESTAMP - ($1::text || ' days')::interval)`,
    [String(Math.max(7, INSIGHT_AUDIO_CACHE_RETENTION_DAYS))]
  ).catch(() => {});

  res.setHeader("Content-Type", "audio/mpeg");
  res.setHeader("X-Insight-Audio-Cache", "miss");
  return res.status(200).send(audioBuffer);
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
