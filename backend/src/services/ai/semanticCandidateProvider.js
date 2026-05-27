import Fuse from "fuse.js";

const CONCEPT_TERMS = {
  revenue: ["revenue", "sales", "income", "turnover", "net revenue", "gross revenue"],
  income: ["income", "profit", "earnings", "net income"],
  profit: ["profit", "margin", "gross profit", "ebitda"],
  expense: ["expense", "cost", "cogs", "opex", "spend"],
  date: ["date", "period", "month", "quarter", "year", "fiscal"],
};

function scoreCandidates(headers = [], terms = []) {
  const items = (Array.isArray(headers) ? headers : []).map((h) => ({ column: String(h || "") })).filter((h) => h.column);
  const fuse = new Fuse(items, { keys: ["column"], includeScore: true, threshold: 0.5 });
  const out = new Map();

  for (const term of terms) {
    const results = fuse.search(term, { limit: 6 });
    for (const r of results) {
      const col = String(r?.item?.column || "").trim();
      if (!col) continue;
      const score = Math.max(0, 1 - Number(r?.score ?? 1));
      const prev = out.get(col);
      if (!prev || score > prev.score) {
        out.set(col, { column: col, score, reason: "header similarity" });
      }
    }
  }

  return Array.from(out.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

export async function buildSemanticCandidateHints({ headers = [], question = "" }) {
  const candidate_sets = [];

  const q = String(question || "").toLowerCase();
  const exactMentions = (Array.isArray(headers) ? headers : [])
    .map((h) => String(h || "").trim())
    .filter(Boolean)
    .filter((h) => q.includes(h.toLowerCase()))
    .map((h) => ({ column: h, score: 1, reason: "exact header mention" }));
  if (exactMentions.length) {
    candidate_sets.push({
      hint: "exact header mentions from question",
      concept_guess: "explicit_header",
      candidates: exactMentions,
    });
  }
  for (const [concept, terms] of Object.entries(CONCEPT_TERMS)) {
    const candidates = scoreCandidates(headers, terms);
    if (candidates.length) {
      candidate_sets.push({
        hint: `possible ${concept}-like columns`,
        concept_guess: concept,
        candidates,
      });
    }
  }
  return { candidate_sets };
}
