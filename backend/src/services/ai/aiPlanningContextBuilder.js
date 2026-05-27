export function buildAiPlanningContext({ question = "", dataset = null, semanticCandidates = null, knownMappings = {}, memory = null }) {
  return {
    question: String(question || ""),
    dataset: dataset || {},
    semantic_candidates: semanticCandidates || { candidate_sets: [] },
    known_mappings: knownMappings || {},
    allowed_operations: [
      "aggregate", "filter", "group_by", "sort", "limit", "period_delta", "year_over_year",
      "period_driver_delta", "period_delta_by_dimension", "ranking", "trend", "ratio", "margin", "variance",
    ],
    conversation_memory: memory || { last_successful_analysis: null },
  };
}
