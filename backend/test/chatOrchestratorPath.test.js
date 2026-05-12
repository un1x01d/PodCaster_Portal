import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test("chat controller defaults to deterministic orchestrator and gates legacy fallback by env flag", () => {
  const controllerPath = path.join(__dirname, "..", "src", "controllers", "chatController.js");
  const source = fs.readFileSync(controllerPath, "utf8");
  assert.match(source, /const CHAT_ENABLE_LEGACY_FALLBACK = String\(process\.env\.CHAT_ENABLE_LEGACY_FALLBACK \|\| "false"\)/);
  assert.match(source, /if \(!CHAT_ENABLE_LEGACY_FALLBACK\) \{/);
  assert.match(source, /phase: "deterministic_orchestrator_only"/);
});
