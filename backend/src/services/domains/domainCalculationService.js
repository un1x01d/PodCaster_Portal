import { safeSum, roundCurrency, roundPercent, safeDivide } from "../accounting/numeric.js";
import { filterRowsByPeriod, normalizePeriod } from "../accounting/periodFilter.js";
import { getDomainMetric } from "./domainRegistry.js";

export function runDomainDeterministicCalculation({ domain, metricKey, rows = [], headerResolution, period = null, userContext = {} }) {
  const def = getDomainMetric(domain, metricKey);
  if (!def) return { ok: false, errorCode: "UNKNOWN_METRIC", message: `Unknown metric ${metricKey}` };
  if (!headerResolution?.ok) return { ok: false, errorCode: "HEADER_RESOLUTION_FAILED", message: "Header resolution failed" };

  const headerMap = Object.fromEntries(Object.entries(headerResolution.requiredMappings || {}).map(([k,v]) => [k, v.header]));
  for (const h of Object.values(headerMap)) {
    if (Array.isArray(userContext?.allowedColumns) && !userContext.allowedColumns.includes(h)) {
      return { ok: false, errorCode: "UNAUTHORIZED_OR_MISSING_COLUMNS", message: `Unauthorized column: ${h}` };
    }
  }

  let working = Array.isArray(rows) ? rows : [];
  let periodOut = normalizePeriod(period);
  if (periodOut && headerMap.date) {
    working = filterRowsByPeriod(working, headerMap.date, periodOut).rows;
  }

  const sums = {};
  Object.entries(headerMap).forEach(([k,h]) => {
    sums[k] = safeSum(working, h).value;
  });

  const calc = def.calculate({ sums, headersUsed: headerMap, safeDivide });
  const value = def.outputType === "percent" ? roundPercent(calc.value) : (def.outputType === "number" ? roundCurrency(calc.value) : roundCurrency(calc.value));
  const notes = [];
  if (calc?.note) notes.push(calc.note);
  if (def.safetyLevel === "tax_sensitive") notes.push("This is a spreadsheet summary, not legal tax advice.");
  if (def.safetyLevel === "advisory_sensitive") notes.push("This is educational analysis, not investment advice.");

  return {
    ok: true,
    domain,
    metric: metricKey,
    label: def.label,
    formula: def.formula,
    value,
    outputType: def.outputType,
    headersUsed: headerMap,
    rowCount: working.length,
    period: periodOut,
    notes,
    safetyLevel: def.safetyLevel || "normal",
  };
}
