export function buildComplexAnswerTemplate({ analysisResult }) {
  if (!analysisResult?.ok) return analysisResult?.message || "Unable to complete the analysis safely.";
  const primary = analysisResult?.results?.profit_variance || analysisResult?.results?.primary || null;
  const varAmt = primary?.varianceAmount ?? "N/A";
  const varPct = primary?.variancePct ?? "N/A";
  const periodLabel = analysisResult?.period?.label || "current period";
  const compLabel = analysisResult?.comparisonPeriod?.label || "comparison period";
  const limitations = (analysisResult?.limitations || []).join(" ") || "None.";
  return `${analysisResult.primaryMetric || "Primary metric"} changed by ${varAmt}, or ${varPct}%, from ${compLabel} to ${periodLabel}.\n\nLimitations:\n${limitations}`;
}
