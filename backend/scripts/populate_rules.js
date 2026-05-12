import pkg from 'pg';
const { Client } = pkg;

const rules = [
  // Revenue / Sales
  { phrase: "total revenue", intent: "single_year_total", metric: "total_revenue" },
  { phrase: "how much did we sell", intent: "single_year_total", metric: "total_revenue" },
  { phrase: "what are the total sales", intent: "single_year_total", metric: "total_revenue" },
  { phrase: "revenue growth", intent: "yoy", metric: "total_revenue" },
  { phrase: "sales growth", intent: "yoy", metric: "total_revenue" },
  { phrase: "compare revenue year over year", intent: "yoy", metric: "total_revenue" },
  { phrase: "top customers by revenue", intent: "top_n", metric: "total_revenue", dimension: "customer", limit: 5 },
  { phrase: "who are our biggest clients", intent: "top_n", metric: "total_revenue", dimension: "customer", limit: 5 },
  { phrase: "revenue by region", intent: "top_n", metric: "total_revenue", dimension: "region", limit: 10 },
  
  // Profit & Margin
  { phrase: "net profit", intent: "single_year_total", metric: "net_income" },
  { phrase: "net income", intent: "single_year_total", metric: "net_income" },
  { phrase: "how much did we make", intent: "single_year_total", metric: "net_income" },
  { phrase: "what is our bottom line", intent: "single_year_total", metric: "net_income" },
  { phrase: "gross margin percentage", intent: "single_year_total", metric: "gross_margin_pct" },
  { phrase: "what is the gross margin", intent: "single_year_total", metric: "gross_margin_pct" },
  { phrase: "profitability trend", intent: "yoy", metric: "net_income" },
  
  // Expenses
  { phrase: "total expenses", intent: "single_year_total", metric: "total_expense" },
  { phrase: "how much did we spend", intent: "single_year_total", metric: "total_expense" },
  { phrase: "operating costs", intent: "single_year_total", metric: "total_expense" },
  { phrase: "highest expenses by category", intent: "top_n", metric: "total_expense", dimension: "category", limit: 5 },
  { phrase: "top spending departments", intent: "top_n", metric: "total_expense", dimension: "department", limit: 5 },
  
  // Cash & Burn
  { phrase: "cash on hand", intent: "single_year_total", metric: "cash" },
  { phrase: "current cash balance", intent: "single_year_total", metric: "cash" },
  { phrase: "monthly burn rate", intent: "single_year_total", metric: "cash_out" },
  { phrase: "how fast are we spending cash", intent: "single_year_total", metric: "cash_out" },
  
  // Variance
  { phrase: "budget variance", intent: "single_year_total", metric: "variance_amount" },
  { phrase: "did we go over budget", intent: "single_year_total", metric: "variance_amount" },
  { phrase: "actual vs budget", intent: "single_year_total", metric: "variance_amount" }
];

async function run() {
  const client = new Client({
    connectionString: "postgres://portal:portalpass@localhost:5432/portaldb"
  });
  await client.connect();
  console.log("Connected to DB");

  let count = 0;
  for (const rule of rules) {
    const payload = {
      metric_requested: rule.metric,
      group_by: rule.dimension || null,
      limit: rule.limit || null,
    };
    
    await client.query(
      `INSERT INTO ai_learning_rules 
         (scope, locale, phrase, mapped_intent, mapped_payload, confidence, status) 
       VALUES ('global', 'en', $1, $2, $3::jsonb, 1.0, 'approved') 
       ON CONFLICT DO NOTHING`,
      [rule.phrase.toLowerCase(), rule.intent, JSON.stringify(payload)]
    );
    count++;
  }

  console.log(`Inserted ${count} rules into ai_learning_rules`);
  await client.end();
}

run().catch(console.error);
