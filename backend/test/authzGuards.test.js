import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listAuditLogs } from "../src/controllers/userController.js";
import { listViews } from "../src/controllers/viewController.js";
import { listAllSheets } from "../src/controllers/sheetController.js";
import { isPlatformAdminUser } from "../src/utils/authorization.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, "..");

function makeRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

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

test("platform admin helper recognizes admin variants", () => {
  assert.equal(isPlatformAdminUser({ role: "admin" }), true);
  assert.equal(isPlatformAdminUser({ role: "super_admin" }), true);
  assert.equal(isPlatformAdminUser({ role: "superadmin" }), true);
  assert.equal(isPlatformAdminUser({ role: "user", is_admin: true }), true);
  assert.equal(isPlatformAdminUser({ role: "user", super_admin: "true" }), true);
  assert.equal(isPlatformAdminUser({ role: "user" }), false);
});

test("admin-only controllers deny non-admin users with HTTP 403", async () => {
  const req = { user: { role: "user", id: 101 }, query: {}, params: {} };

  const res1 = makeRes();
  await listAuditLogs(req, res1);
  assert.equal(res1.statusCode, 403);
  assert.deepEqual(res1.body, { error: "Forbidden" });

  const res2 = makeRes();
  await listViews(req, res2);
  assert.equal(res2.statusCode, 403);
  assert.deepEqual(res2.body, { error: "Forbidden" });

  const res3 = makeRes();
  await listAllSheets(req, res3);
  assert.equal(res3.statusCode, 403);
  assert.deepEqual(res3.body, { error: "Forbidden" });
});

test("object-level sheet access checks remain in chat and insights paths", () => {
  const chatController = fs.readFileSync(path.join(repoRoot, "src", "controllers", "chatController.js"), "utf8");
  const insightController = fs.readFileSync(path.join(repoRoot, "src", "controllers", "insightController.js"), "utf8");

  assert.match(chatController, /const hasAccess = await checkSheetAccess\(sheetId, req\.user\)/);
  assert.match(chatController, /if \(!hasAccess\) return res\.status\(403\)\.json\(\{ error: "Forbidden" \}\)/);
  assert.match(insightController, /const hasAccess = await checkSheetAccess\(sheetId, req\.user\)/);
  assert.match(insightController, /if \(!hasAccess\) return res\.status\(403\)\.json\(\{ error: "Forbidden" \}\)/);
});
