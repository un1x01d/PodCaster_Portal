import { createHash } from "crypto";
import { query } from "../config/db.js";
import { isEnglishLocale, normalizeLocale, translateDashboardItems } from "../utils/dashboardLocalization.js";
import { checkSheetAccess, hasReportSourceOwnerAccess, isPlatformAdminUser, loadSheetPermissionSets, resolveRuntimeGroupIdForUser } from "../utils/authorization.js";
import { estimateOpenAiCostUsd, recordAiUsage, reserveAiQueryForSheet, resolveAiGroupIdForSheet } from "../utils/aiQuota.js";
import { isAiGloballyDisabled, loadAiRuntimeSettings, loadEffectiveAiRuntimeSettings } from "../utils/aiRuntimeSettings.js";
import { groupHasFeature } from "../utils/entitlements.js";
import { resolveChatCompletionProviderConfig } from "../utils/llmProvider.js";
import { buildChatCompletionRequestBody, extractOpenAiAssistantText, getOpenAiResponseDiagnostics, minCompletionTokensForModel } from "../utils/openAiCompat.js";
import { enforceAiPromptBudget } from "../utils/aiBudget.js";
import {
  buildSheetSemanticProfile,
  resolveProfileDateColumn,
  resolveProfileDimension,
  resolveProfileMetric,
} from "../utils/sheetSemanticProfile.js";
import { writeAuditLog } from "../utils/auditLog.js";
import { analyzeAccountingIntent } from "../services/ai/accountingIntentAnalyzer.js";
import { getSemanticKnowledge } from "../services/ai/semanticKnowledgeService.js";
import { buildDeterministicSpreadsheetPlan } from "../services/ai/deterministicSpreadsheetPlanner.js";
import { executeDeterministicSpreadsheetPlan } from "../services/ai/deterministicSpreadsheetExecutor.js";
import { presentDeterministicSpreadsheetResult } from "../services/ai/deterministicSpreadsheetPresenter.js";
import { validateDeterministicPlanContract } from "../services/ai/deterministicOperationContract.js";
import { buildAccountingAnalysisPlan } from "../services/ai/accountingAnalysisPlanner.js";
import { validateAnalysisPlan } from "../services/accounting/analysisPlanValidator.js";
import { resolveAnalysisHeaders } from "../services/accounting/analysisHeaderResolver.js";
import { executeAnalysisPlan } from "../services/accounting/analysisExecutor.js";
import { explainAccountingAnalysis } from "../services/ai/accountingAnalysisExplainer.js";
import { COMPLEX_QUESTION_REQUIREMENTS } from "../services/accounting/complexQuestionRequirements.js";
import { METRIC_REGISTRY } from "../services/accounting/metricRegistry.js";
import { classifyBusinessDomain } from "../services/chat/businessDomainClassifier.js";
import { buildRowFilterWhereClause } from "../utils/rowFilters.js";
export { checkSheetAccess } from "../utils/authorization.js";

const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
const OPENAI_TIMEOUT_MS = Number.parseInt(process.env.OPENAI_TIMEOUT_MS || "60000", 10);
const CHAT_ENABLE_LEGACY_FALLBACK = String(process.env.CHAT_ENABLE_LEGACY_FALLBACK || "false").trim().toLowerCase() === "true";
const CHAT_MAX_ROWS = Math.min(100000, Number.parseInt(process.env.CHAT_MAX_ROWS || "50000", 10));
const CHAT_SQL_AGG_MAX_ROWS = Math.min(300000, Number.parseInt(process.env.CHAT_SQL_AGG_MAX_ROWS || "120000", 10));
const CHAT_AUDIO_MAX_CHARS = Number.parseInt(process.env.CHAT_AUDIO_MAX_CHARS || "8000", 10);
const AI_DEBUG_LOGS = String(process.env.AI_DEBUG_LOGS || "").trim().toLowerCase() === "true";
const CHAT_TTS_SETTINGS_KEY = "chat_tts_settings";
const CHAT_RUNTIME_RULES_SETTINGS_KEY = "chat_runtime_rules";
const CHAT_TTS_DEFAULTS = {
  voices: { default: "nova", es: "shimmer", uk: "nova", ru: "nova" },
  models: { en: "tts-1", default: "tts-1-hd" },
  speed: { default: 0.9 },
};
const CHAT_RUNTIME_RULES_DEFAULTS = {
  shortReasonFollowupRegex: "^(why|why\\?|because\\??|reason\\??|чому\\??|почему\\??|почему так\\??)$",
  shortYearFollowupMaxChars: 40,
  shortYearFollowupRegex: "\\b(19|20)\\d{2}\\b",
  topNHistoryRegex: "\\btop\\s*\\d+\\b",
  moneyHistoryRegex: "\\bby\\s+[a-zа-яіїєґ_ ]+:\\s*\\$",
  comparisonIntentRegex: "\\b(yoy|year over year|year-over-year|compare|comparison|vs|versus|growth|growth rate|rate|change|delta|difference|what changed|changed between|between .* and .*|yearly diff|annual diff|month over month|mom|qoq|quarter over quarter)\\b|г\\/г|р\\/р|год к году|рік до року|порівн|сравн|рост|зрост|разниц|дельт|зміна|різниц",
  singleYearMetricHistoryRegex: "\\bfor\\s+(19|20)\\d{2}\\b",
  singleYearMetricKeywordRegex: "\\b(revenue|sales|income|profit|expense|cost)\\b|выруч|доход|дохід|прибут|расход|витрат",
  driverIntentRegex: "\\b(driver|drivers|top|biggest|largest|main driver|leading contributor|contributor|impact|impacting|moved the needle|key factor|primary factor|who drove|what drove|top 1|top one)\\b|драйвер|топ|основн|фактор|вплив|влияни",
  driverRankingIntentRegex: "\\b(top|highest|largest|biggest|best|most|leading|rank(?:ing)?|drivers?|drives|contributors?|sources?|main|primary|key|dominant|strongest|top\\s*\\d+|number\\s*one|#1)\\b|топ|главн|основн|ключев|домінант",
  driverValueIntentRegex: "\\b(revenue|sales|income|profit|amount|value|brought|generated|drove|bring|earnings?)\\b",
  breakdownIntentRegex: "\\b(by|per|group(?:ed)? by|breakdown|split by|segmented by|across|for each|each year|every year|by year|by quarter|per quarter|year by year|quarter by quarter)\\b|по\\s+|за\\s+категор|по\\s+категор|розбив|за\\s+категор|за\\s+кожен\\s+рік|по\\s+годам|по\\s+квартал",
  ratioIntentRegex: "\\b(quick ratio|acid test|cash runway|runway|current ratio|debt[-\\s]?to[-\\s]?equity|interest coverage|roi|roe|roa|eps|p\\/e|wacc|irr|npv|dso|dpo|gross margin|ebitda margin)\\b|коэффициент|ліквідності|ліквідн|окупаемость|рентабельн|маржа|прибутковост",
  metricIntentRevenueRegex: "\\b(revenue|sales|income|turnover|выручк|доход|дохід|продаж)\\b",
  metricIntentExpenseRegex: "\\b(expense|cost|spend|cogs|opex|расход|витрат)\\b",
  metricIntentProfitRegex: "\\b(profit|margin|ebit|ebitda|прибут|прибыл)\\b",
  aggregateSingleYearRegex: "(?:\\bfor\\b|\\bin\\b|\\bза\\b)\\s*(?:19|20)\\d{2}\\b",
  aggregateComparisonRegex: "\\b(yoy|year over year|year-over-year|annual growth|yearly growth|previous year|last year|vs\\.?|versus|compare|comparison|trend|over time|timeline|mom|qoq|delta|difference|between|changed|change from|growth by year|г\\/г|р\\/р|год к году|рік до року|разниц|дельт|різниц|зміна)\\b",
  selfLearningEnabled: true,
  selfLearningRetentionDays: 90,
  selfLearningMaxMemories: 5000,
  selfLearningMinConfidence: 0.6,
  promptContextCarryForwardRule: "For follow-up questions (e.g., 'and 2024?', 'what about 2025?', 'only 2023'), keep prior metric and operation unless user explicitly names a different metric.",
  promptSingleScalarRule: "If the user asks for a single scalar value, return exactly one short sentence with value and context.",
  promptTotalInYearShapeRule: "If user asks 'total <metric> in/for <year>', mirror that form directly in one sentence in output locale.",
  promptStructuredSectionsRule: "Interpret context in this order: schema_profile, conversation_history, user question, then constraints. Keep reasoning grounded to sheet data only.",
  promptCompositeDecomposeRule: "If user asks a composite question with multiple intents, decompose internally into sub-steps and return one merged concise answer.",
  debugHeaderResolutionResponse: false,
};

function resolveOpenAIRequestFailureReason(error) {
  const message = String(error?.message || "");
  if (message.includes("openai_network_error:")) return "provider_network_error";
  if (message.includes("openai_request_timeout:")) return "provider_timeout";
  if (String(error?.code || "").includes("no_api_key")) return "provider_not_configured";
  return "provider_request_failed";
}

function aiError(code, details = {}) {
  return { error: code, code, ...details };
}

function detectIntentLabel(message = "") {
  const s = String(message || "").toLowerCase();
  if (asksYoyWithPerYearDriver(s)) return "composite_yoy_drivers_per_year";
  if (asksDifferenceBetweenYears(s)) return "two_year_delta";
  if (/\b(yoy|year over year|year-over-year|г\/г|р\/р|год к году|рік до року)\b/i.test(s)) return "yoy";
  if (/\b(top|driver|drivers|contributor|contributors)\b|драйвер|топ/i.test(s)) return "top_n";
  if (/\b(total|sum|for\s+(19|20)\d{2}|in\s+(19|20)\d{2})\b|сумм|всього/i.test(s)) return "single_year_total";
  return "unknown";
}

async function compileDeterministicQueryPlan({ message = "", accountingIntent = {}, headers = [], semanticProfile = {}, sampleRows = [], hints = {} }) {
  const rawPlan = await buildDeterministicSpreadsheetPlan({
    message,
    accountingIntent,
    headers,
    semanticProfile,
    sampleRows,
    hints,
    context: hints?.context || {},
  });
  const validated = validateDeterministicPlanContract(rawPlan);
  return validated?.ok ? rawPlan : (validated?.plan || rawPlan);
}

async function recordLearningEvent({
  req,
  sheetId = null,
  locale = "en",
  message = "",
  answer = "",
  detectedIntent = "unknown",
  resolvedMetric = null,
  yearsDetected = [],
  executedOperation = "none",
  fallbackUsed = false,
  status = "ok",
  latencyMs = null,
}) {
  try {
    await query(
      `INSERT INTO ai_learning_events
        (request_id, sheet_id, user_id, locale, question, answer, detected_intent, resolved_metric, years_detected, executed_operation, fallback_used, status, latency_ms)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13)`,
      [
        req?.id || null,
        sheetId ? String(sheetId) : null,
        Number(req?.user?.id || 0) || null,
        String(locale || "en"),
        String(message || ""),
        String(answer || ""),
        String(detectedIntent || "unknown"),
        resolvedMetric ? String(resolvedMetric) : null,
        JSON.stringify(Array.isArray(yearsDetected) ? yearsDetected : []),
        String(executedOperation || "none"),
        fallbackUsed === true,
        String(status || "ok"),
        Number.isFinite(Number(latencyMs)) ? Number(latencyMs) : null,
      ]
    );
  } catch {}
}

async function upsertLearningCandidate({ locale = "en", phrase = "", suggestedIntent = "unknown", suggestedPayload = {}, confidence = 0.5 }) {
  const extractLearnPhrase = (raw = "") => {
    const text = String(raw || "").trim();
    if (!text) return "";
    const explicit = text.match(/question\/phrase to learn:\s*(.+)$/i);
    if (explicit && explicit[1]) return explicit[1].trim();
    const sanitized = text
      .replace(/^\s*-\s*bad answer:.*$/gim, "")
      .replace(/^\s*-\s*expected answer:.*$/gim, "")
      .replace(/^\s*-\s*question\/phrase to learn:.*$/gim, "")
      .trim();
    return sanitized || text;
  };
  const normalizedPhrase = extractLearnPhrase(phrase).toLowerCase().slice(0, 500);
  if (!normalizedPhrase) return;
  try {
    const rows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", ["ai_self_learning_settings"]);
    const settings = rows?.[0]?.value && typeof rows[0].value === "object" ? rows[0].value : {};
    const autoApproveAllCandidates = settings?.autoApproveAllCandidates === true || String(settings?.autoApproveAllCandidates || "").toLowerCase() === "true";
    const nextStatus = autoApproveAllCandidates ? "approved" : "pending";
    const result = await query(
      `INSERT INTO ai_learning_candidates
         (locale, phrase, suggested_intent, suggested_payload, evidence_count, confidence, status, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, 1, $5, $6, CURRENT_TIMESTAMP)
       ON CONFLICT (locale, phrase, suggested_intent) WHERE status = 'pending'
       DO UPDATE SET
         evidence_count = ai_learning_candidates.evidence_count + 1,
         confidence = GREATEST(ai_learning_candidates.confidence, EXCLUDED.confidence),
         suggested_payload = EXCLUDED.suggested_payload,
         updated_at = CURRENT_TIMESTAMP
       RETURNING id`,
      [String(locale || "en"), normalizedPhrase, String(suggestedIntent || "unknown"), JSON.stringify(suggestedPayload || {}), Number(confidence) || 0.5, nextStatus]
    );
    if (autoApproveAllCandidates) {
      const candidateId = result?.[0]?.id || null;
      if (candidateId) {
        const existing = await query(
          `SELECT id FROM ai_learning_rules WHERE locale = $1 AND phrase = $2 AND mapped_intent = $3 LIMIT 1`,
          [String(locale || "en"), normalizedPhrase, String(suggestedIntent || "unknown")]
        );
        if (!existing?.[0]?.id) {
          const ruleRows = await query(
            `INSERT INTO ai_learning_rules
               (scope, locale, phrase, mapped_intent, mapped_payload, confidence, status, approved_by)
             VALUES ('global', $1, $2, $3, $4::jsonb, 0.9, 'approved', NULL)
             RETURNING id`,
            [String(locale || "en"), normalizedPhrase, String(suggestedIntent || "unknown"), JSON.stringify(suggestedPayload || {})]
          );
          const approvedRuleId = ruleRows?.[0]?.id || null;
          if (approvedRuleId) {
            await query(
              `UPDATE ai_learning_candidates
               SET approved_rule_id = $2, reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
               WHERE id = $1`,
              [candidateId, approvedRuleId]
            );
          }
        }
      }
    }
  } catch {}
}

let SEMANTIC_CACHE = null;
let RATIO_CACHE = null;
let CACHE_TS = 0;
const PENDING_CLARIFICATIONS = new Map();
const CLARIFICATION_TTL_MS = 10 * 60 * 1000;
const LAST_DETERMINISTIC_CONTEXT = new Map();
const DETERMINISTIC_CONTEXT_TTL_MS = 30 * 60 * 1000;

const CHAT_SAMPLE_ROWS = Number.parseInt(process.env.CHAT_SAMPLE_ROWS || "600", 10);
const HEADER_AI_SAMPLE_ROWS = Math.min(120, Number.parseInt(process.env.HEADER_AI_SAMPLE_ROWS || "60", 10));
const HEADER_AI_SAMPLE_VALUES_PER_COLUMN = Math.min(8, Number.parseInt(process.env.HEADER_AI_SAMPLE_VALUES_PER_COLUMN || "5", 10));

async function loadChatTtsSettings() {
  try {
    const rows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [CHAT_TTS_SETTINGS_KEY]);
    const raw = rows?.[0]?.value;
    const dbCfg = raw && typeof raw === "object" ? raw : {};
    return {
      ...CHAT_TTS_DEFAULTS,
      ...dbCfg,
      voices: { ...(CHAT_TTS_DEFAULTS.voices || {}), ...(dbCfg.voices || {}) },
      models: { ...(CHAT_TTS_DEFAULTS.models || {}), ...(dbCfg.models || {}) },
      speed: { ...(CHAT_TTS_DEFAULTS.speed || {}), ...(dbCfg.speed || {}) },
    };
  } catch (e) {
    return CHAT_TTS_DEFAULTS;
  }
}

async function loadChatRuntimeRules() {
  try {
    const rows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [CHAT_RUNTIME_RULES_SETTINGS_KEY]);
    const raw = rows?.[0]?.value;
    const dbCfg = raw && typeof raw === "object" ? raw : {};
    return {
      ...CHAT_RUNTIME_RULES_DEFAULTS,
      ...dbCfg,
      selfLearningEnabled: dbCfg?.selfLearningEnabled !== false,
      selfLearningRetentionDays: Number.isFinite(Number(dbCfg?.selfLearningRetentionDays)) ? Number(dbCfg.selfLearningRetentionDays) : CHAT_RUNTIME_RULES_DEFAULTS.selfLearningRetentionDays,
      selfLearningMaxMemories: Number.isFinite(Number(dbCfg?.selfLearningMaxMemories)) ? Number(dbCfg.selfLearningMaxMemories) : CHAT_RUNTIME_RULES_DEFAULTS.selfLearningMaxMemories,
      selfLearningMinConfidence: Number.isFinite(Number(dbCfg?.selfLearningMinConfidence)) ? Number(dbCfg.selfLearningMinConfidence) : CHAT_RUNTIME_RULES_DEFAULTS.selfLearningMinConfidence,
      shortYearFollowupMaxChars: Number.isFinite(Number(dbCfg?.shortYearFollowupMaxChars))
        ? Number(dbCfg.shortYearFollowupMaxChars)
        : CHAT_RUNTIME_RULES_DEFAULTS.shortYearFollowupMaxChars,
    };
  } catch {
    return CHAT_RUNTIME_RULES_DEFAULTS;
  }
}

function toNum(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (!v) return null;
  const n = parseFloat(String(v).replace(/[$,%\s,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function looksLikeDateText(v) {
  const s = String(v || "").trim();
  if (!s) return false;
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(s) ||
    /^\d{2}-\d{2}-\d{4}$/.test(s) ||
    /^\d{2}\/\d{2}\/\d{4}$/.test(s) ||
    /^\d{4}\/\d{2}\/\d{2}$/.test(s)
  );
}

function toSqlDateLiteral(v) {
  const s = String(v || "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(s)) return s.replaceAll("/", "-");
  if (/^\d{2}-\d{2}-\d{4}$/.test(s)) {
    const [mm, dd, yyyy] = s.split("-");
    return `${yyyy}-${mm}-${dd}`;
  }
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
    const [mm, dd, yyyy] = s.split("/");
    return `${yyyy}-${mm}-${dd}`;
  }
  return null;
}

function buildSqlSafeDateExpr(valueExpr) {
  return `(
    CASE
      WHEN (${valueExpr}) ~ '^\\s*\\d{4}-\\d{2}-\\d{2}\\s*$' THEN CAST(TRIM(${valueExpr}) AS DATE)
      WHEN (${valueExpr}) ~ '^\\s*\\d{4}/\\d{2}/\\d{2}\\s*$' THEN CAST(REPLACE(TRIM(${valueExpr}), '/', '-') AS DATE)
      WHEN (${valueExpr}) ~ '^\\s*\\d{2}-\\d{2}-\\d{4}\\s*$' THEN to_date(TRIM(${valueExpr}), 'MM-DD-YYYY')
      WHEN (${valueExpr}) ~ '^\\s*\\d{2}/\\d{2}/\\d{4}\\s*$' THEN to_date(TRIM(${valueExpr}), 'MM/DD/YYYY')
      ELSE NULL
    END
  )`;
}

function parseDateValue(v) {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return d;
  }
  const n = Number(v);
  if (!Number.isNaN(n) && n > 25569 && n < 60000) {
    const ms = (n - 25569) * 86400 * 1000;
    const d = new Date(Date.UTC(1970, 0, 1) + ms);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

function detectQuarterFromText(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  const qy = s.match(/\bQ([1-4])\b(?:\s*[-/ ]?\s*(\d{4}))?/i);
  if (qy) return qy[2] ? `Q${qy[1]} ${qy[2]}` : `Q${qy[1]}`;
  const yq = s.match(/\b(\d{4})\s*[-/ ]?\s*Q([1-4])\b/i);
  if (yq) return `Q${yq[2]} ${yq[1]}`;
  const roman = s.match(/\b([IV]{1,3}|IV)\s*квартал\b(?:\s*(\d{4}))?/i);
  if (roman) {
    const map = { I: 1, II: 2, III: 3, IV: 4 };
    const q = map[String(roman[1]).toUpperCase()];
    if (q) return roman[2] ? `Q${q} ${roman[2]}` : `Q${q}`;
  }
  const local = s.match(/\b(?:квартал|quarter)\s*([1-4])\b(?:\s*(\d{4}))?/i);
  if (local) return local[2] ? `Q${local[1]} ${local[2]}` : `Q${local[1]}`;
  return null;
}

function quarterFromDate(date) {
  const month = date.getMonth();
  const q = Math.floor(month / 3) + 1;
  return `Q${q} ${date.getFullYear()}`;
}

function augmentRowsWithQuarter(rows = [], headers = []) {
  if (!Array.isArray(rows) || !rows.length) return { rows, headers };
  const baseHeaders = Array.isArray(headers) ? [...headers] : [];
  const dateLike = baseHeaders.filter((h) => /date|time|period|month|year|дата|період/i.test(String(h)));
  const dateCol = dateLike[0] || null;

  const enriched = rows.map((r) => {
    const row = typeof r === "object" && r ? { ...r } : {};
    let q = null;
    let y = null;
    let m = null;

    if (dateCol) {
      const d = parseDateValue(row[dateCol]);
      if (d) {
        q = quarterFromDate(d);
        y = String(d.getFullYear());
        m = d.toLocaleString('en-US', { month: 'long' });
      }
    }

    if (!q) {
      for (const h of baseHeaders) {
        if (q) break;
        q = detectQuarterFromText(row[h]);
      }
    }

    if (q) row.Quarter = q;
    if (y) row.Year = y;
    if (m) row.Month = m;
    return row;
  });

  const hasExtra = enriched.some((r) => r && (r.Quarter || r.Year));
  const outHeaders = [...baseHeaders];
  if (hasExtra) {
    if (!outHeaders.includes("Quarter")) outHeaders.push("Quarter");
    if (!outHeaders.includes("Year")) outHeaders.push("Year");
    if (!outHeaders.includes("Month")) outHeaders.push("Month");
  }
  return { rows: enriched, headers: outHeaders };
}

function formatValue(v, locale = "en", col = "", forSpeech = false) {
  if (typeof v !== "number" || !Number.isFinite(v)) return String(v ?? "");
  
  const isCurrency = col && /price|cost|revenue|income|profit|earnings|salary|wage|amount|balance|total|summ|ebitda|val|fee|tax|debt|loan|payment|capital|asset|liability|equity|budget|spend|cash|funding|sales|purchase/i.test(String(col));
  const isPercent = col && /percent|margin|rate|ratio|%|markup|yield|growth|change|variance|contribution|roi|roe|roa|discount|utilization/i.test(String(col));

  try {
    const abs = Math.abs(v);
    const sign = v < 0 ? "-" : "";
    const num = abs.toLocaleString("en-US", {
      useGrouping: !forSpeech,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    const pfx = isCurrency ? "$" : "";
    const sfx = (isPercent && !isCurrency) ? "%" : "";
    return `${sign}${pfx}${num}${sfx}`;
  } catch (e) {
    const abs = Math.abs(v);
    const sign = v < 0 ? "-" : "";
    const pfx = isCurrency ? "$" : "";
    const sfx = (isPercent && !isCurrency) ? "%" : "";
    return `${sign}${pfx}${String(abs)}${sfx}`;
  }
}

/**
 * PERF-01: Server-Side Math
 * Executes heavy calculations in PostgreSQL instead of Node.js memory.
 */
function normalizeActiveDashboardFilters(headers = [], activeFilters = {}) {
  if (!activeFilters || typeof activeFilters !== "object" || Array.isArray(activeFilters)) return [];
  const headerList = Array.isArray(headers) ? headers : [];
  const resolveHeader = (name) => {
    const raw = String(name || "").trim();
    if (!raw) return null;
    return headerList.find((h) => String(h).trim().toLowerCase() === raw.toLowerCase()) || null;
  };

  const out = [];
  Object.entries(activeFilters).forEach(([rawColumn, rawValue]) => {
    const column = resolveHeader(rawColumn);
    if (!column || rawValue === null || rawValue === undefined || rawValue === "") return;

    if (Array.isArray(rawValue)) {
      const values = rawValue
        .map((v) => String(v ?? ""))
        .filter((v) => v !== "")
        .slice(0, 100);
      if (values.length) out.push({ column, operator: "in", values });
      return;
    }

    if (rawValue && typeof rawValue === "object") {
      const value = String(rawValue.value ?? "").trim();
      if (!value) return;
      const operator = String(rawValue.operator || rawValue.type || "contains").toLowerCase() === "equals"
        ? "equals"
        : "contains";
      out.push({ column, operator, value });
    }
  });
  return out;
}

async function computeSqlAggregation({ sheetId, user, operation, targetColumn, groupBy, filters = [], rowFiltersList = [], allowedColumns = null, limit = 5, locale = "en", tabName = null, actualHeaders = [] }) {
    const op = String(operation || "none").toLowerCase();
    const lang = String(locale || "en").toLowerCase();
    const isUk = lang.startsWith("uk");
    const isRu = lang.startsWith("ru");
    const nLimit = Number.isInteger(limit) ? limit : 5;
    const allowedColumnSet = Array.isArray(allowedColumns) && allowedColumns.length
      ? new Set(allowedColumns.map((c) => String(c)))
      : null;
    const canUseColumn = (column) => !allowedColumnSet || allowedColumnSet.has(String(column));
    
    // 1. Build Base Where Clause (RBAC + Tab + AI Filters)
    let sql = `SELECT `;
    const params = [sheetId];
    let where = `WHERE sheet_id = $1`;

    if (tabName) {
        where += ` AND tab_name = $${params.length + 1}`;
        params.push(tabName);
    }

    // Apply RBAC row filters in SQL
    const rowFilterSql = buildRowFilterWhereClause(rowFiltersList, params.length + 1, actualHeaders);
    if (rowFilterSql.sql) {
      where += rowFilterSql.sql;
      params.push(...rowFilterSql.params);
    }

    // Add AI Filters to SQL
    filters.forEach(f => {
        if (!f.column) return;
        if (f.operator === "in") {
            const values = Array.isArray(f.values) ? f.values.map((v) => String(v ?? "")).filter((v) => v !== "") : [];
            if (!values.length) return;
            const colIdx = params.length + 1;
            const valIdx = params.length + 2;
            params.push(f.column, values);
            where += ` AND ((row_data->>$${colIdx}) = ANY($${valIdx}::text[]))`;
            return;
        }
        if (f.value === undefined) return;
        
        let colSql = `row_data->>$${params.length + 1}`;
        // Support virtual columns in filters
        if (f.column === "Year") colSql = `EXTRACT(YEAR FROM (CAST(row_data->>$${params.length + 1} AS DATE)))::text`;
        if (f.column === "Month") colSql = `TO_CHAR(CAST(row_data->>$${params.length + 1} AS DATE), 'Month')`;
        if (f.column === "Quarter") colSql = `'Q' || TO_CHAR(CAST(row_data->>$${params.length + 1} AS DATE), 'Q YYYY')`;
        
        const valIdx = params.length + 2;
        params.push(f.column === "Year" || f.column === "Month" || f.column === "Quarter" ? "Date" : f.column, String(f.value));
        const numericFilterVal = toNum(f.value);
        const dateFilterVal = toSqlDateLiteral(f.value);
        const isVirtualDateCol = f.column === "Year" || f.column === "Month" || f.column === "Quarter";
        const useDateComparators = !isVirtualDateCol && !!dateFilterVal && (
          looksLikeDateText(f.value) ||
          /date|time|day|month|year|period|quarter|дата|період|рік|год/i.test(String(f.column || ""))
        );
        const safeDateExpr = buildSqlSafeDateExpr(colSql);

        switch(f.operator) {
            case 'year_equals':
              where += ` AND (
                CASE
                  WHEN (${colSql}) ~ '^\\s*\\d{4}\\s*$' THEN CAST(TRIM(${colSql}) AS INT)
                  WHEN (${colSql}) ~ '^\\s*\\d{4}[-/]\\d{2}[-/]\\d{2}\\s*$' THEN EXTRACT(YEAR FROM CAST(REPLACE(TRIM(${colSql}), '/', '-') AS DATE))::INT
                  WHEN (${colSql}) ~ '^\\s*\\d{2}[-/]\\d{2}[-/]\\d{4}\\s*$' THEN CAST(RIGHT(TRIM(${colSql}), 4) AS INT)
                  ELSE NULL
                END
              ) = $${valIdx}::int`;
              break;
            case 'gt':
              if (useDateComparators) {
                params[params.length - 1] = dateFilterVal;
                where += ` AND (${safeDateExpr} > $${valIdx}::date)`;
              } else if (numericFilterVal !== null) {
                params[params.length - 1] = String(numericFilterVal);
                where += ` AND (CAST(NULLIF(regexp_replace(${colSql}, '[^0-9.-]', '', 'g'), '') AS NUMERIC) > $${valIdx}::numeric)`;
              } else {
                where += ` AND (${colSql} > $${valIdx})`;
              }
              break;
            case 'gte':
              if (useDateComparators) {
                params[params.length - 1] = dateFilterVal;
                where += ` AND (${safeDateExpr} >= $${valIdx}::date)`;
              } else if (numericFilterVal !== null) {
                params[params.length - 1] = String(numericFilterVal);
                where += ` AND (CAST(NULLIF(regexp_replace(${colSql}, '[^0-9.-]', '', 'g'), '') AS NUMERIC) >= $${valIdx}::numeric)`;
              } else {
                where += ` AND (${colSql} >= $${valIdx})`;
              }
              break;
            case 'lt':
              if (useDateComparators) {
                params[params.length - 1] = dateFilterVal;
                where += ` AND (${safeDateExpr} < $${valIdx}::date)`;
              } else if (numericFilterVal !== null) {
                params[params.length - 1] = String(numericFilterVal);
                where += ` AND (CAST(NULLIF(regexp_replace(${colSql}, '[^0-9.-]', '', 'g'), '') AS NUMERIC) < $${valIdx}::numeric)`;
              } else {
                where += ` AND (${colSql} < $${valIdx})`;
              }
              break;
            case 'lte':
              if (useDateComparators) {
                params[params.length - 1] = dateFilterVal;
                where += ` AND (${safeDateExpr} <= $${valIdx}::date)`;
              } else if (numericFilterVal !== null) {
                params[params.length - 1] = String(numericFilterVal);
                where += ` AND (CAST(NULLIF(regexp_replace(${colSql}, '[^0-9.-]', '', 'g'), '') AS NUMERIC) <= $${valIdx}::numeric)`;
              } else {
                where += ` AND (${colSql} <= $${valIdx})`;
              }
              break;
            case 'equals': where += ` AND (${colSql} = $${valIdx})`; break;
            default: where += ` AND (${colSql} ILIKE $${valIdx})`; params[params.length-1] = `%${f.value}%`; break;
        }
    });

    const canUseSummaryPath =
      !Array.isArray(rowFiltersList) || rowFiltersList.length === 0
        ? !(Array.isArray(filters) && filters.length > 0)
        : false;

    try {
        if (canUseSummaryPath && targetColumn && ["count", "sum", "avg", "top_n", "year_over_year"].includes(op)) {
            const summaryParams = [sheetId, targetColumn];
            let summaryWhere = `WHERE sheet_id = $1 AND metric_key = $2`;
            if (tabName) {
              summaryParams.push(tabName);
              summaryWhere += ` AND tab_name = $${summaryParams.length}`;
            }

            if (op === "count") {
              const rows = await query(`SELECT COALESCE(SUM(agg_count), 0)::bigint AS c FROM sheet_insight_summaries ${summaryWhere}`, summaryParams);
              const c = Number(rows?.[0]?.c || 0);
              return { answer: isUk ? `Кількість: ${c} рядків` : (isRu ? `Количество: ${c} строк` : `Count: ${c} rows`), previewRows: [] };
            }

            if (op === "sum" && !groupBy) {
              const rows = await query(
                `SELECT COALESCE(SUM(agg_sum), 0)::numeric AS v
                   FROM sheet_insight_summaries
                  ${summaryWhere}
                    AND category_key = '__all__'`,
                summaryParams
              );
              const v = Number(rows?.[0]?.v || 0);
              return { answer: `${isUk ? "Сума" : (isRu ? "Сумма" : "Total")} ${targetColumn}: ${formatValue(v, locale, targetColumn)}`, previewRows: [] };
            }

            if (op === "avg" && !groupBy) {
              const rows = await query(
                `SELECT
                    CASE WHEN COALESCE(SUM(agg_count),0) = 0 THEN NULL
                         ELSE (COALESCE(SUM(agg_sum),0) / NULLIF(COALESCE(SUM(agg_count),0),0)) END AS v
                   FROM sheet_insight_summaries
                  ${summaryWhere}
                    AND category_key = '__all__'`,
                summaryParams
              );
              const v = Number(rows?.[0]?.v || 0);
              return { answer: `${isUk ? "Середнє" : (isRu ? "Среднее" : "Average")} ${targetColumn}: ${formatValue(v, locale, targetColumn)}`, previewRows: [] };
            }

            if (op === "top_n" && groupBy) {
              const rows = await query(
                `SELECT category_key AS label, COALESCE(SUM(agg_sum),0)::numeric AS value
                   FROM sheet_insight_summaries
                  ${summaryWhere}
                    AND category_key <> '__all__'
               GROUP BY category_key
               ORDER BY value DESC
                  LIMIT $${summaryParams.length + 1}`,
                [...summaryParams, nLimit]
              );
              if (!rows.length) return { answer: isUk ? "Відповідних даних не знайдено." : (isRu ? "Подходящие данные не найдены." : "No matching data found."), previewRows: [] };
              const answer = (isUk ? `Топ ${rows.length} ${groupBy} за ${targetColumn}:\n` : (isRu ? `Топ ${rows.length} ${groupBy} по ${targetColumn}:\n` : `Top ${rows.length} ${groupBy} by ${targetColumn}:\n`)) +
                rows.map((r, i) => `${i+1}. ${r.label}: ${formatValue(Number(r.value), locale, targetColumn)}`).join("\n");
              return { answer, previewRows: rows };
            }

            if (op === "year_over_year") {
              const rows = await query(
                `SELECT period_key, COALESCE(SUM(agg_sum),0)::numeric AS value
                   FROM sheet_insight_summaries
                  ${summaryWhere}
                    AND category_key = '__all__'
                    AND period_key ~ '^\\d{4}$'
               GROUP BY period_key
               ORDER BY period_key ASC`,
                summaryParams
              );
              if (!rows.length || rows.length < 2) return { answer: isUk ? "Відповідних даних не знайдено." : (isRu ? "Подходящие данные не найдены." : "No matching data found."), previewRows: [] };
              const points = rows.map((r) => ({ year: Number(r.period_key), value: Number(r.value || 0) })).filter((p) => Number.isFinite(p.year)).sort((a,b)=>a.year-b.year);
              const lines = [];
              for (let i = 1; i < points.length; i++) {
                const cur = points[i];
                const prev = points[i-1];
                const diff = cur.value - prev.value;
                const pct = prev.value === 0 ? 0 : (diff / Math.abs(prev.value)) * 100;
                lines.push(`• ${cur.year} vs ${prev.year}: ${formatValue(cur.value, locale, targetColumn)} vs ${formatValue(prev.value, locale, targetColumn)} (${diff >= 0 ? "+" : ""}${formatValue(diff, locale, targetColumn)}, ${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%)`);
              }
              return { answer: `${isUk ? `Аналіз рік до року для ${targetColumn}:` : (isRu ? `Анализ год к году для ${targetColumn}:` : `Year over Year analysis for ${targetColumn}:`)}\n${lines.join("\n")}`, previewRows: rows };
            }
        }

        if (op === "count") {
            const res = await query(`SELECT COUNT(*) as c FROM sheet_rows ${where}`, params);
            return { answer: isUk ? `Кількість: ${res[0].c} рядків` : (isRu ? `Количество: ${res[0].c} строк` : `Count: ${res[0].c} rows`), previewRows: [] };
        }

        if (!targetColumn) return null;
        if (!canUseColumn(targetColumn)) return null;
        if (groupBy && !["Year", "Month", "Quarter"].includes(groupBy) && !canUseColumn(groupBy)) return null;

        // Common Numeric Casting for target column
        const valSql = `CASE
            WHEN (row_data->>$${params.length + 1}) ~ '^\\s*[-+]?\\d{1,3}(?:,\\d{3})*(?:\\.\\d+)?\\s*%?\\s*$'
              OR (row_data->>$${params.length + 1}) ~ '^\\s*[-+]?\\d+(?:\\.\\d+)?\\s*%?\\s*$'
              OR (row_data->>$${params.length + 1}) ~ '^\\s*[-+]?\\.\\d+\\s*%?\\s*$'
            THEN CAST(NULLIF(regexp_replace(row_data->>$${params.length + 1}, '[^0-9.+-]', '', 'g'), '') AS NUMERIC)
            ELSE NULL
          END`;
        params.push(targetColumn);

        if (groupBy && ["sum", "avg", "top_n", "max", "min"].includes(op)) {
            let groupSqlCol = `row_data->>$${params.length + 1}`;
            if (groupBy === "Year") groupSqlCol = `EXTRACT(YEAR FROM (CAST(row_data->>$${params.length + 1} AS DATE)))::text`;
            if (groupBy === "Month") groupSqlCol = `TO_CHAR(CAST(row_data->>$${params.length + 1} AS DATE), 'Month')`;
            if (groupBy === "Quarter") groupSqlCol = `'Q' || TO_CHAR(CAST(row_data->>$${params.length + 1} AS DATE), 'Q YYYY')`;
            
            params.push(groupBy === "Year" || groupBy === "Month" || groupBy === "Quarter" ? "Date" : groupBy);
            const aggOp = (op === "avg") ? "AVG" : (op === "max" ? "MAX" : (op === "min" ? "MIN" : "SUM"));
            
            const groupSql = `
                SELECT ${groupSqlCol} as label, ${aggOp}(${valSql}) as value
                FROM sheet_rows
                ${where}
                GROUP BY label
                ORDER BY value DESC
                LIMIT $${params.length + 1}
            `;
            params.push(nLimit);
            const rows = await query(groupSql, params);
            if (!rows.length) return { answer: isUk ? "Відповідних даних не знайдено." : (isRu ? "Подходящие данные не найдены." : "No matching data found."), previewRows: [] };

            const answer = (isUk ? `Топ ${rows.length} ${groupBy} за ${targetColumn}:\n` : (isRu ? `Топ ${rows.length} ${groupBy} по ${targetColumn}:\n` : `Top ${rows.length} ${groupBy} by ${targetColumn}:\n`)) +
                rows.map((r, i) => `${i+1}. ${r.label}: ${formatValue(Number(r.value), locale, targetColumn)}`).join("\n");
            
            return { answer, previewRows: rows };
        }

        if (["sum", "avg", "max", "min"].includes(op)) {
            const aggOp = op.toUpperCase();
            const res = await query(`SELECT ${aggOp}(${valSql}) as v FROM sheet_rows ${where}`, params);
            const val = Number(res[0].v || 0);
            const labels = isUk
              ? { SUM: "Сума", AVG: "Середнє", MAX: "Максимум", MIN: "Мінімум" }
              : (isRu ? { SUM: "Сумма", AVG: "Среднее", MAX: "Максимум", MIN: "Минимум" } : { SUM: "Total", AVG: "Average", MAX: "Max", MIN: "Min" });
            return { answer: `${labels[aggOp]} ${targetColumn}: ${formatValue(val, locale, targetColumn)}`, previewRows: [] };
        }

    } catch (e) {
        console.error("SQL Aggregation failed:", e);
        return null; // Fallback to memory-based for complex ones or on error
    }

    return null;
}

function inferAggregateBucketFromMessage(message = "", ai = {}) {
  const msg = String(message || "").toLowerCase();
  const op = String(ai?.operation || "").toLowerCase();
  if (op === "year_over_year" || /\b(yoy|year over year|year-over-year|annual growth|yearly growth|last year|previous year|год к году|г\/г|р\/р|річне обчислення)\b/i.test(msg)) {
    return "year";
  }
  if (/\b(quarter|quarterly|qoq|q\/q|quarter over quarter|quarter-over-quarter)\b/i.test(msg)) {
    return "quarter";
  }
  if (/\b(month|monthly|mom|m\/m|month over month|month-over-month|trend|over time|timeline|chart|plot|graph)\b/i.test(msg) || op === "trend" || op === "chart" || op === "plot") {
    return "month";
  }
  return null;
}

function isDateRelatedQuestion(message = "") {
  const msg = String(message || "").toLowerCase();
  if (!msg.trim()) return false;
  return /\b(yoy|year over year|year-over-year|annual|yearly|last year|previous year|this year|current year|ytd|year\s*to\s*date|trend|over time|timeline|time series|by year|by month|by quarter|per year|per month|per quarter|monthly|quarterly|weekly|daily|date|dates|period|periods|month|months|quarter|quarters|week|weeks|day|days|year|years|q[1-4]|mom|m\/m|qoq|q\/q)\b|год к году|г\/г|р\/р|рік до року|річн|прошл(ый|ого)\s+год|минул(ий|ого)\s+рік|поточн(ий|ого)\s+рік|текущ(ий|его)\s+год|рік|год|місяц|месяц|квартал|дата|період|период|тиждень|недел/i.test(msg);
}

function isTemporalHeaderName(header = "") {
  const s = String(header || "").trim().toLowerCase().replace(/[_-]+/g, " ");
  if (!s) return false;
  return /\b(date|timestamp|time|period|calendar|fiscal|fy|year|month|week|day|quarter|qtr|дата|період|период|рік|год|місяць|месяц|тиждень|неделя|день|квартал)\b/i.test(s);
}

function sheetHasTemporalColumn(headers = [], sampleRows = [], semanticProfile = null) {
  const headerList = Array.isArray(headers) ? headers : [];
  if (!headerList.length) return false;
  if (headerList.some(isTemporalHeaderName)) return true;
  const profileDateColumn = resolveProfileDateColumn(semanticProfile, []);
  if (profileDateColumn && headerList.includes(profileDateColumn) && isTemporalHeaderName(profileDateColumn)) return true;
  return false;
}

function noDateColumnAnswer(locale = "en") {
  const normalized = normalizeLocale(locale || "en");
  if (normalized === "uk") {
    return "Я не можу відповідати на питання про дати, роки, місяці, тижні, квартали або тренди, бо в цьому аркуші немає колонки дати, року, місяця, тижня, кварталу, дня або періоду.";
  }
  if (normalized === "ru") {
    return "Я не могу отвечать на вопросы о датах, годах, месяцах, неделях, кварталах или трендах, потому что в этом листе нет колонки даты, года, месяца, недели, квартала, дня или периода.";
  }
  if (normalized === "es") {
    return "No puedo responder preguntas sobre fechas, años, meses, semanas, trimestres o tendencias porque esta hoja no tiene una columna de fecha, año, mes, semana, trimestre, día o periodo.";
  }
  return "I can't answer date-related questions because this sheet does not have a date, year, month, week, quarter, day, or period column.";
}

function inferAggregateOperationFromMessage(message = "", ai = {}, rules = CHAT_RUNTIME_RULES_DEFAULTS) {
  const msg = String(message || "").toLowerCase();
  const op = String(ai?.operation || "").toLowerCase();
  const hasExplicitSingleYear = runtimeRegex(rules, "aggregateSingleYearRegex", CHAT_RUNTIME_RULES_DEFAULTS.aggregateSingleYearRegex).test(msg);
  const hasComparisonCue = runtimeRegex(rules, "aggregateComparisonRegex", CHAT_RUNTIME_RULES_DEFAULTS.aggregateComparisonRegex).test(msg);
  if (hasExplicitSingleYear && !hasComparisonCue) {
    return /\b(average|mean)\b/i.test(msg) ? "avg" : "sum";
  }
  if (["count", "sum", "avg", "max", "min", "top_n", "year_over_year", "chart", "plot", "trend"].includes(op)) {
    return op;
  }
  if (/\b(how many|count|number of|total rows|row count|records? (?:are|were)|entries?)\b/i.test(msg)) return "count";
  if (/\b(average|mean|per (?:day|week|month|year|customer|user|order|transaction))\b/i.test(msg)) return "avg";
  if (/\b(top|highest|largest|biggest|best|most|leading|drivers?|drives|rank(?:ing)?|bottom|lowest|least|smallest)\b/i.test(msg)) return "top_n";
  if (/\b(yoy|year over year|year-over-year|annual growth|yearly growth|last year|previous year|trend|over time|timeline|monthly|quarterly)\b/i.test(msg)) return "year_over_year";
  if (/\b(total|sum|combined|overall|revenue|sales|income|cost|expense|spend|profit|amount|balance|cash|budget|fees?|taxes?|orders?|payments?)\b/i.test(msg)) return "sum";
  return null;
}

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
          where += ` AND (CAST(NULLIF(regexp_replace(${colSql}, '[^0-9.-]', '', 'g'), '') AS NUMERIC) > $${valIdx}::numeric)`;
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
          where += ` AND (CAST(NULLIF(regexp_replace(${colSql}, '[^0-9.-]', '', 'g'), '') AS NUMERIC) >= $${valIdx}::numeric)`;
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
          where += ` AND (CAST(NULLIF(regexp_replace(${colSql}, '[^0-9.-]', '', 'g'), '') AS NUMERIC) < $${valIdx}::numeric)`;
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
          where += ` AND (CAST(NULLIF(regexp_replace(${colSql}, '[^0-9.-]', '', 'g'), '') AS NUMERIC) <= $${valIdx}::numeric)`;
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

export async function computeLargeDatasetAggregateFallback({
  sheetId,
  user,
  operation = null,
  targetColumn = null,
  groupBy = null,
  message = "",
  ai = {},
  headers = [],
  sampleRows = [],
  activeFilters = [],
  rowFiltersList = [],
  tabName = null,
  locale = "en",
  semanticProfile = null,
}) {
  const directFilters = Array.isArray(activeFilters) ? activeFilters : [];
  const hasAdHocFilters = directFilters.length > 0 || (Array.isArray(rowFiltersList) && rowFiltersList.length > 0);
  const { where, params: whereParams } = buildChatWhereClause({
    tabName,
    filters: directFilters,
    rowFiltersList,
  });
  const scopedParams = [sheetId, ...whereParams];
  const scopedCountRows = await query(`SELECT COUNT(*)::int AS c FROM sheet_rows ${where}`, scopedParams);
  const scopedCount = Number(scopedCountRows?.[0]?.c || 0);
  if (scopedCount > CHAT_SQL_AGG_MAX_ROWS) {
    return {
      answer: `Dataset is too large for direct aggregate fallback (${scopedCount} rows > ${CHAT_SQL_AGG_MAX_ROWS}). Narrow filters and retry.`,
      previewRows: [],
      chart: null,
    };
  }
  const inferredOperation = inferAggregateOperationFromMessage(message, { operation: operation || ai?.operation });
  const bucket = inferAggregateBucketFromMessage(message, { operation: operation || ai?.operation });
  const directOp = ["count", "sum", "avg", "max", "min", "top_n"].includes(inferredOperation) ? inferredOperation : null;
  const periodInfo = inferLikelyPeriodColumn(headers, sampleRows, [
    ai?.chart?.date_column,
    groupBy,
    ai?.group_by,
    targetColumn,
    ai?.target_column,
  ]);
  const profileDateColumn = resolveProfileDateColumn(semanticProfile, [
    ai?.chart?.date_column,
    groupBy,
    ai?.group_by,
    targetColumn,
    ai?.target_column,
  ]);
  const dateColumn = periodInfo?.column || profileDateColumn || await inferLikelyDateColumn(headers, sampleRows, [
    ai?.chart?.date_column,
    groupBy,
    ai?.group_by,
    targetColumn,
    ai?.target_column,
  ]);
  const periodMode = periodInfo?.mode || "date";
  const metricColumn = await resolveColumn(headers, targetColumn || ai?.target_column || ai?.chart?.value_column, sampleRows)
    || resolveProfileMetric(semanticProfile, message, [targetColumn, ai?.target_column, ai?.chart?.value_column])
    || inferLikelyMetricColumn(headers, sampleRows, message, [targetColumn, ai?.target_column, ai?.chart?.value_column]);
  const dimensionColumn = await resolveColumn(headers, groupBy || ai?.group_by, sampleRows)
    || resolveProfileDimension(semanticProfile, message, [metricColumn, dateColumn])
    || inferLikelyDimensionColumn(headers, sampleRows, [metricColumn, dateColumn]);

  const allowedColumnSet = Array.isArray(headers) && headers.length ? new Set(headers.map((h) => String(h))) : null;
  if (allowedColumnSet && dateColumn && !allowedColumnSet.has(String(dateColumn))) return null;
  if (allowedColumnSet && metricColumn && !allowedColumnSet.has(String(metricColumn))) return null;
  if (allowedColumnSet && dimensionColumn && !allowedColumnSet.has(String(dimensionColumn))) return null;

  if (directOp) {
    if (directOp === "count") {
      const rows = await query(`SELECT COUNT(*) as c FROM sheet_rows ${where}`, scopedParams);
      return { answer: `Count: ${rows[0]?.c || 0} rows`, previewRows: [], chart: null };
    }

    if (directOp === "top_n") {
      if (!metricColumn || !dimensionColumn) return null;
    } else if (!metricColumn) {
      return null;
    }

    const agg = await computeSqlAggregation({
      sheetId,
      user,
      operation: directOp,
      targetColumn: metricColumn,
      groupBy: directOp === "top_n" ? dimensionColumn : null,
      filters: directFilters,
      rowFiltersList,
      allowedColumns: headers,
      limit: ai?.limit,
      locale,
      tabName,
      actualHeaders: headers
    });
    if (agg) {
      return {
        answer: agg.answer,
        previewRows: agg.previewRows || [],
        chart: directOp === "top_n" ? null : {
          dateColumn: null,
          valueColumn: metricColumn,
          segmentBy: directOp === "top_n" ? dimensionColumn : null,
          aggregation: directOp === "avg" ? "avg" : "sum",
        },
      };
    }
  }

  if (!bucket || !dateColumn || !metricColumn) return null;

  const dateParamIdx = scopedParams.length + 1;
  const metricParamIdx = scopedParams.length + 2;
  const safeBucket = bucket === "quarter" ? "quarter" : (bucket === "month" ? "month" : "year");
  const bucketExpr = periodMode === "year"
    ? `NULLIF(regexp_replace(row_data->>$${dateParamIdx}, '[^0-9]', '', 'g'), '')`
    : periodMode === "quarter"
      ? `COALESCE(NULLIF(row_data->>$${dateParamIdx}, ''), 'Unknown')`
      : periodMode === "month"
        ? `COALESCE(NULLIF(row_data->>$${dateParamIdx}, ''), TO_CHAR(CAST(row_data->>$${dateParamIdx} AS DATE), 'YYYY-MM'))`
        : safeBucket === "quarter"
          ? `'Q' || TO_CHAR(CAST(row_data->>$${dateParamIdx} AS DATE), 'Q YYYY')`
          : safeBucket === "month"
            ? `TO_CHAR(CAST(row_data->>$${dateParamIdx} AS DATE), 'YYYY-MM')`
            : `EXTRACT(YEAR FROM (CAST(row_data->>$${dateParamIdx} AS DATE)))::text`;

  const queryParams = [...scopedParams, dateColumn, metricColumn];
  let rows = [];
  if (safeBucket === "year" && !hasAdHocFilters) {
    rows = await query(
      `SELECT period_year AS period, value
         FROM sheet_metric_yearly_cache
        WHERE sheet_id = $1
          AND tab_name = $2
          AND date_column = $3
          AND metric_column = $4
        ORDER BY period_year ASC`,
      [sheetId, String(tabName || ""), dateColumn, metricColumn]
    );
  }
  if (!rows.length) {
    rows = await query(
      `SELECT ${bucketExpr} AS period,
              SUM(CAST(NULLIF(regexp_replace(row_data->>$${metricParamIdx}, '[^0-9.-]', '', 'g'), '') AS NUMERIC)) AS value
         FROM sheet_rows
         ${where}
        GROUP BY period
        ORDER BY period ASC`,
      queryParams
    );
    if (safeBucket === "year" && !hasAdHocFilters && rows.length) {
      const upsertSql = `
        INSERT INTO sheet_metric_yearly_cache
          (sheet_id, tab_name, date_column, metric_column, period_year, value, source_rows, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, 0, CURRENT_TIMESTAMP)
        ON CONFLICT (sheet_id, tab_name, date_column, metric_column, period_year)
        DO UPDATE SET value = EXCLUDED.value,
                      updated_at = CURRENT_TIMESTAMP
      `;
      for (const row of rows) {
        const period = String(row?.period ?? "").trim();
        const value = Number(row?.value ?? 0);
        if (!period || !Number.isFinite(value)) continue;
        await query(upsertSql, [sheetId, String(tabName || ""), dateColumn, metricColumn, period, value]);
      }
    }
  }

  if (!rows.length) return null;
  const normalizedRows = rows.map((r) => ({
    period: String(r.period ?? ""),
    value: Number(r.value ?? 0),
  })).filter((r) => r.period && Number.isFinite(r.value));
  if (!normalizedRows.length) return null;

  if (safeBucket === "year" && normalizedRows.length >= 2) {
    const last = normalizedRows[normalizedRows.length - 1];
    const prev = normalizedRows[normalizedRows.length - 2];
    const delta = last.value - prev.value;
    const pct = prev.value !== 0 ? (delta / Math.abs(prev.value)) * 100 : null;
    const answer = pct === null
      ? `Year-over-year change for ${metricColumn}: ${formatValue(delta, locale, metricColumn)}.`
      : `Year-over-year change for ${metricColumn}: ${formatValue(delta, locale, metricColumn)} (${delta >= 0 ? "+" : ""}${pct.toFixed(2)}%).`;
    return {
      answer,
      previewRows: normalizedRows.slice(-5),
      chart: {
        dateColumn,
        valueColumn: metricColumn,
        segmentBy: null,
        aggregation: "sum",
      },
    };
  }

  const recent = normalizedRows.slice(-6);
  const seriesText = recent.map((r, idx) => `${idx + 1}. ${r.period}: ${formatValue(r.value, locale, metricColumn)}`).join("\n");
  return {
    answer: `${metricColumn} by ${safeBucket}:\n${seriesText}`,
    previewRows: recent,
    chart: {
      dateColumn,
      valueColumn: metricColumn,
      segmentBy: null,
      aggregation: "sum",
    },
  };
}

async function computeDeterministicAnswer(operation, rows, targetColumn, groupBy, limit = 5, locale = "en", queryText = "") {
  const op = (operation || "none").toLowerCase();
  const lang = String(locale || "en").toLowerCase();
  const isUk = lang.startsWith("uk");
  const isRu = lang.startsWith("ru");
  const q = String(queryText || "").toLowerCase();
  const nLimit = Number.isFinite(Number(limit)) ? Math.max(1, Number(limit)) : 5;

  if (!rows || rows.length === 0) {
    return { answer: isUk ? "Дані за цими критеріями не знайдено." : (isRu ? "Данные по этим критериям не найдены." : "No data matched those criteria."), previewRows: [] };
  }

  if (op === "count") return { answer: isUk ? `Кількість: ${rows.length} рядків` : (isRu ? `Количество: ${rows.length} строк` : `Count: ${rows.length} rows`), previewRows: rows.slice(0, 15) };
  
  // --- Financial Ratio & Analysis Engine (Loaded from DB) ---
  const { ratios } = await loadSemanticBrain();

  const matchedRatio = ratios.find((r) => r?.match?.test?.(q));
  if (matchedRatio) {
    const ratioCols = Array.isArray(matchedRatio.cols) ? matchedRatio.cols : [];
    const rowHeaders = Object.keys(rows?.[0] || {});
    const resolvedCols = await Promise.all(
      ratioCols.map((c) => resolveColumn(rowHeaders, c, rows.slice(0, 10)))
    );
    if (resolvedCols.length > 0 && resolvedCols.every((c) => !!c)) {
        const sums = resolvedCols.map((c) => rows.reduce((acc, r) => acc + (toNum(r[c]) || 0), 0));
        if (sums.every(s => s !== 0 || matchedRatio.key === "rainy_day")) {
            const result = matchedRatio.calc(sums);
            let ans = "";
            if (matchedRatio.format === "percent") ans = `${matchedRatio.label}: ${result.toFixed(2)}%`;
            else if (matchedRatio.format === "ratio") ans = `${matchedRatio.label}: ${result.toFixed(2)}x`;
            else if (matchedRatio.format === "months") ans = `${matchedRatio.label}: ${result.toFixed(1)} months remaining`;
            else if (matchedRatio.format === "weeks") ans = `${matchedRatio.label}: ${result.toFixed(1)} weeks remaining`;
            else if (matchedRatio.format === "days") ans = `${matchedRatio.label}: ${Math.round(result)} days`;
            else ans = `${matchedRatio.label}: ${formatValue(result, locale, resolvedCols[0])}`;
            
            // Add custom pragmatic flavor to the answer
            if (matchedRatio.key === "rainy_day") {
                ans += result > 12 ? ". You can sleep well at night!" : ". This is a tight buffer, watch your expenses.";
            } else if (matchedRatio.key === "headache_ratio") {
                ans += result > 10 ? ". This category might be more trouble than it's worth." : ". This is a very healthy relationship.";
            }
            
            return { answer: ans, previewRows: rows.slice(0, 5) };
        }
    }
  }

  if (!targetColumn) return { answer: isUk ? "Записи знайдено, але відповідну метрику для розрахунку не визначено." : (isRu ? "Записи найдены, но подходящий столбец метрики для расчета не определен." : "I found the matching records, but no specific metric column was identified for calculation."), previewRows: rows.slice(0, 15) };

  const isPercentageCol = /percent|margin|rate|ratio|%/i.test(String(targetColumn));
  const effectiveOp = (op === "sum" && isPercentageCol) ? "avg" : op;

  // --- Year Over Year / Same Period Logic ---
  const isYoYQuery = effectiveOp === "year_over_year" || 
                    (groupBy && /year|дата|рік|год/i.test(String(groupBy)) && (effectiveOp === "sum" || effectiveOp === "top_n")) ||
                    (/previous year|last year|прошлый год|минулий рік/i.test(String(targetColumn || ""))) ||
                    (q.includes("previous year") || q.includes("last year") || q.includes("минулого року") || q.includes("прошлого года"));

  if (isYoYQuery) {
    const keys = Object.keys(rows[0] || {});
    let dateCol = keys.find(k => /date|period|month|year|дата|період|час/i.test(String(k))) || groupBy;
    const explicitYearCol = keys.find((k) => /\byear\b|рік|год/i.test(String(k)));
    const profitCandidates = [
      targetColumn,
      ...keys.filter((k) => /(^|\b)(net\s*profit|чист(ий|ая)\s+прибут(ок|ь))(\b|$)/i.test(String(k))),
      ...keys.filter((k) => /profit|прибут/i.test(String(k))),
    ].filter(Boolean);
    
    let targetRows = rows;

    // Special: "Latest Month" YoY
    if (q.includes("latest month") || q.includes("останній місяць") || q.includes("последний месяц")) {
        // Find latest month in the full set
        let latestDate = null;
        rows.forEach(r => {
            const d = parseDateValue(r[dateCol]);
            if (d && (!latestDate || d > latestDate)) latestDate = d;
        });
        if (latestDate) {
            const targetMonth = latestDate.getMonth();
            const monthName = latestDate.toLocaleString('en-US', { month: 'long' });
            targetRows = rows.filter(r => {
                const d = parseDateValue(r[dateCol]);
                return d && d.getMonth() === targetMonth;
            });
            // Adjust title
            targetColumn = `${targetColumn} for ${monthName}`;
        }
    }

    const yearlySums = {};
    targetRows.forEach(r => {
      const yearSources = [dateCol, explicitYearCol, ...keys.filter((k) => /year|рік|год|date|period|month|дата|період|час/i.test(String(k)))].filter(Boolean);
      let year = null;
      for (const ys of yearSources) {
        const d = parseDateValue(r[ys]);
        year = d ? d.getFullYear() : (Number.isInteger(Number(r[ys])) ? Number(r[ys]) : null);
        if (!year && ys) {
          const yv = Number(String(r?.[ys] ?? "").replace(/[^\d]/g, ""));
          if (Number.isInteger(yv) && yv >= 1900 && yv <= 2200) year = yv;
        }
        if (year) break;
      }
      if (!year && explicitYearCol) {
        const yv = Number(String(r?.[explicitYearCol] ?? "").replace(/[^\d]/g, ""));
        if (Number.isInteger(yv) && yv >= 1900 && yv <= 2200) year = yv;
      }
      if (!year) return;
      let val = null;
      for (const col of profitCandidates) {
        const parsed = toNum(r[col]);
        if (parsed !== null) {
          val = parsed;
          break;
        }
      }
      if (val !== null) yearlySums[year] = (yearlySums[year] || 0) + val;
    });

    const years = dropImplicitTrailingPartialYear(Object.keys(yearlySums), queryText);
    if (years.length >= 2) {
      const explicitYears = extractDistinctYearsInOrder(queryText);
      const asksYearDelta = asksDifferenceBetweenYears(queryText);
      if (asksYearDelta && explicitYears.length >= 2) {
        const startYear = explicitYears[0];
        const endYear = explicitYears[1];
        if (Number.isFinite(yearlySums[startYear]) && Number.isFinite(yearlySums[endYear])) {
          const delta = yearlySums[endYear] - yearlySums[startYear];
          if (asksNumberOnlyResponse(queryText)) {
            return { answer: formatPlainNumber(delta), previewRows: [] };
          }
          return {
            answer: `${endYear} vs ${startYear} ${targetColumn}: ${formatValue(delta, locale, targetColumn)}`,
            previewRows: [{ from_year: startYear, to_year: endYear, change: delta }],
          };
        }
      }

      let comparisonText = "";
      if (locale.startsWith("uk")) {
        comparisonText = `Аналіз року до року для ${targetColumn}:\n`;
      } else if (locale.startsWith("ru")) {
        comparisonText = `Анализ год к году для ${targetColumn}:\n`;
      } else {
        comparisonText = `Year over Year analysis for ${targetColumn}:\n`;
      }
      
      const previewRows = [];
      const growthPercentages = [];
      
      for (let i = 1; i < years.length; i++) {
        const currentYear = years[i];
        const prevYear = years[i - 1];
        const currentVal = yearlySums[currentYear];
        const prevVal = yearlySums[prevYear];
        const diff = currentVal - prevVal;
        const pct = prevVal !== 0 ? (diff / Math.abs(prevVal)) * 100 : 0;
        growthPercentages.push(pct);
        
        comparisonText += `• ${currentYear} vs ${prevYear}: ${formatValue(currentVal, locale, targetColumn)} vs ${formatValue(prevVal, locale, targetColumn)} `;
        comparisonText += `(${diff >= 0 ? "+" : ""}${formatValue(diff, locale, targetColumn)}, ${diff >= 0 ? "+" : ""}${pct.toFixed(2)}%)\n`;
        
        previewRows.push({ year: currentYear, value: currentVal, previous_year: prevYear, previous_value: prevVal, change: diff, change_percent: pct });
      }

      // Add Summary Insights
      const avgGrowth = growthPercentages.reduce((a, b) => a + b, 0) / growthPercentages.length;
      const bestYear = [...previewRows].sort((a, b) => b.change_percent - a.change_percent)[0];
      
      if (locale.startsWith("uk")) {
        comparisonText += `\n**Підсумок:**\n`;
        comparisonText += `• Середньорічне зростання: ${avgGrowth >= 0 ? "+" : ""}${avgGrowth.toFixed(2)}%\n`;
        comparisonText += `• Кращий рік: ${bestYear.year} (${bestYear.change_percent >= 0 ? "+" : ""}${bestYear.change_percent.toFixed(2)}% зростання)`;
      } else if (locale.startsWith("ru")) {
        comparisonText += `\n**Итог:**\n`;
        comparisonText += `• Среднегодовой рост: ${avgGrowth >= 0 ? "+" : ""}${avgGrowth.toFixed(2)}%\n`;
        comparisonText += `• Лучший год: ${bestYear.year} (${bestYear.change_percent >= 0 ? "+" : ""}${bestYear.change_percent.toFixed(2)}% роста)`;
      } else {
        comparisonText += `\n**Summary:**\n`;
        comparisonText += `• Average Annual Growth: ${avgGrowth >= 0 ? "+" : ""}${avgGrowth.toFixed(2)}%\n`;
        comparisonText += `• Best Performing Year: ${bestYear.year} (${bestYear.change_percent >= 0 ? "+" : ""}${bestYear.change_percent.toFixed(2)}% growth)`;
      }

      return { answer: comparisonText.trim(), previewRows };
    }
  }

  if (groupBy && ["max", "min", "top_n", "sum", "avg"].includes(effectiveOp)) {
    const wantsProfitTop = effectiveOp === "top_n" && /\b(profit|margin|ebit|ebitda)\b|прибут|прибыл/i.test(String(targetColumn || ""));
    if (wantsProfitTop) {
      const keys = Object.keys(rows?.[0] || {});
      const revenueCol = keys.find((k) => /\b(net\s*revenue|revenue\s*total|revenue|sales|income)\b|выруч|доход|дохід|продаж/i.test(String(k || "")));
      const expenseCol = keys.find((k) => /\b(expense|cost|spend|cogs|opex|expense\s*billed)\b|расход|витрат/i.test(String(k || "")));
      if (revenueCol && expenseCol) {
        const groupedProfit = {};
        rows.forEach((r) => {
          const key = String(r?.[groupBy] ?? "Unknown");
          const rev = toNum(r?.[revenueCol]) || 0;
          const exp = toNum(r?.[expenseCol]) || 0;
          groupedProfit[key] = (groupedProfit[key] || 0) + (rev - exp);
        });
        const entries = Object.entries(groupedProfit)
          .map(([label, value]) => ({ label, value }))
          .sort((a, b) => b.value - a.value)
          .slice(0, nLimit);
        if (entries.length) {
          const answer = (isUk ? `Топ ${entries.length} ${groupBy} за прибутком:\n` : (isRu ? `Топ ${entries.length} ${groupBy} по прибыли:\n` : `Top ${entries.length} ${groupBy} by profit:\n`))
            + entries.map((r, i) => `${i + 1}. ${r.label}: ${formatValue(Number(r.value), locale, targetColumn)}`).join("\n");
          return { answer, previewRows: entries };
        }
      }
    }
    const grouped = {};
    const counts = {};
    rows.forEach((r) => {
      const key = String(r?.[groupBy] ?? "Unknown");
      const val = toNum(r?.[targetColumn]);
      if (val === null) return;
      
      if (effectiveOp === "max") {
        if (grouped[key] === undefined || val > grouped[key]) grouped[key] = val;
      } else if (effectiveOp === "min") {
        if (grouped[key] === undefined || val < grouped[key]) grouped[key] = val;
      } else {
        grouped[key] = (grouped[key] || 0) + val;
        counts[key] = (counts[key] || 0) + 1;
      }
    });

    const sorted = Object.entries(grouped)
      .map(([label, value]) => {
        const finalValue = (effectiveOp === "avg" && counts[label]) ? value / counts[label] : value;
        return { label: enrichGroupedLabelWithName(groupBy, label, rows), value: finalValue };
      })
      .sort((a, b) => b.value - a.value);

    if (!sorted.length) return { answer: isUk ? "Відповідних даних не знайдено." : (isRu ? "Подходящие данные не найдены." : "No matching data."), previewRows: [] };

    if (effectiveOp === "max") {
      return { answer: isUk ? `Найвище значення ${targetColumn}: ${sorted[0].label} — ${formatValue(sorted[0].value, locale, targetColumn)}` : (isRu ? `Максимум по ${targetColumn}: ${sorted[0].label} — ${formatValue(sorted[0].value, locale, targetColumn)}` : `Highest ${targetColumn}: ${sorted[0].label} with ${formatValue(sorted[0].value, locale, targetColumn)}`), previewRows: sorted.slice(0, 10) };
    }
    if (effectiveOp === "min") {
      const bottom = [...sorted].sort((a, b) => a.value - b.value)[0];
      return { answer: isUk ? `Найнижче значення ${targetColumn}: ${bottom.label} — ${formatValue(bottom.value, locale, targetColumn)}` : (isRu ? `Минимум по ${targetColumn}: ${bottom.label} — ${formatValue(bottom.value, locale, targetColumn)}` : `Lowest ${targetColumn}: ${bottom.label} with ${formatValue(bottom.value, locale, targetColumn)}`), previewRows: [...sorted].sort((a, b) => a.value - b.value).slice(0, 10) };
    }

    if (nLimit === 1) {
      return { 
        answer: isUk
          ? `Топ ${groupBy} за ${targetColumn}: ${sorted[0].label} — ${formatValue(sorted[0].value, locale, targetColumn)}.`
          : (isRu
            ? `Топ ${groupBy} по ${targetColumn}: ${sorted[0].label} — ${formatValue(sorted[0].value, locale, targetColumn)}.`
            : `The top ${groupBy} by ${targetColumn} is ${sorted[0].label} with ${formatValue(sorted[0].value, locale, targetColumn)}.`),
        previewRows: sorted.slice(0, 1)
      };
    }

    return {
      answer: (isUk ? `Топ ${nLimit} ${groupBy} за ${targetColumn}:\n` : (isRu ? `Топ ${nLimit} ${groupBy} по ${targetColumn}:\n` : `Top ${nLimit} ${groupBy} by ${targetColumn}:\n`))
        + sorted.slice(0, nLimit).map((x, i) => `${i + 1}. ${x.label}: ${formatValue(x.value, locale, targetColumn)}`).join("\n"),
      previewRows: sorted.slice(0, nLimit)
    };
  }

  const nums = rows.map((r) => toNum(r?.[targetColumn])).filter((n) => n !== null);
  if (!nums.length) return { answer: isUk ? `У стовпці ${targetColumn} не знайдено числових даних.` : (isRu ? `В столбце ${targetColumn} не найдено числовых данных.` : `No numeric data found in ${targetColumn}.`), previewRows: rows.slice(0, 15) };
  
  if (effectiveOp === "sum") return { answer: isUk ? `Сума ${targetColumn}: ${formatValue(nums.reduce((a, b) => a + b, 0), locale, targetColumn)}` : (isRu ? `Сумма ${targetColumn}: ${formatValue(nums.reduce((a, b) => a + b, 0), locale, targetColumn)}` : `Total ${targetColumn}: ${formatValue(nums.reduce((a, b) => a + b, 0), locale, targetColumn)}`), previewRows: rows.slice(0, 15) };
  if (effectiveOp === "avg") return { answer: isUk ? `Середнє ${targetColumn}: ${formatValue(nums.reduce((a, b) => a + b, 0) / nums.length, locale, targetColumn)}` : (isRu ? `Среднее ${targetColumn}: ${formatValue(nums.reduce((a, b) => a + b, 0) / nums.length, locale, targetColumn)}` : `Average ${targetColumn}: ${formatValue(nums.reduce((a, b) => a + b, 0) / nums.length, locale, targetColumn)}`), previewRows: rows.slice(0, 15) };
  
  if (effectiveOp === "max") {
    let max = -Infinity;
    for (let i = 0; i < nums.length; i++) if (nums[i] > max) max = nums[i];
    return { answer: isUk ? `Максимум ${targetColumn}: ${formatValue(max, locale, targetColumn)}` : (isRu ? `Максимум ${targetColumn}: ${formatValue(max, locale, targetColumn)}` : `Max ${targetColumn}: ${formatValue(max, locale, targetColumn)}`), previewRows: rows.slice(0, 15) };
  }
  if (effectiveOp === "min") {
    let min = Infinity;
    for (let i = 0; i < nums.length; i++) if (nums[i] < min) min = nums[i];
    return { answer: isUk ? `Мінімум ${targetColumn}: ${formatValue(min, locale, targetColumn)}` : (isRu ? `Минимум ${targetColumn}: ${formatValue(min, locale, targetColumn)}` : `Min ${targetColumn}: ${formatValue(min, locale, targetColumn)}`), previewRows: rows.slice(0, 15) };
  }
  return { answer: "", previewRows: rows.slice(0, 15) };
}

const CACHE_TTL = 300000; // 5 minutes

async function loadSemanticBrain() {
    const now = Date.now();
    if (SEMANTIC_CACHE && RATIO_CACHE && (now - CACHE_TS < CACHE_TTL)) {
        return { buckets: SEMANTIC_CACHE, ratios: RATIO_CACHE };
    }

    try {
        const knowledge = await getSemanticKnowledge();
        const bucketsMap = {};
        Object.entries(knowledge).forEach(([cat, synonyms]) => {
            if (!bucketsMap[cat]) bucketsMap[cat] = { key: cat, synonyms: [] };
            bucketsMap[cat].synonyms = Array.from(new Set([...bucketsMap[cat].synonyms, ...synonyms]));
        });

        const ratioRows = await query(`SELECT name, match_pattern as match, formula_type as format, required_buckets as buckets FROM financial_ratios WHERE group_id IS NULL`, []);

        SEMANTIC_CACHE = Object.values(bucketsMap);
        RATIO_CACHE = ratioRows.map(r => ({
            ...r,
            match: new RegExp(r.match, 'i'),
            calc: (vals) => {
                if (r.name === 'Gross Margin') return ((vals[0] - vals[1]) / (vals[0] || 1)) * 100;
                if (r.name === 'Free Cash Flow') return vals[0] - vals[1];
                if (r.name === 'Burn Rate') return vals[0] / (vals[1] || 1);
                if (r.name === 'DSO') return (vals[0] / (vals[1] || 1)) * 365;
                if (r.name === 'Current Ratio') return vals[0] / (vals[1] || 1);
                if (r.name === 'Revenue per Employee') return vals[0] / (vals[1] || 1);
                return 0;
            }
        }));
        CACHE_TS = now;
        return { buckets: SEMANTIC_CACHE, ratios: RATIO_CACHE };
    } catch (e) {
        console.error("Failed to load semantic brain:", e);
        return { buckets: SEMANTIC_CACHE || [], ratios: RATIO_CACHE || [] };
    }
}

async function resolveColumn(headers, aiName, sampleRows = []) {
  if (!aiName || !headers.length) return null;
  const target = String(aiName).toLowerCase().trim();
  const normalizedTarget = target.replace(/\s+/g, " ");

  // High-priority deterministic mapping for key finance terms.
  const hasNetProfitIntent = /(^|\b)(net\s*profit|чист(ий|ая)\s+прибут(ок|ь))(\b|$)/i.test(normalizedTarget);
  if (hasNetProfitIntent) {
    const strict = headers.find((h) => /(^|\b)(net\s*profit|чист(ий|ая)\s+прибут(ок|ь))(\b|$)/i.test(String(h || "").toLowerCase()));
    if (strict) return strict;
    const loose = headers.find((h) => /profit|прибут/i.test(String(h || "").toLowerCase()));
    if (loose) return loose;
  }

  const direct = headers.find(h => String(h).toLowerCase() === target);
  if (direct) return direct;

  const { buckets } = await loadSemanticBrain();

  for (const bucket of buckets) {
    if (bucket.synonyms.some(s => target.includes(s) || s.includes(target))) {
        for (const synonym of bucket.synonyms) {
            const found = headers.find(h => String(h).toLowerCase().includes(synonym));
            if (found) return found;
        }
    }
  }

  // 3. Smart Fallback: If AI is asking for a date/number and we found no name match, check data patterns
  if (sampleRows.length > 0) {
    const isTargetDate = /date|year|period|month|рік|год|дата/i.test(target);
    const isTargetNumeric = /revenue|income|cost|expense|profit|amount|value|доход|расход|витрати/i.test(target);

    if (isTargetDate) {
      const bestDateCol = headers.find(h => {
        const sample = sampleRows.slice(0, 10).map(r => r[h]);
        return sample.filter(v => parseDateValue(v) !== null).length > sample.length / 2;
      });
      if (bestDateCol) return bestDateCol;
    }

    if (isTargetNumeric) {
      const bestNumCol = headers.find(h => {
        const sample = sampleRows.slice(0, 10).map(r => r[h]);
        return sample.filter(v => toNum(v) !== null).length > sample.length / 2;
      });
      if (bestNumCol) return bestNumCol;
    }
  }

  return headers.find(h => String(h).toLowerCase().includes(target)) || null;
}


function applyFilters(rows, filters) {
    if (!filters?.length) return rows;
    return rows.filter(row => {
        return filters.every(f => {
            if (f.operator === "in") {
                const values = Array.isArray(f.values) ? f.values.map((v) => String(v ?? "")) : [];
                if (!values.length) return true;
                return values.includes(String(row[f.column] ?? ""));
            }
            const val = toNum(row[f.column]);
            const filterVal = toNum(f.value);
            const cellStr = String(row[f.column] || "").toLowerCase();
            const searchStr = String(f.value || "").toLowerCase();
            
            switch(f.operator) {
                case 'equals': return cellStr === searchStr;
                case 'gt': return val !== null && filterVal !== null && val > filterVal;
                case 'gte': return val !== null && filterVal !== null && val >= filterVal;
                case 'lt': return val !== null && filterVal !== null && val < filterVal;
                case 'lte': return val !== null && filterVal !== null && val <= filterVal;
                default: return cellStr.includes(searchStr);
            }
        });
    });
}

function normalizeScopeColumns(input = [], availableHeaders = []) {
  if (!Array.isArray(input) || !input.length) return [];
  const byLower = new Map((availableHeaders || []).map((h) => [String(h).trim().toLowerCase(), h]));
  return input
    .map((c) => byLower.get(String(c || "").trim().toLowerCase()) || null)
    .filter(Boolean);
}

function projectRowsToHeaders(rows = [], headers = []) {
  if (!Array.isArray(rows) || !rows.length || !Array.isArray(headers) || !headers.length) return rows || [];
  const allowed = new Set(headers.map((h) => String(h)));
  return rows.map((row) => {
    const next = {};
    Object.keys(row || {}).forEach((k) => {
      if (allowed.has(String(k))) next[k] = row[k];
    });
    return next;
  });
}

function extractExplicitYears(text = "") {
  return new Set(
    String(text || "")
      .match(/\b(19\d{2}|20\d{2}|21\d{2}|2200)\b/g)
      ?.map((year) => Number(year)) || []
  );
}

function shouldIncludeTrailingPartialYear(queryText = "", year = null, now = new Date()) {
  const numericYear = Number(year);
  if (!Number.isInteger(numericYear)) return false;
  if (extractExplicitYears(queryText).has(numericYear)) return true;
  return /\b(current|this|latest|partial|ytd|year\s*to\s*date|year-to-date)\s+year\b|\bytd\b|поточн(ий|ого)\s+р(і|о)к|текущ(ий|его)\s+год|останн(ій|ього)\s+р(і|о)к|последн(ий|его)\s+год/i.test(String(queryText || ""));
}

function dropImplicitTrailingPartialYear(years = [], queryText = "", now = new Date()) {
  const sortedYears = (Array.isArray(years) ? years : [])
    .map((year) => Number(year))
    .filter((year) => Number.isInteger(year))
    .sort((a, b) => a - b);
  if (sortedYears.length < 2) return sortedYears;
  const latestYear = sortedYears[sortedYears.length - 1];
  const currentYear = now.getFullYear();
  if (latestYear >= currentYear && !shouldIncludeTrailingPartialYear(queryText, latestYear, now)) {
    return sortedYears.slice(0, -1);
  }
  return sortedYears;
}

function cleanAITechnicalNoise(text = "") {
  let out = String(text || "");
  // Remove technical sheet references only if they match exactly (e.g., Sheet1, Sheet2.00)
  out = out.replace(/\bSheet\d+(\.00)?\b/gi, "");
  // Remove empty-tab artifact phrases that can be left behind after sheet token stripping.
  out = out.replace(/\b(?:this is based on the data from|based on data from)\s*''\s*tab\.?/gi, "");
  // Remove specific technical version suffix .00 if it's isolated (not part of a currency/number)
  out = out.replace(/\s\.00\b/g, "");
  
  // Clean up spacing without collapsing newlines.
  return out
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s\./g, ".")
    .trim();
}

function normalizeChatMarkdownText(answer = "") {
  return String(answer || "")
    .replace(/\\r?\\n/g, "\n")
    .replace(/\s+\*\*([^*\n:]{1,80}):\*\*/g, "\n$1:")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/\s+•\s+/g, "\n• ");
}

function formatDenseYoYComparisonBullets(text = "") {
  const raw = String(text || "").trim();
  if (!raw || raw.includes("\n")) return null;
  const looksLikeYoY = /\b(yoy|year[-\s]?over[-\s]?year|год к году|г\/г|р\/р|рік до року|річн)/i.test(raw);
  const hasDenseComparisons = raw.includes(";") || ((raw.match(/\b\d{4}\s+vs\s+\d{4}\b/gi) || []).length >= 2);
  if (!looksLikeYoY || !hasDenseComparisons) return null;
  const formatted = raw
    .replace(/:\s+(?=\d{4}\s+(?:год|рік|year)\b)/gi, ":\n• ")
    .replace(/;\s+(?=\d{4}\s+(?:год|рік|year)\b)/gi, "\n• ")
    .replace(/\.\s+(?=(?:YoY|Year[-\s]?over[-\s]?year|Год к году|Рост|Зростання|Ріст)[^:]{0,60}:)/gi, "\n")
    .replace(/:\s+(?=\d{4}\s+vs\s+\d{4}\b)/gi, ":\n• ")
    .replace(/,\s+(?=\d{4}\s+vs\s+\d{4}\b)/gi, "\n• ")
    .replace(/\.\s+(?=(?:Данные|Дані|Data)\b)/g, "\n• ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return formatted.includes("\n• ") ? formatted : null;
}

function formatAnswerWithBullets(answer = "") {
  const text = typeof answer === "string" ? normalizeChatMarkdownText(answer).trim() : "";
  if (!text) return "";
  const denseYoYBullets = formatDenseYoYComparisonBullets(text);
  if (denseYoYBullets) return denseYoYBullets;
  // Do not auto-bullet plain numeric prose with decimals; it can split values like 34.91 into 34 + 91.
  if (!text.includes("\n") && /\d\.\d/.test(text)) return text;
  const normalizedExistingBullets = text
    .replace(/^\s*[-*]\s+/gm, "• ")
    .replace(/\n\s*[-*]\s+/g, "\n• ");
  if (normalizedExistingBullets.includes("\n• ") || normalizedExistingBullets.match(/\n\d+\.\s/)) return normalizedExistingBullets;

  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 1 && text.length > 100) {
    const sentences = text.match(/[^.!?]+[.!?]+/g);
    if (sentences && sentences.length > 1) {
      return `${sentences[0].trim()}\n${sentences.slice(1).map(s => `• ${s.trim()}`).join("\n")}`;
    }
  }
  if (lines.length < 2) return text;
  const hasListMarkers = lines.some((l) => /^([-*]\s+|\d+\.\s+)/.test(l));
  if (hasListMarkers) return normalizedExistingBullets;
  if (lines[0].endsWith(":")) return `${lines[0]}\n${lines.slice(1).map((l) => `• ${l}`).join("\n")}`;
  return lines.map((l) => `• ${l}`).join("\n");
}

function enforceCommaThousands(answer = "") {
  const text = String(answer || "");
  // Convert spaced thousands like "12 000 000" -> "12,000,000"
  // Keep decimal part if present.
  return text.replace(/\b\d{1,3}(?:\s\d{3})+(?:[.,]\d+)?\b/g, (raw) => {
    const compact = raw.replace(/\s+/g, "");
    const hasComma = compact.includes(",");
    const hasDot = compact.includes(".");
    if (hasComma && hasDot) {
      // treat commas as thousands separators and keep decimal dot
      const [intPart, decPart] = compact.split(".");
      return `${intPart.replace(/,/g, ",")}.${decPart}`;
    }
    if (hasComma || hasDot) {
      const sep = hasDot ? "." : ",";
      const idx = compact.lastIndexOf(sep);
      const intPart = compact.slice(0, idx).replace(/[.,]/g, "");
      const decPart = compact.slice(idx + 1);
      return `${Number(intPart).toLocaleString("en-US")}.${decPart}`;
    }
    return Number(compact).toLocaleString("en-US");
  });
}

function normalizeDatesAndRemoveTime(answer = "") {
  let text = String(answer || "");
  // Remove common time/timezone fragments.
  text = text
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?\b/gi, "")
    .replace(/\b(?:UTC|GMT)\s*[+-]?\d{0,2}:?\d{0,2}\b/gi, "")
    .replace(/\b(?:EST|EDT|PST|PDT|CST|CDT|MST|MDT)\b/gi, "")
    .replace(/\s{2,}/g, " ");

  // YYYY-MM-DD -> MM-DD-YYYY
  text = text.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (_, y, m, d) => `${m}-${d}-${y}`);
  // YYYY/MM/DD -> MM-DD-YYYY
  text = text.replace(/\b(\d{4})\/(\d{2})\/(\d{2})\b/g, (_, y, m, d) => `${m}-${d}-${y}`);
  // MM/DD/YYYY or DD/MM/YYYY -> MM-DD-YYYY (assume first token is month by product rule)
  text = text.replace(/\b(\d{2})\/(\d{2})\/(\d{4})\b/g, (_, m, d, y) => `${m}-${d}-${y}`);

  return text.replace(/\s{2,}/g, " ").trim();
}

function enforceTwoDecimals(answer = "") {
  const text = String(answer || "");
  // Format numeric tokens (currency/percent/decimals) to 2 decimals.
  // We use a negative lookbehind (if supported) or logic to skip list indices like "1. "
  return text.replace(/([$-]?\d[\d,]*)(\.\d+)?(%?)/g, (raw, intPart, decPart, suffix, offset, fullString) => {
    // 1. Skip if it's a list index: check if it's at start of string or preceded by newline/bullet AND followed by a dot + space
    const before = fullString.slice(Math.max(0, offset - 2), offset);
    const after = fullString.slice(offset + intPart.length, offset + intPart.length + 2);
    const isAtLineStart = offset === 0 || /[\n•]/.test(before);
    if (isAtLineStart && after === ". ") return raw;

    // 2. Skip 4-digit years (isolated)
    const compact = String(intPart).replace(/[$,]/g, "");
    if (/^\d{4}$/.test(compact) && !decPart && !suffix) return raw;

    const n = Number(compact + (decPart || ""));
    if (!Number.isFinite(n)) return raw;
    
    // Only apply if it's monetary, a percentage, or already has a decimal
    if (!String(intPart).includes("$") && !suffix && !decPart) return raw;

    const sign = n < 0 ? "-" : "";
    const abs = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const currency = String(intPart).includes("$") ? "$" : "";
    return `${sign}${currency}${abs}${suffix || ""}`;
  });
}

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

function compactSchemaProfileForPrompt(schemaProfile = {}) {
  const src = schemaProfile && typeof schemaProfile === "object" ? schemaProfile : {};
  const files = Array.isArray(src.available_files) ? src.available_files : [];
  const compactFiles = files.slice(0, 10).map((f) => ({
    id: String(f?.id || ""),
    name: String(f?.name || "").slice(0, 80),
    headers: Array.isArray(f?.headers) ? f.headers.slice(0, 40).map((h) => String(h).slice(0, 60)) : [],
    file_label: f?.file_label ? String(f.file_label).slice(0, 80) : null,
    import_version: Number.isFinite(Number(f?.import_version)) ? Number(f.import_version) : null,
  }));
  return {
    available_tabs: Array.isArray(src.available_tabs) ? src.available_tabs.slice(0, 20).map((t) => String(t).slice(0, 80)) : [],
    available_files: compactFiles,
    active_filters: Array.isArray(src.active_filters) ? src.active_filters.slice(0, 30) : [],
    split_context: src.split_context || null,
    semantic_profile: src.semantic_profile || {},
  };
}

async function callOpenAI({ message, schemaProfile, sampleRows, headers, conversationHistory, locale, dateFormatHints, maxOutputTokens = 800, runtime = null }) {
  const { provider, model, baseUrl, apiKey } = resolveChatCompletionProviderConfig(runtime);
  if (!apiKey) throw new Error("no_api_key");
  const timeoutMs = Number(runtime?.openaiTimeoutMs || OPENAI_TIMEOUT_MS);
  const temperature = Number(runtime?.openaiTemperature);
  const safeTemperature = Number.isFinite(temperature) ? Math.max(0, Math.min(2, temperature)) : 0.1;
  const runtimeMaxOutput = Number(runtime?.openaiMaxOutputTokens);
  const configuredMaxTokens = Number.isFinite(runtimeMaxOutput)
    ? Math.min(Math.max(32, runtimeMaxOutput), Math.max(32, Number(maxOutputTokens || 800)))
    : Number(maxOutputTokens || 800);
  const effectiveMaxTokens = minCompletionTokensForModel(model, configuredMaxTokens, 800, 768);
  const inputCostPer1M = Number(runtime?.openaiInputCostPer1M);
  const outputCostPer1M = Number(runtime?.openaiOutputCostPer1M);
  const promptRows = sanitizePromptRows(sampleRows);
  const promptHistory = sanitizeConversationHistory(conversationHistory);
  const promptRules = await loadChatRuntimeRules();

  const system = [
    "You are a professional financial data analyst AI.",
    "WORKSPACE AWARENESS: You have access to a workspace containing multiple spreadsheets.",
    "CROSS-FILE COMPARISON: If the user asks to compare the current file with another file in the workspace (provided in schema_profile.available_files):",
    "REVISION AWARENESS: available_files may include file_label/import_version/uploaded_at. Use these fields to choose the right revision when users reference versions or upload dates.",
    " 1. Identify the 'sheet_id' of the comparison file.",
    " 2. Populate the 'cross_targets' array in the response JSON.",
    " 3. Example cross_targets: [{\"sheet_id\": \"id_of_file_a\", \"column\": \"Revenue\", \"operation\": \"sum\"}, {\"sheet_id\": \"id_of_file_b\", \"column\": \"Budget\", \"operation\": \"sum\"}]",
    "Autonomous Self-Teaching: If a user query is vague, missing a metric, or you 'do not know' the question (e.g., 'What's the biggest?'):",
    " 1. Discovery: Scan 'available_columns' and 'sample_rows' for the most significant numeric column (the 'Primary Metric') and the most descriptive text column (the 'Primary Dimension').",
    " 2. Deduction: Assume the user is asking for the Top N or Sum of that Primary Metric grouped by that Primary Dimension.",
    " 3. Populate operation, target_column, group_by, and limit for that assumed analysis.",
    " 4. Answer with the result framing directly; do not apologize, do not ask the user to confirm a metric, and do not announce what you are about to answer.",
    " 5. Never Fail: Do not ask for clarification if a reasonable business assumption can be made from the data DNA.",
    "User Input: You may receive queries in ANY language (English, Russian, Ukrainian, Spanish, etc.).",
    "AI responsibility rule: You are responsible for intent interpretation. Infer what the user means from natural phrasing and conversational context.",
    "AI responsibility rule: You are responsible for metric disambiguation explanation text. If multiple close metrics exist, explain your selected metric briefly in output_locale.",
    "AI responsibility rule: You are responsible for final narrative response formatting (tone/shape/clarity) in output_locale.",
    "Execution boundary rule: Deterministic backend executes all numeric calculations, filters, rankings, and date math. Do not fabricate computed values.",
    String(promptRules?.promptContextCarryForwardRule || CHAT_RUNTIME_RULES_DEFAULTS.promptContextCarryForwardRule),
    "Internal Mapping: Regardless of the query language, map the user's concepts to the 'available_columns'.",
    "Semantic-first rule: Use schema_profile.semantic_profile as the primary source for metric/date/dimension mapping.",
    "Semantic-first rule: Use available_columns and sample_rows only as fallback when semantic_profile confidence is low or mapping is missing.",
    "Column matching rule: You must first map requested business meaning to the closest available column from available_columns/sample_rows.",
    "Column matching rule: If no close semantic match exists, do NOT guess and do NOT invent a pseudo-column.",
    "Column matching rule: In that case set operation='none' and answer with a clear 'cannot find a close matching column' message in output_locale.",
    "Return ONLY valid JSON.",
    "Language: Always provide 'answer' in the requested output_locale, regardless of the user's message language.",
    "Single-language rule: The answer must be entirely in output_locale. Do not start with English phrases like 'I apologize' when output_locale is not English.",
    "Internal Logic: Map user terms to available_columns for operations, but keep final explanation in output_locale.",
    "Date handling: Always output dates as MM-DD-YYYY.",
    "Date handling: Never include time values or timezone references.",
    "Quarter handling: Interpret Q1/Q2/Q3/Q4 as quarter periods.",
    "Quarter handling: Also interpret localized quarter aliases as Q1..Q4 (e.g., квартал 1/2/3/4, 1 квартал, I/II/III/IV квартал).",
    "Conversational Rule: ALWAYS include the filter context (e.g., the year, category, or period) in your final 'answer' string. Never just say 'Total Revenue: $X', say 'Total Revenue for 2023: $X'.",
    String(promptRules?.promptSingleScalarRule || CHAT_RUNTIME_RULES_DEFAULTS.promptSingleScalarRule),
    String(promptRules?.promptTotalInYearShapeRule || CHAT_RUNTIME_RULES_DEFAULTS.promptTotalInYearShapeRule),
    String(promptRules?.promptStructuredSectionsRule || CHAT_RUNTIME_RULES_DEFAULTS.promptStructuredSectionsRule),
    String(promptRules?.promptCompositeDecomposeRule || CHAT_RUNTIME_RULES_DEFAULTS.promptCompositeDecomposeRule),
    "Answer-shape rule: For equivalent multilingual phrasing of total-in-year questions, keep the same direct sentence form in output_locale.",
    "Conciseness rule: Do not add recommendations, disclaimers, or methodological notes unless the user explicitly asks for explanation.",
    "Execution rule: If year/date fields exist and the request is computable from available rows, do not claim the value cannot be calculated.",
    "Language rule for quarter wording: use the English word 'quarter' only in English output.",
    "Language rule for quarter wording: in Russian use 'квартал', in Ukrainian use 'квартал/кварталу' as grammatically appropriate.",
    "Number formatting: Use grouped numbers with thousands separators in the final answer (example: 12,345.67).",
    "Rounding rule: Always present numeric calculation results with exactly 2 decimal places.",
    "Do not describe numeric values as approximate.",
    "Do not mention tab names (e.g., 'Sheet1'), row counts, internal indices, or '.00' version suffixes in your answer.",
    "Do not shorten values into compact forms like K/M/B unless user explicitly asks.",
    "Use only numeric values that can be derived from the provided spreadsheet rows.",
    "Never invent numbers, never estimate, and never substitute generic sample values.",
    "If exact numeric evidence is unavailable, clearly say data is unavailable instead of guessing.",
    "Semantic Operations Map:",
    " - 'top_n': Use for 'drivers', 'who spent most', 'biggest segments', 'which category is highest'. Requires 'group_by'.",
    " - 'sum': Use for 'totals', 'all revenue', 'combined cost'.",
    " - 'avg': Use for 'averages', 'mean', 'per transaction'.",
    " - 'year_over_year': Use for YoY, annual growth, comparison with prior year, 'годовое исчисление', 'річне обчислення', 'г/г', 'р/р', when this is the best fit for the user's full request.",
    "Supported operations: none, filter, reset, count, sum, avg, max, min, top_n, year_over_year.",
    "IMPORTANT: Only use operation: 'filter' when user explicitly says 'Show', 'Filter', 'Find', or 'View only'.",
    "IMPORTANT: Do not force an operation from one keyword. Choose the operation that best answers the full user request using available data.",
    "Use bullet points for multiple findings or drivers.",
    "Include concrete numbers and business names in explanations.",
  ].join(" ");

  const userPrompt = {
    question: message,
    output_locale: normalizeLocale(locale || "en"),
    quarter_aliases: [
      "Q1 = first quarter",
      "Q2 = second quarter",
      "Q3 = third quarter",
      "Q4 = fourth quarter",
      "квартал 1 / 1 квартал / I квартал = Q1",
      "квартал 2 / 2 квартал / II квартал = Q2",
      "квартал 3 / 3 квартал / III квартал = Q3",
      "квартал 4 / 4 квартал / IV квартал = Q4"
    ],
    conversation_history: promptHistory,
    available_columns: headers,
    date_format_hints: dateFormatHints || [],
    schema_profile: compactSchemaProfileForPrompt(schemaProfile),
    sample_rows: promptRows,
    output_schema: {
      answer: "string",
      operation: "none|filter|reset|count|sum|avg|max|min|top_n|year_over_year",
      target_tab: "string|null",
      target_column: "string|null",
      group_by: "string|null",
      limit: "number|null",
      filters: [{ column: "string", operator: "contains|equals|gt|gte|lt|lte", value: "string|number" }],
      chart: { date_column: "string", value_column: "string", segment_by: "string|null", aggregation: "sum|avg" },
      cross_talk: "boolean",
      cross_targets: [{ sheet_id: "string", column: "string", operation: "sum|avg|count|max|min" }]
    }
  };
  const promptBudgetChars = Math.max(1000, Number(runtime?.chatMaxInputChars || 12000));
  const promptSerialized = JSON.stringify(userPrompt);
  if (runtime?.chatPromptBudgetEnabled !== false) {
    enforceAiPromptBudget({ text: promptSerialized, maxChars: promptBudgetChars, errorCode: "chat_prompt_budget_exceeded" });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  const requestUrl = `${baseUrl}/chat/completions`;
  const providerLabel = String(provider || "openai");
  const providerModel = String(model || "").trim();
  if (AI_DEBUG_LOGS) {
    console.info("[chat_ai_request] starting", {
      provider: providerLabel,
      model: providerModel,
      resolvedBaseUrl: baseUrl,
      requestUrl,
      fallbackUrl: providerLabel === "openai" && OPENAI_BASE_URL && OPENAI_BASE_URL !== baseUrl ? `${OPENAI_BASE_URL}/chat/completions` : null,
      runtimeHasOpenaiBaseUrl: !!runtime?.openaiBaseUrl,
      providerConfigHasBaseUrl: !!(runtime?.providerConfigs?.[providerLabel]?.baseUrl),
    });
  }
  const fallbackUrl = providerLabel === "openai" && OPENAI_BASE_URL && OPENAI_BASE_URL !== baseUrl
    ? `${OPENAI_BASE_URL}/chat/completions`
    : null;
  const requestUrls = [requestUrl];
  if (fallbackUrl && fallbackUrl !== requestUrl) requestUrls.push(fallbackUrl);

  let resp;
  const requestBody = buildChatCompletionRequestBody({
    provider,
    model,
    maxCompletionTokens: effectiveMaxTokens,
    responseFormat: { type: "json_object" },
    temperature: safeTemperature,
    messages: [{ role: "system", content: system }, { role: "user", content: promptSerialized }],
  });
  const requestPayload = JSON.stringify(requestBody);

  let lastError = null;
  const isAbort = (error) => {
    const reason = error?.cause?.code || error?.code || error?.name;
    return reason === "AbortError";
  };

  try {
    for (const targetUrl of requestUrls) {
      try {
        resp = await fetch(targetUrl, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: requestPayload,
          signal: controller.signal,
        });
        break;
      } catch (error) {
        lastError = error;
        const reason = error?.cause?.code || error?.code || error?.name || "network_error";
        if (isAbort(error)) {
          const timeoutErr = new Error(`openai_request_timeout:${targetUrl}`);
          timeoutErr.name = "TimeoutError";
          timeoutErr.code = "openai_timeout";
          throw timeoutErr;
        }
        console.error("OpenAI provider request failed:", {
          provider: providerLabel,
          targetUrl,
          reason,
          message: String(error?.message || ""),
        });
        if (targetUrl !== requestUrls[requestUrls.length - 1]) {
          continue;
        }
        const upstreamErr = new Error(`openai_network_error:${providerLabel}:${targetUrl}:${reason}`);
        upstreamErr.name = "ProviderNetworkError";
        upstreamErr.code = "openai_network_error";
        throw upstreamErr;
      }
    }
  } finally {
    clearTimeout(timeout);
  }
  if (!resp) {
    const fallbackErr = new Error(`openai_network_error:${providerLabel}:${fallbackUrl || requestUrl}:no_response`);
    fallbackErr.name = "ProviderNetworkError";
    fallbackErr.code = "openai_network_error";
    throw fallbackErr;
  }
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`openai_request_failed:${text.slice(0, 300)}`);
  }
  const json = await resp.json();
  const usage = json?.usage || {};
  const promptTokens = Number(usage.prompt_tokens || 0);
  const completionTokens = Number(usage.completion_tokens || 0);
  const totalTokens = Number(usage.total_tokens || (promptTokens + completionTokens) || 0);
  const content = extractOpenAiAssistantText(json);
  if (!content) {
    throw new Error(`openai_invalid_response:${getOpenAiResponseDiagnostics(json)}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`openai_invalid_json_response:${content.slice(0, 240)}`);
  }
  const validated = validateAiResponseSchemaStrict(parsed);
  const estimatedCostUsd = estimateOpenAiCostUsd(promptTokens, completionTokens, {
    inputPer1M: inputCostPer1M,
    outputPer1M: outputCostPer1M,
  });
  if (AI_DEBUG_LOGS) {
    console.info("[ai_metrics]", JSON.stringify({
      provider,
      endpoint: "chat.completions",
      model,
      latency_ms: Date.now() - startedAt,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: totalTokens,
      estimated_cost_usd: Number.isFinite(estimatedCostUsd) ? Number(estimatedCostUsd.toFixed(8)) : null,
      status: "ok",
    }));
  }
  return {
    plan: validated,
    usage: {
      promptTokens,
      completionTokens,
      totalTokens,
      estimatedCostUsd,
      provider,
      model,
    },
  };
}

async function rewriteGroundedScalarAnswer({ metric, year, valueText, userQuestion, locale = "en", runtime = null }) {
  const { provider, model, baseUrl, apiKey } = resolveChatCompletionProviderConfig(runtime);
  if (!apiKey) return `The total ${metric} for ${year} is ${valueText}.`;
  const timeoutMs = Number(runtime?.openaiTimeoutMs || OPENAI_TIMEOUT_MS);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const system = [
      "You rewrite a scalar spreadsheet answer into one short sentence.",
      "Use ONLY the provided facts. Do not change numbers. Do not say unavailable.",
      "Return plain text only.",
    ].join(" ");
    const user = JSON.stringify({
      locale: normalizeLocale(locale || "en"),
      question: String(userQuestion || ""),
      facts: {
        metric: String(metric || "value"),
        year: String(year || ""),
        value: String(valueText || ""),
      },
      target_shape: "The total <metric> for <year> is <value>.",
    });
    const body = buildChatCompletionRequestBody({
      provider,
      model,
      maxCompletionTokens: minCompletionTokensForModel(model, 120, 120, 120),
      temperature: 0,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    });
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!resp.ok) return `The total ${metric} for ${year} is ${valueText}.`;
    const json = await resp.json();
    const text = String(extractOpenAiAssistantText(json) || "").trim();
    return text || `The total ${metric} for ${year} is ${valueText}.`;
  } catch {
    return `The total ${metric} for ${year} is ${valueText}.`;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeAiPlan(raw) {
  const base = raw && typeof raw === "object" ? raw : {};
  const op = String(base.operation || "none").toLowerCase();
  const allowedOps = new Set(["none", "filter", "reset", "count", "sum", "avg", "max", "min", "top_n", "year_over_year", "chart", "plot", "trend"]);
  const allowedFilterOps = new Set(["contains", "equals", "gt", "gte", "lt", "lte", "year_equals"]);
  const safeFilters = Array.isArray(base.filters)
    ? base.filters
      .filter((f) => f && typeof f === "object")
      .map((f) => {
        const operator = String(f.operator || "contains").toLowerCase();
        return {
          column: f.column == null ? "" : String(f.column),
          operator: allowedFilterOps.has(operator) ? operator : "contains",
          value: typeof f.value === "number" || typeof f.value === "string" ? f.value : String(f.value ?? ""),
        };
      })
      .filter((f) => f.column.trim())
    : [];
  const safeChart = (base.chart && typeof base.chart === "object")
    ? {
      date_column: base.chart.date_column == null ? null : String(base.chart.date_column),
      value_column: base.chart.value_column == null ? null : String(base.chart.value_column),
      segment_by: base.chart.segment_by == null ? null : String(base.chart.segment_by),
      aggregation: String(base.chart.aggregation || "sum").toLowerCase() === "avg" ? "avg" : "sum",
    }
    : null;
  const safeCrossTargets = Array.isArray(base.cross_targets)
    ? base.cross_targets
      .filter((t) => t && typeof t === "object")
      .map((t) => ({
        sheet_id: t.sheet_id == null ? "" : String(t.sheet_id),
        column: t.column == null ? "" : String(t.column),
        operation: ["sum", "avg", "count", "max", "min"].includes(String(t.operation || "").toLowerCase())
          ? String(t.operation).toLowerCase()
          : "sum",
      }))
      .filter((t) => t.sheet_id.trim() && t.column.trim())
    : [];
  return {
    answer: typeof base.answer === "string" ? base.answer : "",
    operation: allowedOps.has(op) ? op : "none",
    metric_intent: base.metric_intent == null ? null : String(base.metric_intent).toLowerCase(),
    time_scope: base.time_scope == null ? null : String(base.time_scope).toLowerCase(),
    entity_scope: base.entity_scope == null ? null : String(base.entity_scope).toLowerCase(),
    target_tab: base.target_tab == null ? null : String(base.target_tab),
    target_column: base.target_column == null ? null : String(base.target_column),
    group_by: base.group_by == null ? null : String(base.group_by),
    limit: Number.isFinite(Number(base.limit)) ? Number(base.limit) : null,
    filters: safeFilters,
    chart: safeChart,
    cross_talk: !!base.cross_talk,
    cross_targets: safeCrossTargets,
  };
}

function validateAiResponseSchemaStrict(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("openai_invalid_schema");
  }
  const allowedTopLevel = new Set([
    "answer", "operation", "target_tab", "target_column", "group_by", "limit",
    "filters", "chart", "cross_talk", "cross_targets", "metric_intent", "time_scope", "entity_scope"
  ]);
  const keys = Object.keys(raw);
  if (!keys.length) {
    throw new Error("openai_invalid_schema_empty");
  }
  for (const key of keys) {
    if (!allowedTopLevel.has(key)) {
      throw new Error(`openai_invalid_schema_key:${key}`);
    }
  }
  return normalizeAiPlan(raw);
}

function repairAiPlanForExecution(plan = {}, headers = []) {
  const p = { ...(plan || {}) };
  const op = String(p.operation || "none").toLowerCase();
  const headerSet = new Set((Array.isArray(headers) ? headers : []).map((h) => String(h)));
  const hasTarget = p.target_column && headerSet.has(String(p.target_column));
  const hasGroup = p.group_by && headerSet.has(String(p.group_by));

  if (["sum", "avg", "max", "min", "year_over_year"].includes(op) && !hasTarget) {
    p.operation = "none";
  }
  if (op === "top_n") {
    if (!hasTarget || !hasGroup) p.operation = "none";
    if (!Number.isFinite(Number(p.limit))) p.limit = 5;
  }
  return p;
}

function deriveMetricIntentFromQuestion(message = "") {
  const msg = String(message || "").toLowerCase();
  if (/\b(revenue|sales|income|turnover|выручк|доход|дохід|продаж)\b/i.test(msg)) return "revenue";
  if (/\b(expense|cost|spend|cogs|opex|расход|витрат)\b/i.test(msg)) return "expense";
  if (/\b(profit|margin|ebit|ebitda|прибут|прибыл)\b/i.test(msg)) return "profit";
  return "auto";
}

function detectForecastIntent(message = "") {
  const msg = String(message || "").toLowerCase();
  return /\b(forecast|prediction|predict|project|outlook|next year|2026|2027|2028)\b|прогноз|предсказ|очікуван|прогноз/i.test(msg);
}

function extractMetricHintFromText(text = "") {
  const s = String(text || "");
  const patterns = [
    /profit total|net profit|profit/i,
    /revenue total|net revenue|gross revenue|revenue|sales|income/i,
    /expense billed|expense|cost|opex|cogs/i,
  ];
  for (const p of patterns) {
    const m = s.match(p);
    if (m) return m[0];
  }
  return null;
}

function extractMetricFromAssistantAnswer(text = "") {
  const s = String(text || "");
  const direct =
    s.match(/\b(?:Total|Сумма|Загальна сума)\s+([^:\n]+):/i)
    || s.match(/\bThe total\s+([^.\n]+?)\s+(?:for|in)\s+\d{4}\b/i);
  if (!direct) return null;
  return String(direct[1] || "").trim();
}

function isShortReasonFollowup(message = "", rules = CHAT_RUNTIME_RULES_DEFAULTS) {
  try {
    return new RegExp(String(rules?.shortReasonFollowupRegex || CHAT_RUNTIME_RULES_DEFAULTS.shortReasonFollowupRegex), "i")
      .test(String(message || "").trim());
  } catch {
    return new RegExp(CHAT_RUNTIME_RULES_DEFAULTS.shortReasonFollowupRegex, "i").test(String(message || "").trim());
  }
}

function isShortYearFollowup(message = "", rules = CHAT_RUNTIME_RULES_DEFAULTS) {
  const s = String(message || "").trim().toLowerCase();
  let yearRegex = /\b(19|20)\d{2}\b/;
  try {
    yearRegex = new RegExp(String(rules?.shortYearFollowupRegex || CHAT_RUNTIME_RULES_DEFAULTS.shortYearFollowupRegex), "i");
  } catch {}
  const maxChars = Number.isFinite(Number(rules?.shortYearFollowupMaxChars))
    ? Number(rules.shortYearFollowupMaxChars)
    : CHAT_RUNTIME_RULES_DEFAULTS.shortYearFollowupMaxChars;
  return yearRegex.test(s) && s.length <= maxChars;
}

function isOnlyYearFollowup(message = "") {
  const s = String(message || "").trim().toLowerCase();
  return /^(only|just|лише|только)\s+(19\d{2}|20\d{2})\??$/.test(s);
}

function isYearOnlyFollowup(message = "") {
  const s = String(message || "").trim().toLowerCase();
  return /^(?:(?:in|for|за|у|в)\s+)?(19\d{2}|20\d{2})\??$/.test(s)
    || /^(?:in|for)\s+(19\d{2}|20\d{2})\??$/.test(s);
}

function isWhatAboutYearFollowup(message = "") {
  const s = String(message || "").trim().toLowerCase();
  return /^(what about|how about|а как насчет|а як щодо)\s+(19\d{2}|20\d{2})\??$/.test(s);
}

function isAndYearFollowup(message = "") {
  const s = String(message || "").trim().toLowerCase();
  return /^(and|и|та|і)\s+(19\d{2}|20\d{2})\??$/.test(s);
}

function normalizeRelativeYearInMessage(message = "", now = new Date()) {
  const src = String(message || "");
  const currentYear = now.getFullYear();
  return src.replace(/\b(\d{1,2})\s+years?\s+ago\b/gi, (_, nRaw) => {
    const n = Number(nRaw);
    if (!Number.isFinite(n) || n < 1 || n > 20) return _;
    return String(currentYear - n);
  });
}

function asksExplicitComparisonIntent(message = "", rules = CHAT_RUNTIME_RULES_DEFAULTS) {
  const s = String(message || "").toLowerCase();
  try {
    return new RegExp(String(rules?.comparisonIntentRegex || CHAT_RUNTIME_RULES_DEFAULTS.comparisonIntentRegex), "i").test(s);
  } catch {
    return new RegExp(CHAT_RUNTIME_RULES_DEFAULTS.comparisonIntentRegex, "i").test(s);
  }
}

function asksDifferenceBetweenYears(message = "") {
  const s = String(message || "").toLowerCase();
  return /\b(difference|diff|delta|compare|comparison|vs|versus|between)\b.*\b(19\d{2}|20\d{2})\b.*\b(19\d{2}|20\d{2})\b/i.test(s)
    || /\b(19\d{2}|20\d{2})\b.*\b(and|vs|versus)\b.*\b(19\d{2}|20\d{2})\b/i.test(s);
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
  const explicitComparison = asksExplicitComparisonIntent(s, rules) || asksDifferenceBetweenYears(s);
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

async function enforceHeaderBoundAiPlan(aiPlan, headers = [], sampleRows = []) {
  const hdrs = Array.isArray(headers) ? headers : [];
  if (!hdrs.length) return aiPlan;
  const next = { ...(aiPlan || {}) };
  const resolvedTarget = await resolveColumn(hdrs, next.target_column, sampleRows);
  const resolvedGroup = await resolveColumn(hdrs, next.group_by, sampleRows);
  const resolvedFilters = await Promise.all((Array.isArray(next.filters) ? next.filters : []).map(async (f) => {
    const col = await resolveColumn(hdrs, f?.column, sampleRows);
    if (!col) return null;
    return { ...f, column: col };
  }));
  next.target_column = resolvedTarget || null;
  next.group_by = resolvedGroup || null;
  next.filters = resolvedFilters.filter(Boolean);
  return next;
}

function sanitizePromptRows(rows = [], maxRows = 80, maxFieldChars = 120) {
  return (Array.isArray(rows) ? rows : []).slice(0, maxRows).map((row) => {
    if (!row || typeof row !== "object") return {};
    const next = {};
    Object.entries(row).forEach(([k, v]) => {
      if (v == null) {
        next[k] = v;
        return;
      }
      if (typeof v === "number" || typeof v === "boolean") {
        next[k] = v;
        return;
      }
      const s = String(v);
      next[k] = s.length > maxFieldChars ? `${s.slice(0, maxFieldChars)}...` : s;
    });
    return next;
  });
}

function sanitizeConversationHistory(history = [], maxItems = 8, maxChars = 600) {
  return (Array.isArray(history) ? history : [])
    .slice(-maxItems)
    .map((m) => {
      if (!m || typeof m !== "object") return null;
      const role = String(m.role || "").toLowerCase();
      const safeRole = role === "assistant" ? "assistant" : "user";
      const content = String(m.content || "");
      return { role: safeRole, content: content.length > maxChars ? `${content.slice(0, maxChars)}...` : content };
    })
    .filter(Boolean);
}

function normalizeToken(value = "") {
  return String(value || "").toLowerCase().replace(/[^a-z0-9а-яёіїєґ]+/gi, " ").trim();
}

function resolveTabName(tabNames = [], requestedTab = null) {
  if (!requestedTab || !tabNames.length) return null;
  const raw = String(requestedTab).trim();
  if (!raw) return null;
  const exact = tabNames.find((t) => String(t).toLowerCase() === raw.toLowerCase());
  if (exact) return exact;
  const normalized = normalizeToken(raw);
  if (!normalized) return null;
  const loose = tabNames.find((t) => normalizeToken(t).includes(normalized) || normalized.includes(normalizeToken(t)));
  return loose || null;
}

function inferTabFromMessage(tabNames = [], message = "") {
  if (!tabNames.length || !message) return null;
  const m = normalizeToken(message);
  if (!m) return null;
  let best = null;
  let bestLen = 0;
  for (const tab of tabNames) {
    const n = normalizeToken(tab);
    if (!n) continue;
    if ((m.includes(n) || n.includes(m)) && n.length > bestLen) {
      best = tab;
      bestLen = n.length;
    }
  }
  return best;
}

function findProductLikeColumn(headers = []) {
  const list = Array.isArray(headers) ? headers : [];
  const strong = list.find((h) => /\b(product|item|sku)\b/i.test(String(h || "")));
  if (strong) return strong;
  return list.find((h) => /product|item|sku|товар|продукт/i.test(String(h || ""))) || null;
}

function buildTabDatasets(rows = [], fallbackHeaders = [], tabNames = []) {
  const byTab = new Map();
  rows.forEach((row) => {
    const tab = String(row?.__tab_name || "").trim() || tabNames[0] || "Sheet1";
    if (!byTab.has(tab)) byTab.set(tab, []);
    const out = { ...(row || {}) };
    delete out.__tab_name;
    byTab.get(tab).push(out);
  });
  tabNames.forEach((tab) => {
    if (!byTab.has(tab)) byTab.set(tab, []);
  });
  if (!byTab.size) byTab.set(tabNames[0] || "Sheet1", []);

  const datasets = {};
  for (const [tab, tabRows] of byTab.entries()) {
    let headers = [];
    const row0 = tabRows[0];
    if (row0 && typeof row0 === "object") headers = Object.keys(row0);
    if (!headers.length) headers = Array.isArray(fallbackHeaders) ? [...fallbackHeaders] : [];
    datasets[tab] = { headers, rows: tabRows };
  }
  return datasets;
}

function normalizeSlavicGroupedNumbers(text = "") {
  // Convert en-US grouped numbers into slavic-friendly spoken format:
  // 12,000,000.50 -> 12 000 000,50
  return String(text || "").replace(/\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b/g, (m) => {
    const [intPart, decPart] = m.split(".");
    const grouped = intPart.replace(/,/g, " ");
    return decPart ? `${grouped},${decPart}` : grouped;
  });
}

function expandLargeIntForEnglishSpeech(rawDigits = "") {
  const digits = String(rawDigits || "").replace(/[^\d]/g, "").replace(/^0+/, "") || "0";
  const n = BigInt(digits);
  if (n >= 1_000_000_000_000n) {
    const t = n / 1_000_000_000_000n;
    const b = (n % 1_000_000_000_000n) / 1_000_000_000n;
    const m = (n % 1_000_000_000n) / 1_000_000n;
    const k = (n % 1_000_000n) / 1_000n;
    const r = n % 1_000n;
    return [t ? `${t} trillion` : "", b ? `${b} billion` : "", m ? `${m} million` : "", k ? `${k} thousand` : "", r ? `${r}` : ""].filter(Boolean).join(" ");
  }
  if (n >= 1_000_000_000n) {
    const b = n / 1_000_000_000n;
    const m = (n % 1_000_000_000n) / 1_000_000n;
    const k = (n % 1_000_000n) / 1_000n;
    const r = n % 1_000n;
    return [b ? `${b} billion` : "", m ? `${m} million` : "", k ? `${k} thousand` : "", r ? `${r}` : ""].filter(Boolean).join(" ");
  }
  if (n >= 1_000_000n) {
    const m = n / 1_000_000n;
    const k = (n % 1_000_000n) / 1_000n;
    const r = n % 1_000n;
    return [m ? `${m} million` : "", k ? `${k} thousand` : "", r ? `${r}` : ""].filter(Boolean).join(" ");
  }
  if (n >= 1_000n) {
    const k = n / 1_000n;
    const r = n % 1_000n;
    return [k ? `${k} thousand` : "", r ? `${r}` : ""].filter(Boolean).join(" ");
  }
  return String(n);
}

function naturalizeNumbersForTTS(text = "", locale = "en") {
  let out = String(text || "");
  const lang = (locale || "en").split("-")[0].toLowerCase();
  const normalizePercentToken = (raw) => {
    const textNum = String(raw || "").trim().replace(",", ".");
    if (!textNum) return "0";
    if (textNum.startsWith(".")) return `0${textNum}`;
    if (textNum.startsWith("-.")) return textNum.replace("-.", "-0.");
    if (textNum.startsWith("+.")) return textNum.replace("+.", "+0.");
    return textNum;
  };
  const roundCurrencyToWhole = (priceRaw, centsRaw) => {
    const units = parseInt(String(priceRaw || "").replace(/,/g, ""), 10) || 0;
    const cents = parseInt(String(centsRaw || "").padEnd(2, "0").slice(0, 2), 10) || 0;
    return cents >= 50 ? units + 1 : units;
  };
  const spokenSign = (rawNum, ukPlus = "плюс", ukMinus = "мінус", ruMinus = "минус") => {
    const s = String(rawNum || "").trim();
    if (s.startsWith("+")) return ukPlus;
    if (s.startsWith("-")) return lang === "ru" ? ruMinus : ukMinus;
    return "";
  };
  const signWordForLang = (rawNum) => {
    const s = String(rawNum || "").trim();
    if (lang === "uk") return s.startsWith("+") ? "плюс" : (s.startsWith("-") ? "мінус" : "");
    if (lang === "ru") return s.startsWith("+") ? "плюс" : (s.startsWith("-") ? "минус" : "");
    return s.startsWith("+") ? "plus" : (s.startsWith("-") ? "minus" : "");
  };

  // 1. Strip technical noise and formatting
  out = out.replace(/[•*]/g, ""); // bullets
  out = out.replace(/(\n|^)\s*[-–—]\s+/g, "$1 "); // leading dashes
  out = out.replace(/\.00(?!\d)/g, ""); // trailing .00 decimals
  out = out.replace(/\bUSD\b/gi, lang === "ru" ? "долларов" : (lang === "uk" ? "доларів" : "dollars"));

  if (lang === "uk") {
    // Force explicit sign speech before numeric tokens.
    out = out.replace(/\(\s*\+/g, "(плюс ");
    out = out.replace(/\(\s*-/g, "(мінус ");
    out = out.replace(/(^|[\s(])\+(\$?\d)/g, "$1плюс $2");
    out = out.replace(/(^|[\s(])-(\$?\d)/g, "$1мінус $2");
    // Keep percentage decimals explicit for speech (including sub-1% values).
    out = out.replace(/([+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+))%/g, (m, numRaw) => {
      const signWord = spokenSign(numRaw, "плюс", "мінус");
      const value = normalizePercentToken(String(numRaw).replace(/^[+-]/, ""));
      return `${signWord ? `${signWord} ` : ""}${value} відсотка`;
    });
    // Normalize currency without cents for cleaner speech output.
    out = out.replace(/\$([\d,]+)\.(\d{1,2})\b/g, (m, price, centsRaw) => {
      const rounded = roundCurrencyToWhole(price, centsRaw);
      return `${rounded} доларів`;
    });
    // Drop decimal tails in spoken output for non-percent numbers.
    out = out.replace(/(\d[\d,\s]*)[.,]\d{1,2}\b(?!\s*відсот)/g, "$1");
    out = out.replace(/\bvs\b/gi, "проти");
    out = out.replace(/\bNet Income\b/gi, "Прибуток");
    out = out.replace(/\bNet Revenue\b/gi, "Чистий виторг");
    out = out.replace(/\bRevenue\b/gi, "Виторг");
    out = out.replace(/\btab\b/gi, "вкладка");
    out = out.replace(/\$([\d,.\s]+)\b/g, "$1 доларів");
  } else if (lang === "ru") {
    // Force explicit sign speech before numeric tokens.
    out = out.replace(/\(\s*\+/g, "(плюс ");
    out = out.replace(/\(\s*-/g, "(минус ");
    out = out.replace(/(^|[\s(])\+(\$?\d)/g, "$1плюс $2");
    out = out.replace(/(^|[\s(])-(\$?\d)/g, "$1минус $2");
    // Keep percentage decimals explicit for speech (including sub-1% values).
    out = out.replace(/([+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+))%/g, (m, numRaw) => {
      const signWord = spokenSign(numRaw, "плюс", "мінус", "минус");
      const value = normalizePercentToken(String(numRaw).replace(/^[+-]/, ""));
      return `${signWord ? `${signWord} ` : ""}${value} процента`;
    });
    // Normalize currency without cents for cleaner speech output.
    out = out.replace(/\$([\d,]+)\.(\d{1,2})\b/g, (m, price, centsRaw) => {
      const rounded = roundCurrencyToWhole(price, centsRaw);
      return `${rounded} долларов`;
    });
    // Drop decimal tails in spoken output for non-percent numbers.
    out = out.replace(/(\d[\d,\s]*)[.,]\d{1,2}\b(?!\s*процент)/g, "$1");
    out = out.replace(/\bvs\b/gi, "против");
    out = out.replace(/\bNet Income\b/gi, "Чистая прибыль");
    out = out.replace(/\bNet Revenue\b/gi, "Чистая выручка");
    out = out.replace(/\bRevenue\b/gi, "Выручка");
    out = out.replace(/\btab\b/gi, "вкладка");
    out = out.replace(/\$([\d,.\s]+)\b/g, "$1 долларов");
  } else {
    // English defaults
    out = out.replace(/\bvs\b/gi, "versus");
    // Handle currency with cents: $1,234.56 or $1234.56
    out = out.replace(/\$([\d,]+)\.(\d{2})\b/g, (m, price, cents) => {
        const rounded = roundCurrencyToWhole(price, cents);
        const spoken = expandLargeIntForEnglishSpeech(String(rounded));
        return `${spoken} dollars`;
    });
    // Handle currency without cents: $1,234
    out = out.replace(/\$([\d,.]+)\b/g, (m, price) => {
        const p = String(price || "").replace(/[^\d]/g, "");
        const spoken = expandLargeIntForEnglishSpeech(p);
        return `${spoken} dollars`;
    });
    // Handle large plain numbers that may be read digit-by-digit by TTS.
    out = out.replace(/\b\d{5,}\b/g, (m) => expandLargeIntForEnglishSpeech(m));
    // Final expansion for large numbers to help TTS (e.g. 52,026,091 -> 52 million 26 thousand 91)
    // We parse as int to strip leading zeros like "026" -> "26"
    out = out.replace(/\b(\d{1,3}),(\d{3}),(\d{3})\b/g, (m, mill, thou, rest) => {
        return `${mill} million ${parseInt(thou, 10)} thousand ${parseInt(rest, 10)}`;
    });
    out = out.replace(/\b(\d{1,3}),(\d{3})\b/g, (m, thou, rest) => {
        return `${parseInt(thou, 10)} thousand ${parseInt(rest, 10)}`;
    });
    
    out = out.replace(/([+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+))%/g, (m, numRaw) => {
      const signWord = signWordForLang(numRaw);
      const value = normalizePercentToken(String(numRaw).replace(/^[+-]/, ""));
      return `${signWord ? `${signWord} ` : ""}${value} percent`;
    });
    // Force spoken sign for standalone signed values often used in deltas.
    out = out.replace(/(^|[\s(])([+-])\s*(\d+(?:[.,]\d+)?)(?!\s*percent\b)/gi, (m, pre, sign, value) => {
      const word = sign === "+" ? "plus" : "minus";
      return `${pre}${word} ${value}`;
    });
    out = out.replace(/\(\+/g, "(plus ");
    out = out.replace(/\(\-/g, "(minus ");
  }

  return out;
}

function getSlavicPlural(n, forms) {
  const num = Math.abs(Number(n) || 0);
  const mod10 = num % 10;
  const mod100 = num % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

function slavicNumberToWords(n, lang = "ru", gender = "m") {
  const num = Math.floor(Math.abs(Number(n) || 0));
  const dict = lang === "uk"
    ? {
      zero: "нуль",
      onesM: ["", "один", "два", "три", "чотири", "п'ять", "шість", "сім", "вісім", "дев'ять"],
      onesF: ["", "одна", "дві", "три", "чотири", "п'ять", "шість", "сім", "вісім", "дев'ять"],
      teens: ["десять", "одинадцять", "дванадцять", "тринадцять", "чотирнадцять", "п'ятнадцять", "шістнадцять", "сімнадцять", "вісімнадцять", "дев'ятнадцять"],
      tens: ["", "", "двадцять", "тридцять", "сорок", "п'ятдесят", "шістдесят", "сімдесят", "вісімдесят", "дев'яносто"],
      hundreds: ["", "сто", "двісті", "триста", "чотириста", "п'ятсот", "шістсот", "сімсот", "вісімсот", "дев'ятсот"],
      thousandForms: ["тисяча", "тисячі", "тисяч"],
      millionForms: ["мільйон", "мільйони", "мільйонів"],
      billionForms: ["мільярд", "мільярди", "мільярдів"],
      trillionForms: ["трильйон", "трильйони", "трильйонів"]
    }
    : {
      zero: "ноль",
      onesM: ["", "один", "два", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"],
      onesF: ["", "одна", "две", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"],
      teens: ["десять", "одиннадцать", "двенадцать", "тринадцать", "четырнадцать", "пятнадцать", "шестнадцать", "семнадцать", "восемнадцать", "девятнадцать"],
      tens: ["", "", "двадцать", "тридцать", "сорок", "пятьдесят", "шестьдесят", "семьдесят", "восемьдесят", "девяносто"],
      hundreds: ["", "сто", "двести", "триста", "четыреста", "пятьсот", "шестьсот", "семьсот", "восемьсот", "девятьсот"],
      thousandForms: ["тысяча", "тысячи", "тысяч"],
      millionForms: ["миллион", "миллиона", "миллионов"],
      billionForms: ["миллиард", "миллиарда", "миллиардов"],
      trillionForms: ["триллион", "триллиона", "триллионов"]
    };

  const tripleToWords = (value, tripleGender = "m") => {
    if (!value) return "";
    const h = Math.floor(value / 100);
    const t = Math.floor((value % 100) / 10);
    const u = value % 10;
    const parts = [];
    if (h) parts.push(dict.hundreds[h]);
    if (t === 1) {
      parts.push(dict.teens[u]);
    } else {
      if (t > 1) parts.push(dict.tens[t]);
      if (u) parts.push((tripleGender === "f" ? dict.onesF : dict.onesM)[u]);
    }
    return parts.join(" ");
  };

  if (num === 0) return dict.zero;

  const trillions = Math.floor(num / 1_000_000_000_000);
  const billions = Math.floor((num % 1_000_000_000_000) / 1_000_000_000);
  const millions = Math.floor((num % 1_000_000_000) / 1_000_000);
  const thousands = Math.floor((num % 1_000_000) / 1_000);
  const rest = num % 1_000;
  const parts = [];

  if (trillions) {
    parts.push(tripleToWords(trillions, "m"));
    parts.push(getSlavicPlural(trillions, dict.trillionForms));
  }
  if (billions) {
    parts.push(tripleToWords(billions, "m"));
    parts.push(getSlavicPlural(billions, dict.billionForms));
  }
  if (millions) {
    parts.push(tripleToWords(millions, "m"));
    parts.push(getSlavicPlural(millions, dict.millionForms));
  }
  if (thousands) {
    parts.push(tripleToWords(thousands, "f"));
    parts.push(getSlavicPlural(thousands, dict.thousandForms));
  }
  if (rest) {
    parts.push(tripleToWords(rest, gender));
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function expandFinancialTextPhonetically(text = "", lang = "ru") {
    let out = String(text || "");
    const rules = lang === "ru" ? {
        dollars: ["доллар", "доллара", "долларов"],
        cents: ["цент", "цента", "центов"],
        percents: ["процент", "процента", "процентов"]
    } : {
        dollars: ["долар", "долари", "доларів"],
        cents: ["цент", "центи", "центів"],
        percents: ["відсоток", "відсотки", "відсотків"]
    };

    // 1. Consolidate numbers first: "52 026 091" -> "52026091"
    out = out.replace(/\b(\d{1,3})[\s,](\d{3})[\s,](\d{3})\b/g, "$1$2$3");
    out = out.replace(/\b(\d{1,3})[\s,](\d{3})\b/g, "$1$2");

    // 2. Handle Currency Units
    out = out.replace(/(\d+)\s?(доларів|долларов)/g, (m, num) => {
        const n = parseInt(num, 10);
        return slavicNumberToWords(n, lang, "m") + " " + getSlavicPlural(n, rules.dollars);
    });
    out = out.replace(/(\d+)\s?(центів|центов)/g, (m, num) => {
        const n = parseInt(num, 10);
        return slavicNumberToWords(n, lang, "m") + " " + getSlavicPlural(n, rules.cents);
    });

    // 3. Handle Percentages (including decimal percentages like 0.19)
    out = out.replace(/([+-]?\d+[.,]\d+)\s?(відсотка|процента)/g, (m, raw, unit) => {
        const hasPlus = String(raw || "").trim().startsWith("+");
        const hasMinus = String(raw || "").trim().startsWith("-");
        const signWord = hasPlus ? "плюс" : (hasMinus ? (lang === "ru" ? "минус" : "мінус") : "");
        const normalized = String(raw || "").replace(",", ".");
        const [intPartRaw, fracPartRaw = ""] = normalized.split(".");
        const intPart = Number.parseInt(String(intPartRaw || "0").replace(/^[+-]/, ""), 10) || 0;
        const fracPart = (fracPartRaw || "").replace(/[^\d]/g, "").slice(0, 4);
        if (!fracPart) {
            const whole = slavicNumberToWords(intPart, lang, "m");
            return `${signWord ? `${signWord} ` : ""}${whole} ${unit}`;
        }
        const fracAsInt = Number.parseInt(fracPart, 10) || 0;
        const fracWords = slavicNumberToWords(fracAsInt, lang, "m");
        const wholeWords = slavicNumberToWords(intPart, lang, "m");
        return `${signWord ? `${signWord} ` : ""}${wholeWords} ${lang === "ru" ? "целых" : "цілих"} ${fracWords} ${lang === "ru" ? "сотых" : "сотих"} ${unit}`;
    });

    // 4. Handle integer Percentages
    out = out.replace(/(\d+)\s?(відсотків|процентов)/g, (m, num) => {
        const n = parseInt(num, 10);
        return slavicNumberToWords(n, lang, "m") + " " + getSlavicPlural(n, rules.percents);
    });

    // 5. Handle all other standalone numbers (except years)
    out = out.replace(/\b(\d{1,3}|\d{5,})\b/g, (m, num) => {
        const n = parseInt(num, 10);
        return slavicNumberToWords(n, lang, "m");
    });

    return out;
}

export async function getChatAudio(req, res) {
  const { text, locale, sheetId = null } = req.body;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !text) return res.status(400).json(aiError("missing_params"));
  if (String(text).length > CHAT_AUDIO_MAX_CHARS) {
    return res.status(413).json(aiError("text_too_large"));
  }
  let runtime = null;
  let globalRuntime = null;
  let aiReservation = null;
  if (sheetId) {
    const hasAccess = await checkSheetAccess(sheetId, req.user);
    if (!hasAccess) return res.status(403).json(aiError("Forbidden"));
    const isPlatformAdmin = isPlatformAdminUser(req.user);
    const resolvedGroupId = isPlatformAdmin ? null : await resolveAiGroupIdForSheet({ sheetId, user: req.user });
    const fallbackUserGroupId = await resolveRuntimeGroupIdForUser(req.user);
    const runtimeGroupId = isPlatformAdmin ? null : (resolvedGroupId || fallbackUserGroupId || null);
    const effective = await loadEffectiveAiRuntimeSettings(runtimeGroupId || null);
    runtime = effective.runtime;
    globalRuntime = effective.globalRuntime;
    const effectiveGlobalDisabled = isAiGloballyDisabled(globalRuntime) || isAiGloballyDisabled(runtime);
    const effectiveChatAudioEnabled = runtime?.chatAudioEnabled === true || globalRuntime?.chatAudioEnabled === true;
    if (effectiveGlobalDisabled) return res.status(403).json(aiError("global_ai_disabled"));
    if (!effectiveChatAudioEnabled) return res.status(403).json(aiError("chat_audio_disabled"));
    try {
      aiReservation = await reserveAiQueryForSheet({ sheetId, user: req.user, kind: "chat_audio" });
    } catch (err) {
      return res.status(err.statusCode || 429).json(aiError(err.message, err.details || {}));
    }
  }
  if (!runtime) runtime = await loadAiRuntimeSettings(null);
  if (!globalRuntime) globalRuntime = await loadAiRuntimeSettings(null);
  const effectiveGlobalDisabled = isAiGloballyDisabled(globalRuntime) || isAiGloballyDisabled(runtime);
  const effectiveChatAudioEnabled = runtime?.chatAudioEnabled === true || globalRuntime?.chatAudioEnabled === true;
  if (effectiveGlobalDisabled) return res.status(403).json(aiError("global_ai_disabled"));
  if (!effectiveChatAudioEnabled) return res.status(403).json(aiError("chat_audio_disabled"));

  try {
    const streamResult = await synthesizeChatAudioToResponse({ text, locale, runtime, res });
    if (streamResult !== true) {
      return res.status(502).json(aiError("tts_empty_response"));
    }
    return;
  } catch (e) {
    const errorCode = e?.code || "internal_server_error";
    const status = errorCode === "global_ai_disabled" ? 403 : errorCode === "text_too_large" ? 413 : errorCode === "tts_timeout" ? 504 : errorCode === "tts_upstream_error" ? 502 : 500;
    const payload = aiError(errorCode);
    if (e?.message && errorCode === "tts_upstream_error") {
      payload.message = String(e.message).slice(0, 300);
    }
    return res.status(status).json(payload);
  }
}

export async function submitChatLearningFeedback(req, res) {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const question = String(body.question || "").trim();
    const badAnswer = String(body.badAnswer || "").trim();
    const expectedAnswer = String(body.expectedAnswer || "").trim();
    const sheetId = body.sheetId ? String(body.sheetId).trim() : null;
    const locale = String(body.locale || "en").trim().toLowerCase().slice(0, 10);
    const context = body.context && typeof body.context === "object" ? body.context : {};
    const successfulPlan = body.plan && typeof body.plan === "object" ? body.plan : null;

    if (!question || !expectedAnswer) return res.status(400).json(aiError("missing_feedback_fields"));
    if (sheetId) {
      const hasAccess = await checkSheetAccess(sheetId, req.user);
      if (!hasAccess) return res.status(403).json(aiError("Forbidden"));
    }
    const rows = await query(
      `INSERT INTO ai_learning_feedback
         (sheet_id, user_id, locale, question, bad_answer, expected_answer, context, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 'pending')
       RETURNING id, status, created_at`,
      [sheetId, Number(req.user?.id || 0) || null, locale, question, badAnswer, expectedAnswer, JSON.stringify({ ...context, successfulPlan })]
    );
    return res.json({ success: true, feedbackId: rows?.[0]?.id, status: rows?.[0]?.status, createdAt: rows?.[0]?.created_at });
  } catch (err) {
    return res.status(500).json(aiError("feedback_store_failed", { message: String(err?.message || "internal_server_error") }));
  }
}


async function synthesizeChatAudioToResponse({ text, locale, runtime = null, res }) {
  let speechText = text;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !speechText) {
    const err = new Error("missing_params");
    err.code = "missing_params";
    throw err;
  }
  if (isAiGloballyDisabled(runtime)) {
    const err = new Error("global_ai_disabled");
    err.code = "global_ai_disabled";
    throw err;
  }
  const maxChars = Number(runtime?.chatAudioMaxChars || CHAT_AUDIO_MAX_CHARS);
  if (String(speechText).length > maxChars) {
    const err = new Error("text_too_large");
    err.code = "text_too_large";
    throw err;
  }
  speechText = String(speechText).replace(/\*/g, "");
  const ttsCfg = await loadChatTtsSettings();
  const lang = (locale || "en").split("-")[0].toLowerCase();
  const runtimeVoice = String(runtime?.chatAudioTtsVoice || "").trim();
  const runtimeModelEn = String(runtime?.chatAudioTtsModelEn || "").trim();
  const runtimeModelDefault = String(runtime?.chatAudioTtsModelDefault || "").trim();
  const voice = String(runtimeVoice || ttsCfg?.voices?.[lang] || ttsCfg?.voices?.default || "nova");
  const model = String(lang === "en"
    ? (runtimeModelEn || ttsCfg?.models?.en || "tts-1")
    : (runtimeModelDefault || ttsCfg?.models?.[lang] || ttsCfg?.models?.default || "tts-1"));
  const speedNum = Number(runtime?.chatAudioTtsSpeed ?? ttsCfg?.speed?.[lang] ?? ttsCfg?.speed?.default ?? 0.9);
  const speed = Number.isFinite(speedNum) && speedNum > 0 ? speedNum : 0.9;
  let cleanedText = naturalizeNumbersForTTS(speechText, locale);
  if (lang === "uk" || lang === "ru") cleanedText = expandFinancialTextPhonetically(cleanedText, lang);

  const controller = new AbortController();
  const timeoutMs = Number(runtime?.openaiTimeoutMs || OPENAI_TIMEOUT_MS);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${OPENAI_BASE_URL}/audio/speech`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({ model, input: cleanedText, voice, speed }),
    });
    if (!response.ok) {
      const message = await response.text().catch(() => "");
      const err = new Error(message.slice(0, 300) || `upstream_status_${response.status}`);
      err.code = "tts_upstream_error";
      throw err;
    }
    if (!response.body) return false;
    res.setHeader("Content-Type", "audio/mpeg");
    res.status(200);
    const reader = response.body.getReader();
    let wroteAny = false;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value?.length) {
        wroteAny = true;
        res.write(Buffer.from(value));
      }
    }
    res.end();
    return wroteAny;
  } catch (e) {
    if (e?.code) throw e;
    const err = new Error(e?.name === "AbortError" ? "tts_timeout" : "internal_server_error");
    err.code = e?.name === "AbortError" ? "tts_timeout" : "internal_server_error";
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export async function synthesizeChatAudioBuffer({ text, locale, runtime = null }) {
  let speechText = text;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !speechText) {
    const err = new Error("missing_params");
    err.code = "missing_params";
    throw err;
  }
  if (isAiGloballyDisabled(runtime)) {
    const err = new Error("global_ai_disabled");
    err.code = "global_ai_disabled";
    throw err;
  }
  const maxChars = Number(runtime?.chatAudioMaxChars || CHAT_AUDIO_MAX_CHARS);
  if (String(speechText).length > maxChars) {
    const err = new Error("text_too_large");
    err.code = "text_too_large";
    throw err;
  }

  // Strip Markdown markers before TTS
  speechText = String(speechText).replace(/\*/g, "");

  const ttsCfg = await loadChatTtsSettings();
  const lang = (locale || "en").split("-")[0].toLowerCase();
  const runtimeVoice = String(runtime?.chatAudioTtsVoice || "").trim();
  const runtimeModelEn = String(runtime?.chatAudioTtsModelEn || "").trim();
  const runtimeModelDefault = String(runtime?.chatAudioTtsModelDefault || "").trim();
  const voice = String(runtimeVoice || ttsCfg?.voices?.[lang] || ttsCfg?.voices?.default || "nova");
  const model = String(lang === "en"
    ? (runtimeModelEn || ttsCfg?.models?.en || "tts-1")
    : (runtimeModelDefault || ttsCfg?.models?.[lang] || ttsCfg?.models?.default || "tts-1"));
  const speedNum = Number(runtime?.chatAudioTtsSpeed ?? ttsCfg?.speed?.[lang] ?? ttsCfg?.speed?.default ?? 0.9);
  const speed = Number.isFinite(speedNum) && speedNum > 0 ? speedNum : 0.9;
  
  let cleanedText = naturalizeNumbersForTTS(speechText, locale);
  
  if (lang === "uk" || lang === "ru") {
      // Convert all remaining digits to Cyrillic words to force native accent
      cleanedText = expandFinancialTextPhonetically(cleanedText, lang);
  }

  const controller = new AbortController();
  const timeoutMs = Number(runtime?.openaiTimeoutMs || OPENAI_TIMEOUT_MS);
  const baseUrl = OPENAI_BASE_URL;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/audio/speech`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({ 
        model,
        input: cleanedText, 
        voice,
        speed
      }),
    });
    if (!response.ok) {
      const message = await response.text().catch(() => "");
      const err = new Error(message.slice(0, 300) || `upstream_status_${response.status}`);
      err.code = "tts_upstream_error";
      throw err;
    }
    const audioArrayBuffer = await response.arrayBuffer();
    return Buffer.from(audioArrayBuffer);
  } catch (e) {
    if (e?.code) throw e;
    const err = new Error(e?.name === "AbortError" ? "tts_timeout" : "internal_server_error");
    err.code = e?.name === "AbortError" ? "tts_timeout" : "internal_server_error";
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function isCompositeQuery(message = "") {
  const s = String(message || "").toLowerCase();
  const hasJoin = /\b(and|also|plus|then|as well as|,)\b|и|та|і/.test(s);
  const hasDriver = /\b(driver|drivers|top|contributor|contributors|main driver|top\s*1|leading)\b|драйвер|топ|основн/.test(s);
  const hasYoY = /\b(yoy|year over year|year-over-year|growth|annual growth)\b|г\/г|р\/р|год к году|рік до року/.test(s);
  return hasJoin && hasDriver && hasYoY;
}

function parseTrailingYearsWindow(message = "") {
  const s = String(message || "").toLowerCase();
  const m = s.match(/\blast\s+(\d+)\s+years?\b|(?:за|останні|последние)\s+(\d+)\s+(?:рок|лет|years?)/i);
  const n = Number(m?.[1] || m?.[2] || 0);
  return Number.isFinite(n) && n >= 2 && n <= 10 ? n : null;
}

function asksPerYearNotOverall(message = "") {
  const s = String(message || "").toLowerCase();
  return /\b(for each year|each year|per year|not overall|by year|every year)\b|за\s+кожен\s+рік|каждый\s+год|по\s+годам|щороку/i.test(s);
}

function asksYoyWithPerYearDriver(message = "") {
  const s = String(message || "").toLowerCase();
  const hasYoY = /\b(yoy|year over year|year-over-year|annual growth|growth rate|revenue growth|sales growth|income growth)\b|г\/г|р\/р|год к году|рік до року/i.test(s);
  const hasDriver = /\b(driver|drivers|top\s*1|main driver|leading contributor|contributor)\b|драйвер|основн|топ\s*1/i.test(s);
  const hasPerYear = /\b(each year|every year|per year|for each year|by year)\b|по\s+годам|каждый\s+год|за\s+кожен\s+рік|щороку/i.test(s);
  const compactTopDriversYoY = /\btop\s+drivers?\s+(?:year\s+over\s+year|yoy)\b/i.test(s);
  return (hasYoY && hasDriver && hasPerYear) || compactTopDriversYoY;
}

function asksQuarterTrendSummary(message = "") {
  const s = String(message || "").toLowerCase();
  return /\b(quarter|quarterly|qoq|accelerated|declined|decline|growth)\b|квартал|квартально|ускор|упал|зниз|зрост/i.test(s);
}

function asksAllTime(message = "") {
  const s = String(message || "").toLowerCase();
  return /\b(all time|overall|entire period|whole period|across all years|lifetime)\b|за\s+весь\s+період|за\s+весь\s+период|всего\s+за\s+период/i.test(s);
}

function prefixTopListRowsWithYear(block = "", year = null) {
  const y = Number(year);
  if (!Number.isFinite(y)) return String(block || "");
  const normalized = String(block || "").replace(/^(\d+\.\s+)/gm, `${y} | $1`);
  return normalized.replace(/^(Top\s+\d+\s+.+)$/im, "\n$1");
}

function enforcePerYearTopListSpacing(text = "") {
  return String(text || "")
    .replace(/(Year\s+\d{4})\s+(Top\s+\d+\s+)/gi, "$1\n$2")
    .replace(/(\$\d[\d,]*\.\d{2})\s+(Year\s+\d{4})/g, "$1\n\n$2");
}

function resolvePendingClarificationForUser({ userId = 0, sheetId = null }) {
  const uid = Number(userId || 0);
  if (!uid) return { key: null, pending: null };
  const preferredKey = `${uid}:${String(sheetId || "nosheet")}`;
  const preferred = PENDING_CLARIFICATIONS.get(preferredKey) || null;
  if (preferred && Date.now() - Number(preferred.ts || 0) <= CLARIFICATION_TTL_MS) {
    return { key: preferredKey, pending: preferred };
  }
  if (preferred) PENDING_CLARIFICATIONS.delete(preferredKey);

  let best = null;
  for (const [key, value] of PENDING_CLARIFICATIONS.entries()) {
    if (!String(key).startsWith(`${uid}:`)) continue;
    if (Date.now() - Number(value?.ts || 0) > CLARIFICATION_TTL_MS) {
      PENDING_CLARIFICATIONS.delete(key);
      continue;
    }
    if (!best || Number(value?.ts || 0) > Number(best.pending?.ts || 0)) {
      best = { key, pending: value };
    }
  }
  return best || { key: null, pending: null };
}

function resolveDeterministicContextForUser({ userId = 0, sheetId = null }) {
  const key = `${Number(userId || 0)}:${String(sheetId || "nosheet")}`;
  const ctx = LAST_DETERMINISTIC_CONTEXT.get(key) || null;
  if (!ctx) return { key, context: null };
  if (Date.now() - Number(ctx.ts || 0) > DETERMINISTIC_CONTEXT_TTL_MS) {
    LAST_DETERMINISTIC_CONTEXT.delete(key);
    return { key, context: null };
  }
  return { key, context: ctx };
}

export async function chatQuery(req, res) {
  const { sheetId: requestedSheetId, activeTab = null, message, activeFilters = {}, splitContext = null, activeViewScope = null, conversationHistory = [], locale: rawLocale } = req.body || {};
  let sheetId = requestedSheetId ? String(requestedSheetId).trim() : null;
  const locale = normalizeLocale(rawLocale || "en");
  const normalizedMessage = normalizeRelativeYearInMessage(String(message || ""));
  if (!normalizedMessage.trim()) {
    return res.status(400).json(aiError("chat_message_required"));
  }
  if (!sheetId) {
    const candidates = await query(
      `SELECT id
         FROM sheets
        WHERE active = TRUE
        ORDER BY created_at ASC NULLS LAST, id ASC
        LIMIT 200`
    );
    for (const row of candidates || []) {
      const candidateId = row?.id ? String(row.id).trim() : "";
      if (!candidateId) continue;
      const accessProbe = await loadAccessibleRows(candidateId, req.user, null, 1);
      if (!accessProbe?.forbidden) {
        sheetId = candidateId;
        break;
      }
    }
  }
  const hasSheet = Boolean(sheetId);
  const pendingResolved = resolvePendingClarificationForUser({
    userId: req.user?.id || 0,
    sheetId,
  });
  const clarificationKey = pendingResolved.key || `${Number(req.user?.id || 0)}:${String(sheetId || "nosheet")}`;
  const pendingClarification = pendingResolved.pending || null;
  const clarificationSelectionMatch = String(normalizedMessage || "").trim().match(/^(\d+)(?:[\).\s].*)?$/);
  const selectedClarificationOption = (() => {
    if (!pendingClarification) return null;
    const options = Array.isArray(pendingClarification.options) ? pendingClarification.options : [];
    
    // 1. Numeric Match (e.g., "1")
    const n = Number.parseInt(String(clarificationSelectionMatch?.[1] || ""), 10);
    if (Number.isFinite(n) && n >= 1 && n <= options.length) {
      return String(options[n - 1]);
    }

    // 2. Text-based Exact Match (case-insensitive)
    const text = String(normalizedMessage || "").trim().toLowerCase();
    const match = options.find(opt => String(opt).toLowerCase() === text);
    if (match) return String(match);

    // 3. Text-based Fuzzy/Includes Match (if short and unique)
    const candidates = options.filter(opt => String(opt).toLowerCase().includes(text));
    if (candidates.length === 1) return String(candidates[0]);

    return null;
  })();

  const effectiveUserMessage = (() => {
    if (!selectedClarificationOption) return normalizedMessage;
    const source = String(pendingClarification?.sourceMessage || "").trim();
    return source || normalizedMessage;
  })();
  const planningMessage = effectiveUserMessage;
  const resolvedDeterministicContext = resolveDeterministicContextForUser({
    userId: req.user?.id || 0,
    sheetId,
  });
  const isPlatformAdmin = isPlatformAdminUser(req.user);
  const resolvedGroupId = isPlatformAdmin ? null : await resolveAiGroupIdForSheet({ sheetId, user: req.user });
  const fallbackUserGroupId = await resolveRuntimeGroupIdForUser(req.user);
  const runtimeGroupId = isPlatformAdmin ? null : (resolvedGroupId || fallbackUserGroupId || null);
  const { runtime } = await loadEffectiveAiRuntimeSettings(runtimeGroupId || null);
  const chatRuntimeRules = await loadChatRuntimeRules();
  if (AI_DEBUG_LOGS) {
    console.info("[chat_ai_runtime] resolved", {
      groupId: runtimeGroupId || null,
      aiProvider: runtime?.aiProvider || null,
      openaiModel: runtime?.openaiModel || null,
      providerModel: runtime?.providerConfigs?.[runtime?.aiProvider || "openai"]?.model || null,
      openaiBaseUrl: runtime?.openaiBaseUrl || null,
      providerBaseUrl: runtime?.providerConfigs?.[runtime?.aiProvider || "openai"]?.baseUrl || null,
    });
  }
  if (isAiGloballyDisabled(runtime)) return res.status(403).json(aiError("global_ai_disabled"));
  if (!runtime.chatEnabled) return res.status(403).json(aiError("chat_disabled"));
  if (runtimeGroupId) {
    const rows = await query("SELECT id, entitlements FROM groups WHERE id = $1 LIMIT 1", [runtimeGroupId]);
    if (rows?.[0] && !groupHasFeature(rows[0], "chatAi")) return res.status(403).json(aiError("feature_not_enabled:chatAi"));
  }
  let aiReservation = null;
  const maxInputChars = Math.max(1, Number(runtime.chatMaxInputChars || 12000));
  const maxHistoryMessages = Math.max(1, Number(runtime.chatHistoryWindowMessages || 8));
  if (normalizedMessage.length > maxInputChars) {
    console.warn("[chat_size_guard] chat_message_too_large", {
      size: normalizedMessage.length,
      limit: maxInputChars,
      sheetId,
      userId: req.user?.id || null,
    });
    return res.status(413).json(aiError("chat_message_too_large", { maxChars: maxInputChars }));
  }
  const incomingHistoryCount = Array.isArray(conversationHistory) ? conversationHistory.length : 0;
  if (incomingHistoryCount > maxHistoryMessages) {
    console.info("[chat_size_guard] trimming_conversation_history", {
      incomingMessages: incomingHistoryCount,
      keptMessages: maxHistoryMessages,
      sheetId,
      userId: req.user?.id || null,
    });
  }
  const activeFiltersPayloadChars = JSON.stringify(activeFilters || {}).length;
  if (activeFiltersPayloadChars > maxInputChars) {
    console.warn("[chat_size_guard] chat_filters_too_large", {
      size: activeFiltersPayloadChars,
      limit: maxInputChars,
      sheetId,
      userId: req.user?.id || null,
    });
    return res.status(413).json(aiError("chat_filters_too_large", { maxChars: maxInputChars }));
  }
  const boundedConversationHistory = Array.isArray(conversationHistory)
    ? conversationHistory.slice(-maxHistoryMessages)
    : [];
  const compactConversationHistory = boundedConversationHistory
    .map((entry) => ({
      role: String(entry?.role || "").trim().toLowerCase() === "assistant" ? "assistant" : "user",
      content: String(entry?.content || "").slice(0, 4000),
    }))
    .filter((entry) => entry.content);
  const estimatedInputChars = normalizedMessage.length + JSON.stringify(compactConversationHistory).length;
  if (estimatedInputChars > maxInputChars) {
    console.warn("[chat_size_guard] chat_input_too_large", {
      size: estimatedInputChars,
      limit: maxInputChars,
      messageChars: normalizedMessage.length,
      historyChars: JSON.stringify(compactConversationHistory).length,
      historyMessages: compactConversationHistory.length,
      sheetId,
      userId: req.user?.id || null,
    });
    return res.status(413).json(aiError("chat_input_too_large", { maxChars: maxInputChars }));
  }

  try {
    aiReservation = await reserveAiQueryForSheet({ sheetId, user: req.user, kind: "chat_query" });
  } catch (err) {
    return res.status(err.statusCode || 429).json(aiError(err.message, err.details || {}));
  }

  let loadedSample = null;
  let baseHeaders = [];
  let aiHeaders = [];
  let activeDashboardFilters = [];
  let sampleRows = [];
  let tabNames = [];
  let semanticProfile = {};
  if (hasSheet) {
    // PERF-01: Load only SAMPLE rows for AI context, not all 500k rows
    loadedSample = await loadAccessibleRows(sheetId, req.user, null, 100);
    if (loadedSample?.forbidden) return res.status(403).json(aiError("Forbidden"));

    baseHeaders = loadedSample.headers || [];
    const scopedVisibleColumns = normalizeScopeColumns(activeViewScope?.visibleColumns || [], baseHeaders);
    aiHeaders = scopedVisibleColumns.length ? scopedVisibleColumns : baseHeaders;
    activeDashboardFilters = normalizeActiveDashboardFilters(aiHeaders, activeFilters);
    const scopedSampleRows = projectRowsToHeaders(loadedSample.rows || [], aiHeaders);
    sampleRows = applyFilters(scopedSampleRows, activeDashboardFilters);
    tabNames = Array.isArray(loadedSample.tabs) ? loadedSample.tabs : [];
    semanticProfile = restrictSemanticProfileToHeaders(loadedSample.semanticProfile, aiHeaders, scopedSampleRows);
    semanticProfile = await ensureAiHeaderUnderstanding({
      sheetId,
      headers: aiHeaders,
      sampleRows: scopedSampleRows,
      semanticProfile,
      runtime,
    });

  }

  if (!hasSheet) {
    const noSheetPrompt = `${normalizedMessage}\n\nNo spreadsheet is currently opened. Reply with usage guidance and safe interpretations of local workspace AI/UX rules only. Do not invent numbers or reference sheet rows.`;
    let noSheetPlan;
    try {
      const aiResult = await callOpenAI({
        message: noSheetPrompt,
        headers: [],
        sampleRows: [],
        conversationHistory: compactConversationHistory,
        locale,
        dateFormatHints: [],
        schemaProfile: { available_tabs: [], available_files: [], active_filters: [], split_context: null, semantic_profile: {} },
        maxOutputTokens: Number(runtime.llmMaxOutputTokens || 800),
        runtime,
      });
      noSheetPlan = normalizeAiPlan(aiResult.plan);
  } catch (e) {
    const reason = resolveOpenAIRequestFailureReason(e);
    const detail = String(e?.message || "").slice(0, 280);
    console.error("OpenAI call failed:", e);
    const statusCode = Number(e?.statusCode || 0);
    if (statusCode === 413 || String(e?.code || "") === "chat_prompt_budget_exceeded" || String(e?.message || "") === "chat_prompt_budget_exceeded") {
      return res.status(413).json(aiError("chat_prompt_budget_exceeded", { reason, detail }));
    }
    return res.status(502).json(aiError("ai_unavailable", { reason, detail }));
  }

    return res.json({
      answer: formatAnswerWithBullets(noSheetPlan?.answer || "AI is ready. Open a spreadsheet to ask data analysis questions."),
      actions: { reset_filters: false, filters: [], chart: null },
      preview_rows: [],
      meta: {
        operation: "none",
        locale,
        noSheetMode: true,
      },
    });
  }

  const domainRoute = classifyBusinessDomain(planningMessage);
  if (domainRoute?.safe_next_action === "ask_followup") {
    return res.json({
      answer: "Your question can be interpreted across multiple domains. Do you mean accounting revenue, sales performance, or marketing-attributed revenue?",
      actions: { reset_filters: false, filters: [], chart: null },
      preview_rows: [],
      meta: { phase: "multi_domain_followup", domains: domainRoute.domains || [] },
    });
  }
  if (domainRoute?.domains?.includes("tax") || domainRoute?.safe_next_action === "tax_not_enabled" || domainRoute?.safe_next_action === "unsupported_or_tax_not_enabled") {
    return res.json({
      answer: "Tax-specific analysis is not enabled yet. I can summarize tax-related fields once tax-safe logic is enabled, but I cannot provide tax advice.",
      actions: { reset_filters: false, filters: [], chart: null },
      preview_rows: [],
      meta: { phase: "tax_not_enabled", domains: domainRoute.domains || [] },
    });
  }
  if (domainRoute?.primary_domain && ["finance", "marketing", "sales"].includes(domainRoute.primary_domain)) {
    return res.json({
      answer: `I understood your question as ${domainRoute.primary_domain}. Domain classification is enabled, but deterministic ${domainRoute.primary_domain} calculations are not enabled in this chat path yet.`,
      actions: { reset_filters: false, filters: [], chart: null },
      preview_rows: [],
      meta: {
        phase: "multi_domain_classification_only",
        domain: domainRoute.primary_domain,
        domains: domainRoute.domains || [],
      },
    });
  }

  const accountingIntent = await analyzeAccountingIntent({ message: planningMessage, runtime });
  const compiledPlan = await compileDeterministicQueryPlan({
    message: planningMessage,
    accountingIntent,
    headers: baseHeaders,
    semanticProfile,
    sampleRows: loadedSample?.rows || [],
    hints: {
      metric: pendingClarification?.kind === "metric"
        ? selectedClarificationOption
        : (pendingClarification?.metric || undefined),
      dateHeader: pendingClarification?.kind === "date" ? selectedClarificationOption : undefined,
      headerChoice: pendingClarification?.kind === "header" ? selectedClarificationOption : undefined,
      headerCanonical: pendingClarification?.kind === "header" ? String(pendingClarification?.field || "") : undefined,
      context: resolvedDeterministicContext.context || {},
    },
  });
  if (compiledPlan.ok) {
    PENDING_CLARIFICATIONS.delete(clarificationKey);

    // Persistence: If this was a header resolution, save it to the sheet's semantic profile
    if (pendingClarification?.kind === "header" && pendingClarification?.field && selectedClarificationOption) {
      try {
        const currentProfile = semanticProfile || {};
        const mappings = { ...(currentProfile.headerMappings || {}), [pendingClarification.field]: selectedClarificationOption };
        const newProfile = { ...currentProfile, headerMappings: mappings };
        await query(
          "UPDATE sheets SET semantic_profile = $1 WHERE id = $2",
          [JSON.stringify(newProfile), sheetId]
        );

        // Self-Learning: Record this successful mapping for future generalization
        const { recordSuccessfulMapping } = await import("../services/ai/semanticKnowledgeService.js");
        await recordSuccessfulMapping({
          canonicalField: pendingClarification.field,
          synonym: selectedClarificationOption,
          locale: locale || "en"
        });
      } catch (e) {
        console.error("Failed to persist header mapping choice:", e);
      }
    }


    const selectedTab = String(activeTab || "").trim() || null;

    const fullLoad = await loadAccessibleRows(sheetId, req.user, selectedTab);
    if (fullLoad?.forbidden) {
      return res.status(403).json(aiError("forbidden"));
    }
    const calcResult = executeDeterministicSpreadsheetPlan({
      plan: compiledPlan,
      rows: fullLoad?.rows || [],
      filters: accountingIntent?.filters || [],
      userContext: { allowedColumns: fullLoad?.allowedColumns || baseHeaders || aiHeaders, userId: req.user?.id || null, tenantId: req.user?.customer_id || null },
    });
    try {
      await writeAuditLog({
        req,
        actorUserId: req.user?.id || null,
        action: "accounting.metric_calculation",
        resourceType: "sheet",
        resourceId: sheetId || null,
        metadata: {
          tenantId: req.user?.customer_id || null,
          metric: compiledPlan.metric,
          headersUsed: calcResult?.headersUsed || {},
          period: calcResult?.period || null,
          comparisonPeriod: compiledPlan.comparisonPeriod || null,
          rowCount: calcResult?.rowCount || 0,
          invalidNumericCount: Number((calcResult?.notes || []).join(" ").match(/\d+/)?.[0] || 0),
          success: !!calcResult?.ok,
          errorCode: calcResult?.errorCode || null,
          at: new Date().toISOString(),
        },
      });
    } catch {}
    let answer = await presentDeterministicSpreadsheetResult({
      message: planningMessage,
      plan: compiledPlan,
      calcResult,
      accountingIntent,
      runtime,
    });
    
    // Safety: If answer is raw JSON string, use simple fallback
    if (typeof answer === 'string' && (answer.trim().startsWith('{') || answer.trim().startsWith('['))) {
      try {
        JSON.parse(answer);
        answer = buildSimpleDeterministicAnswer({ metric: compiledPlan.metric, result: calcResult, periodLabel: calcResult?.period?.label || "selected period" });
      } catch {}
    }

    {
      const ctxKey = `${Number(req.user?.id || 0)}:${String(sheetId || "nosheet")}`;
      const yearsFromPlan = Array.isArray(compiledPlan?.years) ? compiledPlan.years.map((y) => Number(y)).filter(Number.isFinite) : [];
      const yearsFromPeriod = Array.from(String(calcResult?.period?.label || "").matchAll(/\b(19\d{2}|20\d{2})\b/g), (m) => Number(m?.[1] || m?.[0])).filter(Number.isFinite);
      const lastYears = yearsFromPlan.length ? yearsFromPlan : yearsFromPeriod;
      LAST_DETERMINISTIC_CONTEXT.set(ctxKey, {
        ts: Date.now(),
        lastOperation: String(compiledPlan?.operation || ""),
        lastMetric: String(compiledPlan?.metric || ""),
        lastYears,
      });
    }
    return res.json({
      answer,
      actions: { reset_filters: false, filters: [], chart: null },
      preview_rows: [],
      meta: {
        phase: "accounting_deterministic_calculation",
        metric_requested: compiledPlan.metric,
        calculation_result: calcResult,
      },
    });
  }
  if (compiledPlan.message || compiledPlan.clarification_needed === true) {
    if (compiledPlan.clarification_needed === true) {
      const options = Array.isArray(compiledPlan.clarification_options) ? compiledPlan.clarification_options : [];
      const reasonText = String(compiledPlan.reason || "");
      const kind = reasonText.includes("ambiguous_headers") || reasonText.includes("missing_required_headers")
        ? "header"
        : (reasonText.includes("date") ? "date" : "metric");
      PENDING_CLARIFICATIONS.set(clarificationKey, {
        ts: Date.now(),
        kind,
        metric: compiledPlan.metric || (typeof accountingIntent?.metric_requested === 'string' ? accountingIntent.metric_requested : null),
        field: String(compiledPlan?.clarification_field || "").trim() || null,
        options,
        sourceMessage: effectiveUserMessage,
      });

      const optionsText = options.length
        ? `\n${options.map((opt, idx) => `${idx + 1}. ${opt}`).join("\n")}`
        : "";
      return res.json({
        answer: `${compiledPlan.clarification_question || "I can answer that, but I need one clarification first."}${optionsText}`,
        actions: { reset_filters: false, filters: [], chart: null },
        preview_rows: [],
        meta: { phase: "accounting_clarification_required", reason: compiledPlan.reason || "clarification_needed", options },
      });
    }
    if (compiledPlan.message) {
      PENDING_CLARIFICATIONS.delete(clarificationKey);
      return res.json({
        answer: compiledPlan.message,
        actions: { reset_filters: false, filters: [], chart: null },
        preview_rows: [],
        meta: { phase: "accounting_deterministic_preflight", reason: compiledPlan.reason || "preflight_failed" },
      });
    }
    const debugHeaderResolutionResponse = chatRuntimeRules?.debugHeaderResolutionResponse === true;
    const answer = debugHeaderResolutionResponse
      ? buildHeaderExplanationResponse({ metricKey: null, resolution: {}, locale })
      : "I need clarification before calculating this accounting result.";
    PENDING_CLARIFICATIONS.delete(clarificationKey);
    return res.json({
      answer,
      actions: { reset_filters: false, filters: [], chart: null },
      preview_rows: [],
      meta: {
        phase: "accounting_intent_header_resolution",
        intent: accountingIntent.intent,
        metric_requested: null,
        required_headers: accountingIntent.required_canonical_headers || [],
        confidence: accountingIntent.confidence || "medium",
        resolution: {},
      },
    });
  }

  const complexTypes = new Set([
    "driver_analysis_profit",
    "driver_analysis_gross_margin",
    "driver_analysis_expenses",
    "period_comparison_revenue",
    "pnl_summary",
    "budget_vs_actual",
    "cash_flow_issue",
  ]);
  const shouldPlanComplex =
    accountingIntent?.safe_next_action === "build_analysis_plan"
    || complexTypes.has(String(accountingIntent?.question_type || ""));
  if (shouldPlanComplex) {
    const plan = await buildAccountingAnalysisPlan({
      message: normalizedMessage,
      analyzerResult: accountingIntent,
      availableHeaders: aiHeaders,
      cachedFieldMetadata: semanticProfile?.headerMappings || {},
      supportedMetricKeys: Object.keys(METRIC_REGISTRY),
      metricHeaderRequirements: {},
      complexQuestionRequirements: COMPLEX_QUESTION_REQUIREMENTS,
      runtime,
    });
    const canonicalHeaders = ["date", "revenue", "expenses", "cogs", "gross_profit", "gross_margin_pct", "net_income", "actual", "budget", "category", "account", "department", "store", "region", "customer", "vendor", "cash", "cash_in", "cash_out", "accounts_receivable", "accounts_payable"];
    const validated = validateAnalysisPlan({ plan, supportedMetrics: Object.keys(METRIC_REGISTRY), supportedCanonicalHeaders: canonicalHeaders });
    if (!validated.ok) {
      return res.json({
        answer: "I need clarification before running this analysis safely. Please confirm the metric and periods to compare.",
        actions: { reset_filters: false, filters: [], chart: null },
        preview_rows: [],
        meta: { phase: "complex_plan_validation", error: validated.errorCode, rejectedSteps: validated.rejectedSteps || [] },
      });
    }
    const headerResolution = resolveAnalysisHeaders({
      approvedPlan: validated.approvedPlan,
      headers: aiHeaders,
      fieldMetadata: semanticProfile?.headerMappings || {},
      message: normalizedMessage,
    });
    if (!headerResolution.ok) {
      return res.json({
        answer: headerResolution.message,
        actions: { reset_filters: false, filters: [], chart: null },
        preview_rows: [],
        meta: { phase: "complex_header_resolution", ...headerResolution },
      });
    }
    const analysisResult = executeAnalysisPlan({
      approvedPlan: validated.approvedPlan,
      headerResolution,
      rows: loadedSample?.rows || [],
      userContext: { allowedColumns: aiHeaders, userId: req.user?.id || null, tenantId: req.user?.customer_id || null },
    });
    try {
      await writeAuditLog({
        req,
        actorUserId: req.user?.id || null,
        action: "accounting.complex_analysis",
        resourceType: "sheet",
        resourceId: sheetId || null,
        metadata: {
          tenantId: req.user?.customer_id || null,
          questionType: validated.approvedPlan?.question_type || null,
          primaryMetric: validated.approvedPlan?.primary_metric || null,
          period: validated.approvedPlan?.period || null,
          comparisonPeriod: validated.approvedPlan?.comparison_period || null,
          headersUsed: analysisResult?.headersUsed || {},
          optionalHeadersMissing: analysisResult?.missingOptionalFields || [],
          answerCompleteness: analysisResult?.answerCompleteness || null,
          rowCounts: analysisResult?.rowCounts || {},
          stepsExecuted: analysisResult?.stepsExecuted || [],
          success: !!analysisResult?.ok,
          errorCode: analysisResult?.errorCode || null,
          at: new Date().toISOString(),
        },
      });
    } catch {}
    const answer = await explainAccountingAnalysis({
      originalQuestion: normalizedMessage,
      analyzerOutput: accountingIntent,
      validatedPlan: validated.approvedPlan,
      headerResolution,
      analysisResult,
      runtime,
    });
    return res.json({
      answer,
      actions: { reset_filters: false, filters: [], chart: null },
      preview_rows: [],
      meta: { phase: "complex_accounting_analysis", questionType: validated.approvedPlan?.question_type, analysisResult },
    });
  }

  if (!CHAT_ENABLE_LEGACY_FALLBACK) {
    return res.json({
      answer: "I can answer that, but I need one clarification first. Please specify the metric, grouping, and period so I can run a deterministic calculation.",
      actions: { reset_filters: false, filters: [], chart: null },
      preview_rows: [],
      meta: { phase: "deterministic_orchestrator_only", legacy_fallback_enabled: false },
    });
  }

  if (isDateRelatedQuestion(message) && !sheetHasTemporalColumn(aiHeaders, sampleRows, semanticProfile)) {
    const answer = noDateColumnAnswer(locale);
    return res.json({
      answer,
      actions: { reset_filters: false, filters: [], chart: null },
      preview_rows: [],
      meta: {
        operation: "none",
        locale,
        dateRelatedBlocked: true,
        reason: "missing_temporal_column",
      },
    });
  }
  
  // PERF-01: Build Workspace Schema for Cross-Sheet Intelligence
  const workspaceRes = await query(
      `SELECT DISTINCT s.id, s.display_name, s.filename, s.headers, s.uploaded_at,
              rsi.file_label, rsi.import_version
       FROM sheets s
       LEFT JOIN report_sources rs ON rs.id = s.report_source_id
       LEFT JOIN report_source_imports rsi ON rsi.sheet_id = s.id
       WHERE (
         $2 = 'admin'
         OR rs.created_by = $1
         OR EXISTS (
           SELECT 1
           FROM views v
           LEFT JOIN report_source_imports vrsi ON vrsi.sheet_id = s.id
           WHERE (
             v.sheet_id = s.id
             OR (
               v.sheet_id IS NULL
               AND v.report_source_id = vrsi.report_source_id
               AND (v.file_label IS NULL OR v.file_label = vrsi.file_label)
             )
           )
           AND (
             EXISTS (SELECT 1 FROM view_user_permissions vup WHERE vup.view_id = v.id AND vup.user_id = $1)
           )
         )
       )`,
      [req.user.id, req.user.role]
  );
  const parsedSplitContext = (splitContext && typeof splitContext === "object")
    ? {
        primary_sheet_id: splitContext.primarySheetId ? String(splitContext.primarySheetId) : null,
        secondary_sheet_id: splitContext.secondarySheetId ? String(splitContext.secondarySheetId) : null,
        secondary_tab: splitContext.secondaryTab ? String(splitContext.secondaryTab) : null,
        primary_uploaded_at: splitContext.primaryUploadedAt ? String(splitContext.primaryUploadedAt) : null,
        secondary_uploaded_at: splitContext.secondaryUploadedAt ? String(splitContext.secondaryUploadedAt) : null,
      }
      : null;
  const allAvailableFiles = workspaceRes.map(f => ({
      id: f.id,
      name: f.display_name || f.filename,
      headers: typeof f.headers === 'string' ? JSON.parse(f.headers) : (f.headers || []),
      file_label: f.file_label || null,
      import_version: Number.isFinite(Number(f.import_version)) ? Number(f.import_version) : null,
      uploaded_at: f.uploaded_at || null,
  }));
  const scopedSheetIds = new Set(
    [sheetId, activeViewScope?.splitContext?.secondarySheetId, parsedSplitContext?.secondary_sheet_id]
      .filter(Boolean)
      .map((v) => String(v))
  );
  const availableFiles = allAvailableFiles.filter((f) => scopedSheetIds.has(String(f.id)));

  const dateFormatHints = buildDateFormatHints(aiHeaders, sampleRows);

  let ai;
  try {
    const aiResult = await callOpenAI({
      message: `${message}\n\nAvailable tabs: ${tabNames.join(", ") || "N/A"}\nIf the question maps to a specific tab, set target_tab in the JSON response.`,
      headers: aiHeaders,
      sampleRows,
      conversationHistory: compactConversationHistory,
      locale,
      dateFormatHints,
      schemaProfile: { 
          available_tabs: tabNames,
          available_files: availableFiles,
          active_filters: activeDashboardFilters,
          split_context: parsedSplitContext,
          semantic_profile: compactSemanticProfileForPrompt(semanticProfile),
      },
      maxOutputTokens: Number(runtime.llmMaxOutputTokens || 800),
      runtime,
    });
    ai = repairAiPlanForExecution(normalizeAiPlan(aiResult.plan), aiHeaders);
    const requiredIntent = deriveMetricIntentFromQuestion(message);
    const requiresDriverPlan = runtimeRegex(chatRuntimeRules, "driverIntentRegex", CHAT_RUNTIME_RULES_DEFAULTS.driverIntentRegex).test(String(message || "").toLowerCase());
    const targetColumnFromPlan = String(ai?.target_column || "").toLowerCase();
    const targetIntent =
      /\b(revenue|sales|income|turnover)\b|выручк|доход|дохід|продаж/i.test(targetColumnFromPlan) ? "revenue" :
      (/\b(expense|cost|spend|cogs|opex)\b|расход|витрат/i.test(targetColumnFromPlan) ? "expense" :
      (/\b(profit|margin|ebit|ebitda)\b|прибут|прибыл/i.test(targetColumnFromPlan) ? "profit" : "auto"));
    const mismatch = requiredIntent !== "auto" && targetIntent !== "auto" && requiredIntent !== targetIntent;
    if (mismatch) {
      const retryPrompt = `${message}\n\nValidation feedback: selected target_column "${ai.target_column}" does not match required metric intent "${requiredIntent}". Replan with matching metric intent using only available_columns.`;
      const retry = await callOpenAI({
        message: `${retryPrompt}\n\nAvailable tabs: ${tabNames.join(", ") || "N/A"}\nIf the question maps to a specific tab, set target_tab in the JSON response.`,
        headers: aiHeaders,
        sampleRows,
        conversationHistory: compactConversationHistory,
        locale,
        dateFormatHints,
        schemaProfile: {
          available_tabs: tabNames,
          available_files: availableFiles,
          active_filters: activeDashboardFilters,
          split_context: parsedSplitContext,
          semantic_profile: compactSemanticProfileForPrompt(semanticProfile),
        },
        runtime,
      });
      ai = repairAiPlanForExecution(normalizeAiPlan(retry.plan), aiHeaders);
    }
    if (requiresDriverPlan) {
      const validDriverPlan = String(ai?.operation || "") === "top_n" && String(ai?.group_by || "").trim().length > 0;
      if (!validDriverPlan) {
        const retryPrompt = `${message}\n\nValidation feedback: this is a driver-ranking request. Replan with operation='top_n' and a non-empty group_by dimension column from available_columns.`;
        const retry = await callOpenAI({
          message: `${retryPrompt}\n\nAvailable tabs: ${tabNames.join(", ") || "N/A"}\nIf the question maps to a specific tab, set target_tab in the JSON response.`,
          headers: aiHeaders,
          sampleRows,
          conversationHistory: compactConversationHistory,
          locale,
          dateFormatHints,
          schemaProfile: {
            available_tabs: tabNames,
            available_files: availableFiles,
            active_filters: activeDashboardFilters,
            split_context: parsedSplitContext,
            semantic_profile: compactSemanticProfileForPrompt(semanticProfile),
          },
          runtime,
        });
        ai = repairAiPlanForExecution(normalizeAiPlan(retry.plan), aiHeaders);
      }
    }
    ai = await enforceHeaderBoundAiPlan(ai, aiHeaders, sampleRows);
    await recordAiUsage({
      reservation: aiReservation,
      provider: aiResult.usage?.provider,
      model: aiResult.usage?.model,
      promptTokens: aiResult.usage?.promptTokens,
      completionTokens: aiResult.usage?.completionTokens,
      estimatedCostUsd: aiResult.usage?.estimatedCostUsd,
    }).catch((err) => console.error("[ai_quota] usage record failed:", err?.message || err));
  } catch (e) {
    const reason = resolveOpenAIRequestFailureReason(e);
    const detail = String(e?.message || "").slice(0, 280);
    console.error("OpenAI call failed:", e);
    const statusCode = Number(e?.statusCode || 0);
    if (statusCode === 413 || String(e?.code || "") === "chat_prompt_budget_exceeded" || String(e?.message || "") === "chat_prompt_budget_exceeded") {
      return res.status(413).json({ error: "chat_prompt_budget_exceeded", reason, detail });
    }
    return res.status(502).json({ error: "ai_unavailable", reason, detail });
  }

  try {
    const selectedTab = resolveTabName(tabNames, ai?.target_tab) || activeTab || null;
    
    // Resolve AI components
    const aiFilters = await Promise.all((ai?.filters || []).map(async f => ({
      column: await resolveColumn(aiHeaders, f.column, sampleRows),
      operator: f.operator || "contains",
      value: f.value
    })));
    const filteredAiFilters = aiFilters.filter(f => f.column);
    const executionFilters = [...activeDashboardFilters, ...filteredAiFilters];

    let resolvedOperation = (ai?.operation || "none").toLowerCase();
    let resolvedTarget = await resolveColumn(aiHeaders, ai?.target_column, sampleRows);
    let resolvedGroupBy = await resolveColumn(aiHeaders, ai?.group_by, sampleRows);
    const msgLower = String(message || "").toLowerCase();
    const profileMetric = resolveProfileMetric(semanticProfile, message, [ai?.target_column, ai?.chart?.value_column]);
    const profileDimension = resolveProfileDimension(semanticProfile, message, [profileMetric, resolvedTarget]);
    const profileDateColumn = resolveProfileDateColumn(semanticProfile, [ai?.chart?.date_column, ai?.group_by]);
    if (!resolvedTarget && profileMetric && aiHeaders.includes(profileMetric)) {
      resolvedTarget = profileMetric;
    }
    if (!resolvedGroupBy && resolvedOperation === "year_over_year" && profileDateColumn && aiHeaders.includes(profileDateColumn)) {
      resolvedGroupBy = profileDateColumn;
    }
    if (!resolvedGroupBy && resolvedOperation !== "year_over_year" && profileDimension && aiHeaders.includes(profileDimension)) {
      resolvedGroupBy = profileDimension;
    }
    if (isRatioIntent(message, chatRuntimeRules)) {
      resolvedOperation = "ratio";
      resolvedGroupBy = null;
      resolvedTarget = null;
    }

    const aiClarifiedInsteadOfAnswering = isClarificationOrApologyAnswer(ai?.answer);
    const metricIntent = detectQueryMetricIntent(message, chatRuntimeRules);
    const asksProductRanking = /\b(top|highest|best|selling|sold|product|products)\b/.test(msgLower)
      || /топ|продаж|продукт|товар/i.test(msgLower);
    if (asksProductRanking) {
      const productCol = findProductLikeColumn(aiHeaders);
      if (productCol) {
        resolvedGroupBy = productCol;
        if (resolvedOperation === "none" || resolvedOperation === "filter") {
          resolvedOperation = "top_n";
        }
      }
    }
    const asksDriverRanking = isDriverRankingQuery(normalizedMessage, chatRuntimeRules);
    const lastHistoryText = (compactConversationHistory.slice(-4).map((h) => String(h?.content || "")).join(" ")) || "";
    const lastAssistantText = String((compactConversationHistory.slice().reverse().find((h) => String(h?.role || "") === "assistant")?.content || ""));
    const lastUserText = String((compactConversationHistory.slice().reverse().find((h) => String(h?.role || "") === "user")?.content || "")).toLowerCase();
    const historyMetricHint = extractMetricHintFromText(lastHistoryText);
    const questionMetricHint = extractMetricHintFromText(normalizedMessage);
    const explicitMetricInQuestion = !!questionMetricHint;
    const onlyYearFollowup = isOnlyYearFollowup(normalizedMessage);
    const yearOnlyFollowup = isYearOnlyFollowup(normalizedMessage);
    const whatAboutYearFollowup = isWhatAboutYearFollowup(normalizedMessage);
    const andYearFollowup = isAndYearFollowup(normalizedMessage);
    const shortYearContextFollowup = onlyYearFollowup || yearOnlyFollowup || whatAboutYearFollowup || andYearFollowup;
    const compareFollowupWithoutYears = asksDifferenceFollowupWithoutYears(normalizedMessage, chatRuntimeRules);
    const allTimeIntent = asksAllTime(normalizedMessage);
    if (!explicitMetricInQuestion && !resolvedTarget && historyMetricHint) {
      const histResolved = await resolveColumn(aiHeaders, historyMetricHint, sampleRows);
      if (histResolved) resolvedTarget = histResolved;
    }
    if (asksDriverRanking) {
      if (resolvedOperation === "none" || resolvedOperation === "sum" || resolvedOperation === "filter") {
        resolvedOperation = "top_n";
      }
      if (!resolvedTarget) {
        resolvedTarget = profileMetric
          || inferLikelyMetricColumn(aiHeaders, sampleRows, message, [ai?.target_column, ai?.chart?.value_column]);
      }
      if (!resolvedGroupBy || String(resolvedGroupBy).toLowerCase() === String(resolvedTarget || "").toLowerCase()) {
        resolvedGroupBy = resolveProfileDimension(semanticProfile, message, [resolvedTarget, ai?.target_column, ai?.chart?.value_column])
          || inferLikelyDimensionColumn(aiHeaders, sampleRows, [resolvedTarget, ai?.target_column, ai?.chart?.value_column]);
      }
      if (!Number.isFinite(Number(ai?.limit))) {
        ai.limit = 5;
      }
      if (!explicitMetricInQuestion && !resolvedTarget && historyMetricHint) {
        const histResolved = await resolveColumn(aiHeaders, historyMetricHint, sampleRows);
        if (histResolved) resolvedTarget = histResolved;
      }
    }
    if (isShortYearFollowup(normalizedMessage, chatRuntimeRules)) {
      const explicitComparisonNow = asksExplicitComparisonIntent(normalizedMessage, chatRuntimeRules);
      let singleYearHistoryRegex = /\bfor\s+(19|20)\d{2}\b/i;
      let singleYearMetricKeywordRegex = /\b(revenue|sales|income|profit|expense|cost)\b|выруч|доход|дохід|прибут|расход|витрат/i;
      try { singleYearHistoryRegex = new RegExp(String(chatRuntimeRules?.singleYearMetricHistoryRegex || CHAT_RUNTIME_RULES_DEFAULTS.singleYearMetricHistoryRegex), "i"); } catch {}
      try { singleYearMetricKeywordRegex = new RegExp(String(chatRuntimeRules?.singleYearMetricKeywordRegex || CHAT_RUNTIME_RULES_DEFAULTS.singleYearMetricKeywordRegex), "i"); } catch {}
      const priorWasSingleYearMetric =
        singleYearHistoryRegex.test(lastUserText) &&
        !asksExplicitComparisonIntent(lastUserText, chatRuntimeRules) &&
        singleYearMetricKeywordRegex.test(lastUserText);
      if (priorWasSingleYearMetric && !explicitComparisonNow) {
        resolvedOperation = "sum";
      }
      if (onlyYearFollowup && !explicitMetricInQuestion) {
        resolvedOperation = "sum";
      }
      let topNRegex = /\btop\s*\d+\b/i;
      let moneyRegex = /\bby\s+[a-zа-яіїєґ_ ]+:\s*\$/i;
      try { topNRegex = new RegExp(String(chatRuntimeRules?.topNHistoryRegex || CHAT_RUNTIME_RULES_DEFAULTS.topNHistoryRegex), "i"); } catch {}
      try { moneyRegex = new RegExp(String(chatRuntimeRules?.moneyHistoryRegex || CHAT_RUNTIME_RULES_DEFAULTS.moneyHistoryRegex), "i"); } catch {}
      const histIsTopN = topNRegex.test(lastHistoryText) || moneyRegex.test(lastHistoryText);
      if (!priorWasSingleYearMetric && histIsTopN && (resolvedOperation === "none" || resolvedOperation === "filter" || resolvedOperation === "sum")) {
        resolvedOperation = "top_n";
        if (!resolvedTarget && historyMetricHint) {
          const histResolved = await resolveColumn(aiHeaders, historyMetricHint, sampleRows);
          if (histResolved) resolvedTarget = histResolved;
        }
        if (!resolvedGroupBy || String(resolvedGroupBy).toLowerCase() === String(resolvedTarget || "").toLowerCase()) {
          resolvedGroupBy = resolveProfileDimension(semanticProfile, message, [resolvedTarget])
            || inferLikelyDimensionColumn(aiHeaders, sampleRows, [resolvedTarget]);
        }
        if (!Number.isFinite(Number(ai?.limit))) ai.limit = 10;
      }
    }
    if (shortYearContextFollowup && !explicitMetricInQuestion) {
      const assistantMetric = extractMetricFromAssistantAnswer(lastAssistantText);
      if (!resolvedTarget && assistantMetric) {
        const fromAssistant = await resolveColumn(aiHeaders, assistantMetric, sampleRows);
        if (fromAssistant) resolvedTarget = fromAssistant;
      }
      if (!resolvedTarget && historyMetricHint) {
        const histResolved = await resolveColumn(aiHeaders, historyMetricHint, sampleRows);
        if (histResolved) resolvedTarget = histResolved;
      }
      resolvedOperation = "sum";
      if (resolvedGroupBy && String(resolvedGroupBy).toLowerCase() === String(resolvedTarget || "").toLowerCase()) {
        resolvedGroupBy = null;
      }
      const histYearMetric = extractMetricHintFromText(lastUserText);
      if (!resolvedTarget && histYearMetric) {
        const histResolved = await resolveColumn(aiHeaders, histYearMetric, sampleRows);
        if (histResolved) resolvedTarget = histResolved;
      }
    }
    if (compareFollowupWithoutYears) {
      if (resolvedOperation === "none" || resolvedOperation === "filter" || resolvedOperation === "sum") {
        resolvedOperation = "year_over_year";
      }
      if (!resolvedTarget) {
        const fromAssistant = extractMetricFromAssistantAnswer(lastAssistantText);
        if (fromAssistant) {
          const resolvedFromAssistant = await resolveColumn(aiHeaders, fromAssistant, sampleRows);
          if (resolvedFromAssistant) resolvedTarget = resolvedFromAssistant;
        }
      }
      if (!resolvedTarget && historyMetricHint) {
        const histResolved = await resolveColumn(aiHeaders, historyMetricHint, sampleRows);
        if (histResolved) resolvedTarget = histResolved;
      }
      if (!resolvedGroupBy) {
        const dateCol = profileDateColumn || aiHeaders.find((h) => /date|period|month|year|дата|період|рік|год/i.test(String(h)));
        if (dateCol) resolvedGroupBy = dateCol;
      }
    }
    if (isShortReasonFollowup(message, chatRuntimeRules) && (resolvedOperation === "none" || resolvedOperation === "filter")) {
      resolvedOperation = "top_n";
      if (!resolvedTarget && historyMetricHint) {
        const histResolved = await resolveColumn(aiHeaders, historyMetricHint, sampleRows);
        if (histResolved) resolvedTarget = histResolved;
      }
      if (!resolvedGroupBy || String(resolvedGroupBy).toLowerCase() === String(resolvedTarget || "").toLowerCase()) {
        resolvedGroupBy = resolveProfileDimension(semanticProfile, message, [resolvedTarget, ai?.target_column, ai?.chart?.value_column])
          || inferLikelyDimensionColumn(aiHeaders, sampleRows, [resolvedTarget]);
      }
      if (!Number.isFinite(Number(ai?.limit))) ai.limit = 5;
    }
    if (allTimeIntent) {
      const filtered = executionFilters.filter((f) => {
        const op = String(f?.operator || "").toLowerCase();
        const col = String(f?.column || "").toLowerCase();
        if (op === "year_equals") return false;
        if ((op === "equals" || op === "contains") && /\byear\b|рік|год/.test(col)) return false;
        return true;
      });
      executionFilters.splice(0, executionFilters.length, ...filtered);
      if (resolvedOperation === "none" || resolvedOperation === "filter" || resolvedOperation === "year_over_year") {
        resolvedOperation = "sum";
      }
      resolvedGroupBy = null;
    }

    const aiProvidedConcretePlan = !!(ai?.operation && ai.operation !== "none");
    if ((resolvedOperation === "none" || aiClarifiedInsteadOfAnswering) && !aiProvidedConcretePlan) {
      const inferredTarget = profileMetric || inferLikelyMetricColumn(aiHeaders, sampleRows, message, [ai?.target_column]);
      const inferredGroupBy = inferredTarget
        ? (resolveProfileDimension(semanticProfile, message, [inferredTarget]) || inferLikelyDimensionColumn(aiHeaders, sampleRows, [inferredTarget]))
        : null;
      const inferredOperation = inferAggregateOperationFromMessage(message, ai, chatRuntimeRules) || (inferredTarget && inferredGroupBy ? "top_n" : (inferredTarget ? "sum" : "count"));
      resolvedOperation = inferredOperation;
      if (!resolvedTarget && inferredTarget) resolvedTarget = inferredTarget;
      if (!resolvedGroupBy && inferredGroupBy && ["top_n", "sum", "avg", "max", "min"].includes(resolvedOperation)) {
        resolvedGroupBy = inferredGroupBy;
      }
      if (!Number.isFinite(Number(ai?.limit)) && resolvedOperation === "top_n") {
        ai.limit = 5;
      }
      if (aiClarifiedInsteadOfAnswering) {
        ai.answer = "";
      }
    }
    if (resolvedOperation === "top_n" && (!resolvedTarget || !resolvedGroupBy)) {
      const inferredTarget = resolvedTarget || profileMetric || inferLikelyMetricColumn(aiHeaders, sampleRows, message, [ai?.target_column, ai?.chart?.value_column]);
      const inferredGroupBy = resolvedGroupBy || (inferredTarget
        ? (resolveProfileDimension(semanticProfile, message, [inferredTarget, ai?.target_column, ai?.chart?.value_column]) || inferLikelyDimensionColumn(aiHeaders, sampleRows, [inferredTarget, ai?.target_column, ai?.chart?.value_column]))
        : null);
      if (!resolvedTarget && inferredTarget) resolvedTarget = inferredTarget;
      if (!resolvedGroupBy && inferredGroupBy) resolvedGroupBy = inferredGroupBy;
      if (!Number.isFinite(Number(ai?.limit))) ai.limit = 5;
    }

    const explicitYear = extractYearToken(message);
    const explicitYearsInPrompt = Array.from(
      String(message || "").matchAll(/\b(19|20)\d{2}\b/g),
      (m) => Number(m?.[0])
    ).filter(Number.isFinite);
    const hasMultiYearPrompt = new Set(explicitYearsInPrompt).size >= 2;
    const explicitComparisonGuard =
      hasMultiYearPrompt ||
      asksExplicitComparisonIntent(message, chatRuntimeRules) ||
      asksDifferenceBetweenYears(message);
    const explicitSingleYearMetricIntent =
      !!explicitYear &&
      !explicitComparisonGuard &&
      /\b(revenue|sales|income|profit|expense|cost|amount|total)\b|выруч|доход|дохід|прибут|расход|витрат/i.test(String(message || "").toLowerCase());
    if (explicitComparisonGuard) {
      if (resolvedOperation === "none" || resolvedOperation === "filter" || resolvedOperation === "sum") {
        resolvedOperation = "year_over_year";
      }
      if (!resolvedGroupBy) {
        const dateCol = profileDateColumn || aiHeaders.find((h) => /date|period|month|year|дата|період|рік|год/i.test(String(h)));
        if (dateCol) resolvedGroupBy = dateCol;
      }
      if (hasMultiYearPrompt) {
        const filtered = executionFilters.filter((f) => String(f?.operator || "").toLowerCase() !== "year_equals");
        executionFilters.splice(0, executionFilters.length, ...filtered);
      }
    }
    if (explicitSingleYearMetricIntent) {
      const hasYearFilter = executionFilters.some((f) => String(f?.operator || "").toLowerCase() === "year_equals");
      if (!hasYearFilter) {
        const dateCol = profileDateColumn || aiHeaders.find((h) => /date|period|month|year|дата|період|рік|год/i.test(String(h)));
        const yearCol = aiHeaders.find((h) => /\byear\b|рік|год/i.test(String(h)));
        if (dateCol) executionFilters.push({ column: dateCol, operator: "year_equals", value: explicitYear });
        else if (yearCol) executionFilters.push({ column: yearCol, operator: "equals", value: explicitYear });
      }
      if (resolvedOperation === "none" || resolvedOperation === "filter" || resolvedOperation === "year_over_year") {
        resolvedOperation = "sum";
      }
      if (resolvedGroupBy && String(resolvedGroupBy).toLowerCase() === String(resolvedTarget || "").toLowerCase()) {
        resolvedGroupBy = null;
      }
    }
    if (explicitYear && !explicitComparisonGuard) {
      const dateCol = profileDateColumn || aiHeaders.find((h) => /date|period|month|year|дата|період|рік|год/i.test(String(h)));
      const hasYearFilter = executionFilters.some((f) => String(f?.operator || "").toLowerCase() === "year_equals");
      if (dateCol && !hasYearFilter) {
        executionFilters.push({ column: dateCol, operator: "year_equals", value: explicitYear });
      }
    }
    if (isDriverRankingQuery(message, chatRuntimeRules) && wantsRevenueIntent(message) && (!resolvedTarget || resolvedOperation === "none")) {
      const metric = findRevenueMetric(aiHeaders) || inferLikelyMetricColumn(aiHeaders, sampleRows, message, ["revenue", "net revenue", "revenue total", "income", "sales"]);
      const dimension = inferLikelyDimensionColumn(aiHeaders, sampleRows, [metric, profileDateColumn, "Date", "Start Date", "End Date"]);
      if (metric && dimension) {
        resolvedOperation = "top_n";
        resolvedTarget = metric;
        resolvedGroupBy = dimension;
        ai.limit = Number.isFinite(Number(ai?.limit)) ? Number(ai.limit) : 1;
        if (explicitYear) {
          const dateCol = profileDateColumn || aiHeaders.find((h) => /date|period|month|year|дата|період|рік|год/i.test(String(h)));
          if (dateCol) {
            executionFilters.push({ column: dateCol, operator: "year_equals", value: explicitYear });
          } else {
            const yearCol = aiHeaders.find((h) => /\byear\b|рік|год/i.test(String(h)));
            if (yearCol) executionFilters.push({ column: yearCol, operator: "equals", value: explicitYear });
          }
        }
      }
    }
    if (asksYoyWithPerYearDriver(message) && wantsRevenueIntent(message)) {
      const metric = findRevenueMetric(aiHeaders) || inferLikelyMetricColumn(aiHeaders, sampleRows, message, ["revenue", "net revenue", "revenue total", "income", "sales"]);
      if (metric) resolvedTarget = metric;
    }
    if (wantsMostProfitableCustomer(message)) {
      const profitMetric = inferLikelyMetricColumn(aiHeaders, sampleRows, message, ["net profit", "profit total", "gross profit", "profit", "margin", "ebitda"]);
      const customerDimension = aiHeaders.find((h) => /\b(customer|client|account)\b/i.test(String(h || "")))
        || inferLikelyDimensionColumn(aiHeaders, sampleRows, [profitMetric, profileDateColumn]);
      if (profitMetric && customerDimension) {
        resolvedOperation = "top_n";
        resolvedTarget = profitMetric;
        resolvedGroupBy = customerDimension;
        if (!Number.isFinite(Number(ai?.limit))) ai.limit = 5;
      }
    }
    if (runtimeRegex(chatRuntimeRules, "driverIntentRegex", CHAT_RUNTIME_RULES_DEFAULTS.driverIntentRegex).test(String(message || "").toLowerCase()) && (resolvedOperation !== "top_n" || !resolvedGroupBy)) {
      resolvedOperation = "top_n";
      if (!resolvedTarget) {
        resolvedTarget = profileMetric || inferLikelyMetricColumn(aiHeaders, sampleRows, message, [ai?.target_column, ai?.chart?.value_column]);
      }
      if (!resolvedGroupBy || String(resolvedGroupBy).toLowerCase() === String(resolvedTarget || "").toLowerCase()) {
        resolvedGroupBy = resolveProfileDimension(semanticProfile, message, [resolvedTarget, ai?.target_column, ai?.chart?.value_column])
          || inferLikelyDimensionColumn(aiHeaders, sampleRows, [resolvedTarget, profileDateColumn]);
      }
      if (!Number.isFinite(Number(ai?.limit))) ai.limit = 5;
    }

    if (["sum", "avg"].includes(resolvedOperation) && resolvedGroupBy && !asksExplicitBreakdown(message, chatRuntimeRules)) {
      resolvedGroupBy = null;
    }

    const targetCategory = classifyColumnMetricCategory(resolvedTarget || "");
    const categoryMismatch = metricIntent && targetCategory && metricIntent !== targetCategory;
    if (categoryMismatch) {
      const fallbackTarget = inferLikelyMetricColumn(aiHeaders, sampleRows, message, [metricIntent]);
      const fallbackCategory = classifyColumnMetricCategory(fallbackTarget || "");
      if (fallbackTarget && (!fallbackCategory || fallbackCategory === metricIntent)) {
        resolvedTarget = fallbackTarget;
      } else {
        return res.status(422).json({
          error: "metric_intent_mismatch",
          message: `Requested ${metricIntent} but selected metric column is ${targetCategory || "unknown"}.`,
        });
      }
    }

    const opNeedsTarget = new Set(["sum", "avg", "max", "min", "top_n"]);
    if (opNeedsTarget.has(resolvedOperation) && !resolvedTarget) {
      const notFoundText = isEnglishLocale(locale)
        ? "I can't find a close matching column for this metric in the current data."
        : (
          (await translateDashboardItems({
            locale,
            items: [{ key: "not_found", text: "I can't find a close matching column for this metric in the current data." }],
            context: "chat-answer",
          }))?.find((item) => item.key === "not_found")?.text
          || "I can't find a close matching column for this metric in the current data."
        );
      return res.json({
        answer: formatAnswerWithBullets(String(notFoundText || "").trim()),
        actions: { reset_filters: false, filters: [], chart: null },
        preview_rows: [],
        meta: { operation: "none", locale, selectedTab, resolvedTarget: null, resolvedGroupBy },
      });
    }
    
    // --- CROSS-TALK SYNTHESIS ---
    if (ai?.cross_talk && Array.isArray(ai.cross_targets) && ai.cross_targets.length >= 2) {
        const allowedSheetIds = new Set(availableFiles.map((f) => String(f.id)));
        const scopedTargets = ai.cross_targets
          .filter((t) => allowedSheetIds.has(String(t?.sheet_id || "")))
          .slice(0, 2);

        if (scopedTargets.length < 2) {
          return res.status(400).json({ error: "invalid_cross_targets" });
        }

        const results = await Promise.all(scopedTargets.map(async (t) => {
            const targetAccess = await loadAccessibleRows(t.sheet_id, req.user, null, 1);
            if (targetAccess?.forbidden) {
                throw new Error("cross_target_forbidden");
            }
            const targetOperation = String(t.operation || "sum").toLowerCase();
            const resolvedCrossColumn = targetOperation === "count"
              ? null
              : await resolveColumn(targetAccess.headers || [], t.column, targetAccess.rows || []);
            if (targetOperation !== "count" && !resolvedCrossColumn) {
                throw new Error("cross_target_column_forbidden");
            }
            const res = await computeSqlAggregation({
                sheetId: t.sheet_id,
                user: req.user,
                operation: targetOperation,
                targetColumn: resolvedCrossColumn,
                rowFiltersList: targetAccess?.rowFiltersList || [],
                allowedColumns: targetAccess?.headers || [],
                locale,
                actualHeaders: targetAccess?.headers || []
            });
            // Extract numeric value from "Total X: $Y" or similar
            const val = res?.answer ? parseFloat(res.answer.replace(/[^\d.-]/g, "")) : 0;
            const fileName = availableFiles.find(f => String(f.id) === String(t.sheet_id))?.name || "Sheet";
            return { value: val, column: resolvedCrossColumn, fileName };
        }));

        const a = results[0];
        const b = results[1];
        const diff = a.value - b.value;
        const pct = b.value !== 0 ? (diff / Math.abs(b.value)) * 100 : 0;
        
        const summary = `${a.fileName} (${a.column}) has ${formatValue(a.value, locale, a.column)}, while ${b.fileName} (${b.column}) has ${formatValue(b.value, locale, b.column)}. \n` +
                        `The difference is ${diff >= 0 ? "+" : ""}${formatValue(diff, locale, a.column)} (${diff >= 0 ? "+" : ""}${pct.toFixed(2)}%).`;
        
        return res.json({
            answer: summary,
            actions: { reset_filters: false, filters: [], chart: null },
            preview_rows: [],
            meta: { operation: "cross_talk", locale, cross_results: results }
        });
    }

    const numericOps = new Set(["count", "sum", "avg", "max", "min", "top_n", "year_over_year"]);
    let exec = null;
    let chart = (["chart", "plot", "trend"].includes(ai?.operation) && ai?.chart) ? {
      dateColumn: await resolveColumn(aiHeaders, ai.chart.date_column, sampleRows),
      valueColumn: await resolveColumn(aiHeaders, ai.chart.value_column, sampleRows),
      segmentBy: await resolveColumn(aiHeaders, ai.chart.segment_by, sampleRows),
      aggregation: ai.chart.aggregation || "sum"
    } : null;

    if (resolvedTarget && ((isCompositeQuery(message) && asksPerYearNotOverall(message)) || asksYoyWithPerYearDriver(message))) {
      try {
        const fullLoad = await loadAccessibleRows(sheetId, req.user, selectedTab);
        const projectedRows = fullLoad?.forbidden ? [] : projectRowsToHeaders(fullLoad.rows || [], aiHeaders);
        const dateCol = profileDateColumn || aiHeaders.find((h) => /date|period|month|year|дата|період|рік|год/i.test(String(h)));
        const allYears = [];
        if (dateCol) {
          for (const r of projectedRows) {
            const d = parseDateValue(r?.[dateCol]);
            if (d) allYears.push(d.getFullYear());
            else {
              const m = String(r?.[dateCol] || "").match(/\b(19\d{2}|20\d{2})\b/);
              if (m) allYears.push(Number(m[1]));
            }
          }
        }
        const uniqueYears = Array.from(new Set(allYears.filter((y) => Number.isFinite(y)))).sort((a,b)=>a-b);
        const trailing = parseTrailingYearsWindow(message);
        const scopedYears = trailing && uniqueYears.length ? uniqueYears.slice(-trailing) : uniqueYears;
        const topDim = resolvedGroupBy || inferLikelyDimensionColumn(aiHeaders, sampleRows, [resolvedTarget, profileDateColumn]);
        const perYearBlocks = [];
        if (topDim && scopedYears.length) {
          for (const y of scopedYears) {
            const yf = [...executionFilters.filter((f) => String(f?.operator || "").toLowerCase() !== "year_equals")];
            if (dateCol) yf.push({ column: dateCol, operator: "year_equals", value: String(y) });
            const topRes = await computeSqlAggregation({
              sheetId,
              user: req.user,
              operation: "top_n",
              targetColumn: resolvedTarget,
              groupBy: topDim,
              filters: yf,
              rowFiltersList: loadedSample?.rowFiltersList || [],
              allowedColumns: aiHeaders || [],
              limit: 5,
              locale,
              tabName: selectedTab,
              actualHeaders: baseHeaders,
            });
            const block = String(topRes?.answer || "").trim();
            if (block && !/no matching data|не найдено|не знайдено/i.test(block)) {
              perYearBlocks.push(`Year ${y}\n${prefixTopListRowsWithYear(block, y)}`);
            }
          }
        }
        let yoyPart = "";
        if (asksQuarterTrendSummary(message)) {
          const yoyRes = await computeSqlAggregation({
            sheetId,
            user: req.user,
            operation: "year_over_year",
            targetColumn: resolvedTarget,
            groupBy: profileDateColumn || resolvedGroupBy,
            filters: executionFilters,
            rowFiltersList: loadedSample?.rowFiltersList || [],
            allowedColumns: aiHeaders || [],
            limit: 5,
            locale,
            tabName: selectedTab,
            actualHeaders: baseHeaders,
          });
          const candidate = String(yoyRes?.answer || "").trim();
          if (candidate && !/no matching data|no data matched|данные не найдены|відповідних даних не знайдено/i.test(candidate)) {
            yoyPart = candidate;
          }
        }
        const parts = [];
        if (perYearBlocks.length) parts.push(perYearBlocks.join("\n\n\n"));
        if (yoyPart) parts.push(yoyPart);
        let compositeAnswer = parts.length ? parts.join("\n\n") : `No driver rows found for years: ${scopedYears.join(", ")}.`;
        if (!isEnglishLocale(locale) && compositeAnswer) {
          const translated = await translateDashboardItems({
            locale,
            items: [{ key: "chat_answer", text: String(compositeAnswer) }],
            context: "chat-answer",
          });
          const translatedText = translated?.find((item) => item.key === "chat_answer")?.text;
          if (typeof translatedText === "string" && translatedText.trim()) compositeAnswer = translatedText.trim();
        }
        compositeAnswer = cleanAITechnicalNoise(compositeAnswer);
        compositeAnswer = stripApproximationWords(compositeAnswer);
        compositeAnswer = normalizeDatesAndRemoveTime(compositeAnswer);
        compositeAnswer = enforceCommaThousands(compositeAnswer);
        compositeAnswer = enforceTwoDecimals(compositeAnswer);
        compositeAnswer = applyAnswerFormatDirectives(compositeAnswer, message);
        compositeAnswer = applyTimeWindowDirectives(compositeAnswer, message);
        compositeAnswer = enforcePerYearTopListSpacing(compositeAnswer);
        return res.json({
          answer: compositeAnswer,
          actions: { reset_filters: false, filters: filteredAiFilters, chart: null },
          preview_rows: [],
          meta: {
            operation: "composite",
            locale,
            selectedTab,
            resolvedTarget,
            resolvedGroupBy: topDim || null,
            trace: {
              message: normalizedMessage,
              composite: true,
              years: scopedYears,
              targetColumn: resolvedTarget || null,
              groupBy: topDim || null,
            },
          },
        });
      } catch {
        // continue normal path
      }
    }

    if (resolvedOperation === "ratio") {
      const fullLoad = await loadAccessibleRows(sheetId, req.user, selectedTab);
      if (fullLoad?.forbidden) {
        return res.status(403).json(aiError("forbidden"));
      }
      const projected = projectRowsToHeaders(fullLoad.rows, aiHeaders);
      const matchedRows = applyFilters(projected, executionFilters);
      const registry = await loadFormulaRegistry().catch(() => null);
      if (registry?.formulas?.length) {
        const intentCode = detectFormulaIntent(message, registry.intents);
        if (intentCode === "METRIC_RUNWAY") {
          const deterministic = computeDeterministicLiquidityRunway(matchedRows);
          if (deterministic) {
            exec = { answer: `Calculated RUNWAY_MONTHS: ${deterministic.RUNWAY_MONTHS}\nLogic Used: CASH_TOTAL / (EXP_OPEX - REV_MONTH)`, previewRows: [] };
          }
        } else if (intentCode === "METRIC_NET_BURN") {
          const deterministic = computeDeterministicLiquidityRunway(matchedRows);
          if (deterministic) {
            const burn = Number(deterministic.NET_BURN || 0);
            const state = burn > 0 ? "Net Loss/Burn" : (burn < 0 ? "Net Profit/Surplus" : "Break-even");
            exec = { answer: `Calculated NET_BURN: ${burn.toFixed(2)} (${state})\nLogic Used: EXP_OPEX - REV_MONTH`, previewRows: [] };
          }
        } else if (intentCode === "FIXED_OPERATING_COSTS" || intentCode === "VARIABLE_EXPENSES") {
          const headers = aiHeaders || [];
          const sumBy = (patterns) => {
            const col = pickHeaderByPatterns(headers, patterns);
            if (!col) return 0;
            return matchedRows.reduce((acc, r) => acc + (toNum(r?.[col]) || 0), 0);
          };
          if (intentCode === "FIXED_OPERATING_COSTS") {
            const v = sumBy([/\bopex\b/i, /operating\s*expenses?/i, /gastos?\s*operativos/i, /операционн(ые|і)\s*расход/i])
              + sumBy([/payroll/i, /nómina/i, /фонд\s*оплаты\s*труда/i, /фонд\s*оплати\s*праці/i])
              + sumBy([/rent/i, /alquiler/i, /аренд/i, /оренд/i]);
            exec = { answer: `Calculated Fixed Operating Costs: ${v.toFixed(2)}\nLogic Used: EXP_OPEX + EXP_PAYROLL + Rent-Expense`, previewRows: [] };
          } else {
            const v = sumBy([/commissions?\s*paid/i, /comisi[oó]n/i, /комисси/i, /комісі/i])
              + sumBy([/cloud\s*infrastructure/i, /infraestructura\s*cloud/i, /облачн.*инфраструктур/i])
              + sumBy([/rev\s*share/i, /participaci[oó]n\s*en\s*ingresos/i, /доля\s*выручки/i, /частка\s*виручки/i]);
            exec = { answer: `Calculated Volume-Based Variable Costs: ${v.toFixed(2)}\nLogic Used: Commissions-Paid + Cloud-Infrastructure-Costs + RevShare`, previewRows: [] };
          }
        } else if (intentCode === "AD_PERFORMANCE") {
          const headers = aiHeaders || [];
          const sumBy = (patterns) => {
            const col = pickHeaderByPatterns(headers, patterns);
            if (!col) return 0;
            return matchedRows.reduce((acc, r) => acc + (toNum(r?.[col]) || 0), 0);
          };
          const rev = sumBy([/revenue/i, /ingresos/i, /выручк/i, /виручк/i]);
          const imps = sumBy([/impressions?/i, /impresiones/i, /показ/i]);
          const delivered = sumBy([/ads?\s*delivered/i, /entregad/i, /доставлен/i]);
          const requested = sumBy([/ads?\s*requested/i, /solicitad/i, /запрошен/i]);
          const ecpm = imps === 0 ? "DIV_ZERO_ERR" : ((rev / imps) * 1000).toFixed(2);
          const fill = requested === 0 ? "DIV_ZERO_ERR" : (delivered / requested).toFixed(2);
          exec = { answer: `Calculated METRIC_ECPM: ${ecpm}; Calculated METRIC_FILL_RATE: ${fill}\nLogic Used: (REV_TOTAL / IMPRESSIONS_TOTAL) * 1000; ADS_DELIVERED / ADS_REQUESTED`, previewRows: [] };
        }
        const aliasText = String(message || "").toLowerCase();
        const aliases = Array.isArray(registry.aliases) ? registry.aliases : [];
        const matchedCodes = new Set(
          aliases
            .filter((a) => aliasText.includes(String(a.alias || "").toLowerCase()))
            .map((a) => String(a.formula_code || ""))
            .filter(Boolean)
        );
        const selectedFormulas = registry.formulas.filter((f) => matchedCodes.has(String(f.code)));
        if (selectedFormulas.length) {
          const keyRows = Array.isArray(registry.keys) ? registry.keys : [];
          const values = {};
          for (const f of selectedFormulas) {
            const fkeys = keyRows.filter((k) => String(k.formula_code) === String(f.code));
            for (const k of fkeys) {
              if (values[k.key_code] != null) continue;
              if (String(k.key_code) === "NET_BURN" && values.NET_BURN != null) continue;
              const header = pickHeaderByPatterns(aiHeaders, k.header_patterns || []);
              if (!header) continue;
              values[k.key_code] = matchedRows.reduce((acc, r) => acc + (toNum(r?.[header]) || 0), 0);
            }
            if (f.code === "NET_BURN" && values.NET_BURN == null) {
              const nb = execFormulaExpression(String(f.expression || ""), values);
              if (nb != null) values.NET_BURN = nb;
            }
          }
          const outputs = [];
          for (const f of selectedFormulas) {
            const denomKey = String(f.denominator_guard_key || "");
            if (denomKey && Number(values[denomKey] || 0) === 0) {
              outputs.push(`${f.code}: DIV_ZERO_ERR`);
              continue;
            }
            const out = execFormulaExpression(String(f.expression || ""), values);
            if (out == null) continue;
            const p = Number.isFinite(Number(f.precision_digits)) ? Number(f.precision_digits) : 2;
            outputs.push(`${f.code}: ${Number(out).toFixed(p)}`);
            values[f.code] = out;
          }
          if (outputs.length) {
            exec = { answer: outputs.join("; "), previewRows: [] };
          }
        }
      }
      if (!exec) {
        const fallbackHint = "To calculate that, should I use [Category A] or [Category B] from the spreadsheet?";
        exec = await computeDeterministicAnswer("ratio", matchedRows, null, null, ai?.limit, locale, message);
        if (!exec?.answer) exec = { answer: fallbackHint, previewRows: [] };
      }
    } else if (numericOps.has(resolvedOperation)) {
        exec = await computeSqlAggregation({
            sheetId,
            user: req.user,
            operation: resolvedOperation,
            targetColumn: resolvedTarget,
            groupBy: resolvedGroupBy,
            filters: executionFilters,
            rowFiltersList: loadedSample?.rowFiltersList || [],
            allowedColumns: aiHeaders || [],
            limit: ai?.limit,
            locale,
            tabName: selectedTab,
            actualHeaders: baseHeaders
        });
    }

    // Fallback to Memory-Based logic for complex operations like YoY or ratios
    if (!exec) {
        // Only NOW load full rows if we really need to (YoY, custom ratios)
        const fullLoad = await loadAccessibleRows(sheetId, req.user, selectedTab);
        if (fullLoad?.tooLarge) {
          const fallback = await computeLargeDatasetAggregateFallback({
            sheetId,
            user: req.user,
            operation: resolvedOperation,
            targetColumn: resolvedTarget,
            groupBy: resolvedGroupBy,
        message: normalizedMessage,
            ai,
            headers: aiHeaders,
            sampleRows,
            activeFilters: activeDashboardFilters,
            rowFiltersList: loadedSample?.rowFiltersList || [],
            tabName: selectedTab,
            locale,
            semanticProfile,
          });
          if (fallback) {
            exec = {
              answer: fallback.answer,
              previewRows: fallback.previewRows || [],
            };
            if (fallback.chart) chart = fallback.chart;
          } else {
            return res.status(413).json({
              error: "chat_dataset_too_large",
              maxRows: CHAT_MAX_ROWS,
              message: "Dataset is too large for this chat analysis path. Narrow filters or use a direct aggregate query.",
            });
          }
        }
        if (!exec) {
          // Note: For memory-based fallback, we might still need augmentation if requested
          const augmented = (resolvedGroupBy === "Year" || resolvedGroupBy === "Month" || resolvedGroupBy === "Quarter")
              ? augmentRowsWithQuarter(
                projectRowsToHeaders(fullLoad.rows, aiHeaders),
                aiHeaders
              )
              : { rows: projectRowsToHeaders(fullLoad.rows, aiHeaders), headers: aiHeaders };

          const matchedRows = applyFilters(augmented.rows, executionFilters);
          exec = await computeDeterministicAnswer(resolvedOperation, matchedRows, resolvedTarget, resolvedGroupBy, ai?.limit, locale, message);
        }
    }


    const isChartOp = ["chart", "plot", "trend"].includes(ai?.operation);
    if (!chart && isChartOp && ai?.chart) {
      chart = {
        dateColumn: await resolveColumn(aiHeaders, ai.chart.date_column, sampleRows),
        valueColumn: await resolveColumn(aiHeaders, ai.chart.value_column, sampleRows),
        segmentBy: await resolveColumn(aiHeaders, ai.chart.segment_by, sampleRows),
        aggregation: ai.chart.aggregation || "sum"
      };
    }

    let answer = ai?.answer || exec.answer || "Done.";
    if (resolvedOperation === "year_over_year" && exec?.answer) {
      answer = exec.answer;
    }
    
    if ((numericOps.has(resolvedOperation) || (resolvedOperation === "filter" && !!resolvedTarget)) && exec.answer) {
        const isGenericNoData = exec.answer.includes("No data matched") || exec.answer.includes("no specific metric column");
        if (isGenericNoData && ai?.answer && ai.answer.length > 5) {
            answer = ai.answer;
        } else if (resolvedOperation === "sum" && explicitSingleYearMetricIntent) {
            const yr = extractYearToken(message);
            const valueMatch = String(exec.answer || "").match(/([-+]?[$]?\d[\d,]*(?:\.\d+)?%?)/);
            const valueText = valueMatch ? valueMatch[1] : String(exec.answer || "");
            answer = await rewriteGroundedScalarAnswer({
              metric: resolvedTarget || ai?.target_column || "value",
              year: yr || "",
              valueText,
              userQuestion: message,
              locale,
              runtime,
            });
        } else {
            answer = exec.answer;
        }
    }

    const noDataAnswer = /no matching data|no data matched|данные не найдены|відповідних даних не знайдено/i.test(String(answer || ""));
    if (noDataAnswer && resolvedTarget && asksDifferenceBetweenYears(message)) {
      try {
        const years = Array.from(
          String(message || "").matchAll(/\b(19\d{2}|20\d{2})\b/g),
          (m) => Number(m?.[0])
        ).filter(Number.isFinite);
        const uniqYears = Array.from(new Set(years));
        if (uniqYears.length >= 2) {
          const y1 = uniqYears[0];
          const y2 = uniqYears[1];
          const dateCol = profileDateColumn || aiHeaders.find((h) => /date|period|month|year|дата|період|рік|год/i.test(String(h)));
          const yearCol = aiHeaders.find((h) => /\byear\b|рік|год/i.test(String(h)));

          const sumForYear = async (yearNum) => {
            if (dateCol) {
              const r = await computeSqlAggregation({
                sheetId,
                user: req.user,
                operation: "sum",
                targetColumn: resolvedTarget,
                groupBy: null,
                filters: [...executionFilters.filter((f) => String(f?.operator || "").toLowerCase() !== "year_equals"), { column: dateCol, operator: "year_equals", value: yearNum }],
                rowFiltersList: loadedSample?.rowFiltersList || [],
                allowedColumns: aiHeaders || [],
                limit: 1,
                locale,
                tabName: selectedTab,
                actualHeaders: baseHeaders,
              });
              return String(r?.answer || "");
            }
            if (yearCol) {
              const r = await computeSqlAggregation({
                sheetId,
                user: req.user,
                operation: "sum",
                targetColumn: resolvedTarget,
                groupBy: null,
                filters: [...executionFilters.filter((f) => String(f?.operator || "").toLowerCase() !== "year_equals"), { column: yearCol, operator: "equals", value: yearNum }],
                rowFiltersList: loadedSample?.rowFiltersList || [],
                allowedColumns: aiHeaders || [],
                limit: 1,
                locale,
                tabName: selectedTab,
                actualHeaders: baseHeaders,
              });
              return String(r?.answer || "");
            }
            return "";
          };

          const parseNumeric = (s) => {
            const m = String(s || "").match(/[-+]?\$?\s*([\d,]+(?:\.\d+)?)/);
            if (!m) return null;
            const n = Number(String(m[1]).replace(/,/g, ""));
            return Number.isFinite(n) ? n : null;
          };

          const a1 = await sumForYear(y1);
          const a2 = await sumForYear(y2);
          const v1 = parseNumeric(a1);
          const v2 = parseNumeric(a2);
          if (v1 !== null && v2 !== null) {
            const delta = v2 - v1;
            const metricLabel = resolvedTarget || "value";
            answer = `Delta ${metricLabel} (${y2} - ${y1}): ${formatNumberForLocale(delta, locale)}`;
          }
        }
      } catch {
        // keep original no-data answer
      }
    }
    if (resolvedTarget && isCompositeQuery(message) && asksPerYearNotOverall(message)) {
      try {
        const fullLoad = await loadAccessibleRows(sheetId, req.user, selectedTab);
        const projectedRows = fullLoad?.forbidden ? [] : projectRowsToHeaders(fullLoad.rows || [], aiHeaders);
        const dateCol = profileDateColumn || aiHeaders.find((h) => /date|period|month|year|дата|період|рік|год/i.test(String(h)));
        const allYears = [];
        if (dateCol) {
          for (const r of projectedRows) {
            const d = parseDateValue(r?.[dateCol]);
            if (d) allYears.push(d.getFullYear());
            else {
              const m = String(r?.[dateCol] || "").match(/\b(19\d{2}|20\d{2})\b/);
              if (m) allYears.push(Number(m[1]));
            }
          }
        }
        const uniqueYears = Array.from(new Set(allYears.filter((y) => Number.isFinite(y)))).sort((a,b)=>a-b);
        const trailing = parseTrailingYearsWindow(message);
        const scopedYears = trailing && uniqueYears.length ? uniqueYears.slice(-trailing) : uniqueYears;

        const yoyRes = await computeSqlAggregation({
          sheetId,
          user: req.user,
          operation: "year_over_year",
          targetColumn: resolvedTarget,
          groupBy: profileDateColumn || resolvedGroupBy,
          filters: executionFilters,
          rowFiltersList: loadedSample?.rowFiltersList || [],
          allowedColumns: aiHeaders || [],
          limit: 5,
          locale,
          tabName: selectedTab,
          actualHeaders: baseHeaders,
        });
        const yoyPart = String(yoyRes?.answer || "").trim();
        const topDim = resolvedGroupBy || inferLikelyDimensionColumn(aiHeaders, sampleRows, [resolvedTarget, profileDateColumn]);
        const perYearBlocks = [];
        if (topDim && scopedYears.length) {
          for (const y of scopedYears) {
            const yf = [...executionFilters.filter((f) => String(f?.operator || "").toLowerCase() !== "year_equals")];
            if (dateCol) yf.push({ column: dateCol, operator: "year_equals", value: String(y) });
            const topRes = await computeSqlAggregation({
              sheetId,
              user: req.user,
              operation: "top_n",
              targetColumn: resolvedTarget,
              groupBy: topDim,
              filters: yf,
              rowFiltersList: loadedSample?.rowFiltersList || [],
              allowedColumns: aiHeaders || [],
              limit: 5,
              locale,
              tabName: selectedTab,
              actualHeaders: baseHeaders,
            });
            const block = String(topRes?.answer || "").trim();
            if (block && !/no matching data|не найдено|не знайдено/i.test(block)) {
              perYearBlocks.push(`${y}\n${prefixTopListRowsWithYear(block, y)}`);
            }
          }
        }
        const parts = [];
        if (yoyPart) parts.push(yoyPart);
        if (perYearBlocks.length) parts.push(perYearBlocks.join("\n\n\n"));
        if (parts.length) answer = parts.join("\n\n");
        else if (scopedYears.length) answer = `No driver rows found for years: ${scopedYears.join(", ")}.`;
      } catch {
        // no-op: keep original answer
      }
    }

    if (noDataAnswer && resolvedTarget) {
      const explicitYear = extractYearToken(message);
      const explicitYearsInPrompt = Array.from(
        String(message || "").matchAll(/\b(19|20)\d{2}\b/g),
        (m) => Number(m?.[0])
      ).filter(Number.isFinite);
      const hasMultiYearPrompt = new Set(explicitYearsInPrompt).size >= 2;
      const asksSingleYearMetric =
        !!explicitYear &&
        !hasMultiYearPrompt &&
        !asksExplicitComparisonIntent(message, chatRuntimeRules) &&
        !asksDifferenceBetweenYears(message) &&
        /\b(revenue|sales|income|profit|expense|cost|amount|total)\b|выруч|доход|дохід|прибут|расход|витрат/i.test(String(message || "").toLowerCase());
      if (asksSingleYearMetric) {
        try {
          const dateCol = profileDateColumn || aiHeaders.find((h) => /date|period|month|year|дата|період|рік|год/i.test(String(h)));
          const yearCol = aiHeaders.find((h) => /\byear\b|рік|год/i.test(String(h)));
          const dateCandidates = [
            dateCol,
            ...["Start Date", "End Date", "Date", "Posting Date", "Effective Date", "Transaction Date", "Closing Date", "Opening Date"]
              .filter((name) => aiHeaders.includes(name)),
            ...aiHeaders.filter((h) => /date|period|month|time|дата|період/i.test(String(h))),
          ].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);

          let retryAnswer = "";
          for (const dc of dateCandidates) {
            const retryFilters = [...executionFilters.filter((f) => String(f?.operator || "").toLowerCase() !== "year_equals")];
            retryFilters.push({ column: dc, operator: "year_equals", value: explicitYear });
            const retry = await computeSqlAggregation({
              sheetId,
              user: req.user,
              operation: "sum",
              targetColumn: resolvedTarget,
              groupBy: null,
              filters: retryFilters,
              rowFiltersList: loadedSample?.rowFiltersList || [],
              allowedColumns: aiHeaders || [],
              limit: 1,
              locale,
              tabName: selectedTab,
              actualHeaders: baseHeaders,
            });
            retryAnswer = String(retry?.answer || "");
            if (!/no matching data|no data matched|данные не найдены|відповідних даних не знайдено|\$0\.00/i.test(retryAnswer)) {
              break;
            }
          }
          if ((!retryAnswer || /no matching data|no data matched|данные не найдены|відповідних даних не знайдено|\$0\.00/i.test(retryAnswer)) && yearCol) {
            const retryFilters = [...executionFilters.filter((f) => String(f?.operator || "").toLowerCase() !== "year_equals")];
            retryFilters.push({ column: yearCol, operator: "equals", value: explicitYear });
            const retry = await computeSqlAggregation({
              sheetId,
              user: req.user,
              operation: "sum",
              targetColumn: resolvedTarget,
              groupBy: null,
              filters: retryFilters,
              rowFiltersList: loadedSample?.rowFiltersList || [],
              allowedColumns: aiHeaders || [],
              limit: 1,
              locale,
              tabName: selectedTab,
              actualHeaders: baseHeaders,
            });
            retryAnswer = String(retry?.answer || retryAnswer);
          }
          const stillNoData = /no matching data|no data matched|данные не найдены|відповідних даних не знайдено/i.test(retryAnswer);
          if (stillNoData) {
            const fullLoad = await loadAccessibleRows(sheetId, req.user, selectedTab);
            if (fullLoad && !fullLoad.forbidden) {
              const projected = projectRowsToHeaders(fullLoad.rows || [], aiHeaders);
              const matched = projected.filter((row) => {
                const yearDirect = String(row?.[yearCol] ?? "").match(/\b(19\d{2}|20\d{2})\b/);
                if (yearDirect && String(yearDirect[1]) === String(explicitYear)) return true;
                return dateCandidates.some((dc) => {
                  const v = row?.[dc];
                  const d = parseDateValue(v);
                  if (d) return String(d.getFullYear()) === String(explicitYear);
                  const y = String(v ?? "").match(/\b(19\d{2}|20\d{2})\b/);
                  return y ? String(y[1]) === String(explicitYear) : false;
                });
              });
              const det = await computeDeterministicAnswer("sum", matched, resolvedTarget, null, 1, locale, message);
              retryAnswer = String(det?.answer || retryAnswer);
            }
          }
          if (retryAnswer && !/no matching data|no data matched|данные не найдены|відповідних даних не знайдено/i.test(retryAnswer)) {
            answer = retryAnswer;
          }
        } catch {
          // no-op: keep original answer
        }
      }
    }


    if (!isEnglishLocale(locale) && answer) {
      const translated = await translateDashboardItems({
        locale,
        items: [{ key: "chat_answer", text: String(answer) }],
        context: "chat-answer",
      });
      const translatedText = translated?.find((item) => item.key === "chat_answer")?.text;
      if (typeof translatedText === "string" && translatedText.trim()) {
        answer = translatedText.trim();
      }
    }

    answer = formatAnswerWithBullets(answer);
    answer = cleanAITechnicalNoise(answer);
    answer = stripApproximationWords(answer);
    answer = normalizeDatesAndRemoveTime(answer);
    answer = enforceCommaThousands(answer);
    answer = enforceTwoDecimals(answer);
    answer = applyAnswerFormatDirectives(answer, message);
    answer = applyTimeWindowDirectives(answer, message);
    answer = enforcePerYearTopListSpacing(answer);

    const yearsDetected = Array.from(
      String(normalizedMessage || "").matchAll(/\b(19\d{2}|20\d{2})\b/g),
      (m) => Number(m?.[0])
    ).filter(Number.isFinite);
    const statusLabel = /no matching data|no data matched|данные не найдены|відповідних даних не знайдено/i.test(String(answer || ""))
      ? "no_data"
      : "ok";
    const detectedIntent = detectIntentLabel(normalizedMessage);
    await recordLearningEvent({
      req,
      sheetId,
      locale,
      message: normalizedMessage,
      answer,
      detectedIntent,
      resolvedMetric: resolvedTarget || null,
      yearsDetected,
      executedOperation: resolvedOperation || ai?.operation || "none",
      fallbackUsed: statusLabel !== "ok",
      status: statusLabel,
      latencyMs: null,
    });
    if (statusLabel !== "ok") {
      await upsertLearningCandidate({
        locale,
        phrase: normalizedMessage,
        suggestedIntent: detectedIntent,
        suggestedPayload: {
          target: resolvedTarget || null,
          operation: resolvedOperation || ai?.operation || "none",
          yearsDetected,
        },
        confidence: 0.7,
      });
    }

    res.json({
      answer,
      actions: { reset_filters: ai?.operation === "reset", filters: filteredAiFilters, chart },
      preview_rows: exec.previewRows || [],
      meta: { 
          operation: ai?.operation || "none", 
          locale, 
          selectedTab, 
          resolvedTarget,
          resolvedGroupBy,
          trace: {
            message: normalizedMessage,
            explicitYear: extractYearToken(normalizedMessage),
            plannedOperation: ai?.operation || "none",
            executedOperation: resolvedOperation || "none",
            targetColumn: resolvedTarget || null,
            groupBy: resolvedGroupBy || null,
            filterCount: Array.isArray(executionFilters) ? executionFilters.length : 0,
          }
      }
    });
  } catch (err) {
    console.error("Chat processing failed:", err);
    try {
      const normalizedMessage = normalizeRelativeYearInMessage(String(req?.body?.message || ""));
      const locale = normalizeLocale(req?.body?.locale || "en");
      await recordLearningEvent({
        req,
        sheetId: req?.body?.sheetId || null,
        locale,
        message: normalizedMessage,
        answer: "",
        detectedIntent: detectIntentLabel(normalizedMessage),
        resolvedMetric: null,
        yearsDetected: Array.from(String(normalizedMessage || "").matchAll(/\b(19\d{2}|20\d{2})\b/g), (m) => Number(m?.[0])).filter(Number.isFinite),
        executedOperation: "none",
        fallbackUsed: true,
        status: "error",
        latencyMs: null,
      });
      await upsertLearningCandidate({
        locale,
        phrase: normalizedMessage,
        suggestedIntent: detectIntentLabel(normalizedMessage),
        suggestedPayload: { status: "error" },
        confidence: 0.6,
      });
    } catch {}
    res.status(500).json({ error: "internal_server_error" });
  }
}

async function loadAccessibleRows(sheetId, user, activeTab = null, rowLimit = null) {
  const sheetRes = await query("SELECT headers, tabs, tab_name, semantic_profile FROM sheets WHERE id = $1", [sheetId]);
  if (!sheetRes.length) return { headers: [], tabs: [], rows: [], rowFiltersList: [], forbidden: true };
  const sheet = sheetRes[0];

  const hasFullAccess = (isPlatformAdminUser(user) || await hasReportSourceOwnerAccess(sheetId, user.id));

  let validCols = null;
  let rowFiltersList = [];

  if (!hasFullAccess) {
    const { allPerms, validCols: loadedCols, rowFiltersList: loadedFilters } = await loadSheetPermissionSets(sheetId, user.id);
    if (!allPerms.length) return { headers: [], tabs: [], rows: [], rowFiltersList: [], forbidden: true };
    rowFiltersList = loadedFilters;
    validCols = loadedCols;
    if (!validCols.length) return { headers: [], tabs: [], rows: [], rowFiltersList: [], forbidden: true };
  }

  // Build the SQL query for efficient retrieval
  let columnSelection = "row_data";
  const params = [sheetId];
  let where = "WHERE sheet_id = $1";

  if (validCols && !hasFullAccess) {
    columnSelection = `(SELECT jsonb_object_agg(key, value) FROM jsonb_each(row_data) WHERE key = ANY($${params.length + 1}::text[]))`;
    params.push(validCols);
  }

  if (activeTab) {
    where += ` AND tab_name = $${params.length + 1}`;
    params.push(activeTab);
  }

  // Apply RBAC row filters in SQL if not full access
  if (!hasFullAccess && rowFiltersList.length > 0) {
    const filterClauses = [];
    rowFiltersList.forEach(filters => {
        const entries = Object.entries(filters).filter(([k]) => !!k);
        if (entries.length > 0) {
            const groupPredicates = entries.map(([k, v]) => {
                params.push(k, String(v));
                return `(row_data->>$${params.length - 1}) = $${params.length}`;
            });
            filterClauses.push(`(${groupPredicates.join(" AND ")})`);
        }
    });
    if (filterClauses.length > 0) {
        where += ` AND (${filterClauses.join(" OR ")})`;
    }
  }

  let sql = `SELECT ${columnSelection} as row_data, tab_name FROM sheet_rows ${where} ORDER BY row_index ASC`;
  const effectiveLimit = rowLimit || (CHAT_MAX_ROWS + 1);
  if (effectiveLimit) {
    sql += ` LIMIT $${params.length + 1}`;
    params.push(effectiveLimit);
  }

  const rawHeaders = sheet.headers;
  let headers = Array.isArray(rawHeaders) ? rawHeaders : (typeof rawHeaders === "string" ? JSON.parse(rawHeaders || "[]") : []);
  const rows = await query(sql, params);
  if (!rowLimit && rows.length > CHAT_MAX_ROWS) {
    return {
      headers,
      tabs: Array.isArray(sheet.tabs) ? sheet.tabs : (sheet.tab_name ? [sheet.tab_name] : []),
      rows: [],
      rowFiltersList,
      allowedColumns: headers,
      semanticProfile: sheet.semantic_profile || {},
      tooLarge: true,
      forbidden: false,
    };
  }

  if (validCols && !hasFullAccess) {
      headers = headers.filter(h => validCols.includes(h));
  }

  return {
    headers,
    tabs: Array.isArray(sheet.tabs) ? sheet.tabs : (sheet.tab_name ? [sheet.tab_name] : []),
    rows: rows.map(r => ({ ...(r.row_data || {}), __tab_name: r.tab_name })),
    rowFiltersList,
    allowedColumns: headers,
    semanticProfile: sheet.semantic_profile || {},
    forbidden: false,
  };
}
function runtimeRegex(rules, key, fallback) {
  try {
    return new RegExp(String(rules?.[key] || fallback), "i");
  } catch {
    return new RegExp(String(fallback), "i");
  }
}
