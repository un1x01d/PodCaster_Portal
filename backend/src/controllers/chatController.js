import { createHash } from "crypto";
import { query } from "../config/db.js";
import { isEnglishLocale, normalizeLocale, translateDashboardItems } from "../utils/dashboardLocalization.js";

const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_TIMEOUT_MS = Number.parseInt(process.env.OPENAI_TIMEOUT_MS || "60000", 10);
const CHAT_AUDIO_MAX_CHARS = Number.parseInt(process.env.CHAT_AUDIO_MAX_CHARS || "8000", 10);

let SEMANTIC_CACHE = null;
let RATIO_CACHE = null;
let CACHE_TS = 0;

const CHAT_SAMPLE_ROWS = 600;

function toNum(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (!v) return null;
  const n = parseFloat(String(v).replace(/[$,%\s,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

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
async function computeSqlAggregation({ sheetId, user, operation, targetColumn, groupBy, filters = [], limit = 5, locale = "en", tabName = null }) {
    const op = String(operation || "none").toLowerCase();
    const nLimit = Number.isInteger(limit) ? limit : 5;
    
    // 1. Build Base Where Clause (RBAC + Tab + AI Filters)
    let sql = `SELECT `;
    const params = [sheetId];
    let where = `WHERE sheet_id = $1`;

    if (tabName) {
        where += ` AND tab_name = $${params.length + 1}`;
        params.push(tabName);
    }

    // Add AI Filters to SQL
    filters.forEach(f => {
        if (!f.column || f.value === undefined) return;
        
        let colSql = `row_data->>$${params.length + 1}`;
        // Support virtual columns in filters
        if (f.column === "Year") colSql = `EXTRACT(YEAR FROM (CAST(row_data->>$${params.length + 1} AS DATE)))::text`;
        if (f.column === "Month") colSql = `TO_CHAR(CAST(row_data->>$${params.length + 1} AS DATE), 'Month')`;
        if (f.column === "Quarter") colSql = `'Q' || TO_CHAR(CAST(row_data->>$${params.length + 1} AS DATE), 'Q YYYY')`;
        
        const valIdx = params.length + 2;
        params.push(f.column === "Year" || f.column === "Month" || f.column === "Quarter" ? "Date" : f.column, String(f.value));
        const numericFilterVal = toNum(f.value);
        const dateFilterVal = toSqlDateLiteral(f.value);
        const useDateComparators = !!dateFilterVal && (
          looksLikeDateText(f.value) ||
          /date|time|day|month|year|period|quarter|дата|період|рік|год/i.test(String(f.column || ""))
        );

        switch(f.operator) {
            case 'gt':
              if (useDateComparators) {
                params[params.length - 1] = dateFilterVal;
                where += ` AND (to_date(${colSql}, 'MM-DD-YYYY') > $${valIdx}::date)`;
              } else if (numericFilterVal !== null) {
                params[params.length - 1] = String(numericFilterVal);
                where += ` AND (CAST(NULLIF(regexp_replace(${colSql}, '[^0-9.-]', '', 'g'), '') AS NUMERIC) > $${valIdx}::numeric)`;
              } else {
                where += ` AND (${colSql} > $${valIdx})`;
              }
              break;
            case 'gte':
              if (useDateComparators) {
                params[params.length - 1] = dateFilterVal;
                where += ` AND (to_date(${colSql}, 'MM-DD-YYYY') >= $${valIdx}::date)`;
              } else if (numericFilterVal !== null) {
                params[params.length - 1] = String(numericFilterVal);
                where += ` AND (CAST(NULLIF(regexp_replace(${colSql}, '[^0-9.-]', '', 'g'), '') AS NUMERIC) >= $${valIdx}::numeric)`;
              } else {
                where += ` AND (${colSql} >= $${valIdx})`;
              }
              break;
            case 'lt':
              if (useDateComparators) {
                params[params.length - 1] = dateFilterVal;
                where += ` AND (to_date(${colSql}, 'MM-DD-YYYY') < $${valIdx}::date)`;
              } else if (numericFilterVal !== null) {
                params[params.length - 1] = String(numericFilterVal);
                where += ` AND (CAST(NULLIF(regexp_replace(${colSql}, '[^0-9.-]', '', 'g'), '') AS NUMERIC) < $${valIdx}::numeric)`;
              } else {
                where += ` AND (${colSql} < $${valIdx})`;
              }
              break;
            case 'lte':
              if (useDateComparators) {
                params[params.length - 1] = dateFilterVal;
                where += ` AND (to_date(${colSql}, 'MM-DD-YYYY') <= $${valIdx}::date)`;
              } else if (numericFilterVal !== null) {
                params[params.length - 1] = String(numericFilterVal);
                where += ` AND (CAST(NULLIF(regexp_replace(${colSql}, '[^0-9.-]', '', 'g'), '') AS NUMERIC) <= $${valIdx}::numeric)`;
              } else {
                where += ` AND (${colSql} <= $${valIdx})`;
              }
              break;
            case 'equals': where += ` AND (${colSql} = $${valIdx})`; break;
            default: where += ` AND (${colSql} ILIKE $${valIdx})`; params[params.length-1] = `%${f.value}%`; break;
        }
    });

    try {
        if (op === "count") {
            const res = await query(`SELECT COUNT(*) as c FROM sheet_rows ${where}`, params);
            return { answer: `Count: ${res[0].c} rows`, previewRows: [] };
        }

        if (!targetColumn) return null;

        // Common Numeric Casting for target column
        const valSql = `CAST(NULLIF(regexp_replace(row_data->>$${params.length + 1}, '[^0-9.-]', '', 'g'), '') AS NUMERIC)`;
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
            if (!rows.length) return { answer: "No matching data found.", previewRows: [] };

            const answer = `Top ${rows.length} ${groupBy} by ${targetColumn}:\n` + 
                rows.map((r, i) => `${i+1}. ${r.label}: ${formatValue(Number(r.value), locale, targetColumn)}`).join("\n");
            
            return { answer, previewRows: rows };
        }

        if (["sum", "avg", "max", "min"].includes(op)) {
            const aggOp = op.toUpperCase();
            const res = await query(`SELECT ${aggOp}(${valSql}) as v FROM sheet_rows ${where}`, params);
            const val = Number(res[0].v || 0);
            const labels = { SUM: "Total", AVG: "Average", MAX: "Max", MIN: "Min" };
            return { answer: `${labels[aggOp]} ${targetColumn}: ${formatValue(val, locale, targetColumn)}`, previewRows: [] };
        }

    } catch (e) {
        console.error("SQL Aggregation failed:", e);
        return null; // Fallback to memory-based for complex ones or on error
    }

    return null;
}

async function computeDeterministicAnswer(operation, rows, targetColumn, groupBy, limit = 5, locale = "en", queryText = "") {
  const op = (operation || "none").toLowerCase();
  const q = String(queryText || "").toLowerCase();
  const nLimit = Number.isFinite(Number(limit)) ? Math.max(1, Number(limit)) : 5;

  if (!rows || rows.length === 0) {
    return { answer: "No data matched those criteria.", previewRows: [] };
  }

  if (op === "count") return { answer: `Count: ${rows.length} rows`, previewRows: rows.slice(0, 15) };
  
  // --- Financial Ratio & Analysis Engine (Loaded from DB) ---
  const { ratios } = await loadSemanticBrain();

  const matchedRatio = ratios.find(r => r.match.test(q));
  if (matchedRatio) {
    const resolvedCols = await Promise.all(matchedRatio.cols.map(c => resolveColumn(headers, c, rows.slice(0, 10))));
    if (resolvedCols.every(c => !!c)) {
        const sums = resolvedCols.map(c => rows.reduce((acc, r) => acc + (toNum(r[c]) || 0), 0));
        if (sums.every(s => s !== 0 || matchedRatio.key === "rainy_day")) {
            const result = matchedRatio.calc(sums);
            let ans = "";
            if (matchedRatio.format === "percent") ans = `${matchedRatio.label}: ${result.toFixed(2)}%`;
            else if (matchedRatio.format === "ratio") ans = `${matchedRatio.label}: ${result.toFixed(2)}x`;
            else if (matchedRatio.format === "months") ans = `${matchedRatio.label}: ${result.toFixed(1)} months remaining`;
            else if (matchedRatio.format === "weeks") ans = `${matchedRatio.label}: ${result.toFixed(1)} weeks remaining`;
            else if (matchedRatio.format === "days") ans = `${matchedRatio.label}: ${Math.round(result)} days`;
            else ans = `${matchedRatio.label}: ${formatValue(result, locale, resolvedCols[0])}`;
            
            // Add custom pragmatic flavor to the answer
            if (matchedRatio.key === "rainy_day") {
                ans += result > 12 ? ". You can sleep well at night!" : ". This is a tight buffer, watch your expenses.";
            } else if (matchedRatio.key === "headache_ratio") {
                ans += result > 10 ? ". This category might be more trouble than it's worth." : ". This is a very healthy relationship.";
            }
            
            return { answer: ans, previewRows: rows.slice(0, 5) };
        }
    }
  }

  if (!targetColumn) return { answer: "I found the matching records, but no specific metric column was identified for calculation.", previewRows: rows.slice(0, 15) };

  const isPercentageCol = /percent|margin|rate|ratio|%/i.test(String(targetColumn));
  const effectiveOp = (op === "sum" && isPercentageCol) ? "avg" : op;

  // --- Year Over Year / Same Period Logic ---
  const isYoYQuery = effectiveOp === "year_over_year" || 
                    (groupBy && /year|дата|рік|год/i.test(String(groupBy)) && (effectiveOp === "sum" || effectiveOp === "top_n")) ||
                    (/previous year|last year|прошлый год|минулий рік/i.test(String(targetColumn || ""))) ||
                    (q.includes("previous year") || q.includes("last year") || q.includes("минулого року") || q.includes("прошлого года"));

  if (isYoYQuery) {
    const keys = Object.keys(rows[0] || {});
    let dateCol = keys.find(k => /date|period|month|year|дата|період|час/i.test(String(k))) || groupBy;
    
    let targetRows = rows;

    // Special: "Latest Month" YoY
    if (q.includes("latest month") || q.includes("останній місяць") || q.includes("последний месяц")) {
        // Find latest month in the full set
        let latestDate = null;
        rows.forEach(r => {
            const d = parseDateValue(r[dateCol]);
            if (d && (!latestDate || d > latestDate)) latestDate = d;
        });
        if (latestDate) {
            const targetMonth = latestDate.getMonth();
            const monthName = latestDate.toLocaleString('en-US', { month: 'long' });
            targetRows = rows.filter(r => {
                const d = parseDateValue(r[dateCol]);
                return d && d.getMonth() === targetMonth;
            });
            // Adjust title
            targetColumn = `${targetColumn} for ${monthName}`;
        }
    }

    const yearlySums = {};
    targetRows.forEach(r => {
      const d = parseDateValue(r[dateCol]);
      const year = d ? d.getFullYear() : (Number.isInteger(Number(r[dateCol])) ? Number(r[dateCol]) : null);
      if (!year) return;
      const val = toNum(r[targetColumn]);
      if (val !== null) yearlySums[year] = (yearlySums[year] || 0) + val;
    });

    const years = Object.keys(yearlySums).map(Number).sort((a, b) => a - b);
    if (years.length >= 2) {
      let comparisonText = "";
      if (locale.startsWith("uk")) {
        comparisonText = `Аналіз року до року для ${targetColumn}:\n`;
      } else if (locale.startsWith("ru")) {
        comparisonText = `Анализ год к году для ${targetColumn}:\n`;
      } else {
        comparisonText = `Year over Year analysis for ${targetColumn}:\n`;
      }
      
      const previewRows = [];
      const growthPercentages = [];
      
      for (let i = 1; i < years.length; i++) {
        const currentYear = years[i];
        const prevYear = years[i - 1];
        const currentVal = yearlySums[currentYear];
        const prevVal = yearlySums[prevYear];
        const diff = currentVal - prevVal;
        const pct = prevVal !== 0 ? (diff / Math.abs(prevVal)) * 100 : 0;
        growthPercentages.push(pct);
        
        comparisonText += `• ${currentYear} vs ${prevYear}: ${formatValue(currentVal, locale, targetColumn)} vs ${formatValue(prevVal, locale, targetColumn)} `;
        comparisonText += `(${diff >= 0 ? "+" : ""}${formatValue(diff, locale, targetColumn)}, ${diff >= 0 ? "+" : ""}${pct.toFixed(2)}%)\n`;
        
        previewRows.push({ year: currentYear, value: currentVal, previous_year: prevYear, previous_value: prevVal, change: diff, change_percent: pct });
      }

      // Add Summary Insights
      const avgGrowth = growthPercentages.reduce((a, b) => a + b, 0) / growthPercentages.length;
      const bestYear = [...previewRows].sort((a, b) => b.change_percent - a.change_percent)[0];
      
      if (locale.startsWith("uk")) {
        comparisonText += `\n**Підсумок:**\n`;
        comparisonText += `• Середньорічне зростання: ${avgGrowth >= 0 ? "+" : ""}${avgGrowth.toFixed(2)}%\n`;
        comparisonText += `• Кращий рік: ${bestYear.year} (${avgGrowth >= 0 ? "+" : ""}${bestYear.change_percent.toFixed(2)}% зростання)`;
      } else if (locale.startsWith("ru")) {
        comparisonText += `\n**Итог:**\n`;
        comparisonText += `• Среднегодовой рост: ${avgGrowth >= 0 ? "+" : ""}${avgGrowth.toFixed(2)}%\n`;
        comparisonText += `• Лучший год: ${bestYear.year} (${avgGrowth >= 0 ? "+" : ""}${bestYear.change_percent.toFixed(2)}% роста)`;
      } else {
        comparisonText += `\n**Summary:**\n`;
        comparisonText += `• Average Annual Growth: ${avgGrowth >= 0 ? "+" : ""}${avgGrowth.toFixed(2)}%\n`;
        comparisonText += `• Best Performing Year: ${bestYear.year} (${avgGrowth >= 0 ? "+" : ""}${bestYear.change_percent.toFixed(2)}% growth)`;
      }

      return { answer: comparisonText.trim(), previewRows };
    }
  }

  if (groupBy && ["max", "min", "top_n", "sum", "avg"].includes(effectiveOp)) {
    const grouped = {};
    const counts = {};
    rows.forEach((r) => {
      const key = String(r?.[groupBy] ?? "Unknown");
      const val = toNum(r?.[targetColumn]);
      if (val === null) return;
      
      if (effectiveOp === "max") {
        if (grouped[key] === undefined || val > grouped[key]) grouped[key] = val;
      } else if (effectiveOp === "min") {
        if (grouped[key] === undefined || val < grouped[key]) grouped[key] = val;
      } else {
        grouped[key] = (grouped[key] || 0) + val;
        counts[key] = (counts[key] || 0) + 1;
      }
    });

    const sorted = Object.entries(grouped)
      .map(([label, value]) => {
        const finalValue = (effectiveOp === "avg" && counts[label]) ? value / counts[label] : value;
        return { label, value: finalValue };
      })
      .sort((a, b) => b.value - a.value);

    if (!sorted.length) return { answer: "No matching data.", previewRows: [] };

    if (effectiveOp === "max") {
      return { answer: `Highest ${targetColumn}: ${sorted[0].label} with ${formatValue(sorted[0].value, locale, targetColumn)}`, previewRows: sorted.slice(0, 10) };
    }
    if (effectiveOp === "min") {
      const bottom = [...sorted].sort((a, b) => a.value - b.value)[0];
      return { answer: `Lowest ${targetColumn}: ${bottom.label} with ${formatValue(bottom.value, locale, targetColumn)}`, previewRows: [...sorted].sort((a, b) => a.value - b.value).slice(0, 10) };
    }

    if (nLimit === 1) {
      return { 
        answer: `The top ${groupBy} by ${targetColumn} is ${sorted[0].label} with ${formatValue(sorted[0].value, locale, targetColumn)}.`,
        previewRows: sorted.slice(0, 1)
      };
    }

    return {
      answer: `Top ${nLimit} ${groupBy} by ${targetColumn}:\n` + sorted.slice(0, nLimit).map((x, i) => `${i + 1}. ${x.label}: ${formatValue(x.value, locale, targetColumn)}`).join("\n"),
      previewRows: sorted.slice(0, nLimit)
    };
  }

  const nums = rows.map((r) => toNum(r?.[targetColumn])).filter((n) => n !== null);
  if (!nums.length) return { answer: `No numeric data found in ${targetColumn}.`, previewRows: rows.slice(0, 15) };
  
  if (effectiveOp === "sum") return { answer: `Total ${targetColumn}: ${formatValue(nums.reduce((a, b) => a + b, 0), locale, targetColumn)}`, previewRows: rows.slice(0, 15) };
  if (effectiveOp === "avg") return { answer: `Average ${targetColumn}: ${formatValue(nums.reduce((a, b) => a + b, 0) / nums.length, locale, targetColumn)}`, previewRows: rows.slice(0, 15) };
  
  if (effectiveOp === "max") {
    let max = -Infinity;
    for (let i = 0; i < nums.length; i++) if (nums[i] > max) max = nums[i];
    return { answer: `Max ${targetColumn}: ${formatValue(max, locale, targetColumn)}`, previewRows: rows.slice(0, 15) };
  }
  if (effectiveOp === "min") {
    let min = Infinity;
    for (let i = 0; i < nums.length; i++) if (nums[i] < min) min = nums[i];
    return { answer: `Min ${targetColumn}: ${formatValue(min, locale, targetColumn)}`, previewRows: rows.slice(0, 15) };
  }
  return { answer: "", previewRows: rows.slice(0, 15) };
}

const CACHE_TTL = 300000; // 5 minutes

async function loadSemanticBrain() {
    const now = Date.now();
    if (SEMANTIC_CACHE && RATIO_CACHE && (now - CACHE_TS < CACHE_TTL)) {
        return { buckets: SEMANTIC_CACHE, ratios: RATIO_CACHE };
    }

    try {
        const dictRows = await query(`SELECT category, synonym FROM semantic_dictionary WHERE group_id IS NULL`, []);
        const ratioRows = await query(`SELECT name, match_pattern as match, formula_type as format, required_buckets as buckets FROM financial_ratios WHERE group_id IS NULL`, []);

        const bucketsMap = {};
        dictRows.forEach(r => {
            const cat = String(r.category || "").toLowerCase();
            if (!bucketsMap[cat]) bucketsMap[cat] = { key: cat, synonyms: [] };
            bucketsMap[cat].synonyms.push(String(r.synonym || "").toLowerCase());
        });

        SEMANTIC_CACHE = Object.values(bucketsMap);
        RATIO_CACHE = ratioRows.map(r => ({
            ...r,
            match: new RegExp(r.match, 'i'),
            calc: (vals) => {
                if (r.name === 'Gross Margin') return ((vals[0] - vals[1]) / (vals[0] || 1)) * 100;
                if (r.name === 'Free Cash Flow') return vals[0] - vals[1];
                if (r.name === 'Burn Rate') return vals[0] / (vals[1] || 1);
                if (r.name === 'DSO') return (vals[0] / (vals[1] || 1)) * 365;
                if (r.name === 'Current Ratio') return vals[0] / (vals[1] || 1);
                if (r.name === 'Revenue per Employee') return vals[0] / (vals[1] || 1);
                return 0;
            }
        }));
        CACHE_TS = now;
        return { buckets: SEMANTIC_CACHE, ratios: RATIO_CACHE };
    } catch (e) {
        console.error("Failed to load semantic brain:", e);
        return { buckets: SEMANTIC_CACHE || [], ratios: RATIO_CACHE || [] };
    }
}

async function resolveColumn(headers, aiName, sampleRows = []) {
  if (!aiName || !headers.length) return null;
  const target = String(aiName).toLowerCase().trim();

  const direct = headers.find(h => String(h).toLowerCase() === target);
  if (direct) return direct;

  const { buckets } = await loadSemanticBrain();

  for (const bucket of buckets) {
    if (bucket.synonyms.some(s => target.includes(s) || s.includes(target))) {
        for (const synonym of bucket.synonyms) {
            const found = headers.find(h => String(h).toLowerCase().includes(synonym));
            if (found) return found;
        }
    }
  }

  // 3. Smart Fallback: If AI is asking for a date/number and we found no name match, check data patterns
  if (sampleRows.length > 0) {
    const isTargetDate = /date|year|period|month|рік|год|дата/i.test(target);
    const isTargetNumeric = /revenue|income|cost|expense|profit|amount|value|доход|расход|витрати/i.test(target);

    if (isTargetDate) {
      const bestDateCol = headers.find(h => {
        const sample = sampleRows.slice(0, 10).map(r => r[h]);
        return sample.filter(v => parseDateValue(v) !== null).length > sample.length / 2;
      });
      if (bestDateCol) return bestDateCol;
    }

    if (isTargetNumeric) {
      const bestNumCol = headers.find(h => {
        const sample = sampleRows.slice(0, 10).map(r => r[h]);
        return sample.filter(v => toNum(v) !== null).length > sample.length / 2;
      });
      if (bestNumCol) return bestNumCol;
    }
  }

  return headers.find(h => String(h).toLowerCase().includes(target)) || null;
}


function applyFilters(rows, filters) {
    if (!filters?.length) return rows;
    return rows.filter(row => {
        return filters.every(f => {
            const val = toNum(row[f.column]);
            const filterVal = toNum(f.value);
            const cellStr = String(row[f.column] || "").toLowerCase();
            const searchStr = String(f.value || "").toLowerCase();
            
            switch(f.operator) {
                case 'equals': return cellStr === searchStr;
                case 'gt': return val !== null && filterVal !== null && val > filterVal;
                case 'gte': return val !== null && filterVal !== null && val >= filterVal;
                case 'lt': return val !== null && filterVal !== null && val < filterVal;
                case 'lte': return val !== null && filterVal !== null && val <= filterVal;
                default: return cellStr.includes(searchStr);
            }
        });
    });
}

function cleanAITechnicalNoise(text = "") {
  let out = String(text || "");
  // Remove technical sheet references only if they match exactly (e.g., Sheet1, Sheet2.00)
  out = out.replace(/\bSheet\d+(\.00)?\b/gi, "");
  // Remove empty-tab artifact phrases that can be left behind after sheet token stripping.
  out = out.replace(/\b(?:this is based on the data from|based on data from)\s*''\s*tab\.?/gi, "");
  // Remove specific technical version suffix .00 if it's isolated (not part of a currency/number)
  out = out.replace(/\s\.00\b/g, "");
  
  // Clean up any double spaces or isolated punctuation left behind
  return out.replace(/\s{2,}/g, " ").replace(/\s\./g, ".").trim();
}

function formatAnswerWithBullets(answer = "") {
  const text = typeof answer === "string" ? answer.trim() : "";
  if (!text) return "";
  // Do not auto-bullet plain numeric prose with decimals; it can split values like 34.91 into 34 + 91.
  if (!text.includes("\n") && /\d\.\d/.test(text)) return text;
  const normalizedExistingBullets = text
    .replace(/^\s*[-*]\s+/gm, "• ")
    .replace(/\n\s*[-*]\s+/g, "\n• ");
  if (normalizedExistingBullets.includes("\n• ") || normalizedExistingBullets.match(/\n\d+\.\s/)) return normalizedExistingBullets;

  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 1 && text.length > 100) {
    const sentences = text.match(/[^.!?]+[.!?]+/g);
    if (sentences && sentences.length > 1) {
      return `${sentences[0].trim()}\n${sentences.slice(1).map(s => `• ${s.trim()}`).join("\n")}`;
    }
  }
  if (lines.length < 2) return text;
  const hasListMarkers = lines.some((l) => /^([-*]\s+|\d+\.\s+)/.test(l));
  if (hasListMarkers) return normalizedExistingBullets;
  if (lines[0].endsWith(":")) return `${lines[0]}\n${lines.slice(1).map((l) => `• ${l}`).join("\n")}`;
  return lines.map((l) => `• ${l}`).join("\n");
}

function enforceCommaThousands(answer = "") {
  const text = String(answer || "");
  // Convert spaced thousands like "12 000 000" -> "12,000,000"
  // Keep decimal part if present.
  return text.replace(/\b\d{1,3}(?:\s\d{3})+(?:[.,]\d+)?\b/g, (raw) => {
    const compact = raw.replace(/\s+/g, "");
    const hasComma = compact.includes(",");
    const hasDot = compact.includes(".");
    if (hasComma && hasDot) {
      // treat commas as thousands separators and keep decimal dot
      const [intPart, decPart] = compact.split(".");
      return `${intPart.replace(/,/g, ",")}.${decPart}`;
    }
    if (hasComma || hasDot) {
      const sep = hasDot ? "." : ",";
      const idx = compact.lastIndexOf(sep);
      const intPart = compact.slice(0, idx).replace(/[.,]/g, "");
      const decPart = compact.slice(idx + 1);
      return `${Number(intPart).toLocaleString("en-US")}.${decPart}`;
    }
    return Number(compact).toLocaleString("en-US");
  });
}

function normalizeDatesAndRemoveTime(answer = "") {
  let text = String(answer || "");
  // Remove common time/timezone fragments.
  text = text
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?\b/gi, "")
    .replace(/\b(?:UTC|GMT)\s*[+-]?\d{0,2}:?\d{0,2}\b/gi, "")
    .replace(/\b(?:EST|EDT|PST|PDT|CST|CDT|MST|MDT)\b/gi, "")
    .replace(/\s{2,}/g, " ");

  // YYYY-MM-DD -> MM-DD-YYYY
  text = text.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (_, y, m, d) => `${m}-${d}-${y}`);
  // YYYY/MM/DD -> MM-DD-YYYY
  text = text.replace(/\b(\d{4})\/(\d{2})\/(\d{2})\b/g, (_, y, m, d) => `${m}-${d}-${y}`);
  // MM/DD/YYYY or DD/MM/YYYY -> MM-DD-YYYY (assume first token is month by product rule)
  text = text.replace(/\b(\d{2})\/(\d{2})\/(\d{4})\b/g, (_, m, d, y) => `${m}-${d}-${y}`);

  return text.replace(/\s{2,}/g, " ").trim();
}

function enforceTwoDecimals(answer = "") {
  const text = String(answer || "");
  // Format numeric tokens (currency/percent/decimals) to 2 decimals.
  // We use a negative lookbehind (if supported) or logic to skip list indices like "1. "
  return text.replace(/([$-]?\d[\d,]*)(\.\d+)?(%?)/g, (raw, intPart, decPart, suffix, offset, fullString) => {
    // 1. Skip if it's a list index: check if it's at start of string or preceded by newline/bullet AND followed by a dot + space
    const before = fullString.slice(Math.max(0, offset - 2), offset);
    const after = fullString.slice(offset + intPart.length, offset + intPart.length + 2);
    const isAtLineStart = offset === 0 || /[\n•]/.test(before);
    if (isAtLineStart && after === ". ") return raw;

    // 2. Skip 4-digit years (isolated)
    const compact = String(intPart).replace(/[$,]/g, "");
    if (/^\d{4}$/.test(compact) && !decPart && !suffix) return raw;

    const n = Number(compact + (decPart || ""));
    if (!Number.isFinite(n)) return raw;
    
    // Only apply if it's monetary, a percentage, or already has a decimal
    if (!String(intPart).includes("$") && !suffix && !decPart) return raw;

    const sign = n < 0 ? "-" : "";
    const abs = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const currency = String(intPart).includes("$") ? "$" : "";
    return `${sign}${currency}${abs}${suffix || ""}`;
  });
}

function stripApproximationWords(answer = "") {
  return String(answer || "")
    .replace(/\b(approximately|approx\.?|about)\b/gi, "")
    .replace(/\b(примерно|около)\b/gi, "")
    .replace(/\b(приблизно|близько)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function looksLikeDateHeader(header = "") {
  return /date|time|day|month|year|period|quarter/i.test(String(header));
}

function detectDateSyntax(value) {
  const s = String(value || "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return "YYYY-MM-DD";
  if (/^\d{2}-\d{2}-\d{4}$/.test(s)) {
    const [a, b] = s.split("-").map(Number);
    if (a > 12 && b <= 12) return "DD-MM-YYYY";
    if (b > 12 && a <= 12) return "MM-DD-YYYY";
    return "MM-DD-YYYY or DD-MM-YYYY";
  }
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
    const [a, b] = s.split("/").map(Number);
    if (a > 12 && b <= 12) return "DD/MM/YYYY";
    if (b > 12 && a <= 12) return "MM/DD/YYYY";
    return "MM/DD/YYYY or DD/MM/YYYY";
  }
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(s)) return "YYYY/MM/DD";
  if (/^[A-Za-z]{3,9}\s+\d{1,2},\s+\d{4}$/.test(s)) return "Month DD, YYYY";
  return null;
}

function buildDateFormatHints(headers = [], rows = []) {
  const hints = [];
  headers.forEach((h) => {
    if (!looksLikeDateHeader(h)) return;
    const values = rows
      .slice(0, 300)
      .map((r) => r?.[h])
      .filter((v) => v !== null && v !== undefined && String(v).trim() !== "");
    if (!values.length) return;
    const bySyntax = new Map();
    values.forEach((v) => {
      const syntax = detectDateSyntax(v);
      if (!syntax) return;
      bySyntax.set(syntax, (bySyntax.get(syntax) || 0) + 1);
    });
    const winner = Array.from(bySyntax.entries()).sort((a, b) => b[1] - a[1])[0];
    if (!winner) return;
    hints.push({
      column: h,
      syntax: winner[0],
      example: String(values.find((v) => detectDateSyntax(v) === winner[0]) || values[0]),
    });
  });
  return hints;
}

async function callOpenAI({ message, schemaProfile, sampleRows, headers, conversationHistory, locale, dateFormatHints }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("no_api_key");

  const system = [
    "You are a professional financial data analyst AI.",
    "WORKSPACE AWARENESS: You have access to a workspace containing multiple spreadsheets.",
    "CROSS-FILE COMPARISON: If the user asks to compare the current file with another file in the workspace (provided in schema_profile.available_files):",
    " 1. Identify the 'sheet_id' of the comparison file.",
    " 2. Populate the 'cross_targets' array in the response JSON.",
    " 3. Example cross_targets: [{\"sheet_id\": \"id_of_file_a\", \"column\": \"Revenue\", \"operation\": \"sum\"}, {\"sheet_id\": \"id_of_file_b\", \"column\": \"Budget\", \"operation\": \"sum\"}]",
    "Autonomous Self-Teaching: If a user query is vague, missing a metric, or you 'do not know' the question (e.g., 'What's the biggest?'):",
    " 1. Discovery: Scan 'available_columns' and 'sample_rows' for the most significant numeric column (the 'Primary Metric') and the most descriptive text column (the 'Primary Dimension').",
    " 2. Deduction: Assume the user is asking for the Top N or Sum of that Primary Metric grouped by that Primary Dimension.",
    " 3. Explanation: In your 'answer', briefly state: 'I assumed you were asking about [Metric] by [Dimension] based on the data structure.'",
    " 4. Never Fail: Do not ask for clarification if a reasonable business assumption can be made from the data DNA.",
    "User Input: You may receive queries in ANY language (English, Russian, Ukrainian, Spanish, etc.).",
    "Conversational Context: Use the 'conversation_history' to understand follow-up questions. If a user asks 'what about 2022?', use previous context to know they mean 'Total Revenue' or whatever was previously discussed.",
    "Internal Mapping: Regardless of the query language, map the user's concepts to the 'available_columns'.",
    "Return ONLY valid JSON.",
    "Language: Always provide 'answer' in the requested output_locale, regardless of the user's message language.",
    "Internal Logic: Map user terms to available_columns for operations, but keep final explanation in output_locale.",
    "Date handling: Always output dates as MM-DD-YYYY.",
    "Date handling: Never include time values or timezone references.",
    "Quarter handling: Interpret Q1/Q2/Q3/Q4 as quarter periods.",
    "Quarter handling: Also interpret localized quarter aliases as Q1..Q4 (e.g., квартал 1/2/3/4, 1 квартал, I/II/III/IV квартал).",
    "Conversational Rule: ALWAYS include the filter context (e.g., the year, category, or period) in your final 'answer' string. Never just say 'Total Revenue: $X', say 'Total Revenue for 2023: $X'.",
    "Language rule for quarter wording: use the English word 'quarter' only in English output.",
    "Language rule for quarter wording: in Russian use 'квартал', in Ukrainian use 'квартал/кварталу' as grammatically appropriate.",
    "Number formatting: Use grouped numbers with thousands separators in the final answer (example: 12,345.67).",
    "Rounding rule: Always present numeric calculation results with exactly 2 decimal places.",
    "Do not describe numeric values as approximate.",
    "Do not mention tab names (e.g., 'Sheet1'), row counts, internal indices, or '.00' version suffixes in your answer.",
    "Do not shorten values into compact forms like K/M/B unless user explicitly asks.",
    "Use only numeric values that can be derived from the provided spreadsheet rows.",
    "Never invent numbers, never estimate, and never substitute generic sample values.",
    "If exact numeric evidence is unavailable, clearly say data is unavailable instead of guessing.",
    "Semantic Operations Map:",
    " - 'top_n': Use for 'drivers', 'who spent most', 'biggest segments', 'which category is highest'. Requires 'group_by'.",
    " - 'sum': Use for 'totals', 'all revenue', 'combined cost'.",
    " - 'avg': Use for 'averages', 'mean', 'per transaction'.",
    " - 'year_over_year': Use for YoY, annual growth, comparison with prior year, 'годовое исчисление', 'річне обчислення', 'г/г', 'р/р'.",
    "Supported operations: none, filter, reset, count, sum, avg, max, min, top_n, year_over_year.",
    "IMPORTANT: Only use operation: 'filter' when user explicitly says 'Show', 'Filter', 'Find', or 'View only'.",
    "IMPORTANT: Always use operation: 'year_over_year' for any annual comparison, YoY analysis, or growth metrics between years.",
    "Use bullet points for multiple findings or drivers.",
    "Include concrete numbers and business names in explanations.",
  ].join(" ");

  const userPrompt = {
    question: message,
    output_locale: normalizeLocale(locale || "en"),
    quarter_aliases: [
      "Q1 = first quarter",
      "Q2 = second quarter",
      "Q3 = third quarter",
      "Q4 = fourth quarter",
      "квартал 1 / 1 квартал / I квартал = Q1",
      "квартал 2 / 2 квартал / II квартал = Q2",
      "квартал 3 / 3 квартал / III квартал = Q3",
      "квартал 4 / 4 квартал / IV квартал = Q4"
    ],
    conversation_history: conversationHistory,
    available_columns: headers,
    date_format_hints: dateFormatHints || [],
    schema_profile: schemaProfile,
    sample_rows: sampleRows,
    output_schema: {
      answer: "string",
      operation: "none|filter|reset|count|sum|avg|max|min|top_n|year_over_year",
      target_tab: "string|null",
      target_column: "string|null",
      group_by: "string|null",
      limit: "number|null",
      filters: [{ column: "string", operator: "contains|equals|gt|gte|lt|lte", value: "string|number" }],
      chart: { date_column: "string", value_column: "string", segment_by: "string|null", aggregation: "sum|avg" },
      cross_talk: "boolean",
      cross_targets: [{ sheet_id: "string", column: "string", operation: "sum|avg|count|max|min" }]
    }
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
  const isReasoningModel = OPENAI_MODEL.startsWith("o");

  let resp;
  try {
    resp = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: isReasoningModel ? 1 : 0.1,
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: system }, { role: "user", content: JSON.stringify(userPrompt) }]
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`openai_request_failed:${text.slice(0, 300)}`);
  }
  const json = await resp.json();
  const content = json?.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") {
    throw new Error("openai_invalid_response");
  }
  return JSON.parse(content);
}

function normalizeToken(value = "") {
  return String(value || "").toLowerCase().replace(/[^a-z0-9а-яёіїєґ]+/gi, " ").trim();
}

function resolveTabName(tabNames = [], requestedTab = null) {
  if (!requestedTab || !tabNames.length) return null;
  const raw = String(requestedTab).trim();
  if (!raw) return null;
  const exact = tabNames.find((t) => String(t).toLowerCase() === raw.toLowerCase());
  if (exact) return exact;
  const normalized = normalizeToken(raw);
  if (!normalized) return null;
  const loose = tabNames.find((t) => normalizeToken(t).includes(normalized) || normalized.includes(normalizeToken(t)));
  return loose || null;
}

function inferTabFromMessage(tabNames = [], message = "") {
  if (!tabNames.length || !message) return null;
  const m = normalizeToken(message);
  if (!m) return null;
  let best = null;
  let bestLen = 0;
  for (const tab of tabNames) {
    const n = normalizeToken(tab);
    if (!n) continue;
    if ((m.includes(n) || n.includes(m)) && n.length > bestLen) {
      best = tab;
      bestLen = n.length;
    }
  }
  return best;
}

function buildTabDatasets(rows = [], fallbackHeaders = [], tabNames = []) {
  const byTab = new Map();
  rows.forEach((row) => {
    const tab = String(row?.__tab_name || "").trim() || tabNames[0] || "Sheet1";
    if (!byTab.has(tab)) byTab.set(tab, []);
    const out = { ...(row || {}) };
    delete out.__tab_name;
    byTab.get(tab).push(out);
  });
  tabNames.forEach((tab) => {
    if (!byTab.has(tab)) byTab.set(tab, []);
  });
  if (!byTab.size) byTab.set(tabNames[0] || "Sheet1", []);

  const datasets = {};
  for (const [tab, tabRows] of byTab.entries()) {
    let headers = [];
    const row0 = tabRows[0];
    if (row0 && typeof row0 === "object") headers = Object.keys(row0);
    if (!headers.length) headers = Array.isArray(fallbackHeaders) ? [...fallbackHeaders] : [];
    datasets[tab] = { headers, rows: tabRows };
  }
  return datasets;
}

function normalizeSlavicGroupedNumbers(text = "") {
  // Convert en-US grouped numbers into slavic-friendly spoken format:
  // 12,000,000.50 -> 12 000 000,50
  return String(text || "").replace(/\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b/g, (m) => {
    const [intPart, decPart] = m.split(".");
    const grouped = intPart.replace(/,/g, " ");
    return decPart ? `${grouped},${decPart}` : grouped;
  });
}

function expandLargeIntForEnglishSpeech(rawDigits = "") {
  const digits = String(rawDigits || "").replace(/[^\d]/g, "");
  if (!digits) return "0";
  const n = Number(digits);
  if (!Number.isFinite(n)) return digits;
  if (n >= 1_000_000_000) {
    const b = Math.floor(n / 1_000_000_000);
    const m = Math.floor((n % 1_000_000_000) / 1_000_000);
    const k = Math.floor((n % 1_000_000) / 1_000);
    const r = n % 1_000;
    return [b ? `${b} billion` : "", m ? `${m} million` : "", k ? `${k} thousand` : "", r ? `${r}` : ""].filter(Boolean).join(" ");
  }
  if (n >= 1_000_000) {
    const m = Math.floor(n / 1_000_000);
    const k = Math.floor((n % 1_000_000) / 1_000);
    const r = n % 1_000;
    return [m ? `${m} million` : "", k ? `${k} thousand` : "", r ? `${r}` : ""].filter(Boolean).join(" ");
  }
  if (n >= 1_000) {
    const k = Math.floor(n / 1_000);
    const r = n % 1_000;
    return [k ? `${k} thousand` : "", r ? `${r}` : ""].filter(Boolean).join(" ");
  }
  return String(n);
}

function naturalizeNumbersForTTS(text = "", locale = "en") {
  let out = String(text || "");
  const lang = (locale || "en").split("-")[0].toLowerCase();

  // 1. Strip technical noise and formatting
  out = out.replace(/[•*]/g, ""); // bullets
  out = out.replace(/(\n|^)\s*[-–—]\s+/g, "$1 "); // leading dashes
  out = out.replace(/\.00(?!\d)/g, ""); // trailing .00 decimals
  out = out.replace(/\bUSD\b/gi, lang === "ru" ? "долларов" : (lang === "uk" ? "доларів" : "dollars"));

  if (lang === "uk") {
    // Normalize currency without cents for cleaner speech output.
    out = out.replace(/\$([\d,]+)\.(\d{1,2})\b/g, (m, price, centsRaw) => {
      const p = String(price || "").replace(/,/g, "");
      return `${p} доларів`;
    });
    // Drop decimal tails in spoken output (e.g. 1,927,022.22 -> 1,927,022)
    out = out.replace(/(\d[\d,\s]*)[.,]\d{1,2}\b/g, "$1");
    out = out.replace(/\bvs\b/gi, "проти");
    out = out.replace(/\bNet Income\b/gi, "Прибуток");
    out = out.replace(/\bNet Revenue\b/gi, "Чистий виторг");
    out = out.replace(/\bRevenue\b/gi, "Виторг");
    out = out.replace(/\btab\b/gi, "вкладка");
    out = out.replace(/\$([\d,.\s]+)\b/g, "$1 доларів");
  } else if (lang === "ru") {
    // Normalize currency without cents for cleaner speech output.
    out = out.replace(/\$([\d,]+)\.(\d{1,2})\b/g, (m, price, centsRaw) => {
      const p = String(price || "").replace(/,/g, "");
      return `${p} долларов`;
    });
    // Drop decimal tails in spoken output (e.g. 1,927,022.22 -> 1,927,022)
    out = out.replace(/(\d[\d,\s]*)[.,]\d{1,2}\b/g, "$1");
    out = out.replace(/\bvs\b/gi, "против");
    out = out.replace(/\bNet Income\b/gi, "Чистая прибыль");
    out = out.replace(/\bNet Revenue\b/gi, "Чистая выручка");
    out = out.replace(/\bRevenue\b/gi, "Выручка");
    out = out.replace(/\btab\b/gi, "вкладка");
    out = out.replace(/\$([\d,.\s]+)\b/g, "$1 долларов");
  } else {
    // English defaults
    out = out.replace(/\bvs\b/gi, "versus");
    // Handle currency with cents: $1,234.56 or $1234.56
    out = out.replace(/\$([\d,]+)\.(\d{2})\b/g, (m, price, cents) => {
        const p = price.replace(/,/g, "");
        const spoken = expandLargeIntForEnglishSpeech(p);
        return `${spoken} dollars and ${parseInt(cents, 10)} cents`;
    });
    // Handle currency without cents: $1,234
    out = out.replace(/\$([\d,.]+)\b/g, (m, price) => {
        const p = String(price || "").replace(/[^\d]/g, "");
        const spoken = expandLargeIntForEnglishSpeech(p);
        return `${spoken} dollars`;
    });
    // Handle large plain numbers that may be read digit-by-digit by TTS.
    out = out.replace(/\b\d{5,}\b/g, (m) => expandLargeIntForEnglishSpeech(m));
    // Final expansion for large numbers to help TTS (e.g. 52,026,091 -> 52 million 26 thousand 91)
    // We parse as int to strip leading zeros like "026" -> "26"
    out = out.replace(/\b(\d{1,3}),(\d{3}),(\d{3})\b/g, (m, mill, thou, rest) => {
        return `${mill} million ${parseInt(thou, 10)} thousand ${parseInt(rest, 10)}`;
    });
    out = out.replace(/\b(\d{1,3}),(\d{3})\b/g, (m, thou, rest) => {
        return `${parseInt(thou, 10)} thousand ${parseInt(rest, 10)}`;
    });
    
    out = out.replace(/(\d+(?:\.\d+)?)%/g, "$1 percent");
    out = out.replace(/\(\+/g, "(plus ");
    out = out.replace(/\(\-/g, "(minus ");
  }

  return out;
}

function getSlavicPlural(n, forms) {
  const num = Math.abs(Number(n) || 0);
  const mod10 = num % 10;
  const mod100 = num % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

function slavicNumberToWords(n, lang = "ru", gender = "m") {
  const num = Math.floor(Math.abs(Number(n) || 0));
  const dict = lang === "uk"
    ? {
      zero: "нуль",
      onesM: ["", "один", "два", "три", "чотири", "п'ять", "шість", "сім", "вісім", "дев'ять"],
      onesF: ["", "одна", "дві", "три", "чотири", "п'ять", "шість", "сім", "вісім", "дев'ять"],
      teens: ["десять", "одинадцять", "дванадцять", "тринадцять", "чотирнадцять", "п'ятнадцять", "шістнадцять", "сімнадцять", "вісімнадцять", "дев'ятнадцять"],
      tens: ["", "", "двадцять", "тридцять", "сорок", "п'ятдесят", "шістдесят", "сімдесят", "вісімдесят", "дев'яносто"],
      hundreds: ["", "сто", "двісті", "триста", "чотириста", "п'ятсот", "шістсот", "сімсот", "вісімсот", "дев'ятсот"],
      thousandForms: ["тисяча", "тисячі", "тисяч"],
      millionForms: ["мільйон", "мільйони", "мільйонів"]
    }
    : {
      zero: "ноль",
      onesM: ["", "один", "два", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"],
      onesF: ["", "одна", "две", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"],
      teens: ["десять", "одиннадцать", "двенадцать", "тринадцать", "четырнадцать", "пятнадцать", "шестнадцать", "семнадцать", "восемнадцать", "девятнадцать"],
      tens: ["", "", "двадцать", "тридцать", "сорок", "пятьдесят", "шестьдесят", "семьдесят", "восемьдесят", "девяносто"],
      hundreds: ["", "сто", "двести", "триста", "четыреста", "пятьсот", "шестьсот", "семьсот", "восемьсот", "девятьсот"],
      thousandForms: ["тысяча", "тысячи", "тысяч"],
      millionForms: ["миллион", "миллиона", "миллионов"]
    };

  const tripleToWords = (value, tripleGender = "m") => {
    if (!value) return "";
    const h = Math.floor(value / 100);
    const t = Math.floor((value % 100) / 10);
    const u = value % 10;
    const parts = [];
    if (h) parts.push(dict.hundreds[h]);
    if (t === 1) {
      parts.push(dict.teens[u]);
    } else {
      if (t > 1) parts.push(dict.tens[t]);
      if (u) parts.push((tripleGender === "f" ? dict.onesF : dict.onesM)[u]);
    }
    return parts.join(" ");
  };

  if (num === 0) return dict.zero;

  const millions = Math.floor(num / 1_000_000);
  const thousands = Math.floor((num % 1_000_000) / 1_000);
  const rest = num % 1_000;
  const parts = [];

  if (millions) {
    parts.push(tripleToWords(millions, "m"));
    parts.push(getSlavicPlural(millions, dict.millionForms));
  }
  if (thousands) {
    parts.push(tripleToWords(thousands, "f"));
    parts.push(getSlavicPlural(thousands, dict.thousandForms));
  }
  if (rest) {
    parts.push(tripleToWords(rest, gender));
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function expandFinancialTextPhonetically(text = "", lang = "ru") {
    let out = String(text || "");
    const rules = lang === "ru" ? {
        dollars: ["доллар", "доллара", "долларов"],
        cents: ["цент", "цента", "центов"],
        percents: ["процент", "процента", "процентов"]
    } : {
        dollars: ["долар", "долари", "доларів"],
        cents: ["цент", "центи", "центів"],
        percents: ["відсоток", "відсотки", "відсотків"]
    };

    // 1. Consolidate numbers first: "52 026 091" -> "52026091"
    out = out.replace(/\b(\d{1,3})[\s,](\d{3})[\s,](\d{3})\b/g, "$1$2$3");
    out = out.replace(/\b(\d{1,3})[\s,](\d{3})\b/g, "$1$2");

    // 2. Handle Currency Units
    out = out.replace(/(\d+)\s?(доларів|долларов)/g, (m, num) => {
        const n = parseInt(num, 10);
        return slavicNumberToWords(n, lang, "m") + " " + getSlavicPlural(n, rules.dollars);
    });
    out = out.replace(/(\d+)\s?(центів|центов)/g, (m, num) => {
        const n = parseInt(num, 10);
        return slavicNumberToWords(n, lang, "m") + " " + getSlavicPlural(n, rules.cents);
    });

    // 3. Handle Percentages
    out = out.replace(/(\d+)\s?(відсотків|процентов)/g, (m, num) => {
        const n = parseInt(num, 10);
        return slavicNumberToWords(n, lang, "m") + " " + getSlavicPlural(n, rules.percents);
    });

    // 4. Handle all other standalone numbers (except years)
    out = out.replace(/\b(\d{1,3}|\d{5,})\b/g, (m, num) => {
        const n = parseInt(num, 10);
        if (n > 2000 && n < 2100) return m; // leave years alone
        return slavicNumberToWords(n, lang, "m");
    });

    return out;
}

export async function getChatAudio(req, res) {
  let { text, locale } = req.body;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !text) return res.status(400).json({ error: "missing_params" });
  if (String(text).length > CHAT_AUDIO_MAX_CHARS) {
    return res.status(413).json({ error: "text_too_large", maxChars: CHAT_AUDIO_MAX_CHARS });
  }

  // Strip Markdown markers before TTS
  text = text.replace(/\*/g, "");

  let voice = "nova"; 
  const lang = (locale || "en").split("-")[0].toLowerCase();
  if (lang === "es") voice = "shimmer"; 
  if (lang === "uk") voice = "nova";
  if (lang === "ru") voice = "nova";
  
  let cleanedText = naturalizeNumbersForTTS(text, locale);
  
  if (lang === "uk" || lang === "ru") {
      // Convert all remaining digits to Cyrillic words to force native accent
      cleanedText = expandFinancialTextPhonetically(cleanedText, lang);
      // Absolute final safety: remove ALL Latin characters so TTS engine can't switch to English accent
      cleanedText = cleanedText.replace(/[a-zA-Z]/g, "");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

  try {
    const response = await fetch(`${OPENAI_BASE_URL}/audio/speech`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({ 
        model: lang === "en" ? "tts-1" : "tts-1-hd", 
        input: cleanedText, 
        voice,
        speed: 0.9
      }),
    });
    if (!response.ok) {
      const message = await response.text().catch(() => "");
      return res.status(502).json({
        error: "tts_upstream_error",
        message: message.slice(0, 300) || `upstream_status_${response.status}`,
      });
    }
    if (!response.body) {
      return res.status(502).json({ error: "tts_empty_response" });
    }

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Transfer-Encoding", "chunked");
    const reader = response.body.getReader();
    function push() {
        reader.read().then(({ done, value }) => {
            if (done) { res.end(); return; }
            res.write(Buffer.from(value));
            push();
        }).catch(err => { res.end(); });
    }
    push();
  } catch (e) {
    const isAbort = e?.name === "AbortError";
    res.status(isAbort ? 504 : 500).json({ error: isAbort ? "tts_timeout" : "internal_server_error" });
  } finally {
    clearTimeout(timeout);
  }
}

export async function chatQuery(req, res) {
  const { sheetId, activeTab = null, message, conversationHistory = [], locale: rawLocale } = req.body || {};
  const locale = normalizeLocale(rawLocale || "en");
  const hasAccess = await checkSheetAccess(sheetId, req.user);
  if (!hasAccess) return res.status(403).json({ error: "Forbidden" });

  // PERF-01: Load only SAMPLE rows for AI context, not all 500k rows
  const loadedSample = await loadAccessibleRows(sheetId, req.user, null, 100);
  if (loadedSample?.forbidden) return res.status(403).json({ error: "Forbidden" });

  const aiHeaders = loadedSample.headers || [];
  const sampleRows = loadedSample.rows || [];
  const tabNames = Array.isArray(loadedSample.tabs) ? loadedSample.tabs : [];
  
  // PERF-01: Build Workspace Schema for Cross-Sheet Intelligence
  const workspaceRes = await query(
      `SELECT s.id, s.display_name, s.filename, s.headers 
       FROM sheets s 
       WHERE (s.id IN (SELECT sheet_id FROM permissions WHERE user_id = $1) OR $2 = 'admin')`,
      [req.user.id, req.user.role]
  );
  const availableFiles = workspaceRes.map(f => ({
      id: f.id,
      name: f.display_name || f.filename,
      headers: typeof f.headers === 'string' ? JSON.parse(f.headers) : (f.headers || [])
  }));

  const dateFormatHints = buildDateFormatHints(aiHeaders, sampleRows);

  let ai;
  try {
    ai = await callOpenAI({
      message: `${message}\n\nAvailable tabs: ${tabNames.join(", ") || "N/A"}\nIf the question maps to a specific tab, set target_tab in the JSON response.`,
      headers: aiHeaders,
      sampleRows,
      conversationHistory,
      locale,
      dateFormatHints,
      schemaProfile: { 
          available_tabs: tabNames,
          available_files: availableFiles 
      }
    });
  } catch (e) {
    console.error("OpenAI call failed:", e);
    return res.status(502).json({ error: "ai_unavailable" }); 
  }

  try {
    const selectedTab = resolveTabName(tabNames, ai?.target_tab) || activeTab || null;
    
    // Resolve AI components
    const aiFilters = await Promise.all((ai?.filters || []).map(async f => ({
      column: await resolveColumn(aiHeaders, f.column, sampleRows),
      operator: f.operator || "contains",
      value: f.value
    })));
    const filteredAiFilters = aiFilters.filter(f => f.column);

    let resolvedOperation = (ai?.operation || "none").toLowerCase();
    let resolvedTarget = await resolveColumn(aiHeaders, ai?.target_column, sampleRows);
    let resolvedGroupBy = await resolveColumn(aiHeaders, ai?.group_by, sampleRows);
    
    // --- CROSS-TALK SYNTHESIS ---
    if (ai?.cross_talk && Array.isArray(ai.cross_targets) && ai.cross_targets.length >= 2) {
        const allowedSheetIds = new Set(availableFiles.map((f) => String(f.id)));
        const scopedTargets = ai.cross_targets
          .filter((t) => allowedSheetIds.has(String(t?.sheet_id || "")))
          .slice(0, 2);

        if (scopedTargets.length < 2) {
          return res.status(400).json({ error: "invalid_cross_targets" });
        }

        const results = await Promise.all(scopedTargets.map(async (t) => {
            const res = await computeSqlAggregation({
                sheetId: t.sheet_id,
                user: req.user,
                operation: t.operation || "sum",
                targetColumn: t.column,
                locale
            });
            // Extract numeric value from "Total X: $Y" or similar
            const val = res?.answer ? parseFloat(res.answer.replace(/[^\d.-]/g, "")) : 0;
            const fileName = availableFiles.find(f => String(f.id) === String(t.sheet_id))?.name || "Sheet";
            return { value: val, column: t.column, fileName };
        }));

        const a = results[0];
        const b = results[1];
        const diff = a.value - b.value;
        const pct = b.value !== 0 ? (diff / Math.abs(b.value)) * 100 : 0;
        
        const summary = `${a.fileName} (${a.column}) has ${formatValue(a.value, locale, a.column)}, while ${b.fileName} (${b.column}) has ${formatValue(b.value, locale, b.column)}. \n` +
                        `The difference is ${diff >= 0 ? "+" : ""}${formatValue(diff, locale, a.column)} (${diff >= 0 ? "+" : ""}${pct.toFixed(2)}%).`;
        
        return res.json({
            answer: summary,
            actions: { reset_filters: false, filters: [], chart: null },
            preview_rows: [],
            meta: { operation: "cross_talk", locale, cross_results: results }
        });
    }

    const numericOps = new Set(["count", "sum", "avg", "max", "min", "top_n"]);
    let exec = null;

    if (numericOps.has(resolvedOperation)) {
        exec = await computeSqlAggregation({
            sheetId,
            user: req.user,
            operation: resolvedOperation,
            targetColumn: resolvedTarget,
            groupBy: resolvedGroupBy,
            filters: filteredAiFilters,
            limit: ai?.limit,
            locale,
            tabName: selectedTab
        });
    }

    // Fallback to Memory-Based logic for complex operations like YoY or ratios
    if (!exec) {
        // Only NOW load full rows if we really need to (YoY, custom ratios)
        const fullLoad = await loadAccessibleRows(sheetId, req.user, selectedTab);
        // Note: For memory-based fallback, we might still need augmentation if requested
        const augmented = (resolvedGroupBy === "Year" || resolvedGroupBy === "Month" || resolvedGroupBy === "Quarter")
            ? augmentRowsWithQuarter(fullLoad.rows, fullLoad.headers)
            : { rows: fullLoad.rows, headers: fullLoad.headers };

        const matchedRows = applyFilters(augmented.rows, filteredAiFilters);
        exec = await computeDeterministicAnswer(resolvedOperation, matchedRows, resolvedTarget, resolvedGroupBy, ai?.limit, locale, message);
    }

    const isChartOp = ["chart", "plot", "trend"].includes(ai?.operation);
    const chart = (isChartOp && ai?.chart) ? {
      dateColumn: await resolveColumn(aiHeaders, ai.chart.date_column, sampleRows),
      valueColumn: await resolveColumn(aiHeaders, ai.chart.value_column, sampleRows),
      segmentBy: await resolveColumn(aiHeaders, ai.chart.segment_by, sampleRows),
      aggregation: ai.chart.aggregation || "sum"
    } : null;

    let answer = ai?.answer || exec.answer || "Done.";
    
    if ((numericOps.has(resolvedOperation) || (resolvedOperation === "filter" && !!resolvedTarget)) && exec.answer) {
        const isGenericNoData = exec.answer.includes("No data matched") || exec.answer.includes("no specific metric column");
        if (isGenericNoData && ai?.answer && ai.answer.length > 5) {
            answer = ai.answer;
        } else {
            answer = exec.answer;
        }
    }

    answer = formatAnswerWithBullets(answer);
    answer = cleanAITechnicalNoise(answer);
    answer = stripApproximationWords(answer);
    answer = normalizeDatesAndRemoveTime(answer);
    answer = enforceCommaThousands(answer);
    answer = enforceTwoDecimals(answer);

    res.json({
      answer,
      actions: { reset_filters: ai?.operation === "reset", filters: filteredAiFilters, chart },
      preview_rows: exec.previewRows || [],
      meta: { 
          operation: ai?.operation || "none", 
          locale, 
          selectedTab, 
          resolvedTarget,
          resolvedGroupBy
      }
    });
  } catch (err) {
    console.error("Chat processing failed:", err);
    res.status(500).json({ error: "internal_server_error" });
  }
}

export async function checkSheetAccess(sheetId, user) {
  if (user.role === "admin") return true;
  const res = await query(
    `SELECT COUNT(s.id) FROM sheets s
     LEFT JOIN folders f ON f.id = s.folder_id
     WHERE s.id = $1 AND (
         (
           EXISTS (
             SELECT 1
             FROM folder_groups fg
             JOIN user_groups ug ON ug.group_id = fg.group_id
             WHERE fg.folder_id = f.id AND ug.user_id = $2
           )
           OR f.group_id IN (SELECT group_id FROM user_groups WHERE user_id = $2)
         )
         OR
         (s.id IN (SELECT sheet_id FROM permissions WHERE user_id = $2))
         OR
         (s.id IN (SELECT sheet_id FROM group_permissions WHERE group_id IN (SELECT group_id FROM user_groups WHERE user_id = $2)))
     )`,
    [sheetId, user.id]
  );
  return res?.[0]?.count !== "0";
}

async function loadAccessibleRows(sheetId, user, activeTab = null, rowLimit = null) {
  const sheetRes = await query("SELECT headers, tabs, tab_name FROM sheets WHERE id = $1", [sheetId]);
  if (!sheetRes.length) return { headers: [], tabs: [], rows: [], forbidden: true };
  const sheet = sheetRes[0];

  const folderAccess = await query(
    `SELECT 1 FROM sheets s LEFT JOIN folders f ON f.id = s.folder_id WHERE s.id = $1 AND (EXISTS (SELECT 1 FROM folder_groups fg JOIN user_groups ug ON ug.group_id = fg.group_id WHERE fg.folder_id = f.id AND ug.user_id = $2) OR f.group_id IN (SELECT group_id FROM user_groups WHERE user_id = $2)) LIMIT 1`,
    [sheetId, user.id]
  );
  const hasFullAccess = (user.role === "admin" || folderAccess.length > 0);

  let validCols = null;
  let rowFiltersList = [];

  if (!hasFullAccess) {
    const userPerms = await query("SELECT allowed_columns, row_filters FROM permissions WHERE user_id = $2 AND sheet_id = $1", [sheetId, user.id]);
    const groupPerms = await query(`SELECT gp.allowed_columns, gp.row_filters FROM group_permissions gp JOIN user_groups ug ON ug.group_id = gp.group_id WHERE ug.user_id = $2 AND gp.sheet_id = $1`, [sheetId, user.id]);
    const allPerms = [...userPerms, ...groupPerms];
    if (!allPerms.length) return { headers: [], tabs: [], rows: [], forbidden: true };

    const validSet = new Set();
    allPerms.forEach((p) => {
      const cols = typeof p.allowed_columns === "string" ? JSON.parse(p.allowed_columns) : (p.allowed_columns || []);
      cols.forEach((c) => validSet.add(c));
      const filters = typeof p.row_filters === "string" ? JSON.parse(p.row_filters) : (p.row_filters || {});
      rowFiltersList.push(filters);
    });
    validCols = Array.from(validSet);
    if (!validCols.length) return { headers: [], tabs: [], rows: [], forbidden: true };
  }

  // Build the SQL query for efficient retrieval
  let columnSelection = "row_data";
  const params = [sheetId];
  let where = "WHERE sheet_id = $1";

  if (validCols && !hasFullAccess) {
    columnSelection = `(SELECT jsonb_object_agg(key, value) FROM jsonb_each(row_data) WHERE key = ANY($${params.length + 1}::text[]))`;
    params.push(validCols);
  }

  if (activeTab) {
    where += ` AND tab_name = $${params.length + 1}`;
    params.push(activeTab);
  }

  // Apply RBAC row filters in SQL if not full access
  if (!hasFullAccess && rowFiltersList.length > 0) {
    const filterClauses = [];
    rowFiltersList.forEach(filters => {
        const entries = Object.entries(filters).filter(([k]) => !!k);
        if (entries.length > 0) {
            const groupPredicates = entries.map(([k, v]) => {
                params.push(k, String(v));
                return `(row_data->>$${params.length - 1}) = $${params.length}`;
            });
            filterClauses.push(`(${groupPredicates.join(" AND ")})`);
        }
    });
    if (filterClauses.length > 0) {
        where += ` AND (${filterClauses.join(" OR ")})`;
    }
  }

  let sql = `SELECT ${columnSelection} as row_data, tab_name FROM sheet_rows ${where} ORDER BY row_index ASC`;
  if (rowLimit) {
    sql += ` LIMIT $${params.length + 1}`;
    params.push(rowLimit);
  }

  const rows = await query(sql, params);
  const rawHeaders = sheet.headers;
  let headers = Array.isArray(rawHeaders) ? rawHeaders : (typeof rawHeaders === "string" ? JSON.parse(rawHeaders || "[]") : []);

  if (validCols && !hasFullAccess) {
      headers = headers.filter(h => validCols.includes(h));
  }

  return {
    headers,
    tabs: Array.isArray(sheet.tabs) ? sheet.tabs : (sheet.tab_name ? [sheet.tab_name] : []),
    rows: rows.map(r => ({ ...(r.row_data || {}), __tab_name: r.tab_name })),
    forbidden: false,
  };
}
