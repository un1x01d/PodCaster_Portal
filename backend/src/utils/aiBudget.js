function toInt(value, fallback) {
  const n = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

export function enforceAiPromptBudget({ text = "", maxChars = 12000, errorCode = "ai_prompt_budget_exceeded" } = {}) {
  const limit = Math.max(1000, toInt(maxChars, 12000));
  const size = String(text || "").length;
  if (size <= limit) return { ok: true, size, limit };
  const err = new Error(errorCode);
  err.code = errorCode;
  err.statusCode = 413;
  err.details = { size, limit };
  throw err;
}

