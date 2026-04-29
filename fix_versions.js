import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({ connectionString: "postgresql://postgres:postgres@localhost:5432/postgres" });

async function run() {
    try {
        console.log("Checking versions...");
        const res = await pool.query("SELECT id, report_source_id, file_label, import_version FROM report_source_imports ORDER BY report_source_id, file_label, created_at");
        console.table(res.rows);
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}
run();
