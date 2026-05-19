export function createChatAudioIntentHelpers(deps) {
  const {
    query,
    writeAuditLog,
    aiError,
    loadEffectiveAiRuntimeSettings,
    reserveAiQueryForSheet,
    resolveAiGroupIdForSheet,
    withLearningDbRetry,
    normalizeLocale,
    invalidateLearningRulesCache,
  } = deps;
async function getChatAudio(req, res) {
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

async function submitChatLearningFeedback(req, res) {
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
    await upsertLearningCandidate({
      locale,
      phrase: question,
      suggestedIntent: "feedback_expected_answer",
      suggestedPayload: {
        expectedAnswer,
        badAnswer,
        sheetId: sheetId || null,
        successfulPlan: successfulPlan || null,
      },
      confidence: 0.9,
      bypassSettingsGate: true,
      forcePending: true,
    });
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

async function synthesizeChatAudioBuffer({ text, locale, runtime = null }) {
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

function asksTwoYearDeltaWithCause(message = "") {
  const s = String(message || "").toLowerCase();
  const years = extractDistinctYearsInOrder(s);
  const hasDelta = /\b(compare|comparison|delta|difference|diff|change|vs|versus|between|how much|higher|lower|gap)\b/.test(s);
  const hasCause = /\b(cause|caused|why|reason|drove|driver|driving|what changed|contributed most|top category)\b/.test(s);
  const hasMetric = /\b(revenue|sales|income|profit|expense|cost|net revenue)\b/.test(s);
  return years.length >= 2 && hasDelta && hasCause && hasMetric;
}

function resolveMetricDisplayLabel({ message = "", targetColumn = "" }) {
  const q = String(message || "").toLowerCase();
  if (/\bnet\s+revenue\b/.test(q)) return "net revenue";
  if (/\brevenue\b/.test(q)) return "revenue";
  if (/\bnet\s+profit\b/.test(q)) return "net profit";
  if (/\bprofit\b/.test(q)) return "profit";
  if (/\bexpense|cost\b/.test(q)) return "expenses";
  const raw = String(targetColumn || "").trim();
  if (!raw) return "value";
  return raw.replace(/[_\s]+/g, " ").trim().toLowerCase();
}

function isTemporalDimensionHeader(header = "") {
  const s = String(header || "").toLowerCase();
  return /\byear\b|date|period|month|quarter|week|day|рік|год|дата|період|місяц|квартал|недел|день/.test(s);
}

function isMetricLikeHeader(header = "") {
  const s = String(header || "").toLowerCase();
  return /\brevenue|sales|income|profit|amount|total|sum|cost|expense|spend|margin|balance|cash|budget|fee|tax|payment|order|qty|quantity|units?\b|выруч|доход|дохід|прибут|расход|витрат/.test(s);
}

function resolveDriverDimensionForDeltaCause({ headers = [], sampleRows = [], targetColumn = "", dateColumn = "", yearColumn = "", preferredGroupBy = "" }) {
  const excluded = [targetColumn, dateColumn, yearColumn].filter(Boolean);
  const preferred = String(preferredGroupBy || "").trim();
  if (preferred && !isTemporalDimensionHeader(preferred) && !isMetricLikeHeader(preferred)) {
    return preferred;
  }
  const inferred = inferLikelyDimensionColumn(headers, sampleRows, excluded);
  if (inferred && !isTemporalDimensionHeader(inferred) && !isMetricLikeHeader(inferred)) {
    return inferred;
  }
  const list = Array.isArray(headers) ? headers : [];
  for (const h of list) {
    const col = String(h || "").trim();
    if (!col) continue;
    if (excluded.includes(col)) continue;
    if (isTemporalDimensionHeader(col)) continue;
    if (isMetricLikeHeader(col)) continue;
    return col;
  }
  return null;
}

function deriveChatIntentPlan({ message = "", normalizedMessage = "", rules = CHAT_RUNTIME_RULES_DEFAULTS }) {
  const raw = String(message || "");
  const normalized = String(normalizedMessage || raw);
  const years = extractDistinctYearsInOrder(raw);
  const explicitComparison = isComparisonIntent(raw, rules);
  const twoYearDeltaCause = asksTwoYearDeltaWithCause(raw);
  const yoyDriverComposite = asksYoyWithPerYearDriver(raw) || (isCompositeQuery(raw) && asksPerYearNotOverall(raw));
  const yearFollowup = parseYearFollowup(normalized);
  const shortYearFollowup = Boolean(yearFollowup.kind);
  return {
    years,
    yearFollowup,
    explicitComparison,
    twoYearDeltaCause,
    yoyDriverComposite,
    shortYearFollowup,
    compareFollowupWithoutYears: asksDifferenceFollowupWithoutYears(normalized, rules),
  };
}

function asksQuarterTrendSummary(message = "") {
  const s = String(message || "").toLowerCase();
  return /\b(quarter|quarterly|qoq|accelerated|declined|decline|growth)\b|квартал|квартально|ускор|упал|зниз|зрост/i.test(s);
}

function asksAllTime(message = "") {
  const s = String(message || "").toLowerCase();
  return /\b(all time|overall|entire period|whole period|across all years|lifetime)\b|за\s+весь\s+період|за\s+весь\s+период|всего\s+за\s+период/i.test(s);
}

function asksIgnoreDashboardFilters(message = "") {
  const s = String(message || "").toLowerCase();
  return /\b(no extra filters|no filters|without filters|ignore filters|clear filters|unfiltered|all rows)\b/.test(s)
    || /без\s+фильтр|без\s+фільтр|без\s+додаткових\s+фільтр/i.test(s);
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

  return {
    getChatAudio,
    submitChatLearningFeedback,
    synthesizeChatAudioToResponse,
    synthesizeChatAudioBuffer,
    isCompositeQuery,
    parseTrailingYearsWindow,
    asksPerYearNotOverall,
    asksYoyWithPerYearDriver,
    asksTwoYearDeltaWithCause,
    resolveMetricDisplayLabel,
    isTemporalDimensionHeader,
    isMetricLikeHeader,
    resolveDriverDimensionForDeltaCause,
    deriveChatIntentPlan,
    asksQuarterTrendSummary,
    asksAllTime,
    asksIgnoreDashboardFilters,
    prefixTopListRowsWithYear,
    enforcePerYearTopListSpacing,
    resolvePendingClarificationForUser,
    resolveDeterministicContextForUser,
  };
}
