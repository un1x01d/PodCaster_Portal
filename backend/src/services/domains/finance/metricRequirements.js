export const FINANCE_METRIC_REQUIREMENTS = {
  cash_balance: { required: [["cash"]], optional: ["date"] },
  cash_flow: { required: [["cash_in", "cash_out"]], optional: ["date", "category", "account"] },
  working_capital: { required: [["current_assets", "current_liabilities"]], optional: ["date"] },
  current_ratio: { required: [["current_assets", "current_liabilities"]], optional: ["date"] },
  quick_ratio: { required: [["current_assets", "inventory", "current_liabilities"]], optional: ["date"] },
  debt_to_equity: { required: [["debt", "equity"]], optional: ["date"] },
  free_cash_flow: { required: [["operating_cash_flow", "capex"]], optional: ["date"] },
  burn_rate: { required: [["cash_in", "cash_out", "date"]], optional: ["category", "account"] },
  runway_months: { required: [["cash", "cash_in", "cash_out", "date"]], optional: [] },
};
