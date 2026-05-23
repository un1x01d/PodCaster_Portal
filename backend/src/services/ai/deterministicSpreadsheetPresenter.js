import { explainAccountingResult } from "./accountingResultExplainer.js";
import { buildSimpleDeterministicAnswer } from "../accounting/simpleAnswerTemplates.js";

function formatValue(v, col = "") {
  if (typeof v !== "number" || !Number.isFinite(v)) return String(v ?? "");
  const isPercent = /percent|margin|rate|ratio|%|markup|yield|growth|change|variance|contribution|roi|roe|roa|discount|utilization/i.test(String(col));
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  const num = abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // Default deterministic chat outputs to USD unless metric explicitly represents a percentage.
  return isPercent ? `${sign}${num}%` : `${sign}$${num}`;
}

function forceDollarCurrency(text = "") {
  let s = String(text || "");
  s = s.replace(/(\d[\d,]*(\.\d+)?)\s*(грн|uah|руб|rub|eur|gbp|jpy|грн\.)/gi, "$$$1");
  s = s.replace(/([€£¥₽])\s*(\d)/g, "$$$2");
  return s;
}

export async function presentDeterministicSpreadsheetResult({
  message = "",
  plan,
  calcResult,
  accountingIntent,
  runtime,
  locale = "en",
}) {
  const isStrict = /(mdfc|strict|pure|direct)/i.test(message);
  const lang = String(locale || "en").toLowerCase();
  const confidenceValue = Number(plan?.verification_gate?.confidence);
  const showConfidence = plan?.verification_gate?.warning === true;
  const confidenceSuffix = showConfidence && Number.isFinite(confidenceValue)
    ? (lang.startsWith("uk")
      ? ` Достовірність: ${(confidenceValue * 100).toFixed(1)}%.`
      : (lang.startsWith("ru")
        ? ` Достоверность: ${(confidenceValue * 100).toFixed(1)}%.`
        : ` Confidence: ${(confidenceValue * 100).toFixed(1)}%.`))
    : "";
  const uncertaintyBadge = plan?.verification_gate?.warning === true
    ? " [Uncertainty: high-prob mapping]"
    : "";

  if (!calcResult?.ok) {
    if (isStrict) {
      if (calcResult?.errorCode === "MISSING_REQUIRED_COLUMNS") return "MISSING_DATA";
      return `ERROR -> ${calcResult?.errorCode || "CALC_ERR"}`;
    }
    return buildSimpleDeterministicAnswer({
      metric: plan?.metric,
      result: calcResult,
      periodLabel: calcResult?.period?.label || "selected period",
    });
  }

  if (isStrict) {
    const h = calcResult.headersUsed || {};
    const primaryHeader = h.revenue || h.expenses || h.value || Object.values(h)[0] || "N/A";
    if (calcResult.value === "DIV_ZERO_ERR") return `[${primaryHeader}] -> [${calcResult.metric || plan?.metric}]: DIV_ZERO_ERR`;
    
    // Handle division by zero check in case value is null/NaN but ok is true
    if (calcResult.value === null || !Number.isFinite(calcResult.value)) {
       const note = (calcResult.notes || []).join(" ");
       if (note.includes("denominator is zero")) return `[${primaryHeader}] -> [${calcResult.metric || plan?.metric}]: DIV_ZERO_ERR`;
       return `[${primaryHeader}] -> [${calcResult.metric || plan?.metric}]: 0.00`;
    }

    const val = formatValue(calcResult.value, plan?.metric || "");
    const isSemantic = plan?.resolution?.resolvedMappings?.[calcResult.metric] === "semantic_match" || 
                       Object.values(plan?.resolution || {}).some(r => r?.method === "semantic_match");
    return `[${primaryHeader}] -> [${calcResult.metric || plan?.metric}]${isSemantic ? " (Semantic Match)" : ""}: ${val}`;
  }



  if (calcResult?.outputType === "driver_analysis") {
    const d = calcResult.driver_analysis;
    const bm = d.base_metric;
    const dir = bm.absolute_change >= 0 ? "increased" : "decreased";
    const abs = Math.abs(bm.absolute_change);
    const absStr = formatValue(abs, bm.column);
    const pctStr = bm.percent_change !== null ? ` (${Math.abs(bm.percent_change).toFixed(1)}%)` : "";
    let msg = `${bm.column} ${dir} by ${absStr}${pctStr} from ${calcResult.period?.label || "the baseline"}.`;
    
    if (d.drivers && d.drivers.length > 0) {
      msg += `\n\nThe biggest measurable drivers were:`;
      for (const drv of d.drivers) {
        const dDir = drv.delta >= 0 ? "increased" : "decreased";
        const dAbs = formatValue(Math.abs(drv.delta), drv.column);
        const impactStr = drv.impact_direction === "positive" ? "improving" : (drv.impact_direction === "negative" ? "reducing" : "affecting");
        msg += `\n- ${drv.column} ${dDir} by ${dAbs}, ${impactStr} the base metric.`;
      }
    } else {
      msg += `\n\nNo significant measurable drivers were found in the allowed columns.`;
    }

    if (d.dimension_contributors && Object.keys(d.dimension_contributors).length > 0) {
      msg += `\n\nBy dimension:`;
      for (const [dim, contributors] of Object.entries(d.dimension_contributors)) {
        msg += `\n- ${dim}:`;
        for (const c of contributors) {
          const cDir = c.delta >= 0 ? "increased" : "decreased";
          msg += ` ${c.value} ${cDir} by ${formatValue(Math.abs(c.delta), plan?.metric)},`;
        }
        msg = msg.replace(/,$/, ".");
      }
    }
    
    if (d.warnings && d.warnings.length) {
      msg += `\n\nNote: ${d.warnings[0]}`;
    }
    return msg;
  }

  if (Array.isArray(calcResult?.ranking) && calcResult.ranking.length) {
    if (calcResult.accountOnly === true) return String(calcResult.ranking[0]?.label || "");
    const dimensionHeader = String(calcResult?.headersUsed?.dimension || "").trim();
    const valueHeader = String(plan?.valueHeader || calcResult?.headersUsed?.value || plan?.metric || "").trim();
    const periodLabel = String(calcResult?.period?.label || "").trim();
    const top = calcResult.ranking[0];
    const topValue = formatValue(Number(top?.value || 0), valueHeader);
    const periodSuffix = periodLabel ? ` for ${periodLabel}` : "";
    if ((calcResult.ranking || []).length === 1) {
      const item = calcResult.ranking[0];
      if (dimensionHeader) {
        return `The ${dimensionHeader} with the highest ${valueHeader}${periodSuffix} is ${item.label} at ${formatValue(item.value, valueHeader)}.`;
      }
      return `${item.label} (${formatValue(item.value, valueHeader)})`;
    }
    const lead = dimensionHeader
      ? `The ${dimensionHeader} with the highest ${valueHeader}${periodSuffix} is ${top?.label || "N/A"} at ${topValue}.`
      : `The top result for ${valueHeader}${periodSuffix} is ${top?.label || "N/A"} at ${topValue}.`;
    const list = calcResult.ranking
      .map((r, i) => `${i + 1}. ${r.label}: ${formatValue(r.value, valueHeader)}`)
      .join("\n");
    return `${lead}\nTop ${calcResult.ranking.length} values:\n${list}`;
  }
  if (Array.isArray(calcResult?.series) && calcResult.series.length) {
    const lines = calcResult.series.map((r) => {
      if (r.delta === null || r.deltaPct === null) return `${r.year}: ${formatValue(r.value, plan?.metric || "")}`;
      const deltaSign = Number(r.delta) >= 0 ? "+" : "";
      const pctSign = Number(r.deltaPct) >= 0 ? "+" : "";
      return `${r.year}: ${formatValue(r.value, plan?.metric || "")} (${deltaSign}${formatValue(r.delta, plan?.metric || "")}, ${pctSign}${Number(r.deltaPct).toFixed(2)}%)`;
    });
    return lines.join("\n");
  }
  const isDirectScalar = /\b(19\d{2}|20\d{2})\b/.test(message)
    && /\b(what|how much|total|sum|revenue|income|sales|expense|profit|delta|difference|between|vs|versus)\b/i.test(message);
  const shouldForceScalar =
    (isDirectScalar || (String(plan?.operation || "") === "single_period" && calcResult?.period && typeof calcResult?.value === "number"))
    && plan?.operation !== "metric_projection";
    if (shouldForceScalar) return forceDollarCurrency(`${formatValue(calcResult.value, plan?.metric || "")}${uncertaintyBadge}${confidenceSuffix}`);

  if (calcResult.isProjection === true) {
    const val = formatValue(calcResult.value, plan?.metric || "");
    const slope = Number(calcResult.slope || 0);
    const confidence = Number(calcResult.confidence || 0);
    
    if (shouldForceScalar) return val;
    const explainedProjection = await explainAccountingResult({
      originalQuestion: message,
      analysis: accountingIntent,
      headerResolution: plan?.resolution || {},
      calculationResult: calcResult,
      runtime: { ...(runtime || {}), locale },
    });
    if (String(explainedProjection || "").trim()) return `${explainedProjection}${confidenceSuffix}`;
    const trend = slope >= 0 ? "growing" : "declining";
    const confidenceLabel = confidence > 0.9 ? "high" : confidence > 0.7 ? "moderate" : "low";
    return forceDollarCurrency(`Projected ${calcResult.metric} for ${calcResult.period?.label} is ${val}; trend is ${trend} with ${confidenceLabel} confidence (R² = ${confidence.toFixed(2)}).${confidenceSuffix}`);
  }

  const explained = await explainAccountingResult({
    originalQuestion: message,
    analysis: accountingIntent,
    headerResolution: plan?.resolution || {},
    calculationResult: calcResult,
    runtime: { ...(runtime || {}), locale },
  });
  return forceDollarCurrency(`${explained}${uncertaintyBadge}${confidenceSuffix}`);
}
