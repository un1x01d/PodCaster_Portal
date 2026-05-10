import { createHmac, createHash, randomBytes, timingSafeEqual } from "crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const DEFAULT_PERIOD = 30;
const DEFAULT_DIGITS = 6;

export function normalize2faDigits(value, fallback = DEFAULT_DIGITS) {
  const parsed = Number.parseInt(value, 10);
  if (parsed === 6 || parsed === 8) return parsed;
  return fallback;
}

export function normalize2faPeriod(value, fallback = DEFAULT_PERIOD) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isInteger(parsed) && parsed >= 15 && parsed <= 120) return parsed;
  return fallback;
}

export function normalizePhoneE164(value) {
  const cleaned = String(value || "").trim().replace(/[\s()-]/g, "");
  if (!/^\+[1-9]\d{7,14}$/.test(cleaned)) return "";
  return cleaned;
}

export function maskPhone(phone) {
  const raw = String(phone || "").trim();
  if (!raw) return "";
  if (raw.length <= 4) return raw;
  return `${raw.slice(0, 3)}******${raw.slice(-2)}`;
}

function encodeBase32(buffer) {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

function decodeBase32(raw) {
  const text = String(raw || "").replace(/=+$/g, "").toUpperCase().replace(/\s+/g, "");
  let bits = 0;
  let value = 0;
  const out = [];
  for (const char of text) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpSecret() {
  return encodeBase32(randomBytes(20));
}

function hotp(secretBase32, counter, digits = DEFAULT_DIGITS) {
  const key = decodeBase32(secretBase32);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = (
    ((hmac[offset] & 0x7f) << 24)
    | (hmac[offset + 1] << 16)
    | (hmac[offset + 2] << 8)
    | hmac[offset + 3]
  ) % (10 ** digits);
  return String(code).padStart(digits, "0");
}

export function buildTotpCode(secretBase32, { period = DEFAULT_PERIOD, digits = DEFAULT_DIGITS, now = Date.now() } = {}) {
  const safeDigits = normalize2faDigits(digits, DEFAULT_DIGITS);
  const safePeriod = normalize2faPeriod(period, DEFAULT_PERIOD);
  const counter = Math.floor(now / 1000 / safePeriod);
  return hotp(secretBase32, counter, safeDigits);
}

export function verifyTotpCode(secretBase32, code, { period = DEFAULT_PERIOD, digits = DEFAULT_DIGITS, window = 1, now = Date.now() } = {}) {
  const cleanCode = String(code || "").trim();
  const safeDigits = normalize2faDigits(digits, DEFAULT_DIGITS);
  const safePeriod = normalize2faPeriod(period, DEFAULT_PERIOD);
  if (!new RegExp(`^\\d{${safeDigits}}$`).test(cleanCode)) return false;
  const baseCounter = Math.floor(now / 1000 / safePeriod);
  for (let drift = -Math.abs(window); drift <= Math.abs(window); drift += 1) {
    const expected = hotp(secretBase32, baseCounter + drift, safeDigits);
    if (expected.length !== cleanCode.length) continue;
    const expectedBuf = Buffer.from(expected);
    const codeBuf = Buffer.from(cleanCode);
    if (timingSafeEqual(expectedBuf, codeBuf)) return true;
  }
  return false;
}

export function buildOtpAuthUrl({ issuer, accountName, secret, digits = DEFAULT_DIGITS, period = DEFAULT_PERIOD }) {
  const safeIssuer = encodeURIComponent(String(issuer || "TFORN Insights").trim() || "TFORN Insights");
  const safeAccount = encodeURIComponent(String(accountName || "user").trim() || "user");
  const safeDigits = normalize2faDigits(digits, DEFAULT_DIGITS);
  const safePeriod = normalize2faPeriod(period, DEFAULT_PERIOD);
  return `otpauth://totp/${safeIssuer}:${safeAccount}?secret=${encodeURIComponent(secret)}&issuer=${safeIssuer}&algorithm=SHA1&digits=${safeDigits}&period=${safePeriod}`;
}

export function generateNumericCode(length = 6) {
  const size = Math.max(4, Math.min(8, Number.parseInt(length, 10) || 6));
  const max = 10 ** size;
  const value = randomBytes(4).readUInt32BE(0) % max;
  return String(value).padStart(size, "0");
}

export function hashCodeForChallenge(challengeId, code) {
  return createHash("sha256")
    .update(`${String(challengeId || "")}:${String(code || "")}`)
    .digest("hex");
}
