export function marketingMissingFieldRecommendations(missing = []) {
  return missing.map((m) => ({
    campaign: "Campaign",
    spend: "Ad Spend / Marketing Spend",
    revenue: "Attributed Revenue",
    clicks: "Clicks",
    impressions: "Impressions",
    conversions: "Conversions",
    leads: "Leads",
  }[m] || m));
}
