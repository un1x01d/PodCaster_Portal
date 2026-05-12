import { classifyMetricFamily, resolveMetricFromContract } from "./semanticContract.js";

export function classifyIntentClass(message = "") {
  const s = String(message || "").toLowerCase();
  const years = Array.from(s.matchAll(/\b(19\d{2}|20\d{2})\b/g), (m) => Number(m?.[0])).filter(Number.isFinite);
  const uniqYears = Array.from(new Set(years));
  const hasDriver = /\b(top|biggest|largest|highest|driver|contributor)\b|топ|драйвер/i.test(s);
  const hasYoy = /\b(yoy|year over year|year-over-year|year by year|annual trend)\b|г\/г|р\/р|рік до року/i.test(s);
  const hasDiff = /\b(difference|delta|compare|comparison|between|vs|versus)\b/i.test(s);
  const hasTotal = /\b(total|sum|what was|how much)\b|сумм|всього/i.test(s);

  if (hasDiff && uniqYears.length === 2) return "year_pair_delta";
  if (hasYoy || uniqYears.length >= 3) return "yoy_series";
  if (hasDriver) return "ranking";
  if (uniqYears.length === 1) return "single_year";
  if (hasTotal) return "scalar_total";
  return "unknown";
}

export function compileQueryPlan({ message = "", contract = {}, priorContext = {} }) {
  const intentClass = classifyIntentClass(message);
  const metricFamily = classifyMetricFamily(message) || priorContext?.metricFamily || "unknown";
  const metric = resolveMetricFromContract(contract, metricFamily);
  const years = Array.from(String(message || "").matchAll(/\b(19\d{2}|20\d{2})\b/g), (m) => Number(m?.[0])).filter(Number.isFinite);
  const uniqYears = Array.from(new Set(years)).sort((a, b) => a - b);
  return {
    intentClass,
    metricFamily,
    metric,
    years: uniqYears,
    dateColumn: contract?.time?.primaryDate || null,
    yearColumn: contract?.time?.yearCol || null,
    rankingDimension: contract?.dimensions?.customer || contract?.dimensions?.project || contract?.dimensions?.businessUnit || null,
  };
}
