export function financeAnswerTemplate({ result }) {
  if (!result?.ok) return result?.message || "I could not complete this finance analysis safely.";
  return `Based on this spreadsheet, ${result.label} is ${result.value}${result.outputType === "percent" ? "%" : ""}. This is educational analysis, not investment advice.`;
}
