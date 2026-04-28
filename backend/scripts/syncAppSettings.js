import "dotenv/config";
import { query } from "../src/config/db.js";

const APP_SETTINGS_DEFAULTS = {
  chat_tts_settings: {
    voices: { default: "nova", es: "shimmer", uk: "nova", ru: "nova" },
    models: { en: "tts-1", default: "tts-1-hd" },
    speed: { default: 0.9 },
  },
  chat_response_templates: {
    no_data: {
      en: "No data matched those criteria.",
      ru: "Данные по этим критериям не найдены.",
      uk: "Дані за цими критеріями не знайдено."
    }
  },
  chat_speech_rules: {
    round_currency_cents: true,
    drop_decimal_tail_slavic: true,
    slavic_number_scales: ["thousand", "million", "billion", "trillion"]
  },
};

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function validateChatTtsSettings(value) {
  if (!isPlainObject(value)) throw new Error("chat_tts_settings must be an object");
  if (!isPlainObject(value.voices)) throw new Error("chat_tts_settings.voices must be an object");
  if (!isPlainObject(value.models)) throw new Error("chat_tts_settings.models must be an object");
  if (!isPlainObject(value.speed)) throw new Error("chat_tts_settings.speed must be an object");
}

function validateSetting(key, value) {
  if (key === "chat_tts_settings") validateChatTtsSettings(value);
  if (key === "chat_response_templates" && !isPlainObject(value)) throw new Error("chat_response_templates must be an object");
  if (key === "chat_speech_rules" && !isPlainObject(value)) throw new Error("chat_speech_rules must be an object");
}

async function upsertSetting(key, value) {
  await query(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
    [key, JSON.stringify(value)]
  );
}

async function main() {
  const entries = Object.entries(APP_SETTINGS_DEFAULTS);
  for (const [key, value] of entries) {
    validateSetting(key, value);
    await upsertSetting(key, value);
    console.log(`synced ${key}`);
  }
  console.log(`sync complete (${entries.length} settings)`);
}

main().catch((err) => {
  console.error("sync:app-settings failed:", err?.message || err);
  process.exit(1);
});
