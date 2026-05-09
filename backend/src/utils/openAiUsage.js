const OPENAI_USAGE_BASE_URL = String(process.env.OPENAI_USAGE_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");

function getOpenAiUsageApiKey() {
  return String(process.env.OPENAI_ADMIN_API_KEY || process.env.OPENAI_USAGE_API_KEY || process.env.OPENAI_API_KEY || "").trim();
}

function createOpenAiUsageError(code, message, statusCode = 503, details = null) {
  const err = new Error(message);
  err.code = code;
  err.statusCode = statusCode;
  if (details) err.details = details;
  return err;
}

function parseOpenAiErrorBody(body = "") {
  const raw = String(body || "").trim();
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    return String(parsed?.error?.message || parsed?.message || raw).slice(0, 300);
  } catch {
    return raw.slice(0, 300);
  }
}

export function normalizeUsagePeriodMonth(value, now = new Date()) {
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}$/.test(raw)) {
    const month = Number(raw.slice(5, 7));
    if (month >= 1 && month <= 12) return raw;
  }
  return now.toISOString().slice(0, 7);
}

export function usagePeriodToUnixRange(periodMonth) {
  const normalized = normalizeUsagePeriodMonth(periodMonth);
  const year = Number(normalized.slice(0, 4));
  const monthIndex = Number(normalized.slice(5, 7)) - 1;
  const startMs = Date.UTC(year, monthIndex, 1, 0, 0, 0, 0);
  const endMs = Date.UTC(year, monthIndex + 1, 1, 0, 0, 0, 0);
  return {
    periodMonth: normalized,
    startTime: Math.floor(startMs / 1000),
    endTime: Math.floor(endMs / 1000),
    days: Math.max(1, Math.round((endMs - startMs) / 86400000)),
  };
}

function openAiHeaders() {
  const headers = {
    Authorization: `Bearer ${getOpenAiUsageApiKey()}`,
    "Content-Type": "application/json",
  };
  const orgId = String(process.env.OPENAI_ORG_ID || process.env.OPENAI_ORGANIZATION || "").trim();
  if (orgId) headers["OpenAI-Organization"] = orgId;
  return headers;
}

function appendCommonParams(params, range) {
  params.set("start_time", String(range.startTime));
  params.set("end_time", String(range.endTime));
  params.set("bucket_width", "1d");
  params.set("limit", String(Math.min(31, range.days)));
  const projectIds = String(process.env.OPENAI_USAGE_PROJECT_IDS || process.env.OPENAI_USAGE_PROJECT_ID || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  projectIds.forEach((projectId) => params.append("project_ids", projectId));
}

async function fetchOpenAiPage(path, range, configureParams = null) {
  const apiKey = getOpenAiUsageApiKey();
  if (!apiKey) {
    throw createOpenAiUsageError(
      "openai_usage_api_key_missing",
      "Set OPENAI_ADMIN_API_KEY, OPENAI_USAGE_API_KEY, or OPENAI_API_KEY with organization usage/costs access.",
      503
    );
  }
  const data = [];
  let page = "";
  for (let i = 0; i < 20; i += 1) {
    const params = new URLSearchParams();
    appendCommonParams(params, range);
    if (page) params.set("page", page);
    if (typeof configureParams === "function") configureParams(params);
    const resp = await fetch(`${OPENAI_USAGE_BASE_URL}${path}?${params.toString()}`, {
      method: "GET",
      headers: openAiHeaders(),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      const message = parseOpenAiErrorBody(body);
      if (resp.status === 401 || resp.status === 403) {
        throw createOpenAiUsageError(
          "openai_usage_key_unauthorized",
          `Configured OpenAI key cannot access organization usage/costs. Provide a key with org usage permissions (OPENAI_ADMIN_API_KEY, OPENAI_USAGE_API_KEY, or OPENAI_API_KEY). ${message}`.trim(),
          502,
          { status: resp.status }
        );
      }
      throw createOpenAiUsageError(
        "openai_usage_request_failed",
        `OpenAI usage request failed with status ${resp.status}. ${message}`.trim(),
        503,
        { status: resp.status }
      );
    }
    const json = await resp.json();
    if (Array.isArray(json?.data)) data.push(...json.data);
    if (!json?.has_more || !json?.next_page) break;
    page = String(json.next_page);
  }
  return data;
}

function sumCostBuckets(buckets = []) {
  const lineItems = new Map();
  let total = 0;
  let currency = "usd";
  for (const bucket of buckets) {
    const results = Array.isArray(bucket?.results) ? bucket.results : [];
    for (const result of results) {
      const value = Number(result?.amount?.value || 0);
      if (!Number.isFinite(value)) continue;
      total += value;
      currency = String(result?.amount?.currency || currency || "usd").toLowerCase();
      const lineItem = String(result?.line_item || "Uncategorized");
      lineItems.set(lineItem, Number(lineItems.get(lineItem) || 0) + value);
    }
  }
  return {
    costUsd: Number(total.toFixed(6)),
    currency,
    lineItems: Array.from(lineItems.entries())
      .map(([lineItem, costUsd]) => ({ lineItem, costUsd: Number(Number(costUsd || 0).toFixed(6)) }))
      .sort((a, b) => b.costUsd - a.costUsd),
  };
}

function sumCompletionUsageBuckets(buckets = []) {
  const totals = {
    queryCount: 0,
    promptTokens: 0,
    completionTokens: 0,
    inputCachedTokens: 0,
    inputAudioTokens: 0,
    outputAudioTokens: 0,
  };
  for (const bucket of buckets) {
    const results = Array.isArray(bucket?.results) ? bucket.results : [];
    for (const result of results) {
      totals.queryCount += Number(result?.num_model_requests || 0);
      totals.promptTokens += Number(result?.input_tokens || 0);
      totals.completionTokens += Number(result?.output_tokens || 0);
      totals.inputCachedTokens += Number(result?.input_cached_tokens || 0);
      totals.inputAudioTokens += Number(result?.input_audio_tokens || 0);
      totals.outputAudioTokens += Number(result?.output_audio_tokens || 0);
    }
  }
  return totals;
}

function sumAudioSpeechUsageBuckets(buckets = []) {
  const totals = { queryCount: 0, characters: 0 };
  for (const bucket of buckets) {
    const results = Array.isArray(bucket?.results) ? bucket.results : [];
    for (const result of results) {
      totals.queryCount += Number(result?.num_model_requests || 0);
      totals.characters += Number(result?.characters || 0);
    }
  }
  return totals;
}

async function fetchOptionalUsage(path, range) {
  try {
    return { ok: true, data: await fetchOpenAiPage(path, range) };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

export async function fetchOpenAiOrganizationUsageSummary(periodMonth) {
  const range = usagePeriodToUnixRange(periodMonth);
  const costs = await fetchOpenAiPage("/organization/costs", range, (params) => {
    params.append("group_by", "line_item");
  });
  const [completions, audioSpeeches] = await Promise.all([
    fetchOptionalUsage("/organization/usage/completions", range),
    fetchOptionalUsage("/organization/usage/audio_speeches", range),
  ]);
  const costTotals = sumCostBuckets(costs);
  const completionTotals = completions.ok ? sumCompletionUsageBuckets(completions.data) : sumCompletionUsageBuckets([]);
  const audioSpeechTotals = audioSpeeches.ok ? sumAudioSpeechUsageBuckets(audioSpeeches.data) : sumAudioSpeechUsageBuckets([]);
  return {
    source: "openai",
    periodMonth: range.periodMonth,
    costUsd: costTotals.costUsd,
    currency: costTotals.currency,
    queryCount: completionTotals.queryCount + audioSpeechTotals.queryCount,
    promptTokens: completionTotals.promptTokens,
    completionTokens: completionTotals.completionTokens,
    inputCachedTokens: completionTotals.inputCachedTokens,
    inputAudioTokens: completionTotals.inputAudioTokens,
    outputAudioTokens: completionTotals.outputAudioTokens,
    audioSpeechCharacters: audioSpeechTotals.characters,
    lineItems: costTotals.lineItems,
    partialErrors: [
      ...(completions.ok ? [] : [{ source: "openai_completions_usage", error: completions.error }]),
      ...(audioSpeeches.ok ? [] : [{ source: "openai_audio_speeches_usage", error: audioSpeeches.error }]),
    ],
  };
}
