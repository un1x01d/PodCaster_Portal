import { resolveField } from "../ai/fieldResolver.js";

const CANON_BRIDGE = {
  revenue: "total_revenue",
  expenses: "total_expense",
  tax_amount: "tax_amount",
  taxable_sales: "taxable_sales",
};

function resolverKey(f) { return CANON_BRIDGE[f] || f; }

export function resolveDomainHeaders({ requiredSets = [], optional = [], headers = [], fieldMetadata = {}, message = "" }) {
  let selected = null;
  const requiredMappings = {};
  const missingRequired = [];
  const ambiguous = [];

  for (const set of requiredSets) {
    const miss = [];
    const amb = [];
    const map = {};
    for (const f of set) {
      const out = resolveField({ canonicalField: resolverKey(f), headers, fieldMetadata, message });
      if (out.status === "resolved") map[f] = { header: out.header, confidence: out.confidence, matchType: out.method };
      else if (out.status === "ambiguous" || out.status === "ask_followup") amb.push({ field: f, ...out });
      else miss.push(f);
    }
    if (!miss.length && !amb.length) { selected = set; Object.assign(requiredMappings, map); break; }
  }

  if (!selected) return { ok: false, missingRequired: missingRequired, ambiguous };

  const optionalMappings = {};
  const missingOptional = [];
  for (const f of optional) {
    const out = resolveField({ canonicalField: resolverKey(f), headers, fieldMetadata, message });
    if (out.status === "resolved") optionalMappings[f] = { header: out.header, confidence: out.confidence, matchType: out.method };
    else missingOptional.push(f);
  }

  return { ok: true, selectedRequiredFieldSet: selected, requiredMappings, optionalMappings, missingOptional, ambiguous: [] };
}
