import { normalizeLocale, translateDashboardItems } from "../utils/dashboardLocalization.js";

export async function translateDashboardCopy(req, res) {
  const body = req.body || {};
  const locale = normalizeLocale(body.locale || body.lang || "en");
  const items = Array.isArray(body.items) ? body.items : [];

  if (!items.length) {
    return res.json({ locale, translations: {} });
  }

  const translated = await translateDashboardItems({
    locale,
    context: "dashboard-ui",
    items: items.map((item, idx) => ({
      key: String(item?.key ?? `item_${idx}`),
      text: String(item?.text ?? ""),
      preserveTerms: Array.isArray(item?.preserveTerms) ? item.preserveTerms : [],
    })),
  });

  const translations = {};
  translated.forEach((item) => {
    translations[item.key] = item.text;
  });

  return res.json({ locale, translations });
}

