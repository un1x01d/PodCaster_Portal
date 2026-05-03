import test from "node:test";
import assert from "node:assert/strict";
import {
  buildChatCompletionRequestBody,
  extractOpenAiAssistantText,
  getOpenAiResponseDiagnostics,
  minCompletionTokensForModel,
} from "../src/utils/openAiCompat.js";

test("GPT-5 chat completions use reasoning effort and omit temperature", () => {
  const body = buildChatCompletionRequestBody({
    model: "gpt-5-nano",
    messages: [{ role: "user", content: "Return JSON." }],
    responseFormat: { type: "json_object" },
    maxCompletionTokens: 100,
    temperature: 0.1,
  });

  assert.equal(body.reasoning_effort, "minimal");
  assert.equal(body.temperature, undefined);
  assert.equal(body.max_completion_tokens, 100);
  assert.deepEqual(body.response_format, { type: "json_object" });
});

test("non-GPT-5 chat completions preserve temperature", () => {
  const body = buildChatCompletionRequestBody({
    model: "gpt-4.1-nano",
    messages: [{ role: "user", content: "Return JSON." }],
    maxCompletionTokens: 100,
    temperature: 0.1,
  });

  assert.equal(body.reasoning_effort, undefined);
  assert.equal(body.temperature, 0.1);
});

test("GPT-5 completion caps are raised to leave room for visible JSON", () => {
  assert.equal(minCompletionTokensForModel("gpt-5-nano", 100, 800, 768), 768);
  assert.equal(minCompletionTokensForModel("gpt-4.1-nano", 100, 800, 768), 100);
});

test("OpenAI text extractor handles chat and nested output shapes", () => {
  assert.equal(
    extractOpenAiAssistantText({ choices: [{ message: { content: "{\"ok\":true}" } }] }),
    "{\"ok\":true}"
  );
  assert.equal(
    extractOpenAiAssistantText({ choices: [{ message: { content: [{ type: "output_text", text: { value: "{\"ok\":true}" } }] } }] }),
    "{\"ok\":true}"
  );
  assert.equal(
    extractOpenAiAssistantText({ output_text: "{\"ok\":true}" }),
    "{\"ok\":true}"
  );
});

test("OpenAI diagnostics include finish reason and token details for empty content", () => {
  const diagnostics = getOpenAiResponseDiagnostics({
    choices: [{ finish_reason: "length", message: { role: "assistant", content: "" } }],
    usage: { prompt_tokens: 10, completion_tokens: 100, completion_tokens_details: { reasoning_tokens: 100 } },
  });

  assert.match(diagnostics, /finish_reason=length/);
  assert.match(diagnostics, /reasoning_tokens=100/);
});
