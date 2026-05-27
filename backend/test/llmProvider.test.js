import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultBaseUrlForProvider,
  inferAiProvider,
  normalizeAiProvider,
  resolveChatCompletionProviderConfig,
} from "../src/utils/llmProvider.js";

test("LLM provider aliases and endpoint inference are normalized", () => {
  process.env.ALLOW_OLLAMA_PROVIDER = "false";
  assert.equal(normalizeAiProvider("google"), "gemini");
  assert.equal(normalizeAiProvider("local"), "openai");
  assert.equal(inferAiProvider({ baseUrl: "http://localhost:11434/v1" }), "openai");
});

test("LLM provider aliases and endpoint inference can resolve Ollama when enabled", () => {
  process.env.ALLOW_OLLAMA_PROVIDER = "true";
  assert.equal(normalizeAiProvider("local"), "ollama");
  assert.equal(inferAiProvider({ model: "gemini-2.5-flash" }), "gemini");
  assert.equal(inferAiProvider({ baseUrl: "http://localhost:11434/v1" }), "ollama");
});

test("provider config resolves model and base URL from runtime settings", () => {
  process.env.ALLOW_OLLAMA_PROVIDER = "true";
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

  process.env.ALLOW_OLLAMA_PROVIDER = "true";
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

test("provider config keeps explicit openai model even when provider config model differs", () => {
  process.env.ALLOW_OLLAMA_PROVIDER = "false";
  const resolved = resolveChatCompletionProviderConfig({
    aiProvider: "openai",
    openaiModel: "gpt-5-nano",
    providerConfigs: {
      openai: {
        model: "gpt-4.1-mini",
        baseUrl: "https://api.openai.com/v1",
      },
    },
  });
  assert.equal(resolved.model, "gpt-4.1-mini");
});

test("provider config falls back to OpenAI values when Ollama settings are disabled", () => {
  process.env.ALLOW_OLLAMA_PROVIDER = "false";
  const openaiFromStaleOllama = resolveChatCompletionProviderConfig({
    aiProvider: "openai",
    openaiModel: "llama3.1",
    openaiBaseUrl: "http://localhost:11434/v1",
  });
  assert.equal(openaiFromStaleOllama.provider, "openai");
  assert.equal(openaiFromStaleOllama.model, "gpt-5");
  assert.equal(openaiFromStaleOllama.baseUrl, defaultBaseUrlForProvider("openai"));
});
