import test from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";

test("generateToken includes expiry", async () => {
  process.env.JWT_SECRET = "test-secret";
  delete process.env.JWT_ISSUER;
  delete process.env.JWT_AUDIENCE;
  process.env.JWT_EXPIRES_IN = "1h";
  const { generateToken } = await import(`../src/middleware/auth.js?t=${Date.now()}`);

  const token = generateToken({ id: 1, email: "a@b.com", role: "admin" });
  const decoded = jwt.decode(token);

  assert.ok(decoded.exp, "token should include exp claim");
  assert.equal(decoded.id, 1);
  assert.equal(decoded.email, "a@b.com");
  assert.equal(decoded.role, "admin");
});

test("generateToken includes issuer/audience when configured", async () => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_EXPIRES_IN = "1h";
  process.env.JWT_ISSUER = "issuer-test";
  process.env.JWT_AUDIENCE = "audience-test";
  const { generateToken } = await import(`../src/middleware/auth.js?t=${Date.now()}_issaud`);

  const token = generateToken({ id: 2, email: "b@c.com", role: "user" });
  const decoded = jwt.decode(token);
  assert.equal(decoded.iss, "issuer-test");
  assert.equal(decoded.aud, "audience-test");
});
