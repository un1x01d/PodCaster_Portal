import { query } from "../../config/db.js";

const MEM_FALLBACK = new Map();
const KEY_PREFIX = "chat_analysis_memory";

function safeInt(v, d = 0) {
  const n = Number.parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}

function keyOf({ tenantId = null, userId = 0, sheetId = "nosheet" }) {
  return `${KEY_PREFIX}:${safeInt(tenantId, 0)}:${safeInt(userId, 0)}:${String(sheetId || "nosheet")}`;
}

function defaultMemory() {
  return { last_successful_analysis: null };
}

export async function getConversationAnalysisMemory({ tenantId = null, userId = 0, sheetId = null }) {
  const key = keyOf({ tenantId, userId, sheetId });
  try {
    const rows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [key]);
    const raw = rows?.[0]?.value;
    if (raw && typeof raw === "object") return raw;
  } catch (_) {
    // fallback below
  }
  return MEM_FALLBACK.get(key) || defaultMemory();
}

export async function storeConversationAnalysisMemory({ tenantId = null, userId = 0, sheetId = null, memory }) {
  const key = keyOf({ tenantId, userId, sheetId });
  const value = memory && typeof memory === "object" ? memory : defaultMemory();
  try {
    await query(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET
         value = EXCLUDED.value,
         updated_at = NOW()`,
      [key, JSON.stringify(value)]
    );
    return true;
  } catch (_) {
    MEM_FALLBACK.set(key, value);
    return false;
  }
}
