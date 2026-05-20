import { METRIC_HEADER_REQUIREMENTS } from "./metricHeaderRequirements.js";
import { resolveField } from "./fieldResolver.js";

export async function resolveMetricHeaders({ metricKey, headers = [], fieldMetadata = {}, message = "", sampleRows = [], groupId = null }) {
  const req = METRIC_HEADER_REQUIREMENTS[metricKey] || { required: [], optional: [] };
  const resolvedMappings = {};
  const optionalMappings = {};
  const missingRequired = [];
  const ambiguous = [];
  const confidences = [];

  for (const canonicalField of req.required) {
    const out = await resolveField({ canonicalField, headers, fieldMetadata, message, resolvedMappings, sampleRows, groupId });
    if (out.status === "resolved") {
      resolvedMappings[canonicalField] = out.header;
      confidences.push(out.confidence);
    } else if (out.status === "ambiguous" || out.status === "ask_followup") {
      ambiguous.push({
        canonicalField,
        ...out,
        delta: Number.isFinite(Number(out?.ambiguityDelta)) ? Number(out.ambiguityDelta) : null,
      });
    } else {
      missingRequired.push(canonicalField);
    }
  }

  for (const canonicalField of req.optional) {
    const out = await resolveField({ canonicalField, headers, fieldMetadata, message, resolvedMappings, sampleRows, groupId });
    if (out.status === "resolved") {
      optionalMappings[canonicalField] = out.header;
      confidences.push(out.confidence);
    }
  }

  const confidence = confidences.length ? (confidences.reduce((a, b) => a + b, 0) / confidences.length) : 0;
  return { resolvedMappings, optionalMappings, missingRequired, ambiguous, confidence };
}
