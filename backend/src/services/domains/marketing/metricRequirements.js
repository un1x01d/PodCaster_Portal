export const MARKETING_METRIC_REQUIREMENTS = {
  ctr: { required: [["clicks", "impressions"]], optional: ["campaign", "channel", "date"] },
  cpc: { required: [["spend", "clicks"]], optional: ["campaign", "channel", "date"] },
  cpm: { required: [["spend", "impressions"]], optional: ["campaign", "channel", "date"] },
  conversion_rate: { required: [["conversions", "clicks"]], optional: ["campaign", "channel", "date"] },
  cost_per_lead: { required: [["spend", "leads"]], optional: ["campaign", "channel", "date"] },
  cost_per_conversion: { required: [["spend", "conversions"]], optional: ["campaign", "channel", "date"] },
  roas: { required: [["revenue", "spend"]], optional: ["campaign", "channel", "date"] },
  marketing_roi: { required: [["revenue", "spend"]], optional: ["campaign", "channel", "date"] },
  cac: { required: [["spend", "new_customers"]], optional: ["campaign", "channel", "date"] },
};
