export function getInsightCacheEntry(cacheMap, cacheKey) {
  const found = cacheMap.get(cacheKey);
  if (!found) return null;
  if (Date.now() > Number(found.expiresAt || 0)) {
    cacheMap.delete(cacheKey);
    return null;
  }
  return found.payload || null;
}

export function setInsightCacheEntry(cacheMap, cacheKey, payload, ttlMs, maxEntries) {
  cacheMap.set(cacheKey, {
    payload,
    expiresAt: Date.now() + ttlMs,
  });
  if (cacheMap.size > maxEntries) {
    const oldest = cacheMap.keys().next().value;
    if (oldest !== undefined) cacheMap.delete(oldest);
  }
}

export function parseBooleanLike(value) {
  if (typeof value === "boolean") return value;
  const normalized = String(value || "").trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
}

export function clampInsightTranslationCacheTtlMs(valueMs) {
  const parsed = Number.parseInt(valueMs, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.min(Math.max(parsed, 60_000), 24 * 60 * 60 * 1000);
}
