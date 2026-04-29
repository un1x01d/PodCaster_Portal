import test from "node:test";
import assert from "node:assert/strict";
import { validateProductionConfig } from "../src/config/runtime.js";

test("production config validation is disabled outside production", () => {
  assert.deepEqual(validateProductionConfig({ NODE_ENV: "development" }), []);
});

test("production config validation rejects missing and dev-default secrets", () => {
  const errors = validateProductionConfig({
    NODE_ENV: "production",
    DATABASE_URL: "",
    JWT_SECRET: "dev-jwt-2026-rotate-me-7f3b9c1d5a8e4b2f9d6c0a1e3f5b7d9",
    SETTINGS_CRYPTO_KEY: "dev-settings-crypto-2026-6fb8c34d91a2470ea513dd7b8f9120aa",
    ALLOWED_ORIGINS: "http://localhost:5173",
  });

  assert.ok(errors.some((e) => e.includes("DATABASE_URL")));
  assert.ok(errors.some((e) => e.includes("JWT_SECRET must not use")));
  assert.ok(errors.some((e) => e.includes("SETTINGS_CRYPTO_KEY must not use")));
  assert.ok(errors.some((e) => e.includes("localhost")));
});

test("production config validation accepts strong production-like config", () => {
  const errors = validateProductionConfig({
    NODE_ENV: "production",
    DATABASE_URL: "postgres://portal:strong-password@10.0.0.5:5432/portaldb",
    JWT_SECRET: "prod-jwt-secret-with-more-than-32-characters",
    SETTINGS_CRYPTO_KEY: "prod-settings-key-with-more-than-32-chars",
    ALLOWED_ORIGINS: "https://portal.example.com",
  });

  assert.deepEqual(errors, []);
});

test("production config validation accepts discrete postgres env vars when DATABASE_URL is unset", () => {
  const errors = validateProductionConfig({
    NODE_ENV: "production",
    POSTGRES_HOST: "/cloudsql/project:region:instance",
    POSTGRES_USER: "portal",
    POSTGRES_PASSWORD: "strong-db-password",
    POSTGRES_DB: "portaldb",
    JWT_SECRET: "prod-jwt-secret-with-more-than-32-characters",
    SETTINGS_CRYPTO_KEY: "prod-settings-key-with-more-than-32-chars",
    ALLOWED_ORIGINS: "https://portal.example.com",
  });

  assert.deepEqual(errors, []);
});
