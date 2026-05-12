export function marketingAnswerTemplate({ result, rankingMetric = null }) {
  if (!result?.ok) return result?.message || "I could not complete this marketing analysis safely.";
  const metricNote = rankingMetric ? ` Ranking metric: ${rankingMetric}.` : "";
  return `Based on this spreadsheet, ${result.label} is ${result.value}${result.outputType === "percent" ? "%" : ""}.${metricNote} This does not prove causality.`;
}
