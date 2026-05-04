import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultBaseUrlForProvider,
  inferAiProvider,
  normalizeAiProvider,
  resolveChatCompletionProviderConfig,
} from "../src/utils/llmProvider.js";

test("LLM provider aliases and endpoint inference are normalized", () => {
  assert.equal(normalizeAiProvider("google"), "gemini");
  assert.equal(normalizeAiProvider("local"), "ollama");
  assert.equal(inferAiProvider({ model: "gemini-2.5-flash" }), "gemini");
  assert.equal(inferAiProvider({ baseUrl: "http://localhost:11434/v1" }), "ollama");
});

test("provider config resolves model and base URL from runtime settings", () => {
  const gemini = resolveChatCompletionProviderConfig({
    aiProvider: "gemini",
    openaiModel: "gemini-2.5-flash",
    providerConfigs: {
      gemini: {
        model: "gemini-2.5-pro",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
      },
    },
  });
  assert.equal(gemini.provider, "gemini");
  assert.equal(gemini.model, "gemini-2.5-pro");
  assert.equal(gemini.baseUrl, defaultBaseUrlForProvider("gemini"));

  const ollama = resolveChatCompletionProviderConfig({
    aiProvider: "ollama",
    providerConfigs: {
      ollama: {
        model: "mistral",
        baseUrl: "http://localhost:11434/v1/",
      },
    },
  });
  assert.equal(ollama.provider, "ollama");
  assert.equal(ollama.model, "mistral");
  assert.equal(ollama.baseUrl, "http://localhost:11434/v1");
  assert.equal(ollama.apiKey, "ollama");
});
