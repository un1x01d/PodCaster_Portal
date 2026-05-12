import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, "..");

function read(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("sheet/chat/insight controllers use shared row filter SQL builder", () => {
  const sheet = read("src/controllers/sheetController.js");
  const chat = read("src/controllers/chatController.js");
  const insight = read("src/controllers/insightController.js");
  const shared = read("src/utils/rowFilters.js");

  assert.match(shared, /export function buildRowFilterWhereClause/);
  assert.match(sheet, /from "\.\.\/utils\/rowFilters\.js"/);
  assert.match(chat, /from "\.\.\/utils\/rowFilters\.js"/);
  assert.match(insight, /from "\.\.\/utils\/rowFilters\.js"/);

  assert.doesNotMatch(sheet, /function buildRowFilterWhereClause\(/);
  assert.doesNotMatch(chat, /function buildRowFilterWhereClause\(/);
  assert.doesNotMatch(insight, /function buildRowFilterWhereClause\(/);
});

