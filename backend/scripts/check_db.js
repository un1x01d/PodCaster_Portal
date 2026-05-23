import pg from 'pg';
const { Client } = pg;
const client = new Client({
  connectionString: "postgres://portal:portalpass@localhost:5432/portaldb"
});
async function run() {
  try {
    await client.connect();
    const sheets = await client.query("SELECT id, filename, display_name, active, headers, semantic_profile FROM sheets WHERE active = TRUE LIMIT 1");
    console.log("ACTIVE SHEET:\n", JSON.stringify(sheets.rows[0], null, 2));
    
    if (sheets.rows.length > 0) {
      const sheetId = sheets.rows[0].id;
      const mappings = await client.query("SELECT original_header, canonical_field, confidence, approved_by_user FROM accounting_field_mappings WHERE sheet_id = $1", [sheetId]);
      console.log("\nMAPPINGS:\n", JSON.stringify(mappings.rows, null, 2));

      const rows = await client.query("SELECT row_data FROM sheet_rows WHERE sheet_id = $1 LIMIT 5", [sheetId]);
      console.log("\nSAMPLE ROWS:\n", JSON.stringify(rows.rows, null, 2));
    } else {
      console.log("No active sheet found.");
    }
  } catch (e) {
    console.error("DB Error:", e.message);
  } finally {
    await client.end();
  }
}
run();
