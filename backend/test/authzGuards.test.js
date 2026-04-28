import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, "..");

test("high-risk mutating route files are auth-gated", () => {
  const sheetRoutes = fs.readFileSync(path.join(repoRoot, "src", "routes", "sheetRoutes.js"), "utf8");
  const userRoutes = fs.readFileSync(path.join(repoRoot, "src", "routes", "userRoutes.js"), "utf8");
  const viewRoutes = fs.readFileSync(path.join(repoRoot, "src", "routes", "viewRoutes.js"), "utf8");
  const insightRoutes = fs.readFileSync(path.join(repoRoot, "src", "routes", "insightRoutes.js"), "utf8");

  assert.match(sheetRoutes, /router\.use\(auth\)/);
  assert.match(userRoutes, /router\.use\(auth\)/);
  assert.match(viewRoutes, /router\.use\(auth\)/);
  assert.match(insightRoutes, /router\.use\(auth\)/);
});

test("admin-only controllers still enforce role checks server-side", () => {
  const userController = fs.readFileSync(path.join(repoRoot, "src", "controllers", "userController.js"), "utf8");
  const viewController = fs.readFileSync(path.join(repoRoot, "src", "controllers", "viewController.js"), "utf8");
  const sheetController = fs.readFileSync(path.join(repoRoot, "src", "controllers", "sheetController.js"), "utf8");

  assert.match(userController, /if \(req\.user\.role !== "admin"\) return res\.status\(403\)\.json\(\{ error: "Forbidden" \}\)/);
  assert.match(viewController, /if \(req\.user\.role !== "admin"\) return res\.status\(403\)\.json\(\{ error: "Forbidden" \}\)/);
  assert.match(sheetController, /if \(req\.user\.role !== "admin"\) return res\.status\(403\)\.json\(\{ error: "Forbidden" \}\)/);
});

test("object-level sheet access checks remain in chat and insights paths", () => {
  const chatController = fs.readFileSync(path.join(repoRoot, "src", "controllers", "chatController.js"), "utf8");
  const insightController = fs.readFileSync(path.join(repoRoot, "src", "controllers", "insightController.js"), "utf8");

  assert.match(chatController, /const hasAccess = await checkSheetAccess\(sheetId, req\.user\)/);
  assert.match(chatController, /if \(!hasAccess\) return res\.status\(403\)\.json\(\{ error: "Forbidden" \}\)/);
  assert.match(insightController, /const hasAccess = await checkSheetAccess\(sheetId, req\.user\)/);
  assert.match(insightController, /if \(!hasAccess\) return res\.status\(403\)\.json\(\{ error: "Forbidden" \}\)/);
});
