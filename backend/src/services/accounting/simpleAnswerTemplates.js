function fmt(v, type) {
  if (v === null || v === undefined) return "N/A";
  const n = Number(v);
  if (!Number.isFinite(n)) return "N/A";
  if (type === "percent") return `${n.toFixed(2)}%`;
  return `$${n.toFixed(2)}`;
}

export function buildSimpleDeterministicAnswer({ metric, result, periodLabel = "selected period" }) {
  if (!result?.ok) return `${result?.message || "I could not complete this calculation."}`;
  const h = result.headersUsed || {};
  const value = fmt(result.value, result.outputType);
  if (metric === "total_revenue") return `Total revenue for ${periodLabel} was ${value}. I calculated this using ${h.revenue || "the mapped revenue column"}.`;
  if (metric === "gross_margin_pct") return `Gross margin for ${periodLabel} was ${value}. I calculated this using ${h.revenue || "revenue"} as revenue and ${h.cogs || "COGS"} as COGS.`;
  if (metric === "net_income") {
    if (h.netIncome) return `Net income for ${periodLabel} was ${value}. I calculated this using ${h.netIncome}.`;
    return `Net income for ${periodLabel} was ${value}. I calculated this as revenue minus expenses.`;
  }
  return `${result.label || metric} for ${periodLabel} was ${value}.`;
}
