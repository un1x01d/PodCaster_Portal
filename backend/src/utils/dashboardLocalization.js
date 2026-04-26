const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const OPENAI_TIMEOUT_MS = Number.parseInt(process.env.OPENAI_TIMEOUT_MS || "25000", 10);
const TRANSLATION_CACHE = new Map();
const TRANSLATION_IN_FLIGHT = new Map();
const TRANSLATION_CACHE_TTL_MS = Number.parseInt(process.env.TRANSLATION_CACHE_TTL_MS || `${60 * 60 * 1000}`, 10);
const TRANSLATION_CACHE_MAX_ENTRIES = Number.parseInt(process.env.TRANSLATION_CACHE_MAX_ENTRIES || "500", 10);

const LANGUAGE_LABELS = {
  en: "English",
  "en-us": "English",
  "en-gb": "English",
  uk: "Ukrainian",
  "uk-ua": "Ukrainian",
  ru: "Russian",
  "ru-ru": "Russian",
  es: "Spanish",
  "es-es": "Spanish",
  "es-mx": "Spanish",
  fr: "French",
  "fr-fr": "French",
  de: "German",
  "de-de": "German",
  it: "Italian",
  "it-it": "Italian",
  pt: "Portuguese",
  "pt-br": "Portuguese",
  "pt-pt": "Portuguese",
  ja: "Japanese",
  "ja-jp": "Japanese",
  ko: "Korean",
  "ko-kr": "Korean",
  zh: "Chinese",
  "zh-cn": "Chinese",
  "zh-tw": "Chinese",
  nl: "Dutch",
  "nl-nl": "Dutch",
  pl: "Polish",
  "pl-pl": "Polish",
  tr: "Turkish",
  "tr-tr": "Turkish",
  ar: "Arabic",
  "ar-sa": "Arabic",
  hi: "Hindi",
  "hi-in": "Hindi",
};

export function normalizeLocale(locale) {
  const raw = String(locale || "").trim();
  if (!raw) return "en";
  const lower = raw.toLowerCase().replace("_", "-");
  if (lower === "english") return "en";
  if (lower === "ukrainian") return "uk";
  if (lower === "russian") return "ru";
  if (lower === "spanish") return "es";
  if (lower === "french") return "fr";
  if (lower === "german") return "de";
  if (lower === "italian") return "it";
  if (lower === "portuguese") return "pt";
  if (lower === "japanese") return "ja";
  if (lower === "korean") return "ko";
  if (lower === "chinese") return "zh";
  if (lower === "dutch") return "nl";
  if (lower === "polish") return "pl";
  if (lower === "turkish") return "tr";
  if (lower === "arabic") return "ar";
  if (lower === "hindi") return "hi";
  return lower;
}

export function isEnglishLocale(locale) {
  const normalized = normalizeLocale(locale);
  return normalized === "en" || normalized.startsWith("en-");
}

export function getLanguageLabel(locale) {
  const normalized = normalizeLocale(locale);
  return LANGUAGE_LABELS[normalized] || LANGUAGE_LABELS[normalized.split("-")[0]] || normalized || "English";
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function protectTerms(text, terms = []) {
  const raw = String(text ?? "");
  const placeholders = [];
  let out = raw;
  const preserve = [
    ...new Set(
      (Array.isArray(terms) ? terms : [])
        .map((term) => String(term ?? "").trim())
        .filter(Boolean)
    ),
  ]
    .sort((a, b) => b.length - a.length);

  preserve.forEach((term, idx) => {
    const token = `__KEEP_${idx}_${Math.random().toString(36).slice(2, 8)}__`;
    const re = new RegExp(escapeRegExp(term), "g");
    out = out.replace(re, token);
    placeholders.push([token, term]);
  });

  return { text: out, placeholders };
}

function restoreTerms(text, placeholders = []) {
  let out = String(text ?? "");
  placeholders.forEach(([token, term]) => {
    out = out.split(token).join(term);
  });
  return out;
}

function normalizeItemText(item) {
  return {
    key: String(item?.key ?? ""),
    text: String(item?.text ?? ""),
  };
}

function makeCacheKey(locale, items, context) {
  return JSON.stringify({
    locale: normalizeLocale(locale),
    context: String(context || ""),
    items: (Array.isArray(items) ? items : []).map(normalizeItemText),
  });
}

function getCachedTranslation(cacheKey) {
  const found = TRANSLATION_CACHE.get(cacheKey);
  if (!found) return null;
  if (Date.now() > Number(found.expiresAt || 0)) {
    TRANSLATION_CACHE.delete(cacheKey);
    return null;
  }
  return found.value;
}

function setCachedTranslation(cacheKey, value) {
  TRANSLATION_CACHE.set(cacheKey, { value, expiresAt: Date.now() + TRANSLATION_CACHE_TTL_MS });
  while (TRANSLATION_CACHE.size > TRANSLATION_CACHE_MAX_ENTRIES) {
    const oldest = TRANSLATION_CACHE.keys().next().value;
    if (!oldest) break;
    TRANSLATION_CACHE.delete(oldest);
  }
}

async function callOpenAITranslation({ locale, items, context }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!Array.isArray(items)) return [];
  if (!apiKey || !items.length || isEnglishLocale(locale)) {
    return items.map((item) => ({ key: item.key, text: item.text }));
  }

  const cacheKey = makeCacheKey(locale, items, context);
  const cached = getCachedTranslation(cacheKey);
  if (cached) return cached.map((item) => ({ ...item }));
  const inFlight = TRANSLATION_IN_FLIGHT.get(cacheKey);
  if (inFlight) return inFlight.then((result) => result.map((item) => ({ ...item })));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
  const promise = (async () => {
    const targetLanguage = getLanguageLabel(locale);
    const preparedItems = items.map((item) => {
      const placeholderTerms = String(item.text ?? "").match(/\{[^{}]+\}/g) || [];
      const protectedTerms = [
        ...(Array.isArray(item.preserveTerms) ? item.preserveTerms : []),
        ...placeholderTerms,
      ];
      const protectedResult = protectTerms(item.text, protectedTerms);
      return {
        key: String(item.key),
        text: protectedResult.text,
        placeholders: protectedResult.placeholders,
      };
    });

    const payload = {
      locale: normalizeLocale(locale),
      target_language: targetLanguage,
      context,
      items: preparedItems.map(({ key, text }) => ({ key, text })),
      instructions: [
        `Translate each text into ${targetLanguage}.`,
        "Return valid JSON only.",
        "Preserve the key names exactly.",
        "Preserve placeholders, tokens, numbers, percentages, currency values, and dates exactly as written.",
        "Do not translate text wrapped in tokens such as __KEEP_*__.",
        "Keep line breaks and bullet structure intact.",
        "Do not add explanations.",
      ],
      output_schema: {
        translations: [{ key: "string", text: "string" }],
      },
    };

    const resp = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              "You are a precise translation engine for dashboard UI copy.",
              "Return only JSON.",
              "Preserve all provided tokens, placeholders, and values exactly.",
            ].join(" "),
          },
          { role: "user", content: JSON.stringify(payload) },
        ],
      }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`openai_error_${resp.status}: ${body.slice(0, 400)}`);
    }

    const json = await resp.json();
    const content = json?.choices?.[0]?.message?.content || "{}";
    const parsed = JSON.parse(content);
    const translated = new Map(
      Array.isArray(parsed?.translations)
        ? parsed.translations.map((item) => [String(item?.key ?? ""), String(item?.text ?? "")])
        : []
    );

    const result = preparedItems.map((item) => ({
      key: item.key,
      text: restoreTerms(translated.get(item.key) || item.text, item.placeholders),
    }));
    setCachedTranslation(cacheKey, result);
    return result;
  })();

  TRANSLATION_IN_FLIGHT.set(cacheKey, promise);
  try {
    return await promise;
  } catch (error) {
    console.error("dashboard translation failed:", error?.message || error);
    return items.map((item) => ({ key: item.key, text: item.text }));
  } finally {
    clearTimeout(timeout);
    TRANSLATION_IN_FLIGHT.delete(cacheKey);
  }
}

export async function translateDashboardItems({ locale, items, context = "dashboard-ui" }) {
  return callOpenAITranslation({ locale, items, context });
}

export async function translateDashboardCards({ locale, cards, preserveTerms = [], context = "dashboard-cards" }) {
  if (!Array.isArray(cards) || !cards.length || isEnglishLocale(locale)) return cards;
  const items = [];
  cards.forEach((card) => {
    items.push({
      key: `${card.id}:title`,
      text: String(card.title || ""),
      preserveTerms,
    });
    (Array.isArray(card.bullets) ? card.bullets : []).forEach((bullet, idx) => {
      items.push({
        key: `${card.id}:bullet:${idx}`,
        text: String(bullet || ""),
        preserveTerms,
      });
    });
  });

  const translated = await callOpenAITranslation({ locale, items, context });
  const byKey = new Map(translated.map((item) => [item.key, item.text]));
  return cards.map((card) => ({
    ...card,
    title: byKey.get(`${card.id}:title`) || card.title,
    bullets: (Array.isArray(card.bullets) ? card.bullets : []).map((bullet, idx) =>
      byKey.get(`${card.id}:bullet:${idx}`) || bullet
    ),
  }));
}
