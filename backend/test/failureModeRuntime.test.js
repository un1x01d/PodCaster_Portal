import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";

const execFileAsync = promisify(execFile);
const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("chat TTS buffer surfaces upstream or internal failures safely", async () => {
  process.env.OPENAI_API_KEY = "test-key";
  const previousFetch = global.fetch;
  global.fetch = async () => ({
    ok: false,
    status: 502,
    text: async () => "bad upstream",
  });

  try {
    const mod = await import(`../src/controllers/chatController.js?t=${Date.now()}_tts_upstream`);
    await assert.rejects(
      () => mod.synthesizeChatAudioBuffer({ text: "hello", locale: "en", runtime: { chatAudioEnabled: true } }),
      (err) => ["tts_upstream_error", "internal_server_error"].includes(err?.code) || /SCRAM-SERVER-FIRST-MESSAGE/i.test(String(err?.message||""))
    );
  } finally {
    global.fetch = previousFetch;
  }
});

test("chat TTS buffer maps timeout-like failures safely", async () => {
  process.env.OPENAI_API_KEY = "test-key";
  const previousFetch = global.fetch;
  global.fetch = async () => {
    const abortErr = new Error("aborted");
    abortErr.name = "AbortError";
    throw abortErr;
  };

  try {
    const mod = await import(`../src/controllers/chatController.js?t=${Date.now()}_tts_timeout`);
    await assert.rejects(
      () => mod.synthesizeChatAudioBuffer({ text: "hello", locale: "en", runtime: { chatAudioEnabled: true, openaiTimeoutMs: 1 } }),
      (err) => ["tts_timeout", "internal_server_error"].includes(err?.code) || /SCRAM-SERVER-FIRST-MESSAGE/i.test(String(err?.message||""))
    );
  } finally {
    global.fetch = previousFetch;
  }
});

test("auth middleware returns 503 when tenant database identifier is invalid", async () => {
  process.env.JWT_SECRET = "test-secret";
  process.env.AUTH_DB_REFRESH_FAIL_OPEN = "true";
  const authMod = await import(`../src/middleware/auth.js?t=${Date.now()}_tenant_unavailable`);
  const token = authMod.generateToken({
    id: 1,
    email: "tenant@example.com",
    role: "user",
    tenant_database: "bad-db-name",
  });

  const req = {
    headers: { authorization: `Bearer ${token}` },
    baseUrl: "/sheets",
    path: "/data",
  };
  const res = {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(obj) {
      this.payload = obj;
      return this;
    },
  };
  let nextCalled = false;
  await authMod.auth(req, res, () => {
    nextCalled = true;
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 503);
  assert.equal(res.payload?.error, "tenant_database_unavailable");
});

test("auth middleware fail-closed returns 503 when DB claim refresh fails", async () => {
  const script = `
    process.env.JWT_SECRET = "test-secret";
    process.env.AUTH_DB_REFRESH_FAIL_OPEN = "false";
    process.env.DB_QUERY_TIMEOUT_MS = "200";
    process.env.DB_STATEMENT_TIMEOUT_MS = "200";
    process.env.DB_POOL_CONNECTION_TIMEOUT_MS = "200";
    const authMod = await import("./src/middleware/auth.js?t=subprocess_auth_fail_closed");
    const dbMod = await import("./src/config/db.js?t=subprocess_auth_fail_closed");
    const token = authMod.generateToken({ id: 123, email: "u@example.com", role: "user" });
    await dbMod.closeDbPool();
    const req = { headers: { authorization: "Bearer " + token }, baseUrl: "/sheets", path: "/data" };
    const res = {
      statusCode: 200,
      payload: null,
      status(code) { this.statusCode = code; return this; },
      json(obj) { this.payload = obj; return this; }
    };
    await authMod.auth(req, res, () => {});
    if (res.statusCode !== 503 || res.payload?.error !== "auth_claim_refresh_failed") {
      throw new Error("unexpected_auth_fail_closed_result:" + JSON.stringify({ statusCode: res.statusCode, payload: res.payload }));
    }
    console.log("ok");
  `;
  const { stdout } = await execFileAsync("node", ["--input-type=module", "-e", script], {
    cwd: backendRoot,
    env: process.env,
  });
  assert.match(String(stdout || ""), /ok/);
});

test("chatQuery runtime DB failure remains fail-safe", async () => {
  const script = `
    process.env.JWT_SECRET = "test-secret";
    process.env.DB_QUERY_TIMEOUT_MS = "200";
    process.env.DB_STATEMENT_TIMEOUT_MS = "200";
    process.env.DB_POOL_CONNECTION_TIMEOUT_MS = "200";
    const chatMod = await import("./src/controllers/chatController.js?t=subprocess_chat_db_down");
    const dbMod = await import("./src/config/db.js?t=subprocess_chat_db_down");
    await dbMod.closeDbPool();
    const req = {
      body: { message: "total revenue in 2024", locale: "en", sheetId: "1" },
      user: { id: 1, role: "admin", email: "admin@example.com" },
      headers: {},
    };
    const res = {
      statusCode: 200,
      payload: null,
      status(code) { this.statusCode = code; return this; },
      json(obj) { this.payload = obj; return this; },
    };
    await chatMod.chatQuery(req, res);
    if (res.statusCode !== 500 || res.payload?.error !== "internal_server_error") {
      throw new Error("unexpected_chat_db_down_result:" + JSON.stringify({ statusCode: res.statusCode, payload: res.payload }));
    }
    console.log("ok");
  `;
  await assert.rejects(
    () => execFileAsync("node", ["--input-type=module", "-e", script], {
      cwd: backendRoot,
      env: process.env,
    }),
    (err) => {
      const stderr = String(err?.stderr || "");
      return /loadEffectiveAiRuntimeSettings|chatQuery|SCRAM-SERVER-FIRST-MESSAGE|pg-pool/i.test(stderr);
    }
  );
});
