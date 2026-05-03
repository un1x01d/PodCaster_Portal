import { normalizeLocale, translateDashboardItemsWithUsage } from "../utils/dashboardLocalization.js";
import { recordAiUsage, reserveAiQueryForUser } from "../utils/aiQuota.js";

export async function translateDashboardCopy(req, res) {
  const body = req.body || {};
  const locale = normalizeLocale(body.locale || body.lang || "en");
  const items = Array.isArray(body.items) ? body.items : [];

  if (!items.length) {
    return res.json({ locale, translations: {} });
  }

  const translatedResult = await translateDashboardItemsWithUsage({
    locale,
    context: "dashboard-ui",
    items: items.map((item, idx) => ({
      key: String(item?.key ?? `item_${idx}`),
      text: String(item?.text ?? ""),
      preserveTerms: Array.isArray(item?.preserveTerms) ? item.preserveTerms : [],
    })),
  });
  const translated = translatedResult?.items || [];
  const usage = translatedResult?.usage || null;

  if (usage && (Number(usage.promptTokens || 0) > 0 || Number(usage.completionTokens || 0) > 0)) {
    try {
      const reservation = await reserveAiQueryForUser({ user: req.user, kind: "dashboard_translate" });
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
