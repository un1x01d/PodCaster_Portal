import test from "node:test";
import assert from "node:assert/strict";

test("loginRateLimit blocks after threshold", async () => {
  process.env.LOGIN_RATE_LIMIT_MAX = "2";
  process.env.LOGIN_RATE_LIMIT_WINDOW_MS = "60000";
  const mod = await import(`../src/middleware/rateLimit.js?t=${Date.now()}`);
  const { loginRateLimit, __clearLoginRateLimitStateForTests } = mod;
  __clearLoginRateLimitStateForTests();

  const makeReq = () => ({ ip: "127.0.0.1", body: { email: "user@example.com" } });
  const makeRes = () => {
    const headers = {};
    return {
      statusCode: 200,
      set(name, value) { headers[name] = value; },
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.payload = payload; return this; },
      headers,
    };
  };

  let nextCalled = 0;
  loginRateLimit(makeReq(), makeRes(), () => { nextCalled += 1; });
  loginRateLimit(makeReq(), makeRes(), () => { nextCalled += 1; });
  const blockedRes = makeRes();
  loginRateLimit(makeReq(), blockedRes, () => { nextCalled += 1; });

  assert.equal(nextCalled, 2);
  assert.equal(blockedRes.statusCode, 429);
  assert.equal(blockedRes.payload.error, "too_many_attempts");
});
