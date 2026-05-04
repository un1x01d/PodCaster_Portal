import React from "react";

const SOURCE_ICON_ASSETS = {
  google_drive: "/assets/source-icons/google-drive.svg",
  google: "/assets/source-icons/google-drive.svg",
  gdrive: "/assets/source-icons/google-drive.svg",
  dropbox: "/assets/source-icons/dropbox.svg",
  onedrive: "/assets/source-icons/onedrive.svg",
  email: "/assets/source-icons/email.svg",
  sftp_storage: "/assets/source-icons/sftp.svg",
  sftp: "/assets/source-icons/sftp.svg",
  scp: "/assets/source-icons/sftp.svg",
  ssh: "/assets/source-icons/sftp.svg",
  gcs_storage: "/assets/source-icons/google-cloud-storage.svg",
  google_cloud_storage: "/assets/source-icons/google-cloud-storage.svg",
  gcs: "/assets/source-icons/google-cloud-storage.svg",
  gcloud_storage: "/assets/source-icons/google-cloud-storage.svg",
  s3_storage: "/assets/source-icons/amazon-s3.svg",
  s3: "/assets/source-icons/amazon-s3.svg",
  amazon_s3: "/assets/source-icons/amazon-s3.svg",
  aws_s3: "/assets/source-icons/amazon-s3.svg",
  aws: "/assets/source-icons/amazon-s3.svg",
  azure_blob_storage: "/assets/source-icons/azure-blob-storage.svg",
  azure_blob: "/assets/source-icons/azure-blob-storage.svg",
  azure_storage: "/assets/source-icons/azure-blob-storage.svg",
  azure: "/assets/source-icons/azure-blob-storage.svg",
  quickbooks: "/assets/source-icons/quickbooks.svg",
  local: "/assets/source-icons/manual-upload.svg",
  local_file: "/assets/source-icons/manual-upload.svg",
  uploaded: "/assets/source-icons/manual-upload.svg",
  upload: "/assets/source-icons/manual-upload.svg",
};

const THEMED_SOURCE_ICONS = new Set([
  "email",
  "sftp_storage",
  "sftp",
  "scp",
  "ssh",
  "local",
  "local_file",
  "uploaded",
  "upload",
]);

export default function SourceProviderIcon({ provider = "", className = "h-3.5 w-3.5" }) {
  const normalized = String(provider || "").trim().toLowerCase();
  const asset = SOURCE_ICON_ASSETS[normalized];

  if (asset) {
    if (THEMED_SOURCE_ICONS.has(normalized)) {
      return (
        <span
          aria-hidden="true"
          className={`${className} inline-block shrink-0 bg-[hsl(var(--primary))]`}
          style={{
            WebkitMask: `url("${asset}") center / contain no-repeat`,
            mask: `url("${asset}") center / contain no-repeat`,
          }}
        />
      );
    }

    return (
      <img
        src={asset}
        alt=""
        aria-hidden="true"
        className={`${className} object-contain`}
        draggable="false"
        loading="lazy"
      />
    );
  }

  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" className={className}>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6 3.5h9l3.5 3.5V20A1.5 1.5 0 0 1 17 21.5H6A1.5 1.5 0 0 1 4.5 20V5A1.5 1.5 0 0 1 6 3.5Z"
      />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 3.5V7h3.5"
      />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8 12h8M8 15h8"
      />
    </svg>
  );
}
