import "dotenv/config";
import { initDb, query, closeDbPool } from "../src/config/db.js";

function toPeriodKeyFromValue(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[1]}-${iso[2]}`;
  const dt = new Date(text);
  if (Number.isNaN(dt.getTime())) return null;
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function toNumericOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number.parseFloat(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(num) ? num : null;
}

function evaluateCompatibility(semanticProfile = {}, rows = []) {
  const defaults = semanticProfile && typeof semanticProfile === "object" ? (semanticProfile.defaults || {}) : {};
  const dateColumn = String(defaults?.dateColumn || "").trim();
  const metricColumns = defaults?.metricColumns && typeof defaults.metricColumns === "object"
    ? Object.values(defaults.metricColumns).map((v) => String(v || "").trim()).filter(Boolean)
    : [];

  const missing = [];
  if (!dateColumn) missing.push("date/year mapping");
  if (!metricColumns.length) missing.push("metric mapping");

  if (dateColumn) {
    const dateVals = rows
      .map((r) => r?.[dateColumn])
      .filter((v) => v !== null && v !== undefined && String(v).trim() !== "");
    const dateHits = dateVals.filter((v) => !!toPeriodKeyFromValue(v)).length;
    const dateRatio = dateVals.length ? (dateHits / dateVals.length) : 0;
    if (dateVals.length < 5 || dateRatio < 0.6) {
      missing.push("date/year column values are not consistently valid dates");
    }
  }

  if (metricColumns.length) {
    let hasNumericMetric = false;
    for (const col of metricColumns) {
      const metricVals = rows
        .map((r) => r?.[col])
        .filter((v) => v !== null && v !== undefined && String(v).trim() !== "");
      if (metricVals.length < 5) continue;
      const numericHits = metricVals.filter((v) => toNumericOrNull(v) !== null).length;
      const numericRatio = metricVals.length ? (numericHits / metricVals.length) : 0;
      if (numericRatio >= 0.6) {
        hasNumericMetric = true;
        break;
      }
    }
    if (!hasNumericMetric) {
      missing.push("mapped metric columns are not consistently numeric");
    }
  }

  return {
    ready: missing.length === 0,
    missing,
    evaluatedAt: new Date().toISOString(),
    sampleRowsChecked: rows.length,
  };
}

async function main() {
  await initDb();
  const sheets = await query("SELECT id, semantic_profile FROM sheets ORDER BY uploaded_at DESC NULLS LAST");
  let updated = 0;
  for (const sheet of sheets) {
    const profile = sheet?.semantic_profile && typeof sheet.semantic_profile === "object" ? sheet.semantic_profile : {};
    const sampleRowsRes = await query(
      `SELECT row_data
         FROM sheet_rows
        WHERE sheet_id = $1
        ORDER BY row_index ASC
        LIMIT 200`,
      [sheet.id]
    );
    const rows = sampleRowsRes.map((r) => r.row_data || {});
    const compatibility = evaluateCompatibility(profile, rows);
    const next = {
      ...profile,
      learned: {
        ...(profile.learned || {}),
        ai_chat_compatibility: compatibility,
      },
    };
    await query(
      `UPDATE sheets
          SET semantic_profile = $2::jsonb,
              semantic_profile_updated_at = CURRENT_TIMESTAMP
        WHERE id = $1`,
      [sheet.id, JSON.stringify(next)]
    );
    updated += 1;
  }
  console.log(`[backfill_ai_chat_compatibility] updated=${updated}`);
  await closeDbPool();
}

main().catch(async (err) => {
  console.error("[backfill_ai_chat_compatibility] failed", err?.message || err);
  try { await closeDbPool(); } catch {}
  process.exit(1);
});

