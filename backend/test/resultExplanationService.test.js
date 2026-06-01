import test from "node:test";
import assert from "node:assert/strict";

import { explainDeterministicResults } from "../src/services/ai/resultExplanationService.js";

test("multi-step explanation covers every computed step without exposing internal step IDs", () => {
  const answer = explainDeterministicResults({
    locale: "en",
    computed: {
      ok: true,
      outputType: "scalar",
      step_results: [
        {
          ok: true,
          step_id: "step_yoy_value_auto_1",
          operation: "year_over_year",
          rows: [
            { year: 2022, value: 1000, previous_year_value: null, absolute_change: null, percent_change: null },
            { year: 2023, value: 1250, previous_year_value: 1000, absolute_change: 250, percent_change: 25 },
          ],
          metadata: { columns_used: { metric: "Net Revenue", date_column: "Date" } },
        },
        {
          ok: true,
          step_id: "step_driver_auto_2",
          operation: "period_delta_by_dimension",
          rows_by_year: [
            {
              previous_year: 2022,
              year: 2023,
              top_contributors: [
                { label: "North America", baseline_value: 400, comparison_value: 700, absolute_change: 300, percent_change: 75 },
              ],
            },
          ],
          rows: [{ year: 2023, previous_year: 2022, label: "North America", absolute_change: 300, percent_change: 75 }],
          metadata: { columns_used: { metric: "Net Revenue", dimension: "Region", date_column: "Date" } },
        },
        {
          ok: true,
          step_id: "step_cogs_3",
          operation: "period_delta",
          baseline_value: 200,
          comparison_value: 260,
          absolute_change: 60,
          percent_change: 30,
          metadata: { columns_used: { metric: "COGS", date_column: "Date" } },
        },
        {
          ok: true,
          step_id: "step_margin_4",
          operation: "margin",
          value: 41.25,
          metadata: { columns_used: { metrics: ["Gross Profit", "Net Revenue"] } },
        },
      ],
    },
  });

  assert.match(answer, /Year-over-year summary - Net Revenue/);
  assert.match(answer, /2023: value \$1,250\.00, previous year \$1,000\.00, change \$250\.00 \(25\.00%\)/);
  assert.match(answer, /Measurable drivers by dimension - Region/);
  assert.match(answer, /From 2022 to 2023: 1\. North America: \$300\.00 \(75\.00%\)/);
  assert.match(answer, /Period comparison - COGS: baseline \$200\.00, comparison \$260\.00, change \$60\.00 \(30\.00%\)/);
  assert.match(answer, /Margin: 41\.25%/);
  assert.match(answer, /These are measurable drivers, not proven causation\./);
  assert.doesNotMatch(answer, /step_yoy_value_auto_1|step_driver_auto_2|step_cogs_3|Step /);
});

test("single ranking explanation lists ranking only and does not append causation warning", () => {
  const answer = explainDeterministicResults({
    locale: "en",
    computed: {
      ok: true,
      outputType: "ranking",
      step_results: [
        {
          ok: true,
          step_id: "s1",
          operation: "ranking",
          rows: [
            { label: "Security Platform", value: 1200 },
            { label: "Analytics Suite", value: 900 },
          ],
          metadata: { columns_used: { metric: "Net Revenue", dimension: "Product Line" } },
        },
      ],
    },
  });

  assert.match(answer, /Ranking - Product Line/);
  assert.match(answer, /1\. Security Platform: \$1,200\.00/);
  assert.doesNotMatch(answer, /measurable drivers, not proven causation/i);
  assert.doesNotMatch(answer, /s1|Step /);
});
