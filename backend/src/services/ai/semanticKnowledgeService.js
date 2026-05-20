import { query } from "../../config/db.js";
import { normalizeText } from "./accountingGlossary.js";
import Fuse from "fuse.js";

const SEMANTIC_CACHE_BY_GROUP = new Map();
const CACHE_TTL = 300000; // 5 minutes

function groupCacheKey(groupId = null) {
  const gid = Number.parseInt(String(groupId || ""), 10);
  return Number.isInteger(gid) && gid > 0 ? `group:${gid}` : "global";
}

export function invalidateSemanticKnowledgeCache(groupId = null) {
  if (groupId === null || groupId === undefined) {
    SEMANTIC_CACHE_BY_GROUP.clear();
    return;
  }
  SEMANTIC_CACHE_BY_GROUP.delete(groupCacheKey(groupId));
}

export async function getSemanticKnowledge({ groupId = null } = {}) {
  const cacheKey = groupCacheKey(groupId);
  const now = Date.now();
  const cached = SEMANTIC_CACHE_BY_GROUP.get(cacheKey);
  if (cached && now - Number(cached.ts || 0) < CACHE_TTL) {
    return cached.data;
  }

  try {
    const gid = Number.parseInt(String(groupId || ""), 10);
    const hasGroup = Number.isInteger(gid) && gid > 0;
    const rows = hasGroup
      ? await query(
        `SELECT category, synonym, group_id
           FROM semantic_dictionary
          WHERE (group_id = $1 OR group_id IS NULL)`,
        [gid]
      )
      : await query(
        `SELECT category, synonym, group_id
           FROM semantic_dictionary
          WHERE group_id IS NULL`,
        []
      );
    const map = new Map();
    rows.forEach((r) => {
      const cat = String(r.category || "").toLowerCase();
      if (!map.has(cat)) map.set(cat, new Set());
      // Keep tenant-specific terms first by appending global terms only if absent.
      map.get(cat).add(normalizeText(String(r.synonym || "")));
    });

    const out = {};
    for (const [cat, synonyms] of map.entries()) {
      out[cat] = Array.from(synonyms);
    }

    SEMANTIC_CACHE_BY_GROUP.set(cacheKey, { ts: now, data: out });
    return out;
  } catch (e) {
    console.error("Failed to load semantic knowledge from DB:", e);
    return {};
  }
}

const RULES_CACHE_BY_LOCALE = new Map();

export function invalidateLearningRulesCache() {
  RULES_CACHE_BY_LOCALE.clear();
}

export async function getLearningRules(locale = "en") {
  const localeKey = String(locale || "en").trim().toLowerCase() || "en";
  const now = Date.now();
  const cached = RULES_CACHE_BY_LOCALE.get(localeKey);
  if (cached && now - Number(cached.ts || 0) < CACHE_TTL) {
    return { cache: cached.cache, fuse: cached.fuse };
  }

  try {
    const rows = await query(
      `SELECT phrase, mapped_intent, mapped_payload FROM ai_learning_rules WHERE status = 'approved' AND (locale = $1 OR locale = 'en')`,
      [localeKey]
    );
    const map = new Map();
    const fuseData = [];

    rows.forEach((r) => {
      const p = normalizeText(String(r.phrase || ""));
      if (!p) return;
      const entry = {
        phrase: p,
        intent: r.mapped_intent,
        payload: r.mapped_payload,
      };
      map.set(p, entry);
      fuseData.push(entry);
    });

    const fuse = new Fuse(fuseData, { keys: ["phrase"], threshold: 0.3 });
    RULES_CACHE_BY_LOCALE.set(localeKey, { cache: map, fuse, ts: now });
    return { cache: map, fuse };
  } catch (e) {
    console.error("Failed to load learning rules from DB:", e);
    return { cache: new Map(), fuse: null };
  }
}

export async function checkPhraseOverride(phrase, locale = "en") {
  const { cache, fuse } = await getLearningRules(locale);
  const normalized = normalizeText(String(phrase || ""));
  if (!normalized) return null;
  
  // Exact match first
  if (cache.has(normalized)) return cache.get(normalized);

  // Fuzzy match
  if (fuse) {
    const results = fuse.search(normalized, { limit: 1 });
    if (results.length > 0 && results[0].score < 0.2) {
      return results[0].item;
    }
  }

  return null;
}

/**
 * Record a successful user mapping to potentially learn it as a global synonym.
 */
export async function recordSuccessfulMapping({
  canonicalField,
  synonym,
  locale = "en",
  groupId = null,
  userId = null,
}) {
  if (!canonicalField || !synonym) return;
  const s = normalizeText(synonym);
  if (!s) return;
  const gid = Number.parseInt(String(groupId || ""), 10);
  if (!Number.isInteger(gid) || gid <= 0) return;

  try {
    // Tenant-scoped governed learning: capture candidate only, no auto global approval.
    const result = await query(
      `INSERT INTO ai_learning_candidates
         (group_id, locale, phrase, suggested_intent, suggested_payload, evidence_count, confidence, status, reviewed_by)
       VALUES ($1, $2, $3, 'semantic_synonym', $4::jsonb, 1, 0.8, 'pending', $5)
       ON CONFLICT (group_id, locale, phrase, suggested_intent) WHERE status = 'pending'
       DO UPDATE SET
         evidence_count = ai_learning_candidates.evidence_count + 1,
         confidence = LEAST(1.0, ai_learning_candidates.confidence + 0.05),
         updated_at = CURRENT_TIMESTAMP
       RETURNING evidence_count, confidence, status`,
      [gid, locale, s, JSON.stringify({ canonicalField }), Number(userId) || null]
    );
    return result?.[0] || null;
  } catch (e) {
    console.error("Failed to record successful mapping for learning:", e);
    return null;
  }
}

export async function promoteSemanticCandidate({
  candidateId,
  reviewerUserId,
  promoteToGlobal = false,
  minEvidence = 3,
  minConfidence = 0.9,
}) {
  try {
    const rows = await query(
      `SELECT id, group_id, locale, phrase, suggested_intent, suggested_payload, evidence_count, confidence, status
         FROM ai_learning_candidates
        WHERE id = $1
        LIMIT 1`,
      [Number(candidateId) || 0]
    );
    const candidate = rows?.[0];
    if (!candidate) return { ok: false, error: "candidate_not_found" };
    if (String(candidate.status || "") !== "pending") return { ok: false, error: "candidate_not_pending" };
    if (Number(candidate.evidence_count || 0) < Number(minEvidence || 3)) return { ok: false, error: "insufficient_evidence" };
    if (Number(candidate.confidence || 0) < Number(minConfidence || 0.9)) return { ok: false, error: "insufficient_confidence" };

    const payload = candidate.suggested_payload || {};
    const canonicalField = String(payload?.canonicalField || "").trim();
    if (!canonicalField) return { ok: false, error: "candidate_payload_invalid" };

    const gid = promoteToGlobal ? null : (Number.parseInt(String(candidate.group_id || ""), 10) || null);
    if (!promoteToGlobal && !gid) return { ok: false, error: "group_scope_required" };

    await query(
      `INSERT INTO semantic_dictionary (category, language, synonym, group_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING`,
      [canonicalField, String(candidate.locale || "en"), String(candidate.phrase || ""), gid]
    );

    const ruleRows = await query(
      `INSERT INTO ai_learning_rules
         (scope, group_id, locale, phrase, mapped_intent, mapped_payload, confidence, status, approved_by)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, 'approved', $8)
       RETURNING id`,
      [
        promoteToGlobal ? "global" : "group",
        gid,
        String(candidate.locale || "en"),
        String(candidate.phrase || ""),
        "semantic_synonym",
        JSON.stringify({ canonicalField }),
        Number(candidate.confidence || 0.9),
        Number(reviewerUserId) || null,
      ]
    );
    const approvedRuleId = ruleRows?.[0]?.id || null;

    await query(
      `UPDATE ai_learning_candidates
          SET status = 'approved',
              approved_rule_id = $2,
              reviewed_by = $3,
              reviewed_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1`,
      [candidate.id, approvedRuleId, Number(reviewerUserId) || null]
    );

    invalidateSemanticKnowledgeCache(candidate.group_id || null);
    if (promoteToGlobal) {
      invalidateSemanticKnowledgeCache(null);
    }
    return { ok: true, candidateId: candidate.id, approvedRuleId, scope: promoteToGlobal ? "global" : "group" };
  } catch (e) {
    console.error("Semantic candidate promotion failed:", e);
    return { ok: false, error: "promotion_failed" };
  }
}

export async function rollbackSemanticRule({ ruleId, reviewerUserId = null }) {
  try {
    await query(
      `UPDATE ai_learning_rules
          SET status = 'disabled'
        WHERE id = $1`,
      [Number(ruleId) || 0]
    );
    await query(
      `UPDATE ai_learning_candidates
          SET status = 'rejected',
              reviewed_by = COALESCE($2, reviewed_by),
              reviewed_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
        WHERE approved_rule_id = $1`,
      [Number(ruleId) || 0, Number(reviewerUserId) || null]
    );
    invalidateSemanticKnowledgeCache(null);
    return { ok: true };
  } catch (e) {
    console.error("Semantic rule rollback failed:", e);
    return { ok: false, error: "rollback_failed" };
  }
}
