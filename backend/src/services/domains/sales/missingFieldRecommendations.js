export function salesMissingFieldRecommendations(missing = []) {
  return missing.map((m) => ({
    sales_rep: "Sales Rep",
    revenue: "Revenue / Bookings",
    quota: "Quota",
    pipeline_value: "Pipeline Value",
    closed_won: "Closed Won",
    closed_lost: "Closed Lost",
    date: "Date",
  }[m] || m));
}
