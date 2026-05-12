export function classifyMetricFamily(text = "") {
  const s = String(text || "").toLowerCase();
  if (/\b(revenue|sales|income|turnover)\b|выручк|доход|дохід|продаж/i.test(s)) return "revenue";
  if (/\b(expense|cost|spend|cogs|opex)\b|расход|витрат/i.test(s)) return "expense";
  if (/\b(profit|margin|ebit|ebitda)\b|прибут|прибыл/i.test(s)) return "profit";
  return "unknown";
}

export function buildSemanticContract(headers = []) {
  const list = Array.isArray(headers) ? headers.map((h) => String(h || "")) : [];
  const firstMatch = (patterns = []) => {
    for (const rx of patterns) {
      const hit = list.find((h) => rx.test(h));
      if (hit) return hit;
    }
    return null;
  };

  const metrics = {
    revenue: firstMatch([/net\s*revenue/i, /revenue\s*total/i, /^revenue$/i, /\bsales\b/i, /\bincome\b/i]),
    expense: firstMatch([/expense\s*billed/i, /^expense$/i, /cost\s*total/i, /\bcost\b/i, /\bopex\b/i]),
    profit: firstMatch([/profit\s*total/i, /\bnet\s*profit\b/i, /\bgross\s*profit\b/i, /\bprofit\b/i, /\bmargin\b/i]),
  };

  const time = {
    primaryDate: firstMatch([/^start date$/i, /^invoice date$/i, /^end date$/i, /^paid date$/i, /\bdate\b/i, /\bperiod\b/i]),
    yearCol: firstMatch([/\byear\b/i, /рік|год/i]),
  };

  const dimensions = {
    customer: firstMatch([/^customer name$/i, /\bcustomer\b/i, /\bclient\b/i, /\baccount\b/i]),
    project: firstMatch([/^project name$/i, /\bproject\b/i]),
    businessUnit: firstMatch([/^business unit$/i, /\bbusiness unit\b/i]),
  };

  return { metrics, time, dimensions, headers: list };
}

export function resolveMetricFromContract(contract = {}, requestedFamily = "unknown") {
  if (!contract || typeof contract !== "object") return null;
  if (requestedFamily === "revenue") return contract?.metrics?.revenue || null;
  if (requestedFamily === "expense") return contract?.metrics?.expense || null;
  if (requestedFamily === "profit") return contract?.metrics?.profit || null;
  return contract?.metrics?.revenue || contract?.metrics?.profit || contract?.metrics?.expense || null;
}
