import { runDeterministicCalculation } from "../accounting/calculationService.js";
import { parseMoney } from "../accounting/numeric.js";

export function executeDeterministicSpreadsheetPlan({
  plan,
  rows = [],
  filters = [],
  userContext = {},
}) {
  if (!plan?.ok) return { ok: false, errorCode: "PLAN_NOT_READY", message: "Deterministic plan is not ready." };

  if (plan.operation === "metric_projection") {
    const dateHeader = String(plan.dateHeader || "").trim();
    const metric = plan.metric;
    const targetYear = Number(plan.targetYear);
    if (!dateHeader || !metric || !Number.isFinite(targetYear)) {
      return { ok: false, errorCode: "PLAN_NOT_READY", message: "Projection plan is incomplete." };
    }

    // 1. Gather historical annual data
    const yearsSet = new Set();
    for (const row of (Array.isArray(rows) ? rows : [])) {
      const raw = row?.[dateHeader];
      if (raw === null || raw === undefined || raw === "") continue;
      const d = new Date(String(raw));
      if (Number.isNaN(d.getTime())) continue;
      const y = Number(d.getFullYear());
      if (Number.isFinite(y) && y >= 1900 && y <= 2200) yearsSet.add(y);
    }
    const historicalYears = Array.from(yearsSet).sort((a, b) => a - b).filter(y => y < targetYear);
    if (historicalYears.length < 2) {
      return { ok: false, errorCode: "INSUFFICIENT_DATA", message: "At least two historical years are required for a trend projection." };
    }

    const annualValues = [];
    for (const y of historicalYears) {
      const out = runDeterministicCalculation({
        rows,
        metric,
        headerResolution: { ok: true, ...(plan.resolution || {}) },
        period: y,
        comparisonPeriod: null,
        filters,
        userContext,
      });
      if (out?.ok && typeof out.value === "number") {
        annualValues.push({ x: y, y: out.value });
      }
    }

    if (annualValues.length < 2) {
      return { ok: false, errorCode: "INSUFFICIENT_DATA", message: "Not enough valid historical data points found for projection." };
    }

    // 2. Linear Regression (Least Squares)
    const n = annualValues.length;
    const sumX = annualValues.reduce((acc, p) => acc + p.x, 0);
    const sumY = annualValues.reduce((acc, p) => acc + p.y, 0);
    const sumXX = annualValues.reduce((acc, p) => acc + p.x * p.x, 0);
    const sumXY = annualValues.reduce((acc, p) => acc + p.x * p.y, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    const projectedValue = intercept + slope * targetYear;
    
    // Calculate R-squared for confidence
    const yMean = sumY / n;
    const ssTot = annualValues.reduce((acc, p) => acc + Math.pow(p.y - yMean, 2), 0);
    const ssRes = annualValues.reduce((acc, p) => acc + Math.pow(p.y - (intercept + slope * p.x), 2), 0);
    const rSquared = ssTot === 0 ? 1 : 1 - (ssRes / ssTot);

    return {
      ok: true,
      metric,
      label: `Projected ${metric} for ${targetYear}`,
      outputType: "currency", // Most projected metrics are currency
      value: projectedValue,
      confidence: rSquared,
      historicalPoints: annualValues.length,
      slope,
      period: { label: String(targetYear) },
      isProjection: true,
    };
  }

  if (plan.operation === "driver_year_change") {
    const dateHeader = String(plan.dateHeader || "").trim();
    const dimension = String(plan.dimensionHeader || "").trim();
    const valueHeader = String(plan.valueHeader || "").trim();
    const year = Number(plan.year);
    if (!dateHeader || !dimension || !valueHeader || !Number.isFinite(year)) {
      return { ok: false, errorCode: "PLAN_NOT_READY", message: "Driver analysis plan is incomplete." };
    }
    const current = new Map();
    const prior = new Map();
    let invalid = 0;
    let used = 0;
    for (const row of (Array.isArray(rows) ? rows : [])) {
      const key = String(row?.[dimension] ?? "").trim();
      if (!key) continue;
      const rawDate = row?.[dateHeader];
      const d = rawDate ? new Date(String(rawDate)) : null;
      if (!d || Number.isNaN(d.getTime())) continue;
      const y = Number(d.getFullYear());
      if (y !== year && y !== year - 1) continue;
      const parsed = parseMoney(row?.[valueHeader]);
      if (!parsed?.ok || !Number.isFinite(Number(parsed.value))) { invalid += 1; continue; }
      used += 1;
      if (y === year) current.set(key, (current.get(key) || 0) + Number(parsed.value || 0));
      if (y === year - 1) prior.set(key, (prior.get(key) || 0) + Number(parsed.value || 0));
    }
    const allKeys = new Set([...current.keys(), ...prior.keys()]);
    const ranked = Array.from(allKeys).map((label) => {
      const cur = Number(current.get(label) || 0);
      const prev = Number(prior.get(label) || 0);
      return { label, value: cur - prev, current: cur, previous: prev };
    });
    const direction = String(plan.direction || "growth") === "decline" ? "asc" : "desc";
    ranked.sort((a, b) => direction === "asc" ? (a.value - b.value) : (b.value - a.value));
    return {
      ok: true,
      metric: "driver_year_change",
      label: `Top driver ${direction === "asc" ? "of decline" : "of growth"} in ${year}`,
      outputType: "ranking",
      value: null,
      rowCount: used,
      notes: invalid > 0 ? [`Ignored ${invalid} invalid numeric cell(s).`] : [],
      headersUsed: { date: dateHeader, dimension, value: valueHeader },
      ranking: ranked.slice(0, 1),
      rankingAll: ranked,
      period: { label: `${year - 1} -> ${year}` },
    };
  }

  if (plan.operation === "top_n_by_year") {
    const dateHeader = String(plan.dateHeader || "").trim();
    const valueHeader = String(plan.valueHeader || "").trim();
    if (!dateHeader || !valueHeader) return { ok: false, errorCode: "PLAN_NOT_READY", message: "Year ranking plan is incomplete." };
    const agg = new Map();
    let invalid = 0;
    let used = 0;
    for (const row of (Array.isArray(rows) ? rows : [])) {
      const rawDate = row?.[dateHeader];
      const d = rawDate ? new Date(String(rawDate)) : null;
      if (!d || Number.isNaN(d.getTime())) continue;
      const year = Number(d.getFullYear());
      if (!Number.isFinite(year) || year < 1900 || year > 2200) continue;
      const parsed = parseMoney(row?.[valueHeader]);
      if (!parsed?.ok || !Number.isFinite(Number(parsed.value))) { invalid += 1; continue; }
      used += 1;
      agg.set(String(year), (agg.get(String(year)) || 0) + Number(parsed.value || 0));
    }
    const direction = String(plan.direction || "desc").toLowerCase() === "asc" ? "asc" : "desc";
    const ranked = Array.from(agg.entries())
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => direction === "asc" ? (a.value - b.value) : (b.value - a.value));
    const limit = Number.isFinite(Number(plan.limit)) ? Math.max(1, Number(plan.limit)) : 1;
    return {
      ok: true,
      metric: "top_n_by_year",
      label: `${direction === "asc" ? "Bottom" : "Top"} ${limit} year(s) by ${valueHeader}`,
      outputType: "ranking",
      value: null,
      rowCount: used,
      notes: invalid > 0 ? [`Ignored ${invalid} invalid numeric cell(s).`] : [],
      headersUsed: { date: dateHeader, value: valueHeader },
      ranking: ranked.slice(0, limit),
      rankingAll: ranked,
    };
  }

  if (plan.operation === "top_n_by_dimension") {
    const dimension = String(plan.dimensionHeader || "").trim();
    const valueHeader = String(plan.valueHeader || "").trim();
    if (!dimension || !valueHeader) return { ok: false, errorCode: "PLAN_NOT_READY", message: "Ranking plan is incomplete." };
    const agg = new Map();
    let invalid = 0;
    let used = 0;
    for (const row of (Array.isArray(rows) ? rows : [])) {
      const key = String(row?.[dimension] ?? "").trim();
      if (!key) continue;
      const parsed = parseMoney(row?.[valueHeader]);
      if (!parsed?.ok || !Number.isFinite(Number(parsed.value))) { invalid += 1; continue; }
      used += 1;
      agg.set(key, (agg.get(key) || 0) + Number(parsed.value || 0));
    }
    const direction = String(plan.direction || "desc").toLowerCase() === "asc" ? "asc" : "desc";
    const ranked = Array.from(agg.entries())
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => direction === "asc" ? (a.value - b.value) : (b.value - a.value));
    const limit = Number.isFinite(Number(plan.limit)) ? Math.max(1, Number(plan.limit)) : 1;
    return {
      ok: true,
      metric: "top_n_by_dimension",
      label: `${direction === "asc" ? "Bottom" : "Top"} ${limit} by ${dimension}`,
      outputType: "ranking",
      value: null,
      rowCount: used,
      notes: invalid > 0 ? [`Ignored ${invalid} invalid numeric cell(s).`] : [],
      headersUsed: { dimension, value: valueHeader },
      ranking: ranked.slice(0, limit),
      rankingAll: ranked,
      accountOnly: plan.accountOnly === true,
    };
  }

  if (plan.operation === "yoy_series") {
    const dateHeader = plan?.resolution?.resolvedMappings?.date || plan?.resolution?.optionalMappings?.date || null;
    if (!dateHeader) return { ok: false, errorCode: "DATE_HEADER_MISSING", message: "Date header is required for YoY series." };
    const yearsSet = new Set();
    for (const row of (Array.isArray(rows) ? rows : [])) {
      const raw = row?.[dateHeader];
      if (raw === null || raw === undefined || raw === "") continue;
      const d = new Date(String(raw));
      if (Number.isNaN(d.getTime())) continue;
      const y = Number(d.getFullYear());
      if (Number.isFinite(y) && y >= 1900 && y <= 2200) yearsSet.add(y);
    }
    let years = Array.from(yearsSet).sort((a, b) => a - b);
    if (Array.isArray(plan.years) && plan.years.length >= 2) {
      const minY = Math.min(...plan.years.map(Number));
      const maxY = Math.max(...plan.years.map(Number));
      years = years.filter((y) => y >= minY && y <= maxY);
    }
    if (years.length < 2) {
      return { ok: false, errorCode: "INSUFFICIENT_YEARS", message: "At least two years are required for YoY series." };
    }
    const perYear = [];
    for (const y of years) {
      const out = runDeterministicCalculation({
        rows,
        metric: plan.metric,
        headerResolution: { ok: true, ...(plan.resolution || {}) },
        period: y,
        comparisonPeriod: null,
        filters,
        userContext,
      });
      if (!out?.ok) return out;
      perYear.push({ year: y, value: Number(out.value || 0), rowCount: Number(out.rowCount || 0), notes: out.notes || [], headersUsed: out.headersUsed || {} });
    }
    const series = perYear.map((cur, i) => {
      if (i === 0) return { ...cur, delta: null, deltaPct: null };
      const prev = perYear[i - 1];
      const delta = cur.value - prev.value;
      const deltaPct = prev.value === 0 ? null : (delta / prev.value) * 100;
      return { ...cur, delta, deltaPct };
    });
    return {
      ok: true,
      metric: plan.metric,
      label: `${plan.metric} YoY`,
      outputType: "series",
      period: { label: `${years[0]} -> ${years[years.length - 1]}` },
      rowCount: series.reduce((a, r) => a + Number(r.rowCount || 0), 0),
      headersUsed: series[0]?.headersUsed || {},
      series,
      value: null,
      notes: [],
    };
  }

  if (plan.operation === "two_year_delta" && Array.isArray(plan.years) && plan.years.length >= 2) {
    const a = Number(plan.years[0]);
    const b = Number(plan.years[1]);
    const startResult = runDeterministicCalculation({
      rows,
      metric: plan.metric,
      headerResolution: { ok: true, ...(plan.resolution || {}) },
      period: a,
      comparisonPeriod: null,
      filters,
      userContext,
    });
    const endResult = runDeterministicCalculation({
      rows,
      metric: plan.metric,
      headerResolution: { ok: true, ...(plan.resolution || {}) },
      period: b,
      comparisonPeriod: null,
      filters,
      userContext,
    });
    if (!startResult.ok) return startResult;
    if (!endResult.ok) return endResult;
    return {
      ok: true,
      metric: plan.metric,
      label: `${plan.metric} delta`,
      value: Number(endResult.value || 0) - Number(startResult.value || 0),
      outputType: endResult.outputType || "currency",
      period: { label: `${a} -> ${b}` },
      notes: [...(startResult.notes || []), ...(endResult.notes || [])],
      headersUsed: endResult.headersUsed || startResult.headersUsed || {},
      rowCount: Number(endResult.rowCount || 0),
    };
  }

  const out = runDeterministicCalculation({
    rows,
    metric: plan.metric,
    headerResolution: { ok: true, ...(plan.resolution || {}) },
    period: plan.period || null,
    comparisonPeriod: plan.comparisonPeriod || null,
    filters,
    userContext,
  });
  if (plan.operation === "single_period" && plan.period !== null && plan.period !== undefined) {
    if (out?.ok === true && Number(out?.rowCount || 0) <= 0) {
      return { ok: false, errorCode: "NO_DATA_FOR_PERIOD", message: `No rows matched period ${String(plan.period)}.` };
    }
  }
  return out;
}
