import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

test("dropbox oauth state is signed and validates for original user", async () => {
  process.env.JWT_SECRET = "test-secret";
  const mod = await import(`../src/controllers/dropboxController.js?t=${Date.now()}`);
  const state = mod.createDropboxOauthState(42, 1_000);
  const userId = mod.verifyDropboxOauthState(state, 1_001);
  assert.equal(userId, 42);
});

test("dropbox oauth state rejects tampered payload", async () => {
  process.env.JWT_SECRET = "test-secret";
  const mod = await import(`../src/controllers/dropboxController.js?t=${Date.now()}`);
  const state = mod.createDropboxOauthState(7, 1_000);
  const [payload, sig] = state.split(".");
  const tampered = `${payload.replace(/.$/, "A")}.${sig}`;
  const userId = mod.verifyDropboxOauthState(tampered, 1_001);
  assert.equal(userId, null);
});

test("dropbox oauth state expires", async () => {
  process.env.JWT_SECRET = "test-secret";
  const mod = await import(`../src/controllers/dropboxController.js?t=${Date.now()}`);
  const state = mod.createDropboxOauthState(9, 1_000);
  const userId = mod.verifyDropboxOauthState(state, 1_000 + (5 * 60 * 1000) + 1);
  assert.equal(userId, null);
});

test("sheet upload role guard allows only explicit admin role", async () => {
  const mod = await import(`../src/controllers/sheetController.js?t=${Date.now()}`);
  assert.equal(mod.canUploadSheetsByRole("admin"), true);
  assert.equal(mod.canUploadSheetsByRole("group_admin"), false);
  assert.equal(mod.canUploadSheetsByRole("user"), false);
  assert.equal(mod.canUploadSheetsByRole(""), false);
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

  assert.match(source, /import \{ checkSheetAccess \} from "\.\.\/utils\/authorization\.js";/);
  assert.match(source, /const hasSheetAccess = await checkSheetAccess\(sheetId, req\.user\);/);
  assert.match(source, /if \(!hasSheetAccess\) return res\.status\(403\)\.json\(\{ error: "Forbidden" \}\);/);
});

test("user management exposes report source permission endpoints backed by current sheet", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const controllerPath = path.join(__dirname, "..", "src", "controllers", "userController.js");
  const routesPath = path.join(__dirname, "..", "src", "routes", "userRoutes.js");
  const controllerSource = fs.readFileSync(controllerPath, "utf8");
  const routeSource = fs.readFileSync(routesPath, "utf8");

  assert.match(controllerSource, /function resolveReportSourceCurrentSheet\(reportSourceId\)/);
  assert.match(controllerSource, /SELECT id, current_sheet_id FROM report_sources WHERE id = \$1/);
  assert.match(controllerSource, /INSERT INTO permissions \(user_id, sheet_id, allowed_columns, row_filters\)/);
  assert.match(controllerSource, /INSERT INTO group_permissions \(group_id, sheet_id, allowed_columns, row_filters\)/);
  assert.match(routeSource, /router\.post\("\/report-source-permissions"/);
  assert.match(routeSource, /router\.get\("\/report-source-permissions"/);
  assert.match(routeSource, /router\.post\("\/report-source-group-permissions"/);
  assert.match(routeSource, /router\.get\("\/report-source-group-permissions"/);
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

test("unique values endpoint applies row filters before distinct sampling", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const controllerPath = path.join(__dirname, "..", "src", "controllers", "sheetController.js");
  const source = fs.readFileSync(controllerPath, "utf8");

  assert.match(source, /SELECT allowed_columns, row_filters FROM permissions/);
  assert.match(source, /rowFiltersList\.push\(filters\)/);
  assert.match(source, /const filterClause = buildRowFilterWhereClause\(rowFiltersList, params\.length \+ 1\);/);
  assert.match(source, /Security: row filters must be applied before sampling\/distinct/);
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
  assert.match(source, /const sampleRows = applyFilters\(loadedSample\.rows \|\| \[\], activeDashboardFilters\);/);
  assert.match(source, /const executionFilters = \[\.\.\.activeDashboardFilters, \.\.\.filteredAiFilters\];/);
  assert.match(source, /case 'equals'/);
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
  assert.match(source, /const filterClause = buildRowFilterWhereClause\(rowFiltersList, params\.length \+ 1\);/);
  assert.doesNotMatch(source, /rows = rows\.filter\(\(rowData\)/);
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
