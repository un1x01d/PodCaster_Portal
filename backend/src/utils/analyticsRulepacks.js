const DOMAIN_SPECS = {
  revenue_profit: {
    baseTrigger: ["revenue", "profit", "margin", "yoy", "growth", "run rate"],
    requiredCols: [["Revenue Total"], ["Profit Total"], ["Date", "Start Date", "Invoice Date", "Paid Date"]],
    op: "sum",
  },
  cost: {
    baseTrigger: ["cost", "expense", "overhead", "burn", "variance", "budget"],
    requiredCols: [["Cost Total"], ["Cost Labor", "Cost Expense", "Cost Overhead"], ["Date", "Start Date", "Invoice Date", "Paid Date"]],
    op: "sum",
  },
  pipeline_sales: {
    baseTrigger: ["pipeline", "sales", "win rate", "conversion", "stage", "cycle"],
    requiredCols: [["Net Revenue", "Revenue Total"], ["Project Status", "Invoice Status"], ["Date", "Start Date", "Invoice Date"]],
    op: "top_n",
  },
  billing_collections: {
    baseTrigger: ["billing", "invoice", "collections", "aging", "dso", "payment terms"],
    requiredCols: [["Invoice Date", "Paid Date"], ["Invoice Status"], ["Revenue Total", "Net Revenue"]],
    op: "sum",
  },
  data_quality_semantic: {
    baseTrigger: ["data quality", "mapping", "semantic", "missing", "null", "type"],
    requiredCols: [["Customer Name", "Customer Id"], ["Revenue Total", "Profit Total", "Cost Total"], ["Date", "Start Date", "Invoice Date", "Paid Date"]],
    op: "none",
  },
};

function mkRule(domain, i) {
  const spec = DOMAIN_SPECS[domain];
  const n = i + 1;
  const rid = `${domain}_rule_${String(n).padStart(2, "0")}`;
  const mode = n <= 10 ? "aggregation" : (n <= 20 ? "ranking" : (n <= 30 ? "trend" : (n <= 40 ? "diagnostic" : "fallback")));
  const trigger = [...spec.baseTrigger, `${domain.replaceAll("_", " ")} ${n}`];
  const operation = mode === "ranking" ? "top_n" : (mode === "trend" ? "year_over_year" : spec.op);
  const outputShape = mode === "trend"
    ? "yoy_lines_with_summary"
    : mode === "ranking"
      ? "top_list_with_metric"
      : mode === "diagnostic"
        ? "diagnostic_contract"
        : "single_or_grouped_metric";
  const domainText = {
    revenue_profit: "Prioritize Revenue Total/Net Revenue/Profit Total metrics, enforce numeric cleanup, and include YoY deltas when a time intent is present.",
    cost: "Prioritize Cost Total and cost components, support variance framing (actual vs baseline), and keep overhead/labor/expense split explicit.",
    pipeline_sales: "Prioritize stage/status dimensions, conversion-style rankings, and revenue contribution by owner/region/type.",
    billing_collections: "Prioritize invoice and payment dates, invoice status aging views, and paid-vs-invoiced reconciliation metrics.",
    data_quality_semantic: "Prioritize mapping confidence, null/type diagnostics, and safe fallback without inventing fields.",
  }[domain];
  const modeText = {
    aggregation: "Return scalar or grouped totals with explicit metric/date context.",
    ranking: "Return ranked entities with deterministic sort and tie-safe labeling.",
    trend: "Return full consecutive-year comparisons, not single-pair truncation.",
    diagnostic: "If no data, return matched columns, row counts, and detected year range.",
    fallback: "Retry with fuzzy aliases and alternative date columns before final failure.",
  }[mode];

  return {
    id: rid,
    title: `${domain.replaceAll("_", " ")} rule ${n}`,
    status: "active",
    priority: n,
    domain,
    trigger,
    requiredColumnsAnyOf: spec.requiredCols,
    operation,
    fallback: {
      retryWithAlternativeDateColumns: true,
      emitDiagnosticsOnNoData: true,
      fuzzyColumnMatching: true,
      numericCleanup: true,
    },
    output: {
      shape: outputShape,
      includeContext: true,
      includeAppliedColumns: n % 2 === 0,
    },
    ruleText: `${domainText} ${modeText} Apply rule variant ${n} with priority ${n}.`,
  };
}

function buildDomain(domain) {
  return Array.from({ length: 50 }, (_, i) => mkRule(domain, i));
}

export function buildAnalyticsRulepacks() {
  return Object.keys(DOMAIN_SPECS).reduce((acc, domain) => {
    acc[domain] = buildDomain(domain);
    return acc;
  }, {});
}

export function buildValidationRules() {
  return [
    { id: "val_001", check: "year_by_year_forces_yoy", severity: "error" },
    { id: "val_002", check: "yoy_requires_metric", severity: "error" },
    { id: "val_003", check: "yoy_requires_year_dimension", severity: "error" },
    { id: "val_004", check: "single_year_total_requires_year_filter", severity: "warn" },
    { id: "val_005", check: "top_n_requires_group_by", severity: "error" },
    { id: "val_006", check: "top_n_requires_metric", severity: "error" },
    { id: "val_007", check: "customer_label_cannot_be_date_like", severity: "warn" },
    { id: "val_008", check: "numeric_metric_parseable", severity: "error" },
    { id: "val_009", check: "fallback_diagnostics_on_no_data", severity: "warn" },
    { id: "val_010", check: "dont_invent_columns", severity: "error" },
  ];
}

export function pickRelevantRules(rulepacks = {}, message = "", maxRules = 20) {
  const text = String(message || "").toLowerCase();
  const all = Object.values(rulepacks || {}).flatMap((v) => (Array.isArray(v) ? v : []));
  const scored = all
    .map((r) => {
      const triggers = Array.isArray(r?.trigger) ? r.trigger : [];
      const score = triggers.reduce((acc, t) => acc + (text.includes(String(t).toLowerCase()) ? 1 : 0), 0);
      return { r, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => (b.score - a.score) || (a.r.priority - b.r.priority))
    .slice(0, Math.max(1, Number(maxRules || 20)));
  return scored.map((x) => x.r);
}

export function compactRulesForPrompt(rules = []) {
  return (Array.isArray(rules) ? rules : []).map((r) => ({
    id: r.id,
    domain: r.domain,
    operation: r.operation,
    requiredColumnsAnyOf: r.requiredColumnsAnyOf,
    ruleText: r.ruleText,
    output: r.output,
  }));
}

export function validateRulesAgainstHeaders(rules = [], headers = []) {
  const cols = new Set((Array.isArray(headers) ? headers : []).map((h) => String(h || "").toLowerCase()));
  const out = [];
  for (const rule of Array.isArray(rules) ? rules : []) {
    const groups = Array.isArray(rule?.requiredColumnsAnyOf) ? rule.requiredColumnsAnyOf : [];
    const missingGroups = groups.filter((group) => {
      const g = Array.isArray(group) ? group : [];
      return !g.some((name) => cols.has(String(name || "").toLowerCase()));
    });
    out.push({
      id: rule?.id || "unknown_rule",
      operation: rule?.operation || "none",
      status: missingGroups.length ? "missing_required_columns" : "ok",
      missingGroups,
    });
  }
  return out;
}
