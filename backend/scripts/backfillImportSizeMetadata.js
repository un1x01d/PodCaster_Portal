import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(process.cwd(), "..", ".env") });

const db = await import("../src/config/db.js");
const {
  query,
  forEachActiveTenantPool,
  runWithDbPool,
  ensureReportSourcesSchema,
  closeDbPool,
} = db;

async function scalar(sql, params = []) {
  const rows = await query(sql, params);
  if (!rows.length) return 0;
  const first = rows[0];
  const key = Object.keys(first)[0];
  return Number(first[key] || 0);
}

async function backfillForCurrentDb(label) {
  await ensureReportSourcesSchema();

  const updates = {
    fromSheets: 0,
    fromPayloads: 0,
    fromAuditByImportId: 0,
    fromAuditBySheetId: 0,
    fromStoredPathFs: 0,
    remainingNull: 0,
  };

  const hasLegacyFileSize = await scalar(`
    SELECT CASE WHEN EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_name = 'sheets' AND column_name = 'file_size'
    ) THEN 1 ELSE 0 END
  `);
  if (hasLegacyFileSize) {
    updates.fromSheets = await scalar(`
      WITH upd AS (
        UPDATE report_source_imports rsi
           SET file_size_bytes = s.file_size
          FROM sheets s
         WHERE s.id = rsi.sheet_id
           AND rsi.file_size_bytes IS NULL
           AND s.file_size IS NOT NULL
        RETURNING 1
      )
      SELECT COUNT(*)::int FROM upd
    `);
  }

  updates.fromPayloads = await scalar(`
    WITH upd AS (
      UPDATE report_source_imports rsi
         SET file_size_bytes = p.byte_size
        FROM import_job_payloads p
       WHERE rsi.file_size_bytes IS NULL
         AND rsi.job_id IS NOT NULL
         AND p.job_id = rsi.job_id
         AND p.byte_size IS NOT NULL
      RETURNING 1
    )
    SELECT COUNT(*)::int FROM upd
  `);

  updates.fromAuditByImportId = await scalar(`
    WITH candidates AS (
      SELECT
        rsi.id,
        (
          SELECT (al.metadata->>'file_size')::bigint
          FROM audit_logs al
          WHERE al.resource_type = 'report_source_import'
            AND al.resource_id = rsi.id::text
            AND (al.metadata->>'file_size') ~ '^[0-9]+$'
          ORDER BY al.created_at DESC
          LIMIT 1
        ) AS size_bytes
      FROM report_source_imports rsi
      WHERE rsi.file_size_bytes IS NULL
    ),
    upd AS (
      UPDATE report_source_imports rsi
         SET file_size_bytes = c.size_bytes
        FROM candidates c
       WHERE rsi.id = c.id
         AND c.size_bytes IS NOT NULL
      RETURNING 1
    )
    SELECT COUNT(*)::int FROM upd
  `);

  updates.fromAuditBySheetId = await scalar(`
    WITH candidates AS (
      SELECT
        rsi.id,
        (
          SELECT (al.metadata->>'file_size')::bigint
          FROM audit_logs al
          WHERE (al.metadata->>'sheet_id') = rsi.sheet_id
            AND (al.metadata->>'file_size') ~ '^[0-9]+$'
          ORDER BY al.created_at DESC
          LIMIT 1
        ) AS size_bytes
      FROM report_source_imports rsi
      WHERE rsi.file_size_bytes IS NULL
    ),
    upd AS (
      UPDATE report_source_imports rsi
         SET file_size_bytes = c.size_bytes
        FROM candidates c
       WHERE rsi.id = c.id
         AND c.size_bytes IS NOT NULL
      RETURNING 1
    )
    SELECT COUNT(*)::int FROM upd
  `);

  const fsCandidates = await query(`
    SELECT rsi.id, s.stored_path, s.filename
      FROM report_source_imports rsi
      JOIN sheets s ON s.id = rsi.sheet_id
     WHERE rsi.file_size_bytes IS NULL
  `);

  for (const row of fsCandidates) {
    const candidates = [];
    const rawStoredPath = String(row.stored_path || "").trim();
    if (rawStoredPath) {
      candidates.push(path.isAbsolute(rawStoredPath) ? rawStoredPath : path.resolve(process.cwd(), rawStoredPath));
    }
    const rawFilename = String(row.filename || "").trim();
    if (rawFilename) {
      candidates.push(path.resolve(process.cwd(), "uploads", rawFilename));
      candidates.push(path.resolve(process.cwd(), "..", "backend", "uploads", rawFilename));
    }

    for (const resolved of candidates) {
      try {
        const stat = fs.statSync(resolved);
        if (stat.isFile() && stat.size > 0) {
          await query(
            `UPDATE report_source_imports
                SET file_size_bytes = $2
              WHERE id = $1
                AND file_size_bytes IS NULL`,
            [row.id, stat.size]
          );
          updates.fromStoredPathFs += 1;
          break;
        }
      } catch {
        // Ignore missing/inaccessible files; continue best-effort backfill.
      }
    }
  }

  updates.remainingNull = await scalar(`
    SELECT COUNT(*)::int
      FROM report_source_imports
     WHERE file_size_bytes IS NULL
  `);

  console.log(
    `[backfill-import-sizes] db=${label} sheets=${updates.fromSheets} payloads=${updates.fromPayloads} audit_import=${updates.fromAuditByImportId} audit_sheet=${updates.fromAuditBySheetId} fs=${updates.fromStoredPathFs} remaining_null=${updates.remainingNull}`
  );
}

async function run() {
  await backfillForCurrentDb("control");
  await forEachActiveTenantPool(async (tenant) => {
    await runWithDbPool(tenant.pool, async () => {
      await backfillForCurrentDb(tenant.db_name);
    });
  });
}

run()
  .catch((err) => {
    console.error("[backfill-import-sizes] failed:", err?.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDbPool();
  });
