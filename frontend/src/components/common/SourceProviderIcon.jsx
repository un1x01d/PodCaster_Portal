import React from "react";

export default function SourceProviderIcon({ provider = "", className = "h-3.5 w-3.5" }) {
  const normalized = String(provider || "").trim().toLowerCase();

  if (normalized === "google_drive" || normalized === "google" || normalized === "gdrive") {
    return (
      <img
        src="https://fonts.gstatic.com/s/i/productlogos/drive_2020q4/v8/web-64dp/logo_drive_2020q4_color_2x_web_64dp.png"
        alt=""
        aria-hidden="true"
        className={className}
      />
    );
  }

  if (normalized === "dropbox") {
    return (
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" className={className}>
        <path fill="#0061FF" d="M6 2 0 6l6 4 6-4-6-4Zm12 0-6 4 6 4 6-4-6-4ZM6 10l-6 4 6 4 6-4-6-4Zm12 0-6 4 6 4 6-4-6-4ZM12 14l-6 4 6 4 6-4-6-4Z" />
      </svg>
    );
  }

  if (normalized === "onedrive") {
    return (
      <img
        src="https://upload.wikimedia.org/wikipedia/commons/e/e7/Microsoft_OneDrive_Icon_%282025_-_present%29.svg"
        alt=""
        aria-hidden="true"
        className={className}
      />
    );
  }

  if (normalized === "email") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
        <rect x="4" y="6" width="16" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" d="m5.5 7.5 6.5 5 6.5-5" />
      </svg>
    );
  }

  if (normalized === "sftp_storage" || normalized === "sftp" || normalized === "scp" || normalized === "ssh") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
        <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" d="M5 10.5A4.5 4.5 0 0 1 8.7 3.5a5.5 5.5 0 0 1 10.5 2.2A4 4 0 0 1 18 13H7.5A2.5 2.5 0 0 1 5 10.5Z" />
        <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" d="M12 12v8m0 0-2.5-2.5M12 20l2.5-2.5" />
      </svg>
    );
  }

  if (normalized === "gcs_storage" || normalized === "google_cloud_storage" || normalized === "gcs" || normalized === "gcloud_storage") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
        <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" d="M6.5 17.5h10A4 4 0 0 0 17 9a5.5 5.5 0 0 0-10.4 1.8A3.5 3.5 0 0 0 6.5 17.5Z" />
        <path fill="#4285F4" d="M10 12h4v1h-4z" />
      </svg>
    );
  }

  if (normalized === "s3_storage" || normalized === "s3" || normalized === "amazon_s3" || normalized === "aws_s3" || normalized === "aws") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
        <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" d="M7 7h10v10H7z" />
        <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" d="M9 10h6M9 13h6" />
      </svg>
    );
  }

  if (normalized === "azure_blob_storage" || normalized === "azure" || normalized === "azure_blob" || normalized === "azure_storage") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
        <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" d="M12 3 20 8v8l-8 5-8-5V8z" />
        <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" d="M12 8v8" />
      </svg>
    );
  }

  if (normalized === "local" || normalized === "local_file" || normalized === "uploaded" || normalized === "upload") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
        <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" d="M6 3.5h9l3.5 3.5V20A1.5 1.5 0 0 1 17 21.5H6A1.5 1.5 0 0 1 4.5 20V5A1.5 1.5 0 0 1 6 3.5Z" />
        <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" d="M15 3.5V7h3.5" />
        <path fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" d="M8 12h8M8 15h8" />
      </svg>
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
