import { safeDivide } from "../../accounting/numeric.js";

export const MARKETING_METRICS = {
  ctr: { domain: "marketing", key: "ctr", label: "CTR", formula: "clicks/impressions*100", outputType: "percent", required: [["clicks","impressions"]], safetyLevel: "normal", calculate: ({ sums }) => { const d = safeDivide(sums.clicks, sums.impressions); return d.ok ? { value: d.value * 100 } : { value: null, note: "Impressions denominator is zero" }; } },
  cpc: { domain: "marketing", key: "cpc", label: "CPC", formula: "spend/clicks", outputType: "currency", required: [["spend","clicks"]], safetyLevel: "normal", calculate: ({ sums }) => { const d = safeDivide(sums.spend, sums.clicks); return d.ok ? { value: d.value } : { value: null, note: "Clicks denominator is zero" }; } },
  roas: { domain: "marketing", key: "roas", label: "ROAS", formula: "revenue/spend", outputType: "number", required: [["revenue","spend"]], safetyLevel: "normal", calculate: ({ sums }) => { const d = safeDivide(sums.revenue, sums.spend); return d.ok ? { value: d.value } : { value: null, note: "Spend denominator is zero" }; } },
};
