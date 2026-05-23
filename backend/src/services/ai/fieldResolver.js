import Fuse from "fuse.js";
import { ACCOUNTING_HEADER_ALIASES, buildNormalizedHeaderMap, normalizeHeaderName } from "./accountingHeaderDictionary.js";
import { detectAmbiguousAccountingWords } from "./accountingGlossary.js";
import { getSemanticKnowledge } from "./semanticKnowledgeService.js";

function fuzzyCandidates(headers = [], aliases = []) {
  const data = headers.map((h) => ({ header: h, normalized: normalizeHeaderName(h) }));
  const fuse = new Fuse(data, { keys: ["normalized"], includeScore: true, threshold: 0.25 });
  const out = [];
  aliases.forEach((alias) => {
    const res = fuse.search(normalizeHeaderName(alias), { limit: 4 });
    res.forEach((r) => {
      const confidence = 1 - Number(r.score ?? 1);
      if (confidence >= 0.8) out.push({ header: r.item.header, confidence: Math.min(0.92, confidence), method: "fuzzy" });
    });
  });
  return out;
}

function toNumberOrNull(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const cleaned = text.replace(/[$,%\s,]/g, "");
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

function buildColumnProfile(header, sampleRows = []) {
  const values = (Array.isArray(sampleRows) ? sampleRows : []).slice(0, 500).map((r) => r?.[header]);
  let nonEmpty = 0;
  let numeric = 0;
  let negative = 0;
  let zero = 0;
  let dateLike = 0;
  const nums = [];
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (!text) continue;
    nonEmpty += 1;
    const parsedDate = new Date(text);
    if (!Number.isNaN(parsedDate.getTime())) dateLike += 1;
    const n = toNumberOrNull(value);
    if (n === null) continue;
    numeric += 1;
    nums.push(n);
    if (n < 0) negative += 1;
    if (n === 0) zero += 1;
  }
  const absAvg = nums.length ? (nums.reduce((a, b) => a + Math.abs(b), 0) / nums.length) : 0;
  return {
    nonEmpty,
    numericRatio: nonEmpty > 0 ? (numeric / nonEmpty) : 0,
    dateRatio: nonEmpty > 0 ? (dateLike / nonEmpty) : 0,
    negativeRatio: numeric > 0 ? (negative / numeric) : 0,
    zeroRatio: numeric > 0 ? (zero / numeric) : 0,
    absAvg,
  };
}

function semanticSignalForField(canonicalField, header = "") {
  const low = String(header || "").toLowerCase();
  if (!low) return 0;
  if (canonicalField === "date") {
    return /\bdate|period|month|year|quarter|fiscal|posting\b/.test(low) ? 1 : 0;
  }
  if (canonicalField === "total_revenue") {
    if (/\bnet income|net profit|profit\b/.test(low)) return 0;
    return /\brevenue|sales|turnover|billings|top line|top-line\b/.test(low) ? 1 : 0;
  }
  if (canonicalField === "net_income") {
    return /\bnet income|net profit|profit|earnings\b/.test(low) ? 1 : 0;
  }
  const include = {
    total_revenue: /\brevenue|sales|turnover|gmv\b/,
    net_revenue: /\bnet revenue|net sales|revenue net\b/,
    total_expense: /\bexpense|cost|opex|spend|payroll\b/,
    net_income: /\bnet income|net profit|profit|earnings\b/,
    gross_profit: /\bgross profit|gp\b/,
    cogs: /\bcogs|cost of goods|cost of sales\b/,
    ar_balance: /\bar|accounts receivable\b/,
    ap_balance: /\bap|accounts payable\b/,
  };
  const avoid = {
    total_revenue: /\bexpense|cost|opex|payroll\b/,
    total_expense: /\brevenue|sales|income\b/,
  };
  let score = include[canonicalField]?.test(low) ? 1 : 0;
  if (avoid[canonicalField]?.test(low)) score = Math.max(0, score - 0.6);
  if (canonicalField === "total_expense" && /\b(marketing|ad|ads|campaign|promo)\b/.test(low) && !/\b(total|overall|all)\b/.test(low)) {
    score = Math.max(0, score - 0.35);
  }
  return score;
}

function distributionSignalForField(canonicalField, profile = {}) {
  const numeric = Number(profile?.numericRatio || 0);
  const dateRatio = Number(profile?.dateRatio || 0);
  const absAvg = Number(profile?.absAvg || 0);
  if (canonicalField === "date") {
    if (dateRatio >= 0.6) return 1;
    if (dateRatio >= 0.3) return 0.8;
    return 0.4;
  }
  if (numeric < 0.1) return 0.1;
  if (canonicalField === "total_revenue" || canonicalField === "total_expense" || canonicalField === "net_income" || canonicalField === "gross_profit") {
    if (absAvg > 1000000) return 0.95;
    if (absAvg > 1000) return 0.85;
    if (absAvg > 10) return 0.75;
    return 0.55;
  }
  return 0.65;
}

function signSignalForField(canonicalField, profile = {}) {
  const neg = Number(profile?.negativeRatio || 0);
  if (canonicalField === "total_expense") return neg > 0.4 ? 1 : 0.65;
  if (canonicalField === "total_revenue") return neg < 0.2 ? 1 : 0.5;
  if (canonicalField === "net_income" || canonicalField === "gross_profit") return neg < 0.5 ? 0.8 : 0.5;
  return 0.7;
}

function scoreCandidate({ canonicalField, candidate, sampleRows }) {
  const profile = buildColumnProfile(candidate.header, sampleRows);
  const lexical = Math.max(0, Math.min(1, Number(candidate.confidence || 0)));
  const semantic = semanticSignalForField(canonicalField, candidate.header);
  const distribution = distributionSignalForField(canonicalField, profile);
  const sign = signSignalForField(canonicalField, profile);
  const score = (lexical * 0.5) + (semantic * 0.3) + (distribution * 0.12) + (sign * 0.08);
  return {
    ...candidate,
    confidence: Math.max(0, Math.min(1, score)),
    signals: {
      lexical,
      semantic,
      distribution,
      sign,
      profile,
    },
  };
}

function identifyContextualFallback({ canonicalField, headers, sampleRows, resolvedMappings = {} }) {
  const numericalCols = headers.filter(h => {
    const vals = (Array.isArray(sampleRows) ? sampleRows : []).map(r => r[h]);
    const numericHits = vals.filter(v => {
      if (v === null || v === undefined || String(v).trim() === "") return false;
      return /^[-+]?\d*\.?\d+$/.test(String(v).replace(/[$,\s%]/g, ""));
    }).length;
    return numericHits > (vals.length * 0.3); // Conservative threshold
  }).filter(h => !Object.values(resolvedMappings).includes(h));

  if (!numericalCols.length) return null;

  const resolvedValues = Object.values(resolvedMappings).map(v => String(v).toLowerCase());
  const context = {
    revenueCount: resolvedValues.filter(v => /\brevenue|sales|income|gain|gpr\b/i.test(v)).length,
    expenseCount: resolvedValues.filter(v => /\bexpense|cost|opex|spend|loss|fuel|tax\b/i.test(v)).length
  };

  // Map to closest logical key based on industry context
  if (canonicalField === "total_revenue" && context.revenueCount > 0) return numericalCols[0];
  if (canonicalField === "total_expense" && context.expenseCount > 0) return numericalCols[0];
  
  return null;
}

export async function resolveField({ canonicalField, headers = [], fieldMetadata = {}, message = "", resolvedMappings = {}, sampleRows = [], groupId = null }) {
  const mappingState = fieldMetadata?.mappingState || {};
  const approved = Array.isArray(mappingState.approved) ? mappingState.approved : [];
  const corrected = Array.isArray(mappingState.corrected) ? mappingState.corrected : [];
  const rejected = Array.isArray(mappingState.rejected) ? mappingState.rejected : [];
  const rejectedHeaders = new Set(rejected.filter((m) => String(m?.canonicalField || "") === String(canonicalField)).map((m) => String(m?.header || "")));

  const approvedHits = approved.filter((m) => String(m?.canonicalField || "") === String(canonicalField) && headers.includes(m?.header));
  if (approvedHits.length === 1) return { status: "resolved", header: approvedHits[0].header, confidence: 1, method: "user_approved", candidates: [] };
  if (approvedHits.length > 1) return { status: "ambiguous", header: null, confidence: 1, method: "approved_conflict", candidates: approvedHits.map((m) => ({ header: m.header, confidence: 1, method: "user_approved" })) };

  const correctedHits = corrected.filter((m) => String(m?.canonicalField || "") === String(canonicalField) && headers.includes(m?.header));
  if (correctedHits.length === 1) return { status: "resolved", header: correctedHits[0].header, confidence: 1, method: "user_corrected", candidates: [] };
  if (correctedHits.length > 1) return { status: "ambiguous", header: null, confidence: 1, method: "corrected_conflict", candidates: correctedHits.map((m) => ({ header: m.header, confidence: 1, method: "user_corrected" })) };

  const candidates = [];
  const normalizedMap = buildNormalizedHeaderMap(headers);
  
  // Merge hardcoded aliases with DB knowledge
  const knowledge = await getSemanticKnowledge({ groupId });
  const dbAliases = knowledge[canonicalField] || [];
  const hardcodedAliases = ACCOUNTING_HEADER_ALIASES[canonicalField] || [];
  const aliases = Array.from(new Set([...hardcodedAliases, ...dbAliases]));

  const metaHitRaw = fieldMetadata?.[canonicalField];
  if (metaHitRaw) {
    const metaHit = headers.find((h) => String(h || "").trim() === String(metaHitRaw || "").trim())
      || headers.find((h) => String(h || "").trim().toLowerCase() === String(metaHitRaw || "").trim().toLowerCase())
      || null;
    if (metaHit) return { status: "resolved", header: String(metaHit), confidence: 1, method: "metadata", candidates: [] };
  }

  // Canonical priority shortcuts reduce false ambiguity for common finance intents.
  if (canonicalField === "net_income") {
    const direct = headers.find((h) => /\bnet\s*(income|profit)\b/i.test(String(h || "")));
    if (direct) return { status: "resolved", header: String(direct), confidence: 0.99, method: "canonical_priority", candidates: [] };
  }

  aliases.forEach((alias) => {
    const nAlias = normalizeHeaderName(alias);
    if (normalizedMap.has(nAlias)) candidates.push({ header: normalizedMap.get(nAlias), confidence: 0.98, method: "exact_synonym" });
  });

  if (!candidates.length) {
    headers.forEach((header) => {
      const nh = normalizeHeaderName(header);
      aliases.forEach((alias) => {
        const na = normalizeHeaderName(alias);
        if (nh === na) candidates.push({ header, confidence: 0.95, method: "normalized" });
      });
    });
  }

  if (!candidates.length) candidates.push(...fuzzyCandidates(headers, aliases));

  // Phrasing Boost: If the user explicitly mentioned one of the headers in their question, 
  // and that header is a candidate, boost it to resolution.
  const msgLower = String(message || "").toLowerCase();
  const mentionedHeader = headers.find(h => msgLower.includes(String(h).toLowerCase()));
  if (mentionedHeader) {
    const isCandidate = candidates.some(c => c.header === mentionedHeader) ||
                        aliases.some(a => normalizeHeaderName(a) === normalizeHeaderName(mentionedHeader));
    if (isCandidate) {
      return { status: "resolved", header: mentionedHeader, confidence: 1, method: "phrasing_boost", candidates: [] };
    }
  }

  const unique = Array.from(new Map(candidates.map((c) => [c.header, c])).values())

    .filter((c) => !rejectedHeaders.has(String(c.header)))
    .sort((a, b) => b.confidence - a.confidence);

  const scored = unique.map((c) => scoreCandidate({ canonicalField, candidate: c, sampleRows }))
    .sort((a, b) => b.confidence - a.confidence);
  const top = scored[0];
  const second = scored[1] || null;
  const ambiguityDelta = top && second ? Math.abs(Number(top.confidence) - Number(second.confidence)) : 1;
  const close = scored.filter((c) => top && Math.abs(c.confidence - top.confidence) <= 0.05);
  const msgAmbiguities = detectAmbiguousAccountingWords(message);

  if (msgAmbiguities.length) {
    const normalizedHeaders = headers.map((h) => normalizeHeaderName(h));
    const hasAliasHit = (field) => {
      const opts = Array.from(new Set([...(ACCOUNTING_HEADER_ALIASES[field] || []), ...(knowledge[field] || [])]));
      return opts.some((alias) => normalizedHeaders.includes(normalizeHeaderName(alias)));
    };
    for (const ambiguity of msgAmbiguities) {
      if (!ambiguity.options.includes(canonicalField)) continue;
      const allOptionsPresent = ambiguity.options.every((opt) => hasAliasHit(opt));
      if (allOptionsPresent) return { status: "ambiguous", header: null, confidence: top?.confidence || 0, ambiguityDelta, method: "term_ambiguity", candidates: scored.slice(0, 4) };
    }
  }

  if (!top) {
    const fallback = identifyContextualFallback({ canonicalField, headers, sampleRows, resolvedMappings });
    if (fallback) return { status: "resolved", header: fallback, confidence: 0.75, method: "semantic_match", candidates: scored.slice(0, 4) };
    return { status: "missing", header: null, confidence: 0, method: "none", candidates: [] };
  }
  if (close.length > 1) return { status: "ambiguous", header: null, confidence: top.confidence, ambiguityDelta, method: "multiple_close", candidates: close.slice(0, 4) };
  const minConfidence = canonicalField === "date" ? 0.55 : 0.8;
  if (top.confidence < minConfidence) {
    const fallback = identifyContextualFallback({ canonicalField, headers, sampleRows, resolvedMappings });
    if (fallback) return { status: "resolved", header: fallback, confidence: 0.75, method: "semantic_match", candidates: scored.slice(0, 4) };
    return { status: "ask_followup", header: null, confidence: top.confidence, ambiguityDelta, method: top.method, candidates: scored.slice(0, 4) };
  }
  return { status: "resolved", header: top.header, confidence: top.confidence, ambiguityDelta, method: top.method, candidates: scored.slice(0, 4) };
}
