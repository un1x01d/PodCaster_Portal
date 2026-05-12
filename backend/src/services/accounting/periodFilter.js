import { parseISO, isValid, subYears } from "date-fns";

function toIsoDate(d) { return d.toISOString().slice(0, 10); }

export function normalizePeriod(period) {
  if (!period) return null;
  if (typeof period === "number" || /^\d{4}$/.test(String(period))) {
    const y = Number(period);
    return { start: `${y}-01-01`, end: `${y}-12-31`, label: String(y) };
  }
  if (typeof period === "object" && period.start && period.end) {
    const s = parseISO(String(period.start));
    const e = parseISO(String(period.end));
    if (!isValid(s) || !isValid(e)) return null;
    return { start: toIsoDate(s), end: toIsoDate(e), label: period.label || `${toIsoDate(s)} to ${toIsoDate(e)}` };
  }
  return null;
}

export function inferComparisonPeriod(period) {
  const p = normalizePeriod(period);
  if (!p) return null;
  const s = parseISO(p.start);
  const e = parseISO(p.end);
  if (!isValid(s) || !isValid(e)) return null;
  return { start: toIsoDate(subYears(s, 1)), end: toIsoDate(subYears(e, 1)), label: String(Number(String(p.start).slice(0, 4)) - 1) };
}

export function filterRowsByPeriod(rows = [], dateHeader, period) {
  const p = normalizePeriod(period);
  if (!p || !dateHeader) return { rows: Array.isArray(rows) ? rows : [], excludedInvalidDate: 0, period: p };
  const start = new Date(`${p.start}T00:00:00Z`);
  const end = new Date(`${p.end}T23:59:59Z`);
  const out = [];
  let excludedInvalidDate = 0;
  for (const row of (Array.isArray(rows) ? rows : [])) {
    const raw = String(row?.[dateHeader] || "").trim();
    const d = raw ? new Date(raw) : new Date("invalid");
    if (!isValid(d)) { excludedInvalidDate += 1; continue; }
    if (d >= start && d <= end) out.push(row);
  }
  return { rows: out, excludedInvalidDate, period: p };
}
