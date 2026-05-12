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
