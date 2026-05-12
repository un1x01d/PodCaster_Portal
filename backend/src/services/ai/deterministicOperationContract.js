const OPS = {
  SINGLE_PERIOD: "single_period",
  YOY_SERIES: "yoy_series",
  TWO_YEAR_DELTA: "two_year_delta",
  TOP_N_BY_DIMENSION: "top_n_by_dimension",
  TOP_N_BY_YEAR: "top_n_by_year",
  DRIVER_YEAR_CHANGE: "driver_year_change",
  METRIC_PROJECTION: "metric_projection",
};

const OPERATION_CATALOG = Object.freeze([
  OPS.SINGLE_PERIOD,
  OPS.YOY_SERIES,
  OPS.TWO_YEAR_DELTA,
  OPS.TOP_N_BY_DIMENSION,
  OPS.TOP_N_BY_YEAR,
  OPS.DRIVER_YEAR_CHANGE,
  OPS.METRIC_PROJECTION,
]);

function clarification(question, options = [], reason = "clarification_required") {
  return {
    ok: false,
    clarification_needed: true,
    reason,
    clarification_question: question,
    clarification_options: Array.isArray(options) ? options.slice(0, 6) : [],
  };
}

function hasText(v) {
  return String(v || "").trim().length > 0;
}

function isYear(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 1900 && n <= 2200;
}

export function validateDeterministicPlanContract(plan = {}) {
  if (!plan || plan.ok !== true) return { ok: true, plan };
  const op = String(plan.operation || "").trim();
  if (!OPERATION_CATALOG.includes(op)) {
    return {
      ok: false,
      plan: clarification(
        "I can answer that, but I need one clarification first. Which type of analysis should I run?",
        ["Total", "Year over year", "Top ranking", "Driver analysis"],
        "operation_unsupported"
      ),
    };
  }

  if (op === OPS.SINGLE_PERIOD || op === OPS.YOY_SERIES || op === OPS.TWO_YEAR_DELTA || op === OPS.METRIC_PROJECTION) {
    if (!hasText(plan.metric)) {
      return {
        ok: false,
        plan: clarification(
          "I can answer that, but I need one clarification first. Which metric should I calculate?",
          [],
          "metric_missing"
        ),
      };
    }
  }

  if (op === OPS.METRIC_PROJECTION) {
    if (!isYear(plan.targetYear) || !hasText(plan.dateHeader)) {
      return {
        ok: false,
        plan: clarification(
          "I can answer that, but I need one clarification first. Please confirm the target year and date field for the projection.",
          [],
          "projection_fields_missing"
        ),
      };
    }
  }

  if (op === OPS.TOP_N_BY_DIMENSION) {
    if (!hasText(plan.dimensionHeader) || !hasText(plan.valueHeader)) {
      return {
        ok: false,
        plan: clarification(
          "I can answer that, but I need one clarification first. Which grouping and metric should I rank?",
          [],
          "ranking_fields_missing"
        ),
      };
    }
  }

  if (op === OPS.TOP_N_BY_YEAR) {
    if (!hasText(plan.dateHeader) || !hasText(plan.valueHeader)) {
      return {
        ok: false,
        plan: clarification(
          "I can answer that, but I need one clarification first. Which date field and metric should I use?",
          [],
          "year_ranking_fields_missing"
        ),
      };
    }
  }

  if (op === OPS.DRIVER_YEAR_CHANGE) {
    if (!isYear(plan.year) || !hasText(plan.dateHeader) || !hasText(plan.dimensionHeader) || !hasText(plan.valueHeader)) {
      return {
        ok: false,
        plan: clarification(
          "I can answer that, but I need one clarification first. Please confirm year, date field, metric, and grouping for driver analysis.",
          [],
          "driver_fields_missing"
        ),
      };
    }
  }

  return { ok: true, plan };
}

export { OPERATION_CATALOG, OPS };
