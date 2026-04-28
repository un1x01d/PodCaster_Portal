import test from "node:test";
import assert from "node:assert/strict";

test("settings crypto roundtrip works with default key", async () => {
  delete process.env.SETTINGS_CRYPTO_KEY;
  const mod = await import(`../src/utils/settingsCrypto.js?t=${Date.now()}_default`);
  const secret = "client-secret-default";
  const enc = mod.encryptSettingValue(secret);
  assert.ok(enc.startsWith("enc:v1:"));
  assert.equal(mod.decryptSettingValue(enc), secret);
});

test("settings crypto roundtrip works with configured key", async () => {
  process.env.SETTINGS_CRYPTO_KEY = "custom-key-for-tests";
  const mod = await import(`../src/utils/settingsCrypto.js?t=${Date.now()}_custom`);
  const secret = "client-secret-custom";
  const enc = mod.encryptSettingValue(secret);
  assert.ok(enc.startsWith("enc:v1:"));
  assert.equal(mod.decryptSettingValue(enc), secret);
});

test("settings crypto decrypt supports legacy ciphertext after key rotation", async () => {
  delete process.env.SETTINGS_CRYPTO_KEY;
  const legacy = await import(`../src/utils/settingsCrypto.js?t=${Date.now()}_legacy`);
  const secret = "legacy-secret";
  const legacyEncrypted = legacy.encryptSettingValue(secret);

  process.env.SETTINGS_CRYPTO_KEY = "rotated-key-for-tests";
  const rotated = await import(`../src/utils/settingsCrypto.js?t=${Date.now()}_rotated`);
  assert.equal(rotated.decryptSettingValue(legacyEncrypted), secret);
});
