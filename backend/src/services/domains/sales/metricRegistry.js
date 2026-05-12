import { safeDivide } from "../../accounting/numeric.js";

export const SALES_METRICS = {
  total_sales: { domain: "sales", key: "total_sales", label: "Total Sales", formula: "SUM(revenue)", outputType: "currency", required: [["revenue"]], safetyLevel: "normal", calculate: ({ sums }) => ({ value: sums.revenue }) },
  quota_attainment_pct: { domain: "sales", key: "quota_attainment_pct", label: "Quota Attainment %", formula: "revenue/quota*100", outputType: "percent", required: [["revenue","quota"]], safetyLevel: "normal", calculate: ({ sums }) => { const d = safeDivide(sums.revenue, sums.quota); return d.ok ? { value: d.value * 100 } : { value: null, note: "Quota denominator is zero" }; } },
  pipeline_total: { domain: "sales", key: "pipeline_total", label: "Pipeline Total", formula: "SUM(pipeline_value)", outputType: "currency", required: [["pipeline_value"]], safetyLevel: "normal", calculate: ({ sums }) => ({ value: sums.pipeline_value }) },
};
