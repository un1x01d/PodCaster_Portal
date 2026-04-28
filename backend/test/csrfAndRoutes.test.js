import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

test("csrf middleware blocks cookie-auth mutating requests without matching CSRF token", async () => {
  process.env.CSRF_BYPASS_BEARER = "true";
  const { csrfProtect } = await import(`../src/middleware/csrf.js?t=${Date.now()}`);

  const req = { method: "POST", headers: { cookie: "auth_token=abc" } };
  const res = {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.payload = obj; return this; },
  };
  let nextCalled = false;
  csrfProtect(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.payload?.error, "csrf_validation_failed");
});

test("csrf middleware allows bearer-auth mutating requests when bypass is enabled", async () => {
  process.env.CSRF_BYPASS_BEARER = "true";
  const { csrfProtect } = await import(`../src/middleware/csrf.js?t=${Date.now()}_bearer`);

  const req = { method: "PATCH", headers: { authorization: "Bearer token" } };
  const res = {};
  let nextCalled = false;
  csrfProtect(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
});

test("csrf middleware exempts authenticated AI mutating routes", async () => {
  process.env.CSRF_BYPASS_BEARER = "true";
  const { csrfProtect } = await import(`../src/middleware/csrf.js?t=${Date.now()}_ai_exempt`);

  for (const path of ["/chat/query", "/chat/audio", "/dashboard/translate"]) {
    const req = { method: "POST", path, headers: { cookie: "auth_token=abc" } };
    const res = {};
    let nextCalled = false;
    csrfProtect(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true, `expected ${path} to bypass csrf`);
  }
});

test("csrf middleware exempts AI mutating routes with trailing slash", async () => {
  process.env.CSRF_BYPASS_BEARER = "true";
  const { csrfProtect } = await import(`../src/middleware/csrf.js?t=${Date.now()}_ai_exempt_slash`);

  const req = { method: "POST", path: "/chat/query/", headers: { cookie: "auth_token=abc" } };
  const res = {};
  let nextCalled = false;
  csrfProtect(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
});

test("csrf middleware enforces bearer requests in strict mode", async () => {
  process.env.CSRF_BYPASS_BEARER = "true";
  process.env.CSRF_STRICT_MODE = "true";
  const { csrfProtect } = await import(`../src/middleware/csrf.js?t=${Date.now()}_strict`);

  const req = { method: "POST", headers: { authorization: "Bearer token" } };
  const res = {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.payload = obj; return this; },
  };
  let nextCalled = false;
  csrfProtect(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.payload?.error, "csrf_validation_failed");
  delete process.env.CSRF_STRICT_MODE;
});

test("provider status routes require auth middleware", async () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const repoRoot = path.join(__dirname, "..");
  const google = fs.readFileSync(path.join(repoRoot, "src", "routes", "googleRoutes.js"), "utf8");
  const dropbox = fs.readFileSync(path.join(repoRoot, "src", "routes", "dropboxRoutes.js"), "utf8");
  const onedrive = fs.readFileSync(path.join(repoRoot, "src", "routes", "oneDriveRoutes.js"), "utf8");

  assert.match(google, /router\.get\("\/auth\/google\/status", auth, asyncHandler\(getGoogleStatus\)\)/);
  assert.match(dropbox, /router\.get\("\/auth\/dropbox\/status", auth, asyncHandler\(getDropboxStatus\)\)/);
  assert.match(onedrive, /router\.get\("\/auth\/onedrive\/status", auth, asyncHandler\(getOneDriveStatus\)\)/);
});
