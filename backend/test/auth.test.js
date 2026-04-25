import test from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";

test("generateToken includes expiry", async () => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_EXPIRES_IN = "1h";
  const { generateToken } = await import(`../src/middleware/auth.js?t=${Date.now()}`);

  const token = generateToken({ id: 1, email: "a@b.com", role: "admin" });
  const decoded = jwt.decode(token);

  assert.ok(decoded.exp, "token should include exp claim");
  assert.equal(decoded.id, 1);
  assert.equal(decoded.email, "a@b.com");
  assert.equal(decoded.role, "admin");
});
