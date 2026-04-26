import { createHash } from "crypto";
import { query } from "../config/db.js";
import { isEnglishLocale, normalizeLocale, translateDashboardItems } from "../utils/dashboardLocalization.js";

const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_TIMEOUT_MS = Number.parseInt(process.env.OPENAI_TIMEOUT_MS || "35000", 10);

const CHAT_SAMPLE_ROWS = 600;

function toNum(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (!v) return null;
  const n = parseFloat(String(v).replace(/[$,%\s,]/g, ""));
  return Number.isFinite(n) ? n : null;
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
  const quarterLike = baseHeaders.filter((h) => /quarter|qtr|квартал/i.test(String(h)));
  const dateLike = baseHeaders.filter((h) => /date|time|period|month|year|дата|період/i.test(String(h)));
  const quarterCol = quarterLike[0] || null;
  const dateCol = !quarterCol ? dateLike[0] : null;

  const enriched = rows.map((r) => {
    const row = typeof r === "object" && r ? { ...r } : {};
    let q = null;
    if (quarterCol) q = detectQuarterFromText(row[quarterCol]);
    if (!q && dateCol) {
      const d = parseDateValue(row[dateCol]);
      if (d) q = quarterFromDate(d);
    }
    if (!q) {
      for (const h of baseHeaders) {
        if (q) break;
        q = detectQuarterFromText(row[h]);
      }
    }
    if (q) row.Quarter = q;
    return row;
  });

  const hasQuarter = enriched.some((r) => r && r.Quarter);
  const outHeaders = hasQuarter && !baseHeaders.includes("Quarter")
    ? [...baseHeaders, "Quarter"]
    : baseHeaders;
  return { rows: enriched, headers: outHeaders };
}

function formatValue(v, locale = "en", col = "", forSpeech = false) {
  if (typeof v !== "number" || !Number.isFinite(v)) return String(v ?? "");
  
  const isCurrency = col && /price|cost|revenue|income|profit|earnings|salary|wage|amount|balance|total|summ/i.test(String(col));
  const isPercent = col && /percent|margin|rate|ratio|%/i.test(String(col));

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

function normalizeUkrainianSpeechNumbers(text = "") {
  let out = String(text || "");
  // Expand compact suffixes so TTS reads scale naturally.
  out = out.replace(/\b(\d+(?:[.,]\d+)?)\s*[kK]\b/g, "$1 тисяч");
  out = out.replace(/\b(\d+(?:[.,]\d+)?)\s*[mM]\b/g, "$1 мільйонів");
  out = out.replace(/\b(\d+(?:[.,]\d+)?)\s*[bB]\b/g, "$1 мільярдів");

  // Convert 12,345.67 -> 12 345,67 for Ukrainian speech parsing.
  out = out.replace(/\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b/g, (m) => {
    const [intPart, decPart] = m.split(".");
    const spaced = intPart.replace(/,/g, " ");
    return decPart ? `${spaced},${decPart}` : spaced;
  });

  // Convert plain decimals 1234.56 -> 1234,56
  out = out.replace(/\b\d+\.\d+\b/g, (m) => m.replace(".", ","));
  return out;
}

function computeDeterministicAnswer(operation, rows, targetColumn, groupBy, limit = 5, locale = "en") {
  const op = (operation || "none").toLowerCase();
  const nLimit = Number.isFinite(Number(limit)) ? Math.max(1, Number(limit)) : 5;
  if (op === "count") return { answer: `Count: ${rows.length} rows`, previewRows: rows.slice(0, 15) };

  if (!targetColumn) return { answer: "", previewRows: rows.slice(0, 15) };

  const isPercentageCol = /percent|margin|rate|ratio|%/i.test(String(targetColumn));
  const effectiveOp = (op === "sum" && isPercentageCol) ? "avg" : op;

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
      return { answer: `Highest ${targetColumn}: **${sorted[0].label}** with ${formatValue(sorted[0].value, locale, targetColumn)}`, previewRows: sorted.slice(0, 10) };
    }
    if (effectiveOp === "min") {
      const bottom = [...sorted].sort((a, b) => a.value - b.value)[0];
      return { answer: `Lowest ${targetColumn}: **${bottom.label}** with ${formatValue(bottom.value, locale, targetColumn)}`, previewRows: [...sorted].sort((a, b) => a.value - b.value).slice(0, 10) };
    }
    return {
      answer: `Top ${nLimit} ${groupBy} by ${targetColumn}:\n` + sorted.slice(0, nLimit).map((x, i) => `${i + 1}. **${x.label}**: ${formatValue(x.value, locale, targetColumn)}`).join("\n"),
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

function resolveColumn(headers, aiName) {
  if (!aiName || !headers.length) return null;
  const direct = headers.find(h => String(h).toLowerCase() === String(aiName).toLowerCase());
  if (direct) return direct;
  return headers.find(h => String(h).toLowerCase().includes(String(aiName).toLowerCase())) || null;
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

function formatAnswerWithBullets(answer = "") {
  const text = typeof answer === "string" ? answer.trim() : "";
  if (!text) return "";
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
  // Format standalone numeric tokens (including currency/percent) to 2 decimals.
  return text.replace(/([$-]?\d[\d,]*)(\.\d+)?(%?)/g, (raw, intPart, decPart, suffix) => {
    // Skip 4-digit years and parts of dates like 04-26-2026.
    const compact = String(intPart).replace(/[$,]/g, "");
    if (/^\d{4}$/.test(compact) && !decPart && !suffix) return raw;
    const n = Number(String(intPart).replace(/[$,]/g, "") + (decPart || ""));
    if (!Number.isFinite(n)) return raw;
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
    "You are a spreadsheet analysis assistant.",
    "Return ONLY valid JSON.",
    "Language: Always provide 'answer' in the requested output_locale, regardless of the user's message language.",
    "Internal Logic: Map user terms to available_columns for operations, but keep final explanation in output_locale.",
    "Date handling: Always output dates as MM-DD-YYYY.",
    "Date handling: Never include time values or timezone references.",
    "Quarter handling: Interpret Q1/Q2/Q3/Q4 as quarter periods.",
    "Quarter handling: Also interpret localized quarter aliases as Q1..Q4 (e.g., квартал 1/2/3/4, 1 квартал, I/II/III/IV квартал).",
    "Language rule for quarter wording: use the English word 'quarter' only in English output.",
    "Language rule for quarter wording: in Russian use 'квартал', in Ukrainian use 'квартал/кварталу' as grammatically appropriate.",
    "Number formatting: Use grouped numbers with thousands separators in the final answer (example: 12,345.67).",
    "Rounding rule: Always present numeric calculation results with exactly 2 decimal places.",
    "Do not describe numeric values as approximate.",
    "Do not shorten values into compact forms like K/M/B unless user explicitly asks.",
    "Use only numeric values that can be derived from the provided spreadsheet rows.",
    "Never invent numbers, never estimate, and never substitute generic sample values.",
    "If exact numeric evidence is unavailable, clearly say data is unavailable instead of guessing.",
    "Supported operations: none, filter, reset, count, sum, avg, max, min, top_n.",
    "IMPORTANT: Only use operation: 'filter' when user explicitly says 'Show', 'Filter', 'Find', or 'View only'.",
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
      operation: "none|filter|reset|count|sum|avg|max|min|top_n",
      target_tab: "string|null",
      target_column: "string|null",
      group_by: "string|null",
      limit: "number|null",
      filters: [{ column: "string", operator: "contains|equals|gt|gte|lt|lte", value: "string|number" }],
      chart: { date_column: "string", value_column: "string", segment_by: "string|null", aggregation: "sum|avg" }
    }
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
  let resp;
  try {
    resp = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.1,
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

export async function getChatAudio(req, res) {
  const { text, locale } = req.body;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !text) return res.status(400).json({ error: "missing_params" });

  let voice = "nova"; 
  const lang = (locale || "en").split("-")[0].toLowerCase();
  if (lang === "es") voice = "shimmer"; 
  if (lang === "uk") voice = "nova";
  if (lang === "ru") voice = "alloy";
  
  let cleanedText = text;
  if (lang === "uk") cleanedText = normalizeUkrainianSpeechNumbers(normalizeSlavicGroupedNumbers(text));
  if (lang === "ru") {
    cleanedText = normalizeSlavicGroupedNumbers(text);
  }

  try {
    const response = await fetch(`${OPENAI_BASE_URL}/audio/speech`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: lang === "en" ? "tts-1" : "tts-1-hd", input: cleanedText, voice }),
    });

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
  } catch (e) { res.status(500).json({ error: "internal_server_error" }); }
}

export async function chatQuery(req, res) {
  const { sheetId, activeTab = null, message, conversationHistory = [], locale: rawLocale } = req.body || {};
  const locale = normalizeLocale(rawLocale || "en");
  const hasAccess = await checkSheetAccess(sheetId, req.user);
  if (!hasAccess) return res.status(403).json({ error: "Forbidden" });

  const loaded = await loadAccessibleRows(sheetId, req.user, null);
  if (loaded?.forbidden) return res.status(403).json({ error: "Forbidden" });
  const rawTabNames = Array.isArray(loaded?.tabs) ? loaded.tabs : [];
  const tabDatasets = buildTabDatasets(loaded.rows || [], loaded.headers || [], rawTabNames);
  const tabNames = Object.keys(tabDatasets);
  const tabProfiles = tabNames.map((tab) => {
    const ds = tabDatasets[tab] || { headers: [], rows: [] };
    return { tab, headers: ds.headers || [], row_count: (ds.rows || []).length, sample_rows: (ds.rows || []).slice(0, 6) };
  });

  const initialTab = resolveTabName(tabNames, activeTab) || inferTabFromMessage(tabNames, message);
  const initialDataset = initialTab ? tabDatasets[initialTab] : {
    headers: Array.from(new Set(tabNames.flatMap((t) => tabDatasets[t]?.headers || []))),
    rows: tabNames.flatMap((t) => (tabDatasets[t]?.rows || []).map((r) => ({ ...r, Tab: t }))),
  };
  const initialAugmented = augmentRowsWithQuarter(initialDataset.rows || [], initialDataset.headers || []);
  const aiHeaders = initialAugmented.headers || [];
  const aiRows = initialAugmented.rows || [];

  let ai;
  const sampleRows = aiRows.slice(0, CHAT_SAMPLE_ROWS);
  const dateFormatHints = buildDateFormatHints(aiHeaders, sampleRows);

  try {
    ai = await callOpenAI({
      message: `${message}\n\nAvailable tabs: ${tabNames.join(", ") || "N/A"}\nIf the question maps to a specific tab, set target_tab in the JSON response.`,
      headers: aiHeaders,
      sampleRows,
      conversationHistory,
      locale,
      dateFormatHints,
      schemaProfile: { available_tabs: tabNames, tab_profiles: tabProfiles }
    });
  } catch (e) { return res.status(502).json({ error: "ai_unavailable" }); }

  const aiTab = resolveTabName(tabNames, ai?.target_tab);
  const selectedTab = aiTab || initialTab || null;
  const selectedDataset = selectedTab ? tabDatasets[selectedTab] : {
    headers: Array.from(new Set(tabNames.flatMap((t) => tabDatasets[t]?.headers || []))),
    rows: tabNames.flatMap((t) => (tabDatasets[t]?.rows || []).map((r) => ({ ...r, Tab: t }))),
  };
  const selectedAugmented = augmentRowsWithQuarter(selectedDataset.rows || [], selectedDataset.headers || []);
  const headers = selectedAugmented.headers || [];
  const baseRows = selectedAugmented.rows || [];

  const aiFilters = (ai?.filters || []).map(f => ({
    column: resolveColumn(headers, f.column),
    operator: f.operator || "contains",
    value: f.value
  })).filter(f => f.column);

  const matchedRows = applyFilters(baseRows, aiFilters);
  const resolvedTarget = resolveColumn(headers, ai?.target_column);
  const resolvedGroupBy = resolveColumn(headers, ai?.group_by);
  const exec = computeDeterministicAnswer(ai?.operation, matchedRows, resolvedTarget, resolvedGroupBy, ai?.limit, locale);

  const isChartOp = ["chart", "plot", "trend"].includes(ai?.operation);
  const chart = (isChartOp && ai?.chart) ? {
    dateColumn: resolveColumn(headers, ai.chart.date_column),
    valueColumn: resolveColumn(headers, ai.chart.value_column),
    segmentBy: resolveColumn(headers, ai.chart.segment_by),
    aggregation: ai.chart.aggregation || "sum"
  } : null;

  const numericOps = new Set(["count", "sum", "avg", "max", "min", "top_n"]);
  const op = String(ai?.operation || "none").toLowerCase();
  let answer = (numericOps.has(op) && exec.answer)
    ? exec.answer
    : (ai?.answer || exec.answer || "Done.");
  if (exec.answer && (/\d/.test(String(answer)) || /(?:approximately|approx\.?|about|примерно|около|приблизно|близько)/i.test(String(answer)))) {
    answer = exec.answer;
  }
  answer = formatAnswerWithBullets(answer);
  if (!isEnglishLocale(locale) && answer) {
    try {
      const preserveTerms = dateFormatHints
        .flatMap((h) => [h?.column, h?.example, h?.syntax])
        .map((t) => String(t || "").trim())
        .filter(Boolean);
      const translated = await translateDashboardItems({
        locale,
        items: [{ key: "chat_answer", text: answer, preserveTerms }],
        context: "chat-answer",
      });
      answer = translated?.[0]?.text || answer;
    } catch (_) {
      // keep original answer if translation fails
    }
  }
  answer = stripApproximationWords(answer);
  answer = normalizeDatesAndRemoveTime(answer);
  answer = enforceCommaThousands(answer);
  answer = enforceTwoDecimals(answer);

  const isReset = ai?.operation === "reset" || /reset|clear|all records/i.test(ai?.answer || "");
  const uiFilters = (ai?.operation === "filter" || ai?.operation === "apply_filter") ? aiFilters : [];

  res.json({
    answer,
    actions: { reset_filters: isReset, filters: uiFilters, chart },
    preview_rows: exec.previewRows || [],
    meta: { totalRows: baseRows.length, matchedRows: matchedRows.length, operation: ai?.operation || "none", locale, selectedTab, availableTabs: tabNames }
  });
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

async function loadAccessibleRows(sheetId, user, activeTab = null) {
  const sheet = await query("SELECT headers, tabs, tab_name FROM sheets WHERE id = $1", [sheetId]);
  if (!sheet.length) return { headers: [], tabs: [], rows: [], forbidden: true };
  const rows = activeTab
    ? await query(
        "SELECT row_data, tab_name FROM sheet_rows WHERE sheet_id = $1 AND tab_name = $2 ORDER BY row_index ASC",
        [sheetId, activeTab]
      )
    : await query(
        "SELECT row_data, tab_name FROM sheet_rows WHERE sheet_id = $1 ORDER BY row_index ASC",
        [sheetId]
      );

  const rawHeaders = sheet[0]?.headers;
  let headers = Array.isArray(rawHeaders)
    ? rawHeaders
    : (typeof rawHeaders === "string" ? JSON.parse(rawHeaders || "[]") : []);
  if (!headers.length && rows.length) {
    const row0 = typeof rows[0]?.row_data === "string" ? JSON.parse(rows[0].row_data) : rows[0]?.row_data;
    headers = row0 && typeof row0 === "object" ? Object.keys(row0) : [];
  }

  if (user.role === "admin") {
    return {
      headers,
      tabs: Array.isArray(sheet[0]?.tabs) ? sheet[0].tabs : (sheet[0]?.tab_name ? [sheet[0].tab_name] : []),
      rows: rows.map((r) => {
        const data = (typeof r.row_data === "string" ? JSON.parse(r.row_data) : r.row_data) || {};
        return { ...data, __tab_name: r.tab_name || null };
      }),
      forbidden: false,
    };
  }

  const folderAccess = await query(
    `SELECT 1
     FROM sheets s
     LEFT JOIN folders f ON f.id = s.folder_id
     WHERE s.id = $1
       AND (
         EXISTS (
           SELECT 1
           FROM folder_groups fg
           JOIN user_groups ug ON ug.group_id = fg.group_id
           WHERE fg.folder_id = f.id AND ug.user_id = $2
         )
         OR f.group_id IN (SELECT group_id FROM user_groups WHERE user_id = $2)
       )
     LIMIT 1`,
    [sheetId, user.id]
  );
  const hasFullAccess = folderAccess.length > 0;

  let validCols = [];
  let rowFiltersList = [];
  if (!hasFullAccess) {
    const userPerms = await query(
      "SELECT allowed_columns, row_filters FROM permissions WHERE user_id = $2 AND sheet_id = $1",
      [sheetId, user.id]
    );
    const groupPerms = await query(
      `SELECT gp.allowed_columns, gp.row_filters
       FROM group_permissions gp
       JOIN user_groups ug ON ug.group_id = gp.group_id
       WHERE ug.user_id = $2 AND gp.sheet_id = $1`,
      [sheetId, user.id]
    );
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

  let mappedRows = rows.map((r) => {
    const data = (typeof r.row_data === "string" ? JSON.parse(r.row_data) : r.row_data) || {};
    return { ...data, __tab_name: r.tab_name || null };
  });

  if (!hasFullAccess) {
    mappedRows = mappedRows
      .filter((rowData) => {
        for (const filters of rowFiltersList) {
          const keys = Object.keys(filters || {});
          if (!keys.length) return true;
          const match = keys.every((k) => String(rowData?.[k]) === String(filters[k]));
          if (match) return true;
        }
        return false;
      })
      .map((rowData) => {
        const stripped = { __tab_name: rowData.__tab_name || null };
        validCols.forEach((c) => { stripped[c] = rowData?.[c]; });
        return stripped;
      });
    headers = headers.filter((h) => validCols.includes(h));
  }

  return {
    headers,
    tabs: Array.isArray(sheet[0]?.tabs) ? sheet[0].tabs : (sheet[0]?.tab_name ? [sheet[0].tab_name] : []),
    rows: mappedRows,
    forbidden: false,
  };
}
