import { query } from "../config/db.js";

const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const OPENAI_TIMEOUT_MS = Number.parseInt(process.env.OPENAI_TIMEOUT_MS || "25000", 10);
const CHAT_MAX_ROWS = Number.parseInt(process.env.CHAT_MAX_ROWS || "50000", 10);
const CHAT_SAMPLE_ROWS = Number.parseInt(process.env.CHAT_SAMPLE_ROWS || "120", 10);
const CHAT_PROFILE_SAMPLE = Number.parseInt(process.env.CHAT_PROFILE_SAMPLE || "600", 10);

function toNum(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v === null || v === undefined || v === "") return null;
  const n = Number.parseFloat(String(v).replace(/[$,%\s,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function parseDate(v) {
  if (v === null || v === undefined || v === "") return null;
  const d = new Date(v);
  if (!Number.isNaN(d.getTime())) return d;
  const n = Number(v);
  if (!Number.isNaN(n) && n > 25569 && n < 60000) {
    const excelDate = new Date(Math.round((n - 25569) * 86400 * 1000));
    if (!Number.isNaN(excelDate.getTime())) return excelDate;
  }
  return null;
}

function resolveColumn(headers, requested) {
  if (!requested || !headers?.length) return null;
  const exact = headers.find((h) => h.toLowerCase() === String(requested).toLowerCase());
  if (exact) return exact;
  const includes = headers.find((h) => h.toLowerCase().includes(String(requested).toLowerCase()));
  return includes || null;
}

function detectType(rows, col) {
  const sample = rows.slice(0, CHAT_PROFILE_SAMPLE);
  let nonEmpty = 0;
  let numeric = 0;
  let dates = 0;
  sample.forEach((r) => {
    const raw = r?.[col];
    if (raw === null || raw === undefined || raw === "") return;
    nonEmpty += 1;
    if (toNum(raw) !== null) numeric += 1;
    if (parseDate(raw)) dates += 1;
  });
  if (!nonEmpty) return "text";
  if (numeric / nonEmpty >= 0.8) return "number";
  if (dates / nonEmpty >= 0.6) return "date";
  return "text";
}

function buildSchemaProfile(headers, rows) {
  return headers.map((h) => {
    const type = detectType(rows, h);
    const examples = [];
    const seen = new Set();
    for (const r of rows) {
      const v = r?.[h];
      if (v === null || v === undefined || v === "") continue;
      const s = String(v);
      if (seen.has(s)) continue;
      seen.add(s);
      examples.push(s);
      if (examples.length >= 5) break;
    }
    return { column: h, type, examples };
  });
}

function applySingleFilter(row, filter) {
  const raw = row?.[filter.column];
  const cell = String(raw ?? "");
  const value = String(filter.value ?? "");
  const op = (filter.operator || "contains").toLowerCase();
  if (!value) return true;
  if (op === "contains") return cell.toLowerCase().includes(value.toLowerCase());
  if (op === "equals") return cell.toLowerCase() === value.toLowerCase();

  const nCell = toNum(raw);
  const nVal = toNum(value);
  if (nCell === null || nVal === null) return false;
  if (op === "gt") return nCell > nVal;
  if (op === "gte") return nCell >= nVal;
  if (op === "lt") return nCell < nVal;
  if (op === "lte") return nCell <= nVal;
  return cell.toLowerCase().includes(value.toLowerCase());
}

function applyFilters(rows, filters = []) {
  if (!Array.isArray(filters) || !filters.length) return rows;
  return rows.filter((r) => filters.every((f) => applySingleFilter(r, f)));
}

function normalizeClientFilters(activeFilters = {}, headers = []) {
  const out = [];
  if (!activeFilters || typeof activeFilters !== "object") return out;
  Object.entries(activeFilters).forEach(([k, v]) => {
    const col = resolveColumn(headers, k);
    if (!col) return;
    if (Array.isArray(v)) {
      if (v.length === 1) out.push({ column: col, operator: "equals", value: String(v[0]) });
      return;
    }
    if (v && typeof v === "object" && v.type === "contains" && v.value) {
      out.push({ column: col, operator: "contains", value: String(v.value) });
    }
  });
  return out;
}

function formatValue(v) {
  if (typeof v !== "number" || !Number.isFinite(v)) return String(v ?? "");
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1000) return `${sign}$${Math.round(abs).toLocaleString()}`;
  return `${sign}$${abs.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function normalizeConversationHistory(history = []) {
  if (!Array.isArray(history)) return [];
  return history
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const rawRole = String(item.role || item.type || "").toLowerCase();
      const role = rawRole === "assistant" || rawRole === "bot" ? "assistant" : (rawRole === "user" ? "user" : null);
      const content = typeof item.content === "string"
        ? item.content.trim()
        : (typeof item.text === "string" ? item.text.trim() : "");
      if (!role || !content) return null;
      return { role, content };
    })
    .filter(Boolean)
    .slice(-8);
}

function computeDeterministicAnswer(operation, rows, targetColumn, groupBy, limit = 5) {
  const op = (operation || "none").toLowerCase();
  const nLimit = Number.isFinite(Number(limit)) ? Math.max(1, Number(limit)) : 5;
  if (op === "count") return { answer: `Count: ${rows.length} rows`, previewRows: rows.slice(0, 15) };

  if (!targetColumn) return { answer: "", previewRows: rows.slice(0, 15) };

  if (groupBy && ["max", "min", "top_n"].includes(op)) {
    const grouped = {};
    rows.forEach((r) => {
      const key = String(r?.[groupBy] ?? "Unknown");
      const val = toNum(r?.[targetColumn]) || 0;
      grouped[key] = (grouped[key] || 0) + val;
    });
    const sorted = Object.entries(grouped)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
    if (!sorted.length) return { answer: "No matching data.", previewRows: [] };
    if (op === "max") return { answer: `Highest ${targetColumn}: **${sorted[0].label}** with ${formatValue(sorted[0].value)}`, previewRows: sorted.slice(0, 10) };
    if (op === "min") {
      const bottom = [...sorted].sort((a, b) => a.value - b.value)[0];
      return { answer: `Lowest ${targetColumn}: **${bottom.label}** with ${formatValue(bottom.value)}`, previewRows: [...sorted].sort((a, b) => a.value - b.value).slice(0, 10) };
    }
    return {
      answer: `Top ${nLimit} ${groupBy} by ${targetColumn}:\n` + sorted.slice(0, nLimit).map((x, i) => `${i + 1}. **${x.label}**: ${formatValue(x.value)}`).join("\n"),
      previewRows: sorted.slice(0, nLimit)
    };
  }

  const nums = rows.map((r) => toNum(r?.[targetColumn])).filter((n) => n !== null);
  if (!nums.length) return { answer: `No numeric data found in ${targetColumn}.`, previewRows: rows.slice(0, 15) };
  if (op === "sum") return { answer: `Total ${targetColumn}: ${formatValue(nums.reduce((a, b) => a + b, 0))}`, previewRows: rows.slice(0, 15) };
  if (op === "avg") return { answer: `Average ${targetColumn}: ${formatValue(nums.reduce((a, b) => a + b, 0) / nums.length)}`, previewRows: rows.slice(0, 15) };
  if (op === "max") return { answer: `Max ${targetColumn}: ${formatValue(Math.max(...nums))}`, previewRows: rows.slice(0, 15) };
  if (op === "min") return { answer: `Min ${targetColumn}: ${formatValue(Math.min(...nums))}`, previewRows: rows.slice(0, 15) };
  if (op === "top_n") {
    const sortedRows = [...rows].sort((a, b) => (toNum(b?.[targetColumn]) || 0) - (toNum(a?.[targetColumn]) || 0)).slice(0, nLimit);
    return { answer: `Top ${nLimit} rows by ${targetColumn}.`, previewRows: sortedRows };
  }
  return { answer: "", previewRows: rows.slice(0, 15) };
}

async function checkSheetAccess(sheetId, user) {
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

async function loadAccessibleRows(sheetId, user) {
  const sheet = await query("SELECT headers FROM sheets WHERE id = $1", [sheetId]);
  if (!sheet.length) return { headers: [], rows: [] };
  const headers = Array.isArray(sheet[0].headers) ? sheet[0].headers : JSON.parse(sheet[0].headers || "[]");
  const allRows = await query(
    `SELECT row_data FROM sheet_rows WHERE sheet_id = $1 ORDER BY row_index ASC LIMIT $2`,
    [sheetId, CHAT_MAX_ROWS + 1]
  );
  if (allRows.length > CHAT_MAX_ROWS) {
    return { headers, rows: [], tooLarge: true };
  }

  let rows = allRows.map((r) => (typeof r.row_data === "string" ? JSON.parse(r.row_data) : r.row_data));
  if (user.role === "admin") return { headers, rows, tooLarge: false };

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
       )`,
    [sheetId, user.id]
  );
  if (folderAccess.length > 0) return { headers, rows, tooLarge: false };

  const userPerms = await query(
    `SELECT allowed_columns, row_filters FROM permissions WHERE user_id = $2 AND sheet_id = $1`,
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
  if (!allPerms.length) return { headers: [], rows: [], tooLarge: false, forbidden: true };

  const validCols = new Set();
  const rowFiltersList = [];
  allPerms.forEach((p) => {
    const cols = typeof p.allowed_columns === "string" ? JSON.parse(p.allowed_columns) : (p.allowed_columns || []);
    cols.forEach((c) => validCols.add(c));
    const filters = typeof p.row_filters === "string" ? JSON.parse(p.row_filters) : (p.row_filters || {});
    rowFiltersList.push(filters);
  });

  rows = rows.filter((rowData) => {
    let rowAllowed = false;
    for (const filters of rowFiltersList) {
      const keys = Object.keys(filters);
      if (!keys.length) {
        rowAllowed = true;
        break;
      }
      const match = keys.every((k) => String(rowData?.[k]) === String(filters[k]));
      if (match) {
        rowAllowed = true;
        break;
      }
    }
    if (!rowAllowed) return false;
    const stripped = {};
    validCols.forEach((k) => {
      stripped[k] = rowData?.[k];
    });
    Object.keys(rowData).forEach((k) => {
      if (!validCols.has(k)) delete rowData[k];
    });
    return true;
  });

  return { headers: headers.filter((h) => validCols.has(h)), rows, tooLarge: false };
}

async function callOpenAI({ message, schemaProfile, sampleRows, headers, conversationHistory = [] }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      operation: "none",
      answer: "AI is not configured. Set OPENAI_API_KEY on backend.",
      filters: []
    };
  }

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
  try {
    const system = [
      "You are a spreadsheet analysis assistant.",
      "Return ONLY valid JSON (no markdown, no prose outside JSON).",
      "Use available columns exactly as provided.",
      "Infer best intent from user question and recent conversation context.",
      "When user asks highest/lowest/top by group, set operation and group_by correctly.",
      "Supported operations: none, filter, count, sum, avg, max, min, top_n.",
      "Use filters for text search when appropriate.",
      "Answer in a conversational tone with 2-5 concise sentences.",
      "When user asks 'why' or asks for the cause of a difference, explain the top drivers and include concrete values.",
      "When comparing years, include each year and the numeric delta.",
      "For trend requests, treat quarter/fiscal period columns as temporal and prefer them in chart.date_column.",
      "Always format monetary values with a leading $ and thousands separators.",
      "If the dataset includes Business Name and the answer discusses impact or top contributors, include business names.",
      "Do not ask for clarification if the likely metric is inferable from conversation context."
    ].join(" ");

    const userPrompt = {
      question: message,
      conversation_history: conversationHistory,
      available_columns: headers,
      schema_profile: schemaProfile,
      sample_rows: sampleRows,
      output_schema: {
        answer: "string",
        operation: "none|filter|count|sum|avg|max|min|top_n",
        target_column: "string|null",
        group_by: "string|null",
        limit: "number|null",
        filters: [{ column: "string", operator: "contains|equals|gt|gte|lt|lte", value: "string|number" }],
        chart: {
          date_column: "string|null",
          value_column: "string|null",
          segment_by: "string|null",
          aggregation: "sum|avg|null"
        }
      }
    };

    const resp = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: JSON.stringify(userPrompt) }
        ]
      })
    });

    if (!resp.ok) {
      const tBody = await resp.text();
      throw new Error(`openai_error_${resp.status}: ${tBody.slice(0, 400)}`);
    }
    const payload = await resp.json();
    const content = payload?.choices?.[0]?.message?.content || "{}";
    return JSON.parse(content);
  } finally {
    clearTimeout(t);
  }
}

export async function chatQuery(req, res) {
  const { sheetId, message, activeFilters = {}, conversationHistory = [] } = req.body || {};
  if (!sheetId || !message || typeof message !== "string") {
    return res.status(400).json({ error: "sheetId_and_message_required" });
  }

  const hasAccess = await checkSheetAccess(sheetId, req.user);
  if (!hasAccess) return res.status(403).json({ error: "Forbidden" });

  const loaded = await loadAccessibleRows(sheetId, req.user);
  if (loaded.forbidden) return res.status(403).json({ error: "Forbidden" });
  if (loaded.tooLarge) {
    return res.status(413).json({
      error: "sheet_too_large_for_chat",
      maxRows: CHAT_MAX_ROWS
    });
  }

  const headers = loaded.headers || [];
  let rows = loaded.rows || [];
  if (!headers.length || !rows.length) {
    return res.json({
      answer: "No rows available in this sheet.",
      actions: { filters: [], chart: null, reset_filters: false },
      meta: { totalRows: 0, matchedRows: 0, operation: "none" }
    });
  }

  const clientFilters = normalizeClientFilters(activeFilters, headers);
  const baseRows = applyFilters(rows, clientFilters);

  const schemaProfile = buildSchemaProfile(headers, baseRows);
  const sampleRows = baseRows.slice(0, CHAT_SAMPLE_ROWS);
  const normalizedHistory = normalizeConversationHistory(conversationHistory);
  let ai = {};
  try {
    ai = await callOpenAI({ message, schemaProfile, sampleRows, headers, conversationHistory: normalizedHistory });
  } catch (e) {
    console.error("chatQuery openai call failed:", e.message);
    return res.status(502).json({ error: "ai_unavailable", message: "AI service unavailable" });
  }

  const resolvedTarget = resolveColumn(headers, ai?.target_column);
  const resolvedGroupBy = resolveColumn(headers, ai?.group_by);
  const matchedRows = baseRows;
  const exec = computeDeterministicAnswer(ai?.operation, matchedRows, resolvedTarget, resolvedGroupBy, ai?.limit);

  const chart = ai?.chart ? {
    dateColumn: resolveColumn(headers, ai.chart.date_column),
    valueColumn: resolveColumn(headers, ai.chart.value_column),
    segmentBy: resolveColumn(headers, ai.chart.segment_by),
    aggregation: ai.chart.aggregation || "sum"
  } : null;

  const deterministicAnswer = exec.answer && exec.answer.trim() ? exec.answer.trim() : "";
  const aiAnswer = typeof ai?.answer === "string" ? ai.answer.trim() : "";
  let answer = aiAnswer || deterministicAnswer || "Done.";
  if (deterministicAnswer && aiAnswer && deterministicAnswer.toLowerCase() !== aiAnswer.toLowerCase()) {
    answer = `${deterministicAnswer}\n\n${aiAnswer}`;
  }

  res.json({
    answer,
    actions: {
      reset_filters: false,
      filters: [],
      chart: chart && chart.valueColumn ? chart : null
    },
    preview_rows: exec.previewRows || [],
    meta: {
      totalRows: rows.length,
      matchedRows: matchedRows.length,
      operation: ai?.operation || "none"
    }
  });
}
