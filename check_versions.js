import pool from "./backend/src/config/db.js";
const res = await pool.query("SELECT id, report_source_id, file_label, import_version FROM report_source_imports ORDER BY report_source_id, file_label, import_version");
console.table(res.rows);
process.exit(0);
