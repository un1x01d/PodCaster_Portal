import { query } from "../config/db.js";
import { loadAiRuntimeSettings, loadEffectiveAiRuntimeSettings } from "./aiRuntimeSettings.js";
import { isPlatformAdminUser } from "./authorization.js";

export const AI_FEATURE_TOGGLES_SETTINGS_KEY = "ai_feature_toggles_settings";

export function normalizeAiFeatureToggles(raw = {}) {
  return {
    chatEnabled: raw?.chatEnabled === true || String(raw?.chatEnabled).toLowerCase() === "true",
    dashboardTranslationEnabled:
      raw?.dashboardTranslationEnabled === true || String(raw?.dashboardTranslationEnabled).toLowerCase() === "true",
    chatAudioEnabled:
      raw?.chatAudioEnabled === true || String(raw?.chatAudioEnabled).toLowerCase() === "true",
    insightAiEnabled:
      raw?.insightAiEnabled === true || String(raw?.insightAiEnabled).toLowerCase() === "true",
    businessClassificationEnabled:
      raw?.businessClassificationEnabled === true || String(raw?.businessClassificationEnabled).toLowerCase() === "true",
  };
}

export async function loadAiFeatureTogglesSetting() {
  const rows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [AI_FEATURE_TOGGLES_SETTINGS_KEY]);
  return normalizeAiFeatureToggles(rows?.[0]?.value || {});
}

export async function resolveEffectiveAiFeaturesForGroupId(groupId) {
  const globalRuntime = await loadAiRuntimeSettings(null).catch(() => ({}));
  const gid = Number.parseInt(String(groupId || ""), 10);
  if (!Number.isInteger(gid) || gid <= 0) {
    if (globalRuntime?.globalAiDisabled === true) {
      return {
        chatEnabled: false,
        dashboardTranslationEnabled: false,
        chatAudioEnabled: false,
        insightAiEnabled: false,
        businessClassificationEnabled: false,
      };
    }
    return {
      chatEnabled: globalRuntime?.chatEnabled === true,
      dashboardTranslationEnabled: globalRuntime?.dashboardTranslationEnabled === true,
      chatAudioEnabled: globalRuntime?.chatAudioEnabled === true,
      insightAiEnabled: globalRuntime?.insightAiEnabled === true,
      businessClassificationEnabled: globalRuntime?.businessClassificationEnabled === true,
    };
  }
  const { runtime: groupRuntime } = await loadEffectiveAiRuntimeSettings(gid).catch(() => ({ runtime: globalRuntime }));
  const isAiGloballyDisabled = globalRuntime?.globalAiDisabled === true || groupRuntime?.globalAiDisabled === true;
  if (isAiGloballyDisabled) {
    return {
      chatEnabled: false,
      dashboardTranslationEnabled: false,
      chatAudioEnabled: false,
      insightAiEnabled: false,
      businessClassificationEnabled: false,
    };
  }
  return {
    chatEnabled: groupRuntime?.chatEnabled === true,
    dashboardTranslationEnabled: groupRuntime?.dashboardTranslationEnabled === true,
    chatAudioEnabled: groupRuntime?.chatAudioEnabled === true,
    insightAiEnabled: groupRuntime?.insightAiEnabled === true,
    businessClassificationEnabled: groupRuntime?.businessClassificationEnabled === true,
  };
}

export async function resolveEffectiveAiFeaturesForUser(user) {
  const userId = Number.parseInt(String(user?.id || ""), 10);
  if (!Number.isInteger(userId) || userId <= 0) {
    return resolveEffectiveAiFeaturesForGroupId(null);
  }
  if (isPlatformAdminUser(user)) {
    return resolveEffectiveAiFeaturesForGroupId(null);
  }
  const tokenGroupId = Number.parseInt(String(user?.customer_group_id || ""), 10);
  if (Number.isInteger(tokenGroupId) && tokenGroupId > 0) {
    return resolveEffectiveAiFeaturesForGroupId(tokenGroupId);
  }
  const rows = await query(
    `SELECT group_id
       FROM user_groups
      WHERE user_id = $1`,
    [userId]
  );
  const effectiveRows = Array.isArray(rows) ? rows : [];
  const groupIds = effectiveRows
    .map((row) => Number.parseInt(String(row?.group_id || ""), 10))
    .filter((groupId) => Number.isInteger(groupId) && groupId > 0);
  if (!groupIds.length) {
    return resolveEffectiveAiFeaturesForGroupId(null);
  }
  const effectivePerGroup = await Promise.all(groupIds.map((groupId) => resolveEffectiveAiFeaturesForGroupId(groupId)));
  return effectivePerGroup.reduce((acc, groupEffective) => ({
    chatEnabled: acc.chatEnabled || groupEffective?.chatEnabled === true,
    dashboardTranslationEnabled: acc.dashboardTranslationEnabled || groupEffective?.dashboardTranslationEnabled === true,
    chatAudioEnabled: acc.chatAudioEnabled || groupEffective?.chatAudioEnabled === true,
    insightAiEnabled: acc.insightAiEnabled || groupEffective?.insightAiEnabled === true,
    businessClassificationEnabled: acc.businessClassificationEnabled || groupEffective?.businessClassificationEnabled === true,
  }), {
    chatEnabled: false,
    dashboardTranslationEnabled: false,
    chatAudioEnabled: false,
    insightAiEnabled: false,
    businessClassificationEnabled: false,
  });
}
