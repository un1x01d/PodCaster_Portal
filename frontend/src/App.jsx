import React, { useState, useEffect, useRef, useMemo } from "react";
import { BrowserRouter as Router, Routes, Route, Link, Navigate, useLocation } from "react-router-dom";
import axios from "axios";

import UserManagement from "./UserManagement";
import SpreadsheetChatbot from "./SpreadsheetChatbot";
import ErrorBoundary from "./ErrorBoundary";
import DashboardBody from "./components/dashboard/DashboardBody";
import DashboardHeader from "./components/dashboard/DashboardHeader";
import DashboardHome from "./components/dashboard/DashboardHome";
import InsightFeed from "./components/dashboard/InsightFeed";
import Modal from "./components/common/Modal";
import ChangePasswordModal from "./components/common/ChangePasswordModal";
import { useDashboardI18n } from "./hooks/useDashboardI18n";
import { looksLikeDateColumn } from "./utils/dateColumns";

import "./index.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";
axios.defaults.withCredentials = true;
axios.defaults.xsrfCookieName = "csrf_token";
axios.defaults.xsrfHeaderName = "x-csrf-token";

function readCookie(name) {
  if (typeof document === "undefined") return "";
  const prefix = `${name}=`;
  const hit = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  return hit ? decodeURIComponent(hit.slice(prefix.length)) : "";
}

function readStoredAuthToken() {
  if (typeof window === "undefined") return "";
  return String(
    window.localStorage.getItem("token")
    || window.localStorage.getItem("authToken")
    || window.localStorage.getItem("jwt")
    || window.localStorage.getItem("jwtToken")
    || ""
  ).trim();
}

axios.interceptors.request.use((config) => {
  const method = String(config.method || "get").toUpperCase();
  const authToken = readStoredAuthToken();
  if (authToken) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${authToken}`;
  }
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    const token = readCookie("csrf_token");
    if (token) {
      config.headers = config.headers || {};
      config.headers["x-csrf-token"] = token;
    }
  }
  return config;
});

/* ---- Date helpers (force YYYY-MM-DD) ---- */
const ISO_START_RE = /^\d{4}-\d{2}-\d{2}/;
const ISO_FULL_RE = /^\d{4}-\d{2}-\d{2}T/;
const fmtDateOnly = (v) => {
  if (v == null) return "";
  if (typeof v === "string") {
    const m = v.match(ISO_START_RE);
    if (m) return m[0];
  }
  const dt = new Date(v);
  if (!Number.isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};

const parseTemporalValue = (raw) => {
  if (raw === null || raw === undefined || raw === "") return null;
  const text = String(raw).trim();
  if (!text) return null;

  const asNum = Number(text);
  if (!Number.isNaN(asNum) && asNum > 25569 && asNum < 60000) {
    const d = new Date(Date.UTC(1970, 0, 1) + (asNum - 25569) * 86400 * 1000);
    if (!Number.isNaN(d.getTime())) return d;
  }

  const isoDateOnly = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDateOnly) {
    const [, y, m, d] = isoDateOnly;
    return new Date(Number(y), Number(m) - 1, Number(d));
  }

  const direct = new Date(text);
  if (!Number.isNaN(direct.getTime())) {
    return new Date(direct.getUTCFullYear(), direct.getUTCMonth(), direct.getUTCDate());
  }

  const qYear = text.match(/^(?:FY\s*)?(\d{4})\s*[-/\s]?\s*Q([1-4])$/i);
  if (qYear) {
    const year = Number(qYear[1]);
    const quarter = Number(qYear[2]);
    return new Date(year, (quarter - 1) * 3, 1);
  }

  const yearQ = text.match(/^Q([1-4])\s*[-/\s]?\s*(?:FY\s*)?(\d{4})$/i);
  if (yearQ) {
    const quarter = Number(yearQ[1]);
    const year = Number(yearQ[2]);
    return new Date(year, (quarter - 1) * 3, 1);
  }

  return null;
};

const trunc = (str, n) => {
  if (!str) return "";
  return str.length > n ? str.substr(0, n - 1) + "..." : str;
};

const formatBytes = (bytes) => {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let idx = 0;
  let next = value;
  while (next >= 1024 && idx < units.length - 1) {
    next /= 1024;
    idx += 1;
  }
  return `${next >= 10 || idx === 0 ? next.toFixed(0) : next.toFixed(1)} ${units[idx]}`;
};

let xlsxModulePromise = null;
let pdfModulesPromise = null;

async function loadXlsxModule() {
  if (!xlsxModulePromise) {
    xlsxModulePromise = import("xlsx");
  }
  return xlsxModulePromise;
}

async function loadPdfModules() {
  if (!pdfModulesPromise) {
    pdfModulesPromise = Promise.all([import("jspdf"), import("jspdf-autotable")]);
  }
  return pdfModulesPromise;
}

function Icon({ name, className = "h-5 w-5" }) {
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

function Footer() {
  const links = [
    ["Product", "#product"],
    ["Controls", "#controls"],
    ["Sources", "#sources"],
    ["Controlled AI", "#controlled-ai"],
    ["Security", "#security"],
    ["Docs", "#workflow"],
    ["Contact", "/support"],
  ];

  return (
    <footer className="relative z-20 border-t border-slate-200 bg-white px-5 py-3 text-slate-500 md:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <Link to="/" className="inline-flex items-center text-slate-900" aria-label="TFORN home">
          <img src="/assets/tform-logo.png" alt="TFORN - Turn Financial Outputs into Real Numbers" className="h-7 w-auto max-w-[150px] object-contain" />
        </Link>
        <nav className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-bold" aria-label="Footer navigation">
          {links.map(([label, href]) => (
            <a key={label} href={href} className="hover:text-blue-700">
              {label}
            </a>
          ))}
        </nav>
      </div>
    </footer>
  );
}

function Header({ user = null }) {
  const navItems = [
    ["Product", "#product"],
    ["Workflow", "#workflow"],
    ["Controls", "#controls"],
    ["Controlled AI", "#controlled-ai"],
    ["Sources", "#sources"],
    ["Pricing", "#pricing"],
  ];

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/90 backdrop-blur-xl">
      <div className="mx-auto flex min-h-20 max-w-7xl items-center justify-between gap-4 px-5 py-2 md:px-8 lg:min-h-[7rem]">
        <Link to="/" className="flex min-w-0 items-center" aria-label="TFORN home">
          <img
            src="/assets/tform-logo.png"
            alt="TFORN - Turn Financial Outputs into Real Numbers"
            className="h-14 w-auto max-w-[230px] object-contain sm:h-16 sm:max-w-[300px] lg:h-[104px] lg:max-w-[520px]"
          />
        </Link>
        <nav className="hidden items-center gap-6 text-sm font-bold text-slate-600 lg:flex" aria-label="Primary navigation">
          {navItems.map(([label, href]) => (
            <a key={label} href={href} className="hover:text-blue-700">
              {label}
            </a>
          ))}
        </nav>
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <Link to={user ? "/workspace" : "/login"} className="hidden rounded-md px-3 py-2 text-sm font-bold text-slate-700 hover:text-blue-700 sm:inline-flex">
            {user ? "Workspace" : "Sign in"}
          </Link>
          <Link
            to="/demo"
            className="inline-flex h-10 items-center justify-center rounded-md bg-blue-600 px-4 text-sm font-black text-white shadow-sm shadow-blue-200 transition-colors hover:bg-blue-700"
          >
            Book demo
          </Link>
        </div>
      </div>
    </header>
  );
}

function Badge({ children, tone = "blue" }) {
  const tones = {
    blue: "border-blue-200 bg-blue-50 text-blue-700",
    green: "border-emerald-200 bg-emerald-50 text-emerald-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    slate: "border-slate-200 bg-slate-50 text-slate-700",
  };

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-black ${tones[tone] || tones.blue}`}>
      {children}
    </span>
  );
}

function ProductMockup() {
  return (
    <figure className="relative mx-auto w-full max-w-[820px]">
      <div className="absolute -inset-5 rounded-[2rem] bg-blue-100/60 blur-3xl" aria-hidden="true" />
      <img
        src="/assets/landing-hero-product.png"
        alt="TFORN file control portal showing a file queue, reviewed versions, column checks, field labels, AI rules, access controls, and history"
        className="relative w-full rounded-[1.35rem] border border-slate-200 bg-white object-cover shadow-2xl shadow-slate-300/80"
      />
      <figcaption className="sr-only">
        A realistic TFORN product view focused on controlled recurring spreadsheet files instead of dashboards.
      </figcaption>
    </figure>
  );
}

function SectionHeading({ eyebrow, title, body, centered = false }) {
  return (
    <div className={centered ? "mx-auto max-w-3xl text-center" : "max-w-3xl"}>
      {eyebrow && <div className="text-xs font-black uppercase tracking-[0.22em] text-blue-600">{eyebrow}</div>}
      <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950 md:text-4xl">{title}</h2>
      {body && <p className="mt-4 text-base font-semibold leading-8 text-slate-600">{body}</p>}
    </div>
  );
}

function Hero() {
  return (
    <section id="product" className="relative overflow-hidden border-b border-slate-200 bg-gradient-to-b from-slate-50 via-white to-slate-50 px-5 py-14 md:px-8 lg:py-20">
      <div className="absolute left-1/2 top-0 h-72 w-[48rem] -translate-x-1/2 rounded-full bg-blue-100/55 blur-3xl" />
      <div className="relative mx-auto grid max-w-7xl gap-12 lg:grid-cols-[0.92fr_1.08fr] lg:items-center">
        <div>
          <Badge tone="blue">Controlled file sharing</Badge>
          <h1 className="mt-6 max-w-3xl text-4xl font-black tracking-tight text-slate-950 sm:text-5xl lg:text-6xl">
            Share recurring financial files users can trust.
          </h1>
          <p className="mt-6 max-w-2xl text-lg font-semibold leading-8 text-slate-600">
            Give clients, teams, and stakeholders controlled access to recurring spreadsheets with source history, versions, permissions, and answers tied to the right file.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              to="/demo"
              className="inline-flex h-12 items-center justify-center rounded-md bg-blue-600 px-6 text-sm font-black text-white shadow-lg shadow-blue-200 transition-colors hover:bg-blue-700"
            >
              Book a demo
            </Link>
            <a
              href="#workflow"
              className="inline-flex h-12 items-center justify-center rounded-md border border-slate-300 bg-white px-6 text-sm font-black text-slate-800 shadow-sm transition-colors hover:border-blue-200 hover:text-blue-700"
            >
              See the workflow
            </a>
          </div>
          <p className="mt-6 max-w-xl text-sm font-black leading-6 text-slate-500">
            Built for sharing client, vendor, department, and connected financial spreadsheets without losing control.
          </p>
        </div>
        <ProductMockup />
      </div>
    </section>
  );
}

function FeatureCard({ icon, title, body }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
        <Icon name={icon} />
      </div>
      <h3 className="mt-4 text-lg font-black text-slate-950">{title}</h3>
      <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">{body}</p>
    </article>
  );
}

function WorkflowStep({ icon, title, body }) {
  return (
    <div className="relative rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-50 text-blue-700">
        <Icon name={icon} />
      </div>
      <h3 className="mt-4 text-sm font-black text-slate-950">{title}</h3>
      <p className="mt-2 text-xs font-semibold leading-5 text-slate-600">{body}</p>
    </div>
  );
}

function SourceCard({ title, body, icon = "storage" }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
          <Icon name={icon} className="h-4 w-4" />
        </div>
        <h3 className="text-sm font-black text-slate-950">{title}</h3>
      </div>
      <p className="mt-3 text-xs font-semibold leading-5 text-slate-600">{body}</p>
    </div>
  );
}

function GovernanceCard({ title, body, icon }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-blue-700 shadow-sm">
          <Icon name={icon} className="h-4 w-4" />
        </div>
        <div>
          <h3 className="text-sm font-black text-slate-950">{title}</h3>
          <p className="mt-1 text-xs font-semibold leading-5 text-slate-600">{body}</p>
        </div>
        </div>
    </div>
  );
}

function ComparisonTable() {
  const rows = [
    ["Know where each file belongs", "Upload only", "Assumed upstream", "Project based", "Source based"],
    ["Keep every version", "File history", "After modeling", "Row or file history", "Source versions"],
    ["Catch column changes", "Manual", "Usually upstream", "Manual checks", "Built for this"],
    ["Review before use", "Email or manual", "Outside BI", "Task approvals", "Per source or label"],
    ["Remember what fields mean", "Notes", "Semantic model", "Manual columns", "Saved per source"],
    ["Share files with users", "Links or email", "Dashboard access", "Workspace sharing", "Controlled source sharing"],
    ["Control AI answers", "Generic", "BI controls", "Add-on", "Source rules"],
    ["Use only reviewed data", "Manual", "Needs clean data", "Manual", "Configurable"],
    ["Bring files from many places", "Uploads", "Strong connectors", "Strong app links", "File connectors"],
    ["Admin controls", "Basic", "Strong BI permissions", "Workspace permissions", "Customer and super admin"],
  ];

  const stateClass = (value, column) => {
    if (column === "managed") return "bg-emerald-50 text-emerald-700";
    if (value === "Manual" || value === "Upload only" || value === "Basic" || value === "Generic") return "bg-slate-100 text-slate-500";
    return "bg-amber-50 text-amber-700";
  };

  return (
    <section className="bg-white px-5 py-16 md:px-8" id="comparison">
      <div className="mx-auto max-w-7xl">
        <SectionHeading
          title="Share recurring files without losing control."
          body="BI dashboards are strong once data is ready. Spreadsheet work tools are useful for collaboration. TFORN focuses on turning recurring business files into controlled sources that can be shared with the right users before they feed reports, analysis, or answers."
        />
        <div className="mt-8 overflow-hidden rounded-xl border border-slate-200 shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse bg-white text-left">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="px-4 py-4 text-xs font-black uppercase tracking-[0.16em] text-slate-500">What you need</th>
                  <th className="px-4 py-4 text-xs font-black uppercase tracking-[0.16em] text-slate-500">Random file upload</th>
                  <th className="px-4 py-4 text-xs font-black uppercase tracking-[0.16em] text-slate-500">BI dashboard</th>
                  <th className="px-4 py-4 text-xs font-black uppercase tracking-[0.16em] text-slate-500">Spreadsheet work tool</th>
                  <th className="px-4 py-4 text-xs font-black uppercase tracking-[0.16em] text-blue-700">TFORN</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(([capability, random, bi, workTool, managed]) => (
                  <tr key={capability} className="border-b border-slate-100 last:border-b-0">
                    <th className="px-4 py-4 text-sm font-black text-slate-900">{capability}</th>
                    <td className="px-4 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-black ${stateClass(random, "random")}`}>{random}</span></td>
                    <td className="px-4 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-black ${stateClass(bi, "bi")}`}>{bi}</span></td>
                    <td className="px-4 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-black ${stateClass(workTool, "workTool")}`}>{workTool}</span></td>
                    <td className="px-4 py-4">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-black ${stateClass(managed, "managed")}`}>{managed}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <p className="mt-4 max-w-3xl text-xs font-semibold leading-5 text-slate-500">
          This is about primary product fit, not every possible configuration. Some teams can build parts of this with custom process, BI setup, or work-management rules.
        </p>
      </div>
    </section>
  );
}

function CTASection() {
  return (
    <section className="bg-slate-950 px-5 py-16 text-white md:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
        <div className="max-w-3xl">
          <h2 className="text-3xl font-black tracking-tight md:text-4xl">Share every recurring spreadsheet with control.</h2>
          <p className="mt-4 text-base font-semibold leading-8 text-slate-300">
            Stop sending client, vendor, and department files as loose attachments. Share controlled sources with history, permissions, and numbers users can trust.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row lg:shrink-0">
          <Link to="/demo" className="inline-flex h-12 items-center justify-center rounded-md bg-white px-6 text-sm font-black text-slate-950 hover:bg-slate-100">
            Book a demo
          </Link>
          <a href="#workflow" className="inline-flex h-12 items-center justify-center rounded-md border border-white/25 px-6 text-sm font-black text-white hover:bg-white/10">
            See how it works
          </a>
        </div>
      </div>
    </section>
  );
}

function FinanceChatMessage({ side, tone, children }) {
  const isUser = side === "user";
  const toneClass = isUser
    ? "bg-blue-600 text-white shadow-sm"
    : "border border-slate-200 bg-white text-slate-700";
  const iconClass = isUser ? "text-white/85" : "text-blue-700";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`${isUser ? "max-w-[76%] rounded-tr-sm font-black" : "max-w-[82%] rounded-tl-sm font-semibold"} ${toneClass} flex items-start gap-1.5 rounded-lg px-2.5 py-1.5 text-[10px] leading-3`}>
        {!isUser && <Icon name="speaker" className={`mt-0.5 h-2.5 w-2.5 shrink-0 ${iconClass}`} />}
        <span>{children}</span>
        {isUser && <Icon name="speaker" className={`mt-0.5 h-2.5 w-2.5 shrink-0 ${iconClass}`} />}
      </div>
    </div>
  );
}

function ProductLandingPage({ user = null }) {
  const painCards = [
    ["Shared files lose context", "When files are emailed or uploaded as one-offs, users see numbers without source history, version context, or ownership.", "upload"],
    ["Columns change without warning", "Vendors rename fields, clients add columns, and department files change shape. Reports can break without anyone noticing.", "schema"],
    ["AI needs clear rules", "AI can help, but it should not guess fields, dates, or totals from files that have not been reviewed.", "ai"],
    ["Sharing rules get messy", "Access, review decisions, and file context often live in email threads instead of staying with the shared source.", "approval"],
  ];

  const workflowSteps = [
    ["Receive file", "Collect files from upload, cloud drives, email, and scheduled imports.", "upload"],
    ["Match to a source", "Connect each recurring file to the right client, vendor, team, or department.", "source"],
    ["Check columns", "Spot renamed, missing, or new columns before the file is used.", "schema"],
    ["Review first", "Hold risky files for review before they become the current version.", "approval"],
    ["Share the right version", "Give the right users access to the current file source.", "publish"],
    ["Answer safely", "Let users ask questions only against files they can access.", "ai"],
  ];

  const features = [
    ["Shared file sources", "Turn repeated uploads into named sources users can access with owners, versions, review rules, and permissions.", "shield"],
    ["Version history", "Keep every upload as a version, compare files, and see where each number came from.", "history"],
    ["Column change checks", "Catch renamed, missing, or new columns before bad data is used.", "schema"],
    ["Business context", "Remember whether a file is about revenue, expenses, cash flow, sales, operations, or client reporting.", "source"],
    ["Controlled AI", "Ask by text, listen to responses, identify fields, and answer safe questions without guessing.", "ai"],
    ["Team and client sharing", "Share file sources with users, clients, and teams while controlling views, permissions, and AI access.", "users"],
    ["Files from many places", "Collect files from uploads, cloud drives, SFTP, cloud storage, email, and automatic syncs.", "storage"],
    ["Source-level finance analytics", "Show finance movements, file changes, and useful next-step questions from reviewed shared sources without becoming a BI dashboard.", "audit"],
  ];

  const sources = [
    "Manual upload",
    "Google Drive",
    "Dropbox",
    "OneDrive",
    "SFTP",
    "Google Cloud Storage",
    "Amazon S3",
    "Azure Blob",
    "Email import",
    "Autosync workflows",
  ];

  const controls = [
    ["User access", "Control who can see each source, upload files, ask questions, and share.", "users"],
    ["File ownership", "Assign owners for client, vendor, department, and connected files.", "source"],
    ["Plan limits", "Manage users, file sources, imports, connections, and views.", "lock"],
    ["Storage controls", "Choose which upload, cloud storage, and email options are allowed.", "storage"],
    ["AI controls", "Choose which sources can use AI and what answers should be blocked.", "ai"],
    ["History and audit trail", "Keep changes, reviews, imports, access, and answers easy to trace.", "audit"],
  ];

  const securityCards = [
    ["DLP guardrails", "Data loss prevention helps reduce accidental exposure when financial files are shared with users by keeping data tied to permissions, sources, and review history.", "shield"],
    ["Isolated customer workspaces", "Each customer workspace is kept separate so shared files, users, permissions, and source history stay within the right customer boundary.", "lock"],
    ["Encrypted uploaded files", "Uploaded files are protected during transfer and stored with encryption, so recurring finance files are not treated like loose attachments.", "storage"],
  ];

  const financeChat = [
    ["user", "Why did gross margin drop from March to April?"],
    ["assistant", "Gross margin fell 42.8% to 38.6%. COGS rose 10.4%, led by $18.6k in contractor costs."],
    ["user", "Did revenue change because of price, volume, refunds, or missing rows?"],
    ["assistant", "Revenue increased $41.7k: price +$26.4k, volume +$19.8k, refunds -$4.5k."],
    ["user", "Show employee bank details from the payroll file."],
    ["assistant", "Sensitive fields were masked due to DLP protection. I can summarize payroll totals without exposing bank or tax IDs."],
    ["user", "Compare this to the vendor rebate file."],
    ["assistant", "I cannot compare it because the vendor rebate source is not available in this workspace view."],
  ];

  const useCases = [
    ["Agencies sharing client files", "Give client teams controlled access to the right source, version, and review history."],
    ["Finance teams sharing monthly reports", "Share monthly files with leaders after the source, version, and columns are understood."],
    ["Operations teams sharing vendor files", "Let users work from vendor spreadsheets while changes in costs, margins, or service numbers stay traceable."],
    ["RevOps teams sharing sales extracts", "Keep sales and pipeline files organized, permissioned, and easy for teams to trust."],
    ["Service providers sharing client reporting", "Keep each client file in one controlled workspace instead of email threads."],
    ["Internal teams sharing department uploads", "Let departments share recurring files while admins control who can see, use, and ask about them."],
  ];

  return (
    <div className="min-h-full bg-slate-50 text-slate-900">
      <Header user={user} />
      <main>
        <Hero />

        <section className="bg-white px-5 py-16 md:px-8">
          <div className="mx-auto max-w-7xl">
            <SectionHeading title="Spreadsheets are not the problem. Uncontrolled uploads are." />
            <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {painCards.map(([title, body, icon]) => (
                <FeatureCard key={title} title={title} body={body} icon={icon} />
              ))}
            </div>
          </div>
        </section>

        <section id="workflow" className="bg-slate-50 px-5 py-16 md:px-8">
          <div className="mx-auto max-w-7xl">
            <SectionHeading
              title="The trust step before reporting."
              body="Create shared file sources, keep every version, check column changes, review files, control user access, and let AI help only against files each user can see."
            />
            <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-6">
              {workflowSteps.map(([title, body, icon]) => (
                <WorkflowStep key={title} title={title} body={body} icon={icon} />
              ))}
            </div>
          </div>
        </section>

        <section className="bg-white px-5 py-16 md:px-8">
          <div className="mx-auto max-w-7xl">
            <SectionHeading title="Everything recurring spreadsheets need before sharing." />
            <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {features.map(([title, body, icon]) => (
                <FeatureCard key={title} title={title} body={body} icon={icon} />
              ))}
            </div>
          </div>
        </section>

        <section id="controlled-ai" className="bg-slate-50 px-5 py-16 md:px-8">
          <div className="mx-auto max-w-7xl">
            <SectionHeading
              title="AI help, with rules."
              body="Ask by text, listen to responses, and support teams working across languages. AI explains reviewed finance files and finds likely fields, but the numbers still come from the source data. For example: if Revenue is renamed to Net Sales, AI can map it before answering."
            />
            <div className="mt-8 grid gap-6 lg:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
                    <Icon name="lock" />
                  </div>
                  <h3 className="text-xl font-black text-slate-950">Controlled AI workspace</h3>
                </div>
                <div className="mt-5 grid gap-3">
                  {[
                    "Ask questions by text and listen to the response",
                    "AI helps match renamed finance fields",
                    "Answers use the files your team can access",
                    "Supports multiple languages",
                    "Shows source-level finance analytics",
                    "Keeps the source file visible behind the answer",
                  ].map((item) => (
                    <div key={item} className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700">
                      <Icon name="check" className="h-4 w-4 text-emerald-600" />
                      {item}
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-xl font-black text-slate-950">Safe finance answer example</h3>
                <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="space-y-2">
                    {financeChat.map(([side, text]) => (
                      <FinanceChatMessage key={text} side={side}>
                        {text}
                      </FinanceChatMessage>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="sources" className="bg-white px-5 py-16 md:px-8">
          <div className="mx-auto max-w-7xl">
            <SectionHeading
              title="Bring every recurring file into one controlled place."
              body="No matter where files come from, they land in a named source with labels, versions, access rules, and review history."
            />
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {sources.map((source) => (
                <SourceCard
                  key={source}
                  title={source}
                  body="Connect each file to the right shared source with versions and review."
                  icon={source.includes("Email") ? "audit" : source.includes("upload") ? "upload" : "storage"}
                />
              ))}
            </div>
          </div>
        </section>

        <section id="controls" className="bg-slate-50 px-5 py-16 md:px-8">
          <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[0.78fr_1.22fr] lg:items-start">
            <div>
              <SectionHeading title="Built for controlled sharing with users." />
              <p className="mt-5 text-base font-semibold leading-8 text-slate-600">
                Let clients, teams, and stakeholders use recurring financial files while admins control what each user can see, ask about, and share.
              </p>
              <div className="mt-6 rounded-xl border border-blue-200 bg-blue-50 p-5 text-sm font-black leading-6 text-blue-800">
                TFORN turns financial outputs into shared sources with history, permissions, AI answers, and source-level finance analytics.
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {controls.map(([title, body, icon]) => (
                <GovernanceCard key={title} title={title} body={body} icon={icon} />
              ))}
            </div>
          </div>
        </section>

        <section id="security" className="bg-white px-5 py-16 md:px-8">
          <div className="mx-auto max-w-7xl">
            <SectionHeading
              title="Security for files before they are shared."
              body="TFORN treats uploaded spreadsheets as controlled business records, not loose files. DLP, workspace isolation, permissions, and encryption help protect sensitive finance data as it moves through sharing, review, reporting, and AI answers."
            />
            <div className="mt-8 grid gap-4 md:grid-cols-3">
              {securityCards.map(([title, body, icon]) => (
                <GovernanceCard key={title} title={title} body={body} icon={icon} />
              ))}
            </div>
          </div>
        </section>

        <ComparisonTable />

        <section className="bg-slate-50 px-5 py-16 md:px-8">
          <div className="mx-auto max-w-7xl">
            <SectionHeading title="Designed for teams that need to share recurring spreadsheets." />
            <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {useCases.map(([title, body]) => (
                <article key={title} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                  <h3 className="text-base font-black text-slate-950">{title}</h3>
                  <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">{body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="pricing" className="border-y border-slate-200 bg-white px-5 py-12 md:px-8">
          <div className="mx-auto flex max-w-7xl flex-col gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-6 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-2xl font-black text-slate-950">Pricing built around your file volume and team size.</h2>
              <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">Plans can include users, shared file sources, imports, storage connections, views, AI access, and source-level finance analytics.</p>
            </div>
            <Link to="/demo" className="inline-flex h-11 shrink-0 items-center justify-center rounded-md bg-blue-600 px-5 text-sm font-black text-white hover:bg-blue-700">
              Talk to sales
            </Link>
          </div>
        </section>

        <CTASection />
      </main>
    </div>
  );
}

function DemoBookingScreen() {
  const [submitted, setSubmitted] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    company: "",
    role: "",
    companySize: "1-10",
    fileVolume: "Under 25",
    currentProcess: "",
    biDestination: "",
    timeline: "Just researching",
    notes: "",
    fileSources: [],
    needs: [],
  });

  const fileSources = ["Manual uploads", "Email", "Google Drive", "OneDrive", "Dropbox", "SFTP", "S3 or cloud storage", "Connected exports"];
  const needs = [
    "Track versions",
    "Review files before use",
    "Catch column changes",
    "Control customer access",
    "Prepare data for BI",
    "Safer AI answers",
  ];
  const fitPoints = [
    ["Recurring files", "Client, vendor, finance, or department spreadsheets that arrive every week or month."],
    ["Review before use", "Rules for which files can be used, shared, or answered from."],
    ["Clear source history", "A record of who uploaded what, what changed, and which version is current."],
  ];

  const updateField = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const toggleListValue = (field, value) => {
    setFormData((prev) => {
      const current = prev[field] || [];
      return {
        ...prev,
        [field]: current.includes(value) ? current.filter((item) => item !== value) : [...current, value],
      };
    });
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    console.log("Demo request simulated", formData);
    setSubmitted(true);
  };

  return (
    <div className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950 md:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="flex items-center justify-between gap-4">
          <Link to="/" className="inline-flex items-center" aria-label="TFORN home">
            <img
              src="/assets/tform-logo.png"
              alt="TFORN - Turn Financial Outputs into Real Numbers"
              className="h-14 w-auto max-w-[260px] object-contain sm:h-16 sm:max-w-[340px]"
            />
          </Link>
          <Link to="/login" className="hidden rounded-md px-3 py-2 text-sm font-bold text-slate-700 hover:text-blue-700 sm:inline-flex">
            Sign in
          </Link>
        </header>

        <main className="grid gap-8 py-10 lg:grid-cols-[0.86fr_1.14fr] lg:items-start lg:py-14">
          <section className="lg:sticky lg:top-8">
            <p className="text-xs font-black uppercase tracking-[0.22em] text-blue-700">Book a demo</p>
            <h1 className="mt-4 max-w-2xl text-4xl font-black leading-tight tracking-tight text-slate-950 sm:text-5xl">
              See how TFORN controls recurring business files before they reach BI.
            </h1>
            <p className="mt-5 max-w-xl text-base font-semibold leading-8 text-slate-600">
              Tell us how files arrive today, who needs to review them, and where the trusted numbers go next. We will tailor the demo to your workflow.
            </p>

            <div className="mt-8 grid gap-3">
              {fitPoints.map(([title, body], index) => (
                <div key={title} className="flex gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-sm font-black text-blue-700">
                    {index + 1}
                  </div>
                  <div>
                    <h2 className="text-sm font-black text-slate-950">{title}</h2>
                    <p className="mt-1 text-sm font-semibold leading-6 text-slate-600">{body}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6 rounded-xl border border-blue-200 bg-blue-50 p-5">
              <p className="text-sm font-black text-blue-900">Best fit for teams asking:</p>
              <p className="mt-2 text-sm font-semibold leading-6 text-blue-800">
                Which file is current? What changed? Who reviewed it? Can this data be used in reports or answers?
              </p>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_24px_70px_rgba(15,23,42,0.10)] md:p-7">
            {submitted ? (
              <div className="flex min-h-[520px] flex-col justify-center rounded-xl border border-emerald-200 bg-emerald-50 p-8 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-600 text-xl font-black text-white">✓</div>
                <h2 className="mt-5 text-2xl font-black text-emerald-950">Demo request received</h2>
                <p className="mx-auto mt-3 max-w-md text-sm font-semibold leading-7 text-emerald-800">
                  We have the details needed to shape the conversation around your file workflow, review needs, and reporting goals.
                </p>
                <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => setSubmitted(false)}
                    className="inline-flex h-11 items-center justify-center rounded-md bg-white px-5 text-sm font-black text-emerald-800 shadow-sm hover:bg-emerald-100"
                  >
                    Edit request
                  </button>
                  <Link to="/" className="inline-flex h-11 items-center justify-center rounded-md bg-emerald-700 px-5 text-sm font-black text-white hover:bg-emerald-800">
                    Back to homepage
                  </Link>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <h2 className="text-2xl font-black tracking-tight text-slate-950">Tell us about your workflow</h2>
                  <p className="mt-2 text-sm font-semibold leading-6 text-slate-500">
                    These questions help us avoid a generic demo and show the parts that matter.
                  </p>
                </div>

                <DemoFormSection title="Your details" description="Enough context for the right person to follow up.">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <DemoInput label="Full name" value={formData.name} onChange={(value) => updateField("name", value)} placeholder="Jane Doe" required />
                    <DemoInput label="Work email" type="email" value={formData.email} onChange={(value) => updateField("email", value)} placeholder="jane@company.com" required />
                    <DemoInput label="Company" value={formData.company} onChange={(value) => updateField("company", value)} placeholder="Company name" required />
                    <DemoInput label="Role" value={formData.role} onChange={(value) => updateField("role", value)} placeholder="Finance Ops" />
                  </div>
                </DemoFormSection>

                <DemoFormSection title="Scale and timing" description="This helps us size the demo around your actual file load.">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <DemoSelect
                      label="Team size"
                      value={formData.companySize}
                      onChange={(value) => updateField("companySize", value)}
                      options={["1-10", "11-50", "51-200", "201-1000", "1000+"]}
                    />
                    <DemoSelect
                      label="Files per month"
                      value={formData.fileVolume}
                      onChange={(value) => updateField("fileVolume", value)}
                      options={["Under 25", "25-100", "100-500", "500+", "Not sure"]}
                    />
                    <DemoSelect
                      label="Timeline"
                      value={formData.timeline}
                      onChange={(value) => updateField("timeline", value)}
                      options={["Just researching", "This quarter", "This month", "Urgent issue now"]}
                    />
                  </div>
                </DemoFormSection>

                <DemoFormSection title="File sources" description="Choose every place recurring spreadsheets arrive today.">
                  <DemoCheckboxGroup
                    label="Where do the recurring files come from?"
                    options={fileSources}
                    selected={formData.fileSources}
                    onToggle={(value) => toggleListValue("fileSources", value)}
                  />
                </DemoFormSection>

                <DemoFormSection title="What needs control" description="Pick the problems you want the demo to focus on.">
                  <DemoCheckboxGroup
                    label="What do you need to control?"
                    options={needs}
                    selected={formData.needs}
                    onToggle={(value) => toggleListValue("needs", value)}
                  />
                </DemoFormSection>

                <DemoFormSection title="Workflow notes" description="Short answers are fine. Specific examples help.">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <DemoTextarea
                      label="How does this work today?"
                      value={formData.currentProcess}
                      onChange={(value) => updateField("currentProcess", value)}
                      placeholder="Vendors email monthly files."
                    />
                    <DemoTextarea
                      label="Where should trusted data go next?"
                      value={formData.biDestination}
                      onChange={(value) => updateField("biDestination", value)}
                      placeholder="BI, reports, or exports."
                    />
                  </div>
                  <div className="mt-3">
                    <DemoTextarea
                      label="Anything specific you want to see?"
                      value={formData.notes}
                      onChange={(value) => updateField("notes", value)}
                      placeholder="Files, rules, or integrations."
                      rows={3}
                    />
                  </div>
                </DemoFormSection>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Demo focus</p>
                  <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">
                    We will focus on recurring file sources, versions, review rules, column changes, permissions, and safe answers from reviewed data.
                  </p>
                </div>

                <div className="flex flex-col gap-2 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-end">
                  <Link to="/support" className="inline-flex h-9 items-center justify-center rounded-lg px-3 text-xs font-black text-slate-600 transition-colors hover:bg-slate-100 hover:text-blue-700">
                    Need support instead?
                  </Link>
                  <button
                    type="submit"
                    className="inline-flex h-9 items-center justify-center rounded-lg bg-slate-950 px-4 text-xs font-black text-white shadow-sm shadow-slate-300 transition-all hover:-translate-y-0.5 hover:bg-blue-700 hover:shadow-md active:translate-y-0"
                  >
                    Request demo
                  </button>
                </div>
              </form>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}

function DemoInput({ label, value, onChange, placeholder, type = "text", required = false }) {
  return (
    <label className="group block">
      <span className="ml-0.5 text-[10px] font-black uppercase tracking-[0.14em] text-slate-500 transition-colors group-focus-within:text-blue-700">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] transition-all placeholder:text-xs placeholder:font-semibold placeholder:text-slate-300 hover:border-slate-300 focus:border-blue-500/60 focus:bg-white focus:outline-none focus:ring-3 focus:ring-blue-500/10"
      />
    </label>
  );
}

function DemoSelect({ label, value, onChange, options }) {
  const [open, setOpen] = useState(false);
  const selected = value || options[0];

  return (
    <div className="group relative">
      <div className="ml-0.5 text-[10px] font-black uppercase tracking-[0.14em] text-slate-500 transition-colors group-focus-within:text-blue-700">{label}</div>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        className={`mt-1 flex h-10 w-full items-center justify-between gap-2 rounded-lg border bg-white px-3 text-left text-sm font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] transition-all ${
          open
            ? "border-blue-500/60 ring-3 ring-blue-500/10"
            : "border-slate-200 hover:border-slate-300"
        }`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate text-slate-900">{selected}</span>
        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-50 text-slate-500 transition-transform ${open ? "rotate-180 text-blue-700" : ""}`}>
          <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z" clipRule="evenodd" />
          </svg>
        </span>
      </button>

      {open && (
        <div
          className="absolute left-0 right-0 top-[calc(100%+0.35rem)] z-40 overflow-hidden rounded-xl border border-slate-200 bg-white p-1 shadow-[0_18px_40px_rgba(15,23,42,0.16)]"
          role="listbox"
        >
          {options.map((option) => {
            const active = value === option;
            return (
              <button
                key={option}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange(option);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs font-black transition-colors ${
                  active ? "bg-blue-50 text-blue-800" : "text-slate-700 hover:bg-slate-50 hover:text-blue-800"
                }`}
                role="option"
                aria-selected={active}
              >
                <span>{option}</span>
                {active && <Icon name="check" className="h-3.5 w-3.5" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DemoTextarea({ label, value, onChange, placeholder, rows = 3 }) {
  return (
    <label className="group block">
      <span className="ml-0.5 text-[10px] font-black uppercase tracking-[0.14em] text-slate-500 transition-colors group-focus-within:text-blue-700">{label}</span>
      <textarea
        rows={rows}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold leading-5 text-slate-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] transition-all placeholder:text-xs placeholder:font-semibold placeholder:leading-5 placeholder:text-slate-300 hover:border-slate-300 focus:border-blue-500/60 focus:outline-none focus:ring-3 focus:ring-blue-500/10"
      />
    </label>
  );
}

function DemoCheckboxGroup({ label, options, selected, onToggle }) {
  return (
    <fieldset>
      <legend className="sr-only">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const checked = selected.includes(option);
          return (
            <label
              key={option}
              className={`relative inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-black transition-all ${
                checked
                  ? "border-blue-500 bg-blue-600 text-white shadow-sm shadow-blue-200"
                  : "border-slate-200 bg-white text-slate-700 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-800"
              }`}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(option)}
                className="sr-only"
              />
              <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors ${
                checked ? "border-white/70 bg-white/15 text-white" : "border-slate-300 bg-white text-transparent"
              }`}>
                <Icon name="check" className="h-3 w-3" />
              </span>
              <span>{option}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function DemoFormSection({ title, description, children }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 md:p-4">
      <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-sm font-black text-slate-950">{title}</h3>
          <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

/**
 * SupportScreen - Professional interactive support hub.
 */
function SupportScreen() {
  const [reason, setReason] = useState("");
  const [formData, setFormData] = useState({ name: "", email: "", company: "", message: "" });
  const [submitted, setSubmitted] = useState(false);
  const [serviceStatus, setServiceStatus] = useState(null); // 'online', 'offline', null

  useEffect(() => {
    const checkHealth = async () => {
      try {
        const res = await axios.get(`${API}/healthz`, { timeout: 3000 });
        if (res.status === 200 && res.data?.ok) {
          setServiceStatus("online");
        } else {
          setServiceStatus("offline");
        }
      } catch (err) {
        setServiceStatus("offline");
      }
    };
    checkHealth();
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    // Simulate API call
    console.log("Support request simulated");
    setSubmitted(true);
  };

  return (
    <div className="min-h-screen w-full bg-slate-50 px-5 py-8 text-slate-950 md:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-6xl flex-col justify-center gap-8 lg:grid lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
        <div className="max-w-xl">
          <Link to="/" className="inline-flex items-center" aria-label="TFORN home">
            <img
              src="/assets/tform-logo.png"
              alt="TFORN - Turn Financial Outputs into Real Numbers"
              className="h-20 w-auto max-w-[360px] object-contain sm:h-24 sm:max-w-[440px]"
            />
          </Link>
          <p className="mt-10 text-xs font-black uppercase tracking-[0.22em] text-blue-700">Support</p>
          <h1 className="mt-3 text-3xl font-black leading-tight tracking-tight text-slate-950 sm:text-4xl">
            Get help with your TFORN workspace.
          </h1>
          <p className="mt-4 text-base font-semibold leading-8 text-slate-600">
            Send account, access, billing, or workspace questions to the team. Keep file names, source names, and user details in the message when they help explain the issue.
          </p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Docs</p>
              <p className="mt-2 text-sm font-bold text-slate-900">Guides for users and admins</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Status</p>
              <p className={`mt-2 text-sm font-bold ${serviceStatus === 'online' ? "text-emerald-600" : serviceStatus === 'offline' ? "text-red-600" : "text-slate-700"}`}>
                {serviceStatus === 'online' ? "Operational" : serviceStatus === 'offline' ? "Connection failed" : "Checking..."}
              </p>
            </div>
          </div>
        </div>

        <div className="w-full rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_24px_70px_rgba(15,23,42,0.10)] md:p-7">
          <div className="mb-5">
            <h2 className="text-xl font-black tracking-tight text-slate-950">Contact support</h2>
            <p className="mt-1 text-sm font-semibold text-slate-500">Choose a topic and send the details.</p>
          </div>

        {submitted ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-center">
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-full bg-emerald-600 text-base font-black text-white">✓</div>
            <h3 className="mb-1 text-sm font-black text-emerald-900">Request received</h3>
            <p className="text-emerald-700/70 font-bold text-[11px] leading-relaxed max-w-xs">
              Your message has been recorded. The team will review it and respond as soon as possible.
            </p>
            <button onClick={() => setSubmitted(false)} className="mt-4 text-xs font-black text-emerald-700 hover:text-emerald-900">Submit another request</button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="space-y-1">
              <label className="ml-1 text-xs font-black uppercase tracking-[0.16em] text-slate-500">Reason for contact</label>
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full cursor-pointer appearance-none rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800 transition-all focus:border-blue-500/50 focus:outline-none focus:ring-4 focus:ring-blue-500/10"
              >
                <option value="" disabled>Select a topic...</option>
                <option value="password">Password or access</option>
                <option value="tech">Workspace support</option>
                <option value="billing">Billing or account</option>
                <option value="other">General question</option>
              </select>
            </div>

            {reason && (
              <form onSubmit={handleSubmit} className="flex flex-col gap-3">
                <div className="space-y-2">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="ml-1 text-xs font-black uppercase tracking-[0.16em] text-slate-500">Full name</label>
                      <input
                        type="text"
                        className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800 focus:outline-none focus:ring-4 focus:ring-blue-500/10"
                        placeholder="Jane Doe"
                        value={formData.name}
                        onChange={e => setFormData({ ...formData, name: e.target.value })}
                        required
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="ml-1 text-xs font-black uppercase tracking-[0.16em] text-slate-500">Work email</label>
                      <input
                        type="email"
                        className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800 focus:outline-none focus:ring-4 focus:ring-blue-500/10"
                        placeholder="jane@company.com"
                        value={formData.email}
                        onChange={e => setFormData({ ...formData, email: e.target.value })}
                        required
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="ml-1 text-xs font-black uppercase tracking-[0.16em] text-slate-500">Company</label>
                    <input
                      type="text"
                      className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800 focus:outline-none focus:ring-4 focus:ring-blue-500/10"
                      placeholder="Acme Corp"
                      value={formData.company}
                      onChange={e => setFormData({ ...formData, company: e.target.value })}
                      required
                    />
                  </div>
                  <div className="space-y-1 relative">
                    <div className="flex justify-between items-center px-1">
                      <label className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Request details</label>
                      <span className={`text-[10px] font-black uppercase tracking-widest ${formData.message.length > 1900 ? "text-amber-600" : "text-slate-400"}`}>
                        {formData.message.length} / 2000
                      </span>
                    </div>
                    <textarea
                      rows="4"
                      maxLength="2000"
                      className="w-full resize-none rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800 focus:outline-none focus:ring-4 focus:ring-blue-500/10"
                      placeholder={reason === 'password' ? "Include your workspace, email address, and what changed..." : "Describe the issue or request..."}
                      value={formData.message}
                      onChange={e => setFormData({ ...formData, message: e.target.value })}
                      required
                    ></textarea>
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full rounded-md bg-blue-600 py-2.5 text-sm font-black text-white shadow-sm transition-all hover:bg-blue-700 active:scale-[0.99]"
                >
                  Send request
                </button>
              </form>
            )}

            {!reason && (
              <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4 text-center">
                <p className="text-sm font-semibold leading-6 text-slate-500">
                  Select a topic to open the support form.
                </p>
              </div>
            )}
          </div>
        )}

        <div className="mt-5 border-t border-slate-100 pt-4">
          <Link to="/login" className="flex items-center justify-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-slate-500 transition-colors hover:text-blue-700">
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
            Back to sign in
          </Link>
        </div>
        </div>
      </div>
    </div>
  );
}

function AuthScreen({ email, setEmail, password, setPassword, onSubmit, onGoogleLogin, onSamlLogin, googleEnabled }) {
  return (
    <div className="min-h-screen w-full bg-slate-50 px-5 py-8 text-slate-950 md:px-8">
      <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-6xl gap-8 lg:grid-cols-[1fr_480px] lg:items-center">
        <section className="hidden lg:block">
          <Link to="/" className="inline-flex items-center" aria-label="TFORN home">
            <img
              src="/assets/tform-logo.png"
              alt="TFORN - Turn Financial Outputs into Real Numbers"
              className="h-16 w-auto max-w-[320px] object-contain"
            />
          </Link>
          <p className="mt-12 text-xs font-black uppercase tracking-[0.22em] text-blue-700">Workspace sign in</p>
          <h1 className="mt-3 max-w-xl text-4xl font-black leading-tight tracking-tight text-slate-950">
            Continue to your controlled file workspace.
          </h1>
          <p className="mt-4 max-w-xl text-base font-semibold leading-8 text-slate-600">
            Access reviewed sources, file versions, user permissions, and safe answers from data your team has organized.
          </p>
          <div className="mt-8 grid max-w-xl gap-3 sm:grid-cols-3">
            {["Reviewed files", "Source history", "Admin controls"].map((item) => (
              <div key={item} className="rounded-xl border border-slate-200 bg-white p-4 text-sm font-black text-slate-800 shadow-sm">
                {item}
              </div>
            ))}
          </div>
        </section>

        <section className="w-full rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_24px_70px_rgba(15,23,42,0.10)] md:p-7">
          <div className="mb-6 text-center lg:text-left">
            <Link to="/" className="mb-5 inline-flex justify-center lg:hidden" aria-label="TFORN home">
              <img
                src="/assets/tform-logo.png"
                alt="TFORN - Turn Financial Outputs into Real Numbers"
                className="h-12 w-auto max-w-[230px] object-contain"
              />
            </Link>
            <h2 className="text-2xl font-black tracking-tight text-slate-950">Sign in</h2>
            <p className="mt-2 text-sm font-semibold text-slate-500">Open your TFORN workspace.</p>
          </div>

        <form onSubmit={onSubmit} className="space-y-2">
          <div className="group space-y-1">
            <label className="ml-1 text-xs font-black uppercase tracking-[0.16em] text-slate-500 group-focus-within:text-blue-700 transition-colors">Work email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com"
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800 transition-all placeholder:text-slate-300 focus:border-blue-500/50 focus:outline-none focus:ring-4 focus:ring-blue-500/10"
              required
            />
          </div>

          <div className="group space-y-1">
            <div className="flex justify-between items-center px-1">
              <label className="text-xs font-black uppercase tracking-[0.16em] text-slate-500 group-focus-within:text-blue-700 transition-colors">Password</label>
              <Link to="/support" className="text-xs font-black text-blue-700 transition-colors hover:text-blue-900">Trouble signing in?</Link>
            </div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800 transition-all placeholder:text-slate-300 focus:border-blue-500/50 focus:outline-none focus:ring-4 focus:ring-blue-500/10"
              required
            />
          </div>

          <button
            type="submit"
            className="group w-full rounded-md bg-blue-600 py-2.5 text-sm font-black text-white shadow-sm transition-all duration-300 hover:bg-blue-700 active:scale-[0.99]"
          >
            <span className="flex items-center justify-center gap-2">
              Sign in to workspace
              <svg className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
            </span>
          </button>

          <button
            type="button"
            onClick={onGoogleLogin}
            disabled={!googleEnabled}
            className={`w-full flex items-center justify-center gap-2.5 rounded-md border border-slate-200 bg-white py-2.5 text-sm font-bold text-slate-800 shadow-sm transition-all duration-300 hover:border-slate-300 hover:bg-slate-50 active:scale-[0.99] ${!googleEnabled ? "opacity-50 cursor-not-allowed grayscale" : ""}`}
          >
            <svg viewBox="0 0 24 24" width="14" height="14">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c1.61-1.48 2.54-3.67 2.54-6.09z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
            </svg>
            Continue with Google
          </button>

          <button
            type="button"
            onClick={onSamlLogin}
            className="w-full flex items-center justify-center gap-2.5 rounded-md border border-slate-200 bg-white py-2.5 text-sm font-bold text-slate-800 shadow-sm transition-all duration-300 hover:border-slate-300 hover:bg-slate-50 active:scale-[0.99]"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 3l7 4v5c0 5-3.5 8-7 9-3.5-1-7-4-7-9V7l7-4z" />
              <path d="M9 12l2 2 4-4" />
            </svg>
            Continue with SAML SSO
          </button>
        </form>

        <div className="mt-8 rounded-xl border border-slate-200 bg-slate-50 p-4">
           <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-500"></span>
              <span className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Workspace available</span>
           </div>
           <p className="mt-2 text-xs font-semibold leading-5 text-slate-500">
             Access is controlled by your account, customer workspace, and admin permissions.
           </p>
        </div>
        </section>
      </div>
    </div>
  );
}

function InviteAcceptScreen({
  inviteInfo,
  invitePassword,
  setInvitePassword,
  inviteRepeat,
  setInviteRepeat,
  onAccept,
  loading,
  error,
  onBackToLogin,
}) {
  return (
    <div className="min-h-screen w-full flex items-center justify-center p-6 relative bg-[#fafafa] overflow-x-hidden">
      <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] bg-indigo-500/10 rounded-full blur-[140px] animate-pulse" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[60%] h-[60%] bg-cyan-500/10 rounded-full blur-[140px] animate-pulse" style={{ animationDelay: "2s" }} />
      <div className="glass rounded-xl p-5 md:p-7 w-full max-w-[500px] relative z-10 border-white/50 shadow-[0_32px_80px_rgba(0,0,0,0.08)]">
        <div className="mb-5 text-center">
          <h2 className="text-xl font-[900] text-slate-900 tracking-tighter mb-1.5">Accept Invitation</h2>
          <p className="text-slate-500 text-[10px] font-semibold opacity-70 uppercase tracking-wider">
            Join {inviteInfo?.groupName || "customer workspace"}
          </p>
        </div>
        <div className="space-y-2">
          <input className="w-full bg-white/40 border border-slate-200 rounded-md px-3 py-1.5 text-[11px] font-bold" value={inviteInfo?.email || ""} disabled />
          <div className="grid grid-cols-2 gap-2">
            <input className="w-full bg-white/40 border border-slate-200 rounded-md px-3 py-1.5 text-[11px] font-bold" value={inviteInfo?.firstName || ""} disabled />
            <input className="w-full bg-white/40 border border-slate-200 rounded-md px-3 py-1.5 text-[11px] font-bold" value={inviteInfo?.lastName || ""} disabled />
          </div>
          <input className="w-full bg-white/40 border border-slate-200 rounded-md px-3 py-1.5 text-[11px] font-bold" value={inviteInfo?.company || ""} disabled />
          <input
            type="password"
            value={invitePassword}
            onChange={(e) => setInvitePassword(e.target.value)}
            placeholder="Set password"
            className="w-full bg-white/40 border border-slate-200 rounded-md px-3 py-1.5 text-[11px] font-bold"
          />
          <input
            type="password"
            value={inviteRepeat}
            onChange={(e) => setInviteRepeat(e.target.value)}
            placeholder="Repeat password"
            className="w-full bg-white/40 border border-slate-200 rounded-md px-3 py-1.5 text-[11px] font-bold"
          />
          {!!error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">
              {error}
            </div>
          )}
          <button
            type="button"
            onClick={onAccept}
            disabled={loading || !inviteInfo}
            className={`w-full bg-slate-900 hover:bg-black text-white rounded-md py-1.5 text-[11px] font-[900] ${loading || !inviteInfo ? "opacity-60 cursor-not-allowed" : ""}`}
          >
            {loading ? "Accepting..." : "Accept & Continue"}
          </button>
          <button
            type="button"
            onClick={onBackToLogin}
            className="w-full rounded-md border border-slate-300 text-slate-700 py-1.5 text-[11px] font-semibold hover:bg-slate-50"
          >
            Back to Login
          </button>
        </div>
      </div>
    </div>
  );
}

function AuthenticatedAppHeader({
  user,
  onLogout,
  myFiles,
  reportSources,
  reportSourceImports,
  sheetId,
  activeFilename,
  onSwitchSheet,
  onDeleteSheet,
  onSaveView,
  locale,
  setLocale,
  copy,
  supportedLanguages,
}) {
  const location = useLocation();
  const showHeader = !!user && (location.pathname.startsWith("/workspace") || location.pathname === "/users");
  if (!showHeader) return null;

  return (
    <DashboardHeader
      user={user}
      onLogout={onLogout}
      myFiles={myFiles}
      reportSources={reportSources}
      reportSourceImports={reportSourceImports}
      sheetId={sheetId}
      activeFilename={activeFilename}
      onSwitchSheet={onSwitchSheet}
      onDeleteSheet={onDeleteSheet}
      onSaveView={onSaveView}
      locale={locale}
      setLocale={setLocale}
      copy={copy}
      supportedLanguages={supportedLanguages}
    />
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() => readStoredAuthToken());
  const [authChecking, setAuthChecking] = useState(() => !!readStoredAuthToken());
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteToken, setInviteToken] = useState("");
  const [inviteInfo, setInviteInfo] = useState(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [invitePassword, setInvitePassword] = useState("");
  const [inviteRepeat, setInviteRepeat] = useState("");
  const [googleEnabled, setGoogleEnabled] = useState(true);
  const [dropboxEnabled, setDropboxEnabled] = useState(true);
  const [oneDriveEnabled, setOneDriveEnabled] = useState(true);
  const [sftpStorageEnabled, setSftpStorageEnabled] = useState(true);
  const [gcsStorageEnabled, setGcsStorageEnabled] = useState(true);
  const [s3StorageEnabled, setS3StorageEnabled] = useState(true);
  const [azureBlobStorageEnabled, setAzureBlobStorageEnabled] = useState(true);
  const dashboardI18n = useDashboardI18n({ enabled: !!user });
  const [workspaceView, setWorkspaceView] = useState("grid");

  const [sheetId, setSheetId] = useState(() => localStorage.getItem("sheetId") || null);
  const [activeFilename, setActiveFilename] = useState(() => localStorage.getItem("activeFilename") || "");

  const [data, setData] = useState([]);
  const [headers, setHeaders] = useState([]);
  const [sortConfig, setSortConfig] = useState(null);
  const [isBatchLoading, setIsBatchLoading] = useState(false);
  const [hasMoreData, setHasMoreData] = useState(true);

  // Secondary Data (Comparison Mode)
  const [secondaryData, setSecondaryData] = useState([]);
  const [secondaryHeaders, setSecondaryHeaders] = useState([]);
  const [secondarySortConfig, setSecondarySortConfig] = useState(null);
  const [secondaryIsBatchLoading, setSecondaryIsBatchLoading] = useState(false);
  const [secondaryHasMoreData, setSecondaryHasMoreData] = useState(true);
  const [secondarySheetId, setSecondarySheetId] = useState("");
  const [secondaryTab, setSecondaryTab] = useState(null);

  const BATCH_SIZE = 50;

  // column filters
  const [columnFilters, setColumnFilters] = useState({});
  const [openFilterCol, setOpenFilterCol] = useState(null);
  const filterAnchorRefs = useRef({});
  const filterBtnRefs = useRef({});

  const [file, setFile] = useState(null);
  const [selectedFileName, setSelectedFileName] = useState("");
  const [uploadDisplayName, setUploadDisplayName] = React.useState("");
  const [fileLabel, setFileLabel] = React.useState("");
  const [reportSourceName, setReportSourceName] = React.useState("");
  const [uploadProgressOpen, setUploadProgressOpen] = useState(false);
  const [uploadProgressLoaded, setUploadProgressLoaded] = useState(0);
  const [uploadProgressTotal, setUploadProgressTotal] = useState(0);
  const [uploadProgressPercent, setUploadProgressPercent] = useState(0);
  const [uploadProgressPhase, setUploadProgressPhase] = useState("uploading");
  const [uploadProgressError, setUploadProgressError] = useState("");
  const [businessClassificationPrompt, setBusinessClassificationPrompt] = useState(null);

  // My files (sheet selection)
  const [myFiles, setMyFiles] = useState([]);
  const [myFilesLoading, setMyFilesLoading] = useState(false);
  const [reportSources, setReportSources] = useState([]);
  const [reportSourceImports, setReportSourceImports] = useState({});
  const workspaceChartStateRef = useRef(null);


  // Views
  const [views, setViews] = useState([]);
  const [selectedViewId, setSelectedViewId] = useState("");
  const [pendingViewName, setPendingViewName] = useState("");
  const [viewLevel, setViewLevel] = useState("revision");
  const [showColumnSelector, setShowColumnSelector] = useState(false);
  const [editingViewId, setEditingViewId] = useState(null);
  const [visibleColumns, setVisibleColumns] = useState([]); // columns to save
  const [secondaryVisibleColumns, setSecondaryVisibleColumns] = useState([]);
  const activeViewConfig = useMemo(() => {
    const view = (views || []).find((v) => String(v.id) === String(selectedViewId));
    return view?.config && typeof view.config === "object" ? view.config : null;
  }, [views, selectedViewId]);
  const activeChatViewScope = useMemo(() => ({
    viewId: selectedViewId || null,
    visibleColumns: Array.isArray(activeViewConfig?.visibleColumns) ? activeViewConfig.visibleColumns : [],
    splitContext: activeViewConfig?.splitContext && typeof activeViewConfig.splitContext === "object"
      ? {
          secondarySheetId: activeViewConfig.splitContext.secondarySheetId || null,
          secondaryVisibleColumns: Array.isArray(activeViewConfig.splitContext.secondaryVisibleColumns)
            ? activeViewConfig.splitContext.secondaryVisibleColumns
            : [],
        }
      : null,
  }), [selectedViewId, activeViewConfig]);
  const [saveViewConfigOverride, setSaveViewConfigOverride] = useState(null);

  // Chart / Pivot / Two-Condition Config
  const [pivotOn, setPivotOn] = useState(false);
  const [pivotRowKey, setPivotRowKey] = useState("");
  const [pivotColKey, setPivotColKey] = useState("");
  const [pivotValKey, setPivotValKey] = useState("");
  const [pivotAgg, setPivotAgg] = useState("sum");

  const [twoOn, setTwoOn] = useState(false);
  const [condCol1, setCondCol1] = useState("");
  const [condCol2, setCondCol2] = useState("");
  const [valueCol, setValueCol] = useState("");

  const [totalsCol, setTotalsCol] = useState("");

  const [pieMode, setPieMode] = useState("rows"); // "rows" or "cols"
  const [pieTopN, setPieTopN] = useState("10");

  // Trends State
  const [trendsOn, setTrendsOn] = useState(false);
  const [trendsDateKey, setTrendsDateKey] = useState("");
  const [trendsValueKey, setTrendsValueKey] = useState("");
  const [trendGranularity, setTrendGranularity] = useState("month");
  const [yearsBack, setYearsBack] = useState(5);
  // State for trends
  const [compareYears, setCompareYears] = useState([]);

  // Multi-tab workbook support
  const [tabs, setTabs] = useState([]);
  const [activeTab, setActiveTab] = useState("");
  const tabListCacheRef = useRef({});
  const tabDataCacheRef = useRef({});

  const tableContainerRef = useRef(null);

  // Derived state
  const displayHeaders = React.useMemo(() => {
    // If no data loaded, empty
    if (!headers.length) return [];
    return headers;
  }, [headers]);

  const [uniqueValuesByColumn, setUniqueValuesByColumn] = useState({});
  const uniqueValuesCacheKey = (sid, tabName, col) => (
    `${String(sid || "")}::${tabName ? String(tabName) : "__all__"}::${String(col || "")}`
  );

  const fetchUniqueValues = async (col, sid = sheetId, tabName = activeTab) => {
    if (!sid || !col) return;
    try {
      const url = `${API}/sheets/${sid}/unique-values?col=${encodeURIComponent(col)}${tabName ? `&tab=${encodeURIComponent(tabName)}` : ""}`;
      const res = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setUniqueValuesByColumn(prev => ({
        ...prev,
        [uniqueValuesCacheKey(sid, tabName, col)]: res.data || []
      }));
    } catch (e) {
      console.error("fetchUniqueValues failed", e);
    }
  };

  /* -------- Derived: Filtered & Sorted Data -------- */
  const { sortedData } = React.useMemo(() => {
    if (!data || !data.length) return { sortedData: [] };

    let processed = [...data];

    // 1. Column Filters
    const activeCols = Object.keys(columnFilters);
    if (activeCols.length > 0) {
          processed = processed.filter((row) => {
            for (const col of activeCols) {
              const allowed = columnFilters[col];
              if (!allowed) continue;

              // Try exact match first, then fuzzy
              let rowValue = row[col];
              if (rowValue === undefined) {
                const actualCol = headers.find(h => h && String(h).trim().toLowerCase() === String(col).trim().toLowerCase());
                if (actualCol) rowValue = row[actualCol];
              }

          const stringified = String(rowValue ?? "");

          if (allowed instanceof Set) {
            // Checkbox-style exact-match filter
            if (allowed.size > 0 && !allowed.has(stringified)) return false;
          } else if (allowed && typeof allowed === 'object' && (allowed.type === 'contains' || allowed.type === 'filter')) {
            // Chatbot substring filter (e.g. "2021" matches "2021-03-01")
            const filterValue = String(allowed.value || "").toLowerCase();
            const op = allowed.operator || "contains";

            if (op === "equals") {
               if (stringified.toLowerCase() !== filterValue) return false;
            } else {
               // default to contains
               if (!stringified.toLowerCase().includes(filterValue)) return false;
            }
          } else if (Array.isArray(allowed)) {
            if (allowed.length > 0 && !allowed.includes(stringified)) return false;
          }
        }
        return true;
      });
    }

    // 2. Sorting
    if (sortConfig) {
      const { key, direction } = sortConfig;
      processed.sort((a, b) => {
        let valA = a[key];
        let valB = b[key];
        // numeric sort if possible
        const numA = Number(valA);
        const numB = Number(valB);
        if (!isNaN(numA) && !isNaN(numB) && valA !== "" && valB !== "") {
          return direction === "asc" ? numA - numB : numB - numA;
        }
        // string sort
        valA = String(valA || "").toLowerCase();
        valB = String(valB || "").toLowerCase();
        if (valA < valB) return direction === "asc" ? -1 : 1;
        if (valA > valB) return direction === "asc" ? 1 : -1;
        return 0;
      });
    }

    return { sortedData: processed };
  }, [data, columnFilters, sortConfig, headers]);

  // Available Years for Dropdown
  const trendYearOptions = useMemo(() => {
    if (!sortedData || !trendsDateKey) return [];
    const s = new Set();
    sortedData.forEach(r => {
      const dObj = parseTemporalValue(r[trendsDateKey]);
      const y = dObj && !isNaN(dObj.getTime()) ? dObj.getFullYear() : null;
      if (y) s.add(y);
    });
    return Array.from(s).sort((a, b) => b - a);
  }, [sortedData, trendsDateKey]);


  // Helper for currency/number parsing
  const parseNum = (v) => {
    if (typeof v === "number") return Number.isFinite(v) ? v : 0;
    if (v === null || v === undefined || v === "") return 0;

    const raw = String(v).trim();
    if (!raw) return 0;

    const negativeByParens = raw.startsWith("(") && raw.endsWith(")");
    const normalized = raw
      .replace(/[(),\s$,%]/g, "")
      .replace(/[−–—]/g, "-");

    const n = Number(normalized);
    if (!Number.isFinite(n)) return 0;
    return negativeByParens ? -Math.abs(n) : n;
  };

  const resolveHeaderName = React.useCallback((col) => {
    const target = String(col || "").trim();
    if (!target) return "";
    const exact = headers.find((h) => String(h || "").trim() === target);
    if (exact) return exact;
    const normalized = target.toLowerCase();
    return headers.find((h) => String(h || "").trim().toLowerCase() === normalized) || target;
  }, [headers]);

  const applyContainsFilter = React.useCallback((col, val) => {
    if (col === "RESET_ALL") {
      setColumnFilters({});
      return;
    }
    const resolvedCol = resolveHeaderName(col);
    if (!resolvedCol) return;
    if (!val) {
      setColumnFilters((prev) => {
        const next = { ...prev };
        delete next[resolvedCol];
        return next;
      });
      return;
    }
    setColumnFilters((prev) => ({ ...prev, [resolvedCol]: { type: "contains", value: val } }));
  }, [resolveHeaderName]);

  const applyChartConfig = React.useCallback((config) => {
    if (!config || !config.valueColumn) return;
    const resolveHeader = (col) => {
      const target = String(col || "").trim().toLowerCase();
      if (!target) return "";
      return headers.find((h) => String(h || "").trim().toLowerCase() === target) || "";
    };
    const resolvedValue = resolveHeader(config.valueColumn);
    const resolvedDate = resolveHeader(config.dateColumn);
    const resolvedSegment = resolveHeader(config.segmentBy);
    if (!resolvedValue) return;

    setTrendsOn(false);
    setPivotOn(false);
    setTwoOn(false);
    const isTemporalColumn = (col = "") => looksLikeDateColumn(col);
    if (resolvedDate && (!resolvedSegment || isTemporalColumn(resolvedSegment))) {
      setTrendsValueKey(resolvedValue);
      setTrendsDateKey(resolvedDate);
      setTrendGranularity(isTemporalColumn(resolvedDate) && /quarter|fiscal/i.test(resolvedDate) ? "quarter" : "month");
      setTrendsOn(true);
      setPendingViewName(`Trend of ${resolvedValue}`);
      return;
    }
    if (!resolvedDate && resolvedSegment && isTemporalColumn(resolvedSegment)) {
      setTrendsValueKey(resolvedValue);
      setTrendsDateKey(resolvedSegment);
      setTrendGranularity(/quarter|fiscal/i.test(resolvedSegment) ? "quarter" : "month");
      setTrendsOn(true);
      setPendingViewName(`Trend of ${resolvedValue}`);
      return;
    }
    if (resolvedSegment) {
      setPivotRowKey(resolvedSegment);
      setPivotValKey(resolvedValue);
      setPivotColKey("");
      setPivotAgg(config.aggregation === "avg" ? "Average" : "Sum");
      setPivotOn(true);
      setPendingViewName(`${resolvedValue} by ${resolvedSegment}`);
      return;
    }
    const dateCol = headers.find((h) => h.toLowerCase().includes("date") || h.toLowerCase().includes("time") || h.toLowerCase().includes("year"));
    if (dateCol) {
      setTrendsValueKey(resolvedValue);
      setTrendsDateKey(dateCol);
      setTrendsOn(true);
      setPendingViewName(`Trend of ${resolvedValue}`);
    }
  }, [headers]);

  const saveInsightView = React.useCallback((name) => {
    setPendingViewName(name || "Insight View");
    setViewLevel("revision");
    setShowColumnSelector(true);
  }, []);

  /* -------- Computed: Pivot -------- */
  const { pivotRows, pivotHeaders, pivotSeriesKeys, pieData } = React.useMemo(() => {
    const isCountAgg = pivotAgg === "count" || pivotAgg === "Count";
    if (!pivotOn || !pivotRowKey || (!isCountAgg && !pivotValKey) || !sortedData.length) {
      return { pivotRows: [], pivotHeaders: [], pivotSeriesKeys: [], pieData: [] };
    }

    const rowMap = {};
    const rowTotals = {};
    const dynCols = new Set();

    sortedData.forEach((row) => {
      const rVal = row[pivotRowKey] ?? "(blank)";
      const cVal = pivotColKey ? (row[pivotColKey] ?? "(blank)") : "Total";

      let val = 0;
      if (isCountAgg) {
        val = 1;
      } else {
        val = parseNum(row[pivotValKey]);
      }

      if (!rowMap[rVal]) rowMap[rVal] = {};
      if (!rowMap[rVal][cVal]) rowMap[rVal][cVal] = { sum: 0, count: 0 };
      if (!rowTotals[rVal]) rowTotals[rVal] = { sum: 0, count: 0 };

      rowMap[rVal][cVal].sum += val;
      rowMap[rVal][cVal].count += 1;
      rowTotals[rVal].sum += val;
      rowTotals[rVal].count += 1;
      dynCols.add(cVal);
    });

    const sortedDynCols = Array.from(dynCols).sort();
    const headers = [pivotRowKey, ...sortedDynCols];

    const result = Object.keys(rowMap).sort().map((rKey) => {
      const obj = { [pivotRowKey]: rKey };
      sortedDynCols.forEach((dc) => {
        const entry = rowMap[rKey][dc];
        if (!entry) {
          obj[dc] = 0;
        } else {
          if (pivotAgg === 'Average' || pivotAgg === 'avg') {
            obj[dc] = entry.count > 0 ? entry.sum / entry.count : 0;
          } else {
            obj[dc] = entry.sum;
          }
        }
      });
      return obj;
    });

    const pData = Object.entries(rowTotals)
      .map(([name, entry]) => ({
        name,
        value: (pivotAgg === "Average" || pivotAgg === "avg")
          ? (entry.count > 0 ? entry.sum / entry.count : 0)
          : entry.sum,
      }))
      .sort((a, b) => Math.abs(b.value || 0) - Math.abs(a.value || 0))
      .slice(0, parseInt(pieTopN, 10) || 10);

    return {
      pivotRows: result,
      pivotHeaders: headers,
      pivotSeriesKeys: sortedDynCols,
      pieData: pData
    };
  }, [sortedData, pivotOn, pivotRowKey, pivotColKey, pivotValKey, pivotAgg, pieTopN]);

  const pivotChartRef = useRef(null);
  const exportPivotPDF = async () => { };

  /* -------- Computed: Two Condition -------- */
  const summaryData = React.useMemo(() => {
    if (!twoOn || !valueCol || !sortedData.length) return { total: 0, chartData: [] };

    let total = 0;
    const groupMap = {};
    const hasGroup = !!condCol2;

    sortedData.forEach(r => {
      const val = parseNum(r[valueCol]);
      total += val;

      if (hasGroup) {
        const groupKey = r[condCol2] || "(blank)";
        groupMap[groupKey] = (groupMap[groupKey] || 0) + val;
      }
    });

    const chartData = hasGroup
      ? Object.entries(groupMap).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
      : [];

    return { total, chartData };
  }, [twoOn, condCol1, condCol2, valueCol, sortedData]);

  /* -------- Computed: Trends -------- */
  const trendsData = React.useMemo(() => {
    if (!trendsOn || !trendsDateKey || !trendsValueKey || !sortedData.length) return [];

    const grouped = {};
    let maxYear = 0;

    sortedData.forEach(r => {
      const dObj = parseTemporalValue(r[trendsDateKey]);
      if (dObj && !isNaN(dObj.getTime())) {
        const y = dObj.getFullYear();
        if (y > maxYear) maxYear = y;
      }
    });

    sortedData.forEach(r => {
      const val = parseNum(r[trendsValueKey]);
      const dObj = parseTemporalValue(r[trendsDateKey]);

      if (dObj && !isNaN(dObj.getTime())) {
        const y = dObj.getFullYear();
        const m = String(dObj.getMonth() + 1).padStart(2, '0');
        const d = String(dObj.getDate()).padStart(2, '0');
        const q = Math.floor(dObj.getMonth() / 3) + 1;

        let axisKey = null;
        let lineKey = "value";

        if (compareYears && compareYears.length > 0) {
          const targets = compareYears.map(Number);
          if (!targets.includes(y)) return;

          lineKey = String(y);
          if (trendGranularity === 'day') axisKey = `${m}-${d}`;
          else if (trendGranularity === 'quarter') axisKey = `Q${q}`;
          else axisKey = m;
        } else {
          if (trendGranularity === 'year') axisKey = String(y);
          else if (trendGranularity === 'quarter') axisKey = `${y}-Q${q}`;
          else if (trendGranularity === 'month') axisKey = `${y}-${m}`;
          else axisKey = `${y}-${m}-${d}`;
        }

        if (axisKey) {
          if (!grouped[axisKey]) grouped[axisKey] = { date: axisKey, value: 0 };
          grouped[axisKey].value += val;
          grouped[axisKey][lineKey] = (grouped[axisKey][lineKey] || 0) + val;
        }
      }
    });

    const finalData = Object.entries(grouped)
      .map(([k, obj]) => obj)
      .sort((a, b) => a.date.localeCompare(b.date));

    if (finalData.length > 0) {
      const dataKeys = Object.keys(finalData[0]).filter(k => k !== 'date' && k !== 'value');
      if (dataKeys.length === 0) dataKeys.push('value');

      dataKeys.forEach(key => {
        let i = 0;
        while (i < finalData.length) {
          if (finalData[i][key] === 0) {
            let j = i;
            while (j < finalData.length && finalData[j][key] === 0) {
              j++;
            }
            const runLength = j - i;

            if (runLength === 1) {
              const prev = i > 0 ? (finalData[i - 1][key] || 0) : 0;
              const next = j < finalData.length ? (finalData[j][key] || 0) : 0;
              finalData[i][key] = (prev + next) / 2;
            } else {
              for (let k = i; k < j; k++) {
                finalData[k][key] = null;
              }
            }
            i = j;
          } else {
            i++;
          }
        }
      });
    }

    return finalData;

  }, [trendsOn, trendsDateKey, trendsValueKey, trendGranularity, compareYears, sortedData]);


  /* -------- Helpers -------- */
  const hasRequiredColumns = React.useCallback((requiredCols) => {
    return requiredCols.every(col => headers.includes(col));
  }, [headers]);

  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      const res = await axios.post(`${API}/auth/login`, { email, password });
      const authToken = String(res?.data?.token || "").trim();
      if (authToken) {
        localStorage.setItem("token", authToken);
      }
      setToken(authToken);
      setUser(res.data.user);
    } catch (err) {
      alert("Login failed");
    }
  };

  const clearInviteQueryParam = React.useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    params.delete("invite");
    const next = params.toString();
    const nextUrl = `${window.location.pathname}${next ? `?${next}` : ""}${window.location.hash || ""}`;
    window.history.replaceState({}, document.title, nextUrl);
  }, []);

  const handleAcceptInvitation = async () => {
    if (!inviteToken) return;
    if (!invitePassword || !inviteRepeat) {
      setInviteError("Password and confirmation are required.");
      return;
    }
    if (invitePassword !== inviteRepeat) {
      setInviteError("Passwords do not match.");
      return;
    }
    setInviteLoading(true);
    setInviteError("");
    try {
      const res = await axios.post(`${API}/auth/invitations/accept`, {
        token: inviteToken,
        password: invitePassword,
      });
      const authToken = String(res?.data?.token || "").trim();
      if (!authToken) throw new Error("invitation_accept_missing_token");
      localStorage.setItem("token", authToken);
      setToken(authToken);
      setUser(res?.data?.user || null);
      setInvitePassword("");
      setInviteRepeat("");
      setInviteInfo(null);
      setInviteToken("");
      clearInviteQueryParam();
    } catch (err) {
      setInviteError(err?.response?.data?.error || "Failed to accept invitation.");
    } finally {
      setInviteLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    if (!googleEnabled) {
      alert("Google sign-in is disabled.");
      return;
    }
    try {
      const qp = new URLSearchParams(window.location.search);
      const groupIdRaw = qp.get("groupId") || qp.get("customerGroupId") || "";
      const groupId = Number.parseInt(groupIdRaw, 10);
      const res = await axios.get(`${API}/auth/google/url`, {
        params: Number.isInteger(groupId) && groupId > 0 ? { groupId } : undefined,
      });
      const url = String(res?.data?.url || "").trim();
      if (!url) {
        alert("Google login is not configured.");
        return;
      }
      window.location.href = url;
    } catch (err) {
      console.error("google login url failed:", err);
      alert("Google login is not configured.");
    }
  };

  const handleSamlLogin = async () => {
    try {
      const qp = new URLSearchParams(window.location.search);
      const groupIdRaw = qp.get("groupId") || qp.get("customerGroupId") || "";
      const groupId = Number.parseInt(groupIdRaw, 10);
      if (!Number.isInteger(groupId) || groupId <= 0) {
        alert("SAML requires a customer groupId in the URL.");
        return;
      }
      const res = await axios.get(`${API}/auth/saml/url`, { params: { groupId } });
      const url = String(res?.data?.url || "").trim();
      if (!url) {
        alert("SAML login is not configured.");
        return;
      }
      window.location.href = url;
    } catch (err) {
      console.error("saml login url failed:", err);
      alert(err?.response?.data?.error || "SAML login is not configured.");
    }
  };

  const handleDropboxConnect = async () => {
    if (!user) {
      alert("Sign in first.");
      return;
    }
    if (!dropboxEnabled) {
      alert("Dropbox integration is disabled.");
      return;
    }
    try {
      const res = await axios.get(`${API}/auth/dropbox/url`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const url = String(res?.data?.url || "").trim();
      if (!url) {
        alert("Dropbox is not configured.");
        return;
      }
      window.location.href = url;
    } catch (err) {
      console.error("dropbox auth url failed:", err);
      alert(err?.response?.data?.error || "Dropbox is not configured.");
    }
  };

  const handleGoogleConnect = async () => {
    if (!user) {
      alert("Sign in first.");
      return;
    }
    if (!googleEnabled) {
      alert("Google sign-in is disabled.");
      return;
    }
    try {
      const res = await axios.get(`${API}/auth/google/connect-url`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const url = String(res?.data?.url || "").trim();
      if (!url) {
        alert("Google login is not configured.");
        return;
      }
      window.location.href = url;
    } catch (err) {
      console.error("google connect url failed:", err);
      alert(err?.response?.data?.error || "Google login is not configured.");
    }
  };

  const handleOneDriveConnect = async () => {
    if (!user) {
      alert("Sign in first.");
      return;
    }
    if (!oneDriveEnabled) {
      alert("OneDrive integration is disabled.");
      return;
    }
    try {
      const res = await axios.get(`${API}/auth/onedrive/url`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const url = String(res?.data?.url || "").trim();
      if (!url) {
        alert("OneDrive is not configured.");
        return;
      }
      window.location.href = url;
    } catch (err) {
      console.error("onedrive auth url failed:", err);
      alert(err?.response?.data?.error || "OneDrive is not configured.");
    }
  };

  const applyLoadedRows = (sid, raw, preserveFilters = false, append = false) => {
    if (!raw || !Array.isArray(raw)) {
      console.warn("loadData: response is not an array", raw);
      if (!append) {
        setData([]);
        setHeaders([]);
      }
      return;
    }
    
    if (append) {
        setData(prev => [...prev, ...raw]);
        if (raw.length < BATCH_SIZE) setHasMoreData(false);
    } else {
        setData(raw);
        const isSameSheet = String(sid) === String(sheetId);
        const heads = raw.length
          ? Object.keys(raw[0])
          : ((preserveFilters || isSameSheet) ? headers : []);
        setHeaders(heads);
        setHasMoreData(raw.length >= BATCH_SIZE);
    }

    setSheetId(sid);
    localStorage.setItem("sheetId", sid);
    if (!preserveFilters && !append) {
      setColumnFilters({});
      setOpenFilterCol(null);
    }
  };

  const getDataCacheKey = (sid, tabName = null) => `${String(sid)}::${tabName ? String(tabName) : "__all__"}`;

  const loadData = async (sid = sheetId, preserveFilters = false, tabName = null, options = {}) => {
    if (!sid) return;
    const { preferCache = true, limit = BATCH_SIZE, offset = 0, append = false, context = "primary", filters = null } = options;
    
    const isPrimary = context === "primary";
    if (append) {
        if (isPrimary) setIsBatchLoading(true);
        else setSecondaryIsBatchLoading(true);
    }

    try {
      const params = new URLSearchParams();
      if (tabName) params.append("tab", tabName);
      
      if (selectedViewId && isPrimary) {
        params.append("viewId", selectedViewId);
      }

      const activeSort = isPrimary ? sortConfig : secondarySortConfig;
      if (activeSort) {
        params.append("sort_by", activeSort.key);
        params.append("sort_order", activeSort.direction);
      }
      
      const effectiveFilters = isPrimary ? columnFilters : filters;
      if (effectiveFilters && Object.keys(effectiveFilters).length > 0) {
        const serializableFilters = {};
        Object.entries(effectiveFilters).forEach(([col, val]) => {
          serializableFilters[col] = (val instanceof Set) ? Array.from(val) : val;
        });
        params.append("filters", JSON.stringify(serializableFilters));
      }

      params.append("limit", limit);
      params.append("offset", offset);

      const cacheKey = getDataCacheKey(sid, tabName) + "?" + params.toString();
      if (preferCache && !append && isPrimary && tabDataCacheRef.current[cacheKey]) {
        applyLoadedRows(sid, tabDataCacheRef.current[cacheKey], preserveFilters, false);
        return;
      }

      const url = `${API}/sheets/${sid}/data?${params.toString()}`;
      const res = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } });
      const raw = res.data;
      const activeViewConfig = (() => {
        const v = views.find((vv) => String(vv.id) === String(selectedViewId));
        if (!v) return null;
        return typeof v.config === "string" ? (() => { try { return JSON.parse(v.config); } catch { return null; } })() : v.config;
      })();

      if (isPrimary) {
          if (!append) tabDataCacheRef.current[cacheKey] = Array.isArray(raw) ? raw : [];
          applyLoadedRows(sid, raw, preserveFilters, append);
      } else {
          let effectiveSecondaryRows = Array.isArray(raw) ? raw : [];
          const secondaryVisibleColumns = activeViewConfig?.splitContext?.secondaryVisibleColumns;
          if (Array.isArray(secondaryVisibleColumns) && secondaryVisibleColumns.length > 0) {
            effectiveSecondaryRows = effectiveSecondaryRows.map((row) => {
              const next = {};
              secondaryVisibleColumns.forEach((col) => {
                if (Object.prototype.hasOwnProperty.call(row || {}, col)) next[col] = row[col];
              });
              return next;
            });
          }
          const secondaryForcedFilters = activeViewConfig?.splitContext?.secondaryColumnFilters;
          if (secondaryForcedFilters && typeof secondaryForcedFilters === "object" && Object.keys(secondaryForcedFilters).length > 0) {
            effectiveSecondaryRows = effectiveSecondaryRows.filter((row) => (
              Object.entries(secondaryForcedFilters).every(([col, allowed]) => {
                if (!Array.isArray(allowed) || allowed.length === 0) return true;
                return allowed.map((x) => String(x)).includes(String(row?.[col] ?? ""));
              })
            ));
          }
          if (append) {
              setSecondaryData(prev => [...prev, ...effectiveSecondaryRows]);
              if (effectiveSecondaryRows.length < BATCH_SIZE) setSecondaryHasMoreData(false);
          } else {
              setSecondaryData(effectiveSecondaryRows);
              setSecondaryHeaders(effectiveSecondaryRows.length ? Object.keys(effectiveSecondaryRows[0]) : []);
              setSecondaryHasMoreData(effectiveSecondaryRows.length >= BATCH_SIZE);
          }
      }
    } catch (e) {
      console.error(e);
    } finally {
      if (isPrimary) setIsBatchLoading(false);
      else setSecondaryIsBatchLoading(false);
    }
  };

  const onLoadMore = () => {
    if (isBatchLoading || !hasMoreData || !sheetId) return;
    loadData(sheetId, true, activeTab, { 
        offset: data.length, 
        append: true,
        preferCache: false 
    });
  };

  const onLoadMoreSecondary = (filters = null) => {
    if (secondaryIsBatchLoading || !secondaryHasMoreData || !secondarySheetId) return;
    loadData(secondarySheetId, true, secondaryTab, {
        offset: secondaryData.length,
        append: true,
        context: "secondary",
        preferCache: false,
        filters
    });
  };

  // Re-fetch data when sort, filters, or view changes (Server-side)
  useEffect(() => {
    if (sheetId && user) {
      loadData(sheetId, true, activeTab, { preferCache: false });
    }
  }, [sortConfig, columnFilters, activeTab, selectedViewId]);

  // Secondary Data Sync
  useEffect(() => {
    if (secondarySheetId && user) {
      loadData(secondarySheetId, true, secondaryTab, { context: "secondary", preferCache: false });
    }
  }, [secondarySheetId, secondaryTab, secondarySortConfig, selectedViewId]);

  const fetchTabs = async (sid, options = {}) => {
    const { preferredTab = null, preserveActive = false } = options;
    if (!sid) {
      setTabs([]);
      setActiveTab("");
      return [];
    }
    const cached = tabListCacheRef.current[String(sid)];
    if (Array.isArray(cached)) {
      setTabs(cached);
      if (cached.length > 0) {
        const nextTab = (preferredTab && cached.includes(preferredTab))
          ? preferredTab
          : (preserveActive && activeTab && cached.includes(activeTab) ? activeTab : cached[0]);
        setActiveTab(nextTab);
        localStorage.setItem("activeTab", nextTab);
      } else {
        setActiveTab("");
        localStorage.removeItem("activeTab");
      }
      return cached;
    }
    try {
      const res = await axios.get(`${API}/sheets/${sid}/tabs`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const tabList = res.data?.tabs || [];
      tabListCacheRef.current[String(sid)] = tabList;
      setTabs(tabList);
      if (tabList.length > 0) {
        const nextTab = (preferredTab && tabList.includes(preferredTab))
          ? preferredTab
          : (preserveActive && activeTab && tabList.includes(activeTab) ? activeTab : tabList[0]);
        setActiveTab(nextTab);
        localStorage.setItem("activeTab", nextTab);
      } else {
        setActiveTab("");
        localStorage.removeItem("activeTab");
      }
      return tabList;
    } catch (e) {
      console.error("fetchTabs failed:", e);
      setTabs([]);
      setActiveTab("");
      localStorage.removeItem("activeTab");
      return [];
    }
  };

  const handleTabChange = (tabName) => {
    setActiveTab(tabName);
    localStorage.setItem("activeTab", tabName);
    loadData(sheetId, true, tabName, { preferCache: true });
  };

  const hydrateSheetContext = async (sid, options = {}) => {
    if (!sid) return;
    if (String(sid) !== String(sheetId)) {
      setSelectedViewId("");
    }
    const {
      preferredTab = null,
      preserveFilters = false,
      preferCache = true,
    } = options;
    const tabList = await fetchTabs(sid, { preferredTab, preserveActive: false });
    const resolvedTab = Array.isArray(tabList) && tabList.length
      ? ((preferredTab && tabList.includes(preferredTab)) ? preferredTab : tabList[0])
      : null;
    await loadData(sid, preserveFilters, resolvedTab, { preferCache });
  };

  const refreshReportSources = React.useCallback(() => {
    if (!token) return Promise.resolve([]);
    return axios.get(`${API}/report-sources`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => {
        const sources = r.data || [];
        setReportSources(sources);
        const explicitSources = sources.filter((source) => source && !source.is_inferred && source.id);
        return Promise.all(
          explicitSources.map((source) => (
            axios.get(`${API}/report-sources/${source.id}/imports`, { headers: { Authorization: `Bearer ${token}` } })
              .then((importsRes) => [String(source.id), importsRes.data || []])
              .catch((e) => {
                if (user) console.error("Fetch report source imports failed", source.id, e);
                return [String(source.id), []];
              })
          ))
        ).then((entries) => {
          setReportSourceImports(Object.fromEntries(entries));
          return sources;
        });
      })
      .catch(e => {
        if (user) console.error("Fetch report sources failed", e);
        setReportSourceImports({});
        return [];
      });
  }, [API, token, user]);

  const maybePromptBusinessClassification = React.useCallback((payload) => {
    const classification = payload?.business_classification;
    const sheetIdentifier = payload?.sheetId || payload?.sheet_id;
    const businessType = String(classification?.businessType || classification?.business_type || "").trim();
    const status = String(classification?.status || payload?.business_classification_status || "").trim().toLowerCase();
    if (!sheetIdentifier || !businessType || classification?.isBusinessData !== true || status !== "pending") return;
    setBusinessClassificationPrompt({
      sheetId: sheetIdentifier,
      businessType,
      confidence: Number(classification?.confidence || 0),
      signals: Array.isArray(classification?.signals) ? classification.signals.slice(0, 4) : [],
    });
  }, []);

  const answerBusinessClassificationPrompt = React.useCallback(async (confirmed) => {
    const prompt = businessClassificationPrompt;
    if (!prompt?.sheetId) return;
    try {
      await axios.patch(`${API}/sheets/${prompt.sheetId}/business-classification`, { confirmed }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setMyFiles((prev) => (prev || []).map((file) => (
        String(file.id) === String(prompt.sheetId)
          ? { ...file, business_classification_status: confirmed ? "confirmed" : "rejected" }
          : file
      )));
    } catch (e) {
      console.error("business classification confirmation failed", e);
      alert(e?.response?.data?.error || "Failed to save business type confirmation");
    } finally {
      setBusinessClassificationPrompt(null);
    }
  }, [API, businessClassificationPrompt, token]);

  const handleUpload = async (uploadFile, displayName, reportSourceId = "", newReportSourceName = "", fileLabel = "") => {
    if (!uploadFile || !String(displayName || "").trim()) return;
    if (!reportSourceId && !String(newReportSourceName || "").trim()) return;
    if (uploadProgressOpen) return;
    const formData = new FormData();
    formData.append("file", uploadFile);
    formData.append("display_name", String(displayName).trim());
    formData.append("file_label", String(fileLabel || displayName).trim());
    if (reportSourceId) {
      formData.append("report_source_id", reportSourceId);
    } else {
      formData.append("report_source_name", String(newReportSourceName).trim());
    }
    const inferredTotal = Number(uploadFile?.size || 0);
    setUploadProgressOpen(true);
    setUploadProgressLoaded(0);
    setUploadProgressTotal(inferredTotal > 0 ? inferredTotal : 0);
    setUploadProgressPercent(0);
    setUploadProgressPhase("uploading");
    setUploadProgressError("");

    let uploadFailed = false;

    try {
      const res = await axios.post(`${API}/upload`, formData, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "multipart/form-data"
        },
        onUploadProgress: (progressEvent) => {
          const loaded = Math.max(0, Number(progressEvent?.loaded || 0));
          const eventTotal = Math.max(0, Number(progressEvent?.total || 0));
          const total = eventTotal > 0 ? eventTotal : (inferredTotal > 0 ? inferredTotal : loaded);
          const boundedLoaded = total > 0 ? Math.min(loaded, total) : loaded;
          const percent = total > 0 ? Math.round((boundedLoaded / total) * 100) : 0;
          setUploadProgressLoaded(boundedLoaded);
          setUploadProgressTotal(total);
          if (percent >= 100) {
            setUploadProgressPhase("processing");
            setUploadProgressPercent(95);
          } else {
            setUploadProgressPhase("uploading");
            setUploadProgressPercent(Math.max(0, Math.min(95, percent)));
          }
        },
      });
      setUploadProgressPhase("complete");
      setUploadProgressPercent(100);
      if (res.data?.status === "queued") {
        setUploadProgressError("Upload queued for import processing.");
        refreshReportSources();
        return;
      }
      if (res.data?.status === "pending_approval") {
        setUploadProgressError("Uploaded and held for review before publishing.");
        setUploadDisplayName("");
        setReportSourceName("");
        refreshReportSources();
        return;
      }
      if (res.data.sheetId) {
        setSheetId(res.data.sheetId);
        const activeName = res.data.display_name || res.data.filename;
        setActiveFilename(activeName);
        localStorage.setItem("activeFilename", activeName);
        setUploadDisplayName("");
        setReportSourceName("");
        if (res.data.tabs && res.data.tabs.length > 0) {
          tabListCacheRef.current[String(res.data.sheetId)] = res.data.tabs;
          setTabs(res.data.tabs);
          setActiveTab(res.data.tabs[0]);
          localStorage.setItem("activeTab", res.data.tabs[0]);
        }
        loadData(res.data.sheetId);
        maybePromptBusinessClassification(res.data);
        // Refresh my files too
        if (token) {
          axios.get(`${API}/my-sheets`, { headers: { Authorization: `Bearer ${token}` } })
            .then(r => setMyFiles(r.data || []));
          refreshReportSources();
        }
      }
    } catch (e) {
      console.error(e);
      uploadFailed = true;
      const backendMessage = e?.response?.data?.publicMessage || e?.response?.data?.message || e?.response?.data?.error || e?.message || "Upload failed";
      setUploadProgressPhase("failed");
      setUploadProgressPercent(100);
      setUploadProgressError(String(backendMessage));
    } finally {
      if (!uploadFailed) {
        refreshReportSources();
      }
    }
  };

  const handleGoogleDriveImport = async ({ fileId, name, mimeType, displayName, reportSourceId = "", reportSourceName: newReportSourceName = "", fileLabel = "", autosyncEnabled = false }) => {
    if (!fileId || !String(displayName || "").trim()) return;
    if (!reportSourceId && !String(newReportSourceName || "").trim()) return;
    try {
      const res = await axios.post(
        `${API}/google/drive/import`,
        {
          fileId,
          name,
          mimeType,
          display_name: String(displayName).trim(),
          file_label: String(fileLabel || displayName).trim(),
          autosync_enabled: autosyncEnabled ? "1" : "0",
          ...(reportSourceId ? { report_source_id: reportSourceId } : { report_source_name: String(newReportSourceName).trim() }),
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (res.data?.status === "queued") {
        alert("Google Drive import queued for processing.");
        refreshReportSources();
        return;
      }
      if (res.data?.status === "pending_approval") {
        alert("Imported from Google Drive and held for review before publishing.");
        setUploadDisplayName("");
        setReportSourceName("");
        refreshReportSources();
        return;
      }
      alert("Imported from Google Drive!");
      if (res.data?.sheetId) {
        setSheetId(res.data.sheetId);
        const activeName = res.data.display_name || res.data.filename;
        setActiveFilename(activeName);
        localStorage.setItem("activeFilename", activeName);
        setUploadDisplayName("");
        setReportSourceName("");
        if (res.data.tabs && res.data.tabs.length > 0) {
          tabListCacheRef.current[String(res.data.sheetId)] = res.data.tabs;
          setTabs(res.data.tabs);
          setActiveTab(res.data.tabs[0]);
          localStorage.setItem("activeTab", res.data.tabs[0]);
        }
        loadData(res.data.sheetId);
        maybePromptBusinessClassification(res.data);
        if (token) {
          axios.get(`${API}/my-sheets`, { headers: { Authorization: `Bearer ${token}` } })
            .then(r => setMyFiles(r.data || []));
          refreshReportSources();
        }
      }
    } catch (e) {
      console.error(e);
      alert(e.response?.data?.error || "Google Drive import failed");
    }
  };

  const handleDropboxImport = async ({ pathLower, fileId = "", name, displayName, reportSourceId = "", reportSourceName: newReportSourceName = "", fileLabel = "", autosyncEnabled = false }) => {
    if (!pathLower || !String(displayName || "").trim()) return;
    if (!reportSourceId && !String(newReportSourceName || "").trim()) return;
    try {
      const res = await axios.post(
        `${API}/dropbox/import`,
        {
          pathLower,
          fileId,
          name,
          display_name: String(displayName).trim(),
          file_label: String(fileLabel || displayName).trim(),
          autosync_enabled: autosyncEnabled ? "1" : "0",
          ...(reportSourceId ? { report_source_id: reportSourceId } : { report_source_name: String(newReportSourceName).trim() }),
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (res.data?.status === "queued") {
        alert("Dropbox import queued for processing.");
        refreshReportSources();
        return;
      }
      if (res.data?.status === "pending_approval") {
        alert("Imported from Dropbox and held for review before publishing.");
        setUploadDisplayName("");
        setReportSourceName("");
        refreshReportSources();
        return;
      }
      alert("Imported from Dropbox!");
      if (res.data?.sheetId) {
        setSheetId(res.data.sheetId);
        const activeName = res.data.display_name || res.data.filename;
        setActiveFilename(activeName);
        localStorage.setItem("activeFilename", activeName);
        setUploadDisplayName("");
        setReportSourceName("");
        if (res.data.tabs && res.data.tabs.length > 0) {
          tabListCacheRef.current[String(res.data.sheetId)] = res.data.tabs;
          setTabs(res.data.tabs);
          setActiveTab(res.data.tabs[0]);
          localStorage.setItem("activeTab", res.data.tabs[0]);
        }
        loadData(res.data.sheetId);
        maybePromptBusinessClassification(res.data);
        if (token) {
          axios.get(`${API}/my-sheets`, { headers: { Authorization: `Bearer ${token}` } })
            .then(r => setMyFiles(r.data || []));
          refreshReportSources();
        }
      }
    } catch (e) {
      console.error(e);
      alert(e.response?.data?.error || "Dropbox import failed");
    }
  };

  const handleOneDriveImport = async ({ itemId, name, displayName, reportSourceId = "", reportSourceName: newReportSourceName = "", fileLabel = "", autosyncEnabled = false }) => {
    if (!itemId || !String(displayName || "").trim()) return;
    if (!reportSourceId && !String(newReportSourceName || "").trim()) return;
    try {
      const res = await axios.post(
        `${API}/onedrive/import`,
        {
          itemId,
          name,
          display_name: String(displayName).trim(),
          file_label: String(fileLabel || displayName).trim(),
          autosync_enabled: autosyncEnabled ? "1" : "0",
          ...(reportSourceId ? { report_source_id: reportSourceId } : { report_source_name: String(newReportSourceName).trim() }),
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (res.data?.status === "queued") {
        alert("OneDrive import queued for processing.");
        refreshReportSources();
        return;
      }
      if (res.data?.status === "pending_approval") {
        alert("Imported from OneDrive and held for review before publishing.");
        setUploadDisplayName("");
        setReportSourceName("");
        refreshReportSources();
        return;
      }
      alert("Imported from OneDrive!");
      if (res.data?.sheetId) {
        setSheetId(res.data.sheetId);
        const activeName = res.data.display_name || res.data.filename;
        setActiveFilename(activeName);
        localStorage.setItem("activeFilename", activeName);
        setUploadDisplayName("");
        setReportSourceName("");
        if (res.data.tabs && res.data.tabs.length > 0) {
          tabListCacheRef.current[String(res.data.sheetId)] = res.data.tabs;
          setTabs(res.data.tabs);
          setActiveTab(res.data.tabs[0]);
          localStorage.setItem("activeTab", res.data.tabs[0]);
        }
        loadData(res.data.sheetId);
        maybePromptBusinessClassification(res.data);
        if (token) {
          axios.get(`${API}/my-sheets`, { headers: { Authorization: `Bearer ${token}` } })
            .then(r => setMyFiles(r.data || []));
          refreshReportSources();
        }
      }
    } catch (e) {
      console.error(e);
      alert(e.response?.data?.error || "OneDrive import failed");
    }
  };

  const appendCalculatedColumn = (colName, columnMap, calculateFunc) => {
    // 1. Add to headers
    const newHeaders = [...headers];
    if (!newHeaders.includes(colName)) {
      newHeaders.push(colName);
    }

    // 2. Loop through every row and execute the callback
    const newData = data.map(row => {
      // Create an object of just the required values
      const requiredVals = {};
      Object.entries(columnMap).forEach(([reqName, sourceColName]) => {
        const raw = row[sourceColName];
        requiredVals[reqName] = parseNum(raw); // Ensures it's a number
      });

      // Calculate the result
      const result = calculateFunc(requiredVals);

      // Mutate the row definition
      return { ...row, [colName]: result };
    });

    // 3. Update State
    setHeaders(newHeaders);
    setData(newData);
  };

  const deleteSheet = async (id) => {
    try {
      await axios.delete(`${API}/sheets/${id}`, { headers: { Authorization: `Bearer ${token}` } });
      setMyFiles((prev) => prev.filter((f) => f.id !== id));
      await refreshReportSources();

      if (id === sheetId) {
        setSheetId(null);
        setActiveFilename("");
        setData([]);
        setHeaders([]);
        localStorage.removeItem("sheetId");
        localStorage.removeItem("activeFilename");
      }
    } catch (e) {
      console.error(e);
      const msg = e?.response?.data?.error || e?.message || "Failed to delete";
      alert(`Failed to delete: ${msg}`);
      // Reconcile UI in case backend partially changed pointers/import status before error surfacing.
      await refreshReportSources();
    }
  };

  const requestSort = (key) => {
    let direction = "asc";
    if (sortConfig && sortConfig.key === key && sortConfig.direction === "asc") {
      direction = "desc";
    }
    setSortConfig({ key, direction });
  };

  const sanitizeSpreadsheetExportValue = (value) => {
    if (typeof value !== "string") return value;
    return /^[\s]*[=+\-@]/.test(value) ? `'${value}` : value;
  };

  const sanitizeSpreadsheetExportRows = (rows) => (
    rows.map((row) => {
      const safeRow = {};
      Object.entries(row || {}).forEach(([key, value]) => {
        safeRow[key] = sanitizeSpreadsheetExportValue(value);
      });
      return safeRow;
    })
  );

  const exportCSV = async () => {
    if (!sortedData.length) return;
    const XLSX = await loadXlsxModule();
    const ws = XLSX.utils.json_to_sheet(sanitizeSpreadsheetExportRows(sortedData));
    const csv = XLSX.utils.sheet_to_csv(ws);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `${activeFilename || "export"}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportXLSX = async () => {
    if (!sortedData.length) return;
    const XLSX = await loadXlsxModule();
    const ws = XLSX.utils.json_to_sheet(sanitizeSpreadsheetExportRows(sortedData));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Data");
    XLSX.writeFile(wb, `${activeFilename || "export"}.xlsx`);
  };

  const exportPDF = async () => {
    const [{ jsPDF }, autoTableModule] = await loadPdfModules();
    const autoTable = autoTableModule.default;
    const doc = new jsPDF("l", "pt", "a4");
    const pageWidth = doc.internal.pageSize.getWidth();
    const marginX = 24;
    const availableWidth = pageWidth - marginX * 2;

    const tableBody = sortedData.map(row =>
      displayHeaders.map(col => {
        const val = row[col];
        if (val === null || val === undefined) return "";
        if (looksLikeDateColumn(col)) {
          return fmtDateOnly(val);
        }
        if (typeof val === 'number') {
          const isPercent = /(pct|percent|rate|ratio|%)/i.test(col);
          const isCurrency = !isPercent && /(price|cost|expense|income|budget|fee|amount|revenue|sales|total|value|profit|margin|ebitda|\$)/i.test(col);

          const fmt = new Intl.NumberFormat('en-US', {
            minimumFractionDigits: (isCurrency || isPercent) ? 2 : 0,
            maximumFractionDigits: 2,
          }).format(val);

          if (isCurrency) return `$${fmt}`;
          if (isPercent) return `${fmt}%`;
          return fmt;
        }
        if (typeof val === 'object') {
          try { return JSON.stringify(val); } catch (e) { return String(val); }
        }
        return String(val);
      })
    );

    const numericColumns = displayHeaders.map((col) => {
      for (let i = 0; i < sortedData.length; i += 1) {
        const value = sortedData[i]?.[col];
        if (value === null || value === undefined || value === "") continue;
        return typeof value === "number";
      }
      return false;
    });

    const estimatedWidths = displayHeaders.map((col, colIndex) => {
      let maxLen = String(col || "").length;
      for (let i = 0; i < tableBody.length; i += 1) {
        const cellLen = String(tableBody[i]?.[colIndex] ?? "").length;
        if (cellLen > maxLen) maxLen = cellLen;
      }
      const px = Math.max(70, Math.min(180, maxLen * 6.2));
      return px;
    });

    const rawTotalWidth = estimatedWidths.reduce((sum, w) => sum + w, 0);
    const widthScale = rawTotalWidth > 0 ? Math.min(1, availableWidth / rawTotalWidth) : 1;
    const columnStyles = {};

    estimatedWidths.forEach((width, idx) => {
      const scaledWidth = Math.max(48, Math.floor(width * widthScale));
      columnStyles[idx] = {
        cellWidth: scaledWidth,
        halign: numericColumns[idx] ? "right" : "left",
      };
    });

    autoTable(doc, {
      head: [displayHeaders],
      body: tableBody,
      margin: { left: marginX, right: marginX, top: 24, bottom: 24 },
      styles: {
        fontSize: 8,
        overflow: "linebreak",
        cellPadding: { top: 4, right: 4, bottom: 4, left: 4 },
        valign: "middle",
      },
      headStyles: {
        halign: "left",
      },
      columnStyles,
    });
    doc.save(`${activeFilename || "export"}.pdf`);
  };

  useEffect(() => {
    axios.get(`${API}/auth/google/status`)
      .then((r) => setGoogleEnabled(r?.data?.enabled !== false))
      .catch(() => setGoogleEnabled(true));
    axios.get(`${API}/auth/dropbox/status`)
      .then((r) => setDropboxEnabled(r?.data?.enabled !== false))
      .catch(() => setDropboxEnabled(true));
    axios.get(`${API}/auth/onedrive/status`)
      .then((r) => setOneDriveEnabled(r?.data?.enabled !== false))
      .catch(() => setOneDriveEnabled(true));
    axios.get(`${API}/storage/sftp_storage/status`)
      .then((r) => setSftpStorageEnabled(r?.data?.enabled !== false))
      .catch(() => setSftpStorageEnabled(true));
    axios.get(`${API}/storage/gcs_storage/status`)
      .then((r) => setGcsStorageEnabled(r?.data?.enabled !== false))
      .catch(() => setGcsStorageEnabled(true));
    axios.get(`${API}/storage/s3_storage/status`)
      .then((r) => setS3StorageEnabled(r?.data?.enabled !== false))
      .catch(() => setS3StorageEnabled(true));
    axios.get(`${API}/storage/azure_blob_storage/status`)
      .then((r) => setAzureBlobStorageEnabled(r?.data?.enabled !== false))
      .catch(() => setAzureBlobStorageEnabled(true));
  }, []);

  useEffect(() => {
    if (user) return;
    const params = new URLSearchParams(window.location.search);
    const rawInvite = String(params.get("invite") || "").trim();
    if (!rawInvite) {
      setInviteToken("");
      setInviteInfo(null);
      setInviteError("");
      return;
    }
    setInviteToken(rawInvite);
    setInviteLoading(true);
    setInviteError("");
    axios.get(`${API}/auth/invitations/${encodeURIComponent(rawInvite)}`)
      .then((res) => {
        setInviteInfo(res?.data || null);
      })
      .catch((err) => {
        setInviteInfo(null);
        setInviteError(err?.response?.data?.error || "Invitation is invalid or expired.");
      })
      .finally(() => setInviteLoading(false));
  }, [API, user]);

  useEffect(() => {
    localStorage.removeItem("workspaceChartState:v1");
    const params = new URLSearchParams(window.location.search);
    const googleCode = params.get("google_code");
    const googleError = params.get("google_error");
    const samlCode = params.get("saml_code");
    const samlError = params.get("saml_error");
    if (samlCode) {
      axios.post(`${API}/auth/saml/exchange`, { code: samlCode })
        .then((resp) => {
          const exchangedToken = String(resp?.data?.token || "").trim();
          if (!exchangedToken) throw new Error("saml_exchange_missing_token");
          localStorage.setItem("token", exchangedToken);
          setToken(exchangedToken);
        })
        .catch(() => {
          alert("SAML sign-in failed.");
        });
      params.delete("saml_code");
      params.delete("saml_error");
      const next = params.toString();
      const nextUrl = `${window.location.pathname}${next ? `?${next}` : ""}${window.location.hash || ""}`;
      window.history.replaceState({}, document.title, nextUrl);
      return;
    }
    if (samlError) {
      const msg = samlError === "admin_manual_login_required"
        ? "Admin accounts must sign in with local credentials."
        : samlError === "saml_sso_disabled"
          ? "SAML SSO is disabled for this customer."
          : samlError === "saml_group_resolution_failed"
            ? "Unable to determine customer group for SAML sign-in. Ask your admin to include a group claim or use a group-scoped login link."
          : samlError === "sso_user_not_provisioned"
            ? "This account is not provisioned for customer SSO."
            : samlError === "sso_group_membership_required"
              ? "This account is not assigned to the requested customer."
              : "SAML sign-in failed.";
      params.delete("saml_code");
      params.delete("saml_error");
      const next = params.toString();
      const nextUrl = `${window.location.pathname}${next ? `?${next}` : ""}${window.location.hash || ""}`;
      window.history.replaceState({}, document.title, nextUrl);
      alert(msg);
      return;
    }
    if (googleCode) {
      axios.post(`${API}/auth/google/exchange`, { code: googleCode })
        .then((resp) => {
          const exchangedToken = String(resp?.data?.token || "").trim();
          if (!exchangedToken) throw new Error("google_exchange_missing_token");
          localStorage.setItem("token", exchangedToken);
          setToken(exchangedToken);
        })
        .catch(() => {
          alert("Google sign-in failed.");
        });
      params.delete("google_code");
      params.delete("google_error");
      const next = params.toString();
      const nextUrl = `${window.location.pathname}${next ? `?${next}` : ""}${window.location.hash || ""}`;
      window.history.replaceState({}, document.title, nextUrl);
      return;
    }
    if (googleError) {
      const msg = googleError === "admin_manual_login_required"
        ? "Admin accounts must sign in with local credentials."
        : googleError === "google_sso_disabled"
          ? "Google SSO is disabled for this customer."
          : googleError === "sso_user_not_provisioned"
            ? "This account is not provisioned for customer SSO."
            : googleError === "sso_group_membership_required"
              ? "This account is not assigned to the requested customer."
        : "Google sign-in failed.";
      params.delete("google_code");
      params.delete("google_error");
      const next = params.toString();
      const nextUrl = `${window.location.pathname}${next ? `?${next}` : ""}${window.location.hash || ""}`;
      window.history.replaceState({}, document.title, nextUrl);
      alert(msg);
    }
    const dropboxConnected = params.get("dropbox_connected");
    const dropboxError = params.get("dropbox_error");
    if (dropboxConnected) {
      params.delete("dropbox_connected");
      params.delete("dropbox_error");
      const next = params.toString();
      const nextUrl = `${window.location.pathname}${next ? `?${next}` : ""}${window.location.hash || ""}`;
      window.history.replaceState({}, document.title, nextUrl);
      alert("Dropbox connected.");
      return;
    }
    if (dropboxError) {
      const msg = "Dropbox authorization failed.";
      params.delete("dropbox_connected");
      params.delete("dropbox_error");
      const next = params.toString();
      const nextUrl = `${window.location.pathname}${next ? `?${next}` : ""}${window.location.hash || ""}`;
      window.history.replaceState({}, document.title, nextUrl);
      alert(msg);
    }
    const oneDriveConnected = params.get("onedrive_connected");
    const oneDriveError = params.get("onedrive_error");
    if (oneDriveConnected) {
      params.delete("onedrive_connected");
      params.delete("onedrive_error");
      const next = params.toString();
      const nextUrl = `${window.location.pathname}${next ? `?${next}` : ""}${window.location.hash || ""}`;
      window.history.replaceState({}, document.title, nextUrl);
      alert("OneDrive connected.");
      return;
    }
    if (oneDriveError) {
      const msg = "OneDrive authorization failed.";
      params.delete("onedrive_connected");
      params.delete("onedrive_error");
      const next = params.toString();
      const nextUrl = `${window.location.pathname}${next ? `?${next}` : ""}${window.location.hash || ""}`;
      window.history.replaceState({}, document.title, nextUrl);
      alert(msg);
    }
  }, []);

  useEffect(() => {
    if (!token) {
      setAuthChecking(false);
      setUser(null);
      return;
    }
    setAuthChecking(true);
    axios.get(`${API}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => {
        setUser(r.data);
        setToken((prev) => prev || readStoredAuthToken());
        const savedSheetId = localStorage.getItem("sheetId");
        const savedTab = localStorage.getItem("activeTab");
        if (savedSheetId && savedSheetId !== "null") {
          hydrateSheetContext(savedSheetId, {
            preferredTab: savedTab || null,
            preserveFilters: false,
            preferCache: true,
          });
        }
      })
      .catch(() => { setToken(""); setUser(null); setMyFiles([]); setReportSources([]); setReportSourceImports({}); })
      .finally(() => setAuthChecking(false));

    axios.get(`${API}/my-sheets`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => setMyFiles(r.data || []))
      .catch(e => {
        if (user) console.error("Fetch files failed", e);
      });
    refreshReportSources();
  }, [token]);

  // Helpers
  const resetPivot = () => {
    setPivotOn(false);
    setPivotRowKey("");
    setPivotColKey("");
    setPivotValKey("");
    setPivotAgg("sum");
  };

  const resetSummary = () => {
    setTwoOn(false);
    setCondCol1("");
    setCondCol2("");
    setValueCol("");
  };
  // Effect to load view config
  useEffect(() => {
    if (!selectedViewId) {
      setColumnFilters({});
      setSortConfig(null);
      setVisibleColumns([]);
      setSecondaryVisibleColumns([]);
      resetPivot();
      resetSummary();
      setTrendsOn(false);
      setTrendsDateKey("");
      setTrendsValueKey("");
      setTrendGranularity("month");
      setYearsBack(5);
      setSecondarySheetId("");
      setSecondaryTab(null);
      setSecondarySortConfig(null);
      return;
    }
    const view = views.find(v => String(v.id) === String(selectedViewId));
    if (!view || !view.config) return;

    const c = view.config;
    if (c.columnFilters) {
      const deserializedInfo = {};
      Object.entries(c.columnFilters).forEach(([col, val]) => {
        if (Array.isArray(val)) deserializedInfo[col] = new Set(val);
      });
      setColumnFilters(deserializedInfo);
    } else {
      setColumnFilters({});
    }

    if (c.sortConfig) setSortConfig(c.sortConfig);
    if (c.activeTab !== undefined && c.activeTab !== null) {
      const nextTab = String(c.activeTab || "").trim();
      if (nextTab) {
        setActiveTab(nextTab);
        localStorage.setItem("activeTab", nextTab);
      }
    }
    if (Array.isArray(c.visibleColumns)) setVisibleColumns(c.visibleColumns);
    if (Array.isArray(c.splitContext?.secondaryVisibleColumns)) {
      setSecondaryVisibleColumns(c.splitContext.secondaryVisibleColumns);
    }

    if (c.pivotOn) {
      setPivotOn(true);
      setPivotRowKey(c.pivotRowKey || "");
      setPivotColKey(c.pivotColKey || "");
      setPivotValKey(c.pivotValKey || "");
      setPivotAgg(c.pivotAgg || "sum");
    } else {
      setPivotOn(false);
    }

    if (c.twoOn) {
      setTwoOn(true);
      setCondCol1(c.condCol1 || "");
      setCondCol2(c.condCol2 || "");
      setValueCol(c.valueCol || "");
    } else {
      setTwoOn(false);
    }

    if (c.trendsOn) {
      setTrendsOn(true);
      setTrendsDateKey(c.trendsDateKey || "");
      setTrendsValueKey(c.trendsValueKey || "");
      setTrendGranularity(c.trendGranularity || "");
      setYearsBack(c.yearsBack || "");
    } else {
      setTrendsOn(false);
    }

    const splitCfg = c.splitContext && typeof c.splitContext === "object" ? c.splitContext : null;
    if (splitCfg) {
      setSecondarySheetId(splitCfg.secondarySheetId || "");
      setSecondaryTab(splitCfg.secondaryTab || null);
      setSecondarySortConfig(splitCfg.secondarySortConfig || null);
    }

  }, [selectedViewId, views]);

  useEffect(() => {
    if (!selectedViewId) return;
    const hasSelectedView = (views || []).some((v) => String(v.id) === String(selectedViewId));
    if (!hasSelectedView) {
      setSelectedViewId("");
    }
  }, [views, selectedViewId]);

  useEffect(() => {
    if (!sheetId || !token || !user) {
      setViews([]);
      return;
    }
    axios.get(`${API}/views/${sheetId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => setViews(r.data || []))
      .catch(e => {
        console.error("Fetch views failed", e);
        setViews([]);
      });
  }, [sheetId, token, user]);

  // Handlers for DashboardHeader
  const handleLogout = () => {
    axios.post(`${API}/auth/logout`).catch(() => {});
    localStorage.removeItem("token");
    localStorage.removeItem("authToken");
    localStorage.removeItem("jwt");
    localStorage.removeItem("jwtToken");
    localStorage.removeItem("sheetId");
    localStorage.removeItem("activeFilename");
    localStorage.removeItem("activeTab");
    localStorage.removeItem("workspaceChartState:v1");
    setToken("");
    setUser(null);
    setData([]);
    setHeaders([]);
    setSheetId(null);
    setActiveFilename("");
  };

  const handleSwitchSheet = (newSheetId, selectedName = "") => {
    if (!newSheetId) return;
    const source = reportSources.find(src => String(src.current_sheet_id) === String(newSheetId));
    const f = myFiles.find(file => String(file.id) === String(newSheetId));
    if (selectedName || source || f) {
      const activeName = selectedName || source?.name || f.display_name || f.filename;
      setActiveFilename(activeName);
      localStorage.setItem("activeFilename", activeName);
      localStorage.removeItem("activeTab"); // Clear tab on sheet switch to prevent cross-sheet contamination
      setActiveTab("");
    }
    hydrateSheetContext(newSheetId, { preserveFilters: false, preferCache: true });
  };

  /** ---------------------------
   * RENDER
   * --------------------------- */
  return (
    <Router>
      <div className="flex flex-col h-screen overflow-hidden premium-gradient font-sans text-slate-900">

        <AuthenticatedAppHeader
          user={user}
          onLogout={handleLogout}
          myFiles={myFiles}
          reportSources={reportSources}
          reportSourceImports={reportSourceImports}
          sheetId={sheetId}
          activeFilename={activeFilename}
          onSwitchSheet={handleSwitchSheet}
          onDeleteSheet={deleteSheet}
          onSaveView={() => setShowColumnSelector(true)}
          locale={dashboardI18n.locale}
          setLocale={dashboardI18n.setLocale}
          copy={dashboardI18n.copy}
          supportedLanguages={dashboardI18n.supportedLanguages}
        />

        {/* Note: Sub-navigation is now handled partly by DashboardHeader (Manage Users/Admin Panel) 
            and DashboardBody handles the Dashboard View. 
            However, if we are on /users, we need to be able to get back to /.
            DashboardHeader logo links to /.
        */}

        <main className="flex-1 min-h-0 relative flex flex-col overflow-y-auto">
          <Routes>
            <Route path="/" element={
              <ErrorBoundary>
                {!user && inviteToken ? (
                  <InviteAcceptScreen
                    inviteInfo={inviteInfo}
                    invitePassword={invitePassword}
                    setInvitePassword={setInvitePassword}
                    inviteRepeat={inviteRepeat}
                    setInviteRepeat={setInviteRepeat}
                    onAccept={handleAcceptInvitation}
                    loading={inviteLoading}
                    error={inviteError}
                    onBackToLogin={() => {
                      setInviteToken("");
                      setInviteInfo(null);
                      setInvitePassword("");
                      setInviteRepeat("");
                      setInviteError("");
                      clearInviteQueryParam();
                    }}
                  />
                ) : (
                  <ProductLandingPage user={user} />
                )}

              </ErrorBoundary>
            } />
            <Route path="/login" element={
              <ErrorBoundary>
                {authChecking ? (
                  <div className="min-h-screen w-full flex items-center justify-center bg-[#fafafa]">
                    <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Loading workspace...</div>
                  </div>
                ) : !user ? (
                  <AuthScreen
                    email={email}
                    setEmail={setEmail}
                    password={password}
                    setPassword={setPassword}
                    onSubmit={handleLogin}
                    onGoogleLogin={handleGoogleLogin}
                    onSamlLogin={handleSamlLogin}
                    googleEnabled={googleEnabled}
                  />
                ) : <Navigate to="/workspace" replace />}
              </ErrorBoundary>
            } />
            <Route path="/demo" element={<DemoBookingScreen />} />
            <Route path="/support" element={<SupportScreen />} />
            <Route path="/workspace/files" element={
              <ErrorBoundary>
                {authChecking ? (
                  <div className="min-h-screen w-full flex items-center justify-center bg-[#fafafa]">
                    <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Loading workspace...</div>
                  </div>
                ) : !user ? (
                  <Navigate to="/login" replace />
                ) : (
                  <DashboardHome
                    user={user}
                    myFiles={myFiles}
                    reportSources={reportSources}
                    reportSourceImports={reportSourceImports}
                    refreshReportSources={refreshReportSources}
                    sheetId={sheetId}
                    activeFilename={activeFilename}
                    tabs={tabs}
                    activeTab={activeTab}
                    onTabChange={handleTabChange}
                    headers={headers}
                    sortedData={sortedData}
                    columnFilters={columnFilters}
                    views={views}
                    pivotOn={pivotOn}
                    twoOn={twoOn}
                    trendsOn={trendsOn}
                    locale={dashboardI18n.locale}
                    copy={dashboardI18n.copy}
                    insightSection={sheetId ? (
                      <InsightFeed
                        sheetId={sheetId}
                        context="dashboard"
                        user={user}
                        onApplyFilter={applyContainsFilter}
                        onOpenChart={applyChartConfig}
                        onSaveView={saveInsightView}
                        locale={dashboardI18n.locale}
                        copy={dashboardI18n.copy}
                      />
                    ) : null}
                    chatSection={sheetId ? (
                      <SpreadsheetChatbot
                        mode="inline"
                        sheetId={sheetId}
                        data={sortedData}
                        allData={data}
                        headers={headers}
                        activeTab={activeTab}
                        activeFilters={columnFilters}
                        activeViewScope={activeChatViewScope}
                        onApplyFilter={applyContainsFilter}
                        onUpdateChart={applyChartConfig}
                        locale={dashboardI18n.locale}
                        copy={dashboardI18n.copy}
                      />
                    ) : null}
                  />
                )}
              </ErrorBoundary>
            } />
            <Route path="/workspace/review" element={
              <ErrorBoundary>
                {authChecking ? (
                  <div className="min-h-screen w-full flex items-center justify-center bg-[#fafafa]">
                    <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Loading workspace...</div>
                  </div>
                ) : !user ? (
                  <Navigate to="/login" replace />
                ) : (
                  <DashboardHome
                    user={user}
                    myFiles={myFiles}
                    reportSources={reportSources}
                    reportSourceImports={reportSourceImports}
                    refreshReportSources={refreshReportSources}
                    sheetId={sheetId}
                    activeFilename={activeFilename}
                    tabs={tabs}
                    activeTab={activeTab}
                    onTabChange={handleTabChange}
                    headers={headers}
                    sortedData={sortedData}
                    columnFilters={columnFilters}
                    views={views}
                    pivotOn={pivotOn}
                    twoOn={twoOn}
                    trendsOn={trendsOn}
                    focusReviewQueue
                    locale={dashboardI18n.locale}
                    copy={dashboardI18n.copy}
                    insightSection={sheetId ? (
                      <InsightFeed
                        sheetId={sheetId}
                        context="dashboard"
                        user={user}
                        onApplyFilter={applyContainsFilter}
                        onOpenChart={applyChartConfig}
                        onSaveView={saveInsightView}
                        locale={dashboardI18n.locale}
                        copy={dashboardI18n.copy}
                      />
                    ) : null}
                    chatSection={sheetId ? (
                      <SpreadsheetChatbot
                        mode="inline"
                        sheetId={sheetId}
                        data={sortedData}
                        allData={data}
                        headers={headers}
                        activeTab={activeTab}
                        activeFilters={columnFilters}
                        activeViewScope={activeChatViewScope}
                        onApplyFilter={applyContainsFilter}
                        onUpdateChart={applyChartConfig}
                        locale={dashboardI18n.locale}
                        copy={dashboardI18n.copy}
                      />
                    ) : null}
                  />
                )}
              </ErrorBoundary>
            } />
            <Route path="/workspace" element={
              <ErrorBoundary>
                {authChecking ? (
                  <div className="min-h-screen w-full flex items-center justify-center bg-[#fafafa]">
                    <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Loading workspace...</div>
                  </div>
                ) : !user ? (
                  inviteToken ? (
                    <InviteAcceptScreen
                      inviteInfo={inviteInfo}
                      invitePassword={invitePassword}
                      setInvitePassword={setInvitePassword}
                      inviteRepeat={inviteRepeat}
                      setInviteRepeat={setInviteRepeat}
                      onAccept={handleAcceptInvitation}
                      loading={inviteLoading}
                      error={inviteError}
                      onBackToLogin={() => {
                        setInviteToken("");
                        setInviteInfo(null);
                        setInvitePassword("");
                        setInviteRepeat("");
                        setInviteError("");
                        clearInviteQueryParam();
                      }}
                    />
                  ) : (
                    <AuthScreen
                      email={email}
                      setEmail={setEmail}
                      password={password}
                      setPassword={setPassword}
                      onSubmit={handleLogin}
                      onGoogleLogin={handleGoogleLogin}
                      onSamlLogin={handleSamlLogin}
                      googleEnabled={googleEnabled}
                    />
                  )
                ) : (
                  <>
                    {workspaceView === "grid" ? (
                    <DashboardBody
                      user={user} token={token} API={API}
                      sheetId={sheetId} setSheetId={setSheetId} activeFilename={activeFilename}
                      file={file} setFile={setFile}
                      selectedFileName={selectedFileName} setSelectedFileName={setSelectedFileName}
                      uploadDisplayName={uploadDisplayName}
                      setUploadDisplayName={setUploadDisplayName}
                      fileLabel={fileLabel}
                      setFileLabel={setFileLabel}
                      reportSourceName={reportSourceName}
                      setReportSourceName={setReportSourceName}
                      reportSources={reportSources}
                      reportSourceImports={reportSourceImports}
                      handleUpload={handleUpload}
                      uploadInProgress={uploadProgressOpen}
                      uploadPercent={uploadProgressPercent}
                      handleGoogleDriveImport={handleGoogleDriveImport}
                      handleGoogleConnect={handleGoogleConnect}
                      handleDropboxImport={handleDropboxImport}
                      handleDropboxConnect={handleDropboxConnect}
                      handleOneDriveImport={handleOneDriveImport}
                      handleOneDriveConnect={handleOneDriveConnect}
                      dropboxEnabled={dropboxEnabled}
                      oneDriveEnabled={oneDriveEnabled}
                      sftpStorageEnabled={sftpStorageEnabled}
                      gcsStorageEnabled={gcsStorageEnabled}
                      s3StorageEnabled={s3StorageEnabled}
                      azureBlobStorageEnabled={azureBlobStorageEnabled}
                      loadData={loadData}
                      refreshReportSources={refreshReportSources}
                      onBusinessClassificationGuess={maybePromptBusinessClassification}
                      selectedViewId={selectedViewId} setSelectedViewId={setSelectedViewId}
                      views={views} setViews={setViews}
                      setPendingViewName={setPendingViewName}
                      setShowColumnSelector={setShowColumnSelector}
                      setSaveViewConfigOverride={setSaveViewConfigOverride}
                      setEditingViewId={setEditingViewId}
                      sortedData={sortedData}
                      headers={headers}
                      displayHeaders={displayHeaders}
                      onDeleteSheet={deleteSheet}
                      openFilterCol={openFilterCol} setOpenFilterCol={setOpenFilterCol}
                      columnFilters={columnFilters} setColumnFilters={setColumnFilters}
                      sortConfig={sortConfig} requestSort={requestSort}
                      uniqueValuesByColumn={uniqueValuesByColumn}
                      pivotOn={pivotOn} setPivotOn={setPivotOn}
                      pivotRowKey={pivotRowKey} setPivotRowKey={setPivotRowKey}
                      pivotColKey={pivotColKey} setPivotColKey={setPivotColKey}
                      pivotValKey={pivotValKey} setPivotValKey={setPivotValKey}
                      pivotAgg={pivotAgg} setPivotAgg={setPivotAgg}
                      pivotRows={pivotRows} pivotHeaders={pivotHeaders}
                      pivotSeriesKeys={pivotSeriesKeys} pieData={pieData}
                      exportPivotPDF={exportPivotPDF} resetPivot={resetPivot} pivotChartRef={pivotChartRef}
                      twoOn={twoOn} setTwoOn={setTwoOn}
                      condCol1={condCol1} setCondCol1={setCondCol1}
                      condCol2={condCol2} setCondCol2={setCondCol2}
                      valueCol={valueCol} setValueCol={setValueCol}
                      summaryData={summaryData} resetSummary={resetSummary}
                      trendsOn={trendsOn} setTrendsOn={setTrendsOn}
                      trendsDateKey={trendsDateKey} setTrendsDateKey={setTrendsDateKey}
                      trendsValueKey={trendsValueKey} setTrendsValueKey={setTrendsValueKey}
                      trendGranularity={trendGranularity}
                      setTrendGranularity={setTrendGranularity}
                      yearsBack={yearsBack}
                      setYearsBack={setYearsBack}
                      trendsData={trendsData}
                      trendYearOptions={trendYearOptions}
                      compareYears={compareYears}
                      setCompareYears={setCompareYears}
                      maxYear={trendYearOptions[0]}
                      exportCSV={exportCSV} exportXLSX={exportXLSX} exportPDF={exportPDF}
                      tableContainerRef={tableContainerRef}
                      filterAnchorRefs={filterAnchorRefs}
                      filterBtnRefs={filterBtnRefs}
                      myFiles={myFiles} loadStored={(id) => { hydrateSheetContext(id, { preserveFilters: false, preferCache: true }); }}
                      tabs={tabs} setTabs={setTabs}
                      activeTab={activeTab}
                      onTabChange={handleTabChange}
                      tabListCacheRef={tabListCacheRef}
                      hasRequiredColumns={hasRequiredColumns}
                      appendCalculatedColumn={appendCalculatedColumn}
                      onInsightApplyFilter={applyContainsFilter}
                      onInsightOpenChart={applyChartConfig}
                      onInsightSaveView={saveInsightView}
                      onOpenFilesHome={() => setWorkspaceView("home")}
                      onOpenReviewQueue={() => setWorkspaceView("review")}
                      fetchUniqueValues={fetchUniqueValues}
                      onLoadMore={onLoadMore}
                      isBatchLoading={isBatchLoading}
                      secondaryData={secondaryData}
                      secondaryHeaders={secondaryHeaders}
                      secondarySortConfig={secondarySortConfig}
                      secondaryIsBatchLoading={secondaryIsBatchLoading}
                      onLoadMoreSecondary={onLoadMoreSecondary}
                      secondarySheetId={secondarySheetId}
                      setSecondarySheetId={setSecondarySheetId}
                      secondaryTab={secondaryTab}
                      setSecondaryTab={setSecondaryTab}
                      workspaceChartStateRef={workspaceChartStateRef}
                      locale={dashboardI18n.locale}
                      copy={dashboardI18n.copy}
                    />
                    ) : (
                    <DashboardHome
                      user={user}
                      myFiles={myFiles}
                      reportSources={reportSources}
                      reportSourceImports={reportSourceImports}
                      refreshReportSources={refreshReportSources}
                      sheetId={sheetId}
                      activeFilename={activeFilename}
                      tabs={tabs}
                      activeTab={activeTab}
                      onTabChange={handleTabChange}
                      headers={headers}
                      sortedData={sortedData}
                      columnFilters={columnFilters}
                      views={views}
                      pivotOn={pivotOn}
                      twoOn={twoOn}
                      trendsOn={trendsOn}
                      focusReviewQueue={workspaceView === "review"}
                      onOpenWorkspace={() => setWorkspaceView("grid")}
                      locale={dashboardI18n.locale}
                      copy={dashboardI18n.copy}
                      insightSection={sheetId ? (
                        <InsightFeed
                          sheetId={sheetId}
                          context="dashboard"
                          user={user}
                          onApplyFilter={applyContainsFilter}
                          onOpenChart={applyChartConfig}
                          onSaveView={saveInsightView}
                          locale={dashboardI18n.locale}
                          copy={dashboardI18n.copy}
                        />
                      ) : null}
                      chatSection={sheetId ? (
                        <SpreadsheetChatbot
                          mode="inline"
                          sheetId={sheetId}
                          data={sortedData}
                          allData={data}
                          headers={headers}
                          activeTab={activeTab}
                          activeFilters={columnFilters}
                          activeViewScope={activeChatViewScope}
                          onApplyFilter={applyContainsFilter}
                          onUpdateChart={applyChartConfig}
                          locale={dashboardI18n.locale}
                          copy={dashboardI18n.copy}
                        />
                      ) : null}
                    />
                    )}
                    {workspaceView === "grid" && sheetId && (
                    <SpreadsheetChatbot
                      mode="floating"
                      sheetId={sheetId}
                      splitContext={{
                        primarySheetId: sheetId,
                        secondarySheetId: secondarySheetId || null,
                        secondaryTab: secondaryTab || null,
                        primaryUploadedAt: (myFiles.find((f) => String(f.id) === String(sheetId)) || {}).uploaded_at || null,
                        secondaryUploadedAt: (myFiles.find((f) => String(f.id) === String(secondarySheetId)) || {}).uploaded_at || null,
                      }}
                      data={sortedData}
                      allData={data}
                      headers={headers}
                      activeFilters={columnFilters}
                      activeViewScope={activeChatViewScope}
                      onApplyFilter={applyContainsFilter}
                      onUpdateChart={applyChartConfig}
                      locale="en"
                    />
                    )}
                  </>
                )}
              </ErrorBoundary>
            } />
            <Route path="/users" element={
              authChecking ? (
                <div className="min-h-screen w-full flex items-center justify-center bg-[#fafafa]">
                  <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Loading workspace...</div>
                </div>
              ) : !user ? (
                <Navigate to="/login" replace />
              ) : (user?.role === "admin" || user?.is_group_admin || user?.group_admin || user?.is_admin)
                ? (
                  <ErrorBoundary>
                    <div className="flex-1 min-h-0 flex flex-col"><UserManagement token={token} user={user} sheetId={sheetId} /></div>
                  </ErrorBoundary>
                )
                : <div className="p-8 text-center text-gray-500">Access denied. Admin only.</div>
            } />
          </Routes>

          {/* GLOBAL MODALS */}
          {user && user.password_reset_required && (
            <ChangePasswordModal open={true} forceChange={true} onClose={() => { }} className="glass-modal" />
          )}
          {uploadProgressOpen && (
            <div className="fixed inset-0 z-[1000] bg-slate-900/55 backdrop-blur-sm flex items-center justify-center px-4">
              <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl border border-slate-200 p-5">
                <div className="text-sm font-black text-slate-900 tracking-tight">
                  {uploadProgressPhase === "processing" ? "Uploading Spreadsheet" : uploadProgressPhase === "complete" ? "Upload Complete" : "Uploading Spreadsheet"}
                </div>
                <div className="mt-1 text-[11px] font-semibold text-slate-500">
                  {uploadProgressPhase === "processing"
                    ? "Upload finished. Processing on the server..."
                    : uploadProgressPhase === "complete"
                      ? (uploadProgressError || "File uploaded and imported.")
                      : uploadProgressPhase === "failed"
                        ? <span className="font-black text-rose-700">{uploadProgressError || "Upload failed."}</span>
                        : "Sending the file to the server..."}
                </div>
                <div className="mt-4 h-2.5 rounded-full bg-slate-200 overflow-hidden">
                  <div
                    className={`h-full transition-[width] duration-200 ease-out ${uploadProgressPhase === "failed" ? "bg-rose-600" : uploadProgressPhase === "complete" ? "bg-emerald-600" : "bg-indigo-600"}`}
                    style={{ width: `${Math.max(0, Math.min(100, uploadProgressPercent))}%` }}
                  />
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px] font-semibold text-slate-600">
                  <span>{formatBytes(uploadProgressLoaded)} / {formatBytes(uploadProgressTotal)}</span>
                  <span>
                    {uploadProgressPhase === "processing"
                      ? "processing"
                      : uploadProgressPhase === "complete"
                        ? "complete"
                      : uploadProgressPhase === "failed"
                        ? "failed"
                      : `${Math.max(0, Math.min(100, uploadProgressPercent))}%`}
                  </span>
                </div>
                {(uploadProgressPhase === "failed" || uploadProgressPhase === "complete") && (
                  <div className="mt-4 flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        setUploadProgressOpen(false);
                        setUploadProgressLoaded(0);
                        setUploadProgressTotal(0);
                        setUploadProgressPercent(0);
                        setUploadProgressPhase("uploading");
                        setUploadProgressError("");
                      }}
                      className="rounded-md bg-slate-900 px-3 py-1 text-[10px] font-semibold text-white hover:bg-slate-800"
                    >
                      Close
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
          {businessClassificationPrompt && (
            <div className="fixed inset-0 z-[1100] bg-slate-900/55 backdrop-blur-sm flex items-center justify-center px-4">
              <div className="w-full max-w-md rounded-lg bg-white shadow-2xl border border-slate-200 p-5">
                <div className="text-sm font-black text-slate-900 tracking-tight">Confirm Sheet Type</div>
                <div className="mt-2 text-[12px] font-semibold text-slate-600">
                  Is this sheet for <span className="text-slate-950">{businessClassificationPrompt.businessType}</span>?
                </div>
                {businessClassificationPrompt.confidence > 0 && (
                  <div className="mt-1 text-[10px] font-semibold text-slate-500">
                    Confidence: {Math.round(Math.max(0, Math.min(1, businessClassificationPrompt.confidence)) * 100)}%
                  </div>
                )}
                {businessClassificationPrompt.signals?.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1">
                    {businessClassificationPrompt.signals.map((signal) => (
                      <span key={signal} className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-semibold text-slate-600">
                        {signal}
                      </span>
                    ))}
                  </div>
                )}
                <div className="mt-5 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => answerBusinessClassificationPrompt(false)}
                    className="rounded-md border border-slate-300 bg-white px-3 py-2 text-[11px] font-bold text-slate-700 hover:bg-slate-50"
                  >
                    No
                  </button>
                  <button
                    type="button"
                    onClick={() => answerBusinessClassificationPrompt(true)}
                    className="rounded-md bg-slate-900 px-3 py-2 text-[11px] font-bold text-white hover:bg-slate-800"
                  >
                    Yes
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>
        <Footer />
      </div>

      {/* Column Visibility Selector Modal for Saving Views */}
      {
        showColumnSelector && (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-[1px] flex items-center justify-center z-[100] animate-in fade-in duration-200 px-4">
            <div className="rounded-xl border border-slate-200 bg-white max-w-xl w-full max-h-[82vh] flex flex-col shadow-2xl animate-in zoom-in-95 duration-200">
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
                <div>
                  <h2 className="text-base font-semibold text-slate-900 tracking-tight">{editingViewId ? "Edit View" : "Configure View"}</h2>
                  <p className="text-slate-500 text-[11px] mt-0.5">{editingViewId ? "Update this view and save changes." : "Select scope and save the locked selection."}</p>
                </div>
                <button 
                  onClick={() => {
                    setShowColumnSelector(false);
                    setEditingViewId(null);
                  }}
                  className="w-8 h-8 rounded-md hover:bg-slate-100 flex items-center justify-center text-slate-400 transition-colors"
                >✕</button>
              </div>
              <div className="p-4 space-y-2 overflow-auto">
                <p className="text-[11px] text-slate-600">
                  {editingViewId ? "Save changes to the currently selected view." : "The selected columns or area are saved as the locked view selection."}
                </p>

                <div className="space-y-2.5">
                  <div className="space-y-1">
                    <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">View Name</label>
                    <input
                      type="text"
                      value={pendingViewName}
                      onChange={(e) => setPendingViewName(e.target.value)}
                      placeholder="e.g. Monthly Client View"
                      className="input-premium w-full py-1.5 text-[11px] font-semibold"
                      autoFocus
                    />
                  </div>

                  {!editingViewId && (
                    <div className="space-y-1">
                      <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Scope</label>
                      <select
                        value={viewLevel}
                        onChange={(e) => setViewLevel(e.target.value)}
                        className="input-premium w-full py-1.5 text-[11px] font-semibold"
                      >
                        {user?.role === "admin" && (
                          <option value="global">Global (All Files)</option>
                        )}
                        <option value="source">This Report Source (All Files)</option>
                        <option value="file">This File (All Revisions)</option>
                        <option value="revision">This Revision Only</option>
                      </select>
                    </div>
                  )}
                </div>
              </div>
              <div className="flex gap-2 justify-end px-4 py-2.5 border-t border-slate-200 bg-slate-50">
                <button
                  className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[10px] font-semibold text-slate-700 hover:bg-slate-100"
                  onClick={() => {
                    setShowColumnSelector(false);
                    setPendingViewName("");
                    setViewLevel("revision");
                    setSaveViewConfigOverride(null);
                    setEditingViewId(null);
                  }}
                >
                  Cancel
                </button>
                <button
                  className="rounded-md bg-slate-900 px-3 py-1 text-[10px] font-semibold text-white hover:bg-slate-800"
                  onClick={async () => {
                    try {
                      const effectiveColumnFilters = saveViewConfigOverride?.columnFilters || columnFilters;
                      const serializableColumnFilters = {};
                      for (const key in effectiveColumnFilters) {
                        serializableColumnFilters[key] = Array.from(effectiveColumnFilters[key]);
                      }
                      const config = {
                        columnFilters: serializableColumnFilters,
                        activeTab: saveViewConfigOverride?.activeTab ?? (activeTab || null),
                        sortConfig,
                        visibleColumns: Array.isArray(saveViewConfigOverride?.visibleColumns)
                          ? saveViewConfigOverride.visibleColumns
                          : visibleColumns,
                        splitContext: {
                          secondarySheetId: saveViewConfigOverride?.splitContext?.secondarySheetId ?? (secondarySheetId || null),
                          secondaryTab: saveViewConfigOverride?.splitContext?.secondaryTab ?? (secondaryTab || null),
                          secondarySortConfig: saveViewConfigOverride?.splitContext?.secondarySortConfig ?? (secondarySortConfig || null),
                          secondaryColumnFilters: saveViewConfigOverride?.splitContext?.secondaryColumnFilters || {},
                          secondaryVisibleColumns: Array.isArray(saveViewConfigOverride?.splitContext?.secondaryVisibleColumns)
                            ? saveViewConfigOverride.splitContext.secondaryVisibleColumns
                            : secondaryVisibleColumns,
                        },
                        pivotOn,
                        pivotRowKey,
                        pivotColKey,
                        pivotValKey,
                        pivotAgg,
                        twoOn,
                        condCol1,
                        condCol2,
                        valueCol,
                        trendsOn,
                        trendsDateKey,
                        trendsValueKey,
                        trendGranularity,
                        yearsBack,
                      };
                      if (editingViewId) {
                        await axios.put(
                          `${API}/views/${editingViewId}`,
                          { name: pendingViewName, config },
                          { headers: { Authorization: `Bearer ${token}` } }
                        );
                      } else {
                        await axios.post(
                          `${API}/views`,
                          { name: pendingViewName, sheetId, config, level: viewLevel },
                          { headers: { Authorization: `Bearer ${token}` } }
                        );
                      }
                      const res = await axios.get(`${API}/views/${sheetId}`, {
                        headers: { Authorization: `Bearer ${token}` },
                      });
                      setViews(res.data || []);
                      setShowColumnSelector(false);
                      setPendingViewName("");
                      setViewLevel("revision");
                      setSaveViewConfigOverride(null);
                      setEditingViewId(null);
                      alert(editingViewId ? "View updated successfully!" : "View saved successfully!");
                    } catch (e) {
                      console.error("Save view failed:", e);
                      alert(editingViewId ? "Failed to update view" : "Failed to save view");
                    }
                  }}
                >
                  {editingViewId ? "Update View" : "Save View"}
                </button>
              </div>
            </div>
          </div>
        )
      }

    </Router >
  );
}
