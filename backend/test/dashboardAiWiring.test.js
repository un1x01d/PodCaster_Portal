import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, "..", "..");

test("dashboard AI submit handlers are defined in DashboardHome", () => {
  const dashboardHomePath = path.join(repoRoot, "frontend", "src", "components", "dashboard", "DashboardHome.jsx");
  const source = fs.readFileSync(dashboardHomePath, "utf8");

  assert.match(source, /const submitPinnedPromptToAI\s*=\s*React\.useCallback\(/);
  assert.match(source, /const submitTicketPromptToAI\s*=\s*React\.useCallback\(/);
  assert.match(source, /const submitChartPromptToAI\s*=\s*React\.useCallback\(/);
  assert.match(source, /window\.dispatchEvent\(new CustomEvent\("dashboard:submit-chat"/);
});

test("silent dashboard AI errors are surfaced via dashboard:chat-response", () => {
  const hookPath = path.join(repoRoot, "frontend", "src", "hooks", "useChatbotLogic.js");
  const source = fs.readFileSync(hookPath, "utf8");

  assert.match(source, /error:\s*String\(errMsg\)/);
  assert.match(source, /new CustomEvent\("dashboard:chat-response"/);
  assert.match(source, /sheetId:\s*current\.sheetId/);
});

test("cross-sheet AI targets are scoped to accessible files", () => {
  const controllerPath = path.join(repoRoot, "backend", "src", "controllers", "chatController.js");
  const source = fs.readFileSync(controllerPath, "utf8");

  assert.match(source, /const allowedSheetIds = new Set\(availableFiles\.map/);
  assert.match(source, /filter\(\(t\) => allowedSheetIds\.has/);
  assert.match(source, /invalid_cross_targets/);
});

test("dashboard AI overrides are applied and persisted for reload", () => {
  const dashboardHomePath = path.join(repoRoot, "frontend", "src", "components", "dashboard", "DashboardHome.jsx");
  const source = fs.readFileSync(dashboardHomePath, "utf8");

  assert.match(source, /aiOverride:\s*true/);
  assert.match(source, /manualOverride:\s*true/);
  assert.match(source, /persistPinnedConfig\(items\)/);
  assert.match(source, /const requestId = `\$\{Date\.now\(\)\}_\$\{Math\.random\(\)\.toString\(36\)\.slice\(2, 8\)\}`/);
  assert.match(source, /if \(latest && latest !== requestId\) return;/);
});

test("dashboard KPI editor supports optional percentage aggregation", () => {
  const dashboardHomePath = path.join(repoRoot, "frontend", "src", "components", "dashboard", "DashboardHome.jsx");
  const source = fs.readFileSync(dashboardHomePath, "utf8");

  assert.match(source, /agg === "percent"/);
  assert.match(source, /const percentBaseValue = parseNumber\(override\.percentBaseValue\)/);
  assert.match(source, /const hasPercentBase = Number\.isFinite\(percentBaseValue\) && percentBaseValue > 0/);
  assert.match(source, /nextValue = hasPercentBase \? \(numerator \/ percentBaseValue\) \* 100 : 0/);
  assert.match(source, /percentBaseValue: value/);
  assert.match(source, /placeholder="Base value for %"/);
  assert.match(source, /<option value="percent">Percentage<\/option>/);
  assert.match(source, /sparklineType: agg === "count" \? "count" : \(agg === "percent" \? "percent" : "currency"\)/);
});
