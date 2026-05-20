import test from "node:test";
import assert from "node:assert/strict";
import {
  AMBIGUITY_DELTA_MIN,
  CONFIDENCE_CERTAIN_MIN,
  CONFIDENCE_HIGH_PROB_MIN,
  validateDeterministicPlanContract,
} from "../src/services/ai/deterministicOperationContract.js";

function basePlan() {
  return {
    ok: true,
    operation: "single_period",
    metric: "total_revenue",
  };
}

test("rejects plan when verification object is missing", () => {
  const checked = validateDeterministicPlanContract(basePlan());
  assert.equal(checked.ok, false);
  assert.equal(checked.plan?.clarification_needed, true);
  assert.equal(checked.plan?.reason, "verification_missing");
});

test("rejects plan when verification confidence is below high-prob threshold", () => {
  const checked = validateDeterministicPlanContract({
    ...basePlan(),
    verification: {
      method: "resolver",
      evidence: { resolvedMappings: { total_revenue: "Revenue" } },
      confidence: CONFIDENCE_HIGH_PROB_MIN - 0.01,
      fallback_used: false,
    },
  });
  assert.equal(checked.ok, false);
  assert.equal(checked.plan?.reason, "clarification_needed_low_confidence");
});

test("rejects plan when ambiguity delta is too small even with high confidence", () => {
  const checked = validateDeterministicPlanContract({
    ...basePlan(),
    verification: {
      method: "resolver",
      evidence: { candidates: ["Revenue", "Net Revenue"] },
      confidence: 0.93,
      fallback_used: false,
      ambiguity_delta: AMBIGUITY_DELTA_MIN - 0.01,
    },
  });
  assert.equal(checked.ok, false);
  assert.equal(checked.plan?.reason, "clarification_needed_ambiguous_candidates");
});

test("passes and marks warning for high-prob confidence band", () => {
  const checked = validateDeterministicPlanContract({
    ...basePlan(),
    verification: {
      method: "resolver",
      evidence: { resolvedMappings: { total_revenue: "Revenue" } },
      confidence: CONFIDENCE_CERTAIN_MIN - 0.01,
      fallback_used: true,
      ambiguity_delta: 0.05,
    },
  });
  assert.equal(checked.ok, true);
  assert.equal(checked.plan?.verification?.band, "high_prob");
  assert.equal(checked.plan?.verification_gate?.warning, true);
});

test("passes as certain confidence band", () => {
  const checked = validateDeterministicPlanContract({
    ...basePlan(),
    verification: {
      method: "resolver",
      evidence: { resolvedMappings: { total_revenue: "Revenue" } },
      confidence: CONFIDENCE_CERTAIN_MIN,
      fallback_used: false,
      ambiguity_delta: 0.06,
    },
  });
  assert.equal(checked.ok, true);
  assert.equal(checked.plan?.verification?.band, "certain");
  assert.equal(checked.plan?.verification_gate?.warning, false);
});
