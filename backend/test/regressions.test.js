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
  assert.match(source, /replace\(\/\\s\+\\\*\\\*\(\[\^\*\\n:\]\{1,80\}\):\\\*\\\*\/g, "\\n\$1:"\)/);
  assert.match(source, /replace\(\/\\\*\\\*\(\[\^\*\\n\]\+\)\\\*\\\*\/g, "\$1"\)/);
  assert.match(source, /bestYear\.change_percent >= 0/);
  assert.match(source, /function dropImplicitTrailingPartialYear/);
  assert.match(source, /shouldIncludeTrailingPartialYear\(queryText, latestYear/);
  assert.match(source, /replace\(\/\\\\r\?\\\\n\/g, "\\n"\)/);
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

test("customer product bundles include user and source limits", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(__filename), "..", "..");
  const uiPath = path.join(repoRoot, "frontend", "src", "UserManagement.jsx");
  const uiSource = fs.readFileSync(uiPath, "utf8");

  assert.match(uiSource, /const BUNDLE_CAPACITY_LIMITS = \{/);
  assert.match(uiSource, /core: \{ maxUsers: 10, maxReportSources: 3 \}/);
  assert.match(uiSource, /growth: \{ maxUsers: 50, maxReportSources: 15 \}/);
  assert.match(uiSource, /enterprise: \{ maxUsers: 250, maxReportSources: 100 \}/);
  assert.match(uiSource, /const capacityLimits = BUNDLE_CAPACITY_LIMITS\[bundle\.key\] \|\| \{\}/);
  assert.match(uiSource, /maxUsers: capacityLimits\.maxUsers \?\? current\.maxUsers \?\? ""/);
  assert.match(uiSource, /maxReportSources: capacityLimits\.maxReportSources \?\? current\.maxReportSources \?\? ""/);
});

test("customer-scoped SSO toggle is wired and enforced for Google auth", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(__filename), "..", "..");
  const entitlementsPath = path.join(repoRoot, "backend", "src", "utils", "entitlements.js");
  const routesPath = path.join(repoRoot, "backend", "src", "routes", "userRoutes.js");
  const userControllerPath = path.join(repoRoot, "backend", "src", "controllers", "userController.js");
  const googleControllerPath = path.join(repoRoot, "backend", "src", "controllers", "googleController.js");
  const uiPath = path.join(repoRoot, "frontend", "src", "UserManagement.jsx");
  const appPath = path.join(repoRoot, "frontend", "src", "App.jsx");

  const entitlementsSource = fs.readFileSync(entitlementsPath, "utf8");
  const routesSource = fs.readFileSync(routesPath, "utf8");
  const userControllerSource = fs.readFileSync(userControllerPath, "utf8");
  const googleControllerSource = fs.readFileSync(googleControllerPath, "utf8");
  const uiSource = fs.readFileSync(uiPath, "utf8");
  const appSource = fs.readFileSync(appPath, "utf8");

  assert.match(entitlementsSource, /sso:\s*true/);
  assert.match(routesSource, /router\.get\("\/admin\/settings\/sso"/);
  assert.match(routesSource, /router\.patch\("\/admin\/settings\/sso"/);
  assert.match(userControllerSource, /export async function getSsoSetting/);
  assert.match(userControllerSource, /export async function setSsoSetting/);
  assert.match(googleControllerSource, /assertGroupFeatureEnabled\(requestedGroupId,\s*"sso"/);
  assert.match(googleControllerSource, /assertGroupFeatureEnabled\(requiredGroupId,\s*"sso"/);
  assert.doesNotMatch(uiSource, /\["sso",\s*"SSO"\]/);
  assert.match(appSource, /google_sso_disabled/);
});

test("system settings endpoints use platform admin helper consistently", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(__filename), "..", "..");
  const userControllerPath = path.join(repoRoot, "backend", "src", "controllers", "userController.js");
  const source = fs.readFileSync(userControllerPath, "utf8");

  assert.match(source, /export async function getSmtpSetting\(req, res\)/);
  assert.match(source, /export async function setSmtpSetting\(req, res\)/);
  assert.match(source, /export async function getInviteEmailTemplateSetting\(req, res\)/);
  assert.match(source, /export async function setInviteEmailTemplateSetting\(req, res\)/);
  assert.match(source, /export async function previewInviteEmailTemplate\(req, res\)/);
  assert.match(source, /export async function getCustomerInvitationPolicy\(req, res\)/);
  assert.match(source, /export async function setCustomerInvitationPolicy\(req, res\)/);
  assert.match(source, /if \(!isPlatformAdminUser\(req\.user\)\) return res\.status\(403\)\.json\(\{ error: "Forbidden" \}\);/);
});

test("DLP settings default to feature-based rules and support column masking workflow", async () => {
  const dlp = await import(`../src/utils/dlp.js?t=${Date.now()}_dlp_defaults`);
  const normalized = dlp.normalizeDlpSettings({});
  assert.equal(normalized.mode, "block");
  assert.equal(normalized.maskDetectedColumns, false);

  const sheets = {
    Main: [
      { Name: "Alice", SSN: "123-45-6789", Notes: "ok" },
      { Name: "Bob", Card: "4111 1111 1111 1111", Notes: "ok" },
    ],
  };
  const scan = dlp.scanRowsForDlp(sheets, { enabled: true, checkSsn: true, checkCreditCard: true });
  assert.ok(Array.isArray(scan.findings));
  assert.ok(scan.findings.length >= 2);
  assert.deepEqual(new Set(scan.maskedColumns.Main || []), new Set(["SSN", "Card"]));

  const masked = dlp.applyDlpColumnMasking(sheets, scan.maskedColumns);
  assert.equal(masked.Main[0].SSN, "[REDACTED]");
  assert.equal(masked.Main[1].Card, "[REDACTED]");
  assert.equal(masked.Main[0].Name, "Alice");
});

test("autosync interval is configurable in system settings and read dynamically by the worker", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(__filename), "..", "..");
  const userRoutesPath = path.join(repoRoot, "backend", "src", "routes", "userRoutes.js");
  const userControllerPath = path.join(repoRoot, "backend", "src", "controllers", "userController.js");
  const sheetControllerPath = path.join(repoRoot, "backend", "src", "controllers", "sheetController.js");
  const uiPath = path.join(repoRoot, "frontend", "src", "UserManagement.jsx");
  const integrationsPanelPath = path.join(repoRoot, "frontend", "src", "components", "admin", "IntegrationSettingsPanel.jsx");

  const userRoutesSource = fs.readFileSync(userRoutesPath, "utf8");
  const userControllerSource = fs.readFileSync(userControllerPath, "utf8");
  const sheetControllerSource = fs.readFileSync(sheetControllerPath, "utf8");
  const uiSource = fs.readFileSync(uiPath, "utf8");
  const integrationsPanelSource = fs.readFileSync(integrationsPanelPath, "utf8");

  assert.match(userRoutesSource, /router\.get\("\/admin\/settings\/autosync-interval", asyncHandler\(getAutosyncPollIntervalSetting\)\)/);
  assert.match(userRoutesSource, /router\.patch\("\/admin\/settings\/autosync-interval", asyncHandler\(setAutosyncPollIntervalSetting\)\)/);
  assert.match(userControllerSource, /export async function getAutosyncPollIntervalSetting\(req, res\)/);
  assert.match(userControllerSource, /export async function setAutosyncPollIntervalSetting\(req, res\)/);
  assert.match(userControllerSource, /autosync_poll_interval_settings/);
  assert.match(sheetControllerSource, /async function loadAutosyncPollIntervalMs\(\)/);
  assert.match(sheetControllerSource, /const AUTOSYNC_POLL_SETTINGS_KEY = "autosync_poll_interval_settings";/);
  assert.match(sheetControllerSource, /loadAutosyncPollIntervalMs\(\)/);
  assert.match(integrationsPanelSource, /Autosync Check Interval/);
  assert.match(uiSource, /fetchAutosyncIntervalSetting/);
  assert.match(uiSource, /saveAutosyncIntervalSetting/);
});

test("email ingest settings are exposed in system settings and linked to Google Workspace routing docs", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(__filename), "..", "..");
  const userRoutesPath = path.join(repoRoot, "backend", "src", "routes", "userRoutes.js");
  const userControllerPath = path.join(repoRoot, "backend", "src", "controllers", "userController.js");
  const uiPath = path.join(
    repoRoot,
    "frontend",
    "src",
    "components",
    "admin",
    "IntegrationSettingsPanel.jsx"
  );

  const userRoutesSource = fs.readFileSync(userRoutesPath, "utf8");
  const userControllerSource = fs.readFileSync(userControllerPath, "utf8");
  const uiSource = fs.readFileSync(uiPath, "utf8");
  const integrationsPanelPath = path.join(repoRoot, "frontend", "src", "components", "admin", "IntegrationSettingsPanel.jsx");
  const integrationsPanelSource = fs.readFileSync(integrationsPanelPath, "utf8");

  assert.match(userRoutesSource, /router\.get\("\/admin\/settings\/email-ingest", asyncHandler\(getEmailIngestSetting\)\)/);
  assert.match(userRoutesSource, /router\.patch\("\/admin\/settings\/email-ingest", asyncHandler\(setEmailIngestSetting\)\)/);
  assert.match(userControllerSource, /export async function getEmailIngestSetting\(req, res\)/);
  assert.match(userControllerSource, /export async function setEmailIngestSetting\(req, res\)/);
  assert.match(userControllerSource, /EMAIL_INGEST_SETTINGS_KEY = "email_ingest_settings"/);
  assert.match(integrationsPanelSource, /Email Ingest/);
  assert.match(integrationsPanelSource, /Add a domain or domain alias/);
  assert.match(integrationsPanelSource, /Set up Default routing for your organization/);
  assert.match(integrationsPanelSource, /Get misaddressed email in a catch-all mailbox/);
});

test("email ingest allowlist is normalized and route wiring is public but CSRF-exempt", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(__filename), "..", "..");
  const userControllerPath = path.join(repoRoot, "backend", "src", "controllers", "userController.js");
  const emailRoutesPath = path.join(repoRoot, "backend", "src", "routes", "emailRoutes.js");
  const csrfPath = path.join(repoRoot, "backend", "src", "middleware", "csrf.js");
  const dbPath = path.join(repoRoot, "backend", "src", "config", "db.js");

  const userControllerSource = fs.readFileSync(userControllerPath, "utf8");
  const emailRoutesSource = fs.readFileSync(emailRoutesPath, "utf8");
  const csrfSource = fs.readFileSync(csrfPath, "utf8");
  const dbSource = fs.readFileSync(dbPath, "utf8");

  assert.match(userControllerSource, /EMAIL_INGEST_ALLOWLIST_KEY = "email_ingest_allowlist"/);
  assert.match(userControllerSource, /normalizeEmailIngestSenderAllowlist/);
  assert.match(userControllerSource, /resolveScopedGroupForIntegrationSettings\(req\)/);
  assert.match(emailRoutesSource, /router\.post\(\s*"\/email-ingest\/inbound",\s*uploadRateLimit,\s*verifyIngestSecret,\s*upload\.fields\(\[/s);
  assert.match(csrfSource, /"\/email-ingest\/inbound"/);
  assert.match(dbSource, /idx_report_sources_email_sync_source/);
});

test("email ingest allowlist normalization lowercases and dedupes domains", async () => {
  const mod = await import(`../src/controllers/userController.js?t=${Date.now()}_email_allowlist`);
  const normalized = mod.normalizeEmailIngestSenderAllowlist({
    allowedSenderDomains: ["Customer.com", "customer.com", "  Partner.ORG  ", "", null],
  });
  assert.deepEqual(normalized, ["customer.com", "partner.org"]);
});

test("storage options are exposed in system settings and wire connection tests for SFTP, GCS, S3, and Azure Blob Storage", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(__filename), "..", "..");
  const userRoutesPath = path.join(repoRoot, "backend", "src", "routes", "userRoutes.js");
  const storageControllerPath = path.join(repoRoot, "backend", "src", "controllers", "storageController.js");
  const uiPath = path.join(
    repoRoot,
    "frontend",
    "src",
    "components",
    "admin",
    "IntegrationSettingsPanel.jsx"
  );
  const uiConfigPath = path.join(repoRoot, "frontend", "src", "components", "admin", "userManagementConfig.js");
  const cardPath = path.join(repoRoot, "frontend", "src", "components", "common", "StorageOptionCard.jsx");

  const userRoutesSource = fs.readFileSync(userRoutesPath, "utf8");
  const storageControllerSource = fs.readFileSync(storageControllerPath, "utf8");
  const uiSource = fs.readFileSync(uiPath, "utf8");
  const uiConfigSource = fs.readFileSync(uiConfigPath, "utf8");
  const cardSource = fs.readFileSync(cardPath, "utf8");

  assert.match(userRoutesSource, /router\.get\("\/admin\/settings\/sftp-storage", asyncHandler\(getSftpStorageSetting\)\)/);
  assert.match(userRoutesSource, /router\.post\("\/admin\/settings\/sftp-storage\/test", asyncHandler\(testSftpStorageSetting\)\)/);
  assert.match(userRoutesSource, /router\.get\("\/admin\/settings\/gcs-storage", asyncHandler\(getGcsStorageSetting\)\)/);
  assert.match(userRoutesSource, /router\.post\("\/admin\/settings\/gcs-storage\/test", asyncHandler\(testGcsStorageSetting\)\)/);
  assert.match(userRoutesSource, /router\.get\("\/admin\/settings\/s3-storage", asyncHandler\(getS3StorageSetting\)\)/);
  assert.match(userRoutesSource, /router\.post\("\/admin\/settings\/s3-storage\/test", asyncHandler\(testS3StorageSetting\)\)/);
  assert.match(userRoutesSource, /router\.get\("\/admin\/settings\/azure-blob-storage", asyncHandler\(getAzureBlobStorageSetting\)\)/);
  assert.match(userRoutesSource, /router\.post\("\/admin\/settings\/azure-blob-storage\/test", asyncHandler\(testAzureBlobStorageSetting\)\)/);
  assert.match(storageControllerSource, /export async function getSftpStorageSetting\(req, res\)/);
  assert.match(storageControllerSource, /export async function testSftpStorageSetting\(req, res\)/);
  assert.match(storageControllerSource, /export async function getGcsStorageSetting\(req, res\)/);
  assert.match(storageControllerSource, /export async function testGcsStorageSetting\(req, res\)/);
  assert.match(storageControllerSource, /export async function getS3StorageSetting\(req, res\)/);
  assert.match(storageControllerSource, /export async function testS3StorageSetting\(req, res\)/);
  assert.match(storageControllerSource, /export async function getAzureBlobStorageSetting\(req, res\)/);
  assert.match(storageControllerSource, /export async function testAzureBlobStorageSetting\(req, res\)/);
  assert.match(uiSource, /Storage Options/);
  assert.match(uiConfigSource, /SCP \/ SFTP/);
  assert.match(uiConfigSource, /Google Cloud Storage/);
  assert.match(uiConfigSource, /Amazon S3/);
  assert.match(uiConfigSource, /Azure Blob Storage/);
  assert.match(cardSource, /export default function StorageOptionCard/);
});

test("admin settings reject unknown payload keys with structured error code", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const userControllerPath = path.join(__dirname, "..", "src", "controllers", "userController.js");
  const storageControllerPath = path.join(__dirname, "..", "src", "controllers", "storageController.js");
  const userSource = fs.readFileSync(userControllerPath, "utf8");
  const storageSource = fs.readFileSync(storageControllerPath, "utf8");

  assert.match(userSource, /function assertAllowedKeys\(raw, allowedKeys = \[\]\)/);
  assert.match(userSource, /new Error\("unknown_settings_keys"\)/);
  assert.match(storageSource, /function assertAllowedStorageKeys\(body, fields = \[\]\)/);
  assert.match(storageSource, /new Error\("unknown_settings_keys"\)/);
});

test("import publish\\/reject handlers are idempotent for repeated state transitions", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const sheetControllerPath = path.join(__dirname, "..", "src", "controllers", "sheetController.js");
  const source = fs.readFileSync(sheetControllerPath, "utf8");

  assert.match(source, /if \(record\.status === "published"\) \{[\s\S]*idempotent: true/);
  assert.match(source, /if \(record\.status === "rejected"\) \{[\s\S]*idempotent: true/);
});

test("metrics endpoint is exposure-gated and returns Prometheus text only when enabled", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const serverPath = path.join(__dirname, "..", "..", "backend", "server.js");
  const source = fs.readFileSync(serverPath, "utf8");

  assert.match(source, /app\.get\("\/metrics", async/);
  assert.match(source, /metrics_exposure_settings/);
  assert.match(source, /if \(!enabled\) return res\.status\(404\)\.send\("Not Found"\)/);
  assert.match(source, /Content-Type", "text\/plain; version=0\.0\.4; charset=utf-8/);
});

test("DLP flow supports warn\\/block decision and mandatory audit logging", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const sheetControllerPath = path.join(__dirname, "..", "src", "controllers", "sheetController.js");
  const source = fs.readFileSync(sheetControllerPath, "utf8");

  assert.match(source, /action: "dlp\.findings_detected"/);
  assert.match(source, /if \(scan\.findings\.length > 0 && dlp\.mode === "block"\)/);
  assert.match(source, /applyDlpColumnMasking/);
});

test("customer-scoped OAuth settings do not fall back to global config", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(__filename), "..", "..");
  const userControllerPath = path.join(repoRoot, "backend", "src", "controllers", "userController.js");
  const googleControllerPath = path.join(repoRoot, "backend", "src", "controllers", "googleController.js");

  const userControllerSource = fs.readFileSync(userControllerPath, "utf8");
  const googleControllerSource = fs.readFileSync(googleControllerPath, "utf8");

  assert.doesNotMatch(userControllerSource, /const globalRows = await query\("SELECT value FROM app_settings WHERE key = \$1 LIMIT 1", \[baseKey\]\);/);
  assert.doesNotMatch(googleControllerSource, /const globalRows = await query\("SELECT value FROM app_settings WHERE key = \$1 LIMIT 1", \[baseKey\]\);/);
});

test("customer users are invitation-only and invitation auth flow is wired", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(__filename), "..", "..");
  const userControllerPath = path.join(repoRoot, "backend", "src", "controllers", "userController.js");
  const userRoutesPath = path.join(repoRoot, "backend", "src", "routes", "userRoutes.js");
  const authControllerPath = path.join(repoRoot, "backend", "src", "controllers", "authController.js");
  const authRoutesPath = path.join(repoRoot, "backend", "src", "routes", "authRoutes.js");
  const dbPath = path.join(repoRoot, "backend", "src", "config", "db.js");
  const uiPath = path.join(repoRoot, "frontend", "src", "UserManagement.jsx");
  const appPath = path.join(repoRoot, "frontend", "src", "App.jsx");

  const userControllerSource = fs.readFileSync(userControllerPath, "utf8");
  const userRoutesSource = fs.readFileSync(userRoutesPath, "utf8");
  const authControllerSource = fs.readFileSync(authControllerPath, "utf8");
  const authRoutesSource = fs.readFileSync(authRoutesPath, "utf8");
  const dbSource = fs.readFileSync(dbPath, "utf8");
  const uiSource = fs.readFileSync(uiPath, "utf8");
  const appSource = fs.readFileSync(appPath, "utf8");

  assert.match(userControllerSource, /customer_users_invite_only/);
  assert.match(userControllerSource, /export async function inviteCustomerUser/);
  assert.match(userControllerSource, /export async function listCustomerInvitations/);
  assert.match(userControllerSource, /export async function resendCustomerInvitation/);
  assert.match(userControllerSource, /export async function revokeCustomerInvitation/);
  assert.match(userControllerSource, /export async function getCustomerInvitationPolicy/);
  assert.match(userControllerSource, /export async function setCustomerInvitationPolicy/);
  assert.match(userRoutesSource, /router\.post\("\/users\/invitations", invitationIssueRateLimit, asyncHandler\(inviteCustomerUser\)\)/);
  assert.match(userRoutesSource, /router\.get\("\/users\/invitations", asyncHandler\(listCustomerInvitations\)\)/);
  assert.match(userRoutesSource, /router\.post\("\/users\/invitations\/:id\/resend", invitationIssueRateLimit, asyncHandler\(resendCustomerInvitation\)\)/);
  assert.match(userRoutesSource, /router\.post\("\/users\/invitations\/:id\/revoke", asyncHandler\(revokeCustomerInvitation\)\)/);
  assert.match(userRoutesSource, /router\.get\("\/admin\/settings\/customer-invitations", asyncHandler\(getCustomerInvitationPolicy\)\)/);
  assert.match(userRoutesSource, /router\.patch\("\/admin\/settings\/customer-invitations", asyncHandler\(setCustomerInvitationPolicy\)\)/);
  assert.match(authControllerSource, /export async function getInvitationInfo/);
  assert.match(authControllerSource, /export async function acceptInvitation/);
  assert.match(authRoutesSource, /router\.get\("\/invitations\/:token", invitationLookupRateLimit, asyncHandler\(getInvitationInfo\)\)/);
  assert.match(authRoutesSource, /router\.post\("\/invitations\/accept", invitationAcceptRateLimit, asyncHandler\(acceptInvitation\)\)/);
  assert.match(dbSource, /CREATE TABLE IF NOT EXISTS customer_user_invitations/);
  assert.match(uiSource, /\/users\/invitations/);
  assert.match(uiSource, /\/admin\/settings\/customer-invitations/);
  assert.match(appSource, /auth\/invitations\/accept/);
});
