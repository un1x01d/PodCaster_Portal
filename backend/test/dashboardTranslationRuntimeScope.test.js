import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const repoRoot = new URL("../../", import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, repoRoot), "utf8");

test("dashboard translation uses effective runtime scope instead of global-only settings", () => {
  const localeController = read("backend/src/controllers/localeController.js");
  const localization = read("backend/src/utils/dashboardLocalization.js");

  assert.match(localeController, /loadEffectiveAiRuntimeSettings/);
  assert.match(localeController, /resolveRuntimeGroupIdForUser/);
  assert.match(localeController, /runtime:\s*translationRuntime/);
  assert.match(localization, /callOpenAITranslation\(\{ locale, items, context, runtime = null \}\)/);
  assert.match(localization, /const effectiveRuntime = runtime && typeof runtime === "object"/);
});
