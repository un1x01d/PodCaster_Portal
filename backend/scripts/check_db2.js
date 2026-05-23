import pg from 'pg';
const { Client } = pg;
const client = new Client({
  connectionString: "postgres://portal:portalpass@localhost:5432/portaldb"
});
async function run() {
  try {
    await client.connect();
    const sheetId = "1779344576717_yfshu";
    const rows = await client.query("SELECT row_data FROM sheet_rows WHERE sheet_id = $1 LIMIT 5", [sheetId]);
    console.log("\nSAMPLE ROWS:\n", JSON.stringify(rows.rows, null, 2));
  } catch (e) {
    console.error("DB Error:", e.message);
  } finally {
    await client.end();
  }
}
run();
