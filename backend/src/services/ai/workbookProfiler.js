function isIsoDateLike(v) {
  const s = String(v ?? "").trim();
  if (!s) return false;
  const d = new Date(s);
  return !Number.isNaN(d.getTime());
}

function toNumber(v) {
  const s = String(v ?? "").trim().replace(/[$,%\s,]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function guessType(stats) {
  if (stats.dateLikeRatio >= 0.6) return "date";
  if (stats.numberLikeRatio >= 0.6) return "number";
  return "category";
}

function collectSampleIndices(totalRows = 0) {
  const n = Number(totalRows || 0);
  if (!Number.isFinite(n) || n <= 0) return [];
  const idx = new Set([0, Math.max(0, n - 1)]);

  // Broad distributed sample cap.
  const distributedStep = Math.max(1, Math.floor(n / 300));
  for (let i = 0; i < n; i += distributedStep) idx.add(i);

  // Explicit stride check for temporal coverage on large sheets.
  if (n > 900) {
    for (let i = 0; i < n; i += 30) idx.add(i);
  }

  return Array.from(idx).sort((a, b) => a - b);
}

function collectColumnValues(rows = [], col = "") {
  const src = Array.isArray(rows) ? rows : [];
  const indices = collectSampleIndices(src.length);
  const vals = [];
  for (const i of indices) {
    const v = src[i]?.[col];
    if (v !== null && v !== undefined && String(v).trim() !== "") vals.push(v);
    if (vals.length >= 5000) break;
  }
  return vals;
}

export function buildWorkbookProfile({ workbookId = "sheet", sheetId = "sheet", sheetName = "Sheet", headers = [], rows = [], allowedColumns = [] }) {
  const permitted = new Set((Array.isArray(allowedColumns) && allowedColumns.length ? allowedColumns : headers).map((h) => String(h || "")).filter(Boolean));
  const visibleHeaders = (Array.isArray(headers) ? headers : []).map((h) => String(h || "")).filter((h) => permitted.has(h));

  const columns = visibleHeaders.map((name) => {
    const vals = collectColumnValues(rows, name);
    const sampleValues = vals.slice(0, 8);
    const nonEmptyCount = vals.length;
    const uniqueSampleCount = new Set(sampleValues.map((v) => String(v))).size;
    const dateLikeCount = vals.filter((v) => isIsoDateLike(v)).length;
    const numericValues = vals.map((v) => toNumber(v)).filter((n) => n !== null);
    const numberLikeCount = numericValues.length;

    const topFreq = new Map();
    for (const v of vals.slice(0, 800)) {
      const key = String(v);
      topFreq.set(key, (topFreq.get(key) || 0) + 1);
    }
    const topValues = Array.from(topFreq.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([v]) => v);

    const dateValues = vals
      .map((v) => {
        const d = new Date(String(v));
        return Number.isNaN(d.getTime()) ? null : d.getTime();
      })
      .filter((t) => t !== null);

    const stats = {
      non_empty_count: nonEmptyCount,
      unique_sample_count: uniqueSampleCount,
      date_like_ratio: nonEmptyCount ? dateLikeCount / nonEmptyCount : 0,
      number_like_ratio: nonEmptyCount ? numberLikeCount / nonEmptyCount : 0,
      min_sample: numericValues.length
        ? Math.min(...numericValues)
        : (dateValues.length ? new Date(Math.min(...dateValues)).toISOString().slice(0, 10) : null),
      max_sample: numericValues.length
        ? Math.max(...numericValues)
        : (dateValues.length ? new Date(Math.max(...dateValues)).toISOString().slice(0, 10) : null),
    };

    return {
      name,
      type_guess: guessType({ dateLikeRatio: stats.date_like_ratio, numberLikeRatio: stats.number_like_ratio }),
      sample_values: sampleValues,
      top_values: topValues,
      profile: stats,
    };
  });

  return {
    workbook_id: String(workbookId),
    sheet_id: String(sheetId),
    sheet_name: String(sheetName),
    row_count: Array.isArray(rows) ? rows.length : 0,
    columns,
  };
}
