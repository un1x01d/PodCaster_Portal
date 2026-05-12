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

export async function resolveField({ canonicalField, headers = [], fieldMetadata = {}, message = "", resolvedMappings = {}, sampleRows = [] }) {
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
  const knowledge = await getSemanticKnowledge();
  const dbAliases = knowledge[canonicalField] || [];
  const hardcodedAliases = ACCOUNTING_HEADER_ALIASES[canonicalField] || [];
  const aliases = Array.from(new Set([...hardcodedAliases, ...dbAliases]));

  const metaHit = fieldMetadata?.[canonicalField];
  if (metaHit && headers.includes(metaHit)) return { status: "resolved", header: metaHit, confidence: 1, method: "metadata", candidates: [] };

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

  const top = unique[0];
  const close = unique.filter((c) => top && Math.abs(c.confidence - top.confidence) <= 0.05);
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
      if (allOptionsPresent) return { status: "ambiguous", header: null, confidence: top?.confidence || 0, method: "term_ambiguity", candidates: unique.slice(0, 4) };
    }
  }

  if (!top) {
    const fallback = identifyContextualFallback({ canonicalField, headers, sampleRows, resolvedMappings });
    if (fallback) return { status: "resolved", header: fallback, confidence: 0.75, method: "semantic_match", candidates: [] };
    return { status: "missing", header: null, confidence: 0, method: "none", candidates: [] };
  }
  if (close.length > 1) return { status: "ambiguous", header: null, confidence: top.confidence, method: "multiple_close", candidates: close.slice(0, 4) };
  if (top.confidence < 0.8) {
    const fallback = identifyContextualFallback({ canonicalField, headers, sampleRows, resolvedMappings });
    if (fallback) return { status: "resolved", header: fallback, confidence: 0.75, method: "semantic_match", candidates: unique.slice(0, 4) };
    return { status: "ask_followup", header: null, confidence: top.confidence, method: top.method, candidates: unique.slice(0, 4) };
  }
  return { status: "resolved", header: top.header, confidence: top.confidence, method: top.method, candidates: unique.slice(0, 4) };
}


