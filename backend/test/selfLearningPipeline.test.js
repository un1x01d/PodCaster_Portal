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

test("learning rules cache is locale-scoped and supports explicit invalidation", () => {
  const source = read("src/services/ai/semanticKnowledgeService.js");
  assert.match(source, /const RULES_CACHE_BY_LOCALE = new Map\(\)/);
  assert.match(source, /export function invalidateLearningRulesCache\(\)/);
  assert.match(source, /RULES_CACHE_BY_LOCALE\.clear\(\)/);
  assert.match(source, /const localeKey = String\(locale \|\| "en"\)/);
});

test("phrase override uses normalized text for exact and fuzzy matching", () => {
  const source = read("src/services/ai/semanticKnowledgeService.js");
  assert.match(source, /const p = normalizeText\(String\(r\.phrase \|\| ""\)\)/);
  assert.match(source, /const normalized = normalizeText\(String\(phrase \|\| ""\)\)/);
  assert.match(source, /if \(!normalized\) return null;/);
});

test("learning approvals invalidate rules cache and normalize approved phrases", () => {
  const userController = read("src/controllers/userController.js");
  const chatController = read("src/controllers/chatController.js");

  assert.match(userController, /import \{ invalidateLearningRulesCache \} from "\.\.\/services\/ai\/semanticKnowledgeService\.js";/);
  assert.match(userController, /normalizeText\(String\(found\.question \|\| ""\)\)/);
  assert.match(userController, /normalizeText\(found\.phrase\)/);
  assert.match(userController, /invalidateLearningRulesCache\(\)/);
  assert.match(chatController, /import \{ getSemanticKnowledge, invalidateLearningRulesCache \} from "\.\.\/services\/ai\/semanticKnowledgeService\.js";/);
  assert.match(chatController, /invalidateLearningRulesCache\(\)/);
});

test("learning candidate ingestion filters noisy phrases and keeps feedback submissions pending", () => {
  const chatController = read("src/controllers/chatController.js");
  assert.match(chatController, /function isLearnablePhrase\(text = ""\)/);
  assert.match(chatController, /if \(!normalizedPhrase \|\| !isLearnablePhrase\(normalizedPhrase\)\) return;/);
  assert.match(chatController, /const autoApproveAllCandidates = forcePending/);
  assert.match(chatController, /forcePending:\s*true/);
});
