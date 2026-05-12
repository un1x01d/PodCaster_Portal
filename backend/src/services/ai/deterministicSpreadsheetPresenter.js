import { explainAccountingResult } from "./accountingResultExplainer.js";
import { buildSimpleDeterministicAnswer } from "../accounting/simpleAnswerTemplates.js";

function formatValue(v, col = "") {
  if (typeof v !== "number" || !Number.isFinite(v)) return String(v ?? "");
  const isCurrency = /price|cost|revenue|income|profit|earnings|salary|wage|amount|balance|total|summ|ebitda|val|fee|tax|debt|loan|payment|capital|asset|liability|equity|budget|spend|cash|funding|sales|purchase/i.test(String(col));
  const isPercent = /percent|margin|rate|ratio|%|markup|yield|growth|change|variance|contribution|roi|roe|roa|discount|utilization/i.test(String(col));
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  const num = abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${sign}${isCurrency ? "$" : ""}${num}${isPercent && !isCurrency ? "%" : ""}`;
}

export async function presentDeterministicSpreadsheetResult({
  message = "",
  plan,
  calcResult,
  accountingIntent,
  runtime,
}) {
  const isStrict = /(mdfc|strict|pure|direct)/i.test(message);

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
    if ((calcResult.ranking || []).length === 1) {
      const item = calcResult.ranking[0];
      return `${item.label} (${formatValue(item.value, plan?.valueHeader || plan?.metric || "")})`;
    }
    return calcResult.ranking
      .map((r, i) => `${i + 1}. ${r.label}: ${formatValue(r.value, plan?.valueHeader || plan?.metric || "")}`)
      .join("\n");
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
  if (shouldForceScalar) return formatValue(calcResult.value, plan?.metric || "");

  if (calcResult.isProjection === true) {
    const val = formatValue(calcResult.value, plan?.metric || "");
    const slope = Number(calcResult.slope || 0);
    const trend = slope >= 0 ? "growing" : "declining";
    const confidence = Number(calcResult.confidence || 0);
    const confidenceLabel = confidence > 0.9 ? "high" : confidence > 0.7 ? "moderate" : "low";
    
    if (shouldForceScalar) return val;

    return `Based on the historical trend from ${calcResult.historicalPoints} data points, the projected ${calcResult.metric} for ${calcResult.period?.label} is ${val}. The recent trend is ${trend}, and this projection has ${confidenceLabel} statistical confidence (R² = ${confidence.toFixed(2)}).`;
  }

  return explainAccountingResult({
    originalQuestion: message,
    analysis: accountingIntent,
    headerResolution: plan?.resolution || {},
    calculationResult: calcResult,
    runtime,
  });
}
