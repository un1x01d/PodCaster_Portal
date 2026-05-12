import pkg from 'pg';
const { Client } = pkg;

const advancedTerms = [
  // [REV_OFFSET]
  { cat: "revenue_offsets", synonyms: ["Returns", "Refunds", "Customer-Credits", "Tiered-Discounts", "Volume-Rebates", "Chargebacks-Reversed", "Trade-Ins", "Coupons", "Seasonal-Markdowns"] },
  
  // [EXP_LABOR_BURDEN]
  { cat: "labor_burden", synonyms: ["FICA", "FUTA", "SUTA", "401k-Matching", "Health-Premium-ER", "Dental-ER", "Vision-ER", "Workers-Comp-Insurance", "HRA-Contribution", "HSA-Contribution", "Life-Insurance-Group", "Payroll-Processing-Fee", "Garnishments-Admin", "Commuter-Benefits", "Remote-Stipend"] },
  
  // [EXP_NON_CASH]
  { cat: "non_cash_expense", synonyms: ["Depreciation", "Amortization", "Asset-Impairment", "Goodwill-Write-off", "Stock-Based-Compensation"] },
  
  // [EXP_DEBT_SERVICE]
  { cat: "debt_service", synonyms: ["Loan-Interest", "Principal-Repayment", "Line-of-Credit-Interest", "Mortgage-Interest", "Equipment-Financing-Charge"] },
  
  // [EXP_COMPLIANCE]
  { cat: "compliance_expense", synonyms: ["Annual-Report-Fee", "Registered-Agent", "SEC-Filing", "Audit-Engagement", "Tax-Provision-Work", "Legal-Retainer", "Trademark-Maintenance", "Patent-Annuity", "SOC2-Audit", "HIPAA-Compliance-Software", "GDPR-Consulting", "Franchise-Tax", "Business-License-Renewal"] },

  // [EXP_PAYROLL]
  { cat: "payroll", synonyms: ["Payroll", "Salaries", "Wages", "Base-Pay", "Commission", "Bonuses"] }
];

const advancedRules = [
  { phrase: "What is our actual cash burn?", intent: "single_year_total", metric: "actual_cash_burn" },
  { phrase: "What is the cost of our employees?", intent: "single_year_total", metric: "personnel_cost_total" },
  { phrase: "Show me compliance spend", intent: "single_year_total", metric: "compliance_total" },
  { phrase: "What is the net revenue?", intent: "single_year_total", metric: "net_revenue" }
];

async function run() {
  const client = new Client({
    connectionString: "postgres://portal:portalpass@localhost:5432/portaldb"
  });
  await client.connect();
  console.log("Connected to DB");

  // Insert Synonyms
  let synCount = 0;
  for (const item of advancedTerms) {
    for (const synonym of item.synonyms) {
      const normalized = synonym.replace(/-/g, ' ');
      await client.query(
        "INSERT INTO semantic_dictionary (category, language, synonym) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
        [item.cat, "en", synonym]
      );
      if (normalized !== synonym) {
        await client.query(
          "INSERT INTO semantic_dictionary (category, language, synonym) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
          [item.cat, "en", normalized]
        );
      }
      synCount++;
    }
  }
  console.log(`Inserted ${synCount} advanced synonyms.`);

  // Insert Rules
  let ruleCount = 0;
  for (const rule of advancedRules) {
    const payload = { metric_requested: rule.metric };
    await client.query(
      `INSERT INTO ai_learning_rules 
         (scope, locale, phrase, mapped_intent, mapped_payload, confidence, status) 
       VALUES ('global', 'en', $1, $2, $3::jsonb, 1.0, 'approved') 
       ON CONFLICT DO NOTHING`,
      [rule.phrase.toLowerCase(), rule.intent, JSON.stringify(payload)]
    );
    ruleCount++;
  }
  console.log(`Inserted ${ruleCount} advanced rules.`);

  await client.end();
}

run().catch(console.error);
