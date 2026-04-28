import test from "node:test";
import assert from "node:assert/strict";

test("verifyPassword rejects plaintext fallback in production mode", async () => {
  process.env.NODE_ENV = "production";
  delete process.env.ALLOW_LEGACY_PLAINTEXT_PASSWORDS;
  const { verifyPassword } = await import(`../src/utils/security.js?t=${Date.now()}`);

  const result = await verifyPassword("admin123", "admin123");
  assert.equal(result.valid, false);
  assert.equal(result.rehash, false);
});

test("verifyPassword supports plaintext fallback when explicitly enabled", async () => {
  process.env.NODE_ENV = "production";
  process.env.ALLOW_LEGACY_PLAINTEXT_PASSWORDS = "true";
  const { verifyPassword } = await import(`../src/utils/security.js?t=${Date.now()}`);

  const result = await verifyPassword("admin123", "admin123");
  assert.equal(result.valid, true);
  assert.equal(result.rehash, true);
});
