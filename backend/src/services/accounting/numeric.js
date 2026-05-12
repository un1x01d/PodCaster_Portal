import Decimal from "decimal.js";

function normalizeNumericText(value) {
  let s = String(value ?? "").trim();
  if (!s) return "";
  const negParen = /^\(.*\)$/.test(s);
  if (negParen) s = `-${s.slice(1, -1)}`;
  s = s.replace(/[$,\s]/g, "").replace(/%/g, "");
  return s;
}

function parseGeneric(value) {
  const originalValue = value;
  if (value === null || value === undefined || String(value).trim() === "") return { ok: false, value: null, originalValue, reason: "BLANK" };
  const raw = String(value).trim();
  if (/^(n\/a|na|null|none|nan)$/i.test(raw)) return { ok: false, value: null, originalValue, reason: "INVALID_NUMBER" };
  const normalized = normalizeNumericText(raw);
  if (!/^[-+]?\d*\.?\d+$/.test(normalized)) return { ok: false, value: null, originalValue, reason: "INVALID_NUMBER" };
  try {
    const decimalValue = new Decimal(normalized);
    return { ok: true, value: Number(decimalValue.toString()), decimalValue, originalValue };
  } catch {
    return { ok: false, value: null, originalValue, reason: "INVALID_NUMBER" };
  }
}

export function parseMoney(value) { return parseGeneric(value); }
export function parsePercent(value) { return parseGeneric(value); }

export function safeSum(rows = [], header) {
  let sum = new Decimal(0);
  let invalidCount = 0;
  let blankCount = 0;
  for (const row of rows) {
    const p = parseMoney(row?.[header]);
    if (!p.ok) {
      if (p.reason === "BLANK") blankCount += 1;
      else invalidCount += 1;
      continue;
    }
    sum = sum.plus(p.decimalValue ?? new Decimal(p.value));
  }
  return { value: sum, invalidCount, blankCount };
}

export function safeDivide(numerator, denominator) {
  try {
    const n = numerator instanceof Decimal ? numerator : new Decimal(numerator || 0);
    const d = denominator instanceof Decimal ? denominator : new Decimal(denominator || 0);
    if (d.isZero()) return { ok: false, value: null, reason: "DIVIDE_BY_ZERO" };
    return { ok: true, value: n.div(d) };
  } catch {
    return { ok: false, value: null, reason: "DIVIDE_BY_ZERO" };
  }
}

export function roundCurrency(value) {
  if (value === null || value === undefined) return null;
  try {
    const d = value instanceof Decimal ? value : new Decimal(value);
    return Number(d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString());
  } catch {
    return null;
  }
}

export function roundPercent(value) { return roundCurrency(value); }
