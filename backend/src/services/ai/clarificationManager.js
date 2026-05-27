const PENDING = new Map();

function normalize(s) { return String(s || "").trim().toLowerCase(); }

function ordinalToNumber(text) {
  const map = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5 };
  return map[normalize(text).replace(/^the\s+/, "").replace(/\s+one$/, "")] || null;
}

export function clarificationKey({ userId, sheetId }) { return `${Number(userId || 0)}:${String(sheetId || "nosheet")}`; }

export function setPendingClarification(key, payload) { PENDING.set(key, { ...payload, ts: Date.now() }); }
export function clearPendingClarification(key) { PENDING.delete(key); }
export function getPendingClarification(key) { return PENDING.get(key) || null; }

export function resolveClarificationReply(pending, rawReply) {
  if (!pending || !Array.isArray(pending.options) || !pending.options.length) return null;
  const opts = pending.options.map((o, idx) => ({ idx: idx + 1, value: String(o.value || o.label || "").trim() })).filter((o) => o.value);
  const reply = String(rawReply || "").trim();
  if (!reply) return null;
  const n = Number.parseInt((reply.match(/#?\s*(\d+)/) || [])[1] || "", 10);
  if (Number.isInteger(n)) {
    const hit = opts.find((o) => o.idx === n);
    if (hit) return hit.value;
  }
  const ord = ordinalToNumber(reply);
  if (ord) {
    const hit = opts.find((o) => o.idx === ord);
    if (hit) return hit.value;
  }
  const low = normalize(reply);
  const exact = opts.find((o) => normalize(o.value) === low);
  if (exact) return exact.value;
  const includes = opts.find((o) => low.includes(normalize(o.value)) || normalize(o.value).includes(low));
  return includes ? includes.value : null;
}
