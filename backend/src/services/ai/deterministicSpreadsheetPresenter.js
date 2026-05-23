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
    if (shouldForceScalar) return `${formatValue(calcResult.value, plan?.metric || "")}${uncertaintyBadge}${confidenceSuffix}`;

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
    return `Projected ${calcResult.metric} for ${calcResult.period?.label} is ${val}; trend is ${trend} with ${confidenceLabel} confidence (R² = ${confidence.toFixed(2)}).${confidenceSuffix}`;
  }

  const explained = await explainAccountingResult({
    originalQuestion: message,
    analysis: accountingIntent,
    headerResolution: plan?.resolution || {},
    calculationResult: calcResult,
    runtime: { ...(runtime || {}), locale },
  });
  return `${explained}${uncertaintyBadge}${confidenceSuffix}`;
}
