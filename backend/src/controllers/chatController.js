import { Readable } from "node:stream";
import { query } from "../config/db.js";
import {
  checkSheetAccess,
  hasReportSourceOwnerAccess,
  isPlatformAdminUser,
  loadSheetPermissionSets,
  resolveRuntimeGroupIdForUser,
} from "../utils/authorization.js";
import { buildRowFilterWhereClause } from "../utils/rowFilters.js";
import { reserveAiQueryForSheet, resolveAiGroupIdForSheet } from "../utils/aiQuota.js";
import { isAiGloballyDisabled, loadAiRuntimeSettings, loadEffectiveAiRuntimeSettings } from "../utils/aiRuntimeSettings.js";

export { checkSheetAccess } from "../utils/authorization.js";

const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
const OPENAI_TIMEOUT_MS = Number.parseInt(process.env.OPENAI_TIMEOUT_MS || "60000", 10);
const CHAT_AUDIO_MAX_CHARS = Number.parseInt(process.env.CHAT_AUDIO_MAX_CHARS || "8000", 10);
const CHAT_TTS_SETTINGS_KEY = "chat_tts_settings";

function aiError(code, details = {}) {
  return { error: code, code, ...details };
}

function normalizeTtsInput(text = "", locale = "en") {
  let speechText = String(text || "").replace(/\*/g, "");
  const lang = (locale || "en").split("-")[0].toLowerCase();
  let cleanedText = naturalizeNumbersForTTS(speechText, locale);
  if (lang === "uk" || lang === "ru") cleanedText = expandFinancialTextPhonetically(cleanedText, lang);
  return cleanedText;
}

function expandLargeIntForEnglishSpeech(rawDigits = "") {
  const digits = String(rawDigits || "").replace(/[^\d]/g, "").replace(/^0+/, "") || "0";
  const n = BigInt(digits);
  if (n >= 1_000_000_000_000n) {
    const t = n / 1_000_000_000_000n;
    const b = (n % 1_000_000_000_000n) / 1_000_000_000n;
    const m = (n % 1_000_000_000n) / 1_000_000n;
    const k = (n % 1_000_000n) / 1_000n;
    const r = n % 1_000n;
    return [t ? `${t} trillion` : "", b ? `${b} billion` : "", m ? `${m} million` : "", k ? `${k} thousand` : "", r ? `${r}` : ""].filter(Boolean).join(" ");
  }
  if (n >= 1_000_000_000n) {
    const b = n / 1_000_000_000n;
    const m = (n % 1_000_000_000n) / 1_000_000n;
    const k = (n % 1_000_000n) / 1_000n;
    const r = n % 1_000n;
    return [b ? `${b} billion` : "", m ? `${m} million` : "", k ? `${k} thousand` : "", r ? `${r}` : ""].filter(Boolean).join(" ");
  }
  if (n >= 1_000_000n) {
    const m = n / 1_000_000n;
    const k = (n % 1_000_000n) / 1_000n;
    const r = n % 1_000n;
    return [m ? `${m} million` : "", k ? `${k} thousand` : "", r ? `${r}` : ""].filter(Boolean).join(" ");
  }
  if (n >= 1_000n) {
    const k = n / 1_000n;
    const r = n % 1_000n;
    return [k ? `${k} thousand` : "", r ? `${r}` : ""].filter(Boolean).join(" ");
  }
  return String(n);
}

function naturalizeNumbersForTTS(text = "", locale = "en") {
  let out = String(text || "");
  const lang = (locale || "en").split("-")[0].toLowerCase();
  const yearToWords = (yearRaw, targetLang = "uk") => {
    const y = Number(yearRaw);
    if (!Number.isFinite(y) || y < 1900 || y > 2200) return String(yearRaw || "");
    return slavicNumberToWords(y, targetLang, "m");
  };
  const normalizePercentToken = (raw) => {
    const textNum = String(raw || "").trim().replace(",", ".");
    if (!textNum) return "0";
    if (textNum.startsWith(".")) return `0${textNum}`;
    if (textNum.startsWith("-.")) return textNum.replace("-.", "-0.");
    if (textNum.startsWith("+.")) return textNum.replace("+.", "+0.");
    return textNum;
  };
  const roundCurrencyToWhole = (priceRaw, centsRaw) => {
    const units = parseInt(String(priceRaw || "").replace(/,/g, ""), 10) || 0;
    const cents = parseInt(String(centsRaw || "").padEnd(2, "0").slice(0, 2), 10) || 0;
    return cents >= 50 ? units + 1 : units;
  };
  const spokenSign = (rawNum, ukPlus = "плюс", ukMinus = "мінус", ruMinus = "минус") => {
    const s = String(rawNum || "").trim();
    if (s.startsWith("+")) return ukPlus;
    if (s.startsWith("-")) return lang === "ru" ? ruMinus : ukMinus;
    return "";
  };
  const signWordForLang = (rawNum) => {
    const s = String(rawNum || "").trim();
    if (lang === "uk") return s.startsWith("+") ? "плюс" : (s.startsWith("-") ? "мінус" : "");
    if (lang === "ru") return s.startsWith("+") ? "плюс" : (s.startsWith("-") ? "минус" : "");
    return s.startsWith("+") ? "plus" : (s.startsWith("-") ? "minus" : "");
  };

  // 1. Strip technical noise and formatting
  out = out.replace(/[•*]/g, ""); // bullets
  out = out.replace(/(\n|^)\s*[-–—]\s+/g, "$1 "); // leading dashes
  out = out.replace(/\.00(?!\d)/g, ""); // trailing .00 decimals
  out = out.replace(/\bUSD\b/gi, lang === "ru" ? "долларов" : (lang === "uk" ? "доларів" : "dollars"));

  if (lang === "uk") {
    // Normalize year ranges so both years are spoken as years, not digits.
    out = out.replace(/\b(з)\s+(19\d{2}|20\d{2})\s+(до)\s+(19\d{2}|20\d{2})\b/gi, (m, z, y1, d, y2) => {
      return `${z} ${yearToWords(y1, "uk")} ${d} ${yearToWords(y2, "uk")}`;
    });
    out = out.replace(/\b(від)\s+(19\d{2}|20\d{2})\s+(до)\s+(19\d{2}|20\d{2})\b/gi, (m, v, y1, d, y2) => {
      return `${v} ${yearToWords(y1, "uk")} ${d} ${yearToWords(y2, "uk")}`;
    });
    // Normalize year mentions to spoken words to avoid digit-by-digit reading.
    out = out.replace(/\b(Рік|Year)\s+(19\d{2}|20\d{2})\b/gi, (m, label, y) => `Рік ${yearToWords(y, "uk")}`);
    out = out.replace(/\b(19\d{2}|20\d{2})\s*рік\b/gi, (m, y) => `${yearToWords(y, "uk")} рік`);
    out = out.replace(/\b(19\d{2}|20\d{2})\s*року\b/gi, (m, y) => `${yearToWords(y, "uk")} року`);

    // Force explicit sign speech before numeric tokens.
    out = out.replace(/\(\s*\+/g, "(плюс ");
    out = out.replace(/\(\s*-/g, "(мінус ");
    out = out.replace(/(^|[\s(])\+(\$?\d)/g, "$1плюс $2");
    out = out.replace(/(^|[\s(])-(\$?\d)/g, "$1мінус $2");
    // Keep percentage decimals explicit for speech (including sub-1% values).
    out = out.replace(/([+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+))%/g, (m, numRaw) => {
      const signWord = spokenSign(numRaw, "плюс", "мінус");
      const value = normalizePercentToken(String(numRaw).replace(/^[+-]/, ""));
      return `${signWord ? `${signWord} ` : ""}${value} відсотка`;
    });
    // Normalize currency without cents for cleaner speech output.
    out = out.replace(/\$([\d,]+)\.(\d{1,2})\b/g, (m, price, centsRaw) => {
      const rounded = roundCurrencyToWhole(price, centsRaw);
      return `${rounded} доларів`;
    });
    // Drop decimal tails in spoken output for non-percent numbers.
    out = out.replace(/(\d[\d,\s]*)[.,]\d{1,2}\b(?!\s*відсот)/g, "$1");
    out = out.replace(/\bvs\b/gi, "проти");
    out = out.replace(/\bNet Income\b/gi, "Прибуток");
    out = out.replace(/\bNet Revenue\b/gi, "Чистий виторг");
    out = out.replace(/\bRevenue\b/gi, "Виторг");
    out = out.replace(/\btab\b/gi, "вкладка");
    out = out.replace(/\$([\d,.\s]+)\b/g, "$1 доларів");
  } else if (lang === "ru") {
    // Normalize year ranges so both years are spoken as years, not digits.
    out = out.replace(/\b(с)\s+(19\d{2}|20\d{2})\s+(по)\s+(19\d{2}|20\d{2})\b/gi, (m, s, y1, p, y2) => {
      return `${s} ${yearToWords(y1, "ru")} ${p} ${yearToWords(y2, "ru")}`;
    });
    out = out.replace(/\b(от)\s+(19\d{2}|20\d{2})\s+(до)\s+(19\d{2}|20\d{2})\b/gi, (m, o, y1, d, y2) => {
      return `${o} ${yearToWords(y1, "ru")} ${d} ${yearToWords(y2, "ru")}`;
    });
    // Normalize year mentions to spoken words to avoid digit-by-digit reading.
    out = out.replace(/\b(Год|Year)\s+(19\d{2}|20\d{2})\b/gi, (m, label, y) => `Год ${yearToWords(y, "ru")}`);
    out = out.replace(/\b(19\d{2}|20\d{2})\s*год\b/gi, (m, y) => `${yearToWords(y, "ru")} год`);
    out = out.replace(/\b(19\d{2}|20\d{2})\s*года\b/gi, (m, y) => `${yearToWords(y, "ru")} года`);

    // Force explicit sign speech before numeric tokens.
    out = out.replace(/\(\s*\+/g, "(плюс ");
    out = out.replace(/\(\s*-/g, "(минус ");
    out = out.replace(/(^|[\s(])\+(\$?\d)/g, "$1плюс $2");
    out = out.replace(/(^|[\s(])-(\$?\d)/g, "$1минус $2");
    // Keep percentage decimals explicit for speech (including sub-1% values).
    out = out.replace(/([+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+))%/g, (m, numRaw) => {
      const signWord = spokenSign(numRaw, "плюс", "мінус", "минус");
      const value = normalizePercentToken(String(numRaw).replace(/^[+-]/, ""));
      return `${signWord ? `${signWord} ` : ""}${value} процента`;
    });
    // Normalize currency without cents for cleaner speech output.
    out = out.replace(/\$([\d,]+)\.(\d{1,2})\b/g, (m, price, centsRaw) => {
      const rounded = roundCurrencyToWhole(price, centsRaw);
      return `${rounded} долларов`;
    });
    // Drop decimal tails in spoken output for non-percent numbers.
    out = out.replace(/(\d[\d,\s]*)[.,]\d{1,2}\b(?!\s*процент)/g, "$1");
    out = out.replace(/\bvs\b/gi, "против");
    out = out.replace(/\bNet Income\b/gi, "Чистая прибыль");
    out = out.replace(/\bNet Revenue\b/gi, "Чистая выручка");
    out = out.replace(/\bRevenue\b/gi, "Выручка");
    out = out.replace(/\btab\b/gi, "вкладка");
    out = out.replace(/\$([\d,.\s]+)\b/g, "$1 долларов");
  } else {
    // English defaults
    out = out.replace(/\bvs\b/gi, "versus");
    // Handle currency with cents: $1,234.56 or $1234.56
    out = out.replace(/\$([\d,]+)\.(\d{2})\b/g, (m, price, cents) => {
        const rounded = roundCurrencyToWhole(price, cents);
        const spoken = expandLargeIntForEnglishSpeech(String(rounded));
        return `${spoken} dollars`;
    });
    // Handle currency without cents: $1,234
    out = out.replace(/\$([\d,.]+)\b/g, (m, price) => {
        const p = String(price || "").replace(/[^\d]/g, "");
        const spoken = expandLargeIntForEnglishSpeech(p);
        return `${spoken} dollars`;
    });
    // Handle large plain numbers that may be read digit-by-digit by TTS.
    out = out.replace(/\b\d{5,}\b/g, (m) => expandLargeIntForEnglishSpeech(m));
    // Final expansion for large numbers to help TTS (e.g. 52,026,091 -> 52 million 26 thousand 91)
    // We parse as int to strip leading zeros like "026" -> "26"
    out = out.replace(/\b(\d{1,3}),(\d{3}),(\d{3})\b/g, (m, mill, thou, rest) => {
        return `${mill} million ${parseInt(thou, 10)} thousand ${parseInt(rest, 10)}`;
    });
    out = out.replace(/\b(\d{1,3}),(\d{3})\b/g, (m, thou, rest) => {
        return `${parseInt(thou, 10)} thousand ${parseInt(rest, 10)}`;
    });
    
    out = out.replace(/([+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+))%/g, (m, numRaw) => {
      const signWord = signWordForLang(numRaw);
      const value = normalizePercentToken(String(numRaw).replace(/^[+-]/, ""));
      return `${signWord ? `${signWord} ` : ""}${value} percent`;
    });
    // Force spoken sign for standalone signed values often used in deltas.
    out = out.replace(/(^|[\s(])([+-])\s*(\d+(?:[.,]\d+)?)(?!\s*percent\b)/gi, (m, pre, sign, value) => {
      const word = sign === "+" ? "plus" : "minus";
      return `${pre}${word} ${value}`;
    });
    out = out.replace(/\(\+/g, "(plus ");
    out = out.replace(/\(\-/g, "(minus ");
  }

  return out;
}

function getSlavicPlural(n, forms) {
  const num = Math.abs(Number(n) || 0);
  const mod10 = num % 10;
  const mod100 = num % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

function slavicNumberToWords(n, lang = "ru", gender = "m") {
  const num = Math.floor(Math.abs(Number(n) || 0));
  const dict = lang === "uk"
    ? {
      zero: "нуль",
      onesM: ["", "один", "два", "три", "чотири", "п'ять", "шість", "сім", "вісім", "дев'ять"],
      onesF: ["", "одна", "дві", "три", "чотири", "п'ять", "шість", "сім", "вісім", "дев'ять"],
      teens: ["десять", "одинадцять", "дванадцять", "тринадцять", "чотирнадцять", "п'ятнадцять", "шістнадцять", "сімнадцять", "вісімнадцять", "дев'ятнадцять"],
      tens: ["", "", "двадцять", "тридцять", "сорок", "п'ятдесят", "шістдесят", "сімдесят", "вісімдесят", "дев'яносто"],
      hundreds: ["", "сто", "двісті", "триста", "чотириста", "п'ятсот", "шістсот", "сімсот", "вісімсот", "дев'ятсот"],
      thousandForms: ["тисяча", "тисячі", "тисяч"],
      millionForms: ["мільйон", "мільйони", "мільйонів"],
      billionForms: ["мільярд", "мільярди", "мільярдів"],
      trillionForms: ["трильйон", "трильйони", "трильйонів"]
    }
    : {
      zero: "ноль",
      onesM: ["", "один", "два", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"],
      onesF: ["", "одна", "две", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"],
      teens: ["десять", "одиннадцать", "двенадцать", "тринадцать", "четырнадцать", "пятнадцать", "шестнадцать", "семнадцать", "восемнадцать", "девятнадцать"],
      tens: ["", "", "двадцать", "тридцать", "сорок", "пятьдесят", "шестьдесят", "семьдесят", "восемьдесят", "девяносто"],
      hundreds: ["", "сто", "двести", "триста", "четыреста", "пятьсот", "шестьсот", "семьсот", "восемьсот", "девятьсот"],
      thousandForms: ["тысяча", "тысячи", "тысяч"],
      millionForms: ["миллион", "миллиона", "миллионов"],
      billionForms: ["миллиард", "миллиарда", "миллиардов"],
      trillionForms: ["триллион", "триллиона", "триллионов"]
    };

  const tripleToWords = (value, tripleGender = "m") => {
    if (!value) return "";
    const h = Math.floor(value / 100);
    const t = Math.floor((value % 100) / 10);
    const u = value % 10;
    const parts = [];
    if (h) parts.push(dict.hundreds[h]);
    if (t === 1) {
      parts.push(dict.teens[u]);
    } else {
      if (t > 1) parts.push(dict.tens[t]);
      if (u) parts.push((tripleGender === "f" ? dict.onesF : dict.onesM)[u]);
    }
    return parts.join(" ");
  };

  if (num === 0) return dict.zero;

  const trillions = Math.floor(num / 1_000_000_000_000);
  const billions = Math.floor((num % 1_000_000_000_000) / 1_000_000_000);
  const millions = Math.floor((num % 1_000_000_000) / 1_000_000);
  const thousands = Math.floor((num % 1_000_000) / 1_000);
  const rest = num % 1_000;
  const parts = [];

  if (trillions) {
    parts.push(tripleToWords(trillions, "m"));
    parts.push(getSlavicPlural(trillions, dict.trillionForms));
  }
  if (billions) {
    parts.push(tripleToWords(billions, "m"));
    parts.push(getSlavicPlural(billions, dict.billionForms));
  }
  if (millions) {
    parts.push(tripleToWords(millions, "m"));
    parts.push(getSlavicPlural(millions, dict.millionForms));
  }
  if (thousands) {
    parts.push(tripleToWords(thousands, "f"));
    parts.push(getSlavicPlural(thousands, dict.thousandForms));
  }
  if (rest) {
    parts.push(tripleToWords(rest, gender));
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function expandFinancialTextPhonetically(text = "", lang = "ru") {
    let out = String(text || "");
    const rules = lang === "ru" ? {
        dollars: ["доллар", "доллара", "долларов"],
        cents: ["цент", "цента", "центов"],
        percents: ["процент", "процента", "процентов"]
    } : {
        dollars: ["долар", "долари", "доларів"],
        cents: ["цент", "центи", "центів"],
        percents: ["відсоток", "відсотки", "відсотків"]
    };

    // 1. Consolidate numbers first: "52 026 091" -> "52026091"
    out = out.replace(/\b(\d{1,3})[\s,](\d{3})[\s,](\d{3})\b/g, "$1$2$3");
    out = out.replace(/\b(\d{1,3})[\s,](\d{3})\b/g, "$1$2");

    // 2. Handle Currency Units
    out = out.replace(/(\d+)\s?(доларів|долларов)/g, (m, num) => {
        const n = parseInt(num, 10);
        return slavicNumberToWords(n, lang, "m") + " " + getSlavicPlural(n, rules.dollars);
    });
    out = out.replace(/(\d+)\s?(центів|центов)/g, (m, num) => {
        const n = parseInt(num, 10);
        return slavicNumberToWords(n, lang, "m") + " " + getSlavicPlural(n, rules.cents);
    });

    // 3. Handle Percentages (including decimal percentages like 0.19)
    out = out.replace(/([+-]?\d+[.,]\d+)\s?(відсотка|процента)/g, (m, raw, unit) => {
        const hasPlus = String(raw || "").trim().startsWith("+");
        const hasMinus = String(raw || "").trim().startsWith("-");
        const signWord = hasPlus ? "плюс" : (hasMinus ? (lang === "ru" ? "минус" : "мінус") : "");
        const normalized = String(raw || "").replace(",", ".");
        const [intPartRaw, fracPartRaw = ""] = normalized.split(".");
        const intPart = Number.parseInt(String(intPartRaw || "0").replace(/^[+-]/, ""), 10) || 0;
        const fracPart = (fracPartRaw || "").replace(/[^\d]/g, "").slice(0, 4);
        if (!fracPart) {
            const whole = slavicNumberToWords(intPart, lang, "m");
            return `${signWord ? `${signWord} ` : ""}${whole} ${unit}`;
        }
        const fracAsInt = Number.parseInt(fracPart, 10) || 0;
        const fracWords = slavicNumberToWords(fracAsInt, lang, "m");
        const wholeWords = slavicNumberToWords(intPart, lang, "m");
        return `${signWord ? `${signWord} ` : ""}${wholeWords} ${lang === "ru" ? "целых" : "цілих"} ${fracWords} ${lang === "ru" ? "сотых" : "сотих"} ${unit}`;
    });

    // 4. Handle integer Percentages
    out = out.replace(/(\d+)\s?(відсотків|процентов)/g, (m, num) => {
        const n = parseInt(num, 10);
        return slavicNumberToWords(n, lang, "m") + " " + getSlavicPlural(n, rules.percents);
    });

    // 5. Handle all other standalone numbers (except years)
    out = out.replace(/\b(\d{1,3}|\d{5,})\b/g, (m, num) => {
        const n = parseInt(num, 10);
        return slavicNumberToWords(n, lang, "m");
    });

    return out;
}



async function loadChatTtsSettings() {
  const rows = await query("SELECT value FROM app_settings WHERE key = $1 LIMIT 1", [CHAT_TTS_SETTINGS_KEY]);
  const raw = rows?.[0]?.value || {};
  const value = raw && typeof raw === "object" ? raw : {};
  return {
    voices: value.voices && typeof value.voices === "object" ? value.voices : { default: "nova", es: "shimmer", uk: "nova", ru: "nova" },
    models: value.models && typeof value.models === "object" ? value.models : { en: "tts-1", default: "tts-1-hd" },
    speed: value.speed && typeof value.speed === "object" ? value.speed : { default: 0.7 },
  };
}

function projectRowsToHeaders(rows = [], headers = []) {
  const allow = new Set((Array.isArray(headers) ? headers : []).map((h) => String(h)));
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const out = {};
    for (const key of Object.keys(row || {})) {
      if (allow.has(key)) out[key] = row[key];
    }
    return out;
  });
}

function applyRowFiltersInMemory(rows = [], rowFiltersList = []) {
  if (!Array.isArray(rowFiltersList) || !rowFiltersList.length) return Array.isArray(rows) ? rows : [];
  const hasAllowAll = rowFiltersList.some((f) => !f || Object.keys(f).length === 0);
  if (hasAllowAll) return Array.isArray(rows) ? rows : [];

  return (Array.isArray(rows) ? rows : []).filter((row) => {
    return rowFiltersList.some((group) => {
      const entries = Object.entries(group || {});
      if (!entries.length) return true;
      return entries.every(([col, rawVal]) => {
        const cell = String(row?.[col] ?? "").trim().toLowerCase();
        const vals = Array.isArray(rawVal)
          ? rawVal.map((v) => String(v ?? "").trim().toLowerCase()).filter(Boolean)
          : String(rawVal ?? "").split(",").map((v) => v.trim().toLowerCase()).filter(Boolean);
        return vals.includes(cell);
      });
    });
  });
}

export async function loadAccessibleRows(sheetId, user, activeTab = null, rowLimit = null) {
  const sheetRes = await query("SELECT headers, tabs, tab_name, semantic_profile FROM sheets WHERE id = $1", [sheetId]);
  if (!sheetRes.length) return { headers: [], tabs: [], rows: [], rowFiltersList: [], forbidden: true };
  const sheet = sheetRes[0];

  const isAdmin = isPlatformAdminUser(user);
  const hasFullAccess = isAdmin || await hasReportSourceOwnerAccess(sheetId, user.id);

  let validCols = null;
  let rowFiltersList = [];
  if (!hasFullAccess) {
    const { allPerms, validCols: loadedCols, rowFiltersList: loadedFilters } = await loadSheetPermissionSets(sheetId, user.id);
    if (!allPerms.length) return { headers: [], tabs: [], rows: [], rowFiltersList: [], forbidden: true };
    validCols = loadedCols;
    rowFiltersList = loadedFilters;
    if (!validCols.length) return { headers: [], tabs: [], rows: [], rowFiltersList: [], forbidden: true };
  }

  const params = [sheetId];
  let where = "WHERE sheet_id = $1";
  if (activeTab) {
    where += ` AND tab_name = $${params.length + 1}`;
    params.push(activeTab);
  }

  if (!hasFullAccess && rowFiltersList.length > 0) {
    const rf = buildRowFilterWhereClause(rowFiltersList, params.length + 1, sheet.headers || []);
    where += rf.sql;
    params.push(...rf.params);
  }

  let limitSql = "";
  if (Number.isFinite(Number(rowLimit)) && Number(rowLimit) > 0) {
    limitSql = ` LIMIT $${params.length + 1}`;
    params.push(Number(rowLimit));
  }

  const rowRes = await query(`SELECT row_data, tab_name FROM sheet_rows ${where} ORDER BY id ASC${limitSql}`, params);
  let rows = rowRes.map((r) => r.row_data || {});
  if (!hasFullAccess) rows = applyRowFiltersInMemory(rows, rowFiltersList);

  let headers = Array.isArray(sheet.headers) ? sheet.headers : [];
  if (!hasFullAccess) headers = headers.filter((h) => validCols.includes(h));
  rows = projectRowsToHeaders(rows, headers);

  return {
    headers,
    tabs: Array.isArray(sheet.tabs) ? sheet.tabs : [],
    rows,
    rowFiltersList,
    semanticProfile: sheet.semantic_profile || {},
    allowedColumns: headers,
    forbidden: false,
  };
}

async function synthesizeAudioBufferInternal({ text, locale, runtime = null }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !text) {
    const err = new Error("missing_params");
    err.code = "missing_params";
    throw err;
  }
  if (isAiGloballyDisabled(runtime)) {
    const err = new Error("global_ai_disabled");
    err.code = "global_ai_disabled";
    throw err;
  }
  const maxChars = Number(runtime?.chatAudioMaxChars || CHAT_AUDIO_MAX_CHARS);
  if (String(text).length > maxChars) {
    const err = new Error("text_too_large");
    err.code = "text_too_large";
    throw err;
  }

  const ttsCfg = await loadChatTtsSettings();
  const lang = String(locale || "en").split("-")[0].toLowerCase();
  const isRuUk = lang === "ru" || lang === "uk";
  const voice = String(isRuUk ? "nova" : (runtime?.chatAudioTtsVoice || ttsCfg?.voices?.[lang] || ttsCfg?.voices?.default || "nova"));
  const model = String(isRuUk
    ? "tts-1-hd"
    : (lang === "en"
      ? (runtime?.chatAudioTtsModelEn || ttsCfg?.models?.en || "tts-1")
      : (runtime?.chatAudioTtsModelDefault || ttsCfg?.models?.[lang] || ttsCfg?.models?.default || "tts-1")));
  const speed = isRuUk
    ? 0.9
    : (() => {
      const defaultSpeed = 0.8;
      const speedRaw = Number(runtime?.chatAudioTtsSpeed ?? ttsCfg?.speed?.[lang] ?? ttsCfg?.speed?.default ?? defaultSpeed);
      return Number.isFinite(speedRaw) && speedRaw > 0 ? speedRaw : defaultSpeed;
    })();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(runtime?.openaiTimeoutMs || OPENAI_TIMEOUT_MS));

  try {
    const response = await fetch(`${OPENAI_BASE_URL}/audio/speech`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({ model, input: normalizeTtsInput(text, locale), voice, speed }),
    });
    if (!response.ok) {
      const message = await response.text().catch(() => "");
      const err = new Error(message.slice(0, 300) || `upstream_status_${response.status}`);
      err.code = "tts_upstream_error";
      throw err;
    }
    const audioArrayBuffer = await response.arrayBuffer();
    return Buffer.from(audioArrayBuffer);
  } catch (e) {
    if (e?.code) throw e;
    const err = new Error(e?.name === "AbortError" ? "tts_timeout" : "internal_server_error");
    err.code = e?.name === "AbortError" ? "tts_timeout" : "internal_server_error";
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function synthesizeAudioStreamInternal({ text, locale, runtime = null }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !text) {
    const err = new Error("missing_params");
    err.code = "missing_params";
    throw err;
  }
  if (isAiGloballyDisabled(runtime)) {
    const err = new Error("global_ai_disabled");
    err.code = "global_ai_disabled";
    throw err;
  }
  const maxChars = Number(runtime?.chatAudioMaxChars || CHAT_AUDIO_MAX_CHARS);
  if (String(text).length > maxChars) {
    const err = new Error("text_too_large");
    err.code = "text_too_large";
    throw err;
  }

  const ttsCfg = await loadChatTtsSettings();
  const lang = String(locale || "en").split("-")[0].toLowerCase();
  const isRuUk = lang === "ru" || lang === "uk";
  const voice = String(isRuUk ? "nova" : (runtime?.chatAudioTtsVoice || ttsCfg?.voices?.[lang] || ttsCfg?.voices?.default || "nova"));
  const model = String(isRuUk
    ? "tts-1-hd"
    : (lang === "en"
      ? (runtime?.chatAudioTtsModelEn || ttsCfg?.models?.en || "tts-1")
      : (runtime?.chatAudioTtsModelDefault || ttsCfg?.models?.[lang] || ttsCfg?.models?.default || "tts-1")));
  const speed = isRuUk
    ? 0.9
    : (() => {
      const defaultSpeed = 0.8;
      const speedRaw = Number(runtime?.chatAudioTtsSpeed ?? ttsCfg?.speed?.[lang] ?? ttsCfg?.speed?.default ?? defaultSpeed);
      return Number.isFinite(speedRaw) && speedRaw > 0 ? speedRaw : defaultSpeed;
    })();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(runtime?.openaiTimeoutMs || OPENAI_TIMEOUT_MS));

  try {
    const response = await fetch(`${OPENAI_BASE_URL}/audio/speech`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({ model, input: normalizeTtsInput(text, locale), voice, speed }),
    });
    if (!response.ok) {
      const message = await response.text().catch(() => "");
      const err = new Error(message.slice(0, 300) || `upstream_status_${response.status}`);
      err.code = "tts_upstream_error";
      throw err;
    }
    if (!response.body) {
      const err = new Error("tts_empty_response");
      err.code = "tts_upstream_error";
      throw err;
    }
    return { response, controller, timeout };
  } catch (e) {
    clearTimeout(timeout);
    if (e?.code) throw e;
    const err = new Error(e?.name === "AbortError" ? "tts_timeout" : "internal_server_error");
    err.code = e?.name === "AbortError" ? "tts_timeout" : "internal_server_error";
    throw err;
  }
}

export async function synthesizeChatAudioBuffer({ text, locale, runtime = null }) {
  return synthesizeAudioBufferInternal({ text, locale, runtime });
}

export async function getChatAudio(req, res) {
  const { text, locale, sheetId = null } = req.body || {};
  if (!text) return res.status(400).json(aiError("missing_params"));

  let runtime = null;
  let globalRuntime = null;
  if (sheetId) {
    const hasAccess = await checkSheetAccess(sheetId, req.user);
    if (!hasAccess) return res.status(403).json(aiError("Forbidden"));

    const isAdmin = isPlatformAdminUser(req.user);
    const resolvedGroupId = isAdmin ? null : await resolveAiGroupIdForSheet({ sheetId, user: req.user });
    const fallbackGroupId = await resolveRuntimeGroupIdForUser(req.user);
    const runtimeGroupId = isAdmin ? null : (resolvedGroupId || fallbackGroupId || null);

    const effective = await loadEffectiveAiRuntimeSettings(runtimeGroupId || null);
    runtime = effective.runtime;
    globalRuntime = effective.globalRuntime;

    if (isAiGloballyDisabled(globalRuntime) || isAiGloballyDisabled(runtime)) {
      return res.status(403).json(aiError("global_ai_disabled"));
    }
    if (!(runtime?.chatAudioEnabled === true || globalRuntime?.chatAudioEnabled === true)) {
      return res.status(403).json(aiError("chat_audio_disabled"));
    }

    try {
      await reserveAiQueryForSheet({ sheetId, user: req.user, kind: "chat_audio" });
    } catch (err) {
      return res.status(err.statusCode || 429).json(aiError(err.message, err.details || {}));
    }
  }

  if (!runtime) runtime = await loadAiRuntimeSettings(null);
  if (!globalRuntime) globalRuntime = await loadAiRuntimeSettings(null);

  if (isAiGloballyDisabled(globalRuntime) || isAiGloballyDisabled(runtime)) {
    return res.status(403).json(aiError("global_ai_disabled"));
  }

  try {
    const { response, controller, timeout } = await synthesizeAudioStreamInternal({ text, locale, runtime });
    res.setHeader("Content-Type", response.headers.get("content-type") || "audio/mpeg");
    res.setHeader("Transfer-Encoding", "chunked");

    const stream = Readable.fromWeb(response.body);
    req.on("close", () => {
      try { controller.abort(); } catch (_) {}
    });
    stream.on("end", () => clearTimeout(timeout));
    stream.on("error", () => clearTimeout(timeout));
    stream.pipe(res);
    return;
  } catch (e) {
    const errorCode = e?.code || "internal_server_error";
    const status = errorCode === "global_ai_disabled" ? 403
      : errorCode === "text_too_large" ? 413
      : errorCode === "tts_timeout" ? 504
      : errorCode === "tts_upstream_error" ? 502
      : 500;
    return res.status(status).json(aiError(errorCode));
  }
}

export async function submitChatLearningFeedback(req, res) {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const question = String(body.question || "").trim();
    const badAnswer = String(body.badAnswer || "").trim();
    const expectedAnswer = String(body.expectedAnswer || "").trim();
    const sheetId = body.sheetId ? String(body.sheetId).trim() : null;
    const locale = String(body.locale || "en").trim().toLowerCase().slice(0, 10);
    const context = body.context && typeof body.context === "object" ? body.context : {};
    const successfulPlan = body.plan && typeof body.plan === "object" ? body.plan : null;

    if (!question || !expectedAnswer) return res.status(400).json(aiError("missing_feedback_fields"));
    if (sheetId) {
      const hasAccess = await checkSheetAccess(sheetId, req.user);
      if (!hasAccess) return res.status(403).json(aiError("Forbidden"));
    }

    const rows = await query(
      `INSERT INTO ai_learning_feedback
         (sheet_id, user_id, locale, question, bad_answer, expected_answer, context, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 'pending')
       RETURNING id, status, created_at`,
      [sheetId, Number(req.user?.id || 0) || null, locale, question, badAnswer, expectedAnswer, JSON.stringify({ ...context, successfulPlan })]
    );

    return res.json({ success: true, feedbackId: rows?.[0]?.id, status: rows?.[0]?.status, createdAt: rows?.[0]?.created_at });
  } catch (err) {
    return res.status(500).json(aiError("feedback_store_failed", { message: String(err?.message || "internal_server_error") }));
  }
}
