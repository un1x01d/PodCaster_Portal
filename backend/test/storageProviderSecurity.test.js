import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, "..");

async function loadCommon() {
  delete process.env.STORAGE_PROVIDER_ALLOW_PRIVATE_NETWORKS;
  delete process.env.STORAGE_PROVIDER_ALLOW_INSECURE_HTTP;
  delete process.env.STORAGE_PROVIDER_ALLOW_INTERNAL_HOSTNAMES;
  delete process.env.STORAGE_PROVIDER_ALLOW_LOCALHOST;
  return import(`../src/utils/storageProviders/common.js?t=${Date.now()}_${Math.random()}`);
}

function read(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("storage provider URL guard allows localhost development endpoints", async () => {
  const { assertSafeStorageProviderUrl } = await loadCommon();

  await assert.doesNotReject(() => assertSafeStorageProviderUrl("http://localhost:9000"));
  await assert.doesNotReject(() => assertSafeStorageProviderUrl("http://127.0.0.1:9000"));
});

test("storage provider URL guard blocks internal hostnames and private metadata addresses", async () => {
  const { assertSafeStorageProviderUrl } = await loadCommon();

  await assert.rejects(
    () => assertSafeStorageProviderUrl("https://db:9000"),
    /storage_provider_internal_hostname_not_allowed/
  );
  await assert.rejects(
    () => assertSafeStorageProviderUrl("https://169.254.169.254/latest/meta-data"),
    /storage_provider_private_network_not_allowed/
  );
  await assert.rejects(
    () => assertSafeStorageProviderUrl("https://192.168.1.10:9000"),
    /storage_provider_private_network_not_allowed/
  );
});

test("storage provider failures do not include upstream response snippets", () => {
  const files = [
    "src/controllers/storageController.js",
    "src/utils/storageProviders/s3.js",
    "src/utils/storageProviders/gcs.js",
    "src/utils/storageProviders/azure.js",
    "src/utils/storageProviders/sftp.js",
  ];
  const source = files.map(read).join("\n");

  assert.doesNotMatch(source, /slice\(0,\s*(300|400)\)/);
  assert.doesNotMatch(source, /details:\s*text/);
  assert.doesNotMatch(source, /details:\s*\(stderr \|\| stdout\)/);
});
