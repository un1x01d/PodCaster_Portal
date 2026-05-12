import { COMPLEX_QUESTION_REQUIREMENTS } from "./complexQuestionRequirements.js";

const LABELS = {
  revenue: "Revenue / Net Sales",
  expenses: "Expenses / Total Expenses",
  cogs: "COGS / Product Cost",
  discounts: "Discounts",
  returns: "Returns",
  category: "Category / GL Account / Department",
  account: "GL Account",
  department: "Department",
  store: "Store",
  region: "Region",
  budget: "Budget",
  actual: "Actual",
  date: "Month / Period",
};

export function recommendMissingFields(questionType, missing = []) {
  const req = COMPLEX_QUESTION_REQUIREMENTS[questionType];
  const rec = req?.missingFieldRecommendations || [];
  const keys = Array.from(new Set([...(missing || []), ...rec]));
  return keys.map((k) => LABELS[k] || k);
}
