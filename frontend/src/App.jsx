import React, { useState, useEffect, useRef, useMemo } from "react";
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from "react-router-dom";
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

/**
 * Footer - Small static footer for all pages.
 */
function Footer() {
  return (
    <footer className="bg-white/40 backdrop-blur-md border-t border-slate-200 py-1.5 px-8 flex flex-col md:flex-row items-center justify-between gap-4 text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] relative z-20">
      <div>© 2026 tfron · Advanced Data Governance</div>
      <div className="flex gap-8">
        <a href="#" className="hover:text-indigo-600 transition-colors">Privacy Policy</a>
        <a href="#" className="hover:text-indigo-600 transition-colors">Terms & Conditions</a>
        <Link to="/support" className="hover:text-indigo-600 transition-colors">Support Hub</Link>
      </div>
    </footer>
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
    <div className="absolute inset-0 w-full flex items-center justify-center p-4 sm:p-6 bg-[#fafafa] overflow-hidden">
      <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] bg-indigo-500/10 rounded-full blur-[140px] animate-pulse" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[60%] h-[60%] bg-cyan-500/10 rounded-full blur-[140px] animate-pulse" style={{ animationDelay: '2s' }} />

      <div className="glass rounded-xl p-5 md:p-7 w-full max-w-[500px] max-h-full relative z-10 border-white/50 shadow-[0_32px_80px_rgba(0,0,0,0.08)] animate-in fade-in zoom-in-95 duration-1000 flex flex-col overflow-y-auto">
        <div className="mb-5 text-center shrink-0">
          <div className="flex justify-center mb-4">
            <Link to="/">
              <img
                src="/assets/tform-logo.png"
                alt="tfron"
                className="h-10 w-auto object-contain drop-shadow-md hover:scale-105 transition-transform duration-500"
              />
            </Link>
          </div>
          <h2 className="text-lg font-black text-slate-900 tracking-tighter mb-1">Support Hub</h2>
          <p className="text-slate-500 text-[9px] font-semibold opacity-70 uppercase tracking-[0.18em]">Workspace Assistance</p>
        </div>

        {submitted ? (
          <div className="flex flex-col items-center justify-center bg-emerald-50 border border-emerald-100 rounded-xl p-5 text-center animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="w-9 h-9 bg-emerald-500 text-white rounded-full flex items-center justify-center text-base mb-3 shadow-lg shadow-emerald-200">✓</div>
            <h3 className="text-sm font-black text-emerald-900 mb-1">Request Received</h3>
            <p className="text-emerald-700/70 font-bold text-[11px] leading-relaxed max-w-xs">
              Our security team has categorized your inquiry. You will receive a response within 30 minutes.
            </p>
            <button onClick={() => setSubmitted(false)} className="mt-3 text-[8px] font-black uppercase tracking-widest text-emerald-600 hover:text-emerald-800 transition-colors">Submit Another Request</button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="space-y-1">
              <label className="text-[8.5px] font-black uppercase tracking-[0.22em] text-slate-400 ml-1">Reason for Contact</label>
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-md px-3 py-1.5 text-[11px] font-bold focus:outline-none focus:ring-4 focus:ring-indigo-500/5 focus:border-indigo-500/40 transition-all appearance-none cursor-pointer"
              >
                <option value="" disabled>Select a category…</option>
                <option value="password">Security: Password Reset</option>
                <option value="tech">Technical: Portal Support</option>
                <option value="billing">Administrative: Billing & Account</option>
                <option value="other">General Inquiry</option>
              </select>
            </div>

            {reason && (
              <form onSubmit={handleSubmit} className="flex flex-col gap-3 animate-in fade-in slide-in-from-top-2 duration-300">
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-[8.5px] font-black uppercase tracking-widest text-slate-400 ml-1">Full Name</label>
                      <input
                        type="text"
                        className="w-full bg-white/50 border border-slate-200 rounded-md px-3 py-1.5 text-[11px] font-bold focus:outline-none focus:ring-4 focus:ring-indigo-500/5"
                        placeholder="Jane Doe"
                        value={formData.name}
                        onChange={e => setFormData({ ...formData, name: e.target.value })}
                        required
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[8.5px] font-black uppercase tracking-widest text-slate-400 ml-1">Work Email</label>
                      <input
                        type="email"
                        className="w-full bg-white/50 border border-slate-200 rounded-md px-3 py-1.5 text-[11px] font-bold focus:outline-none focus:ring-4 focus:ring-indigo-500/5"
                        placeholder="jane@company.com"
                        value={formData.email}
                        onChange={e => setFormData({ ...formData, email: e.target.value })}
                        required
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[8.5px] font-black uppercase tracking-widest text-slate-400 ml-1">Company Name</label>
                    <input
                      type="text"
                      className="w-full bg-white/50 border border-slate-200 rounded-md px-3 py-1.5 text-[11px] font-bold focus:outline-none focus:ring-4 focus:ring-indigo-500/5"
                      placeholder="Acme Corp"
                      value={formData.company}
                      onChange={e => setFormData({ ...formData, company: e.target.value })}
                      required
                    />
                  </div>
                  <div className="space-y-1 relative">
                    <div className="flex justify-between items-center px-1">
                      <label className="text-[8.5px] font-black uppercase tracking-widest text-slate-400">Request Details</label>
                      <span className={`text-[8px] font-black uppercase tracking-widest ${formData.message.length > 1900 ? "text-amber-500" : "text-slate-400"}`}>
                        {formData.message.length} / 2000
                      </span>
                    </div>
                    <textarea
                      rows="4"
                      maxLength="2000"
                      className="w-full bg-white/50 border border-slate-200 rounded-md px-3 py-2 text-[11px] font-bold focus:outline-none focus:ring-4 focus:ring-indigo-500/5 resize-none shadow-inner"
                      placeholder={reason === 'password' ? "Include your department and any recent access issues..." : "Describe the issue or request..."}
                      value={formData.message}
                      onChange={e => setFormData({ ...formData, message: e.target.value })}
                      required
                    ></textarea>
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full bg-slate-900 hover:bg-black text-white rounded-md py-2 text-[10px] font-black uppercase tracking-[0.18em] shadow-xl shadow-slate-200 active:scale-[0.98] transition-all"
                >
                  Initiate Support Protocol
                </button>
              </form>
            )}

            {!reason && (
              <div className="bg-slate-50 border border-slate-100 rounded-lg p-4 text-center border-dashed">
                <p className="text-[9px] text-slate-400 font-bold uppercase tracking-[0.3em] leading-loose">
                  Select a category above to activate the secure communication terminal
                </p>
              </div>
            )}
          </div>
        )}

        <div className="mt-5 pt-3 border-t border-slate-100 flex flex-col gap-2 shrink-0">
          <div className="grid grid-cols-2 gap-2">
             <a href="#" className="bg-white border border-slate-100 rounded-md p-2 hover:border-indigo-200 hover:shadow-sm transition-all group text-center">
                <div className="text-[7.5px] font-black uppercase text-slate-400 mb-0.5 group-hover:text-indigo-500 tracking-widest">Documentation</div>
                <div className="text-[10px] font-bold text-slate-700">User Guides</div>
             </a>
             <a href="#" className="bg-white border border-slate-100 rounded-md p-2 hover:border-indigo-200 hover:shadow-sm transition-all group text-center">
                <div className="text-[7.5px] font-black uppercase text-slate-400 mb-0.5 group-hover:text-indigo-500 tracking-widest">Service Status</div>
                <div className={`text-[10px] font-bold ${serviceStatus === 'online' ? "text-emerald-500" : serviceStatus === 'offline' ? "text-red-500" : "text-slate-700"}`}>
                  {serviceStatus === 'online' ? "Operational" : serviceStatus === 'offline' ? "Connection Failed" : "Probing..."}
                </div>
             </a>
          </div>

          <Link to="/" className="text-[8.5px] font-black uppercase tracking-[0.18em] text-slate-400 hover:text-indigo-600 transition-colors flex items-center justify-center gap-2 mt-1">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
            Return to Secure Login
          </Link>
        </div>
      </div>
    </div>
  );
}

/**
 * AuthScreen - Modern, high-fidelity login interface.
 * Matches the "Premium" workspace aesthetic with glassmorphism and coordinated gradients.
 */
function AuthScreen({ email, setEmail, password, setPassword, onSubmit, onGoogleLogin, googleEnabled }) {
  return (
    <div className="min-h-screen w-full flex items-center justify-center p-6 relative bg-[#fafafa] overflow-x-hidden">
      {/* Decorative background blobs - more vibrant for Auth */}
      <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] bg-indigo-500/10 rounded-full blur-[140px] animate-pulse" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[60%] h-[60%] bg-cyan-500/10 rounded-full blur-[140px] animate-pulse" style={{ animationDelay: '2s' }} />

      <div className="glass rounded-xl p-5 md:p-7 w-full max-w-[500px] relative z-10 border-white/50 shadow-[0_32px_80px_rgba(0,0,0,0.08)] animate-in fade-in zoom-in-95 duration-1000">
        <div className="mb-6 text-center">
          <div className="flex justify-center mb-5">
            <img
              src="/assets/tform-logo.png"
              alt="tfron"
              className="h-12 w-auto object-contain drop-shadow-md hover:scale-105 transition-transform duration-500"
            />
          </div>
          <h2 className="text-xl font-[900] text-slate-900 tracking-tighter mb-1.5">Welcome Back</h2>
          <p className="text-slate-500 text-[10px] font-semibold opacity-70 uppercase tracking-wider">Log in to your enterprise data hub</p>
        </div>

        <form onSubmit={onSubmit} className="space-y-3">
          <div className="group space-y-1">
            <label className="text-[8.5px] font-black uppercase tracking-[0.2em] text-slate-400 ml-1 group-focus-within:text-indigo-500 transition-colors">Corporate Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com"
              className="w-full bg-white/40 border border-slate-200 rounded-md px-3 py-1.5 text-[11px] font-bold focus:outline-none focus:ring-[4px] focus:ring-indigo-500/5 focus:border-indigo-500/40 transition-all placeholder:text-slate-300"
              required
            />
          </div>

          <div className="group space-y-1">
            <div className="flex justify-between items-center px-1">
              <label className="text-[8.5px] font-black uppercase tracking-[0.2em] text-slate-400 group-focus-within:text-indigo-500 transition-colors">Access Key</label>
              <Link to="/support" className="text-[8px] font-black uppercase tracking-widest text-indigo-600 hover:text-indigo-800 transition-colors">Trouble Signing In?</Link>
            </div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              className="w-full bg-white/40 border border-slate-200 rounded-md px-3 py-1.5 text-[11px] font-bold focus:outline-none focus:ring-[4px] focus:ring-indigo-500/5 focus:border-indigo-500/40 transition-all placeholder:text-slate-300"
              required
            />
          </div>

          <button
            type="submit"
            className="w-full bg-slate-900 hover:bg-black text-white rounded-md py-1.5 text-[11px] font-[900] shadow-xl shadow-slate-200 hover:shadow-2xl active:scale-[0.98] transition-all duration-300 group"
          >
            <span className="flex items-center justify-center gap-2">
              Sign In to Workspace
              <svg className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
            </span>
          </button>

          <button
            type="button"
            onClick={onGoogleLogin}
            disabled={!googleEnabled}
            className={`w-full flex items-center justify-center gap-2.5 bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-800 rounded-md py-1.5 text-[10px] font-bold shadow-sm active:scale-[0.98] transition-all duration-300 ${!googleEnabled ? "opacity-50 cursor-not-allowed grayscale" : ""}`}
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
            Continue with Single Sign-On
          </button>
        </form>

        <div className="mt-14 flex flex-col items-center gap-2">
           <div className="flex gap-4">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em]">Operational Readiness Secure</span>
           </div>
           <p className="text-[9px] font-bold text-slate-300 uppercase tracking-widest text-center max-w-[280px] leading-relaxed">
             v0.3-rc · Encrypted Channel · Isolated Workspace
           </p>
        </div>
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
        <div className="space-y-3">
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
  const [metricsExposureEnabled, setMetricsExposureEnabled] = useState(true);
  const dashboardI18n = useDashboardI18n({ enabled: !!user });

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
             const actualCol = headers.find(h => h && String(h).trim() === String(col).trim());
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

  const applyContainsFilter = React.useCallback((col, val) => {
    if (col === "RESET_ALL") {
      setColumnFilters({});
      return;
    }
    if (!val) {
      setColumnFilters((prev) => {
        const next = { ...prev };
        delete next[col];
        return next;
      });
      return;
    }
    setColumnFilters((prev) => ({ ...prev, [col]: { type: "contains", value: val } }));
  }, []);

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
    if (!pivotOn || !pivotRowKey || !pivotValKey || !sortedData.length) {
      return { pivotRows: [], pivotHeaders: [], pivotSeriesKeys: [], pieData: [] };
    }

    const rowMap = {};
    const dynCols = new Set();
    const cKey = pivotColKey || "Total";

    sortedData.forEach((row) => {
      const rVal = row[pivotRowKey] ?? "(blank)";
      const cVal = pivotColKey ? (row[pivotColKey] ?? "(blank)") : "Total";

      let val = 0;
      if (pivotAgg === "count" || pivotAgg === "Count") {
        val = 1;
      } else {
        val = parseNum(row[pivotValKey]);
      }

      if (!rowMap[rVal]) rowMap[rVal] = {};
      if (!rowMap[rVal][cVal]) rowMap[rVal][cVal] = { sum: 0, count: 0 };

      rowMap[rVal][cVal].sum += val;
      rowMap[rVal][cVal].count += 1;
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

    const pData = [];
    result.slice(0, parseInt(pieTopN) || 10).forEach(r => {
      let sum = 0;
      sortedDynCols.forEach(c => sum += (r[c] || 0));
      pData.push({ name: r[pivotRowKey], value: sum });
    });

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
          setUploadProgressPercent(Math.max(0, Math.min(100, percent)));
        },
      });
      setUploadProgressPercent(100);
      if (res.data?.status === "queued") {
        alert("Upload queued for import processing.");
        refreshReportSources();
        return;
      }
      if (res.data?.status === "pending_approval") {
        alert("Uploaded and waiting for approval.");
        setUploadDisplayName("");
        setReportSourceName("");
        refreshReportSources();
        return;
      }
      alert("Uploaded!");
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
        // Refresh my files too
        if (token) {
          axios.get(`${API}/my-sheets`, { headers: { Authorization: `Bearer ${token}` } })
            .then(r => setMyFiles(r.data || []));
          refreshReportSources();
        }
      }
    } catch (e) {
      console.error(e);
      alert("Upload failed");
    } finally {
      setUploadProgressOpen(false);
      setUploadProgressLoaded(0);
      setUploadProgressTotal(0);
      setUploadProgressPercent(0);
    }
  };

  const handleGoogleDriveImport = async ({ fileId, name, mimeType, displayName, reportSourceId = "", reportSourceName: newReportSourceName = "", fileLabel = "" }) => {
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
        alert("Imported from Google Drive and waiting for approval.");
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

  const handleDropboxImport = async ({ pathLower, name, displayName, reportSourceId = "", reportSourceName: newReportSourceName = "", fileLabel = "" }) => {
    if (!pathLower || !String(displayName || "").trim()) return;
    if (!reportSourceId && !String(newReportSourceName || "").trim()) return;
    try {
      const res = await axios.post(
        `${API}/dropbox/import`,
        {
          pathLower,
          name,
          display_name: String(displayName).trim(),
          file_label: String(fileLabel || displayName).trim(),
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
        alert("Imported from Dropbox and waiting for approval.");
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

  const handleOneDriveImport = async ({ itemId, name, displayName, reportSourceId = "", reportSourceName: newReportSourceName = "", fileLabel = "" }) => {
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
        alert("Imported from OneDrive and waiting for approval.");
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
      setFolderFiles((prev) => prev.filter((f) => f.id !== id));
      refreshReportSources();

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
      alert("Failed to delete");
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
      setMetricsExposureEnabled(true);
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

  useEffect(() => {
    if (!token) {
      setMetricsExposureEnabled(true);
      return;
    }
    axios.get(`${API}/users/me/metrics-exposure`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => setMetricsExposureEnabled(res?.data?.enabled !== false))
      .catch(() => setMetricsExposureEnabled(true));
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
  const secondaryColumnCandidates = useMemo(() => {
    const fromHeaders = Array.isArray(secondaryHeaders) ? secondaryHeaders : [];
    const fromOverride = Array.isArray(saveViewConfigOverride?.splitContext?.secondaryAvailableColumns)
      ? saveViewConfigOverride.splitContext.secondaryAvailableColumns
      : [];
    const base = fromHeaders.length ? fromHeaders : fromOverride;
    return Array.from(new Set((base || []).map((c) => String(c || "").trim()).filter(Boolean)));
  }, [secondaryHeaders, saveViewConfigOverride]);

  useEffect(() => {
    if (!showColumnSelector) return;
    const presetPrimary = Array.isArray(saveViewConfigOverride?.visibleColumns) ? saveViewConfigOverride.visibleColumns : [];
    const presetSecondary = Array.isArray(saveViewConfigOverride?.splitContext?.secondaryVisibleColumns)
      ? saveViewConfigOverride.splitContext.secondaryVisibleColumns
      : [];
    if (presetPrimary.length > 0) setVisibleColumns(presetPrimary);
    if (presetSecondary.length > 0) setSecondaryVisibleColumns(presetSecondary);
    else if (secondaryColumnCandidates.length) setSecondaryVisibleColumns(secondaryColumnCandidates);
  }, [showColumnSelector, saveViewConfigOverride, secondaryColumnCandidates]);

  // Effect to load view config
  useEffect(() => {
    if (!selectedViewId) return;
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
    if (c.visibleColumns) setVisibleColumns(c.visibleColumns);

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

        {/* NEW HEADER */}
        {user && (
          <DashboardHeader
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
        )}

        {/* Note: Sub-navigation is now handled partly by DashboardHeader (Manage Users/Admin Panel) 
            and DashboardBody handles the Dashboard View. 
            However, if we are on /users, we need to be able to get back to /.
            DashboardHeader logo links to /.
        */}

        <main className="flex-1 min-h-0 relative flex flex-col overflow-y-auto">
          <Routes>
            <Route path="/" element={
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
                      googleEnabled={googleEnabled}
                    />
                  )
                ) : (
                  <DashboardHome
                    user={user}
                    myFiles={myFiles}
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
                    metricsExposureEnabled={metricsExposureEnabled}
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
            <Route path="/support" element={<SupportScreen />} />
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
                      googleEnabled={googleEnabled}
                    />
                  )
                ) : (
                  <>
                    <DashboardBody
                      user={user} token={token} API={API}
                      sheetId={sheetId} activeFilename={activeFilename}
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
                      loadData={loadData}
                      selectedViewId={selectedViewId} setSelectedViewId={setSelectedViewId}
                      views={views} setViews={setViews}
                      setPendingViewName={setPendingViewName}
                      setShowColumnSelector={setShowColumnSelector}
                      setVisibleColumns={setVisibleColumns}
                      setSaveViewConfigOverride={setSaveViewConfigOverride}
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
                      tabs={tabs}
                      activeTab={activeTab}
                      onTabChange={handleTabChange}
                      hasRequiredColumns={hasRequiredColumns}
                      appendCalculatedColumn={appendCalculatedColumn}
                      onInsightApplyFilter={applyContainsFilter}
                      onInsightOpenChart={applyChartConfig}
                      onInsightSaveView={saveInsightView}
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
                    {sheetId && (
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
              (user?.role === "admin" || user?.is_group_admin || user?.group_admin || user?.is_admin)
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
                <div className="text-sm font-black text-slate-900 tracking-tight">Uploading Spreadsheet</div>
                <div className="mt-4 h-2.5 rounded-full bg-slate-200 overflow-hidden">
                  <div
                    className="h-full bg-indigo-600 transition-[width] duration-200 ease-out"
                    style={{ width: `${Math.max(0, Math.min(100, uploadProgressPercent))}%` }}
                  />
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px] font-semibold text-slate-600">
                  <span>{formatBytes(uploadProgressLoaded)} / {formatBytes(uploadProgressTotal)}</span>
                  <span>{Math.max(0, Math.min(100, uploadProgressPercent))}%</span>
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
                  <h2 className="text-base font-semibold text-slate-900 tracking-tight">Configure View</h2>
                  <p className="text-slate-500 text-[11px] mt-0.5">Select visible columns and scope.</p>
                </div>
                <button 
                  onClick={() => setShowColumnSelector(false)}
                  className="w-8 h-8 rounded-md hover:bg-slate-100 flex items-center justify-center text-slate-400 transition-colors"
                >✕</button>
              </div>
              <div className="p-4 space-y-3 overflow-auto">
                <p className="text-[11px] text-slate-600">
                  Choose visible columns for this view. If none are selected, all columns remain visible.
                </p>

                <div className="rounded-md border border-slate-200 bg-slate-50 p-2.5">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-600 mb-2">Primary Visible Columns</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 max-h-44 overflow-auto pr-1 custom-scrollbar">
                    {headers.map((h) => (
                      <label key={h} className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-slate-200 bg-white hover:bg-slate-50 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={visibleColumns.includes(h)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setVisibleColumns([...visibleColumns, h]);
                            } else {
                              setVisibleColumns(visibleColumns.filter(col => col !== h));
                            }
                          }}
                          className="w-3 h-3 rounded"
                        />
                        <span className="text-[10px] font-semibold text-slate-700 truncate">{h}</span>
                      </label>
                    ))}
                  </div>
                </div>
                {(secondarySheetId || saveViewConfigOverride?.splitContext?.secondarySheetId) && secondaryColumnCandidates.length > 0 && (
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-2.5">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-600 mb-2">Secondary Visible Columns</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 max-h-40 overflow-auto pr-1 custom-scrollbar">
                      {secondaryColumnCandidates.map((h) => (
                        <label key={`sec-${h}`} className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-slate-200 bg-white hover:bg-slate-50 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={secondaryVisibleColumns.includes(h)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSecondaryVisibleColumns([...secondaryVisibleColumns, h]);
                              } else {
                                setSecondaryVisibleColumns(secondaryVisibleColumns.filter(col => col !== h));
                              }
                            }}
                            className="w-3 h-3 rounded"
                          />
                          <span className="text-[10px] font-semibold text-slate-700 truncate">{h}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-2.5">
                  <div className="space-y-1">
                    <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">View Name</label>
                    <input
                      type="text"
                      value={pendingViewName}
                      onChange={(e) => setPendingViewName(e.target.value)}
                      placeholder="e.g. Monthly Dashboard"
                      className="input-premium w-full py-1.5 text-[11px] font-semibold"
                      autoFocus
                    />
                  </div>

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
                </div>
              </div>
              <div className="flex gap-2 justify-end px-4 py-2.5 border-t border-slate-200 bg-slate-50">
                <button
                  className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[10px] font-semibold text-slate-700 hover:bg-slate-100"
                  onClick={() => {
                    setShowColumnSelector(false);
                    setPendingViewName("");
                    setViewLevel("revision");
                    setVisibleColumns([]);
                    setSecondaryVisibleColumns([]);
                    setSaveViewConfigOverride(null);
                  }}
                >
                  Cancel
                </button>
                <button
                  className="rounded-md bg-slate-900 px-3 py-1 text-[10px] font-semibold text-white hover:bg-slate-800"
                  onClick={async () => {
                    try {
                      const effectiveColumnFilters = saveViewConfigOverride?.columnFilters || columnFilters;
                      const effectiveVisibleColumns = saveViewConfigOverride?.visibleColumns || visibleColumns;
                      const serializableColumnFilters = {};
                      for (const key in effectiveColumnFilters) {
                        serializableColumnFilters[key] = Array.from(effectiveColumnFilters[key]);
                      }
                      const config = {
                        columnFilters: serializableColumnFilters,
                        sortConfig,
                        splitContext: {
                          secondarySheetId: saveViewConfigOverride?.splitContext?.secondarySheetId ?? (secondarySheetId || null),
                          secondaryTab: saveViewConfigOverride?.splitContext?.secondaryTab ?? (secondaryTab || null),
                          secondarySortConfig: saveViewConfigOverride?.splitContext?.secondarySortConfig ?? (secondarySortConfig || null),
                          secondaryVisibleColumns: secondaryVisibleColumns.length > 0
                            ? secondaryVisibleColumns
                            : (saveViewConfigOverride?.splitContext?.secondaryVisibleColumns || []),
                          secondaryColumnFilters: saveViewConfigOverride?.splitContext?.secondaryColumnFilters || {},
                        },
                        visibleColumns: effectiveVisibleColumns.length > 0 ? effectiveVisibleColumns : [],
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
                      await axios.post(
                        `${API}/views`,
                        { name: pendingViewName, sheetId, config, level: viewLevel },
                        { headers: { Authorization: `Bearer ${token}` } }
                      );
                      const res = await axios.get(`${API}/views/${sheetId}`, {
                        headers: { Authorization: `Bearer ${token}` },
                      });
                      setViews(res.data || []);
                      setShowColumnSelector(false);
                      setPendingViewName("");
                      setViewLevel("revision");
                      setVisibleColumns([]);
                      setSecondaryVisibleColumns([]);
                      setSaveViewConfigOverride(null);
                      alert("View saved successfully!");
                    } catch (e) {
                      console.error("Save view failed:", e);
                      alert("Failed to save view");
                    }
                  }}
                >
                  Save View
                </button>
              </div>
            </div>
          </div>
        )
      }

    </Router >
  );
}
