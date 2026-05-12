import { getClient } from "../src/config/db.js";

function isLowSignalPhrase(raw = "") {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return true;
  if (s.length < 4) return true;
  if (/^\d+$/.test(s)) return true;
  if (/^[\d\s.,:;!?()\-+/$%]+$/.test(s)) return true;
  const stop = new Set(["ok", "good", "yes", "no", "thanks", "thank you", "done", "fine"]);
  if (stop.has(s)) return true;
  return false;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const client = await getClient();
  try {
    const res = await client.query(
      `SELECT id, locale, phrase, mapped_intent, confidence, created_at
         FROM ai_learning_rules
        WHERE status = 'approved'
        ORDER BY created_at DESC
        LIMIT 5000`
    );
    const rows = Array.isArray(res?.rows) ? res.rows : [];
    const flagged = rows.filter((r) => isLowSignalPhrase(r?.phrase));

    console.log(`approved_rules_scanned=${rows.length}`);
    console.log(`low_signal_flagged=${flagged.length}`);
    if (!flagged.length) return;

    flagged.slice(0, 50).forEach((r) => {
      console.log(`- id=${r.id} locale=${r.locale} intent=${r.mapped_intent} phrase="${String(r.phrase || "")}"`);
    });
    if (flagged.length > 50) {
      console.log(`...and ${flagged.length - 50} more`);
    }

    if (!apply) {
      console.log("dry_run_only=true (pass --apply to disable flagged rules)");
      return;
    }

    const ids = flagged.map((r) => Number(r.id)).filter((id) => Number.isInteger(id) && id > 0);
    if (!ids.length) return;
    await client.query(
      `UPDATE ai_learning_rules
          SET status = 'disabled'
        WHERE id = ANY($1::bigint[])`,
      [ids]
    );
    console.log(`disabled_rules=${ids.length}`);
  } finally {
    client.release();
  }
}

main().catch((err) => {
  console.error("cleanup_low_signal_learning_rules_failed:", err?.message || err);
  process.exitCode = 1;
});
