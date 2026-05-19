import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, "..", "..");

test("docker compose backend healthcheck targets HTTP readiness endpoint", () => {
  const composePath = path.join(repoRoot, "docker-compose.yml");
  const source = fs.readFileSync(composePath, "utf8");

  assert.equal(source.includes("http://localhost:4000/readyz"), true);
});
