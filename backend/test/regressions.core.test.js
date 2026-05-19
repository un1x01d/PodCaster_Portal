import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

test("dropbox oauth state is signed and validates for original user", async () => {
  process.env.JWT_SECRET = "test-secret";
  const mod = await import(`../src/controllers/dropboxController.js?t=${Date.now()}`);
  const state = mod.createDropboxOauthState(42, 9, 1_000);
  const verified = mod.verifyDropboxOauthState(state, 1_001);
  assert.deepEqual(verified, { userId: 42, groupId: 9 });
});

test("dropbox oauth state rejects tampered payload", async () => {
  process.env.JWT_SECRET = "test-secret";
  const mod = await import(`../src/controllers/dropboxController.js?t=${Date.now()}_tampered`);
  const state = mod.createDropboxOauthState(7, 9, 1_000);
  const [payload, sig] = state.split(".");
  const tampered = `${payload.replace(/.$/, "A")}.${sig}`;
  const verified = mod.verifyDropboxOauthState(tampered, 1_001);
  assert.equal(verified, null);
});

test("dropbox oauth state expires", async () => {
  process.env.JWT_SECRET = "test-secret";
  const mod = await import(`../src/controllers/dropboxController.js?t=${Date.now()}_expires`);
  const state = mod.createDropboxOauthState(9, 11, 1_000);
  const verified = mod.verifyDropboxOauthState(state, 1_000 + (5 * 60 * 1000) + 1);
  assert.equal(verified, null);
});

test("google public oauth endpoints are app-layer rate-limited", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const routesPath = path.join(__dirname, "..", "src", "routes", "googleRoutes.js");
  const source = fs.readFileSync(routesPath, "utf8");

  assert.match(source, /oauthPublicRateLimit/);
  assert.match(source, /oauthExchangeRateLimit/);
  assert.match(source, /router\.get\("\/auth\/google\/url", oauthPublicRateLimit, asyncHandler\(getGoogleLoginUrl\)\)/);
  assert.match(source, /router\.get\("\/auth\/google\/callback", oauthPublicRateLimit, asyncHandler\(googleCallback\)\)/);
  assert.match(source, /router\.post\("\/auth\/google\/exchange", oauthExchangeRateLimit, asyncHandler\(exchangeGoogleCode\)\)/);
});

test("sheet upload role guard allows only explicit admin role", async () => {
  const mod = await import(`../src/controllers/sheetController.js?t=${Date.now()}`);
  assert.equal(mod.canUploadSheetsByRole("admin"), true);
  assert.equal(mod.canUploadSheetsByRole("group_admin"), false);
  assert.equal(mod.canUploadSheetsByRole("user"), false);
  assert.equal(mod.canUploadSheetsByRole(""), false);
});

test("2fa login verification uses transactional row locking and atomic consume", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const controllerPath = path.join(__dirname, "..", "src", "controllers", "authController.js");
  const source = fs.readFileSync(controllerPath, "utf8");

  assert.match(source, /export async function verifyTwoFactorLogin/);
  assert.match(source, /await client\.query\("BEGIN"\)/);
  assert.match(source, /FOR UPDATE OF c/);
  assert.match(source, /UPDATE auth_2fa_challenges SET attempts = attempts \+ 1 WHERE id = \$1/);
  assert.match(source, /UPDATE auth_2fa_challenges SET consumed_at = CURRENT_TIMESTAMP WHERE id = \$1/);
  assert.match(source, /await client\.query\("COMMIT"\)/);
  assert.match(source, /await client\.query\("ROLLBACK"\)\.catch\(\(\) => \{\}\);/);
});

test("saved view column allowlist strips hidden columns server-side", async () => {
  const mod = await import(`../src/controllers/sheetController.js?t=${Date.now()}_view_columns`);
  const headers = ["Client", "Revenue", "Total Profit", "Region"];

  assert.deepEqual(
    mod.resolveViewColumnAllowlist({ visibleColumns: ["Client", "Revenue", "Region"] }, headers),
    ["Client", "Revenue", "Region"]
  );
  assert.deepEqual(
    mod.resolveViewColumnAllowlist({ hiddenColumns: ["Total Profit"] }, headers),
    ["Client", "Revenue", "Region"]
  );
  assert.equal(mod.resolveViewColumnAllowlist({ visibleColumns: [] }, headers), null);
});

test("report source refresh detects added and removed spreadsheet columns", async () => {
  const mod = await import(`../src/controllers/sheetController.js?t=${Date.now()}_header_diff`);
  const diff = mod.buildHeaderDiff(
    ["Client", "Revenue", "Total Profit"],
    ["Customer", "Revenue", "Gross Margin"]
  );

  assert.deepEqual(diff.added, ["Customer", "Gross Margin"]);
  assert.deepEqual(diff.removed, ["Client", "Total Profit"]);
  assert.deepEqual(diff.unchanged, ["Revenue"]);
});

test("sheet data viewId path projects allowed JSON keys in SQL before response", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const controllerPath = path.join(__dirname, "..", "src", "controllers", "sheetController.js");
  const source = fs.readFileSync(controllerPath, "utf8");

  assert.match(source, /SELECT v\.config, s\.headers/);
  assert.match(source, /resolveViewColumnAllowlist\(viewConfig, sheetHeaders\)/);
  assert.match(source, /SELECT jsonb_object_agg\(key, value\)/);
  assert.match(source, /WHERE key = ANY\(\$/);
  assert.match(source, /if \(!hasFullAccess && rowFiltersList\.length > 0\)/);
});

test("sheet data viewId path supports source and file scoped locked views", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const controllerPath = path.join(__dirname, "..", "src", "controllers", "sheetController.js");
  const source = fs.readFileSync(controllerPath, "utf8");

  assert.match(source, /LEFT JOIN report_source_imports rsi ON rsi\.sheet_id = s\.id/);
  assert.match(source, /v\.is_global = TRUE/);
  assert.match(source, /v\.report_source_id = rsi\.report_source_id/);
  assert.match(source, /v\.file_label IS NULL OR v\.file_label = rsi\.file_label/);
});

test("view listing requires access to the requested sheet before returning locked views", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const controllerPath = path.join(__dirname, "..", "src", "controllers", "viewController.js");
  const source = fs.readFileSync(controllerPath, "utf8");

  assert.match(source, /from "\.\.\/utils\/authorization\.js";/);
  assert.match(source, /const hasSheetAccess = await checkSheetAccess\(sheetId, req\.user\);/);
  assert.match(source, /if \(!hasSheetAccess\) return res\.status\(403\)\.json\(\{ error: "Forbidden" \}\);/);
});

test("view-based assignment model is wired and legacy permissions routes are removed", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const authPath = path.join(__dirname, "..", "src", "utils", "authorization.js");
  const sheetControllerPath = path.join(__dirname, "..", "src", "controllers", "sheetController.js");
  const routesPath = path.join(__dirname, "..", "src", "routes", "userRoutes.js");
  const authSource = fs.readFileSync(authPath, "utf8");
  const sheetSource = fs.readFileSync(sheetControllerPath, "utf8");
  const routeSource = fs.readFileSync(routesPath, "utf8");

  assert.match(authSource, /export async function resolveAssignedViewForSheet\(sheetId, userId, requestedViewId = null\)/);
  assert.match(authSource, /FROM view_user_permissions/);
  assert.doesNotMatch(authSource, /FROM view_group_permissions/);
  assert.match(sheetSource, /You do not have an assigned view for this sheet\./);

  assert.doesNotMatch(routeSource, /router\.post\("\/report-source-permissions"/);
  assert.doesNotMatch(routeSource, /router\.get\("\/report-source-permissions"/);
  assert.doesNotMatch(routeSource, /router\.post\("\/report-source-group-permissions"/);
  assert.doesNotMatch(routeSource, /router\.get\("\/report-source-group-permissions"/);
});

test("locked view save payload persists visible columns for primary and split views", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(__filename), "..", "..");
  const appPath = path.join(repoRoot, "frontend", "src", "App.jsx");
  const dashboardBodyPath = path.join(repoRoot, "frontend", "src", "components", "dashboard", "DashboardBody.jsx");

  const appSource = fs.readFileSync(appPath, "utf8");
  const dashboardBodySource = fs.readFileSync(dashboardBodyPath, "utf8");

  assert.match(appSource, /visibleColumns:\s*Array\.isArray\(saveViewConfigOverride\?\.visibleColumns\)/);
  assert.match(appSource, /secondaryVisibleColumns:\s*Array\.isArray\(saveViewConfigOverride\?\.splitContext\?\.secondaryVisibleColumns\)/);
  assert.match(appSource, /if \(Array\.isArray\(c\.visibleColumns\)\) setVisibleColumns\(c\.visibleColumns\);/);
  assert.match(appSource, /if \(Array\.isArray\(c\.splitContext\?\.secondaryVisibleColumns\)\)/);
  assert.match(dashboardBodySource, /visibleColumns:\s*selectedPrimaryColumns/);
  assert.match(dashboardBodySource, /secondaryVisibleColumns:\s*selectedSecondaryColumns/);
});

test("chat sheet access check always allows admin", async () => {
  const mod = await import(`../src/controllers/chatController.js?t=${Date.now()}`);
  const hasAccess = await mod.checkSheetAccess("any-sheet-id", { id: 1, role: "admin" });
  assert.equal(hasAccess, true);
});

test("chat audio rejects oversized text before upstream call", async () => {
  process.env.OPENAI_API_KEY = "test-key";
  process.env.CHAT_AUDIO_MAX_CHARS = "10";
  const mod = await import(`../src/controllers/chatController.js?t=${Date.now()}_audio_limit`);

  const req = { body: { text: "01234567890", locale: "en" } };
  const res = {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.payload = obj; return this; },
  };

  await mod.getChatAudio(req, res);
  assert.equal(res.statusCode, 413);
  assert.equal(res.payload?.error, "text_too_large");
});

test("chat formatter preserves decimal percentages and removes empty-tab artifact", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const controllerPath = path.join(__dirname, "..", "src", "controllers", "chatController.js");
  const source = fs.readFileSync(controllerPath, "utf8");

  assert.match(source, /if \(!text\.includes\("\\n"\) && \/\\d\\\.\\d\/\.test\(text\)\) return text;/);
  assert.match(source, /empty-tab artifact phrases/);
});

test("chat AI plan normalization hardens filters/chart/cross targets", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const controllerPath = path.join(__dirname, "..", "src", "controllers", "chatController.js");
  const source = fs.readFileSync(controllerPath, "utf8");

  assert.match(source, /const allowedFilterOps = new Set\(\["contains", "equals", "gt", "gte", "lt", "lte"\]\)/);
  assert.match(source, /aggregation: String\(base\.chart\.aggregation \|\| "sum"\)\.toLowerCase\(\) === "avg" \? "avg" : "sum"/);
  assert.match(source, /filters: safeFilters/);
  assert.match(source, /cross_targets: safeCrossTargets/);
});

test("chat prompt context is bounded and sanitized before upstream AI call", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const controllerPath = path.join(__dirname, "..", "src", "controllers", "chatController.js");
  const source = fs.readFileSync(controllerPath, "utf8");

  assert.match(source, /const promptRows = sanitizePromptRows\(sampleRows\)/);
  assert.match(source, /const promptHistory = sanitizeConversationHistory\(conversationHistory\)/);
  assert.match(source, /conversation_history: promptHistory/);
  assert.match(source, /sample_rows: promptRows/);
});

test("chat cross-sheet aggregation loads each target sheet permission filters", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const controllerPath = path.join(__dirname, "..", "src", "controllers", "chatController.js");
  const source = fs.readFileSync(controllerPath, "utf8");

  assert.match(source, /const targetAccess = await loadAccessibleRows\(t\.sheet_id, req\.user, null, 1\);/);
  assert.match(source, /if \(targetAccess\?\.forbidden\)/);
  assert.match(source, /rowFiltersList: targetAccess\?\.rowFiltersList \|\| \[\]/);
  assert.match(source, /const resolvedCrossColumn = targetOperation === "count"/);
  assert.match(source, /allowedColumns: targetAccess\?\.headers \|\| \[\]/);
  assert.match(source, /if \(targetOperation !== "count" && !resolvedCrossColumn\)/);
});

test("chat AI response is strict-schema validated and metrics are logged", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const controllerPath = path.join(__dirname, "..", "src", "controllers", "chatController.js");
  const source = fs.readFileSync(controllerPath, "utf8");

  assert.match(source, /function validateAiResponseSchemaStrict\(raw\)/);
  assert.match(source, /throw new Error\("openai_invalid_schema"\)/);
  assert.match(source, /throw new Error\(`openai_invalid_schema_key:\$\{key\}`\)/);
  assert.match(source, /console\.info\("\[ai_metrics\]"/);
  assert.match(source, /prompt_tokens/);
  assert.match(source, /completion_tokens/);
  assert.match(source, /estimated_cost_usd/);
});

test("chat blocks date-related questions unless a temporal header exists", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const controllerPath = path.join(__dirname, "..", "src", "controllers", "chatController.js");
  const source = fs.readFileSync(controllerPath, "utf8");
  const chatQueryBody = source.slice(source.indexOf("export async function chatQuery"));

  assert.match(source, /function isDateRelatedQuestion\(message = ""\)/);
  assert.match(source, /function isTemporalHeaderName\(header = ""\)/);
  assert.match(source, /replace\(\/\[_-\]\+\/g, " "\)/);
  assert.match(source, /date\|timestamp\|time\|period\|calendar\|fiscal\|fy\|year\|month\|week\|day\|quarter\|qtr/);
  assert.match(source, /function sheetHasTemporalColumn\(headers = \[\], sampleRows = \[\], semanticProfile = null\)/);
  assert.match(source, /dateRelatedBlocked: true/);
  assert.match(source, /reason: "missing_temporal_column"/);
  assert.ok(chatQueryBody.indexOf("isDateRelatedQuestion(message)") < chatQueryBody.indexOf("reserveAiQueryForSheet({ sheetId"));
  assert.ok(chatQueryBody.indexOf("sheetHasTemporalColumn(aiHeaders, scopedSampleRows, semanticProfile)") < chatQueryBody.indexOf("callOpenAI({"));
});

test("chat answers translate with text items and suppress clarification fallbacks", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const controllerPath = path.join(__dirname, "..", "src", "controllers", "chatController.js");
  const source = fs.readFileSync(controllerPath, "utf8");

  assert.match(source, /function isClarificationOrApologyAnswer/);
  assert.match(source, /aiClarifiedInsteadOfAnswering/);
  assert.match(source, /inferLikelyMetricColumn\(aiHeaders, sampleRows, message/);
  assert.match(source, /items: \[\{ key: "chat_answer", text: String\(answer\) \}\]/);
  assert.match(source, /translated\?\.find\(\(item\) => item\.key === "chat_answer"\)\?\.text/);
});

test("chat deterministic YoY answers override AI prose and keep bullets stacked", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const controllerPath = path.join(__dirname, "..", "src", "controllers", "chatController.js");
  const source = fs.readFileSync(controllerPath, "utf8");

  assert.match(source, /const numericOps = new Set\(\["count", "sum", "avg", "max", "min", "top_n", "year_over_year"\]\)/);
  assert.match(source, /replace\(\/\\s\+•\\s\+\/g, "\\n• "\)/);
  assert.match(source, /function normalizeChatMarkdownText/);
  assert.match(source, /function formatDenseYoYComparisonBullets/);
  assert.match(source, /год к году\|г\\\/г\|р\\\/р/);
  assert.match(source, /replace\(\/;\\s\+\(\?=\\d\{4\}\\s\+\(\?:год\|рік\|year\)\\b\)\/gi, "\\n• "\)/);
  assert.match(source, /replace\(\/,\\s\+\(\?=\\d\{4\}\\s\+vs\\s\+\\d\{4\}\\b\)\/gi, "\\n• "\)/);
  assert.ok(source.indexOf("formatDenseYoYComparisonBullets(text)") < source.indexOf("if (!text.includes(\"\\n\") && /\\d\\.\\d/.test(text)) return text;"));
  assert.match(source, /replace\(\/\\s\+\\\*\\\*\(\[\^\*\\n:\]\{1,80\}\):\\\*\\\*\/g, "\\n\$1:"\)/);
  assert.match(source, /replace\(\/\\\*\\\*\(\[\^\*\\n\]\+\)\\\*\\\*\/g, "\$1"\)/);
  assert.match(source, /bestYear\.change_percent >= 0/);
  assert.match(source, /function dropImplicitTrailingPartialYear/);
  assert.match(source, /shouldIncludeTrailingPartialYear\(queryText, latestYear/);
  assert.match(source, /replace\(\/\\\\r\?\\\\n\/g, "\\n"\)/);
});

test("chat driver ranking queries infer revenue metric and grouping dimension", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const controllerPath = path.join(__dirname, "..", "src", "controllers", "chatController.js");
  const source = fs.readFileSync(controllerPath, "utf8");

  assert.match(source, /function isDriverRankingQuery\(message = ""\)/);
  assert.match(source, /drivers\?\|drives\|contributors\?/);
  assert.match(source, /const asksDriverRanking = isDriverRankingQuery\(message\)/);
  assert.match(source, /resolvedOperation = "top_n"/);
  assert.match(source, /const profileMetric = resolveProfileMetric\(semanticProfile, message, \[ai\?\.target_column, ai\?\.chart\?\.value_column\]\)/);
  assert.match(source, /resolvedTarget = profileMetric\s+\|\|\s+inferLikelyMetricColumn\(aiHeaders, sampleRows, message, \[ai\?\.target_column, ai\?\.chart\?\.value_column\]\)/);
  assert.match(source, /resolvedGroupBy = resolveProfileDimension\(semanticProfile, message, \[resolvedTarget, ai\?\.target_column, ai\?\.chart\?\.value_column\]\)/);
  assert.match(source, /resolvedOperation === "top_n" && \(!resolvedTarget \|\| !resolvedGroupBy\)/);
  assert.match(source, /function inferLikelyMetricColumn/);
  assert.match(source, /isUsableMetricColumn/);
  assert.match(source, /numericHits >= Math\.max\(1, Math\.ceil\(samples\.length \/ 3\)\)/);
  assert.match(source, /revenue growth\|sales growth\|income growth/);
});

test("insight feed locale changes force fresh translation and avoid caching unchanged cards", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const insightPath = path.join(__dirname, "..", "src", "controllers", "insightController.js");
  const feedPath = path.join(__dirname, "..", "..", "frontend", "src", "components", "dashboard", "InsightFeed.jsx");
  const copyPath = path.join(__dirname, "..", "..", "frontend", "src", "hooks", "useDashboardI18n.js");
  const insightSource = fs.readFileSync(insightPath, "utf8");
  const feedSource = fs.readFileSync(feedPath, "utf8");
  const copySource = fs.readFileSync(copyPath, "utf8");

  assert.match(insightSource, /function insightCardTextSignature/);
  assert.match(insightSource, /localized = insightCardTextSignature\(cards \|\| \[\]\) !== insightCardTextSignature\(translatedCards\)/);
  assert.match(insightSource, /source: "untranslated"/);
  assert.match(insightSource, /localizationSource: localization\.source/);
  assert.match(feedSource, /previousLocaleRef/);
  assert.match(feedSource, /requestSeqRef/);
  assert.match(feedSource, /switchedSheet \|\| switchedLocale/);
  assert.match(feedSource, /loadInsights\(\{ forceRefresh: true \}\)/);
  assert.match(feedSource, /ui\.warningDown/);
  assert.match(feedSource, /copy\.drivers/);
  assert.match(copySource, /warningDown: "Warning Down"/);
  assert.match(copySource, /drivers: "Drivers"/);
});

test("customer AI query quota is entitlement backed and enforced before chat AI calls", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const chatPath = path.join(__dirname, "..", "src", "controllers", "chatController.js");
  const quotaPath = path.join(__dirname, "..", "src", "utils", "aiQuota.js");
  const dbPath = path.join(__dirname, "..", "src", "config", "db.js");
  const uiPath = path.join(__dirname, "..", "..", "frontend", "src", "UserManagement.jsx");
  const envPath = path.join(__dirname, "..", "..", ".env.example");
  const chatSource = fs.readFileSync(chatPath, "utf8");
  const quotaSource = fs.readFileSync(quotaPath, "utf8");
  const dbSource = fs.readFileSync(dbPath, "utf8");
  const uiSource = fs.readFileSync(uiPath, "utf8");
  const env = fs.readFileSync(envPath, "utf8");

  assert.match(dbSource, /CREATE TABLE IF NOT EXISTS ai_usage_monthly/);
  assert.match(quotaSource, /maxAiQueriesPerMonth/);
  assert.match(quotaSource, /aiMonthlyBudgetUsd/);
  assert.match(quotaSource, /ai_query_quota_exceeded/);
  assert.match(quotaSource, /ai_budget_quota_exceeded/);
  assert.match(chatSource, /reserveAiQueryForSheet\(\{ sheetId, user: req\.user, kind: "chat_query" \}\)/);
  assert.match(chatSource, /recordAiUsage\(\{/);
  assert.match(uiSource, /AI Queries \/ Month/);
  assert.match(uiSource, /AI Budget \/ Month \(\$\)/);
  assert.match(env, /OPENAI_INPUT_COST_PER_1M=0\.05/);
  assert.match(env, /OPENAI_OUTPUT_COST_PER_1M=0\.40/);
});

test("admin AI usage stats use OpenAI costs instead of local estimates for totals", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const repoRoot = path.resolve(__dirname, "..", "..");
  const userControllerPath = path.join(repoRoot, "backend", "src", "controllers", "userController.js");
  const openAiUsagePath = path.join(repoRoot, "backend", "src", "utils", "openAiUsage.js");
  const uiPath = path.join(repoRoot, "frontend", "src", "components", "admin", "IntegrationSettingsPanel.jsx");
  const envPath = path.join(repoRoot, ".env.example");

  const controllerSource = fs.readFileSync(userControllerPath, "utf8");
  const usageSource = fs.readFileSync(openAiUsagePath, "utf8");
  const uiSource = fs.readFileSync(uiPath, "utf8");
  const env = fs.readFileSync(envPath, "utf8");

  assert.match(controllerSource, /fetchOpenAiOrganizationUsageSummary\(periodMonth\)/);
  assert.match(controllerSource, /actualCostUsd: openAiUsage \? Number\(openAiUsage\.costUsd \|\| 0\) : null/);
  assert.match(controllerSource, /appLocal: \{/);
  assert.match(usageSource, /\/organization\/costs/);
  assert.match(usageSource, /\/organization\/usage\/completions/);
  assert.match(usageSource, /\/organization\/usage\/audio_speeches/);
  assert.match(usageSource, /OPENAI_ADMIN_API_KEY \|\| process\.env\.OPENAI_USAGE_API_KEY/);
  assert.match(usageSource, /openai_usage_api_key_missing/);
  assert.match(usageSource, /openai_usage_key_unauthorized/);
  assert.match(usageSource, /OpenAI admin key with organization usage and costs access/);
  assert.doesNotMatch(usageSource, /OPENAI_API_KEY \|\| ""/);
  assert.match(controllerSource, /code: openAiErrorCode/);
  assert.match(uiSource, /OpenAI Actual Cost/);
  assert.match(uiSource, /App Estimate/);
  assert.match(uiSource, /OpenAI usage unavailable/);
  assert.match(env, /OPENAI_ADMIN_API_KEY=your_openai_admin_key_here/);
});

test("unique values endpoint applies row filters before distinct sampling", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const controllerPath = path.join(__dirname, "..", "src", "controllers", "sheetController.js");
  const source = fs.readFileSync(controllerPath, "utf8");

  assert.match(source, /resolveAssignedViewForSheet\(/);
  assert.match(source, /resolveViewColumnAllowlist\(/);
  assert.match(source, /rowFiltersList\.push\(filters\)/);
  assert.match(source, /Security: row filters must be applied before sampling\/distinct/);
});

test("import approval, job status, and audit routes are wired", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const sheetRoutesPath = path.join(__dirname, "..", "src", "routes", "sheetRoutes.js");
  const userRoutesPath = path.join(__dirname, "..", "src", "routes", "userRoutes.js");
  const sheetRoutes = fs.readFileSync(sheetRoutesPath, "utf8");
  const userRoutes = fs.readFileSync(userRoutesPath, "utf8");

  assert.match(sheetRoutes, /router\.get\("\/import-jobs"/);
  assert.match(sheetRoutes, /router\.get\("\/import-jobs\/:id"/);
  assert.match(sheetRoutes, /router\.post\("\/report-source-imports\/:id\/publish"/);
  assert.match(sheetRoutes, /router\.post\("\/report-source-imports\/:id\/reject"/);
  assert.match(userRoutes, /router\.get\("\/audit-logs"/);
});

test("deleteSheet cleans related views and import references transactionally", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const controllerPath = path.join(__dirname, "..", "src", "controllers", "sheetController.js");
  const source = fs.readFileSync(controllerPath, "utf8");

  assert.match(source, /export async function deleteSheet/);
  assert.match(source, /await client\.query\("BEGIN"\)/);
  assert.match(source, /SELECT id FROM sheets WHERE id = \$1 LIMIT 1 FOR UPDATE/);
  assert.match(source, /SELECT id FROM report_source_imports WHERE sheet_id = \$1 FOR UPDATE/);
  assert.match(source, /DELETE FROM view_user_permissions WHERE view_id = ANY/);
  assert.doesNotMatch(source, /DELETE FROM view_group_permissions WHERE view_id = ANY/);
  assert.match(source, /UPDATE report_sources SET current_sheet_id = NULL WHERE current_sheet_id = \$1/);
  assert.match(source, /UPDATE import_jobs[\s\S]*WHERE import_id = ANY\(\$1::int\[\]\)/);
  assert.match(source, /DELETE FROM report_source_imports WHERE id = ANY\(\$1::int\[\]\)/);
  assert.match(source, /UPDATE import_jobs[\s\S]*WHERE sheet_id = \$1/);
  assert.match(source, /DELETE FROM sheets WHERE id = \$1/);
  assert.match(source, /await client\.query\("COMMIT"\)/);
});

test("database init creates import job, approval, and audit log schema", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const dbPath = path.join(__dirname, "..", "src", "config", "db.js");
  const source = fs.readFileSync(dbPath, "utf8");

  assert.match(source, /CREATE TABLE IF NOT EXISTS import_jobs/);
  assert.match(source, /CREATE TABLE IF NOT EXISTS import_job_payloads/);
  assert.match(source, /ALTER TABLE import_jobs ADD COLUMN IF NOT EXISTS attempts/);
  assert.match(source, /ALTER TABLE import_jobs ADD COLUMN IF NOT EXISTS lease_expires_at/);
  assert.match(source, /CREATE TABLE IF NOT EXISTS audit_logs/);
  assert.match(source, /ALTER TABLE report_source_imports ADD COLUMN IF NOT EXISTS status/);
  assert.match(source, /ALTER TABLE report_source_imports ADD COLUMN IF NOT EXISTS published_at/);
  assert.match(source, /ALTER TABLE report_source_imports ADD COLUMN IF NOT EXISTS rejected_at/);
  assert.match(source, /ALTER TABLE report_source_imports ADD COLUMN IF NOT EXISTS job_id/);
});

test("database init includes report source autosync state and indexes", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const dbPath = path.join(__dirname, "..", "src", "config", "db.js");
  const source = fs.readFileSync(dbPath, "utf8");

  assert.match(source, /ALTER TABLE report_sources ADD COLUMN IF NOT EXISTS sync_enabled BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(source, /ALTER TABLE report_sources ADD COLUMN IF NOT EXISTS sync_provider TEXT/);
  assert.match(source, /ALTER TABLE report_sources ADD COLUMN IF NOT EXISTS sync_source_ref TEXT/);
  assert.match(source, /ALTER TABLE report_sources ADD COLUMN IF NOT EXISTS sync_remote_marker TEXT/);
  assert.match(source, /ALTER TABLE report_sources ADD COLUMN IF NOT EXISTS sync_last_attempted_marker TEXT/);
  assert.match(source, /CREATE INDEX IF NOT EXISTS idx_report_sources_autosync_enabled ON report_sources\(sync_enabled, sync_provider, sync_group_id\)/);
});

test("report source autosync can be toggled after import from the source picker UI", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(__filename), "..", "..");
  const sheetRoutesPath = path.join(repoRoot, "backend", "src", "routes", "sheetRoutes.js");
  const sheetControllerPath = path.join(repoRoot, "backend", "src", "controllers", "sheetController.js");
  const dashboardBodyPath = path.join(repoRoot, "frontend", "src", "components", "dashboard", "DashboardBody.jsx");
  const appPath = path.join(repoRoot, "frontend", "src", "App.jsx");

  const routesSource = fs.readFileSync(sheetRoutesPath, "utf8");
  const controllerSource = fs.readFileSync(sheetControllerPath, "utf8");
  const dashboardSource = fs.readFileSync(dashboardBodyPath, "utf8");
  const appSource = fs.readFileSync(appPath, "utf8");

  assert.match(routesSource, /router\.patch\("\/report-sources\/:id\/autosync", asyncHandler\(updateReportSourceAutosync\)\)/);
  assert.match(controllerSource, /export async function updateReportSourceAutosync\(req, res\)/);
  assert.match(controllerSource, /autosync_source_not_configured/);
  assert.match(dashboardSource, /toggleReportSourceAutosync/);
  assert.match(dashboardSource, /Autosync ON/);
  assert.match(dashboardSource, /Autosync OFF/);
  assert.match(appSource, /refreshReportSources={refreshReportSources}/);
});

test("autosync worker is started and stopped with server lifecycle", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const serverPath = path.join(__dirname, "..", "server.js");
  const source = fs.readFileSync(serverPath, "utf8");

  assert.match(source, /startReportSourceAutosyncWorker/);
  assert.match(source, /stopReportSourceAutosyncWorker/);
  assert.match(source, /startReportSourceAutosyncWorker\(\);/);
  assert.match(source, /await stopReportSourceAutosyncWorker\(\);/);
});

test("uploads support durable async db queue with sync fallback", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const controllerPath = path.join(__dirname, "..", "src", "controllers", "sheetController.js");
  const envPath = path.join(__dirname, "..", "..", ".env.example");
  const source = fs.readFileSync(controllerPath, "utf8");
  const env = fs.readFileSync(envPath, "utf8");

  assert.match(source, /function uploadRequiresApproval\(req\)/);
  assert.match(source, /function uploadUsesDbQueue\(req\)/);
  assert.match(source, /async function enqueueDbImportJob/);
  assert.match(source, /export function startImportJobWorker/);
  assert.match(source, /return res\.status\(202\)\.json\(\{/);
  assert.match(source, /status: "queued"/);
  assert.match(source, /IMPORT_REQUIRE_APPROVAL/);
  assert.doesNotMatch(source, /setImmediate\(/);
  assert.match(env, /IMPORT_REQUIRE_APPROVAL=false/);
  assert.match(env, /IMPORT_DB_QUEUE_ENABLED=true/);
  assert.match(env, /IMPORT_JOB_MAX_ATTEMPTS=3/);
  assert.match(env, /AUDIT_LOG_MAX_METADATA_BYTES=8192/);
});

test("provider imports carry autosync metadata and stable Dropbox file ids", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(__filename), "..", "..");
  const appPath = path.join(repoRoot, "frontend", "src", "App.jsx");
  const dashboardBodyPath = path.join(repoRoot, "frontend", "src", "components", "dashboard", "DashboardBody.jsx");
  const googleControllerPath = path.join(repoRoot, "backend", "src", "controllers", "googleController.js");
  const dropboxControllerPath = path.join(repoRoot, "backend", "src", "controllers", "dropboxController.js");
  const onedriveControllerPath = path.join(repoRoot, "backend", "src", "controllers", "onedriveController.js");

  const appSource = fs.readFileSync(appPath, "utf8");
  const dashboardSource = fs.readFileSync(dashboardBodyPath, "utf8");
  const googleSource = fs.readFileSync(googleControllerPath, "utf8");
  const dropboxSource = fs.readFileSync(dropboxControllerPath, "utf8");
  const onedriveSource = fs.readFileSync(onedriveControllerPath, "utf8");

  assert.match(appSource, /autosync_enabled: autosyncEnabled \? "1" : "0"/);
  assert.match(appSource, /fileId,\n\s*name,/);
  assert.match(dashboardSource, /Auto-sync this source when the file changes/);
  assert.match(dashboardSource, /fileId: selectedDropboxFile\.id/);
  assert.match(googleSource, /autosync_provider: "google_drive"/);
  assert.match(dropboxSource, /autosync_provider: "dropbox"/);
  assert.match(dropboxSource, /const fileId = String\(req\.body\?\.fileId/);
  assert.match(onedriveSource, /autosync_provider: "onedrive"/);
});

test("prometheus route labels are normalized to avoid object id cardinality", async () => {
  const mod = await import(`../src/utils/metrics.js?t=${Date.now()}_labels`);

  assert.equal(mod.normalizeRouteLabel("/sheets/123/data"), "/sheets/:id/data");
  assert.equal(
    mod.normalizeRouteLabel("/views/550e8400-e29b-41d4-a716-446655440000"),
    "/views/:uuid"
  );
});

test("database pool has explicit env-driven limits and timeouts", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const dbPath = path.join(__dirname, "..", "src", "config", "db.js");
  const source = fs.readFileSync(dbPath, "utf8");

  assert.match(source, /DB_POOL_MAX/);
  assert.match(source, /DB_POOL_IDLE_TIMEOUT_MS/);
  assert.match(source, /DB_QUERY_TIMEOUT_MS/);
  assert.match(source, /DB_STATEMENT_TIMEOUT_MS/);
});

test("chat backend applies active dashboard filters to AI execution", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const controllerPath = path.join(__dirname, "..", "src", "controllers", "chatController.js");
  const source = fs.readFileSync(controllerPath, "utf8");

  assert.match(source, /function normalizeActiveDashboardFilters/);
  assert.match(source, /const \{ sheetId, activeTab = null, message, activeFilters = \{\}/);
  assert.match(source, /const activeDashboardFilters = normalizeActiveDashboardFilters\(aiHeaders, activeFilters\);/);
  assert.match(source, /const sampleRows = applyFilters\(scopedSampleRows, activeDashboardFilters\);/);
  assert.match(source, /const executionFilters = \[\.\.\.activeDashboardFilters, \.\.\.filteredAiFilters\];/);
  assert.match(source, /case 'equals'/);
});

test("dashboard chat responses are read-only unless explicitly opted into ui actions", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(__filename), "..", "..");
  const hookPath = path.join(repoRoot, "frontend", "src", "hooks", "useChatbotLogic.js");
  const source = fs.readFileSync(hookPath, "utf8");

  assert.match(source, /const allowUiActions = meta\?\.applyActions !== false;/);
  assert.match(source, /if \(!allowUiActions \|\| !onApplyFilter\) return \{ filters: \[\], reset_filters: false \};/);
  assert.match(source, /if \(actions\.reset_filters\) \{/);
  assert.match(source, /if \(filters\.length\) \{/);
  assert.match(source, /if \(onUpdateChart && actions\.chart && actions\.chart\.valueColumn\)/);
});

test("chat fallback path automatically tries direct aggregates before full in-memory analysis", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const controllerPath = path.join(__dirname, "..", "src", "controllers", "chatController.js");
  const source = fs.readFileSync(controllerPath, "utf8");

  assert.match(source, /const CHAT_MAX_ROWS = Math\.min\(100000, Number\.parseInt\(process\.env\.CHAT_MAX_ROWS \|\| "50000", 10\)\);/);
  assert.match(source, /const effectiveLimit = rowLimit \|\| \(CHAT_MAX_ROWS \+ 1\);/);
  assert.match(source, /function inferAggregateOperationFromMessage\(message = "", ai = \{\}\)/);
  assert.match(source, /function inferLikelyMetricColumn\(headers = \[\], sampleRows = \[\], message = "", candidates = \[\]\)/);
  assert.match(source, /function inferLikelyDimensionColumn\(headers = \[\], sampleRows = \[\], excludedColumns = \[\]\)/);
  assert.match(source, /function inferLikelyPeriodColumn\(headers = \[\], sampleRows = \[\], candidates = \[\]\)/);
  assert.match(source, /const fallback = await computeLargeDatasetAggregateFallback\(/);
  assert.match(source, /operation: resolvedOperation,/);
  assert.match(source, /targetColumn: resolvedTarget,/);
  assert.match(source, /groupBy: resolvedGroupBy,/);
  assert.match(source, /error: "chat_dataset_too_large"/);
});

test("client spreadsheet exports neutralize formula injection values", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(__filename), "..", "..");
  const appPath = path.join(repoRoot, "frontend", "src", "App.jsx");
  const source = fs.readFileSync(appPath, "utf8");

  assert.match(source, /sanitizeSpreadsheetExportValue/);
  assert.match(source, /\^\[\\s\]\*\[=\+\\-@\]/);
  assert.match(source, /json_to_sheet\(sanitizeSpreadsheetExportRows\(sortedData\)\)/);
});

test("pivot chart uses raw grouped values and supports count without a value column", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(__filename), "..", "..");
  const appPath = path.join(repoRoot, "frontend", "src", "App.jsx");
  const overlayPath = path.join(repoRoot, "frontend", "src", "components", "dashboard", "PivotOverlay.jsx");
  const appSource = fs.readFileSync(appPath, "utf8");
  const overlaySource = fs.readFileSync(overlayPath, "utf8");

  assert.match(appSource, /const isCountAgg = pivotAgg === "count" \|\| pivotAgg === "Count"/);
  assert.match(appSource, /!pivotOn \|\| !pivotRowKey \|\| \(!isCountAgg && !pivotValKey\) \|\| !sortedData\.length/);
  assert.match(appSource, /const rowTotals = \{\}/);
  assert.match(appSource, /rowTotals\[rVal\]\.sum \+= val/);
  assert.match(appSource, /rowTotals\[rVal\]\.count \+= 1/);
  assert.match(appSource, /Object\.entries\(rowTotals\)/);
  assert.match(appSource, /entry\.count > 0 \? entry\.sum \/ entry\.count : 0/);
  assert.match(appSource, /Math\.abs\(b\.value \|\| 0\) - Math\.abs\(a\.value \|\| 0\)/);
  assert.match(overlaySource, /const pivotValueLabel = pivotAgg === "count" \? "Count" : \(pivotValKey \|\| "Value"\)/);
  assert.match(overlaySource, /<Bar dataKey="value" name=\{pivotValueLabel\}/);
  assert.match(overlaySource, /formatSmart\(row\[h\], j > 0 \? pivotValueLabel : h\)/);
});

test("insights push row filters and column projection into SQL", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const controllerPath = path.join(__dirname, "..", "src", "controllers", "insightController.js");
  const source = fs.readFileSync(controllerPath, "utf8");

  assert.match(source, /function buildRowFilterWhereClause/);
  assert.match(source, /SELECT \$\{columnSelection\} AS row_data FROM sheet_rows \$\{where\}/);
  assert.match(source, /WHERE key = ANY\(\$/);
  assert.doesNotMatch(source, /rows = rows\.filter\(\(rowData\)/);
});

test("insight AI prompts use compact bounded context", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const controllerPath = path.join(__dirname, "..", "src", "controllers", "insightController.js");
  const envPath = path.join(__dirname, "..", "..", ".env.example");
  const source = fs.readFileSync(controllerPath, "utf8");
  const env = fs.readFileSync(envPath, "utf8");

  assert.match(source, /const INSIGHT_AI_MAX_SERIES_POINTS = Number\.parseInt/);
  assert.match(source, /const INSIGHT_AI_MAX_PROMPT_CHARS = Number\.parseInt/);
  assert.match(source, /function compactInsightSeries\(series/);
  assert.match(source, /history_series: compactSeries/);
  assert.doesNotMatch(source, /original_history_series: series/);
  assert.match(source, /forecast ai skipped: prompt_chars=/);
  assert.match(source, /recommendations ai skipped: prompt_chars=/);
  assert.match(env, /INSIGHT_AI_MAX_SERIES_POINTS=18/);
  assert.match(env, /INSIGHT_AI_MAX_PROMPT_CHARS=12000/);
});

test("generated commodity market insight route is removed", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const controllerPath = path.join(__dirname, "..", "src", "controllers", "insightController.js");
  const routesPath = path.join(__dirname, "..", "src", "routes", "insightRoutes.js");
  const controllerSource = fs.readFileSync(controllerPath, "utf8");
  const routesSource = fs.readFileSync(routesPath, "utf8");

  assert.doesNotMatch(controllerSource, /AI Live|current trucking fuel|realistic current trucking/);
  assert.doesNotMatch(routesSource, /\/insights\/market\//);
});

test("xlsx worker strips workbook formulas and sheet metadata before import rows", async () => {
  const XLSX = await import("xlsx");
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const workerPath = path.join(__dirname, "..", "src", "utils", "xlsxWorker.js");

  const ws = XLSX.utils.aoa_to_sheet([["Name", "Total"], ["Client A", 2]]);
  ws.B2 = { t: "n", f: "1+1", v: 2, w: "2", s: { font: { bold: true } }, c: [{ t: "comment" }] };
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }];
  ws["!autofilter"] = { ref: "A1:B2" };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Dirty\u0000 Sheet");
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  const result = await new Promise((resolve, reject) => {
    const worker = new Worker(workerPath, { workerData: { buffer } });
    worker.once("message", (msg) => msg.success ? resolve(msg.result) : reject(new Error(msg.error)));
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code !== 0) reject(new Error(`worker_exit_${code}`));
    });
  });

  assert.deepEqual(result.sheetNames, ["Dirty Sheet"]);
  assert.deepEqual(result.sheets["Dirty Sheet"], [{ Name: "Client A", Total: "2" }]);
  assert.equal(JSON.stringify(result).includes("1+1"), false);
  assert.ok(Number(result.cleanup.metadataEntriesStripped) >= 1);
});

test("xlsx worker rejects files that exceed the configured parse memory limit", async () => {
  const XLSX = await import("xlsx");
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const workerPath = path.join(__dirname, "..", "src", "utils", "xlsxWorker.js");

  const ws = XLSX.utils.aoa_to_sheet([["Name"], ["Client A"]]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet 1");
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  const msg = await new Promise((resolve, reject) => {
    const worker = new Worker(workerPath, { workerData: { buffer, memoryLimitMb: 1 } });
    worker.once("message", resolve);
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code !== 0) resolve({ success: false, error: "xlsx_worker_memory_limit_exceeded" });
    });
  });

  assert.equal(msg.success, false);
  assert.equal(msg.error, "xlsx_worker_memory_limit_exceeded");
});

test("limited customer admin entitlements are persisted on groups", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const dbPath = path.join(__dirname, "..", "src", "config", "db.js");
  const controllerPath = path.join(__dirname, "..", "src", "controllers", "userController.js");
  const dbSource = fs.readFileSync(dbPath, "utf8");
  const controllerSource = fs.readFileSync(controllerPath, "utf8");

  assert.match(dbSource, /ALTER TABLE groups ADD COLUMN IF NOT EXISTS entitlements JSONB NOT NULL DEFAULT '\{\}'::jsonb/);
  assert.match(controllerSource, /INSERT INTO groups \(/);
  assert.match(controllerSource, /customer_first_name, customer_last_name, customer_company_name, customer_email, customer_phone/);
  assert.match(controllerSource, /entitlements = COALESCE\(\$4::jsonb, entitlements\)/);
});

test("customer admin user management is group scoped and entitlement gated", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const controllerPath = path.join(__dirname, "..", "src", "controllers", "userController.js");
  const source = fs.readFileSync(controllerPath, "utf8");

  assert.match(source, /if \(desiredRole !== "user"\) return res\.status\(403\)/);
  assert.match(source, /managed_group_required/);
  assert.match(source, /assertGroupUserLimitAvailable\(targetGroupId, 1\)/);
  assert.match(source, /function assertGroupsCanManageUsers/);
  assert.match(source, /feature_not_enabled:manageUsers/);
  assert.match(source, /group_user_limit_exceeded/);
});

test("customer admin promotion requires explicit entitlement and frontend exposes toggles", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(__filename), "..", "..");
  const controllerPath = path.join(repoRoot, "backend", "src", "controllers", "userController.js");
  const uiPath = path.join(repoRoot, "frontend", "src", "UserManagement.jsx");
  const uiConfigPath = path.join(repoRoot, "frontend", "src", "components", "admin", "userManagementConfig.js");
  const controllerSource = fs.readFileSync(controllerPath, "utf8");
  const uiSource = fs.readFileSync(uiPath, "utf8");
  const uiConfigSource = fs.readFileSync(uiConfigPath, "utf8");

  assert.match(controllerSource, /feature_not_enabled:manageGroupAdmins/);
  assert.match(controllerSource, /groupHasFeature\(group, "manageGroupAdmins"\)/);
  assert.match(uiConfigSource, /DEFAULT_GROUP_ENTITLEMENTS/);
  assert.match(uiConfigSource, /maxUsers/);
  assert.match(uiConfigSource, /manageGroupAdmins/);
  assert.match(uiSource, /groupId: selectedGroupId/);
});

test("customer product bundles expose editable user and source limits", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(__filename), "..", "..");
  const uiPath = path.join(repoRoot, "frontend", "src", "UserManagement.jsx");
  const uiSource = fs.readFileSync(uiPath, "utf8");

  assert.match(uiSource, /const BUNDLE_DEFAULT_CAPACITY_LIMITS = \{/);
  assert.match(uiSource, /core: \{ maxUsers: 10, maxReportSources: 3 \}/);
  assert.match(uiSource, /growth: \{ maxUsers: 50, maxReportSources: 15 \}/);
  assert.match(uiSource, /enterprise: \{ maxUsers: 250, maxReportSources: 100 \}/);
  assert.match(uiSource, /const ensureBundleCapacityLimits = \(bundleCapacityLimits, fallbackLimits = \{\}\) =>/);
  assert.match(uiSource, /bundleCapacityLimits/);
  assert.match(uiSource, /Max Users/);
  assert.match(uiSource, /Max Sources/);
  assert.match(uiSource, /\[bundleTier\]: currentCapacity/);
  assert.match(uiSource, /maxUsers: activeCapacityLimits\.maxUsers === "" \? null : Number\(activeCapacityLimits\.maxUsers\)/);
  assert.doesNotMatch(uiSource, /const capacityLimits = BUNDLE_CAPACITY_LIMITS\[bundle\.key\] \|\| \{\}/);
});

test("customer bundle capacity limits are explicitly normalized server-side", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(__filename), "..", "..");
  const entitlementsPath = path.join(repoRoot, "backend", "src", "utils", "entitlements.js");
  const source = fs.readFileSync(entitlementsPath, "utf8");

  assert.match(source, /const PRODUCT_BUNDLE_KEYS = new Set\(\["core", "growth", "enterprise"\]\)/);
  assert.match(source, /function normalizeBundleCapacityLimits\(raw = \{\}\)/);
  assert.match(source, /maxUsers: normalizePositiveIntOrNull\(src\.maxUsers\)/);
  assert.match(source, /maxReportSources: normalizePositiveIntOrNull\(src\.maxReportSources\)/);
  assert.match(source, /bundleCapacityLimits: normalizeBundleCapacityLimits\(raw\.bundleCapacityLimits\)/);
  assert.doesNotMatch(source, /\.\.\.raw,/);
});

test("max report sources entitlement is enforced before creating new sources", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const controllerPath = path.join(__dirname, "..", "src", "controllers", "sheetController.js");
  const source = fs.readFileSync(controllerPath, "utf8");

  assert.match(source, /async function assertReportSourceLimitAvailable\(client, groupId\)/);
  assert.match(source, /SELECT id, entitlements FROM groups WHERE id = \$1 LIMIT 1 FOR UPDATE/);
  assert.match(source, /COUNT\(DISTINCT rs\.id\)::int AS c/);
  assert.match(source, /rs\.is_inferred IS NOT TRUE/);
  assert.match(source, /rs\.sync_group_id = \$1/);
  assert.match(source, /ug\.group_id = \$1/);
  assert.match(source, /group_report_source_limit_exceeded/);
  assert.match(source, /await assertReportSourceLimitAvailable\(client, groupId\);/);
  assert.match(source, /await assertReportSourceLimitAvailable\(client, targetGroupId\);/);
  assert.match(source, /autosyncConfig\.groupId/);
});

test("dashboard translation endpoint bounds request size before reserving AI quota", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const controllerPath = path.join(__dirname, "..", "src", "controllers", "localeController.js");
  const source = fs.readFileSync(controllerPath, "utf8");

  assert.match(source, /import \{ isAiGloballyDisabled, loadAiRuntimeSettings \} from "\.\.\/utils\/aiRuntimeSettings\.js";/);
  assert.match(source, /dashboardTranslateMaxItems/);
  assert.match(source, /dashboardTranslateMaxCharsPerItem/);
  assert.match(source, /dashboard_translate_too_many_items/);
  assert.match(source, /dashboard_translate_item_too_large/);
  assert.match(source, /const normalizedItems = items\.map/);
  assert.match(source, /isAiGloballyDisabled\(runtime\)/);
  assert.match(source, /runtime\?\.dashboardTranslationEnabled !== true/);
  assert.match(source, /await reserveAiQueryForUser\(\{ user: req\.user, kind: "dashboard_translate" \}\)/);
  assert.ok(source.indexOf("isAiGloballyDisabled(runtime)") < source.indexOf("reservation = await reserveAiQueryForUser"));
  assert.ok(source.indexOf("runtime?.dashboardTranslationEnabled !== true") < source.indexOf("reservation = await reserveAiQueryForUser"));
  assert.ok(source.indexOf("dashboard_translate_too_many_items") < source.indexOf("reservation = await reserveAiQueryForUser"));
  assert.ok(source.indexOf("dashboard_translate_item_too_large") < source.indexOf("reservation = await reserveAiQueryForUser"));
});

test("AI spending features are default-off and visible in admin runtime controls", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(__filename), "..", "..");
  const runtimePath = path.join(repoRoot, "backend", "src", "utils", "aiRuntimeSettings.js");
  const featureTogglesPath = path.join(repoRoot, "backend", "src", "utils", "aiFeatureToggles.js");
  const chatControllerPath = path.join(repoRoot, "backend", "src", "controllers", "chatController.js");
  const insightControllerPath = path.join(repoRoot, "backend", "src", "controllers", "insightController.js");
  const dashboardLocalizationPath = path.join(repoRoot, "backend", "src", "utils", "dashboardLocalization.js");
  const uiPath = path.join(repoRoot, "frontend", "src", "components", "admin", "IntegrationSettingsPanel.jsx");
  const adminPath = path.join(repoRoot, "frontend", "src", "UserManagement.jsx");

  const runtimeSource = fs.readFileSync(runtimePath, "utf8");
  const featureTogglesSource = fs.readFileSync(featureTogglesPath, "utf8");
  const chatSource = fs.readFileSync(chatControllerPath, "utf8");
  const chatQueryBody = chatSource.slice(
    chatSource.indexOf("export async function chatQuery")
  );
  const chatAudioBody = chatSource.slice(
    chatSource.indexOf("export async function getChatAudio"),
    chatSource.indexOf("export async function synthesizeChatAudioBuffer")
  );
  const insightSource = fs.readFileSync(insightControllerPath, "utf8");
  const dashboardLocalizationSource = fs.readFileSync(dashboardLocalizationPath, "utf8");
  const uiSource = fs.readFileSync(uiPath, "utf8");
  const adminSource = fs.readFileSync(adminPath, "utf8");

  assert.match(runtimeSource, /globalAiDisabled: false/);
  assert.match(runtimeSource, /return runtime\?\.globalAiDisabled === true/);
  assert.match(runtimeSource, /chatEnabled: false/);
  assert.match(runtimeSource, /chatAudioEnabled: false/);
  assert.match(runtimeSource, /dashboardTranslationEnabled: false/);
  assert.match(runtimeSource, /businessClassificationEnabled: false/);
  assert.match(runtimeSource, /insightAiEnabled: false/);
  assert.match(featureTogglesSource, /chatEnabled: raw\?\.chatEnabled === true/);
  assert.match(featureTogglesSource, /dashboardTranslationEnabled: raw\?\.dashboardTranslationEnabled === true/);
  assert.match(featureTogglesSource, /chatAudioEnabled: raw\?\.chatAudioEnabled === true/);
  assert.match(chatSource, /resolveAiGroupIdForSheet/);
  assert.match(chatSource, /isAiGloballyDisabled\(runtime\)/);
  assert.match(chatQueryBody, /if \(!runtime\.chatEnabled\) return res\.status\(403\)\.json\(\{ error: "chat_disabled" \}\)/);
  assert.ok(chatQueryBody.indexOf("isAiGloballyDisabled(runtime)") < chatQueryBody.indexOf("reserveAiQueryForSheet({ sheetId"));
  assert.ok(chatQueryBody.indexOf("if (!runtime.chatEnabled)") < chatQueryBody.indexOf("reserveAiQueryForSheet({ sheetId"));
  assert.ok(chatQueryBody.indexOf("feature_not_enabled:chatAi") < chatQueryBody.indexOf("reserveAiQueryForSheet({ sheetId"));
  assert.match(chatAudioBody, /if \(!runtime\.chatAudioEnabled\) return res\.status\(403\)\.json\(\{ error: "chat_audio_disabled" \}\)/);
  assert.ok(chatAudioBody.indexOf("isAiGloballyDisabled(runtime)") < chatAudioBody.indexOf('reserveAiQueryForSheet({ sheetId, user: req.user, kind: "chat_audio" })'));
  assert.ok(chatAudioBody.indexOf("if (!runtime.chatAudioEnabled)") < chatAudioBody.indexOf('reserveAiQueryForSheet({ sheetId, user: req.user, kind: "chat_audio" })'));
  assert.ok(chatAudioBody.indexOf("feature_not_enabled:chatAudioAi") < chatAudioBody.indexOf('reserveAiQueryForSheet({ sheetId, user: req.user, kind: "chat_audio" })'));
  assert.match(insightSource, /runtime\?\.insightAiEnabled !== true/);
  assert.match(insightSource, /runtime\?\.dashboardTranslationEnabled !== true/);
  assert.match(insightSource, /runtime\?\.chatAudioEnabled !== true/);
  assert.match(dashboardLocalizationSource, /runtime\?\.dashboardTranslationEnabled !== true/);
  assert.match(dashboardLocalizationSource, /isAiGloballyDisabled\(runtime\)/);
  assert.match(uiSource, /Global AI Disabled/);
  assert.match(uiSource, /checked=\{aiRuntimeSettings\.globalAiDisabled === true\}/);
  assert.match(uiSource, /disabled=\{aiRuntimeSettings\.globalAiDisabled === true\} checked=\{aiRuntimeSettings\.chatEnabled === true\}/);
  assert.match(uiSource, /disabled=\{aiRuntimeSettings\.globalAiDisabled === true\} checked=\{aiRuntimeSettings\.businessClassificationEnabled === true\}/);
  assert.match(uiSource, /Chat AI Enabled/);
  assert.ok(uiSource.indexOf("Global AI Disabled") < uiSource.indexOf("Chat AI Enabled"));
  assert.match(uiSource, /Chat Audio AI Enabled/);
  assert.match(uiSource, /Dashboard Translation AI Enabled/);
  assert.match(uiSource, /Insight AI Enabled/);
  assert.match(uiSource, /Business Type Detection Enabled/);
  assert.match(uiSource, /AI Options/);
  assert.doesNotMatch(uiSource, /Storage Options/);
  assert.ok(uiSource.indexOf("Autosync Check Interval") > uiSource.indexOf("Data Source Integrations"));
  assert.doesNotMatch(uiSource, /Pricing Profile/);
  assert.match(uiSource, /getAiModelPricing\(model(?:, [^)]+)?\)/);
  assert.doesNotMatch(uiSource, /chatEnabled !== false/);
  assert.match(adminSource, /const AI_FEATURE_RUNTIME_DEFAULTS = \{\s+globalAiDisabled: false,\s+chatEnabled: false,\s+chatAudioEnabled: false,\s+dashboardTranslationEnabled: false,\s+insightAiEnabled: false,/);
  assert.match(adminSource, /const AI_MODEL_PRICING = \{/);
  assert.match(adminSource, /const \[aiRuntimeSettings, setAiRuntimeSettingsState\] = useState\(\{ \.\.\.AI_RUNTIME_PRESETS\.mid \}\)/);
  assert.match(adminSource, /const aiRuntimeSettingsRef = useRef\(aiRuntimeSettings\)/);
  assert.match(adminSource, /const setAiRuntimeSettings = useCallback\(\(updater\) =>/);
  assert.match(adminSource, /aiRuntimeSettingsRef\.current = next/);
  assert.match(adminSource, /const runtimeDraft = aiRuntimeSettingsRef\.current \|\| aiRuntimeSettings \|\| \{\}/);
  assert.match(adminSource, /businessClassificationEnabled: runtimeDraft\.businessClassificationEnabled === true/);
  assert.match(adminSource, /const aiRuntimeRequestSeqRef = useRef\(0\)/);
  assert.match(adminSource, /const requestSeq = \+\+aiRuntimeRequestSeqRef\.current/);
  assert.match(adminSource, /if \(requestSeq !== aiRuntimeRequestSeqRef\.current\) return/);
  assert.match(adminSource, /openaiInputCostPer1M: selectedModelPricing\.openaiInputCostPer1M/);
  assert.match(adminSource, /next\.openaiInputCostPer1M = savedPricingForModel\.openaiInputCostPer1M/);
  assert.match(adminSource, /axios\.get\(`\$\{API\}\/admin\/settings\/ai-runtime`, \{\s+headers: \{ Authorization: `Bearer \$\{token\}` \},\s+params: integrationScopeParams,/);
  assert.match(adminSource, /axios\.patch\(`\$\{API\}\/admin\/settings\/ai-runtime`, \{ \.\.\.next, \.\.\.integrationScopeParams \}, \{/);
  assert.match(adminSource, /\.\.\.AI_FEATURE_RUNTIME_DEFAULTS/);
  assert.match(adminSource, /chatEnabled: data\.chatEnabled === true/);
  assert.match(adminSource, /globalAiDisabled: data\.globalAiDisabled === true/);
  assert.match(adminSource, /insightAiEnabled: data\.insightAiEnabled === true/);
  assert.match(adminSource, /insightAiEnabled: runtimeDraft\.insightAiEnabled === true/);
});

