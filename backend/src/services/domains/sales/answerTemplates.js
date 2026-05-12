export function salesAnswerTemplate({ result, rankingMetric = null }) {
  if (!result?.ok) return result?.message || "I could not complete this sales analysis safely.";
  const metricNote = rankingMetric ? ` Performance metric: ${rankingMetric}.` : "";
  return `Based on this spreadsheet, ${result.label} is ${result.value}${result.outputType === "percent" ? "%" : ""}.${metricNote} Forecast certainty is not implied.`;
}
