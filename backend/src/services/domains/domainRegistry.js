import { ACCOUNTING_GLOSSARY } from "../ai/accountingGlossary.js";
import { METRIC_HEADER_REQUIREMENTS } from "../ai/metricHeaderRequirements.js";
import { METRIC_REGISTRY } from "../accounting/metricRegistry.js";
import { COMPLEX_QUESTION_REQUIREMENTS } from "../accounting/complexQuestionRequirements.js";
import { buildSimpleDeterministicAnswer } from "../accounting/simpleAnswerTemplates.js";
import { recommendMissingFields } from "../accounting/missingFieldRecommendations.js";

import { FINANCE_DICTIONARY } from "./finance/dictionary.js";
import { FINANCE_METRICS } from "./finance/metricRegistry.js";
import { FINANCE_METRIC_REQUIREMENTS } from "./finance/metricRequirements.js";
import { FINANCE_COMPLEX_QUESTION_REQUIREMENTS } from "./finance/complexQuestionRequirements.js";
import { financeAnswerTemplate } from "./finance/answerTemplates.js";
import { financeMissingFieldRecommendations } from "./finance/missingFieldRecommendations.js";

import { MARKETING_DICTIONARY } from "./marketing/dictionary.js";
import { MARKETING_METRICS } from "./marketing/metricRegistry.js";
import { MARKETING_METRIC_REQUIREMENTS } from "./marketing/metricRequirements.js";
import { MARKETING_COMPLEX_QUESTION_REQUIREMENTS } from "./marketing/complexQuestionRequirements.js";
import { marketingAnswerTemplate } from "./marketing/answerTemplates.js";
import { marketingMissingFieldRecommendations } from "./marketing/missingFieldRecommendations.js";

import { SALES_DICTIONARY } from "./sales/dictionary.js";
import { SALES_METRICS } from "./sales/metricRegistry.js";
import { SALES_METRIC_REQUIREMENTS } from "./sales/metricRequirements.js";
import { SALES_COMPLEX_QUESTION_REQUIREMENTS } from "./sales/complexQuestionRequirements.js";
import { salesAnswerTemplate } from "./sales/answerTemplates.js";
import { salesMissingFieldRecommendations } from "./sales/missingFieldRecommendations.js";

export const DOMAIN_REGISTRY = {
  accounting: {
    key: "accounting",
    label: "Accounting",
    dictionary: ACCOUNTING_GLOSSARY,
    metricRequirements: METRIC_HEADER_REQUIREMENTS,
    metricRegistry: METRIC_REGISTRY,
    complexQuestionRequirements: COMPLEX_QUESTION_REQUIREMENTS,
    answerTemplates: { simple: buildSimpleDeterministicAnswer },
    missingFieldRecommendations: { recommend: recommendMissingFields },
  },
  finance: {
    key: "finance",
    label: "Finance",
    dictionary: FINANCE_DICTIONARY,
    metricRequirements: FINANCE_METRIC_REQUIREMENTS,
    metricRegistry: FINANCE_METRICS,
    complexQuestionRequirements: FINANCE_COMPLEX_QUESTION_REQUIREMENTS,
    answerTemplates: { simple: financeAnswerTemplate },
    missingFieldRecommendations: { recommend: financeMissingFieldRecommendations },
  },
  marketing: {
    key: "marketing",
    label: "Marketing",
    dictionary: MARKETING_DICTIONARY,
    metricRequirements: MARKETING_METRIC_REQUIREMENTS,
    metricRegistry: MARKETING_METRICS,
    complexQuestionRequirements: MARKETING_COMPLEX_QUESTION_REQUIREMENTS,
    answerTemplates: { simple: marketingAnswerTemplate },
    missingFieldRecommendations: { recommend: marketingMissingFieldRecommendations },
  },
  sales: {
    key: "sales",
    label: "Sales",
    dictionary: SALES_DICTIONARY,
    metricRequirements: SALES_METRIC_REQUIREMENTS,
    metricRegistry: SALES_METRICS,
    complexQuestionRequirements: SALES_COMPLEX_QUESTION_REQUIREMENTS,
    answerTemplates: { simple: salesAnswerTemplate },
    missingFieldRecommendations: { recommend: salesMissingFieldRecommendations },
  },
};

export function getDomainMetric(domain, key) {
  return DOMAIN_REGISTRY?.[domain]?.metricRegistry?.[key] || null;
}

export function allMetricKeys() {
  return Object.values(DOMAIN_REGISTRY).flatMap((d) => Object.keys(d.metricRegistry || {}));
}
