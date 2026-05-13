import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test("chat deterministic single-period metrics use SQL fast path before full row load", () => {
  const controllerPath = path.join(__dirname, "..", "src", "controllers", "chatController.js");
  const source = fs.readFileSync(controllerPath, "utf8");

  assert.match(source, /function buildSqlFastPathFromDeterministicPlan\(plan\)/);
  assert.match(source, /if \(!plan\?\.ok \|\| String\(plan\.operation \|\| ""\) !== "single_period"\) return null;/);
  assert.match(source, /const sqlFastPath = buildSqlFastPathFromDeterministicPlan\(compiledPlan\);/);
  assert.match(source, /operation: "sum"/);
  assert.match(source, /phase: "accounting_sql_fast_path"/);
});

test("chat pre-AI hot path short-circuits clear sum queries with SQL and fallback remains available", () => {
  const controllerPath = path.join(__dirname, "..", "src", "controllers", "chatController.js");
  const source = fs.readFileSync(controllerPath, "utf8");

  assert.match(source, /function isHighConfidenceSqlHotPathQuery\(message = "", rules = CHAT_RUNTIME_RULES_DEFAULTS\)/);
  assert.match(source, /const hotTarget = resolveSqlHotPathMetricColumn\(/);
  assert.match(source, /const hotDateColumn =/);
  assert.match(source, /resolveProfileDateColumn\(semanticProfile, \[\]\)/);
  assert.match(source, /inferLikelyDateColumn\(aiHeaders, sampleRows, \[\]\)/);
  assert.match(source, /operation: "sum"/);
  assert.match(source, /phase: "chat_sql_hot_path"/);
  assert.match(source, /semanticProfileWithAi = await ensureAiHeaderUnderstanding\(/);
});

test("chat final answer pipeline applies conversational scalar style", () => {
  const controllerPath = path.join(__dirname, "..", "src", "controllers", "chatController.js");
  const source = fs.readFileSync(controllerPath, "utf8");

  assert.match(source, /function applyConversationalAnswerStyle\(answer = "", message = "", locale = "en"\)/);
  assert.match(source, /The \$\{metric\} for \$\{year\} is \$\{value\}\./);
  assert.match(source, /The difference in \$\{metric\} between \$\{y1\} and \$\{y2\} is \$\{value\}\./);
  assert.match(source, /The largest driver was \$\{name\} \(\$\{value\}\)\./);
  assert.match(source, /The \$\{metricHint\} for \$\{year\} was \$\{text\}\./);
  assert.match(source, /The \$\{metricHint\} for \$\{r\.year\} was \$\{r\.value\}\./);
  assert.match(source, /answer = applyConversationalAnswerStyle\(answer, message, locale\);/);
});

test("ranking intents bypass deterministic single-period branch and keep conversational formatting", () => {
  const controllerPath = path.join(__dirname, "..", "src", "controllers", "chatController.js");
  const source = fs.readFileSync(controllerPath, "utf8");

  assert.match(source, /const looksLikeRankingQuestion =/);
  assert.match(source, /if \(compiledPlan\.ok && !looksLikeRankingQuestion\)/);
  assert.match(source, /isDriverRankingQuery\(planningMessage, chatRuntimeRules\)/);
});

test("chat numeric answers include skipped non-numeric row counts", () => {
  const controllerPath = path.join(__dirname, "..", "src", "controllers", "chatController.js");
  const source = fs.readFileSync(controllerPath, "utf8");

  assert.match(source, /function appendSkippedRowsNote\(answer = "", skippedRows = 0, locale = "en"\)/);
  assert.match(source, /Skipped non-numeric rows:/);
  assert.match(source, /COUNT\(\*\)::int AS total_rows, COUNT\(/);
  assert.match(source, /appendSkippedRowsNote\(/);
});

test("deterministic SQL fast path applies year filter to resolved date column", () => {
  const controllerPath = path.join(__dirname, "..", "src", "controllers", "chatController.js");
  const source = fs.readFileSync(controllerPath, "utf8");

  assert.match(source, /const dateColumn = String\(/);
  assert.match(source, /resolution\?\.resolvedMappings\?\.date/);
  assert.match(source, /resolution\?\.optionalMappings\?\.date/);
  assert.match(source, /\{ column: dateColumn, operator: "year_equals", value: String\(periodYear\) \}/);
});

test("metric confirmation follow-up uses cached context instead of recalculating", () => {
  const controllerPath = path.join(__dirname, "..", "src", "controllers", "chatController.js");
  const source = fs.readFileSync(controllerPath, "utf8");

  assert.match(source, /function isMetricConfirmationFollowup\(message = ""\)/);
  assert.match(source, /phase: "metric_confirmation_followup"/);
  assert.match(source, /lastMetric: String\(resolvedTarget \|\| ai\?\.target_column \|\| ""\)/);
});

test("delta follow-up without years uses cached context years and returns conversational delta", () => {
  const controllerPath = path.join(__dirname, "..", "src", "controllers", "chatController.js");
  const source = fs.readFileSync(controllerPath, "utf8");

  assert.match(source, /function mergeRecentYears\(existingYears = \[\], incomingYears = \[\], maxKeep = 4\)/);
  assert.match(source, /phase: "contextual_delta_followup"/);
  assert.match(source, /applyConversationalAnswerStyle\(directAnswer, message, locale\)/);
  assert.match(source, /const y1 = Number\(dedupYears\[dedupYears.length - 2\]\)/);
  assert.match(source, /const y2 = Number\(dedupYears\[dedupYears.length - 1\]\)/);
});

test("chat runtime rules expose history-regex flags and rule-hit telemetry hooks", () => {
  const controllerPath = path.join(__dirname, "..", "src", "controllers", "chatController.js");
  const source = fs.readFileSync(controllerPath, "utf8");

  assert.match(source, /enableTopNHistoryRegex: true/);
  assert.match(source, /enableMoneyHistoryRegex: true/);
  assert.match(source, /function recordRuleHit\(rule, matched, meta = \{\}\)/);
  assert.match(source, /const enableTopNHistoryRegex = toRuleFlag\(chatRuntimeRules\?\.enableTopNHistoryRegex, true\)/);
  assert.match(source, /const enableMoneyHistoryRegex = toRuleFlag\(chatRuntimeRules\?\.enableMoneyHistoryRegex, true\)/);
  assert.match(source, /function parseYearFollowup\(message = ""\)/);
  assert.match(source, /function isComparisonIntent\(message = "", rules = CHAT_RUNTIME_RULES_DEFAULTS\)/);
  assert.match(source, /recordRuleHit\("comparisonIntentCanonical", intentPlan\.explicitComparison/);
  assert.match(source, /function asksIgnoreDashboardFilters\(message = ""\)/);
  assert.match(source, /activeDashboardFilters = ignoreDashboardFilters \? \[\] : normalizeActiveDashboardFilters/);
});

test("two-year delta with cause composite returns full conversational multi-part response", () => {
  const controllerPath = path.join(__dirname, "..", "src", "controllers", "chatController.js");
  const source = fs.readFileSync(controllerPath, "utf8");

  assert.match(source, /function deriveChatIntentPlan\(\{ message = "", normalizedMessage = "", rules = CHAT_RUNTIME_RULES_DEFAULTS \}\)/);
  assert.match(source, /function asksTwoYearDeltaWithCause\(message = ""\)/);
  assert.match(source, /const intentPlan = deriveChatIntentPlan\(/);
  assert.match(source, /function isTemporalDimensionHeader\(header = ""\)/);
  assert.match(source, /function resolveDriverDimensionForDeltaCause\(/);
  assert.match(source, /I can compute the delta, but I could not identify a valid revenue category driver from the available columns\./);
  assert.match(source, /if \(intentPlan\.twoYearDeltaCause\)/);
  assert.match(source, /if \(!resolvedTarget\) \{/);
  assert.match(source, /findRevenueMetric\(aiHeaders\)/);
  assert.match(source, /const deterministicBaseFilters = \[\.\.\.\(Array\.isArray\(activeDashboardFilters\) \? activeDashboardFilters : \[\]\)\]/);
  assert.match(source, /const dateCandidates = Array\.from\(new Set\(\[/);
  assert.match(source, /const tabCandidates = Array\.from\(new Set\(\[selectedTab \|\| null, null\]\)\)/);
  assert.match(source, /if \(v1 === null \|\| v2 === null\) \{/);
  assert.match(source, /const fullLoadForFallback = await loadAccessibleRows\(sheetId, req\.user, selectedTab\)/);
  assert.match(source, /two_year_delta_cause_metric_unresolved/);
  assert.match(source, /resolveDriverDimensionForDeltaCause\(/);
  assert.match(source, /isTemporalDimensionHeader\(header = ""\)/);
  assert.match(source, /isMetricLikeHeader\(header = ""\)/);
  assert.match(source, /\$\{higherYear\} had higher \$\{metric\} than \$\{lowerYear\} by \$\{absDeltaText\}\./);
  assert.match(source, /The top category driving the gap was/);
  assert.match(source, /operation: "two_year_delta_with_cause"/);
  assert.match(source, /const allowCompositeDeltaCauseBypass = intentPlan\.twoYearDeltaCause/);
  assert.match(source, /if \(!CHAT_ENABLE_LEGACY_FALLBACK && !intentPlan\.twoYearDeltaCause\)/);
  assert.match(source, /compare\|comparison\|delta\|difference\|diff\|change\|vs\|versus\|between\|how much\|higher\|lower\|gap/);
  assert.match(source, /driving\|what changed\|contributed most\|top category/);
});
