import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, "..", "..");

test("docker compose uses stronger JWT default fallback", () => {
  const composePath = path.join(repoRoot, "docker-compose.yml");
  const source = fs.readFileSync(composePath, "utf8");

  assert.match(
    source,
    /JWT_SECRET:\s*\$\{JWT_SECRET:-dev-jwt-2026-rotate-me-7f3b9c1d5a8e4b2f9d6c0a1e3f5b7d9\}/
  );
});
