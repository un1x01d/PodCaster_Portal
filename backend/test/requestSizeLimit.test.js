import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, "..");

test("server applies explicit JSON/urlencoded body size limits", () => {
  const serverSource = fs.readFileSync(path.join(repoRoot, "server.js"), "utf8");
  const middlewareSource = fs.readFileSync(path.join(repoRoot, "src", "middleware", "bodyParsing.js"), "utf8");
  assert.match(serverSource, /applyBodyParsingMiddleware\(app, process\.env\)/);
  assert.match(middlewareSource, /const jsonBodyLimit = String\(env\.JSON_BODY_LIMIT \|\| "1mb"\)/);
  assert.match(middlewareSource, /express\.json\(\{ limit: jsonBodyLimit \}\)/);
  assert.match(middlewareSource, /const urlencodedBodyLimit = String\(env\.URLENCODED_BODY_LIMIT \|\| "1mb"\)/);
  assert.match(middlewareSource, /express\.urlencoded\(\{ extended: false, limit: urlencodedBodyLimit \}\)/);
});
