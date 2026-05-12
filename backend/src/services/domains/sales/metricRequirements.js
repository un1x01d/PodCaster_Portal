export const SALES_METRIC_REQUIREMENTS = {
  total_sales: { required: [["revenue"]], optional: ["sales_rep", "region", "date"] },
  bookings: { required: [["booking_amount"]], optional: ["sales_rep", "region", "date"] },
  average_deal_size: { required: [["revenue", "deal"], ["booking_amount", "deal"]], optional: ["sales_rep", "region", "date"] },
  win_rate: { required: [["closed_won", "closed_lost"], ["deal_stage"]], optional: ["sales_rep", "region", "date"] },
  pipeline_total: { required: [["pipeline_value"]], optional: ["sales_rep", "region", "date"] },
  quota_attainment_pct: { required: [["revenue", "quota"]], optional: ["sales_rep", "region", "date"] },
  sales_growth_pct: { required: [["revenue", "date"]], optional: ["sales_rep", "region", "product"] },
  sales_cycle_days: { required: [["created_date", "close_date"]], optional: ["sales_rep", "region"] },
  revenue_by_rep: { required: [["revenue", "sales_rep"]], optional: ["region", "date"] },
  revenue_by_region: { required: [["revenue", "region"]], optional: ["sales_rep", "date"] },
};
