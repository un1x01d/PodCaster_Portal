export function chatPreludeHelpersPart1(deps) {
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
  } = deps;

function parseNumericLoose(value) {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const cleaned = raw.replace(/[^0-9.+-]/g, "");
  if (!cleaned || cleaned === "." || cleaned === "-" || cleaned === "+") return null;
  if (!/^[-+]?\d*\.?\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function sampleTypeStats(rows = [], column = "") {
  const src = Array.isArray(rows) ? rows : [];
  const col = String(column || "").trim();
  const values = src
    .slice(0, 300)
    .map((r) => r?.[col])
    .filter((v) => v !== null && v !== undefined && String(v).trim() !== "");
  const nonEmpty = values.length;
  if (!nonEmpty) return { nonEmpty: 0, numericHits: 0, dateHits: 0, numericRatio: 0, dateRatio: 0 };
  let numericHits = 0;
  let dateHits = 0;
  for (const value of values) {
    if (parseNumericLoose(value) !== null) numericHits += 1;
    if (parseDateValue(value)) dateHits += 1;
  }
  return {
    nonEmpty,
    numericHits,
    dateHits,
    numericRatio: numericHits / nonEmpty,
    dateRatio: dateHits / nonEmpty,
  };
}

function evaluatePredefinedChatCompatibility({ semanticProfile = {}, headers = [], sampleRows = [] }) {
  const headerSet = new Set((Array.isArray(headers) ? headers : []).map((h) => String(h)));
  const defaults = semanticProfile && typeof semanticProfile === "object" ? (semanticProfile.defaults || {}) : {};
  const metricColumns = defaults && typeof defaults === "object" && defaults.metricColumns && typeof defaults.metricColumns === "object"
    ? Object.values(defaults.metricColumns).map((v) => String(v || "").trim()).filter(Boolean)
    : [];
  const dateColumn = String(defaults?.dateColumn || "").trim();

  const presentMetrics = metricColumns.filter((col) => headerSet.has(col));
  const hasDate = !!dateColumn && headerSet.has(dateColumn);
  const hasMetric = presentMetrics.length > 0;

  const reasons = [];
  if (!hasMetric) reasons.push("metric mapping is missing");
  if (!hasDate) reasons.push("date/year mapping is missing");
  if (hasDate) {
    const dateStats = sampleTypeStats(sampleRows, dateColumn);
    if (dateStats.nonEmpty < 5 || dateStats.dateRatio < 0.6) {
      reasons.push("date/year column values are not consistently valid dates");
    }
  }
  if (hasMetric) {
    const metricStats = presentMetrics.map((col) => ({ col, stats: sampleTypeStats(sampleRows, col) }));
    const hasValidMetric = metricStats.some((m) => m.stats.nonEmpty >= 5 && m.stats.numericRatio >= 0.6);
    if (!hasValidMetric) {
      reasons.push("mapped metric columns are not consistently numeric");
    }
  }
  const valueQualityOk = reasons.every((r) => !/consistently/.test(r));

  return {
    compatible: hasMetric && hasDate && valueQualityOk,
    hasMetric,
    hasDate,
    dateColumn: hasDate ? dateColumn : null,
    metricColumns: presentMetrics.slice(0, 4),
    reasons,
  };
}

const LEARNING_DB_RETRY_ATTEMPTS = Math.max(1, Number.parseInt(process.env.LEARNING_DB_RETRY_ATTEMPTS || "3", 10));
const LEARNING_DB_RETRY_BASE_MS = Math.max(5, Number.parseInt(process.env.LEARNING_DB_RETRY_BASE_MS || "40", 10));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withLearningDbRetry(fn, label = "learning_db_op") {
  let lastErr = null;
  for (let attempt = 1; attempt <= LEARNING_DB_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt >= LEARNING_DB_RETRY_ATTEMPTS) break;
      await sleep(LEARNING_DB_RETRY_BASE_MS * attempt);
    }
  }
  console.error(`[learning_persist_failed] op=${label} attempts=${LEARNING_DB_RETRY_ATTEMPTS} error=${String(lastErr?.message || lastErr)}`);
  return null;
}

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

function toRuleFlag(value, fallback = true) {
  if (value === undefined || value === null) return Boolean(fallback);
  if (typeof value === "boolean") return value;
  const s = String(value).trim().toLowerCase();
  if (!s) return Boolean(fallback);
  if (["1", "true", "yes", "on"].includes(s)) return true;
  if (["0", "false", "no", "off"].includes(s)) return false;
  return Boolean(fallback);
}

function recordRuleHit(rule, matched, meta = {}) {
  try {
    if (!AI_DEBUG_LOGS) return;
    console.info("[chat_rule_hit]", {
      rule: String(rule || "unknown"),
      matched: matched === true,
      ...meta,
    });
  } catch {}
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
  const persisted = await withLearningDbRetry(() => query(
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
    ), "record_learning_event");
  if (!persisted) {
    console.warn("[learning_persist] ai_learning_events write failed");
  }
}

function isLearnablePhrase(text = "") {
  const s = String(text || "").trim().toLowerCase();
  if (!s) return false;
  if (s.length < 4) return false;
  if (/^\d+$/.test(s)) return false;
  if (/^[\d\s.,:;!?()\-+/$%]+$/.test(s)) return false;
  const stop = new Set(["ok", "good", "yes", "no", "thanks", "thank you", "done", "fine"]);
  if (stop.has(s)) return false;
  return true;
}

async function upsertLearningCandidate({ locale = "en", phrase = "", suggestedIntent = "unknown", suggestedPayload = {}, confidence = 0.5, bypassSettingsGate = false, forcePending = false }) {
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
  if (!normalizedPhrase || !isLearnablePhrase(normalizedPhrase)) return;
  const rows = await withLearningDbRetry(
    () => query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", ["ai_self_learning_settings"]),
    "load_ai_self_learning_settings"
  );
  if (!rows) {
    console.warn("[learning_persist] unable to load ai self-learning settings");
    return;
  }
  const settings = rows?.[0]?.value && typeof rows[0].value === "object" ? rows[0].value : {};
  if (!bypassSettingsGate && settings?.enabled === false) return;
  const minConfidence = Number(settings?.minConfidence);
  const effectiveMinConfidence = Number.isFinite(minConfidence) ? Math.max(0, Math.min(1, minConfidence)) : 0;
  if (!bypassSettingsGate && Number(confidence || 0) < effectiveMinConfidence) return;

  const persisted = await withLearningDbRetry(async () => {
    const client = await getClient();
    try {
      await client.query("BEGIN");
      const autoApproveAllCandidates = forcePending
        ? false
        : (settings?.autoApproveAllCandidates === true || String(settings?.autoApproveAllCandidates || "").toLowerCase() === "true");
      const nextStatus = autoApproveAllCandidates ? "approved" : "pending";
      const result = await client.query(
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
        const candidateId = result?.rows?.[0]?.id || null;
        if (candidateId) {
          const existing = await client.query(
            `SELECT id FROM ai_learning_rules WHERE locale = $1 AND phrase = $2 AND mapped_intent = $3 LIMIT 1`,
            [String(locale || "en"), normalizedPhrase, String(suggestedIntent || "unknown")]
          );
          if (!existing?.rows?.[0]?.id) {
            const ruleRows = await client.query(
              `INSERT INTO ai_learning_rules
                 (scope, locale, phrase, mapped_intent, mapped_payload, confidence, status, approved_by)
               VALUES ('global', $1, $2, $3, $4::jsonb, 0.9, 'approved', NULL)
               RETURNING id`,
              [String(locale || "en"), normalizedPhrase, String(suggestedIntent || "unknown"), JSON.stringify(suggestedPayload || {})]
            );
            const approvedRuleId = ruleRows?.rows?.[0]?.id || null;
            if (approvedRuleId) {
              await client.query(
                `UPDATE ai_learning_candidates
                 SET approved_rule_id = $2, reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                 WHERE id = $1`,
                [candidateId, approvedRuleId]
              );
              invalidateLearningRulesCache();
            }
          }
        }
      }
      await client.query("COMMIT");
      return true;
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch {}
      throw err;
    } finally {
      client.release();
    }
  }, "upsert_learning_candidate");

  if (!persisted) {
    console.warn("[learning_persist] ai_learning_candidates write failed");
  }
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
      enableTopNHistoryRegex: toRuleFlag(dbCfg?.enableTopNHistoryRegex, CHAT_RUNTIME_RULES_DEFAULTS.enableTopNHistoryRegex),
      enableMoneyHistoryRegex: toRuleFlag(dbCfg?.enableMoneyHistoryRegex, CHAT_RUNTIME_RULES_DEFAULTS.enableMoneyHistoryRegex),
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
  const raw = String(v).trim();
  if (!raw) return null;
  // Skip date-like text and mixed text values; numeric calculations should only use true numeric cells.
  if (
    /^\d{4}[-/]\d{2}[-/]\d{2}$/.test(raw) ||
    /^\d{2}[-/]\d{2}[-/]\d{4}$/.test(raw) ||
    /[a-zA-Z]/.test(raw)
  ) return null;
  const cleaned = raw.replace(/[$,%\s,]/g, "");
  if (!/^[-+]?\d*\.?\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

  return {
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
  };
}
