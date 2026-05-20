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

test("semantic knowledge supports tenant-scoped cache and group-aware lookup", () => {
  const source = read("src/services/ai/semanticKnowledgeService.js");
  assert.match(source, /const SEMANTIC_CACHE_BY_GROUP = new Map\(\)/);
  assert.match(source, /function groupCacheKey\(groupId = null\)/);
  assert.match(source, /export function invalidateSemanticKnowledgeCache\(groupId = null\)/);
  assert.match(source, /WHERE \(group_id = \$1 OR group_id IS NULL\)/);
});

test("successful mapping ingestion is tenant-scoped and does not auto-promote globally", () => {
  const source = read("src/services/ai/semanticKnowledgeService.js");
  assert.match(source, /recordSuccessfulMapping\(\{/);
  assert.match(source, /groupId = null/);
  assert.match(source, /INSERT INTO ai_learning_candidates[\s\S]*group_id/);
  assert.doesNotMatch(source, /autoApproveCandidate/);
});

test("governed promotion and rollback paths exist for semantic rules", () => {
  const source = read("src/services/ai/semanticKnowledgeService.js");
  assert.match(source, /export async function promoteSemanticCandidate\(/);
  assert.match(source, /insufficient_evidence/);
  assert.match(source, /insufficient_confidence/);
  assert.match(source, /INSERT INTO ai_learning_rules[\s\S]*scope/);
  assert.match(source, /export async function rollbackSemanticRule\(/);
  assert.match(source, /UPDATE ai_learning_rules[\s\S]*status = 'disabled'/);
});

test("planner compile path passes tenant group context into deterministic planning hints", () => {
  const chatController = read("src/controllers/chatController.js");
  const queryPhases = read("src/controllers/chat/chatQueryPhases.js");
  assert.match(chatController, /groupId: req\.user\?\.customer_group_id \|\| req\.user\?\.resolved_group_id \|\| null/);
  assert.match(queryPhases, /groupId: req\.user\?\.customer_group_id \|\| req\.user\?\.resolved_group_id \|\| null/);
});

test("database schema includes tenant-scoped learning candidate key", () => {
  const dbSource = read("src/config/db.js");
  assert.match(dbSource, /ALTER TABLE ai_learning_candidates ADD COLUMN IF NOT EXISTS group_id INT NULL REFERENCES groups\(id\) ON DELETE CASCADE;/);
  assert.match(dbSource, /idx_ai_learning_candidates_unique_pending_group/);
});
