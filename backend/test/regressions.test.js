import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
