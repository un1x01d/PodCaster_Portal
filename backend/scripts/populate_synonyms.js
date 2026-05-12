import pkg from 'pg';
const { Client } = pkg;

const terms = [
  // Revenue
  { cat: "total_revenue", synonyms: ["revenue", "sales", "top line", "turnover", "gross receipts", "total billings", "adjusted revenue", "subscription income", "arr", "mrr", "billings", "invoiced amount", "recognized revenue", "booked revenue", "gross sales", "net sales"] },
  // Expenses
  { cat: "total_expense", synonyms: ["expense", "expenses", "opex", "operating expense", "sg&a", "indirect costs", "fixed costs", "variable costs", "personnel costs", "marketing spend", "ad spend", "overheads", "costs", "spend", "media spend"] },
  { cat: "cogs", synonyms: ["cogs", "cost of goods sold", "cost of sales", "direct costs", "product cost", "manufacturing overhead", "direct labor"] },
  // Profit
  { cat: "gross_profit", synonyms: ["gross profit", "trading profit", "gross income"] },
  { cat: "net_income", synonyms: ["net income", "net profit", "bottom line", "earnings", "eat", "earnings after tax", "operating income", "ebit", "operating profit"] },
  { cat: "gross_margin_pct", synonyms: ["gross margin", "gross margin %", "gross margin percent", "gross profit percentage"] },
  // Balance Sheet
  { cat: "ar_balance", synonyms: ["accounts receivable", "ar", "a/r", "debtors", "trade receivables", "uncollected billings"] },
  { cat: "ap_balance", synonyms: ["accounts payable", "ap", "a/p", "creditors", "trade payables", "vouchers"] },
  { cat: "cash", synonyms: ["cash", "cash balance", "cash on hand", "bank balance", "liquid assets", "marketable securities", "restricted cash"] },
  { cat: "current_assets", synonyms: ["current assets", "short term assets"] },
  { cat: "current_liabilities", synonyms: ["current liabilities", "short term debt"] },
  { cat: "debt", synonyms: ["debt", "long term debt", "bonds payable", "borrowings", "loans"] },
  { cat: "equity", synonyms: ["equity", "net worth", "shareholders equity", "book value", "retained earnings", "common stock"] },
  { cat: "inventory", synonyms: ["inventory", "stock", "raw materials", "finished goods", "wip"] },
  // Budget & Variance
  { cat: "budget_amount", synonyms: ["budget", "planned amount", "annual plan", "target", "planned"] },
  { cat: "actual_amount", synonyms: ["actual", "actual amount", "actuals", "realized"] },
  { cat: "variance_amount", synonyms: ["variance", "delta", "difference", "gap", "bva"] },
  // Dimensions
  { cat: "customer", synonyms: ["customer", "client", "account name", "prospect"] },
  { cat: "vendor", synonyms: ["vendor", "supplier", "payee"] },
  { cat: "store", synonyms: ["store", "location", "branch", "facility", "site"] },
  { cat: "region", synonyms: ["region", "territory", "area", "market", "zone"] },
  { cat: "category", synonyms: ["category", "segment", "product line", "expense type"] },
  { cat: "department", synonyms: ["department", "cost center", "business unit", "division"] },
  { cat: "account", synonyms: ["account", "gl account", "account code", "ledger account", "nominal code"] },
  { cat: "date", synonyms: ["date", "transaction date", "posting date", "period", "month", "year", "fy", "fiscal year"] },
  // Marketing & Growth
  { cat: "leads", synonyms: ["leads", "prospects", "inquiries", "signups"] },
  { cat: "campaign", synonyms: ["campaign", "utm campaign", "promotion"] },
  { cat: "conversions", synonyms: ["conversions", "purchases", "sales count"] },
  { cat: "impressions", synonyms: ["impressions", "views", "reach"] },
  { cat: "clicks", synonyms: ["clicks", "link clicks"] },
  { cat: "quota", synonyms: ["quota", "sales target", "goal"] },
  // Other
  { cat: "tax_amount", synonyms: ["tax", "tax amount", "vat", "gst", "sales tax", "tax provision"] },
  { cat: "cash_in", synonyms: ["cash in", "cash inflow", "collections"] },
  { cat: "cash_out", synonyms: ["cash out", "cash outflow", "burn rate", "spend"] }
];

async function run() {
  const client = new Client({
    connectionString: "postgres://portal:portalpass@localhost:5432/portaldb"
  });
  await client.connect();
  console.log("Connected to DB");

  let count = 0;
  for (const item of terms) {
    for (const synonym of item.synonyms) {
      await client.query(
        "INSERT INTO semantic_dictionary (category, language, synonym) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
        [item.cat, "en", synonym]
      );
      count++;
    }
  }

  console.log(`Inserted ${count} synonyms into semantic_dictionary`);
  await client.end();
}

run().catch(console.error);
