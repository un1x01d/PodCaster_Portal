export function chatMidHelpersPart5(deps) {
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
    isComparisonIntent,
    isMetricConfirmationFollowup,
    asksNumberOnlyResponse,
    extractDistinctYearsInOrder,
    mergeRecentYears,
    formatPlainNumber,
    buildHeaderResolutionBlockedMessage,
    buildHeaderExplanationResponse,
    asksDifferenceFollowupWithoutYears,
    deriveDriverIntentFromQuestion,
    isRatioIntent,
    computeDeterministicLiquidityRunway,
    loadFormulaRegistry,
    pickHeaderByPatterns,
    execFormulaExpression,
    detectFormulaIntent,
  } = deps;

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

  return {
    enforceHeaderBoundAiPlan,
    sanitizePromptRows,
    sanitizeConversationHistory,
    normalizeToken,
    resolveTabName,
    inferTabFromMessage,
    findProductLikeColumn,
    buildTabDatasets,
    normalizeSlavicGroupedNumbers,
    expandLargeIntForEnglishSpeech,
    naturalizeNumbersForTTS,
    getSlavicPlural,
    slavicNumberToWords,
    expandFinancialTextPhonetically,
  };
}
