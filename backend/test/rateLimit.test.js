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

test("invitationAcceptRateLimit blocks after threshold", async () => {
  process.env.INVITE_ACCEPT_RATE_LIMIT_MAX = "2";
  process.env.INVITE_ACCEPT_RATE_LIMIT_WINDOW_MS = "60000";
  const mod = await import(`../src/middleware/rateLimit.js?t=${Date.now()}_invite_accept`);
  const { invitationAcceptRateLimit, __clearLoginRateLimitStateForTests } = mod;
  __clearLoginRateLimitStateForTests();

  const makeReq = () => ({ ip: "127.0.0.1", body: { token: "abc123" } });
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
  invitationAcceptRateLimit(makeReq(), makeRes(), () => { nextCalled += 1; });
  invitationAcceptRateLimit(makeReq(), makeRes(), () => { nextCalled += 1; });
  const blockedRes = makeRes();
  invitationAcceptRateLimit(makeReq(), blockedRes, () => { nextCalled += 1; });

  assert.equal(nextCalled, 2);
  assert.equal(blockedRes.statusCode, 429);
  assert.equal(blockedRes.payload.error, "too_many_invitation_accepts");
});

test("invitationIssueRateLimit blocks after threshold", async () => {
  process.env.INVITE_ISSUE_RATE_LIMIT_MAX = "1";
  process.env.INVITE_ISSUE_RATE_LIMIT_WINDOW_MS = "60000";
  const mod = await import(`../src/middleware/rateLimit.js?t=${Date.now()}_invite_issue`);
  const { invitationIssueRateLimit, __clearLoginRateLimitStateForTests } = mod;
  __clearLoginRateLimitStateForTests();

  const makeReq = () => ({ ip: "127.0.0.1", user: { id: 9 }, body: { groupId: 2 } });
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
  invitationIssueRateLimit(makeReq(), makeRes(), () => { nextCalled += 1; });
  const blockedRes = makeRes();
  invitationIssueRateLimit(makeReq(), blockedRes, () => { nextCalled += 1; });

  assert.equal(nextCalled, 1);
  assert.equal(blockedRes.statusCode, 429);
  assert.equal(blockedRes.payload.error, "too_many_invitation_actions");
});
