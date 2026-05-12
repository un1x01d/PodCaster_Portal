import { resolveMetricHeaders } from "./headerResolver.js";

function normalizeMetric(metricRequested = "") {
  const key = String(metricRequested || "").trim().toLowerCase();
  if (!key) return null;
  const aliases = {
    total_revenue: "total_revenue",
    revenue: "total_revenue",
    sales: "total_revenue",
    "net revenue": "net_revenue",
    "total revenue": "total_revenue",

    total_expense: "total_expense",
    expense: "total_expense",
    expenses: "total_expense",
    cost: "total_expense",
    net_income: "net_income",
    "net income": "net_income",
    profit: "net_income",
    "net profit": "net_income",
    gross_profit: "gross_profit",
    "gross profit": "gross_profit",
    cogs: "cogs",
    gross_margin_pct: "gross_margin_pct",
    "gross margin": "gross_margin_pct",
    margin: "gross_margin_pct",
    ar_balance: "ar_balance",
    "accounts receivable": "ar_balance",
    ar: "ar_balance",
    ap_balance: "ap_balance",
    "accounts payable": "ap_balance",
    ap: "ap_balance",
    cash: "cash",
    cash_out: "cash_out",
    burn: "cash_out",
    "burn rate": "cash_out",
    trucking_rpm: "trucking_rpm",
    rpm: "trucking_rpm",
    fuel_efficiency: "fuel_efficiency",
    mpg: "fuel_efficiency",
    mfg_unit_cost: "mfg_unit_cost",
    "unit cost": "mfg_unit_cost",
    inventory_turnover: "inventory_turnover",
    re_noi: "re_noi",
    noi: "re_noi",
    re_cap_rate: "re_cap_rate",
    "cap rate": "re_cap_rate",
    runway_months: "runway_months",
    runway: "runway_months",
    retail_sell_thru: "retail_sell_thru",
    "sell thru": "retail_sell_thru",
    ar_dso: "ar_dso",
    dso: "ar_dso",
  };
  return aliases[key] || null;
}


function detectMetricFromMessage(message = "", headers = []) {
  const s = String(message || "").toLowerCase();

  if (/\bgross\s*profit\b/.test(s)) return "gross_profit";
  if (/\bnet\s*revenue\b/.test(s)) return "net_revenue";
  if (/\b(gross\s*marg(?:in|ing)|margin)\b/.test(s)) return "gross_margin_pct";

  if (/\bnet\s*income\b|\bnet\s*profit\b/.test(s)) return "net_income";
  if (/\bprofit\b/.test(s)) return "net_income";
  if (/\brevenue\b|\bsales\b/.test(s)) return "total_revenue";
  if (/\bincome\b/.test(s)) return "total_revenue";
  if (/\bexpense\b|\bexpenses\b|\bcost\b|\bopex\b/.test(s)) return "total_expense";

  if (/\b(ar|accounts\s*receivable)\b/.test(s)) return "ar_balance";
  if (/\b(ap|accounts\s*payable)\b/.test(s)) return "ap_balance";
  if (/\bcash\b/.test(s)) return "cash";
  if (/\bburn\b/.test(s)) return "cash_out";
  return null;
}


function detectRankingIntent(message = "") {
  return /\b(top\s*\d+|top|highest|biggest|largest|most)\b/i.test(String(message || ""));
}

function detectRankingDirection(message = "") {
  const s = String(message || "");
  if (/\b(bottom\s*\d+|bottom|lowest|smallest|least)\b/i.test(s)) return "asc";
  return "desc";
}

function parseTopLimit(message = "", fallback = 1) {
  const m = String(message || "").match(/\btop\s*(\d+)\b/i);
  const n = Number(m?.[1] || fallback);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 50) : fallback;
}

function asksForYearRanking(message = "") {
  return /\byear\b/i.test(String(message || ""));
}

function detectDriverIntent(message = "") {
  const s = String(message || "").toLowerCase();
  return /\b(driver|drove|contributor|contribution|what drove|why did)\b/.test(s)
    || (/\b(increase|growth|grew|up|decline|decrease|drop|fell|down)\b/.test(s) && /\b(what|which|who)\b/.test(s));
}

function detectDriverDirection(message = "") {
  const s = String(message || "").toLowerCase();
  if (/\b(decline|decrease|drop|fell|down|reduction)\b/.test(s)) return "decline";
  return "growth";
}

function pickHeaderByKeywords(headers = [], keywords = []) {
  const list = Array.isArray(headers) ? headers : [];
  const lower = list.map((h) => ({ raw: h, low: String(h || "").toLowerCase() }));
  for (const kw of keywords) {
    const exact = lower.find((h) => h.low === kw);
    if (exact) return String(exact.raw);
    const contains = lower.find((h) => h.low.includes(kw));
    if (contains) return String(contains.raw);
  }
  return null;
}

function resolveDimensionHeader(message = "", headers = []) {
  const s = String(message || "").toLowerCase();
  const map = [
    { test: /\baccount\b/, keys: ["account"] },
    { test: /\bcustomer|client\b/, keys: ["customer", "client"] },
    { test: /\bdepartment\b/, keys: ["department"] },
    { test: /\bregion|territory\b/, keys: ["region", "territory"] },
    { test: /\bchannel\b/, keys: ["channel"] },
  ];
  for (const rule of map) {
    if (!rule.test.test(s)) continue;
    const header = pickHeaderByKeywords(headers, rule.keys);
    if (header) return header;
  }
  return pickHeaderByKeywords(headers, ["account", "customer", "department", "region", "channel"]);
}

function resolveValueHeader(message = "", headers = []) {
  const s = String(message || "").toLowerCase();
  if (/\bgross\s*profit|profit\b/.test(s)) {
    return pickHeaderByKeywords(headers, ["gross profit", "net income", "profit"]);
  }
  if (/\brevenue|sales|income\b/.test(s)) {
    return pickHeaderByKeywords(headers, ["revenue", "sales", "income"]);
  }
  if (/\bexpense|expenses|cost|opex\b/.test(s)) {
    return pickHeaderByKeywords(headers, ["expense", "cost", "opex"]);
  }
  return pickHeaderByKeywords(headers, ["revenue", "gross profit", "net income", "expense"]);
}

function hasExplicitMetricInMessage(message = "") {
  return /\brevenue|sales|income|profit|margin|expense|expenses|cost|opex\b/i.test(String(message || ""));
}

function listLikelyMetricOptions(headers = [], limit = 5) {
  const list = (Array.isArray(headers) ? headers : []).filter((h) =>
    /\brevenue\b|\bsales\b|\bincome\b|\bprofit\b|\bmargin\b|\bexpense\b|\bcost\b|\bopex\b|\bamount\b|\bvalue\b/i.test(String(h))
  );
  return Array.from(new Set(list.map((h) => String(h)))).slice(0, limit);
}

function recommendHeadersForMissing(headers = [], missingRequired = []) {
  const list = (Array.isArray(headers) ? headers : []).map((h) => String(h));
  const wants = new Set((Array.isArray(missingRequired) ? missingRequired : []).map((m) => String(m).toLowerCase()));
  const scored = list.map((h) => {
    const low = h.toLowerCase();
    let score = 0;
    if (wants.has("cogs") && /\bcogs\b|cost of goods sold|cost of sales|direct cost|cost\b/.test(low)) score += 10;
    if (wants.has("total_revenue") && /\brevenue\b|\bsales\b|\bincome\b/.test(low)) score += 10;
    if (wants.has("total_expense") && /\bexpense\b|\bcost\b|\bopex\b/.test(low)) score += 10;
    if (wants.has("net_income") && /\bnet\s*income\b|\bnet\s*profit\b|\bincome\b/.test(low)) score += 10;
    if (wants.has("date") && /date|period|month|year|quarter|start|end/.test(low)) score += 8;
    return { h, score };
  });
  const ranked = scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score).map((x) => x.h);
  if (ranked.length) return Array.from(new Set(ranked)).slice(0, 6);
  return list.slice(0, 6);
}

function makeClarification(reason, question, options = []) {
  return {
    ok: false,
    reason,
    clarification_needed: true,
    clarification_question: String(question || "").trim(),
    clarification_options: Array.isArray(options) ? options.map((o) => String(o)).filter(Boolean).slice(0, 6) : [],
  };
}

function mapSemanticMeaningToCanonical(meaning = "") {
  const m = String(meaning || "").trim();
  const map = {
    revenue: "total_revenue",
    cost: "total_expense",
    profit: "net_income",
    period: "date",
    customer: "customer",
    region: "region",
    category: "category",
    owner: "account",
    serviceLine: "department",
    revenueModel: "category",
    product: "category",
  };
  return map[m] || null;
}

function buildFieldMetadataFromSemanticProfile(semanticProfile = {}) {
  const out = { mappingState: { approved: [], corrected: [], rejected: [] } };
  const learned = Array.isArray(semanticProfile?.learned?.header_understanding) ? semanticProfile.learned.header_understanding : [];
  for (const row of learned) {
    const header = String(row?.header || "").trim();
    if (!header) continue;
    const canonicalField = mapSemanticMeaningToCanonical(row?.meaning);
    if (canonicalField) {
      out[canonicalField] = out[canonicalField] || header;
      out.mappingState.approved.push({ canonicalField, header });
    }
    if (String(row?.role || "").toLowerCase() === "date") {
      out.date = out.date || header;
      out.mappingState.approved.push({ canonicalField: "date", header });
    }
  }
  return out;
}

function extractYears(message = "") {
  const years = Array.from(String(message || "").matchAll(/\b(19\d{2}|20\d{2})\b/g), (m) => Number(m?.[0])).filter(Number.isFinite);
  return Array.from(new Set(years));
}

function isYoyIntent(message = "") {
  return /\b(yoy|year over year|year-over-year|annual growth|yearly growth|г\/г|р\/р|год к году|рік до року)\b/i.test(String(message || ""));
}

function parseDate(v) {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v;
  const raw = String(v).trim();
  if (!raw) return null;
  if (/^\d{4}$/.test(raw)) {
    const y = Number(raw);
    if (y >= 1900 && y <= 2200) return new Date(Date.UTC(y, 0, 1));
  }
  const n = Number(raw);
  if (Number.isFinite(n) && n > 25569 && n < 60000) {
    const ms = (n - 25569) * 86400 * 1000;
    const d = new Date(Date.UTC(1970, 0, 1) + ms);
    if (!Number.isNaN(d.getTime())) return d;
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isDurationLikeHeader(header = "") {
  return /\b(months?|days?|duration|term|tenor|age|retainer)\b/i.test(String(header || ""));
}

function listLikelyDateHeaders(headers = [], limit = 6) {
  return (Array.isArray(headers) ? headers : [])
    .filter((h) => /date|period|month|year|quarter|start|end|дата|період|год|рік/i.test(String(h)))
    .filter((h) => !isDurationLikeHeader(h))
    .slice(0, limit)
    .map((h) => String(h));
}

function findBestDateHeader(headers = [], sampleRows = [], targetYears = []) {
  const hinted = listLikelyDateHeaders(headers, 100);
  const candidates = hinted.length ? hinted : headers;
  if (!candidates.length) return null;
  const rows = Array.isArray(sampleRows) ? sampleRows.slice(0, 400) : [];
  let best = null;
  for (const col of candidates) {
    let valid = 0;
    let hits = 0;
    for (const row of rows) {
      const d = parseDate(row?.[col]);
      if (!d) continue;
      valid += 1;
      if (!targetYears.length || targetYears.includes(d.getFullYear())) hits += 1;
    }
    const nameBoost = /date|period|month|year|quarter|start|end|дата|період|год|рік/i.test(String(col)) ? 25 : 0;
    const penalty = isDurationLikeHeader(col) ? 40 : 0;
    const score = hits * 10 + valid + nameBoost - penalty;
    if (!best || score > best.score) best = { col, score, valid, hits };
  }
  if (!best || best.valid === 0) return null;
  return best.col;
}

function inferLatestTwoYearsFromColumn(sampleRows = [], dateHeader = "") {
  const years = new Set();
  for (const row of (Array.isArray(sampleRows) ? sampleRows : [])) {
    const d = parseDate(row?.[dateHeader]);
    if (!d) continue;
    const y = Number(d.getFullYear());
    if (Number.isFinite(y) && y >= 1900 && y <= 2200) years.add(y);
  }
  const sorted = Array.from(years).sort((a, b) => b - a);
  return sorted.length >= 2 ? [sorted[1], sorted[0]] : [];
}

function detectProjectionIntent(message = "") {
  return /(project|projection|forecast|predict|prediction|outlook|forward|expected|expecting|estimate|estimation)/i.test(String(message || ""));
}


export async function buildDeterministicSpreadsheetPlan({
  message = "",
  accountingIntent = {},
  headers = [],
  semanticProfile = {},
  sampleRows = [],
  hints = {},
  context = {},
}) {
  const fieldMetadata = {
    ...(semanticProfile?.headerMappings || {}),
    ...buildFieldMetadataFromSemanticProfile(semanticProfile),
  };
  const hintedCanonical = String(hints?.headerCanonical || "").trim();
  const hintedHeaderChoice = String(hints?.headerChoice || "").trim();
  if (hintedCanonical && hintedHeaderChoice && headers.includes(hintedHeaderChoice)) {
    fieldMetadata[hintedCanonical] = hintedHeaderChoice;
  }

  const contextMetric = normalizeMetric(context?.lastMetric || "") || detectMetricFromMessage(String(context?.lastMetric || ""), headers);

  const contextYears = Array.isArray(context?.lastYears) ? context.lastYears.map((y) => Number(y)).filter(Number.isFinite) : [];
  const causeFollowup = /\b(what caused it|what caused this|what caused that|what caused|what drove it|what drove this|why|reason)\b/i.test(String(message || ""));

  const projectionIntent = detectProjectionIntent(message) || accountingIntent?.intent === "projection";

  const rankingIntent = detectRankingIntent(message);
  if (rankingIntent) {
    const yearRanking = asksForYearRanking(message);
    if (yearRanking) {
      const valueHeader = resolveValueHeader(message, headers);
      if (!valueHeader) {
        const opts = listLikelyMetricOptions(headers);
        return makeClarification(
          "metric_unresolved",
          "I can answer that, but I need one clarification first. Which metric should I use for year ranking?",
          opts.length ? opts : ["Revenue", "Gross Profit", "Net Income", "Expense"]
        );
      }
      const dateHeader = String(hints?.dateHeader || "").trim() || findBestDateHeader(headers, sampleRows, []);
      if (!dateHeader) {
        return makeClarification(
          "date_unresolved",
          "I can answer that, but I need one clarification first. Which column should I use as the date/year field?",
          listLikelyDateHeaders(headers)
        );
      }
      return {
        ok: true,
        operation: "top_n_by_year",
        dateHeader,
        valueHeader,
        limit: parseTopLimit(message, 1),
        direction: detectRankingDirection(message),
      };
    }
    const dimensionHeader = resolveDimensionHeader(message, headers);
    const hasExplicitMetric = /\brevenue|sales|income|profit|margin|expense|cost|opex\b/i.test(String(message || ""));
    const metricFromHint = normalizeMetric(hints?.metric || "");
    const valueHeader = resolveValueHeader(message, headers) || (metricFromHint ? resolveValueHeader(metricFromHint, headers) : null);
    
    if (!dimensionHeader) {
      return makeClarification(
        "dimension_unresolved",
        "I can answer that, but I need one clarification first. Which grouping should I rank?",
        ["Account", "Customer", "Department", "Region"]
      );
    }
    if (!metricFromHint && (!hasExplicitMetric || !valueHeader)) {
      const opts = listLikelyMetricOptions(headers)
        .sort((a, b) => {
          const pa = /profit|margin/i.test(a) ? 0 : 1;
          const pb = /profit|margin/i.test(b) ? 0 : 1;
          return pa - pb;
        });
      return makeClarification(
        "metric_unresolved",
        `I can answer that, but I need one clarification first. Top ${dimensionHeader} by which metric?`,
        opts.length ? opts : ["Revenue", "Gross Profit", "Net Income", "Expense"]
      );
    }

    return {
      ok: true,
      operation: "top_n_by_dimension",
      metric: metricFromHint || detectMetricFromMessage(message, headers) || "total_revenue",
      dimensionHeader,
      valueHeader,
      limit: parseTopLimit(message, 1),
      direction: detectRankingDirection(message),
      accountOnly: /\bonly\b/i.test(String(message || "")),
    };

  }

  const driverIntent = detectDriverIntent(message);
  if (driverIntent || causeFollowup) {
    const years = extractYears(message);
    const resolvedYears = years.length === 1 ? years : (contextYears.length >= 2 ? [Math.max(...contextYears)] : years);
    if (years.length !== 1) {
      if (!resolvedYears.length) {
        return makeClarification(
          "driver_year_unresolved",
          "I can answer that, but I need one clarification first. Which year should I analyze drivers for?"
        );
      }
    }
    const explicitMetric = hasExplicitMetricInMessage(message);
    const valueHeader = explicitMetric
      ? (resolveValueHeader(message, headers) || resolveValueHeader(String(context?.lastMetric || ""), headers))
      : (resolveValueHeader(String(context?.lastMetric || ""), headers) || resolveValueHeader(message, headers));
    if (!valueHeader) {
      return makeClarification(
        "metric_unresolved",
        "I can answer that, but I need one clarification first. Which metric should I use for the driver analysis?",
        listLikelyMetricOptions(headers)
      );
    }
    const dimensionHeader = resolveDimensionHeader(message, headers);
    if (!dimensionHeader) {
      return makeClarification(
        "dimension_unresolved",
        "I can answer that, but I need one clarification first. Which grouping should I use for driver analysis?",
        ["Account", "Customer", "Department", "Region", "Channel"]
      );
    }
    const dateHeader = String(hints?.dateHeader || "").trim() || findBestDateHeader(headers, sampleRows, years);
    if (!dateHeader) {
      return makeClarification(
        "date_unresolved",
        "I can answer that, but I need one clarification first. Which column should I use as the date/year field?",
        listLikelyDateHeaders(headers)
      );
    }
    return {
      ok: true,
      operation: "driver_year_change",
      metric: explicitMetric ? detectMetricFromMessage(message, headers) : (normalizeMetric(String(context?.lastMetric || "")) || "total_revenue"),
      year: Number(resolvedYears[0]),
      direction: detectDriverDirection(message),
      dateHeader,
      dimensionHeader,
      valueHeader,
      limit: 1,
    };

  }

  const hintedMetric = normalizeMetric(hints?.metric || "") || detectMetricFromMessage(String(hints?.metric || ""), headers);
  const explicitMetricFromMessage = detectMetricFromMessage(message, headers);
  const metric = explicitMetricFromMessage || hintedMetric || contextMetric || normalizeMetric(accountingIntent?.metric_requested || "");
  if (!metric) {
    const opts = listLikelyMetricOptions(headers)
      .sort((a, b) => {
        const pa = /\bprofit|margin\b/i.test(a) ? 0 : 1;
        const pb = /\bprofit|margin\b/i.test(b) ? 0 : 1;
        return pa - pb;
      });
    return makeClarification(
      "metric_unresolved",
      "I can answer that, but I need one clarification first. Which metric should I calculate?",
      opts.length ? opts : ["Revenue", "Gross Profit", "Net Income", "Expense"]
    );
  }

  const years = extractYears(message);
  const currentYear = new Date().getFullYear();
  const targetYear = years.find((y) => y > currentYear) || (projectionIntent ? years.find(y => y === currentYear) : null);

  if (projectionIntent || (targetYear && targetYear > currentYear)) {
    const finalTargetYear = targetYear || years[0] || (currentYear + 1);

    const dateHeader = String(hints?.dateHeader || "").trim() || findBestDateHeader(headers, sampleRows, years);
    if (!dateHeader) {
      return makeClarification(
        "date_unresolved",
        "I can build a projection, but I need to know which column to use as the date/year field first.",
        listLikelyDateHeaders(headers)
      );
      }

      const resolution = await resolveMetricHeaders({
      metricKey: metric,
      headers,
      fieldMetadata,
      message,
      sampleRows,
      });

    if (resolution?.missingRequired?.length) {
      const first = resolution.missingRequired[0];
      const out = makeClarification(
        "missing_required_headers",
        `I can build a projection, but I’m missing required fields: ${resolution.missingRequired.join(", ")}. Which available column should map to these?`,
        recommendHeadersForMissing(headers, resolution.missingRequired)
      );
      out.clarification_field = String(first || "").trim() || null;
      return out;
    }


    return {
      ok: true,
      operation: "metric_projection",
      metric,
      targetYear: Number(finalTargetYear),
      dateHeader,
      resolution,
    };
  }


  const period = accountingIntent?.period_requested || (years.length === 1 ? years[0] : null);

  const yoy = isYoyIntent(message);
  const isTwoYearDelta = /\b(delta|difference|diff|between|vs|versus|change)\b/i.test(String(message || "")) && years.length >= 2;
  const dateNeeded = !!period || !!accountingIntent?.comparison_period || isTwoYearDelta || yoy;

  const resolution = await resolveMetricHeaders({
    metricKey: metric,
    headers,
    fieldMetadata,
    message,
    sampleRows,
  });



  if (dateNeeded && !resolution?.resolvedMappings?.date && !resolution?.optionalMappings?.date) {
    const guessedDate = String(hints?.dateHeader || "").trim() || findBestDateHeader(headers, sampleRows, years);
    if (guessedDate) {
      resolution.optionalMappings = { ...(resolution.optionalMappings || {}), date: guessedDate };
    }
  }

  if (resolution?.missingRequired?.length) {
    const first = resolution.missingRequired[0];
    const out = makeClarification(
      "missing_required_headers",
      `I can answer that, but I need one clarification first. I’m missing required fields: ${resolution.missingRequired.join(", ")}. Which available column should map to these?`,
      recommendHeadersForMissing(headers, resolution.missingRequired)
    );
    out.clarification_field = String(first || "").trim() || null;
    return out;
  }

  if (resolution?.ambiguous?.length) {
    const first = resolution.ambiguous[0];
    const candidates = (first?.candidates || []).map((c) => c.header).filter(Boolean);
    const out = makeClarification(
      "ambiguous_headers",
      `I can answer that, but I need one clarification first. Which column should I use for ${first?.canonicalField || "this field"}?`,
      candidates
    );
    out.clarification_field = String(first?.canonicalField || "").trim() || null;
    return out;
  }
  if (dateNeeded && !resolution?.resolvedMappings?.date && !resolution?.optionalMappings?.date) {
    return makeClarification(
      "date_unresolved",
      "I can answer that, but I need one clarification first. Which column should I use as the date/year field?",
      listLikelyDateHeaders(headers)
    );
  }
  const resolvedDate = resolution?.resolvedMappings?.date || resolution?.optionalMappings?.date || null;
  const yearsForComparison = years.length >= 2
    ? [years[0], years[1]]
    : (isTwoYearDelta && resolvedDate ? inferLatestTwoYearsFromColumn(sampleRows, resolvedDate) : []);
  if (isTwoYearDelta && yearsForComparison.length < 2) {
    return makeClarification(
      "comparison_years_unresolved",
      "I can answer that, but I need one clarification first. Which two years should I compare?"
    );
  }
  if (yoy && !resolvedDate) {
    return makeClarification(
      "date_unresolved",
      "I can answer that, but I need one clarification first. Which column should I use as the date/year field for year-over-year?",
      listLikelyDateHeaders(headers)
    );
  }

  return {
    ok: true,
    metric,
    operation: yoy ? "yoy_series" : (isTwoYearDelta ? "two_year_delta" : "single_period"),
    years: yearsForComparison.length ? yearsForComparison : years,
    period,
    comparisonPeriod: accountingIntent?.comparison_period || null,
    resolution,
  };
}
