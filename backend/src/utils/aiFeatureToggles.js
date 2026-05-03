import { query } from "../config/db.js";
import { normalizeGroupEntitlements } from "./entitlements.js";

export const AI_FEATURE_TOGGLES_SETTINGS_KEY = "ai_feature_toggles_settings";

export function normalizeAiFeatureToggles(raw = {}) {
  return {
    chatEnabled: raw?.chatEnabled === true,
    dashboardTranslationEnabled: raw?.dashboardTranslationEnabled === true,
    chatAudioEnabled: raw?.chatAudioEnabled === true,
  };
}

export async function loadAiFeatureTogglesSetting() {
  const rows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [AI_FEATURE_TOGGLES_SETTINGS_KEY]);
  return normalizeAiFeatureToggles(rows?.[0]?.value || {});
}

function resolveOverride(globalValue, overrideValue) {
  return overrideValue === null || overrideValue === undefined ? !!globalValue : !!overrideValue;
}

export async function resolveEffectiveAiFeaturesForGroupId(groupId) {
  const globalFlags = await loadAiFeatureTogglesSetting().catch(() => normalizeAiFeatureToggles({}));
  const gid = Number.parseInt(String(groupId || ""), 10);
  if (!Number.isInteger(gid) || gid <= 0) return globalFlags;
  const rows = await query("SELECT entitlements FROM groups WHERE id = $1 LIMIT 1", [gid]);
  const ent = normalizeGroupEntitlements(rows?.[0]?.entitlements || {});
  return {
    chatEnabled: resolveOverride(globalFlags.chatEnabled, ent.aiChatEnabled),
    dashboardTranslationEnabled: resolveOverride(globalFlags.dashboardTranslationEnabled, ent.aiDashboardTranslationEnabled),
    chatAudioEnabled: resolveOverride(globalFlags.chatAudioEnabled, ent.aiChatAudioEnabled),
  };
}

export async function resolveEffectiveAiFeaturesForUser(user) {
  const userId = Number.parseInt(String(user?.id || ""), 10);
  if (!Number.isInteger(userId) || userId <= 0) {
    return loadAiFeatureTogglesSetting();
  }
  const rows = await query(
    `SELECT group_id
       FROM user_groups
      WHERE user_id = $1
      ORDER BY is_admin DESC, group_id ASC
      LIMIT 1`,
    [userId]
  );
  return resolveEffectiveAiFeaturesForGroupId(rows?.[0]?.group_id || null);
}
