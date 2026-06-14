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

test("ranking explanation prints top-N for each year when rows_by_year is present", () => {
  const answer = explainDeterministicResults({
    locale: "en",
    computed: {
      ok: true,
      outputType: "ranking",
      step_results: [
        {
          ok: true,
          step_id: "s_rank_year",
          operation: "ranking",
          rows_by_year: [
            {
              year: 2023,
              top_ranked: [
                { label: "Casey Brown", value: 300000, percent_change: null, share_of_year_percent: 54.5454 },
                { label: "Drew Wilson", value: 250000, percent_change: null, share_of_year_percent: 45.4545 },
              ],
            },
            {
              year: 2024,
              top_ranked: [
                { label: "Drew Wilson", value: 330000, percent_change: 32, share_of_year_percent: 53.2258 },
                { label: "Casey Brown", value: 290000, percent_change: -3.3333, share_of_year_percent: 46.7742 },
              ],
            },
          ],
          metadata: { columns_used: { metric: "Net Revenue", dimension: "Customer", date_column: "Date" } },
        },
      ],
    },
  });

  assert.match(answer, /Ranking - Customer/);
  assert.match(answer, /2023: 1\. Casey Brown: \$300,000\.00 \(YoY N\/A, share 54\.55%\); 2\. Drew Wilson: \$250,000\.00 \(YoY N\/A, share 45\.45%\)/);
  assert.match(answer, /2024: 1\. Drew Wilson: \$330,000\.00 \(YoY \+32\.00%, share 53\.23%\); 2\. Casey Brown: \$290,000\.00 \(YoY -3\.33%, share 46\.77%\)/);
});

test("explanation deduplicates repeated adjacent sections and avoids generic value metric label", () => {
  const answer = explainDeterministicResults({
    locale: "uk",
    computed: {
      ok: true,
      step_results: [
        {
          ok: true,
          step_id: "a1",
          operation: "aggregate",
          value: 10,
          metrics: [{ column: "Net Revenue", aggregation: "sum" }],
          metadata: { columns_used: { metric: null, metrics: ["Net Revenue"] } },
        },
        {
          ok: true,
          step_id: "a2",
          operation: "aggregate",
          value: 10,
          metrics: [{ column: "Net Revenue", aggregation: "sum" }],
          metadata: { columns_used: { metric: null, metrics: ["Net Revenue"] } },
        },
      ],
    },
  });

  const blocks = String(answer).split(/\n\n+/).filter(Boolean);
  assert.equal(blocks.length, 1);
  assert.match(answer, /Підсумок - Net Revenue/);
  assert.doesNotMatch(answer, /Підсумок - value/i);
});
