import { query, forEachActiveTenantPool, isTenantDbIsolationEnabled } from "../src/config/db.js";
import { normalizeDlpSettings, scanRowsForDlp, DLP_SETTINGS_KEY } from "../src/utils/dlp.js";
import { groupHasFeature } from "../src/utils/entitlements.js";

function groupRowsByTab(rows = []) {
  const grouped = {};
  for (const row of rows) {
    const tabName = String(row?.tab_name || "Sheet1");
    if (!grouped[tabName]) grouped[tabName] = [];
    grouped[tabName].push(row?.row_data && typeof row.row_data === "object" ? row.row_data : {});
  }
  return grouped;
}

async function loadDlpSettings() {
  const rows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [DLP_SETTINGS_KEY]);
  return normalizeDlpSettings(rows?.[0]?.value || {});
}

async function recomputeForCurrentDb(label = "default") {
  const dlp = await loadDlpSettings();
  const sheets = await query(
    `SELECT s.id, s.group_id, s.semantic_profile, g.entitlements
       FROM sheets s
       LEFT JOIN groups g ON g.id = s.group_id
      ORDER BY s.uploaded_at DESC NULLS LAST, s.id DESC`,
    []
  );

  let processed = 0;
  let updated = 0;
  let cleared = 0;

  for (const sheet of sheets) {
    processed += 1;
    const rowData = await query(
      `SELECT tab_name, row_data
         FROM sheet_rows
        WHERE sheet_id = $1
        ORDER BY row_index ASC`,
      [sheet.id]
    );
    const grouped = groupRowsByTab(rowData);
    const currentProfile = sheet?.semantic_profile && typeof sheet.semantic_profile === "object"
      ? sheet.semantic_profile
      : {};
    const currentDlp = currentProfile?.dlp && typeof currentProfile.dlp === "object"
      ? currentProfile.dlp
      : {};
    const customerDlpEnabled = sheet?.group_id
      ? groupHasFeature({ entitlements: sheet.entitlements || {} }, "dlp")
      : true;
    const shouldApply = dlp.enabled !== false && customerDlpEnabled;

    let nextDlp = {
      mode: dlp.mode,
      findingsCount: 0,
      scannedCells: 0,
      maskedColumns: {},
      maskedCells: {},
      updatedAt: new Date().toISOString(),
    };

    if (shouldApply) {
      const scan = scanRowsForDlp(grouped, dlp);
      nextDlp = {
        mode: dlp.mode,
        findingsCount: Number(scan?.findings?.length || 0),
        scannedCells: Number(scan?.scannedCells || 0),
        maskedColumns: scan?.maskedColumns || {},
        maskedCells: scan?.maskedCells || {},
        updatedAt: new Date().toISOString(),
      };
    }

    const hasMasking = Object.values(nextDlp.maskedColumns || {}).some((cols) => Array.isArray(cols) && cols.length > 0);
    const prevMasking = Object.values(currentDlp?.maskedColumns || {}).some((cols) => Array.isArray(cols) && cols.length > 0);
    if (!hasMasking && prevMasking) cleared += 1;
    if (hasMasking || prevMasking || Number(currentDlp?.findingsCount || 0) !== Number(nextDlp.findingsCount || 0)) {
      updated += 1;
    }

    const nextProfile = {
      ...currentProfile,
      dlp: nextDlp,
    };
    await query(
      `UPDATE sheets
          SET semantic_profile = $2::jsonb,
              semantic_profile_updated_at = CURRENT_TIMESTAMP
        WHERE id = $1`,
      [sheet.id, JSON.stringify(nextProfile)]
    );
  }

  console.log(`[backfill_dlp] db=${label} processed=${processed} updated=${updated} cleared=${cleared}`);
  return { processed, updated, cleared };
}

async function run() {
  const summaries = [];
  summaries.push({ db: "default", ...(await recomputeForCurrentDb("default")) });

  if (isTenantDbIsolationEnabled()) {
    await forEachActiveTenantPool(async (tenant) => {
      const label = String(tenant?.db_name || `tenant_${tenant?.id || "unknown"}`);
      const summary = await recomputeForCurrentDb(label);
      summaries.push({ db: label, ...summary });
    });
  }

  const totals = summaries.reduce((acc, item) => {
    acc.processed += Number(item.processed || 0);
    acc.updated += Number(item.updated || 0);
    acc.cleared += Number(item.cleared || 0);
    return acc;
  }, { processed: 0, updated: 0, cleared: 0 });

  console.log(`[backfill_dlp] done dbs=${summaries.length} processed=${totals.processed} updated=${totals.updated} cleared=${totals.cleared}`);
}

run().catch((err) => {
  console.error("[backfill_dlp] failed", err?.message || err);
  process.exit(1);
});

