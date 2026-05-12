export const METRIC_HEADER_REQUIREMENTS = {
  total_revenue: { required: ["total_revenue"], optional: ["date", "customer", "store", "region", "category", "department"] },
  gross_profit: { required: ["total_revenue", "cogs"], optional: ["date", "category", "department"] },
  gross_margin_pct: { required: ["total_revenue", "cogs"], optional: ["date", "category", "department"] },
  net_income: { required: ["net_income"], optional: ["date", "department", "account"] },
  total_expense: { required: ["total_expense"], optional: ["date", "department", "account", "vendor"] },
  variance_amount: { required: ["actual_amount", "budget_amount"], optional: ["date", "department", "category"] },
  variance_pct: { required: ["actual_amount", "budget_amount"], optional: ["date", "department", "category"] },
  accounts_receivable_total: { required: ["ar_balance"], optional: ["date", "customer", "account"] },
  accounts_payable_total: { required: ["ap_balance"], optional: ["date", "vendor", "account"] },
  
  // MDFC v6.0 Metrics
  net_revenue: { required: ["total_revenue"], optional: ["net_revenue", "revenue_offsets", "date"] },

  personnel_cost_total: { required: ["total_expense"], optional: ["payroll", "labor_burden", "date"] },
  actual_cash_burn: { required: ["total_revenue", "total_expense"], optional: ["non_cash_expense", "revenue_offsets", "date"] },
  runway_months: { required: ["cash", "total_revenue", "total_expense"], optional: ["non_cash_expense", "revenue_offsets", "date"] },
  trucking_rpm: { required: ["total_revenue", "total_miles"], optional: ["date"] },
  fuel_efficiency: { required: ["total_miles", "fuel_gallons"], optional: ["date"] },
  mfg_unit_cost: { required: ["total_expense", "units_produced"], optional: ["date"] },
  inventory_turnover: { required: ["cogs", "inventory"], optional: ["date"] },
  re_noi: { required: ["total_revenue", "total_expense"], optional: ["date"] },
  re_cap_rate: { required: ["total_revenue", "total_expense", "asset_value"], optional: ["date"] },
  retail_sell_thru: { required: ["units_sold", "on_hand"], optional: ["date"] },
  ar_dso: { required: ["ar_balance", "total_revenue"], optional: ["date"] },
};

