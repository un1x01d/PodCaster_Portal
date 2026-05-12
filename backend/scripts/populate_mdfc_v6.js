import pkg from 'pg';
const { Client } = pkg;

const v6Terms = [
  // 1. GLOBAL FINANCE & CONTRA-ACCOUNTS
  { cat: "total_revenue", synonyms: ["Sales", "Revenue", "Billings", "Top-Line", "Ingresos", "Выручка", "Виручка"] },
  { cat: "revenue_offsets", synonyms: ["Returns", "Refunds", "Allowances", "Discounts", "Rebates", "Chargebacks"] },
  { cat: "cash", synonyms: ["Bank Balance", "Liquidity", "Petty Cash", "Efectivo", "Наличные"] },
  { cat: "tax_amount", synonyms: ["VAT", "IVA", "Sales-Tax", "GST", "НДС", "ПДВ", "Withholding"] },

  // 2. TRUCKING & LOGISTICS
  { cat: "total_expense", synonyms: ["Fuel", "Tolls", "ELD", "IFTA", "Bobtail", "Deadhead", "Detention", "Lumper", "Layover", "Reefer-Fuel", "Scale-Fees", "PrePass", "Permits", "IRP", "Hazmat", "Dispatch-Fee", "Brokerage-Cut", "Tire-Retread", "Cargo-Insurance"] },
  { cat: "total_revenue", synonyms: ["Rate-Per-Mile", "Fuel-Surcharge", "Accessorial", "Backhaul", "Detention-Pay"] },

  // 3. MANUFACTURING
  { cat: "inventory", synonyms: ["WIP", "Raw-Materials", "Finished-Goods", "MRO", "Tooling", "Dies", "Jigs", "Molds", "CNC-Machinery"] },
  { cat: "total_expense", synonyms: ["Direct-Labor", "Scrap", "Rework", "Spoilage", "Packaging-Film", "Shrink-wrap", "Coolant", "PPE", "ISO-Audit", "Calibration", "Tool-Crib", "Electricity-Industrial", "Duty-Drawback"] },

  // 4. REAL ESTATE
  { cat: "total_revenue", synonyms: ["GPR", "CAM-Recovery", "RUBS", "Pet-Rent", "Parking-Revenue", "Move-in-Fees", "Application-Fees"] },
  { cat: "total_expense", synonyms: ["Property-Tax", "Special-Assessments", "Insurance-Hazard", "Management-Fee", "Leasing-Commission", "Snow-Removal", "HVAC-Filter", "Pool-Service", "Turnover-Paint", "Ground-Lease"] },

  // 5. RETAIL & E-COMM
  { cat: "total_revenue", synonyms: ["POS-Sales", "GMV", "AOV", "Marketplace-Rev", "Online-Sales", "Gift-Card-Redemptions"] },
  { cat: "total_expense", synonyms: ["COGS", "Shipping-Labels", "Fulfillment-Fees", "Pick-and-Pack", "Interchange-Fees", "Shrinkage", "Spoilage", "Mystery-Shopper", "POS-Subscription", "Bag-Tax"] },
  { cat: "units_sold", synonyms: ["Units Sold", "Qty Sold", "Sales Volume"] },
  { cat: "on_hand", synonyms: ["On Hand", "In Stock", "Available Qty", "Current Inventory"] },

  // 6. AR/AP & LIQUIDITY
  { cat: "ar_balance", synonyms: ["Receivables", "Open-Invoices", "Unbilled-Revenue", "Doubtful-Accounts"] },
  { cat: "ap_balance", synonyms: ["Payables", "Vendor-Balance", "Accrued-Expenses", "Trade-Credit"] },
  { cat: "aging_90", synonyms: ["Over-90-Days", "Delinquent", "Stale-Invoices", "Collections"] }
];

async function run() {
  const client = new Client({
    connectionString: "postgres://portal:portalpass@localhost:5432/portaldb"
  });
  await client.connect();
  console.log("Connected to DB");

  let count = 0;
  for (const item of v6Terms) {
    for (const synonym of item.synonyms) {
      await client.query(
        "INSERT INTO semantic_dictionary (category, language, synonym) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
        [item.cat, "en", synonym]
      );
      // Also add space-separated versions of hyphenated terms
      if (synonym.includes('-')) {
        await client.query(
          "INSERT INTO semantic_dictionary (category, language, synonym) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
          [item.cat, "en", synonym.replace(/-/g, ' ')]
        );
      }
      count++;
    }
  }

  console.log(`Inserted ${count} terms from MDFC v6.0.`);
  await client.end();
}

run().catch(console.error);
