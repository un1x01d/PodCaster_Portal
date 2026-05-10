import { normalizeLocale, translateDashboardItemsWithUsage } from "../utils/dashboardLocalization.js";
import { recordAiUsage, reserveAiQueryForUser } from "../utils/aiQuota.js";
import { resolveEffectiveAiFeaturesForUser } from "../utils/aiFeatureToggles.js";
import { isAiGloballyDisabled, loadAiRuntimeSettings } from "../utils/aiRuntimeSettings.js";

function aiError(code, details = {}) {
  return { error: code, code, ...details };
}

export async function translateDashboardCopy(req, res) {
  const aiFeatures = await resolveEffectiveAiFeaturesForUser(req.user).catch(() => ({ dashboardTranslationEnabled: false }));
  if (!aiFeatures?.dashboardTranslationEnabled) {
    return res.status(403).json(aiError("ai_feature_disabled:dashboard_translation"));
  }
  const body = req.body || {};
  const locale = normalizeLocale(body.locale || body.lang || "en");
  const items = Array.isArray(body.items) ? body.items : [];

  if (!items.length) {
    return res.json({ locale, translations: {} });
  }

  const runtime = await loadAiRuntimeSettings(null).catch(() => ({}));
  if (isAiGloballyDisabled(runtime)) {
    return res.status(403).json(aiError("global_ai_disabled"));
  }
  if (runtime?.dashboardTranslationEnabled !== true) {
    return res.status(403).json(aiError("ai_feature_disabled:dashboard_translation"));
  }
  const maxItems = Number.parseInt(runtime?.dashboardTranslateMaxItems, 10) || 200;
  const maxCharsPerItem = Number.parseInt(runtime?.dashboardTranslateMaxCharsPerItem, 10) || 500;
  if (items.length > maxItems) {
    return res.status(413).json(aiError("dashboard_translate_too_many_items", { maxItems }));
  }

  const normalizedItems = items.map((item, idx) => ({
    key: String(item?.key ?? `item_${idx}`),
    text: String(item?.text ?? ""),
    preserveTerms: Array.isArray(item?.preserveTerms) ? item.preserveTerms : [],
  }));
  const oversized = normalizedItems.find((item) => item.text.length > maxCharsPerItem);
  if (oversized) {
    return res.status(413).json({
      ...aiError("dashboard_translate_item_too_large"),
      key: oversized.key,
      maxCharsPerItem,
    });
  }

  let reservation = null;
  try {
    reservation = await reserveAiQueryForUser({ user: req.user, kind: "dashboard_translate" });
  } catch (err) {
    return res.status(err.statusCode || 429).json(aiError(err.message, err.details || {}));
  }

  const translatedResult = await translateDashboardItemsWithUsage({
    locale,
    context: "dashboard-ui",
    items: normalizedItems,
  });
  const translated = translatedResult?.items || [];
  const usage = translatedResult?.usage || null;

  if (usage && (Number(usage.promptTokens || 0) > 0 || Number(usage.completionTokens || 0) > 0)) {
    try {
      await recordAiUsage({
        reservation,
        provider: usage.provider || "openai",
        model: usage.model || null,
        promptTokens: Number(usage.promptTokens || 0),
        completionTokens: Number(usage.completionTokens || 0),
      });
    } catch (e) {
      // Non-blocking metrics path.
    }
  }

  const translations = {};
  translated.forEach((item) => {
    translations[item.key] = item.text;
  });

  return res.json({ locale, translations });
}
