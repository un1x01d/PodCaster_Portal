import { resolveField } from "../ai/fieldResolver.js";
import { COMPLEX_QUESTION_REQUIREMENTS } from "./complexQuestionRequirements.js";
import { recommendMissingFields } from "./missingFieldRecommendations.js";

const CANONICAL_BRIDGE = {
  revenue: "total_revenue",
  expenses: "total_expense",
  actual: "actual_amount",
  budget: "budget_amount",
  net_income: "net_income",
  cogs: "cogs",
  gross_profit: "gross_profit",
  date: "date",
  accounts_receivable: "ar_balance",
  accounts_payable: "ap_balance",
};

function toResolverCanonical(field) {
  return CANONICAL_BRIDGE[field] || field;
}

export function resolveAnalysisHeaders({ approvedPlan, headers = [], fieldMetadata = {}, message = "" }) {
  const questionType = approvedPlan?.question_type;
  const req = COMPLEX_QUESTION_REQUIREMENTS[questionType];
  if (!req) return { ok: false, errorCode: "UNSUPPORTED_QUESTION_TYPE", message: "Unsupported complex accounting analysis type." };

  let selectedRequiredFieldSet = null;
  const requiredMappings = {};
  const missingRequired = [];
  const ambiguous = [];

  for (const fieldSet of req.minimumRequiredFieldSets) {
    const localMissing = [];
    const localAmbiguous = [];
    const localMap = {};
    for (const canonicalField of fieldSet) {
      const resolverKey = toResolverCanonical(canonicalField);
      const out = resolveField({ canonicalField: resolverKey, headers, fieldMetadata, message });
      if (out.status === "resolved") localMap[canonicalField] = { header: out.header, matchType: out.method, confidence: out.confidence };
      else if (out.status === "ambiguous" || out.status === "ask_followup") localAmbiguous.push({ canonicalField, ...out });
      else localMissing.push(canonicalField);
    }
    if (!localMissing.length && !localAmbiguous.length) {
      selectedRequiredFieldSet = fieldSet;
      Object.assign(requiredMappings, localMap);
      break;
    }
  }

  if (!selectedRequiredFieldSet) {
    const bestSet = req.minimumRequiredFieldSets[0] || [];
    for (const canonicalField of bestSet) {
      const resolverKey = toResolverCanonical(canonicalField);
      const out = resolveField({ canonicalField: resolverKey, headers, fieldMetadata, message });
      if (out.status === "resolved") requiredMappings[canonicalField] = { header: out.header, matchType: out.method, confidence: out.confidence };
      else if (out.status === "ambiguous" || out.status === "ask_followup") ambiguous.push({ canonicalField, ...out });
      else missingRequired.push(canonicalField);
    }
    return {
      ok: false,
      errorCode: "MISSING_REQUIRED_HEADERS",
      message: `Required fields are missing for ${questionType}.`,
      missingRequired,
      ambiguous,
      examples: recommendMissingFields(questionType, missingRequired),
    };
  }

  const optionalMappings = {};
  const missingOptional = [];
  for (const canonicalField of req.optionalFields || []) {
    const resolverKey = toResolverCanonical(canonicalField);
    const out = resolveField({ canonicalField: resolverKey, headers, fieldMetadata, message });
    if (out.status === "resolved") optionalMappings[canonicalField] = { header: out.header, matchType: out.method, confidence: out.confidence };
    else missingOptional.push(canonicalField);
  }

  const limitations = missingOptional.length
    ? [`Detailed analysis is limited because optional fields are missing: ${missingOptional.join(", ")}.`]
    : [];

  return {
    ok: true,
    questionType,
    selectedRequiredFieldSet,
    requiredMappings,
    optionalMappings,
    missingRequired: [],
    missingOptional,
    ambiguous: [],
    answerCompleteness: missingOptional.length ? "partial" : "full",
    limitations,
  };
}
