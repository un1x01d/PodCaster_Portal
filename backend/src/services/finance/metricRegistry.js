const toSafeNumber = (value) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[$,%\s,]/g, "").trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};

const sumCol = (rows, col) => rows.reduce((acc, row) => {
  const n = toSafeNumber(row?.[col]);
  return n === null ? acc : acc + n;
}, 0);

const safePct = (num, den) => {
  if (!Number.isFinite(den) || den === 0) return { value: null, note: "Division by zero; percentage unavailable." };
  return { value: (num / den) * 100, note: null };
};

export const metricRegistry = {
  total_revenue: { key: "total_revenue", label: "Total Revenue", description: "Sum of revenue.", requiredColumns: ["revenue"], formula: "SUM(revenue)", outputType: "currency", calculate: ({ rows, columns }) => { const revenue = sumCol(rows, columns.revenue); return { value: revenue, inputs: { revenue }, notes: [] }; } },
  total_expense: { key: "total_expense", label: "Total Expense", description: "Sum of expenses.", requiredColumns: ["expense"], formula: "SUM(expense)", outputType: "currency", calculate: ({ rows, columns }) => { const expense = sumCol(rows, columns.expense); return { value: expense, inputs: { expense }, notes: [] }; } },
  gross_profit: { key: "gross_profit", label: "Gross Profit", description: "Revenue minus COGS.", requiredColumns: ["revenue", "cogs"], formula: "SUM(revenue) - SUM(cogs)", outputType: "currency", calculate: ({ rows, columns }) => { const revenue = sumCol(rows, columns.revenue); const cogs = sumCol(rows, columns.cogs); return { value: revenue - cogs, inputs: { revenue, cogs }, notes: [] }; } },
  gross_margin_pct: { key: "gross_margin_pct", label: "Gross Margin %", description: "(Revenue - COGS) / Revenue * 100.", requiredColumns: ["revenue", "cogs"], formula: "(SUM(revenue) - SUM(cogs)) / SUM(revenue) * 100", outputType: "percent", calculate: ({ rows, columns }) => { const revenue = sumCol(rows, columns.revenue); const cogs = sumCol(rows, columns.cogs); const pct = safePct(revenue - cogs, revenue); return { value: pct.value, inputs: { revenue, cogs }, notes: pct.note ? [pct.note] : [] }; } },
  net_income: { key: "net_income", label: "Net Income", description: "Revenue minus expense.", requiredColumns: ["revenue", "expense"], formula: "SUM(revenue) - SUM(expense)", outputType: "currency", calculate: ({ rows, columns }) => { const revenue = sumCol(rows, columns.revenue); const expense = sumCol(rows, columns.expense); return { value: revenue - expense, inputs: { revenue, expense }, notes: [] }; } },
  expense_ratio_pct: { key: "expense_ratio_pct", label: "Expense Ratio %", description: "Expense / Revenue * 100.", requiredColumns: ["expense", "revenue"], formula: "SUM(expense) / SUM(revenue) * 100", outputType: "percent", calculate: ({ rows, columns }) => { const revenue = sumCol(rows, columns.revenue); const expense = sumCol(rows, columns.expense); const pct = safePct(expense, revenue); return { value: pct.value, inputs: { expense, revenue }, notes: pct.note ? [pct.note] : [] }; } },
  revenue_growth_pct: { key: "revenue_growth_pct", label: "Revenue Growth %", description: "Period-over-period revenue growth.", requiredColumns: ["revenue", "period"], formula: "(current_revenue - prior_revenue) / prior_revenue * 100", outputType: "percent", calculate: ({ groupedRows, columns }) => { const entries = Object.entries(groupedRows || {}).sort((a, b) => String(a[0]).localeCompare(String(b[0]))); if (entries.length < 2) return { value: null, inputs: {}, notes: ["Need at least two periods for growth."] }; const prior = sumCol(entries[entries.length - 2][1], columns.revenue); const current = sumCol(entries[entries.length - 1][1], columns.revenue); const pct = safePct(current - prior, prior); return { value: pct.value, inputs: { prior_revenue: prior, current_revenue: current }, notes: pct.note ? [pct.note] : [] }; } },
  variance_amount: { key: "variance_amount", label: "Variance Amount", description: "Current minus comparison.", requiredColumns: ["value", "comparison_value"], formula: "current - comparison", outputType: "currency", calculate: ({ comparison }) => ({ value: (comparison.current || 0) - (comparison.previous || 0), inputs: comparison, notes: [] }) },
  variance_pct: { key: "variance_pct", label: "Variance %", description: "Variance % vs comparison.", requiredColumns: ["value", "comparison_value"], formula: "(current - comparison) / comparison * 100", outputType: "percent", calculate: ({ comparison }) => { const current = comparison.current || 0; const previous = comparison.previous || 0; const pct = safePct(current - previous, previous); return { value: pct.value, inputs: comparison, notes: pct.note ? [pct.note] : [] }; } },
};

export function resolveFinanceColumns(headers = []) {
  const h = Array.isArray(headers) ? headers : [];
  const pick = (patterns) => h.find((col) => patterns.some((p) => p.test(String(col))));
  return {
    revenue: pick([/revenue total/i, /net revenue/i, /^revenue$/i, /sales/i, /income/i]),
    expense: pick([/expense billed/i, /^expense$/i, /cost total/i, /cost/i, /opex/i]),
    cogs: pick([/cogs/i, /cost of goods/i, /direct cost/i, /cost total/i]),
    period: pick([/date/i, /period/i, /year/i, /month/i]),
    value: pick([/value/i, /amount/i]),
    comparison_value: pick([/previous/i, /prior/i, /comparison/i]),
  };
}
