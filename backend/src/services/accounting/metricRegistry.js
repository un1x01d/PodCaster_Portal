import { safeDivide } from "./numeric.js";

export const METRIC_REGISTRY = {
  total_revenue: { key: "total_revenue", label: "Total Revenue", description: "SUM(revenue)", formula: "SUM(revenue)", outputType: "currency", requiredCanonicalHeaders: ["total_revenue"], alternateRequiredCanonicalHeaderSets: [], calculate: ({ sums }) => ({ value: sums.revenue }) },
  total_expense: { key: "total_expense", label: "Total Expense", description: "SUM(expenses)", formula: "SUM(expenses)", outputType: "currency", requiredCanonicalHeaders: ["total_expense"], alternateRequiredCanonicalHeaderSets: [], calculate: ({ sums }) => ({ value: sums.expenses }) },
  gross_profit: { key: "gross_profit", label: "Gross Profit", description: "SUM(gross_profit) or revenue-cogs", formula: "SUM(gross_profit) OR SUM(revenue)-SUM(cogs)", outputType: "currency", requiredCanonicalHeaders: [], alternateRequiredCanonicalHeaderSets: [["gross_profit"], ["total_revenue", "cogs"]], calculate: ({ sums, headersUsed }) => ({ value: headersUsed.grossProfit ? sums.grossProfit : (sums.revenue - sums.cogs) }) },
  gross_margin_pct: { key: "gross_margin_pct", label: "Gross Margin %", description: "gross profit / revenue * 100", formula: "(Revenue-COGS)/Revenue*100", outputType: "percent", requiredCanonicalHeaders: [], alternateRequiredCanonicalHeaderSets: [["gross_profit", "total_revenue"], ["total_revenue", "cogs"]], calculate: ({ sums, headersUsed }) => { const gp = headersUsed.grossProfit ? sums.grossProfit : (sums.revenue - sums.cogs); const d = safeDivide(gp, sums.revenue); return d.ok ? { value: d.value * 100 } : { value: null, note: "Revenue denominator is zero" }; } },
  net_income: { key: "net_income", label: "Net Income", description: "SUM(net_income) or revenue-expenses", formula: "SUM(net_income) OR SUM(revenue)-SUM(expenses)", outputType: "currency", requiredCanonicalHeaders: [], alternateRequiredCanonicalHeaderSets: [["net_income"], ["total_revenue", "total_expense"]], calculate: ({ sums, headersUsed }) => ({ value: headersUsed.netIncome ? sums.netIncome : (sums.revenue - sums.expenses) }) },
  expense_ratio_pct: { key: "expense_ratio_pct", label: "Expense Ratio %", description: "expenses/revenue*100", formula: "SUM(expenses)/SUM(revenue)*100", outputType: "percent", requiredCanonicalHeaders: ["total_expense", "total_revenue"], alternateRequiredCanonicalHeaderSets: [], calculate: ({ sums }) => { const d = safeDivide(sums.expenses, sums.revenue); return d.ok ? { value: d.value * 100 } : { value: null, note: "Revenue denominator is zero" }; } },
  revenue_growth_pct: { key: "revenue_growth_pct", label: "Revenue Growth %", description: "(current-comparison)/comparison*100", formula: "(current_revenue-comparison_revenue)/comparison_revenue*100", outputType: "percent", requiredCanonicalHeaders: ["total_revenue"], alternateRequiredCanonicalHeaderSets: [], calculate: ({ currentRevenue, comparisonRevenue }) => { const d = safeDivide(currentRevenue - comparisonRevenue, comparisonRevenue); return d.ok ? { value: d.value * 100 } : { value: null, note: "Comparison revenue denominator is zero" }; } },
  variance_amount: { key: "variance_amount", label: "Variance Amount", description: "actual-budget", formula: "actual-budget", outputType: "currency", requiredCanonicalHeaders: ["actual_amount", "budget_amount"], alternateRequiredCanonicalHeaderSets: [], calculate: ({ sums }) => ({ value: sums.actual - sums.budget }) },
  variance_pct: { key: "variance_pct", label: "Variance %", description: "(actual-budget)/budget*100", formula: "(actual-budget)/budget*100", outputType: "percent", requiredCanonicalHeaders: ["actual_amount", "budget_amount"], alternateRequiredCanonicalHeaderSets: [], calculate: ({ sums }) => { const d = safeDivide(sums.actual - sums.budget, sums.budget); return d.ok ? { value: d.value * 100 } : { value: null, note: "Budget denominator is zero" }; } },
  accounts_receivable_total: { key: "accounts_receivable_total", label: "Accounts Receivable Total", description: "SUM(AR)", formula: "SUM(accounts_receivable)", outputType: "currency", requiredCanonicalHeaders: ["ar_balance"], alternateRequiredCanonicalHeaderSets: [], calculate: ({ sums }) => ({ value: sums.ar }) },
  accounts_payable_total: { key: "accounts_payable_total", label: "Accounts Payable Total", description: "SUM(AP)", formula: "SUM(accounts_payable)", outputType: "currency", requiredCanonicalHeaders: ["ap_balance"], alternateRequiredCanonicalHeaderSets: [], calculate: ({ sums }) => ({ value: sums.ap }) },
  
  // --- MDFC v5.0: TRUCKING ---
  trucking_rpm: { 
    key: "trucking_rpm", 
    label: "Rate Per Mile (RPM)", 
    description: "Revenue / Total Miles", 
    formula: "total_revenue / total_miles", 
    outputType: "currency", 
    requiredCanonicalHeaders: ["total_revenue", "total_miles"], 
    calculate: ({ sums }) => {
      const d = safeDivide(sums.revenue, sums.miles);
      return d.ok ? { value: d.value } : { value: null, note: "Total miles denominator is zero" };
    }
  },
  fuel_efficiency: {
    key: "fuel_efficiency",
    label: "Fuel Efficiency (MPG)",
    description: "Total Miles / Fuel Gallons",
    formula: "total_miles / fuel_gallons",
    outputType: "ratio",
    requiredCanonicalHeaders: ["total_miles", "fuel_gallons"],
    calculate: ({ sums }) => {
      const d = safeDivide(sums.miles, sums.fuel_gallons);
      return d.ok ? { value: d.value } : { value: null, note: "Fuel gallons denominator is zero" };
    }
  },

  // --- MDFC v5.0: MANUFACTURING ---
  mfg_unit_cost: {
    key: "mfg_unit_cost",
    label: "MFG Unit Cost",
    description: "Total Expense / Units Produced",
    formula: "total_expense / units_produced",
    outputType: "currency",
    requiredCanonicalHeaders: ["total_expense", "units_produced"],
    calculate: ({ sums }) => {
      const d = safeDivide(sums.expenses, sums.units_produced);
      return d.ok ? { value: d.value } : { value: null, note: "Units produced denominator is zero" };
    }
  },
  inventory_turnover: {
    key: "inventory_turnover",
    label: "Inventory Turnover",
    description: "COGS / Average Inventory",
    formula: "cogs / inventory_value",
    outputType: "ratio",
    requiredCanonicalHeaders: ["cogs", "inventory"],
    calculate: ({ sums }) => {
      const d = safeDivide(sums.cogs, sums.inventory);
      return d.ok ? { value: d.value } : { value: null, note: "Inventory denominator is zero" };
    }
  },

  // --- MDFC v5.0: REAL ESTATE ---
  re_noi: {
    key: "re_noi",
    label: "Net Operating Income (NOI)",
    description: "Revenue - Operating Expenses",
    formula: "total_revenue - total_expense",
    outputType: "currency",
    requiredCanonicalHeaders: ["total_revenue", "total_expense"],
    calculate: ({ sums }) => ({ value: sums.revenue.minus(sums.expenses) })
  },
  re_cap_rate: {
    key: "re_cap_rate",
    label: "Cap Rate",
    description: "NOI / Property Value",
    formula: "re_noi / asset_value",
    outputType: "percent",
    requiredCanonicalHeaders: ["total_revenue", "total_expense", "asset_value"],
    calculate: ({ sums }) => {
      const noi = sums.revenue.minus(sums.expenses);
      const d = safeDivide(noi, sums.asset_value);
      return d.ok ? { value: d.value.times(100) } : { value: null, note: "Asset value denominator is zero" };
    }
  },

  // --- ADVANCED ACCOUNTING & COMPLIANCE ---
  net_revenue: {
    key: "net_revenue",
    label: "Net Revenue",
    description: "Gross Revenue - Offsets (Returns/Refunds)",
    formula: "total_revenue - revenue_offsets",
    outputType: "currency",
    requiredCanonicalHeaders: [],
    alternateRequiredCanonicalHeaderSets: [["total_revenue"], ["net_revenue"]],
    calculate: ({ sums, headersUsed }) => {
      if (headersUsed.net_revenue) return { value: sums.net_revenue };
      return { value: sums.revenue.minus(sums.revenue_offsets || 0) };
    }
  },

  personnel_cost_total: {
    key: "personnel_cost_total",
    label: "Total Personnel Cost",
    description: "Payroll + Burden (FICA/Health/etc)",
    formula: "payroll + labor_burden",
    outputType: "currency",
    requiredCanonicalHeaders: ["total_expense"], // Fallback if specific columns missing
    calculate: ({ sums }) => ({ value: (sums.payroll || 0).plus(sums.labor_burden || 0), note: "Includes Personnel Burden (Taxes/Benefits)" })
  },
  actual_cash_burn: {
    key: "actual_cash_burn",
    label: "Actual Cash Burn",
    description: "(Total Expense - Non-Cash) - Net Revenue",
    formula: "(total_expense - non_cash_expense) - net_revenue",
    outputType: "currency",
    requiredCanonicalHeaders: ["total_expense", "total_revenue"],
    calculate: ({ sums }) => {
      const netRev = sums.revenue.minus(sums.revenue_offsets || 0);
      const cashExp = sums.expenses.minus(sums.non_cash_expense || 0);
      return { value: cashExp.minus(netRev) };
    }
  },
  compliance_total: {
    key: "compliance_total",
    label: "Legal & Compliance Spend",
    description: "SUM(Compliance/Legal/Audit)",
    formula: "SUM(compliance_expense)",
    outputType: "currency",
    requiredCanonicalHeaders: ["compliance_expense"],
    calculate: ({ sums }) => ({ value: sums.compliance_expense })
  },

  // --- MDFC v6.0: UNIFIED ENGINE ---
  runway_months: {
    key: "runway_months",
    label: "Runway (Months)",
    description: "CASH_TOTAL / (TOTAL_BURN - REV_NET)",
    formula: "cash / ((total_expense - non_cash_expense) - (total_revenue - revenue_offsets))",
    outputType: "ratio",
    requiredCanonicalHeaders: ["cash", "total_revenue", "total_expense"],
    calculate: ({ sums }) => {
      const netRev = sums.revenue.minus(sums.revenue_offsets || 0);
      const cashExp = sums.expenses.minus(sums.non_cash_expense || 0);
      const netBurn = cashExp.minus(netRev);
      const d = safeDivide(sums.cash, netBurn);
      return d.ok ? { value: d.value } : { value: null, note: "Net burn is zero or negative (infinite runway)" };
    }
  },
  retail_sell_thru: {
    key: "retail_sell_thru",
    label: "Retail Sell-Thru %",
    description: "Units_Sold / (Units_Sold + On_Hand)",
    formula: "units_sold / (units_sold + on_hand) * 100",
    outputType: "percent",
    requiredCanonicalHeaders: ["units_sold", "on_hand"],
    calculate: ({ sums }) => {
      const totalUnits = sums.units_produced.plus(sums.inventory); // Using production/inventory if specific sell_thru headers missing
      const d = safeDivide(sums.units_produced, totalUnits);
      return d.ok ? { value: d.value.times(100) } : { value: null, note: "Total inventory is zero" };
    }
  },
  ar_dso: {
    key: "ar_dso",
    label: "DSO (Days Sales Outstanding)",
    description: "(AR_TOTAL / REV_GROSS) * DAYS_IN_PERIOD",
    formula: "(ar_balance / total_revenue) * 30", // Defaulting to 30 days if period not specific
    outputType: "ratio",
    requiredCanonicalHeaders: ["ar_balance", "total_revenue"],
    calculate: ({ sums, period }) => {
      const days = (period?.type === 'month') ? 30 : 365;
      const d = safeDivide(sums.ar, sums.revenue);
      return d.ok ? { value: d.value.times(days), note: `Calculated for ${days} days` } : { value: null, note: "Revenue is zero" };
    }
  }
};




export function getMetricDefinition(metric) { return METRIC_REGISTRY[metric] || null; }
