import { getSemanticKnowledge } from "./semanticKnowledgeService.js";

export const ACCOUNTING_GLOSSARY = {
  revenue: ["revenue", "sales", "income", "turnover", "top line"],
  gross_revenue: ["gross revenue", "gross sales", "total sales before returns"],
  net_revenue: ["net revenue", "net sales", "sales after returns", "recognized revenue"],
  cogs: ["cogs", "cost of goods sold", "cost of sales", "product cost", "direct cost"],
  gross_profit: ["gross profit", "gross income"],
  gross_margin_pct: ["gross margin", "gross margin %", "gross margin percent"],
  expenses: ["expense", "expenses", "operating expense", "opex", "costs", "spend"],
  net_income: ["net income", "net profit", "bottom line", "earnings"],
  ar: ["ar", "accounts receivable", "receivables", "a/r"],
  ap: ["ap", "accounts payable", "payables", "a/p"],
  cash: ["cash", "cash balance", "cash on hand", "bank balance"],
  budget: ["budget", "budgeted", "plan"],
  actual: ["actual", "actuals", "realized"],
  variance: ["variance", "delta", "difference", "gap"],
  date: ["date", "transaction date", "posting date", "period", "month", "year"],
  customer: ["customer", "client", "account name"],
  vendor: ["vendor", "supplier"],
  store: ["store", "location", "branch"],
  region: ["region", "territory", "area"],
  category: ["category", "product category", "segment"],
  department: ["department", "cost center", "business unit"],
  account: ["account", "gl account", "ledger account", "account code"],
};

const AMBIGUOUS_WORDS = {
  profit: ["gross_profit", "net_income"],
  sales: ["gross_revenue", "net_revenue"],
  cost: ["cogs", "expenses"],
};

export function normalizeText(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function findRequestedCanonicalTerms(message = "") {
  const normalized = normalizeText(message);
  const found = new Set();
  
  // Hardcoded glossary
  Object.entries(ACCOUNTING_GLOSSARY).forEach(([key, synonyms]) => {
    if (synonyms.some((term) => normalized.includes(normalizeText(term)))) {
      found.add(key);
    }
  });

  // Database knowledge
  try {
    const knowledge = await getSemanticKnowledge();
    Object.entries(knowledge).forEach(([key, synonyms]) => {
      if (synonyms.some((term) => normalized.includes(normalizeText(term)))) {
        found.add(key);
      }
    });
  } catch (e) {
    console.error("findRequestedCanonicalTerms DB check failed:", e);
  }

  return Array.from(found);
}

export function detectAmbiguousAccountingWords(message = "") {
  const normalized = normalizeText(message);
  const out = [];
  Object.entries(AMBIGUOUS_WORDS).forEach(([word, options]) => {
    if (normalized.split(" ").includes(word)) out.push({ word, options });
  });
  return out;
}

