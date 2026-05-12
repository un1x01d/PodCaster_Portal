export const SALES_COMPLEX_QUESTION_REQUIREMENTS = {
  sales_rep_performance: {
    minimumRequiredFieldSets: [["sales_rep", "revenue"], ["sales_rep", "booking_amount"], ["sales_rep", "quota"]],
    optionalFields: ["pipeline_value", "closed_won", "closed_lost", "region"],
  },
  sales_revenue_drop_analysis: {
    minimumRequiredFieldSets: [["revenue", "date"]],
    optionalFields: ["sales_rep", "region", "product", "customer", "deal_stage"],
  },
  sales_quota_attainment: {
    minimumRequiredFieldSets: [["revenue", "quota", "date"], ["booking_amount", "quota", "date"]],
    optionalFields: ["forecast", "pipeline_value", "sales_rep", "region"],
  },
};
