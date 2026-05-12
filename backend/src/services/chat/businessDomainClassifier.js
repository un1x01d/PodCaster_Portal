import { z } from "zod";

const DomainResultSchema = z.object({
  domains: z.array(z.enum(["accounting", "finance", "tax", "marketing", "sales", "general_business", "unsupported"])),
  primary_domain: z.enum(["accounting", "finance", "tax", "marketing", "sales", "general_business", "unsupported"]),
  intent: z.string(),
  requires_data: z.boolean(),
  requires_calculation: z.boolean(),
  safe_next_action: z.string(),
  confidence: z.enum(["low", "medium", "high"]),
  riskLevel: z.enum(["low", "medium", "high"]).optional(),
});

export function classifyBusinessDomain(message = "") {
  const s = String(message || "").toLowerCase();
  const scores = { accounting: 0, finance: 0, tax: 0, marketing: 0, sales: 0 };

  if (/gross margin|profit|net income|expense|cogs|p&l|ledger|accounting|revenue drop/.test(s)) scores.accounting += 2;
  if (/cash flow|working capital|current ratio|quick ratio|debt|equity|runway|burn rate|ebitda|free cash flow|cash down/.test(s)) scores.finance += 3;
  if (/sales tax|\btax\b|vat|gst|taxable|jurisdiction|filing|effective tax rate/.test(s)) scores.tax += 4;
  if (/campaign|roas|cpc|ctr|conversions|ad spend|marketing|channel|attributed revenue/.test(s)) scores.marketing += 3;
  if (/sales rep|quota|pipeline|closed won|deal|bookings|win rate|\bsales\b/.test(s)) scores.sales += 2;
  if (/why did revenue drop|revenue drop/.test(s)) { scores.accounting += 2; scores.sales += 2; scores.marketing += 1; }

  if (/sales tax/.test(s)) scores.sales = Math.max(0, scores.sales - 2);
  if (/which campaign had the best roas/.test(s)) scores.marketing += 2;

  const ranked = Object.entries(scores).filter(([,v]) => v > 0).sort((a,b) => b[1]-a[1]).map(([k]) => k);
  const domains = ranked.length ? ranked : ["general_business"];
  const primary = domains[0];

  let safe_next_action = "route_to_domain_analyzer";
  let riskLevel = domains.includes("tax") ? "medium" : "low";
  if (/owe|legally|file|should i collect|liability/.test(s) && domains.includes("tax")) {
    safe_next_action = "tax_not_enabled";
    riskLevel = "high";
  }
  if (domains.includes("tax")) {
    safe_next_action = "tax_not_enabled";
  }
  if (domains.includes("accounting") && domains.includes("sales") && /revenue/.test(s) && /drop/.test(s)) {
    safe_next_action = "ask_followup";
  }

  return DomainResultSchema.parse({
    domains,
    primary_domain: primary,
    intent: "analyze_business_question",
    requires_data: true,
    requires_calculation: true,
    safe_next_action,
    confidence: ranked.length ? "high" : "medium",
    riskLevel,
  });
}
