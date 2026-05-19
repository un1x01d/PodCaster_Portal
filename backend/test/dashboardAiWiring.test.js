import test from "node:test";
import assert from "node:assert/strict";
import { stripSessionMarkerBearer } from "../../frontend/src/utils/auth.js";

test("session marker bearer headers are stripped before request dispatch", () => {
  const headers = {
    Authorization: "Bearer cookie-session:1234567890",
  };
  stripSessionMarkerBearer(headers);
  assert.equal(headers.Authorization, undefined);

  const harmlessHeaders = { Authorization: "Bearer real-jwt-token" };
  stripSessionMarkerBearer(harmlessHeaders);
  assert.equal(harmlessHeaders.Authorization, "Bearer real-jwt-token");
});
