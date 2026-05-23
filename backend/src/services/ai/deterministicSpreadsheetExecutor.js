import { runDeterministicCalculation } from "../accounting/calculationService.js";
import { parseMoney } from "../accounting/numeric.js";

function extractYearFromValue(raw) {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  if (!text) return null;
  const d = new Date(text);
  if (!Number.isNaN(d.getTime())) {
    const y = Number(d.getFullYear());
    if (Number.isFinite(y) && y >= 1900 && y <= 2200) return y;
  }
  const m = text.match(/\b(19\d{2}|20\d{2})\b/);
  if (m) {
    const y = Number(m[1]);
    if (Number.isFinite(y) && y >= 1900 && y <= 2200) return y;
  }
  return null;
}

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
    const targetYears = Array.isArray(plan.targetYears) ? plan.targetYears.map(Number) : [Number(plan.targetYear)];
    if (!dateHeader || !metric || targetYears.some(y => !Number.isFinite(y))) {
      return { ok: false, errorCode: "PLAN_NOT_READY", message: "Projection plan is incomplete." };
    }

    // 1. Gather historical annual data
    const yearsSet = new Set();
    for (const row of (Array.isArray(rows) ? rows : [])) {
      const y = extractYearFromValue(row?.[dateHeader]);
      if (y !== null && y < Math.min(...targetYears)) yearsSet.add(y);
    }
    const historicalYears = Array.from(yearsSet).sort((a, b) => a - b);
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

    // Calculate R-squared for confidence
    const yMean = sumY / n;
    const ssTot = annualValues.reduce((acc, p) => acc + Math.pow(p.y - yMean, 2), 0);
    const ssRes = annualValues.reduce((acc, p) => acc + Math.pow(p.y - (intercept + slope * p.x), 2), 0);
    const rSquared = ssTot === 0 ? 1 : 1 - (ssRes / ssTot);

    if (targetYears.length > 1) {
      const sortedTargets = [...targetYears].sort((a, b) => a - b);
      const series = [];
      let prevVal = annualValues[annualValues.length - 1].y;
      
      for (const ty of sortedTargets) {
        const val = intercept + slope * ty;
        series.push({
          year: ty,
          value: val,
          delta: val - prevVal,
          deltaPct: prevVal === 0 ? 0 : ((val - prevVal) / Math.abs(prevVal)) * 100,
          isProjection: true
        });
        prevVal = val;
      }
      return {
        ok: true,
        metric,
        label: `Projected ${metric} Trend`,
        outputType: "series",
        series,
        confidence: rSquared,
        isProjection: true,
        historicalPoints: annualValues.length,
        period: { label: `${sortedTargets[0]}-${sortedTargets[sortedTargets.length - 1]}` },
        rowCount: historicalYears.length,
        headersUsed: plan.resolution?.resolvedMappings || {},
        notes: [`Assumed values based on historical trend (R²=${rSquared.toFixed(2)})`],
      };
    }

    const singleTarget = targetYears[0];
    const projectedValue = intercept + slope * singleTarget;

    return {
      ok: true,
      metric,
      label: `Projected ${metric} for ${singleTarget}`,
      outputType: "currency",
      value: projectedValue,
      confidence: rSquared,
      historicalPoints: annualValues.length,
      slope,
      period: { label: String(singleTarget) },
      isProjection: true,
      rowCount: historicalYears.length,
      headersUsed: plan.resolution?.resolvedMappings || {},
      notes: [`Assumed value based on historical trend (R²=${rSquared.toFixed(2)})`],
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
      const year = extractYearFromValue(row?.[dateHeader]);
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
      const y = extractYearFromValue(row?.[dateHeader]);
      if (Number.isFinite(y)) yearsSet.add(y);
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

  if (plan.operation === "driver_analysis") {
    const comparison = plan.comparison || {};
    const baseMetric = plan.base_metric || {};
    const baselineLabel = comparison.baseline_label || "Baseline";
    const comparisonLabel = comparison.comparison_label || "Comparison";
    const baselineStart = comparison.baseline_range?.start ? Number(comparison.baseline_range.start.slice(0, 4)) : null;
    const comparisonStart = comparison.comparison_range?.start ? Number(comparison.comparison_range.start.slice(0, 4)) : null;
    
    const baselineResult = runDeterministicCalculation({
      rows,
      metric: plan.metric,
      headerResolution: { ok: true, ...(plan.resolution || {}) },
      period: baselineStart,
      comparisonPeriod: null,
      filters,
      userContext,
    });
    const comparisonResult = runDeterministicCalculation({
      rows,
      metric: plan.metric,
      headerResolution: { ok: true, ...(plan.resolution || {}) },
      period: comparisonStart,
      comparisonPeriod: null,
      filters,
      userContext,
    });

    if (!baselineResult.ok || !comparisonResult.ok) {
      return { ok: false, errorCode: "CALCULATION_FAILED", message: "Failed to calculate base metric for driver analysis." };
    }

    const baselineValue = Number(baselineResult.value || 0);
    const comparisonValue = Number(comparisonResult.value || 0);
    const absoluteChange = comparisonValue - baselineValue;
    const percentChange = baselineValue === 0 ? null : (absoluteChange / Math.abs(baselineValue)) * 100;

    const drivers = [];
    const possibleDrivers = plan.driver_columns || [];
    for (const dCol of possibleDrivers) {
      if (!userContext.allowedColumns?.includes(dCol)) continue;
      
      const dBaseline = runDeterministicCalculation({
        rows,
        metric: "total_revenue", 
        headerResolution: { ok: true, resolvedMappings: { total_revenue: dCol }, optionalMappings: plan.resolution?.optionalMappings || {} },
        period: baselineStart,
        comparisonPeriod: null,
        filters,
        userContext,
      });
      const dComparison = runDeterministicCalculation({
        rows,
        metric: "total_revenue",
        headerResolution: { ok: true, resolvedMappings: { total_revenue: dCol }, optionalMappings: plan.resolution?.optionalMappings || {} },
        period: comparisonStart,
        comparisonPeriod: null,
        filters,
        userContext,
      });

      if (dBaseline.ok && dComparison.ok) {
        const dbVal = Number(dBaseline.value || 0);
        const dcVal = Number(dComparison.value || 0);
        const delta = dcVal - dbVal;
        
        let impact = "neutral";
        const colLower = dCol.toLowerCase();
        if (/revenue|income|profit|margin|sales/i.test(colLower)) {
          impact = delta > 0 ? "positive" : "negative";
        } else if (/expense|cost|cogs|tax|interest|depreciation|amortization/i.test(colLower)) {
          impact = delta > 0 ? "negative" : "positive";
        }

        if (Math.abs(delta) > 0.01) {
          drivers.push({
            column: dCol,
            baseline_value: dbVal,
            comparison_value: dcVal,
            delta,
            impact_direction: impact,
          });
        }
      }
    }

    drivers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

    const dimension_contributors = {};
    for (const dim of (plan.dimensions || [])) {
      if (!userContext.allowedColumns?.includes(dim)) continue;
      
      // We calculate the base metric split by this dimension for baseline and comparison
      const baselineVals = {};
      for (const row of rows) {
        const dYear = extractYearFromValue(row[plan.resolution?.optionalMappings?.date]);
        if (dYear !== baselineStart) continue;
        const dVal = String(row[dim] || "").trim();
        if (!dVal) continue;
        const pVal = Number(parseMoney(row[plan.resolution?.resolvedMappings?.[plan.metric]])?.value || 0);
        baselineVals[dVal] = (baselineVals[dVal] || 0) + pVal;
      }
      
      const comparisonVals = {};
      for (const row of rows) {
        const dYear = extractYearFromValue(row[plan.resolution?.optionalMappings?.date]);
        if (dYear !== comparisonStart) continue;
        const dVal = String(row[dim] || "").trim();
        if (!dVal) continue;
        const pVal = Number(parseMoney(row[plan.resolution?.resolvedMappings?.[plan.metric]])?.value || 0);
        comparisonVals[dVal] = (comparisonVals[dVal] || 0) + pVal;
      }

      const allKeys = new Set([...Object.keys(baselineVals), ...Object.keys(comparisonVals)]);
      const dimDrivers = [];
      for (const k of allKeys) {
        const bVal = baselineVals[k] || 0;
        const cVal = comparisonVals[k] || 0;
        if (Math.abs(cVal - bVal) > 0.01) {
          dimDrivers.push({
            value: k,
            baseline_value: bVal,
            comparison_value: cVal,
            delta: cVal - bVal
          });
        }
      }
      if (dimDrivers.length > 0) {
        dimDrivers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
        dimension_contributors[dim] = dimDrivers.slice(0, 5);
      }
    }

    return {
      ok: true,
      metric: plan.metric,
      label: "Driver Analysis",
      outputType: "driver_analysis",
      period: { label: `${baselineLabel} vs ${comparisonLabel}` },
      value: null,
      driver_analysis: {
        base_metric: {
          column: plan.metric,
          baseline_value: baselineValue,
          comparison_value: comparisonValue,
          absolute_change: absoluteChange,
          percent_change: percentChange,
        },
        drivers: drivers.slice(0, 10),
        dimension_contributors,
        warnings: ["Driver analysis shows measurable changes, not proven causation."],
      },
      rowCount: (baselineResult.rowCount || 0) + (comparisonResult.rowCount || 0),
      headersUsed: { ...baselineResult.headersUsed, ...comparisonResult.headersUsed },
      notes: [],
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
