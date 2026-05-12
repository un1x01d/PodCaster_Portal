export const MARKETING_COMPLEX_QUESTION_REQUIREMENTS = {
  marketing_campaign_performance: {
    minimumRequiredFieldSets: [["campaign", "revenue"], ["campaign", "conversions"], ["campaign", "leads"]],
    optionalFields: ["channel", "spend", "clicks", "date"],
  },
  marketing_roas_driver_analysis: {
    minimumRequiredFieldSets: [["revenue", "spend", "date"]],
    optionalFields: ["campaign", "channel", "clicks", "conversions", "leads"],
  },
  marketing_channel_performance: {
    minimumRequiredFieldSets: [["channel", "spend", "revenue"], ["channel", "spend", "conversions"], ["channel", "spend", "leads"]],
    optionalFields: ["campaign", "date"],
  },
};
