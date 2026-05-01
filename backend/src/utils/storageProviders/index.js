import { normalizeStorageProviderKey, trimString, loadStorageProviderConfig } from "./common.js";
import { listSftpEntries, fetchSftpMetadata, downloadSftpFile } from "./sftp.js";
import { listGcsEntries, fetchGcsMetadata, downloadGcsFile } from "./gcs.js";
import { listS3Entries, fetchS3Metadata, downloadS3File } from "./s3.js";
import { listAzureEntries, fetchAzureMetadata, downloadAzureFile } from "./azure.js";

export { normalizeStorageProviderKey };

export async function getStorageProviderStatus(provider, groupId = null) {
  const normalizedProvider = normalizeStorageProviderKey(provider);
  if (!normalizedProvider) throw new Error("unsupported_storage_provider");
  const cfg = await loadStorageProviderConfig(normalizedProvider, groupId);
  return {
    provider: normalizedProvider,
    enabled: !!cfg?.enabled,
    configured: !!cfg,
    groupId: Number.isInteger(groupId) && groupId > 0 ? groupId : null,
  };
}

export async function listStorageProviderEntries({ provider, groupId = null, path: currentPath = "" }) {
  const normalizedProvider = normalizeStorageProviderKey(provider);
  if (!normalizedProvider) throw new Error("unsupported_storage_provider");
  const cfg = await loadStorageProviderConfig(normalizedProvider, groupId);
  if (!cfg?.enabled) throw new Error("storage_provider_disabled");

  if (normalizedProvider === "sftp_storage") return listSftpEntries(cfg, currentPath);
  if (normalizedProvider === "gcs_storage") return listGcsEntries(cfg, currentPath);
  if (normalizedProvider === "s3_storage") return listS3Entries(cfg, currentPath);
  if (normalizedProvider === "azure_blob_storage") return listAzureEntries(cfg, currentPath);
  throw new Error("unsupported_storage_provider");
}

export async function fetchStorageProviderMetadata({ provider, groupId = null, userId = null, sourceRef = null }) {
  const normalizedProvider = normalizeStorageProviderKey(provider);
  const ref = trimString(sourceRef);
  if (!normalizedProvider || !ref) return null;
  const cfg = await loadStorageProviderConfig(normalizedProvider, groupId);
  if (!cfg?.enabled) throw new Error("storage_provider_disabled");

  if (normalizedProvider === "sftp_storage") return fetchSftpMetadata(cfg, ref);
  if (normalizedProvider === "gcs_storage") return fetchGcsMetadata(cfg, ref);
  if (normalizedProvider === "s3_storage") return fetchS3Metadata(cfg, ref);
  if (normalizedProvider === "azure_blob_storage") return fetchAzureMetadata(cfg, ref);
  throw new Error("unsupported_storage_provider");
}

export async function downloadStorageProviderFile({ provider, groupId = null, userId = null, sourceRef = null }) {
  const normalizedProvider = normalizeStorageProviderKey(provider);
  const ref = trimString(sourceRef);
  if (!normalizedProvider || !ref) return null;
  const cfg = await loadStorageProviderConfig(normalizedProvider, groupId);
  if (!cfg?.enabled) throw new Error("storage_provider_disabled");

  if (normalizedProvider === "sftp_storage") {
    const meta = await fetchSftpMetadata(cfg, ref);
    const download = await downloadSftpFile(cfg, ref);
    return { ...meta, ...download, provider: "sftp_storage", sourceRef: ref };
  }
  if (normalizedProvider === "gcs_storage") {
    const meta = await fetchGcsMetadata(cfg, ref);
    const download = await downloadGcsFile(cfg, ref);
    return { ...meta, ...download, provider: "gcs_storage", sourceRef: ref };
  }
  if (normalizedProvider === "s3_storage") {
    const meta = await fetchS3Metadata(cfg, ref);
    const download = await downloadS3File(cfg, ref);
    return { ...meta, ...download, provider: "s3_storage", sourceRef: ref };
  }
  if (normalizedProvider === "azure_blob_storage") {
    const meta = await fetchAzureMetadata(cfg, ref);
    const download = await downloadAzureFile(cfg, ref);
    return { ...meta, ...download, provider: "azure_blob_storage", sourceRef: ref };
  }
  throw new Error("unsupported_storage_provider");
}
