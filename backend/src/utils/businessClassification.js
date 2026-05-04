import {
  buildChatCompletionRequestBody,
  extractOpenAiAssistantText,
  getOpenAiResponseDiagnostics,
  minCompletionTokensForModel,
} from "./openAiCompat.js";
import { resolveChatCompletionProviderConfig } from "./llmProvider.js";

async function loadRuntimeSettingsForClassification(groupId = null) {
  const mod = await import("./aiRuntimeSettings.js");
  const runtime = await mod.loadAiRuntimeSettings(groupId || null);
  return {
    runtime,
    globallyDisabled: mod.isAiGloballyDisabled(runtime),
  };
}

function trimText(value, max = 80) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function normalizeStringArray(value, maxItems = 20, maxChars = 80) {
  return Array.from(new Set(
    (Array.isArray(value) ? value : [])
      .map((item) => trimText(item, maxChars))
      .filter(Boolean)
  )).slice(0, maxItems);
}

function contextTerms({ sourceName = "", fileName = "", sheetNames = [], headers = [], sampleRows = [] } = {}) {
  const parts = [sourceName, fileName]
    .concat(Array.isArray(sheetNames) ? sheetNames : [])
    .concat(Array.isArray(headers) ? headers : []);
  (Array.isArray(sampleRows) ? sampleRows : []).slice(0, 10).forEach((row) => {
    Object.values(row || {}).slice(0, 20).forEach((value) => parts.push(value));
  });
  return parts.map((value) => String(value ?? "").toLowerCase()).join(" ");
}

function refineBusinessType(rawType = "", context = {}) {
  const current = trimText(rawType, 120);
  const text = contextTerms(context);
  if (!text) return current;

  const genericMarketing = !current || /\b(marketing|marketing performance|performance marketing|business|operations?|operational|analytics?|report|spreadsheet|dashboard)\b/i.test(current);
  const advertisingSignal = /\b(advertis(e|ing|ement|ements)|ads?|ad\s*group|campaign|creative|impressions?|clicks?|ctr|cpc|cpm|cpa|roas|return\s+on\s+ad\s+spend|media\s+spend|paid\s+search|paid\s+social|facebook\s+ads?|google\s+ads?|meta\s+ads?|tiktok\s+ads?|linkedin\s+ads?)\b/i.test(text);
  const salesSignal = /\b(sales?|revenue|orders?|deals?|opportunit(y|ies)|pipeline|conversion|conversions|bookings?|arr|mrr|quota|win\s*rate|close\s*rate|customer\s+acquisition)\b/i.test(text);
  const leadGenSignal = /\b(leads?|mql|sql|cpl|lead\s+source|form\s+fills?|inquiries|prospects?)\b/i.test(text);

  if (genericMarketing) {
    if (advertisingSignal && salesSignal) return "Advertising and Sales Performance";
    if (advertisingSignal && leadGenSignal) return "Advertising and Lead Generation Performance";
    if (advertisingSignal) return "Advertising Performance";
    if (salesSignal) return "Sales Performance";
    if (leadGenSignal) return "Lead Generation Performance";
  }

  return current;
}

function sourceKindEnabled(runtime, sourceKind) {
  const kind = String(sourceKind || "").trim().toLowerCase();
  if (kind === "email_ingest") return runtime.businessClassificationApplyEmailIngest !== false;
  if (kind === "autosync") return runtime.businessClassificationApplyAutosync !== false;
  return runtime.businessClassificationApplyUploads !== false;
}

function sampleRowsForPrompt(rows = [], headers = [], maxRows = 20) {
  const headerSet = new Set((headers || []).map((h) => String(h)));
  return (Array.isArray(rows) ? rows : [])
    .slice(0, Math.max(0, Number(maxRows || 0)))
    .map((row) => {
      const out = {};
      Object.entries(row || {}).forEach(([key, value]) => {
        if (key.startsWith("__rowNum__")) return;
        if (headerSet.size && !headerSet.has(key)) return;
        out[trimText(key, 80)] = trimText(value, 80);
      });
      return out;
    })
    .filter((row) => Object.keys(row).length > 0);
}

function clampPromptPayload(payload, maxChars) {
  const limit = Math.max(1000, Number(maxChars || 12000));
  let next = { ...payload };
  let text = JSON.stringify(next);
  if (text.length <= limit) return next;

  next = { ...next, sample_rows: sampleRowsForPrompt(payload.sample_rows, payload.headers, Math.min(5, payload.sample_rows?.length || 0)) };
  text = JSON.stringify(next);
  if (text.length <= limit) return next;

  next = { ...next, sample_rows: [], headers: normalizeStringArray(payload.headers, 120, 60) };
  text = JSON.stringify(next);
  if (text.length <= limit) return next;

  return {
    source_name: trimText(payload.source_name, 80),
    file_name: trimText(payload.file_name, 80),
    sheet_names: normalizeStringArray(payload.sheet_names, 10, 60),
    headers: normalizeStringArray(payload.headers, 80, 50),
    sample_rows: [],
    output_schema: payload.output_schema,
  };
}

function normalizeClassificationResult(raw, model, sourceKind, context = {}, provider = "openai") {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const confidence = Number(src.confidence);
  const businessType = refineBusinessType(src.businessType || src.business_type || "", context);
  return {
    isBusinessData: src.isBusinessData === true,
    businessType,
    industry: trimText(src.industry || "", 80),
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
    signals: normalizeStringArray(src.signals, 8, 100),
    suggestedViews: normalizeStringArray(src.suggestedViews || src.suggested_views, 8, 80),
    source: provider,
    sourceKind,
    model,
    classifiedAt: new Date().toISOString(),
  };
}

export async function classifySheetBusinessContext({
  sourceName,
  fileName,
  sheetNames = [],
  headers = [],
  sampleRows = [],
  sourceKind = "manual_upload",
  groupId = null,
} = {}) {
  const { runtime, globallyDisabled } = await loadRuntimeSettingsForClassification(groupId || null).catch(() => ({ runtime: null, globallyDisabled: false }));
  if (globallyDisabled) return null;
  if (!runtime?.businessClassificationEnabled) return null;
  if (!sourceKindEnabled(runtime, sourceKind)) return null;
  const providerConfig = resolveChatCompletionProviderConfig(runtime, runtime?.businessClassificationModel);
  const { provider, model, baseUrl, apiKey } = providerConfig;
  if (!apiKey) return null;

  const timeoutMs = Number(runtime.openaiTimeoutMs || 60000);
  const maxOutputTokens = minCompletionTokensForModel(model, runtime.businessClassificationMaxOutputTokens, 512, 512);
  const promptPayload = clampPromptPayload({
    source_name: trimText(sourceName, 120),
    file_name: trimText(fileName, 120),
    sheet_names: normalizeStringArray(sheetNames, 20, 80),
    headers: normalizeStringArray(headers, 200, 80),
    sample_rows: sampleRowsForPrompt(sampleRows, headers, runtime.businessClassificationMaxSampleRows),
    output_schema: {
      isBusinessData: "boolean",
      businessType: "string",
      industry: "string",
      confidence: "number 0..1",
      signals: ["short strings from headers or values"],
      suggestedViews: ["short dashboard/view names"],
    },
  }, runtime.businessClassificationMaxPromptChars);

  const system = [
    "Classify whether a spreadsheet looks like business or operational data.",
    "Use only the provided sheet names, headers, and bounded sample rows.",
    "Return only valid JSON matching the requested schema.",
    "If the data is not clearly business/operational, set isBusinessData=false and confidence below 0.5.",
    "Do not infer a company identity or regulated status.",
    "Prefer a specific sheet/business type over a broad domain when headers support it.",
    "For marketing datasets, distinguish advertising performance, sales performance, lead generation performance, campaign performance, ecommerce sales performance, and marketing analytics when the headers indicate those meanings.",
    "Examples: ad spend/impressions/clicks/CTR/CPC/ROAS => Advertising Performance; leads/MQL/SQL/CPL => Lead Generation Performance; orders/revenue/deals/pipeline/conversion => Sales Performance.",
  ].join(" ");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
  let resp;
  try {
    resp = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(buildChatCompletionRequestBody({
        provider,
        model,
        responseFormat: { type: "json_object" },
        maxCompletionTokens: maxOutputTokens,
        temperature: 0,
        messages: [
          { role: "system", content: system },
          { role: "user", content: JSON.stringify(promptPayload) },
        ],
      })),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`business_classification_openai_failed:${text.slice(0, 300)}`);
  }
  const json = await resp.json();
  const content = extractOpenAiAssistantText(json);
  if (!content) throw new Error(`business_classification_invalid_response:${getOpenAiResponseDiagnostics(json)}`);
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`business_classification_invalid_json:${content.slice(0, 240)}`);
  }
  return normalizeClassificationResult(parsed, model, sourceKind, {
    sourceName,
    fileName,
    sheetNames,
    headers,
    sampleRows,
  }, provider);
}

export const __businessClassificationTestHooks = {
  refineBusinessType,
};
