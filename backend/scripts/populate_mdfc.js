import pkg from 'pg';
const { Client } = pkg;

const mdfcTerms = [
  // Trucking
  { cat: "total_expense", synonyms: ["Fuel-Cost", "Tolls", "ELD-Fees", "Permits", "Insurance-Premium", "Maintenance", "Driver-Pay-Per-Mile", "Deadhead-Miles", "Broker-Fees", "Lumper-Fees", "Detention"] },
  { cat: "total_revenue", synonyms: ["Rate-Per-Mile", "Fuel-Surcharge", "Accessorial-Revenue", "Backhaul-Income"] },
  { cat: "asset_value", synonyms: ["Tractor-Value", "Trailer-Value", "IFTA-Credits", "Property-Valuation"] },
  { cat: "total_miles", synonyms: ["Total-Miles", "Miles", "Distance"] },
  { cat: "fuel_gallons", synonyms: ["Fuel-Gallons", "Gallons", "Fuel-Usage"] },
  
  // Manufacturing
  { cat: "inventory", synonyms: ["Raw-Materials", "Work-In-Progress", "WIP", "Finished-Goods", "MRO-Supplies"] },
  { cat: "total_expense", synonyms: ["Factory-Rent", "Machine-Lease", "Quality-Control", "Safety-Compliance", "Direct-Labor", "Direct-Materials", "Scrap-Costs", "Packaging", "Utilities-Industrial"] },
  { cat: "total_revenue", synonyms: ["Wholesale-Sales", "OEM-Contracts", "Scrap-Revenue", "Unit-Price"] },
  { cat: "units_produced", synonyms: ["Units-Produced", "Production-Volume", "Output-Units"] },

  // Real Estate
  { cat: "total_revenue", synonyms: ["Gross-Potential-Rent", "GPR", "CAM-Recovery", "Parking-Fees", "Laundry-Income"] },
  { cat: "total_expense", synonyms: ["Property-Tax", "Management-Fees", "Landscaping", "Pest-Control", "HOA-Fees", "Leasing-Commissions", "Tenant-Improvements", "TI", "Marketing-Units", "Repairs"] },
  { cat: "asset_value", synonyms: ["Property-Valuation", "Escrow-Balance", "Capital-Reserves"] },

  // Global Finance & Tax
  { cat: "tax_amount", synonyms: ["VAT", "IVA", "НДС", "ПДВ", "Sales-Tax", "Use-Tax", "GST"] },
  { cat: "ap_balance", synonyms: ["Payables", "Cuentas por Pagar", "Кредиторская задолженность", "Зобов'язання"] },
  { cat: "ar_balance", synonyms: ["Receivables", "Cuentas por Cobrar", "Дебиторская задолженность", "Оборотні активи"] }
];

const mdfcRules = [
  { phrase: "How is the fleet doing?", intent: "complex", metrics: ["trucking_rpm", "fuel_efficiency"] },
  { phrase: "Factory health?", intent: "complex", metrics: ["mfg_unit_cost", "inventory_turnover"] },
  { phrase: "Property performance?", intent: "complex", metrics: ["re_noi", "re_cap_rate"] },
  { phrase: "Keep the lights on?", intent: "single_year_total", metric: "cash" }
];

async function run() {
  const client = new Client({
    connectionString: "postgres://portal:portalpass@localhost:5432/portaldb"
  });
  await client.connect();
  console.log("Connected to DB");

  // Insert Synonyms
  let synCount = 0;
  for (const item of mdfcTerms) {
    for (const synonym of item.synonyms) {
      await client.query(
        "INSERT INTO semantic_dictionary (category, language, synonym) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
        [item.cat, "en", synonym]
      );
      synCount++;
    }
  }
  console.log(`Inserted ${synCount} MDFC synonyms.`);

  // Insert Rules
  let ruleCount = 0;
  for (const rule of mdfcRules) {
    const payload = rule.intent === "complex" 
      ? { metrics: rule.metrics, question_type: "industry_health" }
      : { metric_requested: rule.metric };
    
    await client.query(
      `INSERT INTO ai_learning_rules 
         (scope, locale, phrase, mapped_intent, mapped_payload, confidence, status) 
       VALUES ('global', 'en', $1, $2, $3::jsonb, 1.0, 'approved') 
       ON CONFLICT DO NOTHING`,
      [rule.phrase.toLowerCase(), rule.intent, JSON.stringify(payload)]
    );
    ruleCount++;
  }
  console.log(`Inserted ${ruleCount} MDFC rules.`);

  await client.end();
}

run().catch(console.error);
