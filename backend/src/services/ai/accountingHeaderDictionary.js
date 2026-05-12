import { normalizeText } from "./accountingGlossary.js";

export const ACCOUNTING_HEADER_ALIASES = {
  total_revenue: [
    "revenue",
    "revenue total",
    "total revenue",
    "sales",
    "gross sales",
    "gross revenue",
    "billings",
    "attributed revenue",
    "revenue amount",
    "invoice revenue",
    "recognized revenue",
    "booked revenue",
  ],
  gross_revenue: ["gross revenue", "gross sales"],
  net_revenue: ["net revenue", "net sales", "revenue net", "total income", "adjusted revenue"],

  cogs: [
    "cogs",
    "cost of goods sold",
    "cost of sales",
    "product cost",
    "direct costs",
    "direct cost",
    "cost total",
    "total cost",
    "total costs",
    "cost labor",
    "labor cost",
    "cost expense",
    "cost overhead",
    "project cost",
    "job cost",
    "delivery cost",
    "service cost",
  ],
  gross_profit: ["gross profit"],
  gross_margin_pct: ["gross margin", "gross margin %", "gross margin percent"],
  total_expense: ["expense", "expenses", "total expense", "opex", "operating expense", "marketing spend", "ad spend"],
  net_income: ["net income", "net profit", "profit net"],
  ar_balance: ["accounts receivable", "receivables", "ar", "a/r"],
  ap_balance: ["accounts payable", "payables", "ap", "a/p"],
  budget_amount: ["budget", "budget amount", "planned amount"],
  actual_amount: ["actual", "actual amount", "actuals"],
  variance_amount: ["variance", "variance amount", "delta amount", "difference amount"],
  variance_pct: ["variance %", "variance percent", "delta %"],
  date: [
    "date",
    "transaction date",
    "posting date",
    "period",
    "month",
    "year",
    "invoice date",
    "start date",
    "end date",
    "paid date",
    "close date",
  ],
  customer: ["customer", "client", "account name"],
  vendor: ["vendor", "supplier"],
  store: ["store", "location", "branch"],
  region: ["region", "territory", "area"],
  category: ["category", "segment", "expense category", "product category"],
  department: ["department", "cost center", "business unit"],
  account: ["account", "gl account", "account code", "ledger account"],

  tax_amount: ["tax amount", "tax collected", "sales tax", "tax col"],
  taxable_sales: ["taxable sales", "taxable revenue", "taxable amount"],
  spend: ["spend", "ad spend", "marketing spend", "media spend", "cost"],
  clicks: ["clicks", "link clicks"],
  impressions: ["impressions", "views", "ad impressions"],
  conversions: ["conversions", "purchases", "signups"],
  leads: ["leads", "prospects", "inquiries"],
  campaign: ["campaign", "campaign name", "utm campaign"],
  quota: ["quota", "target", "sales target"],
  pipeline_value: ["pipeline", "pipeline value", "open pipeline"],
  sales_rep: ["sales rep", "rep", "account executive", "ae", "owner"],
  current_assets: ["current assets"],
  current_liabilities: ["current liabilities"],
  cash: ["cash", "cash balance"],
  cash_in: ["cash in", "cash inflow"],
  cash_out: ["cash out", "cash outflow", "monthly burn"],
  debt: ["debt", "loan balance", "borrowings"],
  equity: ["equity", "owner equity"],
  inventory: ["inventory"],
};

export function normalizeHeaderName(name = "") {
  return normalizeText(name);
}

export function buildNormalizedHeaderMap(headers = []) {
  const map = new Map();
  (Array.isArray(headers) ? headers : []).forEach((h) => {
    const key = normalizeHeaderName(h);
    if (key && !map.has(key)) map.set(key, String(h));
  });
  return map;
}
