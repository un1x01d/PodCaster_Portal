export const FINANCE_COMPLEX_QUESTION_REQUIREMENTS = {
  finance_cash_driver_analysis: {
    minimumRequiredFieldSets: [["cash", "date"], ["cash_in", "cash_out", "date"]],
    optionalFields: ["accounts_receivable", "accounts_payable", "revenue", "expenses", "inventory", "capex", "category", "account"],
  },
  finance_health_summary: {
    minimumRequiredFieldSets: [["current_assets", "current_liabilities"], ["cash"], ["debt", "equity"], ["net_income"], ["revenue", "expenses"]],
    optionalFields: ["date"],
  },
};
