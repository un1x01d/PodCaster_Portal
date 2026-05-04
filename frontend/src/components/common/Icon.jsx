import React from "react";
import SourceProviderIcon from "./SourceProviderIcon";

export default function Icon({ name, className = "h-5 w-5" }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  };

  const paths = {
    shield: (
      <>
        <path d="M12 3 19 6v5c0 4.8-3 8.2-7 10-4-1.8-7-5.2-7-10V6l7-3Z" />
        <path d="m9 12 2 2 4-5" />
      </>
    ),
    upload: (
      <>
        <path d="M12 16V4" />
        <path d="m7 9 5-5 5 5" />
        <path d="M4 20h16" />
      </>
    ),
    email: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m4 7 8 6 8-6" />
      </>
    ),
    googleDrive: (
      <>
        <path d="M10 4h4l7 12-2 4h-4L8 8l2-4Z" />
        <path d="M10 4 3 16l2 4h4l7-12" />
        <path d="M5 20h14" />
      </>
    ),
    oneDrive: (
      <>
        <path d="M8.5 18h8a4 4 0 0 0 .8-7.9 5.5 5.5 0 0 0-10.5-1.7A4.8 4.8 0 0 0 8.5 18Z" />
        <path d="M6.8 8.4A4.5 4.5 0 0 0 4 16.5" />
      </>
    ),
    dropbox: (
      <>
        <path d="m7 4 5 3-5 3-5-3 5-3Z" />
        <path d="m17 4 5 3-5 3-5-3 5-3Z" />
        <path d="m7 12 5 3-5 3-5-3 5-3Z" />
        <path d="m17 12 5 3-5 3-5-3 5-3Z" />
        <path d="m12 17 5 3-5 3-5-3 5-3Z" />
      </>
    ),
    sftp: (
      <>
        <rect x="4" y="10" width="16" height="10" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
        <path d="M8 15h5" />
        <path d="m13 13 3 2-3 2" />
      </>
    ),
    bucket: (
      <>
        <path d="M6 8h12l-1.4 12H7.4L6 8Z" />
        <path d="M8 8V5h8v3" />
        <path d="M9 12h6" />
        <path d="M9.5 16h5" />
      </>
    ),
    connector: (
      <>
        <path d="M8 12h8" />
        <path d="M7 8h2v8H7a4 4 0 0 1 0-8Z" />
        <path d="M17 8h-2v8h2a4 4 0 0 0 0-8Z" />
        <path d="M12 5v3" />
        <path d="M12 16v3" />
      </>
    ),
    spreadsheet: (
      <>
        <path d="M5 3h11l3 3v15H5z" />
        <path d="M16 3v4h4" />
        <path d="M8 11h8" />
        <path d="M8 15h8" />
        <path d="M11 9v8" />
      </>
    ),
    folder: (
      <>
        <path d="M3 7h7l2 2h9v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
        <path d="M3 7V5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v2" />
      </>
    ),
    source: (
      <>
        <path d="M4 6h16" />
        <path d="M4 12h16" />
        <path d="M4 18h16" />
        <path d="M8 6v12" />
      </>
    ),
    schema: (
      <>
        <path d="M5 5h6v6H5z" />
        <path d="M13 5h6v6h-6z" />
        <path d="M5 13h6v6H5z" />
        <path d="M13 13h6v6h-6z" />
      </>
    ),
    approval: (
      <>
        <path d="M7 11.5 10.5 15 17 8.5" />
        <path d="M4 4h16v16H4z" />
      </>
    ),
    publish: (
      <>
        <path d="M5 12h14" />
        <path d="m13 6 6 6-6 6" />
        <path d="M5 5v14" />
      </>
    ),
    ai: (
      <>
        <path d="M12 3v3" />
        <path d="M12 18v3" />
        <path d="M3 12h3" />
        <path d="M18 12h3" />
        <path d="m5.6 5.6 2.1 2.1" />
        <path d="m16.3 16.3 2.1 2.1" />
        <path d="m18.4 5.6-2.1 2.1" />
        <path d="m7.7 16.3-2.1 2.1" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    history: (
      <>
        <path d="M4 12a8 8 0 1 0 2.3-5.7" />
        <path d="M4 5v5h5" />
        <path d="M12 8v5l3 2" />
      </>
    ),
    lock: (
      <>
        <rect x="5" y="10" width="14" height="10" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      </>
    ),
    users: (
      <>
        <path d="M16 20v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
        <circle cx="9.5" cy="7" r="4" />
        <path d="M22 20v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </>
    ),
    storage: (
      <>
        <ellipse cx="12" cy="5" rx="7" ry="3" />
        <path d="M5 5v7c0 1.7 3.1 3 7 3s7-1.3 7-3V5" />
        <path d="M5 12v7c0 1.7 3.1 3 7 3s7-1.3 7-3v-7" />
      </>
    ),
    audit: (
      <>
        <path d="M6 3h9l3 3v15H6z" />
        <path d="M14 3v4h4" />
        <path d="M9 12h6" />
        <path d="M9 16h6" />
        <path d="M9 8h2" />
      </>
    ),
    alert: (
      <>
        <path d="M12 9v4" />
        <path d="M12 17h.01" />
        <path d="M10.3 4.3 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0Z" />
      </>
    ),
    check: (
      <>
        <path d="m5 12 4 4L19 6" />
      </>
    ),
    speaker: (
      <>
        <path d="M4 9v6h4l5 4V5L8 9H4Z" />
        <path d="M16 9.5a4 4 0 0 1 0 5" />
        <path d="M18.5 7a7 7 0 0 1 0 10" />
      </>
    ),
  };

  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" {...common}>
      {paths[name] || paths.source}
    </svg>
  );
}
