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

function formatValue(v, locale = "en", col = "", forSpeech = false) {
  if (typeof v !== "number" || !Number.isFinite(v)) return String(v ?? "");
  
  const isCurrency = col && /price|cost|revenue|income|profit|earnings|salary|wage|amount|balance|total|summ/i.test(String(col));
  const isPercent = col && /percent|margin|rate|ratio|%/i.test(String(col));

  try {
    const formatter = new Intl.NumberFormat('en-US', {
      style: isCurrency ? 'currency' : 'decimal',
      currency: 'USD',
      minimumFractionDigits: (isCurrency || isPercent) ? 2 : 0,
      maximumFractionDigits: 2,
      useGrouping: !forSpeech, 
    });
    let out = formatter.format(v);
    if (isPercent && !isCurrency && !out.includes('%')) out += '%';
    return out;
  } catch (e) {
    const abs = Math.abs(v);
    const sign = v < 0 ? "-" : "";
    const pfx = isCurrency ? "$" : "";
    const sfx = (isPercent && !isCurrency) ? "%" : "";
    return `${sign}${pfx}${abs.toLocaleString('en-US', { useGrouping: !forSpeech, maximumFractionDigits: 2 })}${sfx}`;
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
    "Date handling: When referencing spreadsheet dates, preserve the detected column date syntax exactly (do not convert to another format).",
    "Number formatting: Use grouped numbers with thousands separators in the final answer (example: 12,345.67).",
    "Supported operations: none, filter, reset, count, sum, avg, max, min, top_n.",
    "IMPORTANT: Only use operation: 'filter' when user explicitly says 'Show', 'Filter', 'Find', or 'View only'.",
    "Use bullet points for multiple findings or drivers.",
    "Include concrete numbers and business names in explanations.",
  ].join(" ");

  const userPrompt = {
    question: message,
    output_locale: normalizeLocale(locale || "en"),
    conversation_history: conversationHistory,
    available_columns: headers,
    date_format_hints: dateFormatHints || [],
    schema_profile: schemaProfile,
    sample_rows: sampleRows,
    output_schema: {
      answer: "string",
      operation: "none|filter|reset|count|sum|avg|max|min|top_n",
      target_column: "string|null",
      group_by: "string|null",
      limit: "number|null",
      filters: [{ column: "string", operator: "contains|equals|gt|gte|lt|lte", value: "string|number" }],
      chart: { date_column: "string", value_column: "string", segment_by: "string|null", aggregation: "sum|avg" }
    }
  };

  const resp = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: system }, { role: "user", content: JSON.stringify(userPrompt) }]
    })
  });
  const json = await resp.json();
  return JSON.parse(json.choices[0].message.content);
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
  if (lang === "uk") cleanedText = normalizeUkrainianSpeechNumbers(text);
  if (lang === "ru") {
    cleanedText = text.replace(/(\d),(\d{3})/g, "$1 $2");
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
  const { sheetId, message, conversationHistory = [], locale: rawLocale } = req.body || {};
  const locale = normalizeLocale(rawLocale || "en");
  const { headers, rows: baseRows } = await loadAccessibleRows(sheetId, req.user);

  let ai;
  const sampleRows = baseRows.slice(0, CHAT_SAMPLE_ROWS);
  const dateFormatHints = buildDateFormatHints(headers, sampleRows);

  try {
    ai = await callOpenAI({ message, headers, sampleRows, conversationHistory, locale, dateFormatHints });
  } catch (e) { return res.status(502).json({ error: "ai_unavailable" }); }

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

  let answer = ai?.answer || exec.answer || "Done.";
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

  const isReset = ai?.operation === "reset" || /reset|clear|all records/i.test(ai?.answer || "");
  const uiFilters = (ai?.operation === "filter" || ai?.operation === "apply_filter") ? aiFilters : [];

  res.json({
    answer,
    actions: { reset_filters: isReset, filters: uiFilters, chart },
    preview_rows: exec.previewRows || [],
    meta: { totalRows: baseRows.length, matchedRows: matchedRows.length, operation: ai?.operation || "none", locale }
  });
}

async function loadAccessibleRows(sheetId, user) {
  const sheet = await query("SELECT headers FROM sheets WHERE id = $1", [sheetId]);
  const rows = await query(
    "SELECT row_data FROM sheet_rows WHERE sheet_id = $1 ORDER BY row_index ASC",
    [sheetId]
  );

  const rawHeaders = sheet[0]?.headers;
  const headers = Array.isArray(rawHeaders)
    ? rawHeaders
    : (typeof rawHeaders === "string" ? JSON.parse(rawHeaders || "[]") : []);

  return {
    headers,
    rows: rows.map((r) => (typeof r.row_data === "string" ? JSON.parse(r.row_data) : r.row_data)),
  };
}
