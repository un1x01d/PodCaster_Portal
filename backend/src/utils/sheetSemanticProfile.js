const PROFILE_VERSION = 1;
const SEMANTIC_PROFILE_RULES_SETTINGS_KEY = "semantic_profile_rules";

const DEFAULT_SEMANTIC_PROFILE_RULES = {
  version: 1,
  meanings: {
    revenue: { headerPatterns: ["\\b(revenue|sales|income|turnover|booking|bookings|arr|mrr|gross\\s*sales|net\\s*sales|amount|billed|billing|дохід|доход|выручка|продажи|продажі)\\b"] },
    cost: { headerPatterns: ["\\b(cost|expense|expenses|spend|spent|cogs|opex|витрати|расход|расходы|собівартість)\\b"] },
    profit: { headerPatterns: ["\\b(profit|margin|ebit|ebitda|net\\s*income|earnings|прибуток|прибыль|маржа)\\b"] },
    quantity: { headerPatterns: ["\\b(qty|quantity|units?|count|orders?|volume|кількість|количество|шт)\\b"] },
    customer: { headerPatterns: ["\\b(customer|client|account|buyer|subscriber|клієнт|клиент|покупець|покупатель)\\b"] },
    serviceLine: { headerPatterns: ["\\b(service\\s*line|business\\s*line|practice\\s*area|delivery\\s*model|engagement\\s*type|work\\s*type|offering\\s*type)\\b"] },
    revenueModel: { headerPatterns: ["\\b(revenue\\s*model|billing\\s*model|contract\\s*type|subscription\\s*type)\\b"] },
    product: { headerPatterns: ["\\b(product|item|sku|service|offering|plan|товар|продукт|послуга|услуга|артикул)\\b"] },
    region: { headerPatterns: ["\\b(region|country|state|city|territory|market|location|регіон|регион|країна|страна|місто|город)\\b"] },
    category: { headerPatterns: ["\\b(category|segment|type|class|department|channel|source|vertical|категорія|категория|сегмент|тип|канал|джерело|источник)\\b"] },
    owner: { headerPatterns: ["\\b(owner|manager|rep|salesperson|team|agent|відповідальний|ответственный|менеджер|команда)\\b"] },
    period: { headerPatterns: ["\\b(date|period|year|month|quarter|week|day|дата|період|период|рік|год|місяць|месяц|квартал|тиждень|неделя)\\b"] },
  },
  valueSemantics: {
    revenueModel: {
      recurring: ["\\b(saas|subscription|maintenance|support|managed\\s*service|managed\\s*services|cloud\\s*hosting|hosting|retainer|renewal|recurring|annuity)\\b"],
      project: ["\\b(implementation|professional\\s*services|consulting|strategy|project|migration|deployment|onboarding|setup|integration|one[-\\s]*time|non[-\\s]*recurring)\\b"],
    },
  },
  dimensionPreference: ["serviceLine", "product", "customer", "category", "region", "owner"],
  serviceProviderMeanings: ["serviceLine", "revenueModel"],
};

function trimText(value, max = 120) {
  return String(value ?? "").trim().slice(0, max);
}

function normalizeStringList(value, fallback = [], maxItems = 200) {
  const source = Array.isArray(value) ? value : fallback;
  return Array.from(new Set(source.map((item) => String(item || "").trim()).filter(Boolean))).slice(0, maxItems);
}

export function normalizeSemanticProfileRules(raw = {}) {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const defaultMeanings = DEFAULT_SEMANTIC_PROFILE_RULES.meanings;
  const rawMeanings = src.meanings && typeof src.meanings === "object" && !Array.isArray(src.meanings) ? src.meanings : {};
  const meanings = {};
  Object.keys({ ...defaultMeanings, ...rawMeanings }).forEach((key) => {
    const rawMeaning = rawMeanings[key] && typeof rawMeanings[key] === "object" && !Array.isArray(rawMeanings[key])
      ? rawMeanings[key]
      : {};
    meanings[key] = {
      headerPatterns: normalizeStringList(rawMeaning.headerPatterns, defaultMeanings[key]?.headerPatterns || []),
    };
  });

  const rawValueSemantics = src.valueSemantics && typeof src.valueSemantics === "object" && !Array.isArray(src.valueSemantics)
    ? src.valueSemantics
    : {};
  const defaultRevenueModel = DEFAULT_SEMANTIC_PROFILE_RULES.valueSemantics.revenueModel;
  const rawRevenueModel = rawValueSemantics.revenueModel && typeof rawValueSemantics.revenueModel === "object" && !Array.isArray(rawValueSemantics.revenueModel)
    ? rawValueSemantics.revenueModel
    : {};

  return {
    version: 1,
    meanings,
    valueSemantics: {
      revenueModel: {
        recurring: normalizeStringList(rawRevenueModel.recurring, defaultRevenueModel.recurring),
        project: normalizeStringList(rawRevenueModel.project, defaultRevenueModel.project),
      },
    },
    dimensionPreference: normalizeStringList(src.dimensionPreference, DEFAULT_SEMANTIC_PROFILE_RULES.dimensionPreference, 50),
    serviceProviderMeanings: normalizeStringList(src.serviceProviderMeanings, DEFAULT_SEMANTIC_PROFILE_RULES.serviceProviderMeanings, 20),
  };
}

function compilePatterns(patterns = []) {
  return normalizeStringList(patterns).map((pattern) => {
    try {
      return new RegExp(pattern, "i");
    } catch {
      return null;
    }
  }).filter(Boolean);
}

export async function loadSemanticProfileRules() {
  try {
    const { query } = await import("../config/db.js");
    const rows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [SEMANTIC_PROFILE_RULES_SETTINGS_KEY]);
    return normalizeSemanticProfileRules(rows?.[0]?.value || DEFAULT_SEMANTIC_PROFILE_RULES);
  } catch {
    return normalizeSemanticProfileRules(DEFAULT_SEMANTIC_PROFILE_RULES);
  }
}

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const match = String(value).replace(/,/g, "").match(/[-+]?\d*\.?\d+/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : null;
}

function parseDateValue(value) {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const raw = String(value).trim();
  if (!raw) return null;
  const yearOnly = Number(raw);
  if (Number.isInteger(yearOnly) && yearOnly >= 1900 && yearOnly <= 2200) return new Date(Date.UTC(yearOnly, 0, 1));
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime()) && parsed.getFullYear() >= 1900 && parsed.getFullYear() <= 2200) return parsed;
  const m = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
  if (m) {
    const year = Number(m[3].length === 2 ? `20${m[3]}` : m[3]);
    const month = Number(m[1]) - 1;
    const day = Number(m[2]);
    const d = new Date(Date.UTC(year, month, day));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function uniqueSampleValues(rows, header, limit = 5) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const value = trimText(row?.[header], 80);
    if (!value || seen.has(value.toLowerCase())) continue;
    seen.add(value.toLowerCase());
    out.push(value);
    if (out.length >= limit) break;
  }
  return out;
}

function detectMeanings(header, rules) {
  const name = String(header || "");
  const activeRules = normalizeSemanticProfileRules(rules || DEFAULT_SEMANTIC_PROFILE_RULES);
  return Object.entries(activeRules.meanings || {})
    .filter(([, cfg]) => compilePatterns(cfg?.headerPatterns || []).some((pattern) => pattern.test(name)))
    .map(([meaning]) => meaning);
}

function classifyRevenueModelValues(samples = [], rules) {
  const activeRules = normalizeSemanticProfileRules(rules || DEFAULT_SEMANTIC_PROFILE_RULES);
  const recurringPatterns = compilePatterns(activeRules.valueSemantics?.revenueModel?.recurring || []);
  const projectPatterns = compilePatterns(activeRules.valueSemantics?.revenueModel?.project || []);
  const groups = { recurring: [], project: [] };
  const seen = { recurring: new Set(), project: new Set() };
  for (const value of samples) {
    const text = trimText(value, 80);
    if (!text) continue;
    const key = text.toLowerCase();
    if (recurringPatterns.some((pattern) => pattern.test(text)) && !seen.recurring.has(key)) {
      seen.recurring.add(key);
      groups.recurring.push(text);
    }
    if (projectPatterns.some((pattern) => pattern.test(text)) && !seen.project.has(key)) {
      seen.project.add(key);
      groups.project.push(text);
    }
  }
  return {
    recurring: groups.recurring.slice(0, 20),
    project: groups.project.slice(0, 20),
  };
}

function scoreColumn(header, rows, rules) {
  const activeRules = normalizeSemanticProfileRules(rules || DEFAULT_SEMANTIC_PROFILE_RULES);
  const serviceLinePatterns = compilePatterns(activeRules.meanings?.serviceLine?.headerPatterns || []);
  const periodPatterns = compilePatterns(activeRules.meanings?.period?.headerPatterns || []);
  const samples = rows
    .slice(0, 50)
    .map((row) => row?.[header])
    .filter((value) => value !== null && value !== undefined && String(value).trim() !== "");
  const numericHits = samples.filter((value) => toNum(value) !== null).length;
  const dateHits = samples.filter((value) => parseDateValue(value) !== null).length;
  const uniqueCount = new Set(samples.map((value) => String(value).trim().toLowerCase())).size;
  const stringHits = samples.filter((value) => typeof value === "string" && toNum(value) === null && parseDateValue(value) === null).length;
  const meanings = detectMeanings(header, activeRules);
  const revenueModelValues = classifyRevenueModelValues(samples, activeRules);
  if ((revenueModelValues.recurring.length || revenueModelValues.project.length) && !meanings.includes("revenueModel")) {
    meanings.push("revenueModel");
  }
  if ((serviceLinePatterns.some((pattern) => pattern.test(header)) || meanings.includes("revenueModel")) && !meanings.includes("serviceLine")) {
    meanings.push("serviceLine");
  }
  const roles = [];
  const sampleCount = Math.max(1, samples.length);
  const numericRatio = numericHits / sampleCount;
  const dateRatio = dateHits / sampleCount;
  const uniqueRatio = uniqueCount / sampleCount;
  const name = String(header || "").toLowerCase();

  if (periodPatterns.some((pattern) => pattern.test(name)) || dateRatio >= 0.45) roles.push("date");
  if (numericRatio >= 0.45 && dateRatio < 0.45) roles.push("metric");
  if (numericRatio >= 0.45 && /%|percent|rate|ratio|margin/i.test(name)) roles.push("percent");
  if (numericRatio >= 0.45 && /revenue|sales|income|amount|cost|expense|profit|price|fee|budget|cash|доход|выручка|витрат|расход/i.test(name)) roles.push("currency");
  if (stringHits > 0 && uniqueRatio >= 0.08 && dateRatio < 0.45 && numericRatio < 0.8) roles.push("dimension");
  if (meanings.includes("serviceLine") && !roles.includes("dimension")) roles.push("dimension");
  if (/\b(id|uuid|guid|key|code|number|no\.?|#)\b/i.test(name) && uniqueRatio >= 0.7) roles.push("id");
  if (!roles.length && stringHits > 0) roles.push("dimension");

  const confidence = Math.max(
    meanings.length ? 0.78 : 0,
    roles.includes("date") ? Math.min(0.95, 0.45 + dateRatio) : 0,
    roles.includes("metric") ? Math.min(0.92, 0.35 + numericRatio) : 0,
    roles.includes("dimension") ? Math.min(0.86, 0.35 + uniqueRatio) : 0.35
  );

  return {
    name: String(header),
    roles: Array.from(new Set(roles)),
    meanings,
    confidence: Number(confidence.toFixed(2)),
    stats: {
      sampleCount: samples.length,
      numericHits,
      dateHits,
      uniqueCount,
    },
    sampleValues: uniqueSampleValues(rows, header),
    valueSemantics: {
      revenueModel: revenueModelValues,
    },
  };
}

function bestColumn(columns, predicate, score = () => 0) {
  return [...columns]
    .filter(predicate)
    .sort((a, b) => (score(b) + b.confidence) - (score(a) + a.confidence))[0]?.name || null;
}

function buildDefaults(columns, rules) {
  const activeRules = normalizeSemanticProfileRules(rules || DEFAULT_SEMANTIC_PROFILE_RULES);
  const dimensionPreference = activeRules.dimensionPreference || DEFAULT_SEMANTIC_PROFILE_RULES.dimensionPreference;
  const metrics = columns.filter((col) => col.roles.includes("metric"));
  const dimensions = columns.filter((col) => col.roles.includes("dimension") && !col.roles.includes("id"));
  const meanings = {};
  for (const meaning of ["revenue", "cost", "profit", "quantity"]) {
    meanings[meaning] = bestColumn(metrics, (col) => col.meanings.includes(meaning), (col) => col.roles.includes("currency") ? 0.15 : 0);
  }
  return {
    metricColumns: Object.fromEntries(Object.entries(meanings).filter(([, value]) => !!value)),
    dateColumn: bestColumn(columns, (col) => col.roles.includes("date"), () => 0.1),
    serviceLineColumn: bestColumn(dimensions, (col) => col.meanings.includes("serviceLine"), (col) => col.meanings.includes("revenueModel") ? 0.3 : 0.2),
    revenueModelColumn: bestColumn(dimensions, (col) => col.meanings.includes("revenueModel"), (col) => col.meanings.includes("serviceLine") ? 0.25 : 0.15),
    driverDimensionColumn: bestColumn(dimensions, (col) => col.meanings.some((m) => dimensionPreference.includes(m)), (col) => {
      if (col.meanings.includes("serviceLine")) return 0.35;
      if (col.meanings.includes("product")) return 0.25;
      if (col.meanings.includes("customer")) return 0.2;
      if (col.meanings.includes("category")) return 0.15;
      return 0;
    }) || bestColumn(dimensions, () => true, (col) => Math.min(col.stats.uniqueCount / Math.max(1, col.stats.sampleCount), 1) * 0.2),
    dimensions: dimensions.map((col) => col.name).slice(0, 12),
    metrics: metrics.map((col) => col.name).slice(0, 12),
  };
}

export function buildSheetSemanticProfile({ headers = [], sampleRows = [], previousProfile = null, rules = null } = {}) {
  const activeRules = normalizeSemanticProfileRules(rules || DEFAULT_SEMANTIC_PROFILE_RULES);
  const headerList = Array.isArray(headers) ? headers.filter(Boolean).map(String) : [];
  const rows = Array.isArray(sampleRows) ? sampleRows : [];
  const columns = headerList.map((header) => scoreColumn(header, rows, activeRules));
  const learned = previousProfile && typeof previousProfile === "object" && !Array.isArray(previousProfile)
    ? (previousProfile.learned || {})
    : {};
  const defaults = { ...buildDefaults(columns, activeRules), ...(learned.defaults || {}) };
  return {
    version: PROFILE_VERSION,
    status: "generated",
    generatedAt: new Date().toISOString(),
    defaults,
    columns,
    learned,
  };
}

export function getSemanticProfileColumn(profile, name) {
  const target = String(name || "").trim().toLowerCase();
  if (!target) return null;
  return (Array.isArray(profile?.columns) ? profile.columns : []).find((col) => String(col?.name || "").trim().toLowerCase() === target) || null;
}

export function resolveProfileMetric(profile, message = "", candidates = []) {
  const defaults = profile?.defaults || {};
  const msg = String(message || "").toLowerCase();
  const byMeaning = [
    [/revenue|sales|income|turnover|booking|arr|mrr|brought|generated|доход|выручка|продаж/i, "revenue"],
    [/profit|margin|earnings|прибут|прибыл/i, "profit"],
    [/cost|expense|spend|витрат|расход/i, "cost"],
    [/qty|quantity|units?|orders?|volume|кількість|количество/i, "quantity"],
  ].find(([pattern]) => pattern.test(msg))?.[1];
  const candidateList = [
    ...(Array.isArray(candidates) ? candidates : []),
    byMeaning ? defaults.metricColumns?.[byMeaning] : null,
    defaults.metricColumns?.revenue,
    ...(Array.isArray(defaults.metrics) ? defaults.metrics : []),
  ].filter(Boolean);
  for (const candidate of candidateList) {
    const col = getSemanticProfileColumn(profile, candidate);
    if (col?.roles?.includes("metric")) return col.name;
  }
  return null;
}

export function resolveProfileDimension(profile, message = "", excluded = []) {
  const excludedSet = new Set((Array.isArray(excluded) ? excluded : []).map((value) => String(value || "").trim().toLowerCase()).filter(Boolean));
  const defaults = profile?.defaults || {};
  const msg = String(message || "").toLowerCase();
  const meaningPreference = [
    [/product|item|sku|service|товар|продукт|послуга|услуга/i, "product"],
    [/service\s*line|delivery\s*model|operating\s*model|revenue\s*model|recurring|one[-\s]*time|implementation|maintenance|subscription|saas|annuity|project/i, "serviceLine"],
    [/customer|client|account|buyer|клієнт|клиент|покуп/i, "customer"],
    [/region|country|state|city|market|location|регіон|регион|країна|страна|місто|город/i, "region"],
    [/category|segment|type|channel|source|категор|сегмент|канал|джерело|источник/i, "category"],
    [/owner|manager|rep|team|agent|менеджер|команда|відповідальний|ответственный/i, "owner"],
  ].find(([pattern]) => pattern.test(msg))?.[1];
  const preferred = meaningPreference
    ? defaults.dimensions?.find((name) => getSemanticProfileColumn(profile, name)?.meanings?.includes(meaningPreference))
    : null;
  const candidateList = [
    preferred,
    defaults.serviceLineColumn,
    defaults.revenueModelColumn,
    defaults.driverDimensionColumn,
    ...(Array.isArray(defaults.dimensions) ? defaults.dimensions : []),
  ].filter(Boolean);
  for (const candidate of candidateList) {
    if (excludedSet.has(String(candidate).toLowerCase())) continue;
    const col = getSemanticProfileColumn(profile, candidate);
    if (col?.roles?.includes("dimension")) return col.name;
  }
  return null;
}

export function resolveProfileDateColumn(profile, candidates = []) {
  const defaults = profile?.defaults || {};
  const candidateList = [...(Array.isArray(candidates) ? candidates : []), defaults.dateColumn].filter(Boolean);
  for (const candidate of candidateList) {
    const col = getSemanticProfileColumn(profile, candidate);
    if (col?.roles?.includes("date")) return col.name;
  }
  return null;
}

export function mergeSheetSemanticProfileLearning(profile = {}, patch = {}) {
  const current = profile && typeof profile === "object" && !Array.isArray(profile) ? profile : {};
  const defaultsPatch = patch?.defaults && typeof patch.defaults === "object" && !Array.isArray(patch.defaults) ? patch.defaults : {};
  const next = {
    ...current,
    version: PROFILE_VERSION,
    status: "learned",
    learnedAt: new Date().toISOString(),
    defaults: {
      ...(current.defaults || {}),
      ...defaultsPatch,
    },
    learned: {
      ...(current.learned || {}),
      defaults: {
        ...((current.learned || {}).defaults || {}),
        ...defaultsPatch,
      },
      notes: trimText(patch?.notes || (current.learned || {}).notes || "", 500),
    },
  };
  return next;
}

export {
  DEFAULT_SEMANTIC_PROFILE_RULES,
  SEMANTIC_PROFILE_RULES_SETTINGS_KEY,
};
