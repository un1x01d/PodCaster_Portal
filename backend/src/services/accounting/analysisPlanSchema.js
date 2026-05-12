export const ALLOWED_STEP_TYPES = new Set([
  "calculate_metric",
  "calculate_variance",
  "calculate_percentage_change",
  "compare_periods",
  "rank_drivers",
  "summarize_by_group",
  "detect_top_changes",
  "calculate_ratio",
  "detect_missing_fields",
]);

export const ALLOWED_SAFE_NEXT = new Set(["validate_plan", "ask_followup", "refuse_or_redirect", "unsupported"]);

export const MAX_ANALYSIS_STEPS = 12;
export const MAX_GROUP_BYS = 3;
export const MAX_RANK_LIMIT = 10;
