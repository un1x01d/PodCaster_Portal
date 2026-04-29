function toInt(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function parsePagination(query = {}, opts = {}) {
  const maxLimit = Number.isFinite(opts.maxLimit) ? opts.maxLimit : 5000;
  const rawLimit = query.limit;
  const rawOffset = query.offset;

  const limit = rawLimit !== undefined ? toInt(rawLimit, maxLimit) : maxLimit;
  const offset = rawOffset !== undefined ? toInt(rawOffset, 0) : 0;

  if (limit < 1) return { error: "invalid_limit" };
  if (offset < 0) return { error: "invalid_offset" };

  return {
    hasPagination: true,
    limit: Math.min(limit, maxLimit),
    offset,
  };
}
