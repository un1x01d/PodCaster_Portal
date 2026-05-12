import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { applyBodyParsingMiddleware } from "../src/middleware/bodyParsing.js";

function postJson({ port, path, payload }) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => { raw += chunk; });
        res.on("end", () => resolve({ statusCode: res.statusCode, body: raw }));
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

test("oversized JSON body is rejected with HTTP 413", async () => {
  const app = express();
  applyBodyParsingMiddleware(app, { JSON_BODY_LIMIT: "1kb", URLENCODED_BODY_LIMIT: "1kb" });
  app.post("/echo", (req, res) => res.json({ ok: true, size: JSON.stringify(req.body || {}).length }));
  app.use((err, _req, res, _next) => {
    if (err?.type === "entity.too.large") return res.status(413).json({ error: "payload_too_large" });
    return res.status(500).json({ error: "unexpected_error" });
  });

  const server = app.listen(0);
  try {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const oversized = { data: "x".repeat(2048) };
    const response = await postJson({ port, path: "/echo", payload: oversized });
    assert.equal(response.statusCode, 413);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
