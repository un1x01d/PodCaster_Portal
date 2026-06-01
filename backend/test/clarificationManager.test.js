import test from "node:test";
import assert from "node:assert/strict";
process.env.CHAT_CLARIFICATION_STORE = "memory";

import {
  clarificationKey,
  setPendingClarification,
  getPendingClarification,
  clearPendingClarification,
  resolveClarificationReply,
  __clearClarificationFallbackForTests,
} from "../src/services/ai/clarificationManager.js";

test("clarification keys include tenant user session and sheet scope", () => {
  const a = clarificationKey({ tenantId: 1, userId: 2, sessionId: "chat-a", sheetId: "sheet-1" });
  const b = clarificationKey({ tenantId: 1, userId: 2, sessionId: "chat-b", sheetId: "sheet-1" });
  const c = clarificationKey({ tenantId: 9, userId: 2, sessionId: "chat-a", sheetId: "sheet-1" });

  assert.match(a, /^chat_pending_clarification:1:2:chat-a:sheet-1$/);
  assert.notEqual(a, b);
  assert.notEqual(a, c);
});

test("clarification fallback store preserves pending state and expires old entries", async () => {
  __clearClarificationFallbackForTests();
  const key = clarificationKey({ tenantId: 1, userId: 2, sessionId: "chat-a", sheetId: "sheet-1" });

  await setPendingClarification(key, {
    question: "Which metric?",
    field: "metric",
    options: [{ value: "Revenue" }, { value: "Net Revenue" }],
  });
  const stored = await getPendingClarification(key);
  assert.equal(stored?.field, "metric");
  assert.equal(stored?.options?.[1]?.value, "Net Revenue");

  await setPendingClarification(key, {
    question: "Expired",
    field: "metric",
    options: [{ value: "Revenue" }],
    expiresAt: new Date(Date.now() - 1000).toISOString(),
  });
  assert.equal(await getPendingClarification(key), null);

  await clearPendingClarification(key);
});

test("clarification reply resolver supports numeric ordinal and option text", () => {
  const pending = { options: [{ value: "Revenue Total" }, { value: "Net Revenue" }] };
  assert.equal(resolveClarificationReply(pending, "2"), "Net Revenue");
  assert.equal(resolveClarificationReply(pending, "the second one"), "Net Revenue");
  assert.equal(resolveClarificationReply(pending, "use Net Revenue"), "Net Revenue");
});
