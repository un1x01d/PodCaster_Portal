export function chatPreludeHelpersPart2(deps) {
  const {
    query,
    buildRowFilterWhereClause,
    loadEffectiveAiRuntimeSettings,
    resolveChatCompletionProviderConfig,
    buildChatCompletionRequestBody,
    minCompletionTokensForModel,
    extractOpenAiAssistantText,
    enforceAiPromptBudget,
    getClient,
    writeAuditLog,
    CHAT_RUNTIME_RULES_DEFAULTS,
    AI_DEBUG_LOGS,
    CHAT_SQL_AGG_MAX_ROWS,
    CHAT_MAX_ROWS,
    OPENAI_BASE_URL,
    OPENAI_TIMEOUT_MS,
    parseNumericLoose,
    sampleTypeStats,
    evaluatePredefinedChatCompatibility,
    sleep,
    withLearningDbRetry,
    resolveOpenAIRequestFailureReason,
    aiError,
    detectIntentLabel,
    toRuleFlag,
    recordRuleHit,
    compileDeterministicQueryPlan,
    recordLearningEvent,
    isLearnablePhrase,
    upsertLearningCandidate,
    loadChatTtsSettings,
    loadChatRuntimeRules,
    toNum,
  } = deps;

function looksLikeDateText(v) {
  const s = String(v || "").trim();
  if (!s) return false;
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(s) ||
    /^\d{2}-\d{2}-\d{4}$/.test(s) ||
    /^\d{2}\/\d{2}\/\d{4}$/.test(s) ||
    /^\d{4}\/\d{2}\/\d{2}$/.test(s)
  );
}

function toSqlDateLiteral(v) {
  const s = String(v || "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(s)) return s.replaceAll("/", "-");
  if (/^\d{2}-\d{2}-\d{4}$/.test(s)) {
    const [mm, dd, yyyy] = s.split("-");
    return `${yyyy}-${mm}-${dd}`;
  }
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
    const [mm, dd, yyyy] = s.split("/");
    return `${yyyy}-${mm}-${dd}`;
  }
  return null;
}

function buildSqlSafeDateExpr(valueExpr) {
  return `(
    CASE
      WHEN (${valueExpr}) ~ '^\\s*\\d{4}-\\d{2}-\\d{2}\\s*$' THEN CAST(TRIM(${valueExpr}) AS DATE)
      WHEN (${valueExpr}) ~ '^\\s*\\d{4}/\\d{2}/\\d{2}\\s*$' THEN CAST(REPLACE(TRIM(${valueExpr}), '/', '-') AS DATE)
      WHEN (${valueExpr}) ~ '^\\s*\\d{2}-\\d{2}-\\d{4}\\s*$' THEN to_date(TRIM(${valueExpr}), 'MM-DD-YYYY')
      WHEN (${valueExpr}) ~ '^\\s*\\d{2}/\\d{2}/\\d{4}\\s*$' THEN to_date(TRIM(${valueExpr}), 'MM/DD/YYYY')
      ELSE NULL
    END
  )`;
}

function buildSqlSafeNumericExpr(valueExpr) {
  const extracted = `substring(${valueExpr} from '[-+]?[0-9,]*\\.?\\d+')`;
  const cleaned = `NULLIF(regexp_replace(${extracted}, '[^0-9.+-]', '', 'g'), '')`;
  return `(
    CASE
      WHEN ${cleaned} ~ '^[-+]?\\d*\\.?\\d+$' THEN CAST(${cleaned} AS NUMERIC)
      ELSE NULL
    END
  )`;
}

function parseDateValue(v) {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return d;
  }
  const n = Number(v);
  if (!Number.isNaN(n) && n > 25569 && n < 60000) {
    const ms = (n - 25569) * 86400 * 1000;
    const d = new Date(Date.UTC(1970, 0, 1) + ms);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

function detectQuarterFromText(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  const qy = s.match(/\bQ([1-4])\b(?:\s*[-/ ]?\s*(\d{4}))?/i);
  if (qy) return qy[2] ? `Q${qy[1]} ${qy[2]}` : `Q${qy[1]}`;
  const yq = s.match(/\b(\d{4})\s*[-/ ]?\s*Q([1-4])\b/i);
  if (yq) return `Q${yq[2]} ${yq[1]}`;
  const roman = s.match(/\b([IV]{1,3}|IV)\s*квартал\b(?:\s*(\d{4}))?/i);
  if (roman) {
    const map = { I: 1, II: 2, III: 3, IV: 4 };
    const q = map[String(roman[1]).toUpperCase()];
    if (q) return roman[2] ? `Q${q} ${roman[2]}` : `Q${q}`;
  }
  const local = s.match(/\b(?:квартал|quarter)\s*([1-4])\b(?:\s*(\d{4}))?/i);
  if (local) return local[2] ? `Q${local[1]} ${local[2]}` : `Q${local[1]}`;
  return null;
}

function quarterFromDate(date) {
  const month = date.getMonth();
  const q = Math.floor(month / 3) + 1;
  return `Q${q} ${date.getFullYear()}`;
}

function augmentRowsWithQuarter(rows = [], headers = []) {
  if (!Array.isArray(rows) || !rows.length) return { rows, headers };
  const baseHeaders = Array.isArray(headers) ? [...headers] : [];
  const dateLike = baseHeaders.filter((h) => /date|time|period|month|year|дата|період/i.test(String(h)));
  const dateCol = dateLike[0] || null;

  const enriched = rows.map((r) => {
    const row = typeof r === "object" && r ? { ...r } : {};
    let q = null;
    let y = null;
    let m = null;

    if (dateCol) {
      const d = parseDateValue(row[dateCol]);
      if (d) {
        q = quarterFromDate(d);
        y = String(d.getFullYear());
        m = d.toLocaleString('en-US', { month: 'long' });
      }
    }

    if (!q) {
      for (const h of baseHeaders) {
        if (q) break;
        q = detectQuarterFromText(row[h]);
      }
    }

    if (q) row.Quarter = q;
    if (y) row.Year = y;
    if (m) row.Month = m;
    return row;
  });

  const hasExtra = enriched.some((r) => r && (r.Quarter || r.Year));
  const outHeaders = [...baseHeaders];
  if (hasExtra) {
    if (!outHeaders.includes("Quarter")) outHeaders.push("Quarter");
    if (!outHeaders.includes("Year")) outHeaders.push("Year");
    if (!outHeaders.includes("Month")) outHeaders.push("Month");
  }
  return { rows: enriched, headers: outHeaders };
}

function formatValue(v, locale = "en", col = "", forSpeech = false) {
  if (typeof v !== "number" || !Number.isFinite(v)) return String(v ?? "");
  
  const isCurrency = col && /price|cost|revenue|income|profit|earnings|salary|wage|amount|balance|total|summ|ebitda|val|fee|tax|debt|loan|payment|capital|asset|liability|equity|budget|spend|cash|funding|sales|purchase/i.test(String(col));
  const isPercent = col && /percent|margin|rate|ratio|%|markup|yield|growth|change|variance|contribution|roi|roe|roa|discount|utilization/i.test(String(col));

  try {
    const abs = Math.abs(v);
    const sign = v < 0 ? "-" : "";
    const num = abs.toLocaleString("en-US", {
      useGrouping: !forSpeech,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    const pfx = isCurrency ? "$" : "";
    const sfx = (isPercent && !isCurrency) ? "%" : "";
    return `${sign}${pfx}${num}${sfx}`;
  } catch (e) {
    const abs = Math.abs(v);
    const sign = v < 0 ? "-" : "";
    const pfx = isCurrency ? "$" : "";
    const sfx = (isPercent && !isCurrency) ? "%" : "";
    return `${sign}${pfx}${String(abs)}${sfx}`;
  }
}

/**
 * PERF-01: Server-Side Math
 * Executes heavy calculations in PostgreSQL instead of Node.js memory.
 */

function normalizeActiveDashboardFilters(headers = [], activeFilters = {}) {
  if (!activeFilters || typeof activeFilters !== "object" || Array.isArray(activeFilters)) return [];
  const headerList = Array.isArray(headers) ? headers : [];
  const resolveHeader = (name) => {
    const raw = String(name || "").trim();
    if (!raw) return null;
    return headerList.find((h) => String(h).trim().toLowerCase() === raw.toLowerCase()) || null;
  };

  const out = [];
  Object.entries(activeFilters).forEach(([rawColumn, rawValue]) => {
    const column = resolveHeader(rawColumn);
    if (!column || rawValue === null || rawValue === undefined || rawValue === "") return;

    if (Array.isArray(rawValue)) {
      const values = rawValue
        .map((v) => String(v ?? ""))
        .filter((v) => v !== "")
        .slice(0, 100);
      if (values.length) out.push({ column, operator: "in", values });
      return;
    }

    if (rawValue && typeof rawValue === "object") {
      const value = String(rawValue.value ?? "").trim();
      if (!value) return;
      const operator = String(rawValue.operator || rawValue.type || "contains").toLowerCase() === "equals"
        ? "equals"
        : "contains";
      out.push({ column, operator, value });
    }
  });
  return out;
}

async function computeSqlAggregation({ sheetId, user, operation, targetColumn, groupBy, filters = [], rowFiltersList = [], allowedColumns = null, limit = 5, locale = "en", tabName = null, actualHeaders = [] }) {
    const op = String(operation || "none").toLowerCase();
    const lang = String(locale || "en").toLowerCase();
    const isUk = lang.startsWith("uk");
    const isRu = lang.startsWith("ru");
    const nLimit = Number.isInteger(limit) ? limit : 5;
    const allowedColumnSet = Array.isArray(allowedColumns) && allowedColumns.length
      ? new Set(allowedColumns.map((c) => String(c)))
      : null;
    const canUseColumn = (column) => !allowedColumnSet || allowedColumnSet.has(String(column));
    
    // 1. Build Base Where Clause (RBAC + Tab + AI Filters)
    let sql = `SELECT `;
    const params = [sheetId];
    let where = `WHERE sheet_id = $1`;

    if (tabName) {
        where += ` AND tab_name = $${params.length + 1}`;
        params.push(tabName);
    }

    // Apply RBAC row filters in SQL
    const rowFilterSql = buildRowFilterWhereClause(rowFiltersList, params.length + 1, actualHeaders);
    if (rowFilterSql.sql) {
      where += rowFilterSql.sql;
      params.push(...rowFilterSql.params);
    }

    // Add AI Filters to SQL
    filters.forEach(f => {
        if (!f.column) return;
        if (f.operator === "in") {
            const values = Array.isArray(f.values) ? f.values.map((v) => String(v ?? "")).filter((v) => v !== "") : [];
            if (!values.length) return;
            const colIdx = params.length + 1;
            const valIdx = params.length + 2;
            params.push(f.column, values);
            where += ` AND ((row_data->>$${colIdx}) = ANY($${valIdx}::text[]))`;
            return;
        }
        if (f.value === undefined) return;
        
        let colSql = `row_data->>$${params.length + 1}`;
        // Support virtual columns in filters
        if (f.column === "Year") colSql = `EXTRACT(YEAR FROM (CAST(row_data->>$${params.length + 1} AS DATE)))::text`;
        if (f.column === "Month") colSql = `TO_CHAR(CAST(row_data->>$${params.length + 1} AS DATE), 'Month')`;
        if (f.column === "Quarter") colSql = `'Q' || TO_CHAR(CAST(row_data->>$${params.length + 1} AS DATE), 'Q YYYY')`;
        
        const valIdx = params.length + 2;
        params.push(f.column === "Year" || f.column === "Month" || f.column === "Quarter" ? "Date" : f.column, String(f.value));
        const numericFilterVal = toNum(f.value);
        const dateFilterVal = toSqlDateLiteral(f.value);
        const isVirtualDateCol = f.column === "Year" || f.column === "Month" || f.column === "Quarter";
        const useDateComparators = !isVirtualDateCol && !!dateFilterVal && (
          looksLikeDateText(f.value) ||
          /date|time|day|month|year|period|quarter|дата|період|рік|год/i.test(String(f.column || ""))
        );
        const safeDateExpr = buildSqlSafeDateExpr(colSql);

        switch(f.operator) {
            case 'year_equals':
              where += ` AND (
                CASE
                  WHEN (${colSql}) ~ '^\\s*\\d{4}\\s*$' THEN CAST(TRIM(${colSql}) AS INT)
                  WHEN (${colSql}) ~ '^\\s*\\d{4}[-/]\\d{2}[-/]\\d{2}\\s*$' THEN EXTRACT(YEAR FROM CAST(REPLACE(TRIM(${colSql}), '/', '-') AS DATE))::INT
                  WHEN (${colSql}) ~ '^\\s*\\d{2}[-/]\\d{2}[-/]\\d{4}\\s*$' THEN CAST(RIGHT(TRIM(${colSql}), 4) AS INT)
                  ELSE NULL
                END
              ) = $${valIdx}::int`;
              break;
            case 'gt':
              if (useDateComparators) {
                params[params.length - 1] = dateFilterVal;
                where += ` AND (${safeDateExpr} > $${valIdx}::date)`;
              } else if (numericFilterVal !== null) {
                params[params.length - 1] = String(numericFilterVal);
                where += ` AND (${buildSqlSafeNumericExpr(colSql)} > $${valIdx}::numeric)`;
              } else {
                where += ` AND (${colSql} > $${valIdx})`;
              }
              break;
            case 'gte':
              if (useDateComparators) {
                params[params.length - 1] = dateFilterVal;
                where += ` AND (${safeDateExpr} >= $${valIdx}::date)`;
              } else if (numericFilterVal !== null) {
                params[params.length - 1] = String(numericFilterVal);
                where += ` AND (${buildSqlSafeNumericExpr(colSql)} >= $${valIdx}::numeric)`;
              } else {
                where += ` AND (${colSql} >= $${valIdx})`;
              }
              break;
            case 'lt':
              if (useDateComparators) {
                params[params.length - 1] = dateFilterVal;
                where += ` AND (${safeDateExpr} < $${valIdx}::date)`;
              } else if (numericFilterVal !== null) {
                params[params.length - 1] = String(numericFilterVal);
                where += ` AND (${buildSqlSafeNumericExpr(colSql)} < $${valIdx}::numeric)`;
              } else {
                where += ` AND (${colSql} < $${valIdx})`;
              }
              break;
            case 'lte':
              if (useDateComparators) {
                params[params.length - 1] = dateFilterVal;
                where += ` AND (${safeDateExpr} <= $${valIdx}::date)`;
              } else if (numericFilterVal !== null) {
                params[params.length - 1] = String(numericFilterVal);
                where += ` AND (${buildSqlSafeNumericExpr(colSql)} <= $${valIdx}::numeric)`;
              } else {
                where += ` AND (${colSql} <= $${valIdx})`;
              }
              break;
            case 'equals': where += ` AND (${colSql} = $${valIdx})`; break;
            default: where += ` AND (${colSql} ILIKE $${valIdx})`; params[params.length-1] = `%${f.value}%`; break;
        }
    });

    const canUseSummaryPath =
      !Array.isArray(rowFiltersList) || rowFiltersList.length === 0
        ? !(Array.isArray(filters) && filters.length > 0)
        : false;

    try {
        if (canUseSummaryPath && targetColumn && ["count", "sum", "avg", "top_n", "year_over_year"].includes(op)) {
            const summaryParams = [sheetId, targetColumn];
            let summaryWhere = `WHERE sheet_id = $1 AND metric_key = $2`;
            if (tabName) {
              summaryParams.push(tabName);
              summaryWhere += ` AND tab_name = $${summaryParams.length}`;
            }

            if (op === "count") {
              const rows = await query(`SELECT COALESCE(SUM(agg_count), 0)::bigint AS c FROM sheet_insight_summaries ${summaryWhere}`, summaryParams);
              const c = Number(rows?.[0]?.c || 0);
              return { answer: isUk ? `Кількість: ${c} рядків` : (isRu ? `Количество: ${c} строк` : `Count: ${c} rows`), previewRows: [] };
            }

            if (op === "sum" && !groupBy) {
              const rows = await query(
                `SELECT COALESCE(SUM(agg_sum), 0)::numeric AS v
                   FROM sheet_insight_summaries
                  ${summaryWhere}
                    AND category_key = '__all__'`,
                summaryParams
              );
              const v = Number(rows?.[0]?.v || 0);
              const metricCountParamIdx = params.length + 1;
              const metricCountExpr = `CASE
                WHEN (row_data->>$${metricCountParamIdx}) ~ '^\\s*[-+]?\\d{1,3}(?:,\\d{3})*(?:\\.\\d+)?\\s*%?\\s*$'
                  OR (row_data->>$${metricCountParamIdx}) ~ '^\\s*[-+]?\\d+(?:\\.\\d+)?\\s*%?\\s*$'
                  OR (row_data->>$${metricCountParamIdx}) ~ '^\\s*[-+]?\\.\\d+\\s*%?\\s*$'
                THEN ${buildSqlSafeNumericExpr(`row_data->>$${metricCountParamIdx}`)}
                ELSE NULL
              END`;
              const counts = await query(
                `SELECT COUNT(*)::int AS total_rows, COUNT(${metricCountExpr})::int AS numeric_rows
                   FROM sheet_rows ${where}`,
                [...params, targetColumn]
              );
              const totalRows = Number(counts?.[0]?.total_rows || 0);
              const numericRows = Number(counts?.[0]?.numeric_rows || 0);
              const skippedRows = Math.max(0, totalRows - numericRows);
              const base = `${isUk ? "Сума" : (isRu ? "Сумма" : "Total")} ${targetColumn}: ${formatValue(v, locale, targetColumn)}`;
              return { answer: appendSkippedRowsNote(base, skippedRows, locale), previewRows: [] };
            }

            if (op === "avg" && !groupBy) {
              const rows = await query(
                `SELECT
                    CASE WHEN COALESCE(SUM(agg_count),0) = 0 THEN NULL
                         ELSE (COALESCE(SUM(agg_sum),0) / NULLIF(COALESCE(SUM(agg_count),0),0)) END AS v
                   FROM sheet_insight_summaries
                  ${summaryWhere}
                    AND category_key = '__all__'`,
                summaryParams
              );
              const v = Number(rows?.[0]?.v || 0);
              const metricCountParamIdx = params.length + 1;
              const metricCountExpr = `CASE
                WHEN (row_data->>$${metricCountParamIdx}) ~ '^\\s*[-+]?\\d{1,3}(?:,\\d{3})*(?:\\.\\d+)?\\s*%?\\s*$'
                  OR (row_data->>$${metricCountParamIdx}) ~ '^\\s*[-+]?\\d+(?:\\.\\d+)?\\s*%?\\s*$'
                  OR (row_data->>$${metricCountParamIdx}) ~ '^\\s*[-+]?\\.\\d+\\s*%?\\s*$'
                THEN ${buildSqlSafeNumericExpr(`row_data->>$${metricCountParamIdx}`)}
                ELSE NULL
              END`;
              const counts = await query(
                `SELECT COUNT(*)::int AS total_rows, COUNT(${metricCountExpr})::int AS numeric_rows
                   FROM sheet_rows ${where}`,
                [...params, targetColumn]
              );
              const totalRows = Number(counts?.[0]?.total_rows || 0);
              const numericRows = Number(counts?.[0]?.numeric_rows || 0);
              const skippedRows = Math.max(0, totalRows - numericRows);
              const base = `${isUk ? "Середнє" : (isRu ? "Среднее" : "Average")} ${targetColumn}: ${formatValue(v, locale, targetColumn)}`;
              return { answer: appendSkippedRowsNote(base, skippedRows, locale), previewRows: [] };
            }

            if (op === "top_n" && groupBy) {
              const rows = await query(
                `SELECT category_key AS label, COALESCE(SUM(agg_sum),0)::numeric AS value
                   FROM sheet_insight_summaries
                  ${summaryWhere}
                    AND category_key <> '__all__'
               GROUP BY category_key
               ORDER BY value DESC
                  LIMIT $${summaryParams.length + 1}`,
                [...summaryParams, nLimit]
              );
              if (!rows.length) return { answer: isUk ? "Відповідних даних не знайдено." : (isRu ? "Подходящие данные не найдены." : "No matching data found."), previewRows: [] };
              const answer = (isUk ? `Топ ${rows.length} ${groupBy} за ${targetColumn}:\n` : (isRu ? `Топ ${rows.length} ${groupBy} по ${targetColumn}:\n` : `Top ${rows.length} ${groupBy} by ${targetColumn}:\n`)) +
                rows.map((r, i) => `${i+1}. ${r.label}: ${formatValue(Number(r.value), locale, targetColumn)}`).join("\n");
              return { answer, previewRows: rows };
            }

            if (op === "year_over_year") {
              const rows = await query(
                `SELECT period_key, COALESCE(SUM(agg_sum),0)::numeric AS value
                   FROM sheet_insight_summaries
                  ${summaryWhere}
                    AND category_key = '__all__'
                    AND period_key ~ '^\\d{4}$'
               GROUP BY period_key
               ORDER BY period_key ASC`,
                summaryParams
              );
              if (!rows.length || rows.length < 2) return { answer: isUk ? "Відповідних даних не знайдено." : (isRu ? "Подходящие данные не найдены." : "No matching data found."), previewRows: [] };
              const points = rows.map((r) => ({ year: Number(r.period_key), value: Number(r.value || 0) })).filter((p) => Number.isFinite(p.year)).sort((a,b)=>a.year-b.year);
              const lines = [];
              for (let i = 1; i < points.length; i++) {
                const cur = points[i];
                const prev = points[i-1];
                const diff = cur.value - prev.value;
                const pct = prev.value === 0 ? 0 : (diff / Math.abs(prev.value)) * 100;
                lines.push(`• ${cur.year} vs ${prev.year}: ${formatValue(cur.value, locale, targetColumn)} vs ${formatValue(prev.value, locale, targetColumn)} (${diff >= 0 ? "+" : ""}${formatValue(diff, locale, targetColumn)}, ${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%)`);
              }
              return { answer: `${isUk ? `Аналіз рік до року для ${targetColumn}:` : (isRu ? `Анализ год к году для ${targetColumn}:` : `Year over Year analysis for ${targetColumn}:`)}\n${lines.join("\n")}`, previewRows: rows };
            }
        }

        if (op === "count") {
            const res = await query(`SELECT COUNT(*) as c FROM sheet_rows ${where}`, params);
            return { answer: isUk ? `Кількість: ${res[0].c} рядків` : (isRu ? `Количество: ${res[0].c} строк` : `Count: ${res[0].c} rows`), previewRows: [] };
        }

        if (!targetColumn) return null;
        if (!canUseColumn(targetColumn)) return null;
        if (groupBy && !["Year", "Month", "Quarter"].includes(groupBy) && !canUseColumn(groupBy)) return null;

        // Common Numeric Casting for target column
        const valSql = `CASE
            WHEN (row_data->>$${params.length + 1}) ~ '^\\s*[-+]?\\d{1,3}(?:,\\d{3})*(?:\\.\\d+)?\\s*%?\\s*$'
              OR (row_data->>$${params.length + 1}) ~ '^\\s*[-+]?\\d+(?:\\.\\d+)?\\s*%?\\s*$'
              OR (row_data->>$${params.length + 1}) ~ '^\\s*[-+]?\\.\\d+\\s*%?\\s*$'
            THEN ${buildSqlSafeNumericExpr(`row_data->>$${params.length + 1}`)}
            ELSE NULL
          END`;
        params.push(targetColumn);

        if (groupBy && ["sum", "avg", "top_n", "max", "min"].includes(op)) {
            let groupSqlCol = `row_data->>$${params.length + 1}`;
            if (groupBy === "Year") groupSqlCol = `EXTRACT(YEAR FROM (CAST(row_data->>$${params.length + 1} AS DATE)))::text`;
            if (groupBy === "Month") groupSqlCol = `TO_CHAR(CAST(row_data->>$${params.length + 1} AS DATE), 'Month')`;
            if (groupBy === "Quarter") groupSqlCol = `'Q' || TO_CHAR(CAST(row_data->>$${params.length + 1} AS DATE), 'Q YYYY')`;
            
            params.push(groupBy === "Year" || groupBy === "Month" || groupBy === "Quarter" ? "Date" : groupBy);
            const aggOp = (op === "avg") ? "AVG" : (op === "max" ? "MAX" : (op === "min" ? "MIN" : "SUM"));
            
            const groupSql = `
                SELECT ${groupSqlCol} as label, ${aggOp}(${valSql}) as value
                FROM sheet_rows
                ${where}
                GROUP BY label
                ORDER BY value DESC
                LIMIT $${params.length + 1}
            `;
            params.push(nLimit);
            const rows = await query(groupSql, params);
            if (!rows.length) return { answer: isUk ? "Відповідних даних не знайдено." : (isRu ? "Подходящие данные не найдены." : "No matching data found."), previewRows: [] };

            const answer = (isUk ? `Топ ${rows.length} ${groupBy} за ${targetColumn}:\n` : (isRu ? `Топ ${rows.length} ${groupBy} по ${targetColumn}:\n` : `Top ${rows.length} ${groupBy} by ${targetColumn}:\n`)) +
                rows.map((r, i) => `${i+1}. ${r.label}: ${formatValue(Number(r.value), locale, targetColumn)}`).join("\n");
            
            return { answer, previewRows: rows };
        }

        if (["sum", "avg", "max", "min"].includes(op)) {
            const aggOp = op.toUpperCase();
            const res = await query(
              `SELECT ${aggOp}(${valSql}) as v, COUNT(*)::int AS total_rows, COUNT(${valSql})::int AS numeric_rows
                 FROM sheet_rows ${where}`,
              params
            );
            const val = Number(res[0].v || 0);
            const totalRows = Number(res?.[0]?.total_rows || 0);
            const numericRows = Number(res?.[0]?.numeric_rows || 0);
            const skippedRows = Math.max(0, totalRows - numericRows);
            const labels = isUk
              ? { SUM: "Сума", AVG: "Середнє", MAX: "Максимум", MIN: "Мінімум" }
              : (isRu ? { SUM: "Сумма", AVG: "Среднее", MAX: "Максимум", MIN: "Минимум" } : { SUM: "Total", AVG: "Average", MAX: "Max", MIN: "Min" });
            const base = `${labels[aggOp]} ${targetColumn}: ${formatValue(val, locale, targetColumn)}`;
            return { answer: appendSkippedRowsNote(base, skippedRows, locale), previewRows: [] };
        }

    } catch (e) {
        console.error("SQL Aggregation failed:", e);
        return null; // Fallback to memory-based for complex ones or on error
    }

    return null;
}

function inferAggregateBucketFromMessage(message = "", ai = {}) {
  const msg = String(message || "").toLowerCase();
  const op = String(ai?.operation || "").toLowerCase();
  if (op === "year_over_year" || /\b(yoy|year over year|year-over-year|annual growth|yearly growth|last year|previous year|год к году|г\/г|р\/р|річне обчислення)\b/i.test(msg)) {
    return "year";
  }
  if (/\b(quarter|quarterly|qoq|q\/q|quarter over quarter|quarter-over-quarter)\b/i.test(msg)) {
    return "quarter";
  }
  if (/\b(month|monthly|mom|m\/m|month over month|month-over-month|trend|over time|timeline|chart|plot|graph)\b/i.test(msg) || op === "trend" || op === "chart" || op === "plot") {
    return "month";
  }
  return null;
}

function isDateRelatedQuestion(message = "") {
  const msg = String(message || "").toLowerCase();
  if (!msg.trim()) return false;
  return /\b(yoy|year over year|year-over-year|annual|yearly|last year|previous year|this year|current year|ytd|year\s*to\s*date|trend|over time|timeline|time series|by year|by month|by quarter|per year|per month|per quarter|monthly|quarterly|weekly|daily|date|dates|period|periods|month|months|quarter|quarters|week|weeks|day|days|year|years|q[1-4]|mom|m\/m|qoq|q\/q)\b|год к году|г\/г|р\/р|рік до року|річн|прошл(ый|ого)\s+год|минул(ий|ого)\s+рік|поточн(ий|ого)\s+рік|текущ(ий|его)\s+год|рік|год|місяц|месяц|квартал|дата|період|период|тиждень|недел/i.test(msg);
}

function isTemporalHeaderName(header = "") {
  const s = String(header || "").trim().toLowerCase().replace(/[_-]+/g, " ");
  if (!s) return false;
  return /\b(date|timestamp|time|period|calendar|fiscal|fy|year|month|week|day|quarter|qtr|дата|період|период|рік|год|місяць|месяц|тиждень|неделя|день|квартал)\b/i.test(s);
}

function sheetHasTemporalColumn(headers = [], sampleRows = [], semanticProfile = null) {
  const headerList = Array.isArray(headers) ? headers : [];
  if (!headerList.length) return false;
  if (headerList.some(isTemporalHeaderName)) return true;
  const profileDateColumn = resolveProfileDateColumn(semanticProfile, []);
  if (profileDateColumn && headerList.includes(profileDateColumn) && isTemporalHeaderName(profileDateColumn)) return true;
  return false;
}

function noDateColumnAnswer(locale = "en") {
  const normalized = normalizeLocale(locale || "en");
  if (normalized === "uk") {
    return "Я не можу відповідати на питання про дати, роки, місяці, тижні, квартали або тренди, бо в цьому аркуші немає колонки дати, року, місяця, тижня, кварталу, дня або періоду.";
  }
  if (normalized === "ru") {
    return "Я не могу отвечать на вопросы о датах, годах, месяцах, неделях, кварталах или трендах, потому что в этом листе нет колонки даты, года, месяца, недели, квартала, дня или периода.";
  }
  if (normalized === "es") {
    return "No puedo responder preguntas sobre fechas, años, meses, semanas, trimestres o tendencias porque esta hoja no tiene una columna de fecha, año, mes, semana, trimestre, día o periodo.";
  }
  return "I can't answer date-related questions because this sheet does not have a date, year, month, week, quarter, day, or period column.";
}

function inferAggregateOperationFromMessage(message = "", ai = {}, rules = CHAT_RUNTIME_RULES_DEFAULTS) {
  const msg = String(message || "").toLowerCase();
  const op = String(ai?.operation || "").toLowerCase();
  const hasExplicitSingleYear = runtimeRegex(rules, "aggregateSingleYearRegex", CHAT_RUNTIME_RULES_DEFAULTS.aggregateSingleYearRegex).test(msg);
  const hasComparisonCue = runtimeRegex(rules, "aggregateComparisonRegex", CHAT_RUNTIME_RULES_DEFAULTS.aggregateComparisonRegex).test(msg);
  if (hasExplicitSingleYear && !hasComparisonCue) {
    return /\b(average|mean)\b/i.test(msg) ? "avg" : "sum";
  }
  if (["count", "sum", "avg", "max", "min", "top_n", "year_over_year", "chart", "plot", "trend"].includes(op)) {
    return op;
  }
  if (/\b(how many|count|number of|total rows|row count|records? (?:are|were)|entries?)\b/i.test(msg)) return "count";
  if (/\b(average|mean|per (?:day|week|month|year|customer|user|order|transaction))\b/i.test(msg)) return "avg";
  if (/\b(top|highest|largest|biggest|best|most|leading|drivers?|drives|rank(?:ing)?|bottom|lowest|least|smallest)\b/i.test(msg)) return "top_n";
  if (/\b(yoy|year over year|year-over-year|annual growth|yearly growth|last year|previous year|trend|over time|timeline|monthly|quarterly)\b/i.test(msg)) return "year_over_year";
  if (/\b(total|sum|combined|overall|revenue|sales|income|cost|expense|spend|profit|amount|balance|cash|budget|fees?|taxes?|orders?|payments?)\b/i.test(msg)) return "sum";
  return null;
}

  return {
    looksLikeDateText,
    toSqlDateLiteral,
    buildSqlSafeDateExpr,
    buildSqlSafeNumericExpr,
    parseDateValue,
    detectQuarterFromText,
    quarterFromDate,
    augmentRowsWithQuarter,
    formatValue,
    normalizeActiveDashboardFilters,
    computeSqlAggregation,
    inferAggregateBucketFromMessage,
    isDateRelatedQuestion,
    isTemporalHeaderName,
    sheetHasTemporalColumn,
    noDateColumnAnswer,
    inferAggregateOperationFromMessage,
  };
}
