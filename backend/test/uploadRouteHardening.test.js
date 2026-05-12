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

test("upload route MIME allowlist excludes generic octet-stream/plain-text", () => {
  const sheetRoutes = read("src/routes/sheetRoutes.js");
  const emailRoutes = read("src/routes/emailRoutes.js");
  const sheetController = read("src/controllers/sheetController.js");

  assert.doesNotMatch(sheetRoutes, /application\/octet-stream/);
  assert.doesNotMatch(sheetRoutes, /text\/plain/);
  assert.doesNotMatch(emailRoutes, /application\/octet-stream/);
  assert.doesNotMatch(emailRoutes, /text\/plain/);
  assert.match(sheetController, /assertUploadSignatureMatchesExtension/);
});

