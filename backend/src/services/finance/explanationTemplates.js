function periodLabel(period = {}) {
  const s = period?.start || "start";
  const e = period?.end || "end";
  return `${s} to ${e}`;
}

export function buildFinanceExplanation(metric, calculationResult) {
  const p = periodLabel(calculationResult?.period || {});
  const v = calculationResult?.value;
  const n = Number(v);
  const isFiniteNumber = Number.isFinite(n);
  const currencyFmt = (value) => `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmt = calculationResult?.outputType === "percent"
    ? (isFiniteNumber ? `${n.toFixed(2)}%` : String(v))
    : (isFiniteNumber ? currencyFmt(n) : String(v));
  const templates = {
    total_revenue: `Total revenue for ${p} was ${fmt}.`,
    total_expense: `Total expense for ${p} was ${fmt}.`,
    gross_profit: `Gross profit for ${p} was ${fmt}.`,
    gross_margin_pct: `Gross margin for ${p} was ${fmt}.`,
    net_income: `Net income for ${p} was ${fmt}.`,
    expense_ratio_pct: `Expense ratio for ${p} was ${fmt}.`,
    revenue_growth_pct: `Revenue growth for ${p} was ${fmt}.`,
    variance_amount: `Variance was ${fmt}.`,
    variance_pct: `Variance percentage was ${fmt}.`,
  };
  return templates[metric] || `Calculated ${metric}: ${fmt}.`;
}
