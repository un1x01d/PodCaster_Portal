import pkg from 'pg';
const { Client } = pkg;

const expandedTerms = [
  // TRUCKING & LOGISTICS [EXP_LOG]
  { cat: "total_expense", synonyms: ["Fuel", "IFTA", "ELD", "Bobtail", "Deadhead", "Detention", "Lumper", "Layover", "Reefer-Fuel", "Scale-Fees", "Tolls", "PrePass", "Permits", "IRP", "Hazmat-Endorsement", "Dispatch-Fee", "Brokerage-Cut", "Tire-Retread", "Oil-Change", "PM-Service", "Brake-Chambers", "Air-Lines", "Glad-hands", "Fifth-wheel", "APU-Service", "Log-book-software", "Cargo-Insurance", "Bobtail-Insurance", "Physical-Damage", "Factoring-Fees", "Trailer-Lease", "Yard-Storage", "Cross-docking", "Per-Diem", "Driver-Training", "Drug-Testing", "DOT-Physical", "IRP-Plates", "Heavy-Vehicle-Use-Tax", "HVUT", "IFTA-Quarterly"] },
  
  // MANUFACTURING [ASSET_MFG]
  { cat: "inventory", synonyms: ["WIP", "Raw-Materials", "Finished-Goods", "MRO", "Tooling", "Dies", "Jigs", "Molds", "CNC-Machinery", "Lathes", "Forklifts", "Pallets", "Racking", "Conveyor-Systems", "PLC-Controllers"] },
  // MANUFACTURING [EXP_MFG]
  { cat: "total_expense", synonyms: ["Direct-Labor", "Overtime-Premium", "Shift-Differential", "Scrap", "Rework", "Spoilage", "Packaging-Film", "Corrugated-Boxes", "Strapping", "Shrink-wrap", "Machine-Lubricant", "Coolant", "PPE", "Safety-Shoes", "ISO-Audit", "Calibration", "Tool-Crib", "Hazardous-Waste-Disposal", "Electricity-Industrial", "Natural-Gas-Processing", "Quality-Sampling", "Lab-Testing", "Logistics-Inbound", "Duty-Drawback", "Tariff-Costs"] },

  // REAL ESTATE & PROPERTY [REV_RE]
  { cat: "total_revenue", synonyms: ["GPR", "Net-Effective-Rent", "CAM-Recovery", "RUBS", "Utility-Reimbursement", "Pet-Rent", "Parking-Revenue", "Storage-Revenue", "Move-in-Fees", "Application-Fees", "Late-Fees", "Lease-Break-Fees", "Vending-Income", "Laundry-Income", "Cell-Tower-Lease", "Billboard-Income", "Interest-Income-Escrow"] },
  // REAL ESTATE & PROPERTY [EXP_RE]
  { cat: "total_expense", synonyms: ["Property-Tax", "Special-Assessments", "Insurance-Hazard", "Management-Fee", "Leasing-Commission", "Marketing-Zumper", "Marketing-Apartments-com", "Landscaping", "Snow-Removal", "HVAC-Filter-Change", "Pool-Service", "Pest-Control", "Janitorial", "Turnover-Paint", "Turnover-Carpet", "Countertop-Resurfacing", "Plumbing-Snake", "Roof-Patch", "Gutter-Cleaning", "Elevator-Maintenance", "Fire-Alarm-Monitoring", "Legal-Eviction", "Security-Patrol", "HOA-Dues", "Ground-Lease"] },

  // AD-TECH & MEDIA [YIELD_AD]
  { cat: "total_revenue", synonyms: ["CPM", "eCPM", "rCPM", "Fill-Rate", "Viewability", "IVT-Filter", "Brand-Safety", "Header-Bidding", "Open-Bidding", "PMP-Revenue", "Direct-Sold", "Floor-Price", "Hard-Floor", "Soft-Floor", "Latency-Loss", "Discrepancy-Adjustment", "RevShare", "Tech-Fee", "Managed-Service-Fee", "Creative-Hosting", "CDN-Costs", "Ad-Serving-Fee", "Attribution-Model", "DAU", "MAU", "ARPU", "Churn-Rate", "CAC", "LTV"] }
];

async function run() {
  const client = new Client({
    connectionString: "postgres://portal:portalpass@localhost:5432/portaldb"
  });
  await client.connect();
  console.log("Connected to DB");

  let count = 0;
  for (const item of expandedTerms) {
    for (const synonym of item.synonyms) {
      // Normalize synonym to handle common variants
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
      count++;
    }
  }

  console.log(`Inserted ${count} terms from MDFC Expansion.`);
  await client.end();
}

run().catch(console.error);
