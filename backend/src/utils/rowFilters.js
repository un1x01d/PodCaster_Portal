export function buildRowFilterWhereClause(rowFiltersList = [], startParamIndex = 1, actualHeaders = []) {
  const normalized = Array.isArray(rowFiltersList) ? rowFiltersList : [];
  const hasAllowAll = normalized.some((f) => !f || Object.keys(f).length === 0);
  if (hasAllowAll) return { sql: "", params: [] };

  const groups = [];
  const params = [];
  let paramIdx = startParamIndex;

  const headersList = Array.isArray(actualHeaders) ? actualHeaders : [];
  const resolveColumnKey = (requested) => {
    if (!headersList.length) return requested;
    const exact = headersList.find((h) => h === requested);
    if (exact) return exact;
    const lowerRequested = String(requested).toLowerCase().trim();
    return headersList.find((h) => String(h).toLowerCase().trim() === lowerRequested) || requested;
  };

  normalized.forEach((filters) => {
    const entries = Object.entries(filters || {}).filter(([k]) => !!k);
    if (!entries.length) return;
    const predicates = entries.map(([k, v]) => {
      const resolvedKey = resolveColumnKey(k);
      params.push(resolvedKey);
      const rawValues = Array.isArray(v)
        ? v.map((item) => String(item ?? "").trim()).filter(Boolean)
        : String(v ?? "").split(",").map((item) => item.trim()).filter(Boolean);
      const normalizedValues = Array.from(
        new Set(
          rawValues.flatMap((value) => {
            if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return [value, value.slice(0, 10)];
            return [value];
          })
        )
      );
      const normalizedTextValues = normalizedValues.map((value) => value.trim().toLowerCase());
      const normalizedNumericValues = Array.from(
        new Set(
          normalizedValues
            .map((value) => String(value).replace(/[^0-9.-]/g, ""))
            .filter((value) => /^-?\d+(?:\.\d+)?$/.test(value))
        )
      );
      params.push(normalizedTextValues);
      params.push(normalizedNumericValues);
      const colSql = `row_data->>$${paramIdx}`;
      const sql = `(
        LOWER(BTRIM(COALESCE(${colSql}, ''))) = ANY($${paramIdx + 1}::text[])
        OR (
          cardinality($${paramIdx + 2}::text[]) > 0
          AND NULLIF(regexp_replace(COALESCE(${colSql}, ''), '[^0-9.-]', '', 'g'), '') IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM unnest($${paramIdx + 2}::text[]) AS fval(value)
            WHERE CAST(NULLIF(regexp_replace(COALESCE(${colSql}, ''), '[^0-9.-]', '', 'g'), '') AS NUMERIC)
              = CAST(fval.value AS NUMERIC)
          )
        )
      )`;
      paramIdx += 3;
      return sql;
    });
    if (predicates.length) groups.push(`(${predicates.join(" AND ")})`);
  });

  if (!groups.length) return { sql: " AND 1 = 0", params };
  return { sql: ` AND (${groups.join(" OR ")})`, params };
}

