import React, { Suspense, lazy, useState, useEffect, useRef, useMemo } from "react";
import { BrowserRouter as Router, Routes, Route, Link, Navigate, useLocation } from "react-router-dom";
import axios from "axios";

import ErrorBoundary from "./ErrorBoundary";
import DashboardHeader from "./components/dashboard/DashboardHeader";
import Modal from "./components/common/Modal";
import ChangePasswordModal from "./components/common/ChangePasswordModal";
import SourceProviderIcon from "./components/common/SourceProviderIcon";
import { useDashboardI18n } from "./hooks/useDashboardI18n";
import { looksLikeDateColumn } from "./utils/dateColumns";

import "./index.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";
const SESSION_ACTIVE_TOKEN = "cookie-session";
const createSessionMarker = () => `${SESSION_ACTIVE_TOKEN}:${Date.now()}`;
const themeTextClass = "text-[hsl(var(--primary))]";
const themeHoverTextClass = "hover:text-[hsl(var(--primary))]";
const themeBorderClass = "border-[hsl(var(--primary)/0.24)]";
const themeHoverBorderClass = "hover:border-[hsl(var(--primary)/0.24)]";
const themeSoftClass = "border-[hsl(var(--primary)/0.24)] bg-[hsl(var(--primary)/0.10)] text-[hsl(var(--primary))]";
const themeGlowClass = "bg-[hsl(var(--accent)/0.14)]";
const primaryActionClass = "inline-flex items-center justify-center rounded-xl bg-[hsl(var(--primary))] px-6 text-sm font-black text-[hsl(var(--primary-foreground))] shadow-[0_14px_30px_hsl(var(--primary)/0.24)] ring-1 ring-[hsl(var(--primary)/0.24)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-[hsl(var(--foreground))] hover:shadow-[0_18px_36px_hsl(var(--foreground)/0.22)] active:translate-y-0";
const secondaryActionClass = "inline-flex items-center justify-center rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-6 text-sm font-black text-[hsl(var(--foreground))] shadow-[0_10px_24px_hsl(var(--foreground)/0.08)] ring-1 ring-white transition-all duration-200 hover:-translate-y-0.5 hover:border-[hsl(var(--primary)/0.38)] hover:text-[hsl(var(--primary))] hover:shadow-[0_14px_30px_hsl(var(--foreground)/0.12)] active:translate-y-0";
const formLabelClass = "ml-0.5 text-[10px] font-black uppercase tracking-[0.14em] text-slate-500 transition-colors group-focus-within:text-[hsl(var(--primary))]";
const formFieldClass = "mt-1 h-12 w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 text-sm font-bold text-[hsl(var(--foreground))] shadow-[0_8px_22px_hsl(var(--foreground)/0.06),inset_0_1px_0_rgba(255,255,255,0.95)] transition-all placeholder:text-xs placeholder:font-semibold placeholder:text-slate-400 hover:border-slate-400 hover:shadow-[0_10px_26px_hsl(var(--foreground)/0.08),inset_0_1px_0_rgba(255,255,255,0.95)] focus:border-[hsl(var(--primary)/0.70)] focus:bg-white focus:outline-none focus:ring-4 focus:ring-[hsl(var(--primary)/0.10)]";
const formTextareaClass = "mt-1 w-full resize-none rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3 text-sm font-bold leading-5 text-[hsl(var(--foreground))] shadow-[0_8px_22px_hsl(var(--foreground)/0.06),inset_0_1px_0_rgba(255,255,255,0.95)] transition-all placeholder:text-xs placeholder:font-semibold placeholder:leading-5 placeholder:text-slate-400 hover:border-slate-400 hover:shadow-[0_10px_26px_hsl(var(--foreground)/0.08),inset_0_1px_0_rgba(255,255,255,0.95)] focus:border-[hsl(var(--primary)/0.70)] focus:outline-none focus:ring-4 focus:ring-[hsl(var(--primary)/0.10)]";
const publicPageClass = "min-h-screen w-full bg-gradient-to-b from-white via-slate-50 to-white px-5 py-8 text-slate-950 md:px-8";
const publicPanelClass = "rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_24px_70px_hsl(var(--foreground)/0.10)] md:p-7";
const publicMiniPanelClass = "border-t border-slate-300 py-4 transition-colors duration-200 hover:border-[hsl(var(--primary)/0.28)]";
const publicMutedPanelClass = "rounded-xl border border-slate-200 bg-slate-50/70 p-4 shadow-sm";
const DashboardBody = lazy(() => import("./components/dashboard/DashboardBody"));
const DashboardHome = lazy(() => import("./components/dashboard/DashboardHome"));
const InsightFeed = lazy(() => import("./components/dashboard/InsightFeed"));
const SpreadsheetChatbot = lazy(() => import("./SpreadsheetChatbot"));
const UserManagement = lazy(() => import("./UserManagement"));
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

function clearStoredAuthTokens() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem("token");
  window.localStorage.removeItem("authToken");
  window.localStorage.removeItem("jwt");
  window.localStorage.removeItem("jwtToken");
}

function stripSessionMarkerBearer(headers) {
  if (!headers) return;
  const raw = headers.Authorization ?? headers.authorization ?? "";
  const value = String(raw || "").trim();
  if (
    !value.startsWith(`Bearer ${SESSION_ACTIVE_TOKEN}:`)
    && !["Bearer", "Bearer null", "Bearer undefined"].includes(value)
  ) return;
  if (typeof headers.delete === "function") {
    headers.delete("Authorization");
    headers.delete("authorization");
  }
  delete headers.Authorization;
  delete headers.authorization;
}

axios.interceptors.request.use((config) => {
  stripSessionMarkerBearer(config.headers);
  const method = String(config.method || "get").toUpperCase();
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

function Footer() {
  const links = [
    ["Product", "#product"],
    ["Controls", "#controls"],
    ["Sources", "#sources"],
    ["Controlled AI", "#controlled-ai"],
    ["Security", "#security"],
    ["Docs", "#workflow"],
    ["Pricing", "/pricing"],
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
            href.startsWith("/") ? (
              <Link key={label} to={href} className={themeHoverTextClass}>
                {label}
              </Link>
            ) : (
              <a key={label} href={href} className={themeHoverTextClass}>
                {label}
              </a>
            )
          ))}
        </nav>
      </div>
    </footer>
  );
}

function Header({ user = null }) {
  const navItems = [
    ["Product", "/#product"],
    ["Workflow", "/#workflow"],
    ["Controls", "/#controls"],
    ["Controlled AI", "/#controlled-ai"],
    ["Sources", "/#sources"],
    ["Pricing", "/pricing"],
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
            <Link key={label} to={href} className={themeHoverTextClass}>
              {label}
            </Link>
          ))}
        </nav>
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <Link to={user ? "/workspace" : "/login"} className={`hidden rounded-lg px-3 py-2 text-sm font-bold text-slate-700 ${themeHoverTextClass} sm:inline-flex`}>
            {user ? "Workspace" : "Sign in"}
          </Link>
          <Link
            to="/demo"
            className={`${primaryActionClass} h-10 px-4`}
          >
            Book demo
          </Link>
        </div>
      </div>
    </header>
  );
}

function ScrollToHash() {
  const location = useLocation();

  useEffect(() => {
    if (!location.hash) {
      window.scrollTo({ top: 0, behavior: "auto" });
      return;
    }
    const id = decodeURIComponent(location.hash.slice(1));
    const scrollToTarget = () => {
      const target = document.getElementById(id);
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    window.setTimeout(scrollToTarget, 0);
  }, [location.pathname, location.hash]);

  return null;
}

function Badge({ children, tone = "blue" }) {
  const tones = {
    blue: themeSoftClass,
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
      <div className={`absolute -inset-5 rounded-[2rem] ${themeGlowClass} blur-3xl`} aria-hidden="true" />
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
      {eyebrow && <div className={`text-xs font-black uppercase tracking-[0.22em] ${themeTextClass}`}>{eyebrow}</div>}
      <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950 md:text-4xl">{title}</h2>
      {body && <p className="mt-4 text-base font-semibold leading-8 text-slate-600">{body}</p>}
    </div>
  );
}

function Hero() {
  return (
    <section id="product" className="relative overflow-hidden border-b border-slate-200 bg-gradient-to-b from-slate-50 via-white to-slate-50 px-5 py-14 md:px-8 lg:py-20">
      <div className={`absolute left-1/2 top-0 h-72 w-[48rem] -translate-x-1/2 rounded-full ${themeGlowClass} blur-3xl`} />
      <div className="relative mx-auto grid max-w-7xl gap-12 lg:grid-cols-[0.92fr_1.08fr] lg:items-center">
        <div>
          <Badge tone="blue">The spreadsheet trust layer</Badge>
          <h1 className="mt-6 max-w-3xl text-4xl font-black tracking-tight text-slate-950 sm:text-5xl lg:text-6xl">
            The last spreadsheet your clients have to chase.
          </h1>
          <p className="mt-6 max-w-2xl text-lg font-semibold leading-8 text-slate-600">
            TFORN turns recurring customer uploads into polished, permissioned pages where every stakeholder sees the right numbers, the latest version, and the story behind the changes.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              to="/demo"
              className={`${primaryActionClass} h-12`}
            >
              Book a demo
            </Link>
            <a
              href="#workflow"
              className={`${secondaryActionClass} h-12`}
            >
              See the workflow
            </a>
          </div>
          <p className="mt-6 max-w-xl text-sm font-black leading-6 text-slate-500">
            Fewer attachments. Fewer version debates. More confidence in every number you share.
          </p>
        </div>
        <ProductMockup />
      </div>
    </section>
  );
}

function FeatureCard({ icon, title, body }) {
  return (
    <article className={`border-t border-slate-300 py-5 transition-colors duration-200 ${themeHoverBorderClass}`}>
      <div className={`flex items-center gap-3 ${themeTextClass}`}>
        <Icon name={icon} className="h-6 w-6 shrink-0" />
        <div className="h-px flex-1 bg-slate-200" aria-hidden="true" />
      </div>
      <h3 className="mt-5 text-lg font-black text-slate-950">{title}</h3>
      <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">{body}</p>
    </article>
  );
}

function WorkflowStep({ icon, title, body }) {
  return (
    <div className="border-t border-slate-300 py-5">
      <div className={`flex items-center gap-3 ${themeTextClass}`}>
        <Icon name={icon} className="h-5 w-5 shrink-0" />
        <div className="h-px flex-1 bg-slate-200" aria-hidden="true" />
      </div>
      <h3 className="mt-4 text-sm font-black text-slate-950">{title}</h3>
      <p className="mt-2 text-xs font-semibold leading-5 text-slate-600">{body}</p>
    </div>
  );
}

function LandingSourceIcon({ icon }) {
  const wideIcon = icon === "quickbooks";
  return <SourceProviderIcon provider={icon || "upload"} className={`${wideIcon ? "h-5 w-16" : "h-5 w-5"} shrink-0`} />;
}

function SourceCard({ title, body, icon = "storage" }) {
  return (
    <div className={`border-t border-slate-300 py-4 transition-colors duration-200 ${themeHoverBorderClass}`}>
      <div className="flex items-center gap-3">
        <LandingSourceIcon icon={icon} title={title} />
        <h3 className="min-w-0 text-sm font-black text-slate-950">{title}</h3>
      </div>
      <p className="mt-3 text-xs font-semibold leading-5 text-slate-600">{body}</p>
    </div>
  );
}

function GovernanceCard({ title, body, icon }) {
  return (
    <div className={`border-t border-slate-300 py-4 transition-colors duration-200 ${themeHoverBorderClass}`}>
      <div className="flex items-start gap-3">
        <Icon name={icon} className={`mt-0.5 h-5 w-5 shrink-0 ${themeTextClass}`} />
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
    ["Best for", "Passing along a file", "Publishing a static report", "Editing in a sheet", "Delivering a trusted client view"],
    ["Customer upload", "One-off handoff", "Already finalized", "Mixed with edits", "Becomes the reviewed source"],
    ["Outside stakeholders", "Get another copy", "See a snapshot", "May edit", "See only what is approved"],
    ["Current version", "Easy to lose", "Not the focus", "Can be unclear", "Front and center"],
    ["When columns change", "Found later", "Usually hidden", "Handled manually", "Flagged before sharing"],
    ["Questions", "Answered in side threads", "Limited by the published view", "Depends on formulas", "Answered from approved data"],
    ["Main value", "Fast transfer", "Static presentation", "Sheet collaboration", "Confident delivery"],
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
          title="Shared spreadsheets need a controlled front door."
          body="TFORN is for recurring files that customers, clients, partners, lenders, boards, or teams need to trust after review. It keeps the latest version, source history, viewer access, and approved answers in one controlled experience."
        />
        <div className="mt-8 border-y border-slate-300">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse bg-white text-left">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="px-4 py-4 text-xs font-black uppercase tracking-[0.16em] text-slate-500">What you need</th>
                  <th className="px-4 py-4 text-xs font-black uppercase tracking-[0.16em] text-slate-500">Random file upload</th>
                  <th className="px-4 py-4 text-xs font-black uppercase tracking-[0.16em] text-slate-500">Static report</th>
                  <th className="px-4 py-4 text-xs font-black uppercase tracking-[0.16em] text-slate-500">Spreadsheet work tool</th>
                  <th className={`px-4 py-4 text-xs font-black uppercase tracking-[0.16em] ${themeTextClass}`}>TFORN</th>
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
          TFORN is not middleware for reporting tools. It is the controlled destination for reviewed recurring spreadsheets that still need to be shared, revisited, governed, and explained.
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
          <h2 className="text-3xl font-black tracking-tight md:text-4xl">Give every number a place people can trust.</h2>
          <p className="mt-4 text-base font-semibold leading-8 text-slate-300">
            Upload the file, approve the view, and send stakeholders to one clean page instead of one more attachment.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row lg:shrink-0">
          <Link to="/demo" className="inline-flex h-12 items-center justify-center rounded-xl bg-white px-6 text-sm font-black text-slate-950 shadow-[0_14px_32px_rgba(255,255,255,0.14)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-slate-100 hover:shadow-[0_18px_40px_rgba(255,255,255,0.18)] active:translate-y-0">
            Book a demo
          </Link>
          <a href="#workflow" className="inline-flex h-12 items-center justify-center rounded-xl border border-white/30 bg-white/5 px-6 text-sm font-black text-white shadow-[0_14px_32px_rgba(0,0,0,0.16)] transition-all duration-200 hover:-translate-y-0.5 hover:border-white/50 hover:bg-white/10 active:translate-y-0">
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
    ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow-sm"
    : "border border-slate-200 bg-white text-slate-700";
  const iconClass = isUser ? "text-white/85" : themeTextClass;

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

const PRICING_BUNDLES = [
  {
    key: "core",
    label: "Core",
    tagline: "Start sharing",
    audience: "For a small customer workspace sharing a few recurring spreadsheets.",
    users: "Up to 10 remote users",
    sources: "Up to 3 shared sheets",
    tools: "Basic read-only tools",
    accent: "blue",
    features: [
      "A simple place for shared files",
      "Read-only recipients",
      "Current version label",
      "Basic filters and exports",
    ],
  },
  {
    key: "growth",
    label: "Growth",
    tagline: "Regular sharing",
    audience: "For customers sending recurring monthly files to more outside recipients.",
    users: "Up to 50 remote users",
    sources: "Up to 15 shared sheets",
    tools: "More viewer tools",
    accent: "green",
    featured: true,
    features: [
      "Everything in Core",
      "More recurring sheets",
      "Recipient groups",
      "Version comparison",
      "Saved views for repeat use",
    ],
  },
  {
    key: "enterprise",
    label: "Enterprise",
    tagline: "Larger rollout",
    audience: "For larger customers with many shared sheets, recipient groups, and setup needs.",
    users: "Up to 250 remote users",
    sources: "Up to 100 shared sheets",
    tools: "Expanded viewer tools",
    accent: "slate",
    features: [
      "Everything in Growth",
      "Higher file and viewer limits",
      "More workspace structure",
      "Longer version history",
      "Finance workflow setup",
      "Custom rollout planning",
    ],
  },
];

function PricingPlanCard({ plan }) {
  return (
    <article className={`relative flex h-full flex-col border-t border-slate-300 py-6 transition-colors duration-200 ${themeHoverBorderClass}`}>
      <div className={`flex items-center gap-3 ${themeTextClass}`}>
        <Icon name={plan.key === "enterprise" ? "shield" : plan.key === "growth" ? "approval" : "source"} className="h-6 w-6 shrink-0" />
        <div className="h-px flex-1 bg-slate-200" aria-hidden="true" />
        {plan.featured && (
          <span className="shrink-0 text-[10px] font-black uppercase tracking-[0.16em] text-[hsl(var(--primary))]">
            Most common
          </span>
        )}
      </div>
      <div className="mt-5">
        <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">{plan.tagline}</div>
        <h2 className="mt-4 text-2xl font-black tracking-tight text-slate-950">{plan.label}</h2>
        <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">{plan.audience}</p>
      </div>
      <div className="mt-5 border-y border-slate-200 py-4">
        <div className="grid gap-3 text-sm">
          {[plan.users, plan.sources, plan.tools].map((item) => (
            <div key={item} className="flex items-start gap-2 font-black text-slate-900">
              <Icon name="check" className={`mt-0.5 h-4 w-4 shrink-0 ${themeTextClass}`} />
              <span>{item}</span>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs font-bold leading-5 text-slate-500">Final pricing depends on workspace needs.</p>
      </div>
      <ul className="mt-5 flex-1 space-y-2">
        {plan.features.map((feature) => (
          <li key={feature} className="flex gap-2 text-sm font-semibold leading-6 text-slate-700">
            <Icon name="check" className={`mt-1 h-4 w-4 shrink-0 ${themeTextClass}`} />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
      <Link to="/demo" className={`${secondaryActionClass} mt-6 h-11 px-4`}>
        Discuss {plan.label}
      </Link>
    </article>
  );
}

function PricingPage({ user = null }) {
  const comparisonRows = [
    ["Read-only recipients", "10", "50", "250"],
    ["Recurring shared sheets", "3", "15", "100"],
    ["Recipient groups", "Simple", "Multiple", "Advanced"],
    ["Version comparison", "Basic", "Expanded", "Expanded"],
    ["Viewer actions", "Basic", "More", "Expanded"],
    ["Setup support", "Standard", "Standard", "Custom"],
  ];

  return (
    <div className="min-h-full bg-slate-50 text-slate-900">
      <Header user={user} />
      <main>
        <section className="relative overflow-hidden border-b border-slate-200 bg-gradient-to-b from-white via-slate-50 to-white px-5 py-14 md:px-8 lg:py-18">
          <div className={`absolute left-1/2 top-0 h-72 w-[48rem] -translate-x-1/2 rounded-full ${themeGlowClass} blur-3xl`} aria-hidden="true" />
          <div className="relative mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.88fr_1.12fr] lg:items-center">
            <div>
              <Badge tone="blue">Pricing</Badge>
              <h1 className="mt-6 max-w-3xl text-4xl font-black tracking-tight text-slate-950 sm:text-5xl">
                Pricing based on sharing size.
              </h1>
              <p className="mt-5 max-w-2xl text-lg font-semibold leading-8 text-slate-600">
                Choose a bundle by how many remote users need read-only access and how many recurring spreadsheets the customer shares.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link to="/demo" className={`${primaryActionClass} h-12`}>
                  Book pricing demo
                </Link>
                <Link to="/support" className={`${secondaryActionClass} h-12`}>
                  Ask billing question
                </Link>
              </div>
            </div>
            <figure className="relative">
              <div className={`absolute -inset-5 rounded-[2rem] ${themeGlowClass} blur-3xl`} aria-hidden="true" />
              <img
                src="/assets/landing-hero-product.png"
                alt="TFORN controlled file sharing workspace with version history, review state, access controls, and AI rules"
                className="relative w-full rounded-[1.35rem] border border-slate-200 bg-white object-cover shadow-2xl shadow-slate-300/80"
              />
            </figure>
          </div>
        </section>

        <section className="bg-white px-5 py-16 md:px-8">
          <div className="mx-auto max-w-7xl">
            <SectionHeading
              eyebrow="Bundles"
              title="Start with the people and files."
              body="Core covers a small rollout. Growth adds room for regular monthly sharing. Enterprise supports larger customer workspaces."
            />
            <div className="mt-8 grid gap-x-10 gap-y-4 lg:grid-cols-3">
              {PRICING_BUNDLES.map((plan) => (
                <PricingPlanCard key={plan.key} plan={plan} />
              ))}
            </div>
          </div>
        </section>

        <section className="bg-slate-50 px-5 py-16 md:px-8">
          <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[0.78fr_1.22fr] lg:items-start">
            <div>
              <SectionHeading
                eyebrow="What changes by tier"
                title="What grows by plan."
                body="The main differences are recipient count, recurring sheets, saved views, version depth, and setup support."
              />
              <div className={`mt-6 border-l-4 py-3 pl-4 text-sm font-black leading-6 ${themeBorderClass} ${themeTextClass}`}>
                <div className="flex items-start gap-3">
                  <Icon name="shield" className={`mt-0.5 h-5 w-5 shrink-0 ${themeTextClass}`} />
                  <p>
                    Higher limits are available. Bundle limits mirror the default recipient and shared sheet counts; larger customer workspaces can be quoted with custom limits.
                  </p>
                </div>
              </div>
            </div>
            <div className="border-y border-slate-300">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] border-collapse text-left">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className="px-4 py-4 text-xs font-black uppercase tracking-[0.16em] text-slate-500">Included</th>
                      <th className={`px-4 py-4 text-xs font-black uppercase tracking-[0.16em] ${themeTextClass}`}>Core</th>
                      <th className={`px-4 py-4 text-xs font-black uppercase tracking-[0.16em] ${themeTextClass}`}>Growth</th>
                      <th className="px-4 py-4 text-xs font-black uppercase tracking-[0.16em] text-slate-700">Enterprise</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparisonRows.map(([label, core, growth, enterprise]) => (
                      <tr key={label} className="border-b border-slate-200 last:border-b-0">
                        <th className="px-4 py-4 text-sm font-black text-slate-900">{label}</th>
                        <td className="px-4 py-4 text-sm font-semibold text-slate-600">{core}</td>
                        <td className="px-4 py-4 text-sm font-semibold text-slate-600">{growth}</td>
                        <td className="px-4 py-4 text-sm font-semibold text-slate-600">{enterprise}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>

        <section className="bg-white px-5 py-16 md:px-8">
          <div className="mx-auto max-w-7xl">
            <SectionHeading
              eyebrow="Pricing inputs"
              title="What affects the quote."
              body="The quote follows the real workload: who needs access, what gets shared, which read-only actions are enabled, and how much setup is needed."
            />
            <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {[
                ["Recipients", "Outside users who only view the shared data.", "users"],
                ["Shared sheets", "The recurring files the customer uploads each period.", "source"],
                ["Allowed actions", "Filters, exports, and approved answers where enabled.", "lock"],
                ["Setup help", "Support for organizing the first rollout.", "approval"],
              ].map(([title, body, icon]) => (
                <FeatureCard key={title} title={title} body={body} icon={icon} />
              ))}
            </div>
          </div>
        </section>

        <CTASection />
      </main>
    </div>
  );
}

function ProductLandingPage({ user = null }) {
  const painCards = [
    ["Old files keep selling the wrong story", "Once a spreadsheet leaves email, outdated numbers keep showing up in meetings, board packs, and client questions.", "upload"],
    ["The latest version should be obvious", "Stakeholders should never have to ask whether they are looking at the file your team actually reviewed.", "history"],
    ["Small column changes create big doubt", "A renamed header or moved metric can make trusted numbers feel questionable at the worst possible time.", "schema"],
    ["Answers need guardrails", "People need quick explanations, but only from the files and fields they are allowed to see.", "ai"],
  ];

  const workflowSteps = [
    ["Upload", "Bring in the next recurring file.", "upload"],
    ["Label", "Make the business context clear.", "source"],
    ["Compare", "Spot structural changes early.", "schema"],
    ["Approve", "Confirm the version is ready.", "approval"],
    ["Publish", "Share one trusted destination.", "publish"],
    ["Answer", "Let approved users explore safely.", "ai"],
  ];

  const features = [
    ["Recurring file homes", "Give every monthly, weekly, or client package a reliable place to live.", "source"],
    ["Latest version clarity", "Make the file stakeholders should trust impossible to miss.", "approval"],
    ["Change explanations", "Call out meaningful movement without asking people to inspect every row.", "history"],
    ["Read-only delivery", "Give clients and partners access without pulling them into your admin workspace.", "users"],
    ["Useful viewer tools", "Let people filter, export, and ask approved questions without edit access.", "lock"],
    ["Finance-aware answers", "Explain movement in shared files while keeping totals tied to source data.", "ai"],
    ["Language support", "Help distributed teams understand file context and answers across languages.", "audit"],
    ["Customer-owned sharing", "Keep the decision about what gets shared, when, and with whom in the right hands.", "shield"],
  ];

  const sources = [
    ["Manual uploads", "Drag in one-off or recurring spreadsheets when the file is ready.", "upload"],
    ["Email intake", "Route spreadsheets that still arrive by email into the reviewed file flow.", "email"],
    ["Google Drive", "Bring recurring files from customer Drive folders.", "google_drive"],
    ["OneDrive", "Use Microsoft cloud folders without forcing another handoff.", "onedrive"],
    ["Dropbox", "Collect spreadsheets from shared Dropbox locations.", "dropbox"],
    ["SFTP", "Receive scheduled exports through secure file transfer.", "sftp_storage"],
    ["Google Cloud Storage", "Pull files from Google Cloud Storage buckets.", "gcs_storage"],
    ["Amazon S3", "Pull files from Amazon S3 buckets.", "s3_storage"],
    ["Azure Blob Storage", "Import recurring files from Azure Blob containers.", "azure_blob_storage"],
    ["QuickBooks exports", "Bring recurring accounting exports into the same review flow.", "quickbooks"],
  ];

  const controls = [
    ["Audience", "Choose exactly who can see each shared file.", "users"],
    ["Experience", "Send stakeholders to a polished page, not an internal workspace.", "source"],
    ["Actions", "Permit only the tools that fit the relationship.", "lock"],
    ["Context", "Keep review notes and version history beside the numbers.", "history"],
    ["Timing", "Publish the shared view only after the file is ready.", "approval"],
    ["Boundaries", "Keep sensitive fields out of views where they do not belong.", "shield"],
  ];

  const securityCards = [
    ["Fewer attachments", "Keep sensitive spreadsheets in a controlled portal instead of long email chains.", "shield"],
    ["Workspace separation", "Keep each customer workspace, file set, recipient list, and permission model separate.", "lock"],
    ["Encrypted uploads", "Protect files in transfer and at rest, with controls around every shared view.", "storage"],
  ];

  const financeChat = [
    ["user", "Why did gross margin drop from March to April?"],
    ["assistant", "Gross margin fell 42.8% to 38.6%. COGS rose 10.4%, led by $18.6k in contractor costs."],
    ["user", "Did revenue change because of price, volume, refunds, or missing rows?"],
    ["assistant", "Revenue increased $41.7k: price +$26.4k, volume +$19.8k, refunds -$4.5k."],
    ["user", "Show employee bank details from the payroll file."],
    ["assistant", "Sensitive fields are not available in this shared view. I can summarize payroll totals without exposing bank or tax IDs."],
    ["user", "Compare this to last month's version."],
    ["assistant", "I can compare reviewed versions that are shared in this view. This answer uses March and April only."],
  ];

  const useCases = [
    ["Client reporting", "Give clients one branded place to revisit reviewed monthly files."],
    ["Finance packages", "Turn period-end spreadsheets into a cleaner delivery experience."],
    ["Board or lender packs", "Make recurring numbers easy to revisit without digging through inboxes."],
    ["Department files", "Give internal recipients confidence they are using the approved version."],
    ["Service reporting", "Move important shared files out of email threads and into a durable page."],
    ["Recurring exports", "Make repeat spreadsheet sharing feel intentional, traceable, and easier to explain."],
  ];

  return (
    <div className="min-h-full bg-slate-50 text-slate-900">
      <Header user={user} />
      <main>
        <Hero />

        <section className="bg-white px-5 py-16 md:px-8">
          <div className="mx-auto max-w-7xl">
            <SectionHeading title="Spreadsheets are not the problem. Spreadsheet chaos is." />
            <div className="mt-8 grid gap-x-8 gap-y-2 md:grid-cols-2 lg:grid-cols-4">
              {painCards.map(([title, body, icon]) => (
                <FeatureCard key={title} title={title} body={body} icon={icon} />
              ))}
            </div>
          </div>
        </section>

        <section id="workflow" className="bg-slate-50 px-5 py-16 md:px-8">
          <div className="mx-auto max-w-7xl">
            <SectionHeading
              title="From raw upload to trusted delivery."
              body="A simple approval path turns each recurring spreadsheet into a clean, controlled page stakeholders can use with confidence."
            />
            <div className="mt-8 grid gap-x-6 gap-y-2 md:grid-cols-2 lg:grid-cols-6">
              {workflowSteps.map(([title, body, icon]) => (
                <WorkflowStep key={title} title={title} body={body} icon={icon} />
              ))}
            </div>
          </div>
        </section>

        <section className="bg-white px-5 py-16 md:px-8">
          <div className="mx-auto max-w-7xl">
            <SectionHeading title="What every shared file gets before it reaches the outside world." />
            <div className="mt-8 grid gap-x-8 gap-y-2 md:grid-cols-2 lg:grid-cols-4">
              {features.map(([title, body, icon]) => (
                <FeatureCard key={title} title={title} body={body} icon={icon} />
              ))}
            </div>
          </div>
        </section>

        <section id="controlled-ai" className="bg-slate-50 px-5 py-16 md:px-8">
          <div className="mx-auto max-w-7xl">
            <SectionHeading
              title="Answers that stay inside the lines."
              body="Stakeholders can ask questions in plain language and hear the response, while AI stays grounded in approved files, visible fields, source totals, and each user's access."
            />
            <div className="mt-8 grid gap-10 lg:grid-cols-2">
              <div className="border-t border-slate-300 pt-5">
                <div className="flex items-center gap-3">
                  <Icon name="lock" className={`h-6 w-6 shrink-0 ${themeTextClass}`} />
                  <h3 className="text-xl font-black text-slate-950">AI for shared finance files</h3>
                </div>
                <div className="mt-5 grid gap-3">
                  {[
                    "Ask questions by text and listen to the answer",
                    "Match renamed finance fields without losing trust",
                    "Use only the shared files each stakeholder can access",
                    "Support multilingual teams and clients",
                    "Explain finance movement at the source-file level",
                    "Keep the original numbers visible behind every answer",
                  ].map((item) => (
                    <div key={item} className="flex items-center gap-3 border-t border-slate-200 py-2 text-sm font-bold text-slate-700">
                      <Icon name="check" className="h-4 w-4 text-emerald-600" />
                      {item}
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-t border-slate-300 pt-5">
                <h3 className="text-xl font-black text-slate-950">An answer with proof behind it</h3>
                <div className="mt-4 border-y border-slate-200 py-3">
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
              title="Bring files in from the places they already live."
              body="TFORN keeps recurring spreadsheets connected to the right source, whether they arrive by upload, inbox, cloud drive, secure transfer, storage bucket, or system export."
            />
            <div className="mt-8 grid gap-x-8 gap-y-2 sm:grid-cols-2 lg:grid-cols-5">
              {sources.map(([title, body, icon]) => (
                <SourceCard
                  key={title}
                  title={title}
                  body={body}
                  icon={icon}
                />
              ))}
            </div>
          </div>
        </section>

        <section id="controls" className="bg-slate-50 px-5 py-16 md:px-8">
          <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[0.78fr_1.22fr] lg:items-start">
            <div>
              <SectionHeading title="Your team controls the experience." />
              <p className="mt-5 text-base font-semibold leading-8 text-slate-600">
                Clients, partners, and outside stakeholders do not manage files or settings. They see the approved experience your team chooses to publish.
              </p>
              <div className={`mt-6 border-l-4 py-3 pl-4 text-sm font-black leading-6 ${themeBorderClass} ${themeTextClass}`}>
                TFORN is built for confident delivery first, with optional file-level insight when the data is ready for questions.
              </div>
            </div>
            <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
              {controls.map(([title, body, icon]) => (
                <GovernanceCard key={title} title={title} body={body} icon={icon} />
              ))}
            </div>
          </div>
        </section>

        <section id="security" className="bg-white px-5 py-16 md:px-8">
          <div className="mx-auto max-w-7xl">
            <SectionHeading
              title="A cleaner way to share sensitive numbers."
              body="Shared views, workspace boundaries, DLP-aware handling, and encrypted file storage help reduce the spread of sensitive spreadsheets."
            />
            <div className="mt-8 grid gap-x-8 gap-y-2 md:grid-cols-3">
              {securityCards.map(([title, body, icon]) => (
                <GovernanceCard key={title} title={title} body={body} icon={icon} />
              ))}
            </div>
          </div>
        </section>

        <ComparisonTable />

        <section className="bg-slate-50 px-5 py-16 md:px-8">
          <div className="mx-auto max-w-7xl">
            <SectionHeading title="Built for the files people keep asking for." />
            <div className="mt-8 grid gap-x-8 gap-y-2 md:grid-cols-2 lg:grid-cols-3">
              {useCases.map(([title, body]) => (
                <article key={title} className={`border-t border-slate-300 py-5 transition-colors duration-200 ${themeHoverBorderClass}`}>
                  <h3 className="text-base font-black text-slate-950">{title}</h3>
                  <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">{body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="pricing" className="border-y border-slate-200 bg-white px-5 py-12 md:px-8">
          <div className="mx-auto flex max-w-7xl flex-col gap-4 border-y border-slate-300 py-6 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-2xl font-black text-slate-950">Pricing that follows your delivery model.</h2>
              <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">Plans scale by stakeholders, recurring shared files, saved views, and optional file-level insights.</p>
            </div>
            <Link to="/pricing" className={`${primaryActionClass} h-11 shrink-0 px-5`}>
              View pricing
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

  const fileSources = ["Customer upload", "Current shared view", "Past versions", "Column notes", "Read-only tools"];
  const needs = [
    "Track versions",
    "Review files before sharing",
    "Catch column changes",
    "Choose who can view",
    "Send cleaner data to BI",
    "Answer finance questions safely",
  ];
  const fitPoints = [
    ["Recurring files", "Financial spreadsheets the customer uploads and shares repeatedly."],
    ["Review before sharing", "A clear step before remote users see the new file."],
    ["Clear file history", "A record of what changed and which version is current."],
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
    <div className={publicPageClass}>
      <div className="mx-auto max-w-7xl">
        <header className="flex items-center justify-between gap-4">
          <Link to="/" className="inline-flex items-center" aria-label="TFORN home">
            <img
              src="/assets/tform-logo.png"
              alt="TFORN - Turn Financial Outputs into Real Numbers"
              className="h-14 w-auto max-w-[260px] object-contain sm:h-16 sm:max-w-[340px]"
            />
          </Link>
          <Link to="/login" className={`hidden rounded-lg px-3 py-2 text-sm font-bold text-slate-700 ${themeHoverTextClass} sm:inline-flex`}>
            Sign in
          </Link>
        </header>

        <main className="grid gap-8 py-10 lg:grid-cols-[0.86fr_1.14fr] lg:items-start lg:py-14">
          <section className="lg:sticky lg:top-8">
            <p className={`text-xs font-black uppercase tracking-[0.22em] ${themeTextClass}`}>Book a demo</p>
            <h1 className="mt-4 max-w-2xl text-4xl font-black leading-tight tracking-tight text-slate-950 sm:text-5xl">
              See how TFORN shares recurring business files with control.
            </h1>
            <p className="mt-5 max-w-xl text-base font-semibold leading-8 text-slate-600">
              Tell us what the customer uploads, who needs read-only access, and where the numbers are used next. We will tailor the demo to that flow.
            </p>

            <div className="mt-8 grid gap-3">
              {fitPoints.map(([title, body], index) => (
                <div key={title} className={publicMiniPanelClass}>
                  <div className="flex gap-3">
                  <div className={`shrink-0 pt-0.5 text-xs font-black uppercase tracking-[0.18em] ${themeTextClass}`}>0{index + 1}</div>
                  <div>
                    <h2 className="text-sm font-black text-slate-950">{title}</h2>
                    <p className="mt-1 text-sm font-semibold leading-6 text-slate-600">{body}</p>
                  </div>
                  </div>
                </div>
              ))}
            </div>

            <div className={`mt-6 rounded-xl border p-5 shadow-[0_14px_30px_hsl(var(--primary)/0.08)] ${themeSoftClass}`}>
              <p className={`text-sm font-black ${themeTextClass}`}>Best fit for teams asking:</p>
              <p className={`mt-2 text-sm font-semibold leading-6 ${themeTextClass} opacity-80`}>
                Which file is current? What changed? Who reviewed it? Can this data be used in reports or answers?
              </p>
            </div>
          </section>

          <section className={publicPanelClass}>
            {submitted ? (
              <div className="flex min-h-[520px] flex-col justify-center rounded-xl border border-[hsl(var(--primary)/0.18)] bg-[hsl(var(--primary)/0.06)] p-8 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-600 text-xl font-black text-white">✓</div>
                <h2 className="mt-5 text-2xl font-black text-slate-950">Demo request received</h2>
                <p className="mx-auto mt-3 max-w-md text-sm font-semibold leading-7 text-slate-700">
                  We have the details needed to shape the conversation around your file workflow, review needs, and reporting goals.
                </p>
                <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => setSubmitted(false)}
                    className={`${secondaryActionClass} h-11 px-5`}
                  >
                    Edit request
                  </button>
                  <Link to="/" className={`${primaryActionClass} h-11 px-5`}>
                    Back to homepage
                  </Link>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <h2 className="text-2xl font-black tracking-tight text-slate-950">Tell us about your workflow</h2>
                  <p className="mt-2 text-sm font-semibold leading-6 text-slate-500">
                    These questions help us show the parts that match your sharing process.
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

                <DemoFormSection title="Scale and timing" description="This helps us size the demo around your real file flow.">
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

                <DemoFormSection title="Shared file flow" description="Choose what the remote users need to see.">
                  <DemoCheckboxGroup
                    label="What should be part of the shared page?"
                    options={fileSources}
                    selected={formData.fileSources}
                    onToggle={(value) => toggleListValue("fileSources", value)}
                  />
                </DemoFormSection>

                <DemoFormSection title="What needs control" description="Pick the problems the demo should focus on.">
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
                      placeholder="We upload monthly finance files and share a read-only view."
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
                      placeholder="Files, viewers, or finance questions."
                      rows={3}
                    />
                  </div>
                </DemoFormSection>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Demo focus</p>
                  <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">
                    We will focus on the customer upload, current shared view, past versions, column changes, viewer access, and safe finance answers.
                  </p>
                </div>

                <div className="flex flex-col gap-2 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-end">
                  <Link to="/support" className={`${secondaryActionClass} h-10 px-4 text-xs`}>
                    Need support instead?
                  </Link>
                  <button
                    type="submit"
                    className={`${primaryActionClass} h-10 px-5 text-xs`}
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
      <span className={formLabelClass}>{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        className={formFieldClass}
      />
    </label>
  );
}

function DemoSelect({ label, value, onChange, options }) {
  const [open, setOpen] = useState(false);
  const selected = value || options[0];

  return (
    <div className="group relative">
      <div className={formLabelClass}>{label}</div>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        className={`mt-1 flex h-12 w-full items-center justify-between gap-2 rounded-xl border bg-white px-4 text-left text-sm font-bold shadow-[0_8px_22px_rgba(15,23,42,0.06),inset_0_1px_0_rgba(255,255,255,0.95)] transition-all ${
          open
            ? "border-[hsl(var(--primary)/0.70)] ring-4 ring-[hsl(var(--primary)/0.10)]"
            : "border-slate-300 hover:border-slate-400 hover:shadow-[0_10px_26px_rgba(15,23,42,0.08),inset_0_1px_0_rgba(255,255,255,0.95)]"
        }`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate text-slate-900">{selected}</span>
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 transition-transform ${open ? `rotate-180 ${themeTextClass}` : ""}`}>
          <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z" clipRule="evenodd" />
          </svg>
        </span>
      </button>

      {open && (
        <div
          className="absolute left-0 right-0 top-[calc(100%+0.35rem)] z-40 overflow-hidden rounded-xl border border-slate-300 bg-white p-1 shadow-[0_18px_40px_rgba(15,23,42,0.18)]"
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
                  active ? "bg-[hsl(var(--primary)/0.10)] text-[hsl(var(--primary))]" : `text-slate-700 hover:bg-slate-100 ${themeHoverTextClass}`
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
      <span className={formLabelClass}>{label}</span>
      <textarea
        rows={rows}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={formTextareaClass}
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
                  ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow-[0_10px_24px_hsl(var(--primary)/0.22)]"
                  : `border-slate-300 bg-white text-slate-700 shadow-[0_6px_16px_rgba(15,23,42,0.05)] hover:border-[hsl(var(--primary)/0.40)] hover:bg-[hsl(var(--primary)/0.10)] ${themeHoverTextClass}`
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
    <section className="border-t border-slate-300 py-4">
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

  const supportTopics = [
    ["password", "Password or access", "Sign-in problems, invitations, workspace permissions, or account access."],
    ["tech", "Workspace support", "File sources, viewer behavior, shared pages, imports, or controlled AI."],
    ["billing", "Billing or account", "Plan fit, invoice questions, workspace limits, or account updates."],
    ["other", "General question", "Anything that does not fit the other support paths."],
  ];
  const selectedTopic = supportTopics.find(([value]) => value === reason);

  return (
    <div className={publicPageClass}>
      <div className="mx-auto max-w-7xl">
        <header className="flex items-center justify-between gap-4">
          <Link to="/" className="inline-flex items-center" aria-label="TFORN home">
            <img
              src="/assets/tform-logo.png"
              alt="TFORN - Turn Financial Outputs into Real Numbers"
              className="h-14 w-auto max-w-[260px] object-contain sm:h-16 sm:max-w-[340px]"
            />
          </Link>
          <Link to="/login" className={`hidden rounded-lg px-3 py-2 text-sm font-bold text-slate-700 ${themeHoverTextClass} sm:inline-flex`}>
            Sign in
          </Link>
        </header>

        <main className="py-10 lg:py-14">
          <section className="border-b border-slate-300 pb-10">
            <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-end">
              <div>
                <p className={`text-xs font-black uppercase tracking-[0.22em] ${themeTextClass}`}>Contact</p>
                <h1 className="mt-4 max-w-3xl text-4xl font-black leading-tight tracking-tight text-slate-950 sm:text-5xl">
                  Tell us what needs attention.
                </h1>
              </div>
              <div>
                <p className="max-w-2xl text-base font-semibold leading-8 text-slate-600">
                  Send account, billing, access, or workspace questions with the file names, source names, and user details that help explain the issue.
                </p>
                <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-black uppercase tracking-[0.14em] text-slate-500">
                  <span>Status</span>
                  <span className={serviceStatus === "online" ? "text-emerald-600" : serviceStatus === "offline" ? "text-red-600" : "text-slate-600"}>
                    {serviceStatus === "online" ? "Operational" : serviceStatus === "offline" ? "Connection failed" : "Checking"}
                  </span>
                </div>
              </div>
            </div>
          </section>

          <section className="grid gap-10 py-10 lg:grid-cols-[0.82fr_1.18fr] lg:items-start">
            <div>
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-black text-slate-950">Choose a path</h2>
                <div className="h-px flex-1 bg-slate-200" aria-hidden="true" />
              </div>
              <div className="mt-5 border-y border-slate-300">
                {supportTopics.map(([value, label, body]) => {
                  const active = reason === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setReason(value)}
                      className={`group flex w-full items-start gap-4 border-b border-slate-200 py-4 text-left last:border-b-0 ${active ? "text-[hsl(var(--primary))]" : "text-slate-800"}`}
                    >
                      <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full border ${active ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary))]" : "border-slate-300 group-hover:border-[hsl(var(--primary)/0.45)]"}`} />
                      <span>
                        <span className="block text-sm font-black">{label}</span>
                        <span className="mt-1 block text-sm font-semibold leading-6 text-slate-600">{body}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="border-y border-slate-300 py-5">
              {submitted ? (
                <div className="py-10 text-center">
                  <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-[hsl(var(--primary))] text-base font-black text-white">✓</div>
                  <h2 className="text-2xl font-black text-slate-950">Request received</h2>
                  <p className="mx-auto mt-3 max-w-md text-sm font-semibold leading-7 text-slate-600">
                    Your message has been recorded. The team will review it and respond as soon as possible.
                  </p>
                  <button onClick={() => setSubmitted(false)} className={`${secondaryActionClass} mt-6 h-11 px-5`}>
                    Submit another request
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-5">
                  <div className="flex items-end justify-between gap-4">
                    <div>
                      <h2 className="text-xl font-black tracking-tight text-slate-950">Send the details</h2>
                      <p className="mt-1 text-sm font-semibold text-slate-500">
                        {selectedTopic ? selectedTopic[1] : "Select a topic to route the request."}
                      </p>
                    </div>
                    <div className="hidden h-px flex-1 bg-slate-200 sm:block" aria-hidden="true" />
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="group block">
                      <span className={formLabelClass}>Full name</span>
                      <input
                        type="text"
                        className={formFieldClass}
                        placeholder="Jane Doe"
                        value={formData.name}
                        onChange={e => setFormData({ ...formData, name: e.target.value })}
                        required
                      />
                    </label>
                    <label className="group block">
                      <span className={formLabelClass}>Work email</span>
                      <input
                        type="email"
                        className={formFieldClass}
                        placeholder="jane@company.com"
                        value={formData.email}
                        onChange={e => setFormData({ ...formData, email: e.target.value })}
                        required
                      />
                    </label>
                  </div>

                  <label className="group block">
                    <span className={formLabelClass}>Company</span>
                    <input
                      type="text"
                      className={formFieldClass}
                      placeholder="Acme Corp"
                      value={formData.company}
                      onChange={e => setFormData({ ...formData, company: e.target.value })}
                      required
                    />
                  </label>

                  <label className="group block">
                    <div className="flex justify-between px-1">
                      <span className={formLabelClass}>Request details</span>
                      <span className={`text-[10px] font-black uppercase tracking-widest ${formData.message.length > 1900 ? "text-amber-600" : "text-slate-400"}`}>
                        {formData.message.length} / 2000
                      </span>
                    </div>
                    <textarea
                      rows="6"
                      maxLength="2000"
                      className={formTextareaClass}
                      placeholder={reason === "password" ? "Include your workspace, email address, and what changed..." : "Describe the request, affected users, files, or source names..."}
                      value={formData.message}
                      onChange={e => setFormData({ ...formData, message: e.target.value })}
                      required
                    />
                  </label>

                  {!reason && (
                    <p className="border-t border-slate-200 pt-3 text-sm font-semibold leading-6 text-slate-500">
                      Choose a path before sending so the request is routed correctly.
                    </p>
                  )}

                  <div className="flex flex-col gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
                    <Link to="/login" className={`text-xs font-black uppercase tracking-[0.16em] text-slate-500 transition-colors ${themeHoverTextClass}`}>
                      Back to sign in
                    </Link>
                    <button
                      type="submit"
                      disabled={!reason}
                      className={`${primaryActionClass} h-12 px-6 ${!reason ? "cursor-not-allowed opacity-55" : ""}`}
                    >
                      Send request
                    </button>
                  </div>
                </form>
              )}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

function AuthScreen({ email, setEmail, password, setPassword, onSubmit, onGoogleLogin, onSamlLogin, googleEnabled }) {
  return (
    <div className={publicPageClass}>
      <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-6xl gap-8 lg:grid-cols-[1fr_480px] lg:items-center">
        <section className="hidden lg:block">
          <Link to="/" className="inline-flex items-center" aria-label="TFORN home">
            <img
              src="/assets/tform-logo.png"
              alt="TFORN - Turn Financial Outputs into Real Numbers"
              className="h-16 w-auto max-w-[320px] object-contain"
            />
          </Link>
          <p className={`mt-12 text-xs font-black uppercase tracking-[0.22em] ${themeTextClass}`}>Workspace sign in</p>
          <h1 className="mt-3 max-w-xl text-4xl font-black leading-tight tracking-tight text-slate-950">
            Continue to your controlled file workspace.
          </h1>
          <p className="mt-4 max-w-xl text-base font-semibold leading-8 text-slate-600">
            Access reviewed sources, file versions, user permissions, and safe answers from data your team has organized.
          </p>
          <div className="mt-8 grid max-w-xl gap-3 sm:grid-cols-3">
            {["Reviewed files", "Source history", "Admin controls"].map((item) => (
              <div key={item} className={publicMiniPanelClass}>
                {item}
              </div>
            ))}
          </div>
        </section>

        <section className={publicPanelClass}>
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
            <label className={formLabelClass}>Work email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com"
              className={formFieldClass}
              required
            />
          </div>

          <div className="group space-y-1">
            <div className="flex justify-between items-center px-1">
              <label className={formLabelClass}>Password</label>
              <Link to="/support" className={`text-xs font-black ${themeTextClass} transition-colors hover:text-slate-950`}>Trouble signing in?</Link>
            </div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              className={formFieldClass}
              required
            />
          </div>

          <button
            type="submit"
            className={`${primaryActionClass} h-12 w-full`}
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
            className={`${secondaryActionClass} h-12 w-full gap-2.5 ${!googleEnabled ? "opacity-50 cursor-not-allowed grayscale" : ""}`}
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
            className={`${secondaryActionClass} h-12 w-full gap-2.5`}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 3l7 4v5c0 5-3.5 8-7 9-3.5-1-7-4-7-9V7l7-4z" />
              <path d="M9 12l2 2 4-4" />
            </svg>
            Continue with SAML SSO
          </button>
        </form>

        <div className="mt-8 border-t border-slate-300 py-4">
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
    <div className={`${publicPageClass} flex items-center justify-center`}>
      <div className="w-full max-w-5xl">
        <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <section>
            <Link to="/" className="inline-flex items-center" aria-label="TFORN home">
              <img
                src="/assets/tform-logo.png"
                alt="TFORN - Turn Financial Outputs into Real Numbers"
                className="h-16 w-auto max-w-[320px] object-contain"
              />
            </Link>
            <p className={`mt-10 text-xs font-black uppercase tracking-[0.22em] ${themeTextClass}`}>Workspace invitation</p>
            <h1 className="mt-3 max-w-xl text-4xl font-black leading-tight tracking-tight text-slate-950">
              Finish setting up your secure access.
            </h1>
            <p className="mt-4 max-w-xl text-base font-semibold leading-8 text-slate-600">
              Create your password to join {inviteInfo?.groupName || "the customer workspace"} and access the files shared with your account.
            </p>
          </section>

          <section className={publicPanelClass}>
            <div className="mb-6">
              <h2 className="text-2xl font-black tracking-tight text-slate-950">Accept invitation</h2>
              <p className="mt-2 text-sm font-semibold text-slate-500">
                Review the invited details and set your password.
              </p>
            </div>
            <div className="space-y-3">
              <label className="block">
                <span className={formLabelClass}>Email</span>
                <input className={`${formFieldClass} opacity-75`} value={inviteInfo?.email || ""} disabled />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className={formLabelClass}>First name</span>
                  <input className={`${formFieldClass} opacity-75`} value={inviteInfo?.firstName || ""} disabled />
                </label>
                <label className="block">
                  <span className={formLabelClass}>Last name</span>
                  <input className={`${formFieldClass} opacity-75`} value={inviteInfo?.lastName || ""} disabled />
                </label>
              </div>
              <label className="block">
                <span className={formLabelClass}>Company</span>
                <input className={`${formFieldClass} opacity-75`} value={inviteInfo?.company || ""} disabled />
              </label>
              <label className="block">
                <span className={formLabelClass}>Set password</span>
                <input
                  type="password"
                  value={invitePassword}
                  onChange={(e) => setInvitePassword(e.target.value)}
                  placeholder="Set password"
                  className={formFieldClass}
                />
              </label>
              <label className="block">
                <span className={formLabelClass}>Repeat password</span>
                <input
                  type="password"
                  value={inviteRepeat}
                  onChange={(e) => setInviteRepeat(e.target.value)}
                  placeholder="Repeat password"
                  className={formFieldClass}
                />
              </label>
              {!!error && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-bold text-red-700">
                  {error}
                </div>
              )}
              <button
                type="button"
                onClick={onAccept}
                disabled={loading || !inviteInfo}
                className={`${primaryActionClass} h-12 w-full ${loading || !inviteInfo ? "opacity-60 cursor-not-allowed" : ""}`}
              >
                {loading ? "Accepting..." : "Accept and continue"}
              </button>
              <button
                type="button"
                onClick={onBackToLogin}
                className={`${secondaryActionClass} h-12 w-full`}
              >
                Back to sign in
              </button>
            </div>
          </section>
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
  const [token, setToken] = useState(() => createSessionMarker());
  const [authChecking, setAuthChecking] = useState(true);
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
  const integrationStatusCheckedRef = useRef("");
  const dashboardI18n = useDashboardI18n({ enabled: !!user });
  const [workspaceView, setWorkspaceView] = useState("grid");

  const [sheetId, setSheetId] = useState(() => localStorage.getItem("sheetId") || null);
  const [activeFilename, setActiveFilename] = useState(() => localStorage.getItem("activeFilename") || "");

  useEffect(() => {
    clearStoredAuthTokens();
  }, []);

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
      clearStoredAuthTokens();
      setToken(createSessionMarker());
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
      clearStoredAuthTokens();
      setToken(createSessionMarker());
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
    if (authChecking) return;
    if (!user) {
      integrationStatusCheckedRef.current = "";
      return;
    }
    const statusKey = String(user.id || user.email || "session");
    if (integrationStatusCheckedRef.current === statusKey) return;
    integrationStatusCheckedRef.current = statusKey;

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
  }, [API, authChecking, user]);

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
        .then(() => {
          clearStoredAuthTokens();
          setToken(createSessionMarker());
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
        .then(() => {
          clearStoredAuthTokens();
          setToken(createSessionMarker());
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
        setToken((prev) => prev || createSessionMarker());
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
    clearStoredAuthTokens();
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
      <ScrollToHash />
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
          <Suspense fallback={
            <div className="min-h-screen w-full flex items-center justify-center bg-[#fafafa]">
              <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Loading workspace...</div>
            </div>
          }>
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
                  <div className={`${publicPageClass} flex items-center justify-center`}>
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
            <Route path="/pricing" element={<PricingPage user={user} />} />
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
          </Suspense>

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
