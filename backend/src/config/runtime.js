const DEV_JWT_SECRET = "dev-jwt-2026-rotate-me-7f3b9c1d5a8e4b2f9d6c0a1e3f5b7d9";
const DEV_SETTINGS_KEY = "dev-settings-crypto-2026-6fb8c34d91a2470ea513dd7b8f9120aa";

function isLocalOrigin(origin) {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(String(origin || "").trim());
}

export function validateProductionConfig(env = process.env) {
  if (env.NODE_ENV !== "production") return [];

  const errors = [];
  const jwtSecret = String(env.JWT_SECRET || "").trim();
  const settingsKey = String(env.SETTINGS_CRYPTO_KEY || "").trim();
  const databaseUrl = String(env.DATABASE_URL || "").trim();
  const dbHost = String(env.POSTGRES_HOST || env.PGHOST || "").trim();
  const dbUser = String(env.POSTGRES_USER || env.PGUSER || "").trim();
  const dbName = String(env.POSTGRES_DB || env.PGDATABASE || "").trim();
  const dbPassword = String(env.POSTGRES_PASSWORD || env.PGPASSWORD || "").trim();
  const allowedOrigins = String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  const hasDiscreteDbConfig = !!(dbHost && dbUser && dbName && dbPassword);
  if (!databaseUrl && !hasDiscreteDbConfig) {
    errors.push("DATABASE_URL is required in production (or set POSTGRES_HOST, POSTGRES_USER, POSTGRES_DB, POSTGRES_PASSWORD).");
  }
  if (!jwtSecret) errors.push("JWT_SECRET is required in production.");
  if (jwtSecret && jwtSecret.length < 32) errors.push("JWT_SECRET must be at least 32 characters in production.");
  if (jwtSecret === DEV_JWT_SECRET) errors.push("JWT_SECRET must not use the development default in production.");
  if (!settingsKey) errors.push("SETTINGS_CRYPTO_KEY is required in production.");
  if (settingsKey && settingsKey.length < 32) errors.push("SETTINGS_CRYPTO_KEY must be at least 32 characters in production.");
  if (settingsKey === DEV_SETTINGS_KEY) errors.push("SETTINGS_CRYPTO_KEY must not use the development default in production.");
  if (!allowedOrigins.length) errors.push("ALLOWED_ORIGINS is required in production.");
  if (allowedOrigins.some(isLocalOrigin)) errors.push("ALLOWED_ORIGINS must not include localhost origins in production.");

  if (String(env.ALLOW_LEGACY_PLAINTEXT_PASSWORDS || "").toLowerCase() === "true") {
    errors.push("ALLOW_LEGACY_PLAINTEXT_PASSWORDS must be disabled in production.");
  }

  return errors;
}
