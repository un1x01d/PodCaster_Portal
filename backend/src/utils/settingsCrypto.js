import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const ENC_PREFIX = "enc:v1:";
const LEGACY_STATIC_KEY_RAW = Buffer.from(
  "cG9kY2FzdGVyLXBvcnRhbC1zZXR0aW5ncy1tYXN0ZXIta2V5LXYx",
  "base64"
).toString("utf8");

function deriveKey(raw) {
  return createHash("sha256").update(raw).digest();
}

function getActiveKeyRaw() {
  const configured = String(process.env.SETTINGS_CRYPTO_KEY || "").trim();
  return configured || LEGACY_STATIC_KEY_RAW;
}

export function isEncryptedValue(value) {
  return String(value || "").startsWith(ENC_PREFIX);
}

export function encryptSettingValue(plainText) {
  const raw = String(plainText || "");
  if (!raw) return "";
  if (isEncryptedValue(raw)) return raw;
  const key = deriveKey(getActiveKeyRaw());
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(raw, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = `${iv.toString("base64url")}.${encrypted.toString("base64url")}.${tag.toString("base64url")}`;
  return `${ENC_PREFIX}${payload}`;
}

export function decryptSettingValue(value) {
  const raw = String(value || "");
  if (!raw) return "";
  if (!isEncryptedValue(raw)) return raw;
  const payload = raw.slice(ENC_PREFIX.length);
  const parts = payload.split(".");
  if (parts.length !== 3) throw new Error("settings_decrypt_invalid_payload");
  const [ivB64, cipherB64, tagB64] = parts;
  const iv = Buffer.from(ivB64, "base64url");
  const cipherText = Buffer.from(cipherB64, "base64url");
  const tag = Buffer.from(tagB64, "base64url");

  const keyCandidates = [];
  const activeRaw = getActiveKeyRaw();
  keyCandidates.push(deriveKey(activeRaw));
  if (activeRaw !== LEGACY_STATIC_KEY_RAW) {
    keyCandidates.push(deriveKey(LEGACY_STATIC_KEY_RAW));
  }

  for (const key of keyCandidates) {
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      const plain = Buffer.concat([decipher.update(cipherText), decipher.final()]);
      return plain.toString("utf8");
    } catch {
      // Try next candidate key.
    }
  }
  throw new Error("settings_decrypt_failed");
}
