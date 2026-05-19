export function chatMidHelpersPart3(deps) {
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
  } = deps;

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

function parseYearFollowup(message = "") {
  const s = String(message || "").trim().toLowerCase();
  let m = s.match(/^(only|just|лише|только)\s+(19\d{2}|20\d{2})\??$/);
  if (m) return { kind: "only", year: Number(m[2]) };
  m = s.match(/^(?:(?:in|for|за|у|в)\s+)?(19\d{2}|20\d{2})\??$/);
  if (m) return { kind: "plain", year: Number(m[1]) };
  m = s.match(/^(what about|how about|а как насчет|а як щодо)\s+(19\d{2}|20\d{2})\??$/);
  if (m) return { kind: "what_about", year: Number(m[2]) };
  m = s.match(/^(and|и|та|і)\s+(19\d{2}|20\d{2})\??$/);
  if (m) return { kind: "and", year: Number(m[2]) };
  return { kind: null, year: null };
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

  return {
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
  };
}
