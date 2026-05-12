import { safeDivide } from "../../accounting/numeric.js";

export const TAX_METRICS = {
  total_tax_collected: { domain: "tax", key: "total_tax_collected", label: "Total Tax Collected", formula: "SUM(tax_amount)", outputType: "currency", required: [["tax_amount"]], safetyLevel: "tax_sensitive", calculate: ({ sums }) => ({ value: sums.tax_amount }) },
  taxable_sales_total: { domain: "tax", key: "taxable_sales_total", label: "Taxable Sales Total", formula: "SUM(taxable_sales)", outputType: "currency", required: [["taxable_sales"]], safetyLevel: "tax_sensitive", calculate: ({ sums }) => ({ value: sums.taxable_sales }) },
  effective_tax_rate: { domain: "tax", key: "effective_tax_rate", label: "Effective Tax Rate", formula: "tax_amount/taxable_sales*100", outputType: "percent", required: [["tax_amount","taxable_sales"]], safetyLevel: "tax_sensitive", calculate: ({ sums }) => { const d = safeDivide(sums.tax_amount, sums.taxable_sales); return d.ok ? { value: d.value * 100 } : { value: null, note: "Taxable sales denominator is zero" }; } },
};
