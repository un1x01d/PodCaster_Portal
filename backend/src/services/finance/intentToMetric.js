const map = [
  { re: /\b(total\s+revenue|revenue)\b/i, metric: "total_revenue" },
  { re: /\b(expenses?|total\s+expense)\b/i, metric: "total_expense" },
  { re: /\b(gross\s+profit)\b/i, metric: "gross_profit" },
  { re: /\b(gross\s+margin)\b/i, metric: "gross_margin_pct" },
  { re: /\b(net\s+income|profit)\b/i, metric: "net_income" },
  { re: /\b(expense\s+ratio)\b/i, metric: "expense_ratio_pct" },
  { re: /\b(growth)\b/i, metric: "revenue_growth_pct" },
  { re: /\b(variance\s+percent|variance\s+%)\b/i, metric: "variance_pct" },
  { re: /\b(variance)\b/i, metric: "variance_amount" },
];

export function mapIntentToMetric(question = "") {
  const q = String(question || "").trim();
  const hits = map.filter((m) => m.re.test(q));
  const uniq = Array.from(new Set(hits.map((h) => h.metric)));
  if (!uniq.length) return { ok: false, errorCode: "AMBIGUOUS_METRIC", message: "I can calculate revenue, gross margin, net income, or variance. Please specify which one." };
  if (uniq.length > 1) return { ok: false, errorCode: "AMBIGUOUS_METRIC", message: "Multiple finance metrics detected. Please specify one metric.", candidates: uniq };
  return { ok: true, metric: uniq[0], requiresCalculation: true };
}
