import { query } from "../../config/db.js";
import { normalizeText } from "./accountingGlossary.js";
import Fuse from "fuse.js";

let SEMANTIC_CACHE = null;
let CACHE_TS = 0;
const CACHE_TTL = 300000; // 5 minutes

export async function getSemanticKnowledge() {
  const now = Date.now();
  if (SEMANTIC_CACHE && now - CACHE_TS < CACHE_TTL) {
    return SEMANTIC_CACHE;
  }

  try {
    const rows = await query(
      `SELECT category, synonym FROM semantic_dictionary WHERE group_id IS NULL`,
      []
    );
    const map = new Map();
    rows.forEach((r) => {
      const cat = String(r.category || "").toLowerCase();
      if (!map.has(cat)) map.set(cat, new Set());
      map.get(cat).add(normalizeText(r.synonym));
    });

    const out = {};
    for (const [cat, synonyms] of map.entries()) {
      out[cat] = Array.from(synonyms);
    }

    SEMANTIC_CACHE = out;
    CACHE_TS = now;
    return out;
  } catch (e) {
    console.error("Failed to load semantic knowledge from DB:", e);
    return {};
  }
}

let RULES_CACHE = null;
let RULES_FUSE = null;
let RULES_TS = 0;

export async function getLearningRules(locale = "en") {
  const now = Date.now();
  if (RULES_CACHE && now - RULES_TS < CACHE_TTL) {
    return { cache: RULES_CACHE, fuse: RULES_FUSE };
  }

  try {
    const rows = await query(
      `SELECT phrase, mapped_intent, mapped_payload FROM ai_learning_rules WHERE status = 'approved' AND (locale = $1 OR locale = 'en')`,
      [locale]
    );
    const map = new Map();
    const fuseData = [];

    rows.forEach((r) => {
      const p = String(r.phrase || "").toLowerCase();
      const entry = {
        phrase: p,
        intent: r.mapped_intent,
        payload: r.mapped_payload,
      };
      map.set(p, entry);
      fuseData.push(entry);
    });

    RULES_CACHE = map;
    RULES_FUSE = new Fuse(fuseData, { keys: ["phrase"], threshold: 0.3 });
    RULES_TS = now;
    return { cache: map, fuse: RULES_FUSE };
  } catch (e) {
    console.error("Failed to load learning rules from DB:", e);
    return { cache: new Map(), fuse: null };
  }
}

export async function checkPhraseOverride(phrase, locale = "en") {
  const { cache, fuse } = await getLearningRules(locale);
  const normalized = String(phrase || "").toLowerCase().trim();
  
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
export async function recordSuccessfulMapping({ canonicalField, synonym, locale = "en" }) {
  if (!canonicalField || !synonym) return;
  const s = normalizeText(synonym);
  if (!s) return;

  try {
    // Proactive Learning: Upsert into candidates with high evidence
    const result = await query(
      `INSERT INTO ai_learning_candidates
         (locale, phrase, suggested_intent, suggested_payload, evidence_count, confidence, status)
       VALUES ($1, $2, 'semantic_synonym', $3::jsonb, 1, 0.8, 'pending')
       ON CONFLICT (locale, phrase, suggested_intent) WHERE status = 'pending'
       DO UPDATE SET
         evidence_count = ai_learning_candidates.evidence_count + 1,
         confidence = LEAST(1.0, ai_learning_candidates.confidence + 0.05)
       RETURNING evidence_count, confidence, status`,
      [locale, s, JSON.stringify({ canonicalField })]
    );

    // Auto-Approve if evidence is strong (e.g., 3 separate confirmations)
    const candidate = result?.[0];
    if (candidate && candidate.evidence_count >= 3 && candidate.confidence >= 0.9) {
      await autoApproveCandidate(s, 'semantic_synonym', locale);
    }
  } catch (e) {
    console.error("Failed to record successful mapping for learning:", e);
  }
}

async function autoApproveCandidate(phrase, intent, locale) {
  try {
    const rows = await query(
      `SELECT id, suggested_payload FROM ai_learning_candidates 
       WHERE phrase = $1 AND suggested_intent = $2 AND locale = $3 AND status = 'pending' LIMIT 1`,
      [phrase, intent, locale]
    );
    const candidate = rows?.[0];
    if (!candidate) return;

    if (intent === 'semantic_synonym') {
      const payload = candidate.suggested_payload || {};
      if (payload.canonicalField) {
        await query(
          "INSERT INTO semantic_dictionary (category, language, synonym) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
          [payload.canonicalField, locale, phrase]
        );
      }
    }

    await query(
      "UPDATE ai_learning_candidates SET status = 'approved', reviewed_at = CURRENT_TIMESTAMP WHERE id = $1",
      [candidate.id]
    );
    
    // Clear caches to pick up new knowledge
    SEMANTIC_CACHE = null;
    CACHE_TS = 0;
  } catch (e) {
    console.error("Auto-approval failed:", e);
  }
}

