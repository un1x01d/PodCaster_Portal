import React, { useState, useEffect, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { BrowserRouter as Router, Routes, Route, Link } from "react-router-dom";
import axios from "axios";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line,
} from "recharts";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import UserManagement from "./UserManagement";
import ErrorBoundary from "./ErrorBoundary";
import "./index.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

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

const DATE_COL_HINTS = ["date", "uploaded", "created", "updated", "timestamp"];
const looksLikeDateColumn = (h = "") =>
  DATE_COL_HINTS.some((k) => h.toLowerCase().includes(k));

const renderMaybeDate = (columnName, value) => {
  if (value == null) return "";
  // Explicitly strip T00:00:00.000Z suffix if present
  if (typeof value === "string" && value.endsWith("T00:00:00.000Z")) {
    return value.substring(0, value.indexOf("T"));
  }
  // Standard ISO date check
  if (typeof value === "string" && ISO_FULL_RE.test(value)) return fmtDateOnly(value);

  if (looksLikeDateColumn(columnName)) {
    const d = fmtDateOnly(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  }

  // Force 2 decimal points for all numeric values
  // Only format if it's a valid number and not an empty string
  if (value !== "" && !isNaN(Number(value))) {
    return Number(value).toFixed(2);
  }

  return value;
};

/* ---------------- SearchableSelect ---------------- */
function SearchableSelect({
  options = [],
  value = "",
  onChange = () => { },
  placeholder = "Select…",
  className = "",
  disabled = false,
  buttonClassName = "border p-2 rounded min-w-[10rem] bg-white",
  panelWidth = 260,
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const btnRef = useRef(null);
  const panelRef = useRef(null);

  const selected = options.find((o) => String(o.value) === String(value));
  const filtered = q
    ? options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase()))
    : options;

  useEffect(() => {
    function onDocClick(e) {
      const b = btnRef.current;
      const p = panelRef.current;
      if (!b || !p) return;
      if (b.contains(e.target) || p.contains(e.target)) return;
      setOpen(false);
    }
    function onEsc(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, []);

  useEffect(() => {
    if (!open) setQ("");
  }, [open]);

  return (
    <div className={`relative inline-block ${className}`}>
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        className={`${buttonClassName} flex items-center justify-between gap-2 ${disabled ? "bg-gray-100 cursor-not-allowed text-gray-400" : ""
          }`}
        title={selected?.label || placeholder}
      >
        <span className="truncate">{selected?.label || placeholder}</span>
        <span className="opacity-70">▾</span>
      </button>

      {open && !disabled && (
        <div
          ref={panelRef}
          className="absolute z-50 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl p-2"
          style={{ width: panelWidth }}
        >
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Type to search…"
            className="w-full border border-gray-200 rounded-md px-2 py-1 mb-2 focus:outline-none focus:ring focus:ring-slate-100"
          />
          <div className="max-h-56 overflow-auto">
            {filtered.length ? (
              filtered.map((o) => (
                <div
                  key={String(o.value)}
                  className={`px-2 py-1 rounded-md cursor-pointer hover:bg-slate-50 ${String(o.value) === String(value) ? "bg-slate-100" : ""
                    }`}
                  title={o.label}
                  onClick={() => {
                    onChange({ target: { value: o.value } });
                    setOpen(false);
                  }}
                >
                  {o.label}
                </div>
              ))
            ) : (
              <div className="text-gray-500 text-sm px-2 py-1">No matches</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- Pretty Export Menu ---------------- */
function ExportMenu({ onCSV, onXLSX, onPDF }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);
  const panelRef = useRef(null);

  useEffect(() => {
    function onDocClick(e) {
      if (panelRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return;
      setOpen(false);
    }
    function onEsc(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, []);

  return (
    <div className="relative inline-block">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="bg-gradient-to-r from-cyan-600 to-teal-600 hover:from-cyan-500 hover:to-teal-500 text-white px-3 rounded-lg h-10 shadow flex items-center gap-2"
        title="Export options"
      >
        Export
        <span className="opacity-90">▾</span>
      </button>

      {open && (
        <div
          ref={panelRef}
          className="absolute z-50 mt-1 right-0 w-48 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden"
        >
          <div className="bg-gradient-to-r from-slate-50 to-white text-xs px-3 py-2 border-b border-slate-100">
            Download as…
          </div>
          <button
            className="w-full text-left px-3 py-2 hover:bg-slate-50 text-gray-900"
            onClick={() => { setOpen(false); onCSV?.(); }}
          >
            CSV (.csv)
          </button>
          <button
            className="w-full text-left px-3 py-2 hover:bg-slate-50 text-gray-900"
            onClick={() => { setOpen(false); onXLSX?.(); }}
          >
            Excel (.xlsx)
          </button>
          <button
            className="w-full text-left px-3 py-2 hover:bg-slate-50 text-gray-900 border-t border-gray-100"
            onClick={() => { setOpen(false); onPDF?.(); }}
          >
            PDF (.pdf)
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------------- Chart Menu ---------------- */
function ChartMenu({ pivotOn, setPivotOn, twoOn, setTwoOn, trendsOn, setTrendsOn }) {
  const [open, setOpen] = React.useState(false);
  const btnRef = React.useRef(null);
  const panelRef = React.useRef(null);

  React.useEffect(() => {
    const onDocClick = (e) => {
      if (!btnRef.current?.contains(e.target) && !panelRef.current?.contains(e.target)) {
        setOpen(false);
      }
    };
    const onEsc = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, []);

  return (
    <div className="relative inline-block">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="bg-gradient-to-r from-cyan-600 to-teal-600 hover:from-cyan-500 hover:to-teal-500 text-white px-3 rounded-lg h-10 shadow flex items-center gap-2"
        title="Chart options"
      >
        Charts
        <span className="opacity-90">▾</span>
      </button>

      {open && (
        <div
          ref={panelRef}
          className="absolute z-50 mt-1 right-0 w-56 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden"
        >
          <div className="bg-gradient-to-r from-slate-50 to-white text-xs px-3 py-2 border-b border-slate-100">
            Toggle Charts
          </div>
          <button
            className="w-full text-left px-3 py-2 hover:bg-slate-50 text-gray-900 flex items-center justify-between"
            onClick={() => { setPivotOn((p) => !p); }}
          >
            <span>Pivot</span>
            <span className={`text-xs font-semibold ${pivotOn ? "text-teal-600" : "text-gray-400"}`}>
              {pivotOn ? "ON" : "OFF"}
            </span>
          </button>
          <button
            className="w-full text-left px-3 py-2 hover:bg-slate-50 text-gray-900 flex items-center justify-between"
            onClick={() => { setTwoOn((p) => !p); }}
          >
            <span>Two-Condition</span>
            <span className={`text-xs font-semibold ${twoOn ? "text-teal-600" : "text-gray-400"}`}>
              {twoOn ? "ON" : "OFF"}
            </span>
          </button>
          <button
            className="w-full text-left px-3 py-2 hover:bg-slate-50 text-gray-900 border-t border-gray-100 flex items-center justify-between"
            onClick={() => { setTrendsOn((p) => !p); }}
          >
            <span>Trends</span>
            <span className={`text-xs font-semibold ${trendsOn ? "text-teal-600" : "text-gray-400"}`}>
              {trendsOn ? "ON" : "OFF"}
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------------- Modal ---------------- */
function Modal({ open, onClose, title, children, widthClass = "max-w-3xl" }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        className={`relative bg-white rounded-2xl shadow-2xl w-[95vw] ${widthClass} max-h-[85vh] overflow-auto border border-gray-100`}
      >
        <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-slate-50 to-white">
          <div className="font-bold text-gray-900">{title}</div>
          <button
            onClick={onClose}
            className="text-gray-700 hover:text-black rounded-md px-2 py-1 hover:bg-gray-100"
          >
            ✕
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

/* ---------------- Column Filter Menu ---------------- */
function ColumnFilterMenu({
  anchorMapRef,
  columnKey,
  column,
  allValues = [],
  appliedSelected = null,
  onApply,
  onClear,
  onClose,
  tableContainerRef,
}) {
  const panelRef = useRef(null);
  const [q, setQ] = useState("");
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const [measured, setMeasured] = useState(false);

  const values = Array.isArray(allValues) ? allValues : [];

  const [localSet, setLocalSet] = useState(() => {
    if (appliedSelected && appliedSelected.size > 0) {
      return new Set([...appliedSelected]);
    }
    return new Set(values.map((v) => String(v)));
  });

  const [allChecked, setAllChecked] = useState(
    !appliedSelected || appliedSelected.size === values.length
  );

  const shown = q
    ? values.filter((v) => String(v).toLowerCase().includes(q.toLowerCase()))
    : values;

  // Try to place the menu. Returns true if successful.
  const placeMenu = () => {
    const a = anchorMapRef?.current?.[columnKey];
    if (!a) return false;

    const r = a.getBoundingClientRect();
    // If rect is all zeros, it's likely not visible/laid out yet
    if (!r || (r.left === 0 && r.right === 0 && r.top === 0 && r.bottom === 0)) return false;

    const menuWidth = 256;
    const pad = 8;
    let left = r.left;

    // Keep within viewport
    if (left + menuWidth + pad > window.innerWidth) {
      left = Math.max(pad, window.innerWidth - menuWidth - pad);
    }
    const top = r.bottom + 6;

    setCoords({ top, left });
    setMeasured(true); // Make visible
    return true;
  };

  useLayoutEffect(() => {
    const scrollContainer = tableContainerRef.current;
    if (!scrollContainer) return;

    // Retry placement a few times to handle layout race conditions
    let attempts = 0;
    const maxAttempts = 10;

    // Initial try
    if (placeMenu()) return;

    const intervalId = setInterval(() => {
      attempts++;
      if (placeMenu() || attempts >= maxAttempts) {
        clearInterval(intervalId);
      }
    }, 50);

    return () => clearInterval(intervalId);
  }, [anchorMapRef, columnKey, tableContainerRef]);

  useEffect(() => {
    const onWin = () => placeMenu();
    window.addEventListener("resize", onWin);
    window.addEventListener("scroll", onWin, true);
    return () => {
      window.removeEventListener("resize", onWin);
      window.removeEventListener("scroll", onWin, true);
    };
  }, []);

  useEffect(() => {
    function onDocClick(e) {
      const p = panelRef.current;
      const a = anchorMapRef?.current?.[columnKey];
      if (!p || !a) return;
      if (p.contains(e.target) || a.contains(e.target)) return;
      onClose?.();
    }
    function onEsc(e) {
      if (e.key === "Escape") onClose?.();
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [anchorMapRef, columnKey, onClose]);

  useEffect(() => {
    setAllChecked(localSet.size === values.length);
  }, [localSet, values.length]);

  const toggleValue = (val) => {
    const sv = String(val);
    const next = new Set(localSet);
    if (next.has(sv)) next.delete(sv);
    else next.add(sv);
    setLocalSet(next);
  };

  const handleSelectAll = () => setLocalSet(new Set(values.map((v) => String(v))));
  const handleClearAll = () => setLocalSet(new Set());
  const handleApply = () => {
    if (localSet.size === values.length) onApply(column, null);
    else onApply(column, localSet);
    onClose?.();
  };

  return createPortal(
    <div
      ref={panelRef}
      className="fixed z-[9999] bg-white border border-gray-200 rounded-xl shadow-2xl p-3 w-64"
      style={{ top: coords.top, left: coords.left, visibility: measured ? "visible" : "hidden" }}
      role="dialog"
      aria-label={`Filter ${column}`}
    >
      <div className="mb-2 font-semibold text-sm text-gray-800">Filter: {column}</div>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search values…"
        className="w-full border border-gray-200 rounded-md px-2 py-1 mb-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring focus:ring-slate-100"
      />

      <div className="flex gap-2 mb-2">
        <button
          className="text-[11px] px-2 py-1 rounded-md bg-white border border-gray-200 hover:bg-gray-50 text-gray-800 focus:outline-none focus:ring focus:ring-slate-100"
          onClick={handleSelectAll}
          title="Select all values"
        >
          Select All
        </button>
        <button
          className="text-[11px] px-2 py-1 rounded-md bg-white border border-gray-200 hover:bg-gray-50 text-gray-800 focus:outline-none focus:ring focus:ring-slate-100"
          onClick={handleClearAll}
          title="Clear all selections"
        >
          Clear
        </button>
      </div>

      <div className="max-h-56 overflow-auto border border-gray-200 rounded-md">
        {shown.length ? (
          <>
            {shown.slice(0, 100).map((v, i) => {
              const sv = String(v);
              const checked = localSet.has(sv);
              return (
                <label
                  key={i}
                  className="flex items-center gap-2 px-2 py-1 text-sm hover:bg-slate-50 cursor-pointer text-gray-900"
                  title={sv}
                >
                  <input
                    type="checkbox"
                    className="cursor-pointer accent-slate-300"
                    checked={checked}
                    onChange={() => toggleValue(v)}
                  />
                  <span className="truncate">{sv || "—"}</span>
                </label>
              );
            })}
            {shown.length > 100 && (
              <div className="text-xs text-gray-400 p-2 text-center border-t border-gray-100 bg-gray-50 italic">
                Showing top 100 of {shown.length} values. Search to find others.
              </div>
            )}
          </>
        ) : (
          <div className="text-gray-500 text-xs p-2">No values</div>
        )}
      </div>

      <div className="mt-3 flex justify-between items-center">
        <div className="text-xs text-gray-600">
          {allChecked ? "All selected" : `${localSet.size} selected`}
        </div>
        <div className="flex gap-2">
          <button
            className="px-3 py-1 text-sm rounded-md bg-white border border-gray-200 hover:bg-gray-50 text-gray-800 focus:outline-none focus:ring focus:ring-slate-100"
            onClick={() => {
              onClear(column);
              onClose?.();
            }}
          >
            Clear Filter
          </button>
          <button
            className="px-3 py-1 text-sm rounded-md bg-slate-300 text-gray-900 hover:from-teal-500 hover:to-cyan-500 shadow focus:outline-none focus:ring focus:ring-slate-100"
            onClick={handleApply}
          >
            Apply
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/* ---------- Trend Tooltip ---------- */
function TrendTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="bg-white border border-sky-200 rounded-md px-3 py-2 text-sm shadow">
      <div className="font-semibold mb-1">{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span
            style={{
              display: "inline-block",
              width: 10,
              height: 10,
              background: p.color,
              borderRadius: 2,
            }}
          />
          <span>{p.name}: <b>{Number(p.value ?? 0).toFixed(2)}</b></span>
        </div>
      ))}
    </div>
  );
}

/* ---------------- App ---------------- */
export default function App() {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem("token") || "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [sheetId, setSheetId] = useState(null);
  const [activeFilename, setActiveFilename] = useState("");

  const [data, setData] = useState([]);
  const [headers, setHeaders] = useState([]);
  const [sortConfig, setSortConfig] = useState(null);

  // column filters
  const [columnFilters, setColumnFilters] = useState({});
  const [openFilterCol, setOpenFilterCol] = useState(null);
  const filterAnchorRefs = useRef({});
  const filterBtnRefs = useRef({});

  const [file, setFile] = useState(null);
  const [selectedFileName, setSelectedFileName] = useState("");

  // folders (admin upload only)
  const [folders, setFolders] = useState([]);
  const [selectedFolderId, setSelectedFolderId] = useState("");

  // My Files modal
  const [selectOpen, setSelectOpen] = useState(false);
  const [myFiles, setMyFiles] = useState([]);
  const [myFilesLoading, setMyFilesLoading] = useState(false);
  const [selectError, setSelectError] = useState(""); // <-- added

  // Views
  const [views, setViews] = useState([]);
  const [selectedViewId, setSelectedViewId] = useState("");
  // Removed isViewLocked - users can interact with all controls
  const [visibleColumns, setVisibleColumns] = useState([]); // Column visibility from view
  const [showColumnSelector, setShowColumnSelector] = useState(false); // Modal for selecting visible columns
  const [pendingViewName, setPendingViewName] = useState(""); // Store view name while selecting columns

  // Admin Folder Files modal
  const [folderFilesOpen, setFolderFilesOpen] = useState(false);
  const [folderFilesLoading, setFolderFilesLoading] = useState(false);
  const [folderFiles, setFolderFiles] = useState([]);
  const [folderFilesMeta, setFolderFilesMeta] = useState({ id: null, name: "" });

  // Two-condition summary
  const [condCol1, setCondCol1] = useState("");
  const [condCol2, setCondCol2] = useState("");
  const [valueCol, setValueCol] = useState("");
  const [twoOn, setTwoOn] = useState(false);

  // Pivot
  const [pivotOn, setPivotOn] = useState(false);
  const [pivotRowKey, setPivotRowKey] = useState("");
  const [pivotColKey, setPivotColKey] = useState("");
  const [pivotValKey, setPivotValKey] = useState("");
  const [pivotAgg, setPivotAgg] = useState("sum");

  const pivotChartRef = useRef(null);

  // Pie chart controls


  // Totals (kept in state for PDF, UI removed)
  const [totalsCol, setTotalsCol] = useState("");

  // Trends
  const [trendsOn, setTrendsOn] = useState(false);
  const [trendsDateKey, setTrendsDateKey] = useState("");
  const [trendsValueKey, setTrendsValueKey] = useState("");
  const [trendGranularity, setTrendGranularity] = useState("");
  const [yearsBack, setYearsBack] = useState("");

  const [guessedNumericKey, setGuessedNumericKey] = useState("");
  const tableContainerRef = useRef(null);

  const fmt2 = (n) =>
    Number(n ?? 0).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  /* -------- Auth -------- */
  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      const res = await axios.post(`${API}/login`, { email, password });
      localStorage.setItem("token", res.data.token);
      setToken(res.data.token);
      decodeToken(res.data.token);
    } catch {
      alert("❌ Invalid login");
    }
  };

  const decodeToken = (t) => {
    try {
      const payload = JSON.parse(atob(t.split(".")[1]));
      setUser(payload);
    } catch {
      setUser(null);
    }
  };

  useEffect(() => {
    if (token) decodeToken(token);
  }, [token]);

  /* -------- Init & Meta -------- */
  useEffect(() => {
    const init = async () => {
      try {
        // Admin: auto-load active sheet
        if (user.role === "admin") {
          const res = await axios.get(`${API}/sheets/active`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (res.data?.sheetId) {
            setSheetId(res.data.sheetId);
            setActiveFilename(res.data.filename || "");
            setTotalsCol(res.data.totals_column || "");
            await loadData(res.data.sheetId);
          } else {
            setSheetId(null);
            setActiveFilename("");
            setTotalsCol("");
            setData([]);
            setHeaders([]);
          }
        }
        // Non-admin: wait for user to select sheet (don't auto-load)
      } catch (e) {
        console.error("active sheet fetch failed", e);
      }
    };
    if (token && user) init();
  }, [token, user]);

  const fetchMeta = async () => {
    if (user?.role !== "admin") return;
    try {
      const fRes = await axios.get(`${API}/folders`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setFolders(fRes.data || []);
    } catch (e) {
      console.error("meta fetch failed", e);
    }
  };
  useEffect(() => {
    if (token && user) fetchMeta();
  }, [token, user]);

  useEffect(() => {
    const fetchViews = async () => {
      if (!sheetId) return;
      try {
        const res = await axios.get(`${API}/views/${sheetId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setViews(res.data || []);
      } catch (e) {
        console.error("views fetch failed", e);
      }
    };
    if (token && user) fetchViews();
  }, [sheetId, token, user]);

  /* -------- Data Load -------- */
  const loadData = async (sid = sheetId, preserveFilters = false) => {
    if (!sid) return null;
    try {
      const res = await axios.get(`${API}/data/${sid}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const rows = res.data || [];
      const hdrs = rows.length ? Object.keys(rows[0]) : [];
      setData(rows);
      setHeaders(hdrs);
      if (!preserveFilters) {
        setColumnFilters({});
        setOpenFilterCol(null);
      }

      if (rows.length) {
        const first = rows[0];
        const guessVal = Object.keys(first).find((k) => typeof first?.[k] === "number") || "";
        setGuessedNumericKey(guessVal || "");
      }

      return { rows, headers: hdrs };
    } catch (err) {
      console.error("❌ Load data failed:", err.message);
      return null;
    }
  };

  /* -------- Upload (admin) -------- */
  const handleUpload = async () => {
    if (!file) return;
    if (!selectedFolderId) {
      alert("Please select a folder before uploading.");
      return;
    }
    const formData = new FormData();
    formData.append("file", file);
    formData.append("folderId", String(selectedFolderId));
    try {
      const uploadRes = await axios.post(`${API}/upload`, formData, {
        headers: {
          "Content-Type": "multipart/form-data",
          Authorization: `Bearer ${token}`,
        },
      });

      setCondCol1("");
      setCondCol2("");
      setValueCol("");
      setSortConfig(null);
      setPivotOn(false);
      setTwoOn(false);
      setPivotRowKey("");
      setPivotColKey("");
      setPivotValKey("");
      setPivotAgg("sum");
      setColumnFilters({});
      setOpenFilterCol(null);

      const res = await axios.get(`${API}/sheets/active`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.data?.sheetId) {
        setSheetId(res.data.sheetId);
        setActiveFilename(res.data.filename || uploadRes.data?.filename || "");
        setTotalsCol(res.data.totals_column || "");
        await loadData(res.data.sheetId);
      }
      alert("✅ Upload complete");
    } catch (e) {
      console.error("upload failed", e);
      alert("❌ Upload failed");
    }
  };

  /* -------- My Files modal -------- */
  const openSelect = async () => {
    setSelectOpen(true);           // open immediately for feedback
    setMyFilesLoading(true);
    setSelectError("");
    try {
      const r = await axios.get(`${API}/my-files`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setMyFiles(Array.isArray(r.data) ? r.data : []);
    } catch (e) {
      console.error("my-files failed", e);
      const msg = e?.response?.status
        ? `Failed to load files (HTTP ${e.response.status}).`
        : "Failed to load files. Check your API URL, CORS, and token.";
      setSelectError(msg);
      setMyFiles([]);
    } finally {
      setMyFilesLoading(false);
    }
  };
  const refreshMyFiles = async () => {
    try {
      const r = await axios.get(`${API}/my-files`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setMyFiles(r.data || []);
    } catch (e) {
      console.error("refresh my-files failed", e);
    }
  };
  const loadStored = async (id) => {
    try {
      await axios.post(
        `${API}/load-sheet`,
        { sheetId: id },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const res = await axios.get(`${API}/sheets/active`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.data?.sheetId) {
        setSheetId(res.data.sheetId);
        setActiveFilename(res.data.filename || "");
        setTotalsCol(res.data.totals_column || "");

        // Auto-load view for non-admin users
        if (user.role !== "admin") {
          // Fetch views for this sheet
          const viewsRes = await axios.get(`${API}/views/${res.data.sheetId}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const userViews = viewsRes.data || [];

          // Auto-select first available view
          if (userViews.length > 0) {
            const firstView = userViews[0];
            setSelectedViewId(firstView.id);

            // Load data with preserveFilters=true so we can set filters after
            const loadedData = await loadData(res.data.sheetId, true);

            if (loadedData) {
              const { rows, headers: loadedHeaders } = loadedData;

              // Apply view configuration
              const newColumnFilters = {};
              if (firstView.config.columnFilters) {
                for (const key in firstView.config.columnFilters) {
                  newColumnFilters[key] = new Set(firstView.config.columnFilters[key]);
                }
              }
              setColumnFilters(newColumnFilters);
              setSortConfig(firstView.config.sortConfig || null);

              // Apply visible columns from view (empty = show all)
              if (firstView.config.visibleColumns && firstView.config.visibleColumns.length > 0) {
                setVisibleColumns(firstView.config.visibleColumns);
              } else {
                setVisibleColumns([]); // Empty = show all columns
              }

              // Always apply chart configs from the view
              // The chart rendering conditions will check column availability
              setPivotOn(firstView.config.pivotOn || false);
              setPivotRowKey(firstView.config.pivotRowKey || "");
              setPivotColKey(firstView.config.pivotColKey || "");
              setPivotValKey(firstView.config.pivotValKey || "");
              setPivotAgg(firstView.config.pivotAgg || "sum");

              setTwoOn(firstView.config.twoOn || false);
              setCondCol1(firstView.config.condCol1 || "");
              setCondCol2(firstView.config.condCol2 || "");
              setValueCol(firstView.config.valueCol || "");

              setTrendsOn(firstView.config.trendsOn || false);
              setTrendsDateKey(firstView.config.trendsDateKey || "");
              setTrendsValueKey(firstView.config.trendsValueKey || "");
              setTrendGranularity(firstView.config.trendGranularity || "");
              setYearsBack(firstView.config.yearsBack || "");
            }
          } else {
            // No views assigned, just load data normally
            await loadData(res.data.sheetId);
          }
        } else {
          // Admin user, load data normally
          await loadData(res.data.sheetId);
        }
      }
      setSelectOpen(false);
    } catch (e) {
      console.error("load-sheet failed:", e);
      alert("❌ Could not load the selected sheet");
    }
  };

  /* -------- Folder Files modal (admin) -------- */
  const openFolderFiles = async (fid, fname) => {
    setFolderFilesMeta({ id: fid, name: fname });
    setFolderFilesOpen(true);
    setFolderFilesLoading(true);
    try {
      const r = await axios.get(`${API}/folders/${fid}/files`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setFolderFiles(r.data || []);
    } catch (e) {
      console.error("folder files failed", e);
      setFolderFiles([]);
    } finally {
      setFolderFilesLoading(false);
    }
  };

  const deleteSheet = async (sid) => {
    if (!window.confirm("Delete this file permanently?")) return;
    try {
      await axios.delete(`${API}/sheets/${sid}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (folderFilesOpen) await openFolderFiles(folderFilesMeta.id, folderFilesMeta.name);
      if (selectOpen) await refreshMyFiles();
      if (String(sheetId) === String(sid)) {
        const res = await axios.get(`${API}/sheets/active`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.data) {
          setSheetId(null);
          setActiveFilename("");
          setTotalsCol("");
          setData([]);
          setHeaders([]);
          setColumnFilters({});
          setOpenFilterCol(null);
        } else {
          setSheetId(res.data.sheetId);
          setActiveFilename(res.data.filename || "");
          setTotalsCol(res.data.totals_column || "");
          await loadData(res.data.sheetId);
        }
      }
    } catch (e) {
      console.error("delete sheet failed", e);
      alert("❌ Could not delete file");
    }
  };

  /* -------- Filtering -------- */
  const filteredData = React.useMemo(() => {
    const activeCols = Object.keys(columnFilters).filter(
      (c) => columnFilters[c] && columnFilters[c] instanceof Set && columnFilters[c].size > 0
    );
    if (!activeCols.length) return data;

    return (data || []).filter((row) => {
      for (const col of activeCols) {
        const set = columnFilters[col];
        if (!set || set.size === 0) return false;
        const val = row[col];
        const sval = val == null || val === "" ? "" : String(val);
        if (!set.has(sval)) return false;
      }
      return true;
    });
  }, [data, columnFilters]);

  const uniqueValuesByColumn = React.useMemo(() => {
    const map = {};
    for (const h of headers) {
      const set = new Set();
      for (const r of filteredData) {
        const v = r[h];
        set.add(v == null || v === "" ? "" : String(v));
      }
      map[h] = Array.from(set.values()).sort((a, b) => String(a).localeCompare(String(b)));
    }
    return map;
  }, [headers, filteredData]);

  /* -------- Sorting -------- */
  const sortedData = React.useMemo(() => {
    let rows = [...(filteredData || [])];
    if (sortConfig) {
      const { key, direction } = sortConfig;
      rows.sort((a, b) => {
        const aVal = a[key] ?? "";
        const bVal = b[key] ?? "";
        if (aVal < bVal) return direction === "asc" ? -1 : 1;
        if (aVal > bVal) return direction === "asc" ? 1 : -1;
        return 0;
      });
    }
    return rows;
  }, [filteredData, sortConfig]);

  /* -------- Column Availability Check -------- */
  const hasRequiredColumns = React.useCallback((requiredCols) => {
    if (!requiredCols || requiredCols.length === 0) return true;
    return requiredCols.every(col => headers.includes(col));
  }, [headers]);

  /* -------- Display Headers (filtered by visibleColumns) -------- */
  const displayHeaders = React.useMemo(() => {
    if (visibleColumns.length > 0) {
      // Filter headers to only show visible columns
      return headers.filter(h => visibleColumns.includes(h));
    }
    return headers; // Show all if no visibleColumns set
  }, [headers, visibleColumns]);


  const requestSort = (key) => {
    let direction = "asc";
    if (sortConfig && sortConfig.key === key && sortConfig.direction === "asc") {
      direction = "desc";
    }
    setSortConfig({ key, direction });
  };

  /* -------- Two-Condition Summary -------- */
  const summaryData = React.useMemo(() => {
    if (!condCol1 || !condCol2 || !valueCol) return [];
    const map = {};
    (sortedData || []).forEach((row) => {
      const c1 = row[condCol1] || "N/A";
      const c2 = row[condCol2] || "N/A";
      const raw = String(row[valueCol] ?? "").replace(/[\$,]/g, "");
      const num = parseFloat(raw);
      if (isNaN(num)) return;
      const key = `${c1}__${c2}`;
      if (!map[key]) map[key] = { [condCol1]: c1, [condCol2]: c2, total: 0 };
      map[key].total += num;
    });
    return Object.values(map);
  }, [condCol1, condCol2, valueCol, sortedData]);

  /* -------- Pivot compute -------- */
  const { pivotHeaders, pivotRows } = React.useMemo(() => {
    if (!pivotRowKey || !pivotColKey) return { pivotHeaders: [], pivotRows: [] };

    const dynSet = new Set();
    (sortedData || []).forEach((r) => {
      const k = r[pivotColKey];
      if (k !== undefined && k !== null && k !== "") dynSet.add(String(k));
    });
    const dynHeaders = Array.from(dynSet).sort();

    const groups = new Map();
    (sortedData || []).forEach((r) => {
      const rowK = String(r[pivotRowKey] ?? "N/A");
      const colK = String(r[pivotColKey] ?? "N/A");
      let v = 1;
      if (pivotAgg === "sum") {
        const num = parseFloat(String(r[pivotValKey] ?? "").replace(/[\$,]/g, ""));
        v = Number.isFinite(num) ? num : 0;
      }
      if (!groups.has(rowK)) groups.set(rowK, {});
      const rowObj = groups.get(rowK);
      rowObj[colK] = (rowObj[colK] || 0) + v;
    });

    const outRows = Array.from(groups.entries())
      .map(([rk, cols]) => {
        const o = { [pivotRowKey]: rk };
        let total = 0;
        dynHeaders.forEach((h) => {
          const val = cols[h] || 0;
          o[h] = val;
          total += val;
        });
        o._Total = total;
        return o;
      })
      .sort((a, b) => String(a[pivotRowKey]).localeCompare(String(b[pivotRowKey])));

    const headers2 = [pivotRowKey, ...dynHeaders, "_Total"];
    return { pivotHeaders: headers2, pivotRows: outRows };
  }, [pivotRowKey, pivotColKey, pivotValKey, pivotAgg, sortedData]);

  const pivotSeriesKeys = React.useMemo(() => {
    if (!pivotHeaders?.length || !pivotRowKey) return [];
    return pivotHeaders.filter((h) => h !== pivotRowKey && h !== "_Total");
  }, [pivotHeaders, pivotRowKey]);

  /* -------- Totals Sum (for PDF header only) -------- */
  const totalsSum = React.useMemo(() => {
    if (!totalsCol) return null;
    let sum = 0;
    for (const r of sortedData) {
      const raw = String(r[totalsCol] ?? "").replace(/[\$,]/g, "");
      const num = parseFloat(raw);
      if (Number.isFinite(num)) sum += num;
    }
    return sum;
  }, [sortedData, totalsCol]);

  /* -------- Pie Data (based on Pivot) -------- */
  const pieData = React.useMemo(() => {
    if (!pivotRows.length) return [];

    // Default to "Rows" mode and Top 5 for a clean chart
    const arr = pivotRows
      .map((r) => ({
        name: String(r[pivotRowKey]),
        value: Number.isFinite(r._Total) ? r._Total : 0,
      }))
      .sort((a, b) => b.value - a.value);

    const topN = 5;
    const head = arr.slice(0, topN);
    const tail = arr.slice(topN);
    const other = tail.reduce((s, x) => s + x.value, 0);
    return other > 0 ? [...head, { name: "Other", value: other }] : head;
  }, [pivotRows, pivotRowKey]);

  const PIE_COLORS = [
    "#059669", "#10B981", "#34D399", "#6EE7B7", "#A7F3D0",
    "#16A34A", "#22C55E", "#4ADE80", "#86EFAC", "#BBF7D0",
    "#F59E0B", "#FCD34D", "#FDE68A", "#93C5FD", "#60A5FA",
  ];

  /* -------- Trends (multi-line, N years back) -------- */
  const trendsData = React.useMemo(() => {
    if (!trendsOn || !trendsDateKey) return [];

    const measureKey = trendsValueKey ? "sum" : "count";

    // Aggregate daily
    const daily = new Map(); // date -> { date, count, sum }
    for (const r of sortedData) {
      const raw = r[trendsDateKey];
      const d = fmtDateOnly(raw); // YYYY-MM-DD
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
      if (!daily.has(d)) daily.set(d, { date: d, count: 0, sum: 0 });
      const item = daily.get(d);
      if (trendsValueKey) {
        const v = parseFloat(String(r[trendsValueKey] ?? "").replace(/[\$,]/g, ""));
        if (Number.isFinite(v)) item.sum += v;
      } else {
        item.count += 1;
      }
    }

    const rows = Array.from(daily.values()).sort((a, b) => (a.date < b.date ? -1 : 1));
    if (!rows.length) return rows;

    // Month & year totals across data (for lookup)
    const monthTotals = new Map(); // 'YYYY-MM' -> {count,sum}
    const yearTotals = new Map(); // 'YYYY'    -> {count,sum}
    for (const r of rows) {
      const ym = r.date.slice(0, 7);
      const y = r.date.slice(0, 4);
      if (!monthTotals.has(ym)) monthTotals.set(ym, { count: 0, sum: 0 });
      if (!yearTotals.has(y)) yearTotals.set(y, { count: 0, sum: 0 });
      monthTotals.get(ym).count += r.count || 0;
      monthTotals.get(ym).sum += r.sum || 0;
      yearTotals.get(y).count += r.count || 0;
      yearTotals.get(y).sum += r.sum || 0;
    }

    const dailyMap = new Map(rows.map((r) => [r.date, r]));

    const maxBack = Math.min(5, Math.max(0, parseInt(yearsBack || "0", 10) || 0));
    for (const r of rows) {
      const y = r.date.slice(0, 4);
      const m = r.date.slice(5, 7);
      const d = r.date.slice(8, 10);
      const ym = `${y}-${m}`;

      if (trendGranularity === "daily") {
        for (let k = 1; k <= maxBack; k++) {
          const prevY = String(Number(y) - k).padStart(4, "0");
          const prevDate = `${prevY}-${m}-${d}`;
          const prev = dailyMap.get(prevDate);
          r[`prev_${k}y`] = prev ? (trendsValueKey ? prev.sum : prev.count) : 0;
        }
      } else if (trendGranularity === "month") {
        r.currentAgg = (monthTotals.get(ym)?.[measureKey]) || 0;
        for (let k = 1; k <= maxBack; k++) {
          const prevYm = `${String(Number(y) - k).padStart(4, "0")}-${m}`;
          r[`prev_${k}y`] = (monthTotals.get(prevYm)?.[measureKey]) || 0;
        }
      } else if (trendGranularity === "year") {
        r.currentAgg = (yearTotals.get(y)?.[measureKey]) || 0;
        for (let k = 1; k <= maxBack; k++) {
          const prevY = String(Number(y) - k).padStart(4, "0");
          r[`prev_${k}y`] = (yearTotals.get(prevY)?.[measureKey]) || 0;
        }
      } else {
        r.currentAgg = undefined;
      }
    }

    return rows;
  }, [sortedData, trendsOn, trendsDateKey, trendsValueKey, trendGranularity, yearsBack]);

  /* -------- Utilities for PDF sizing -------- */
  const measureFitColumns = (doc, cols, rows, opts = {}) => {
    const left = opts.left ?? 14;
    const right = opts.right ?? 14;
    const sampleRows = opts.sampleRows ?? 50;
    let fontSize = opts.fontSize ?? 10;
    const minFont = opts.minFont ?? 6;

    const innerWidth = () => doc.internal.pageSize.getWidth() - left - right;

    const measure = () => {
      doc.setFontSize(fontSize);
      const pad = doc.getTextWidth("  ");
      const maxStrings = cols.map((h) => (h ? String(h) : ""));
      const lim = Math.min(rows.length, sampleRows);
      for (let i = 0; i < lim; i++) {
        const r = rows[i];
        cols.forEach((h, idx) => {
          const s = r?.[h] == null ? "" : String(r[h]);
          if (s.length > (maxStrings[idx]?.length || 0)) maxStrings[idx] = s;
        });
      }
      let widths = maxStrings.map((s) => doc.getTextWidth(String(s || "")) + pad);
      const total = widths.reduce((a, b) => a + b, 0);
      return { widths, total, inner: innerWidth() };
    };

    let { widths, total, inner } = measure();

    while (total > inner && fontSize > minFont) {
      fontSize -= 1;
      ({ widths, total, inner } = measure());
    }

    if (total > inner) {
      const scale = inner / total;
      widths = widths.map((w) => w * scale);
    }

    const columnStyles = {};
    widths.forEach((w, i) => {
      columnStyles[i] = { cellWidth: Math.max(10, w) };
    });

    return { fontSize, columnStyles };
  };

  /* -------- Exports -------- */
  const exportCSV = () => {
    try {
      const fileName = "report.csv";
      const ws = XLSX.utils.json_to_sheet(sortedData || []);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Filtered Data");
      if (summaryData?.length > 0) {
        const ws2 = XLSX.utils.json_to_sheet(summaryData);
        XLSX.utils.book_append_sheet(wb, ws2, "Summary");
      }
      XLSX.writeFile(wb, fileName, { bookType: "csv" });
    } catch (err) {
      console.error("CSV Export failed:", err);
    }
  };

  const exportXLSX = () => {
    try {
      const fileName = "report.xlsx";
      const ws = XLSX.utils.json_to_sheet(sortedData || []);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Filtered Data");
      if (summaryData?.length > 0) {
        const ws2 = XLSX.utils.json_to_sheet(summaryData);
        XLSX.utils.book_append_sheet(wb, ws2, "Summary");
      }
      XLSX.writeFile(wb, fileName);
    } catch (err) {
      console.error("XLSX Export failed:", err);
    }
  };

  const exportPDF = () => {
    try {
      const cols = headers || [];
      const rows = sortedData || [];
      if (!cols.length) {
        alert("No data to export");
        return;
      }
      let doc = new jsPDF({ orientation: "p" });
      const margins = { left: 14, right: 14, top: 34, bottom: 12 };

      let fit = measureFitColumns(doc, cols, rows, {
        left: margins.left,
        right: margins.right,
        fontSize: 10,
        minFont: 6,
      });
      const inner = doc.internal.pageSize.getWidth() - margins.left - margins.right;
      let totalGuess = 0;
      Object.values(fit.columnStyles).forEach((s) => (totalGuess += s.cellWidth || 0));
      if (totalGuess > inner) {
        doc = new jsPDF({ orientation: "l" });
        fit = measureFitColumns(doc, cols, rows, {
          left: margins.left,
          right: margins.right,
          fontSize: 10,
          minFont: 6,
        });
      }

      const title = activeFilename ? `Report — ${activeFilename}` : "Report";
      const runAt = new Date().toLocaleString();

      doc.setFontSize(14);
      doc.text(title, margins.left, 16);
      doc.setFontSize(10);
      doc.text(`Generated: ${runAt}`, margins.left, 22);
      if (totalsCol && Number.isFinite(totalsSum)) {
        doc.text(`Σ ${totalsCol}: ${Number(totalsSum).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, margins.left, 28);
      }

      autoTable(doc, {
        startY: margins.top,
        margin: { left: margins.left, right: margins.right, top: margins.top, bottom: margins.bottom },
        head: [cols],
        body: rows.map((r) => cols.map((h) => (r[h] == null ? "" : r[h]))),
        styles: {
          fontSize: fit.fontSize,
          cellPadding: 1.2,
          overflow: "ellipsize",
          lineColor: [209, 250, 229],
          lineWidth: 0.1,
        },
        headStyles: {
          fillColor: [16, 185, 129],
          textColor: 255,
          halign: "left",
          valign: "middle",
          fontStyle: "bold",
        },
        bodyStyles: { halign: "left", valign: "middle" },
        columnStyles: fit.columnStyles,
        didParseCell: (data) => {
          if (data.section === "head") data.cell.styles.overflow = "ellipsize";
        },
        didDrawPage: (data) => {
          const pageStr = `Page ${doc.internal.getNumberOfPages()}`;
          doc.setFontSize(8);
          doc.text(pageStr, data.settings.margin.left, doc.internal.pageSize.getHeight() - 5);
        },
      });

      doc.save("report.pdf");
    } catch (err) {
      console.error("PDF Export failed:", err);
      alert("❌ PDF Export failed, check console");
    }
  };

  const exportPivotPDF = async () => {
    try {
      if (!pivotRows.length || !pivotHeaders.length) {
        alert("Nothing to export — set Pivot options first.");
        return;
      }

      let chartPngUrl = null;
      let chartW = 0;
      let chartH = 0;
      if (pivotChartRef.current) {
        const svgEl = pivotChartRef.current.querySelector("svg");
        if (svgEl) {
          const xml = new XMLSerializer().serializeToString(svgEl);
          const svgUrl = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(xml)));

          const img = await new Promise((resolve) => {
            const im = new Image();
            im.onload = () => resolve(im);
            im.onerror = () => resolve(null);
            im.src = svgUrl;
          });

          if (img) {
            chartW = img.width || 1200;
            chartH = img.height || 600;
            const canvas = document.createElement("canvas");
            canvas.width = chartW;
            canvas.height = chartH;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0);
            chartPngUrl = canvas.toDataURL("image/png");
          }
        }
      }

      let doc = new jsPDF({ orientation: "l" });
      const margins = { left: 14, right: 14, top: 16, bottom: 12 };

      const fit = measureFitColumns(doc, pivotHeaders, pivotRows, {
        left: margins.left,
        right: margins.right,
        fontSize: 9,
        minFont: 6,
        sampleRows: 80,
      });

      let cursorY = margins.top;
      if (chartPngUrl) {
        const pageW = doc.internal.pageSize.getWidth() - margins.left - margins.right;
        const aspect = chartW / chartH;
        let drawW = pageW;
        let drawH = drawW / aspect;
        const maxChartH = 90;
        if (drawH > maxChartH) {
          drawH = maxChartH;
          drawW = drawH * aspect;
        }
        const x = margins.left + (pageW - drawW) / 2;
        doc.addImage(chartPngUrl, "PNG", x, cursorY, drawW, drawH);
        cursorY += drawH + 6;
      } else {
        doc.setFontSize(14);
        doc.text("Pivot Report", margins.left, cursorY);
        cursorY += 8;
      }

      autoTable(doc, {
        startY: cursorY,
        margin: { left: margins.left, right: margins.right, top: margins.top, bottom: margins.bottom },
        head: [pivotHeaders],
        body: pivotRows.map((r) => pivotHeaders.map((h) => (r[h] == null ? "" : r[h]))),
        styles: {
          fontSize: fit.fontSize,
          cellPadding: 1.1,
          overflow: "ellipsize",
          lineColor: [209, 250, 229],
          lineWidth: 0.1,
        },
        headStyles: {
          fillColor: [5, 150, 105],
          textColor: 255,
          halign: "left",
          valign: "middle",
          fontStyle: "bold",
        },
        bodyStyles: { halign: "left", valign: "middle" },
        columnStyles: fit.columnStyles,
        didParseCell: (data) => {
          if (data.section === "head") data.cell.styles.overflow = "ellipsize";
        },
        didDrawPage: (data) => {
          const pageStr = `Page ${doc.internal.getNumberOfPages()}`;
          doc.setFontSize(8);
          doc.text(pageStr, data.settings.margin.left, doc.internal.pageSize.getHeight() - 5);
        },
      });

      doc.save("pivot.pdf");
    } catch (err) {
      console.error("Pivot PDF export failed:", err);
      alert("❌ Pivot PDF export failed, check console");
    }
  };

  /* -------- Resets -------- */
  const resetSummary = () => {
    setCondCol1("");
    setCondCol2("");
    setValueCol("");
  };
  const resetPivot = () => {
    setPivotRowKey("");
    setPivotColKey("");
    setPivotValKey("");
    setPivotAgg("sum");
    setPieMode("rows");
    setPieTopN("10");
  };

  /* -------- Options -------- */
  const headerOptions = headers.map((h) => ({ value: h, label: h }));
  const folderOptions = [{ value: "", label: "Folder (required)…" }].concat(
    folders.map((f) => ({ value: String(f.id), label: f.name }))
  );

  const saveTotalsColumn = async (col) => {
    if (!sheetId) return;
    try {
      await axios.patch(
        `${API}/sheets/${sheetId}`,
        { totals_column: col || null },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setTotalsCol(col || "");
    } catch (e) {
      console.error("save totals_column failed", e);
      alert("❌ Could not save totals column");
    }
  };

  /* -------- Login Screen -------- */
  if (!token || !user) {
    return (
      <div className="w-full min-h-0 flex items-center justify-center bg-gradient-to-br from-slate-50 to-white py-16">
        <form className="bg-white/95 backdrop-blur shadow-xl rounded-2xl p-8 w-96 border border-slate-100" onSubmit={handleLogin}>
          <h2 className="text-2xl font-bold mb-6 text-center text-gray-900">🔐 Universal Analytics</h2>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border border-slate-200 p-3 mb-3 rounded-md focus:outline-none focus:ring focus:ring-slate-100"
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full border border-slate-200 p-3 mb-6 rounded-md focus:outline-none focus:ring focus:ring-slate-100"
          />
          <button type="submit" className="w-full bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-500 hover:to-cyan-500 text-white py-2 rounded-lg font-semibold h-11 shadow">
            Login
          </button>
        </form>
      </div>
    );
  }

  /* -------- Dashboard Body -------- */
  const DashboardBody = () => {
    // Non-admin users: show welcome screen until sheet is selected
    if (user.role !== "admin" && !sheetId) {
      return (
        <div className="w-full min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-white">
          <div className="bg-white/95 backdrop-blur shadow-xl rounded-2xl p-8 w-96 border border-slate-100 text-center">
            <h2 className="text-2xl font-bold mb-4 text-gray-900">📊 Welcome</h2>
            <p className="text-gray-600 mb-6">Please select a sheet to get started</p>
            <button
              onClick={openSelect}
              className="w-full bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-500 hover:to-cyan-500 text-white py-3 rounded-lg font-semibold shadow"
            >
              Select Sheet
            </button>
          </div>
        </div>
      );
    }

    // Admin or sheet selected: show normal dashboard
    return (
      <div className="w-full bg-gradient-to-b from-white to-slate-50/40">
        {/* Global Controls Bar */}
        <div className="flex flex-wrap gap-3 p-4 bg-white/90 backdrop-blur shadow-sm border-b border-slate-100 items-center relative z-30">
          {/* Upload (admin) */}
          {user.role === "admin" && (
            <>
              <label className="flex items-center gap-3 border border-slate-200 rounded-lg p-2 bg-white h-10">
                <input
                  type="file"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    setFile(f || null);
                    setSelectedFileName(f?.name || "");
                  }}
                  className="border border-slate-200 p-1 rounded-md"
                />
                <span className="text-sm text-gray-700">
                  {selectedFileName || activeFilename || "No file selected"}
                </span>
              </label>

              {/* Folder selection (required) */}
              <SearchableSelect
                options={folderOptions}
                value={selectedFolderId}
                onChange={(e) => setSelectedFolderId(e.target.value)}
                placeholder="Folder (required)…"
                className="ml-1"
                buttonClassName="border border-slate-200 p-2 rounded-lg min-w-[14rem] bg-white h-10"
              />

              <button
                onClick={handleUpload}
                disabled={!file || !selectedFolderId}
                className={`${!file || !selectedFolderId
                  ? "bg-gradient-to-r from-gray-200 to-gray-300 cursor-not-allowed text-gray-600"
                  : "bg-gradient-to-r from-cyan-600 to-teal-600 hover:from-cyan-500 hover:to-teal-500 text-white shadow"
                  } px-4 rounded-lg h-10`}
                title={!file ? "Choose a file" : !selectedFolderId ? "Select a folder" : "Upload & Load"}
              >
                Upload & Load
              </button>
            </>
          )}

          <button
            onClick={() => loadData(sheetId, user.role !== "admin" && selectedViewId)}
            className="bg-gradient-to-r from-cyan-600 to-teal-600 hover:from-cyan-500 hover:to-teal-500 text-white px-3 rounded-lg h-10 shadow"
          >
            Refresh
          </button>

          {user.role === "admin" && (
            <SearchableSelect
              options={[{ value: "", label: "Select a view…" }].concat(
                views.map((v) => ({ value: v.id, label: v.name }))
              )}
              value={selectedViewId}
              onChange={(e) => {
                const viewId = e.target.value;
                setSelectedViewId(viewId);
                if (viewId) {
                  const view = views.find((v) => v.id === viewId);
                  if (view) {
                    const newColumnFilters = {};
                    if (view.config.columnFilters) {
                      for (const key in view.config.columnFilters) {
                        newColumnFilters[key] = new Set(view.config.columnFilters[key]);
                      }
                    }
                    setColumnFilters(newColumnFilters);
                    setSortConfig(view.config.sortConfig || null);

                    // Validate column availability for chart configs
                    const hasPivotCols = [
                      view.config.pivotRowKey,
                      view.config.pivotColKey,
                      view.config.pivotValKey
                    ].filter(Boolean).every(col => headers.includes(col));

                    const hasTwoCols = [
                      view.config.condCol1,
                      view.config.condCol2,
                      view.config.valueCol
                    ].filter(Boolean).every(col => headers.includes(col));

                    const hasTrendsCols = [
                      view.config.trendsDateKey,
                      view.config.trendsValueKey
                    ].filter(Boolean).every(col => headers.includes(col));

                    // Collect missing columns for warning
                    const allRequiredCols = [
                      view.config.pivotRowKey,
                      view.config.pivotColKey,
                      view.config.pivotValKey,
                      view.config.condCol1,
                      view.config.condCol2,
                      view.config.valueCol,
                      view.config.trendsDateKey,
                      view.config.trendsValueKey
                    ].filter(Boolean);
                    const missingCols = allRequiredCols.filter(col => !headers.includes(col));

                    if (missingCols.length > 0 && user?.role !== "admin") {
                      console.warn(
                        `⚠️ View "${view.name}" references columns you don't have access to:`,
                        missingCols.join(", ")
                      );
                    }

                    // Apply pivot config only if all required columns are available
                    if (hasPivotCols) {
                      setPivotOn(view.config.pivotOn || false);
                      setPivotRowKey(view.config.pivotRowKey || "");
                      setPivotColKey(view.config.pivotColKey || "");
                      setPivotValKey(view.config.pivotValKey || "");
                      setPivotAgg(view.config.pivotAgg || "sum");
                    } else {
                      setPivotOn(false);
                      setPivotRowKey("");
                      setPivotColKey("");
                      setPivotValKey("");
                      setPivotAgg("sum");
                    }

                    // Apply two-condition config only if all required columns are available
                    if (hasTwoCols) {
                      setTwoOn(view.config.twoOn || false);
                      setCondCol1(view.config.condCol1 || "");
                      setCondCol2(view.config.condCol2 || "");
                      setValueCol(view.config.valueCol || "");
                    } else {
                      setTwoOn(false);
                      setCondCol1("");
                      setCondCol2("");
                      setValueCol("");
                    }

                    // Apply trends config only if all required columns are available
                    if (hasTrendsCols) {
                      setTrendsOn(view.config.trendsOn || false);
                      setTrendsDateKey(view.config.trendsDateKey || "");
                      setTrendsValueKey(view.config.trendsValueKey || "");
                      setTrendGranularity(view.config.trendGranularity || "");
                      setYearsBack(view.config.yearsBack || "");
                    } else {
                      setTrendsOn(false);
                      setTrendsDateKey("");
                      setTrendsValueKey("");
                      setTrendGranularity("");
                      setYearsBack("");
                    }
                  }
                }
              }}
              placeholder="Select a view…"
              className="ml-1"
              buttonClassName="border border-slate-200 p-2 rounded-lg min-w-[14rem] bg-white h-10"
            />
          )}

          {user.role === "admin" && (
            <button
              onClick={() => {
                const name = prompt("Enter a name for this view:");
                if (name) {
                  setPendingViewName(name);
                  setShowColumnSelector(true);
                }
              }}
              className="bg-gradient-to-r from-cyan-600 to-teal-600 hover:from-cyan-500 hover:to-teal-500 text-white px-3 rounded-lg h-10 shadow"
            >
              Save View
            </button>
          )}

          {user.role === "admin" && selectedViewId && (
            <div className="flex gap-2">
              <button
                onClick={async () => {
                  const name = prompt("Enter a new name for the duplicated view:");
                  if (name) {
                    await axios.post(
                      `${API}/views/${selectedViewId}/duplicate`,
                      { name },
                      { headers: { Authorization: `Bearer ${token}` } }
                    );
                    const res = await axios.get(`${API}/views/${sheetId}`, {
                      headers: { Authorization: `Bearer ${token}` },
                    });
                    setViews(res.data || []);
                  }
                }}
                className="bg-gradient-to-r from-cyan-600 to-teal-600 hover:from-cyan-500 hover:to-teal-500 text-white px-3 rounded-lg h-10 shadow"
              >
                Duplicate View
              </button>
              <button
                onClick={async () => {
                  if (confirm("Are you sure you want to delete this view?")) {
                    await axios.delete(`${API}/views/${selectedViewId}`, {
                      headers: { Authorization: `Bearer ${token}` },
                    });
                    setSelectedViewId("");
                    const res = await axios.get(`${API}/views/${sheetId}`, {
                      headers: { Authorization: `Bearer ${token}` },
                    });
                    setViews(res.data || []);
                  }
                }}
                className="bg-gradient-to-r from-red-600 to-red-500 hover:from-red-600 hover:to-red-600 text-white px-3 rounded-lg h-10 shadow"
              >
                Delete View
              </button>
            </div>
          )}

          {/* Export dropdown + Charts dropdown */}
          <div className="flex gap-3 ml-0 md:ml-6 items-center">
            <ExportMenu onCSV={exportCSV} onXLSX={exportXLSX} onPDF={exportPDF} />
            <ChartMenu
              pivotOn={pivotOn}
              setPivotOn={setPivotOn}
              twoOn={twoOn}
              setTwoOn={setTwoOn}
              trendsOn={trendsOn}
              setTrendsOn={setTrendsOn}
            />
          </div>
        </div>

        {/* Pivot Controls */}
        {pivotOn && (
          <div className="p-4 bg-slate-50 border-y border-slate-200/70">
            <div className="flex flex-wrap items-end gap-3">
              <SearchableSelect
                options={[{ value: "", label: "Row key…" }, ...displayHeaders.map((h) => ({ value: h, label: h }))]}
                value={pivotRowKey}
                onChange={(e) => setPivotRowKey(e.target.value)}
                placeholder="Row key…"

                buttonClassName="border border-slate-200 p-2 rounded-lg min-w-[14rem] bg-white h-10"
              />
              <SearchableSelect
                options={[{ value: "", label: "Dynamic header…" }, ...displayHeaders.map((h) => ({ value: h, label: h }))]}
                value={pivotColKey}
                onChange={(e) => setPivotColKey(e.target.value)}
                placeholder="Dynamic header…"

                buttonClassName="border border-slate-200 p-2 rounded-lg min-w-[14rem] bg-white h-10"
              />
              <SearchableSelect
                options={[
                  { value: "", label: pivotAgg === "count" ? "— (count)" : "Value…" },
                  ...displayHeaders.map((h) => ({ value: h, label: h })),
                ]}
                value={pivotValKey}
                onChange={(e) => setPivotValKey(e.target.value)}
                placeholder={pivotAgg === "count" ? "— (count)" : "Value…"}
                disabled={pivotAgg === "count"}
                buttonClassName="border border-slate-200 p-2 rounded-lg min-w-[14rem] bg-white h-10"
              />
              <SearchableSelect
                options={[
                  { value: "sum", label: "sum" },
                  { value: "count", label: "count" },
                ]}
                value={pivotAgg}
                onChange={(e) => setPivotAgg(e.target.value)}
                placeholder="Aggregation…"
                panelWidth={180}

                buttonClassName="border border-slate-200 p-2 rounded-lg min-w-[10rem] bg-white h-10"
              />

              <div className="flex gap-2 ml-auto">
                <button
                  onClick={() => {
                    if (!pivotRows.length) return;
                    try {
                      const wb = XLSX.utils.book_new();
                      const ws = XLSX.utils.json_to_sheet(pivotRows, { header: pivotHeaders });
                      XLSX.utils.book_append_sheet(wb, ws, "Pivot");
                      XLSX.writeFile(wb, "pivot.xlsx");
                    } catch (e) {
                      console.error("Pivot export failed:", e);
                    }
                  }}
                  className={`px-3 rounded-lg h-10 shadow ${pivotRows.length
                    ? "bg-gradient-to-r from-cyan-600 to-teal-600 hover:from-cyan-500 hover:to-teal-500 text-white"
                    : "bg-gradient-to-r from-gray-200 to-gray-300 cursor-not-allowed text-gray-600"
                    }`}
                  title={pivotRows.length ? "Export Pivot (XLSX)" : "Nothing to export yet"}
                >
                  Export Pivot
                </button>

                <button
                  onClick={exportPivotPDF}
                  className={`px-3 rounded-lg h-10 shadow ${pivotRows.length
                    ? "bg-gradient-to-r from-rose-600 to-rose-500 hover:from-rose-600 hover:to-rose-600 text-white"
                    : "bg-gradient-to-r from-gray-200 to-gray-300 cursor-not-allowed text-gray-600"
                    }`}
                  title={pivotRows.length ? "Export Pivot (PDF)" : "Nothing to export yet"}
                  disabled={!pivotRows.length}
                >
                  Export Pivot PDF
                </button>

                <button
                  onClick={resetPivot}
                  className="px-3 bg-gradient-to-r from-white to-gray-50 border border-slate-200 rounded-lg h-10 hover:from-gray-50 hover:to-gray-100"
                  title="Clear pivot selections"
                >
                  Reset
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Pivot Chart + Pie + Table */}
        {pivotOn && (
          <div className="bg-white border rounded-xl shadow">
            <div className="p-3 font-semibold text-gray-900">📌 Pivot</div>

            {pivotRowKey && pivotColKey && (pivotAgg === "count" || pivotValKey) && pivotRows.length > 0 && pivotSeriesKeys.length > 0 && (user.role === "admin" || selectedViewId) && hasRequiredColumns([pivotRowKey, pivotColKey, pivotValKey].filter(Boolean)) ? (
              <div className="p-0" ref={pivotChartRef}>
                <div className="flex flex-col lg:flex-row gap-0">
                  {/* Bar chart (left) - wider */}
                  <div className="lg:w-3/4 w-full">
                    <ResponsiveContainer width="100%" height={320}>
                      <BarChart data={pivotRows} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey={pivotRowKey} />
                        <YAxis />
                        <Tooltip formatter={(v) => Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} />
                        <Legend />
                        <defs>
                          <linearGradient id="pivotEmerald" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10B981" stopOpacity={0.95} />
                            <stop offset="95%" stopColor="#A7F3D0" stopOpacity={0.25} />
                          </linearGradient>
                        </defs>
                        {pivotSeriesKeys.map((k) => (
                          <Bar key={k} dataKey={k} stackId="pivot" fill="url(#pivotEmerald)" />
                        ))}
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Pie chart (right) */}
                  <div className="lg:w-1/4 w-full relative">


                    <div className="w-full h=[320px]">
                      {pieData.length ? (
                        <ResponsiveContainer width="100%" height={320}>
                          <PieChart margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                            <Tooltip formatter={(v, n) => [Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), n]} />
                            <Pie
                              data={pieData}
                              dataKey="value"
                              nameKey="name"
                              cx="50%"
                              cy="47%"
                              innerRadius="52%"
                              outerRadius="95%"
                              paddingAngle={1}
                              isAnimationActive={false}
                            >
                              {pieData.map((entry, idx) => (
                                <Cell key={`cell-${idx}`} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                              ))}
                            </Pie>
                          </PieChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="text-xs text-gray-500">No pie data for current Pivot.</div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-xs text-gray-500 px-3 pb-3">Select Row / Dynamic / Value to render.</div>
            )}

            {pivotRows.length ? (
              <div className="overflow-auto px-3 pb-3">
                <table className="table-auto border-collapse w-full text-sm">
                  <thead className="bg-gradient-to-r from-slate-100 to-white text-gray-800">
                    <tr>
                      {pivotHeaders.map((h) => (
                        <th key={h} className="p-2 border border-slate-200 border-dashed text-left whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pivotRows.map((row, i) => (
                      <tr key={i} className="odd:bg-white even:bg-slate-50/40 hover:bg-slate-50 transition-colors">
                        {pivotHeaders.map((h) => (
                          <td key={h} className="p-2 border border-slate-200 border-dashed whitespace-nowrap">
                            {renderMaybeDate(h, row[h])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        )}

        {/* Two-Condition Controls & Chart */}
        {twoOn && hasRequiredColumns([condCol1, condCol2, valueCol].filter(Boolean)) && (
          <div className="p-4 bg-slate-50/60 border-t border-slate-200">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-bold text-gray-900">📊 Two-Condition Summary</h2>
              <button
                onClick={resetSummary}
                className="px-3 bg-gradient-to-r from-white to-gray-50 border border-slate-200 rounded-lg h-10 hover:from-gray-50 hover:to-gray-100"
                title="Clear selections"
              >
                Reset
              </button>
            </div>

            <div className="grid gap-3 md:grid-cols-3 sm:grid-cols-2 grid-cols-1 items-end">
              <SearchableSelect
                options={[{ value: "", label: "-- Select --" }, ...displayHeaders.map((h) => ({ value: h, label: h }))]}
                value={condCol1}
                onChange={(e) => setCondCol1(e.target.value)}
                placeholder="Condition 1…"

                buttonClassName="border border-slate-200 p-2 rounded-lg min-w-[14rem] bg-white h-10"
                panelWidth={280}
              />
              <SearchableSelect
                options={[{ value: "", label: "-- Select --" }, ...displayHeaders.map((h) => ({ value: h, label: h }))]}
                value={condCol2}
                onChange={(e) => setCondCol2(e.target.value)}
                placeholder="Condition 2…"

                buttonClassName="border border-slate-200 p-2 rounded-lg min-w-[14rem] bg-white h-10"
                panelWidth={280}
              />
              <SearchableSelect
                options={[{ value: "", label: "-- Select --" }, ...displayHeaders.map((h) => ({ value: h, label: h }))]}
                value={valueCol}
                onChange={(e) => setValueCol(e.target.value)}
                placeholder="Value column…"

                buttonClassName="border border-slate-200 p-2 rounded-lg min-w-[14rem] bg-white h-10"
                panelWidth={280}
              />
            </div>

            {condCol1 && condCol2 && valueCol && summaryData?.length > 0 ? (
              <div className="mt-4">
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={summaryData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey={condCol2} />
                    <YAxis />
                    <Tooltip formatter={(v) => Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} />
                    <Legend />
                    <defs>
                      <linearGradient id="twoCondGreen" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10B981" stopOpacity={0.95} />
                        <stop offset="95%" stopColor="#A7F3D0" stopOpacity={0.25} />
                      </linearGradient>
                    </defs>
                    <Bar dataKey="total" fill="url(#twoCondGreen)" />
                  </BarChart>
                </ResponsiveContainer>

                <table className="table-auto border-collapse w-full text-sm mt-6">
                  <thead className="bg-gradient-to-r from-slate-100 to-white text-gray-800">
                    <tr>
                      <th className="p-2 border border-slate-200 border-dashed">{condCol1}</th>
                      <th className="p-2 border border-slate-200 border-dashed">{condCol2}</th>
                      <th className="p-2 border border-slate-200 border-dashed">Total {valueCol}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summaryData.map((row, i) => (
                      <tr key={i} className="odd:bg-white even:bg-slate-50/40 hover:bg-slate-50 transition-colors">
                        <td className="p-2 border border-slate-200 border-dashed">{row[condCol1]}</td>
                        <td className="p-2 border border-slate-200 border-dashed">{row[condCol2]}</td>
                        <td className="p-2 border border-slate-200 border-dashed font-semibold">
                          ${Number(row.total ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-gray-700 mt-3">ℹ️ Select two conditions and a value column to see results.</p>
            )}
          </div>
        )}

        {/* Trends */}
        {/* Trends */}
        {trendsOn && (
          hasRequiredColumns([trendsDateKey, trendsValueKey].filter(Boolean)) ? (
            <div className="m-4 bg-white rounded-2xl shadow-2xl border border-sky-100">
              <div className="p-3 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div className="font-semibold text-gray-900">📈 Trends</div>
                  <div className="flex gap-1">
                    <button
                      className={`px-2 h-8 rounded border ${!trendsValueKey ? "bg-sky-600 text-white border-sky-600" : "bg-white border-sky-200"}`}
                      onClick={() => setTrendsValueKey("")}
                      title="Count per day"
                    >
                      Count
                    </button>
                    <button
                      className={`px-2 h-8 rounded border ${trendsValueKey ? "bg-sky-600 text-white border-sky-600" : "bg-white border-sky-200"}`}
                      onClick={() => {
                        const key = trendsValueKey || totalsCol || guessedNumericKey || "";
                        if (!key) { alert("No numeric column detected for sum."); return; }
                        setTrendsValueKey(key);
                      }}
                      title={`Sum per day${trendsValueKey ? ` (${trendsValueKey})` : totalsCol ? ` (${totalsCol})` : guessedNumericKey ? ` (${guessedNumericKey})` : ""}`}
                    >
                      Sum
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-3 items-end">
                  <SearchableSelect
                    options={[{ value: "", label: "Date column…" }, ...displayHeaders.map((h) => ({ value: h, label: h }))]}
                    value={trendsDateKey}
                    onChange={(e) => setTrendsDateKey(e.target.value)}
                    placeholder="Date column…"
                    buttonClassName="border border-sky-200 p-2 rounded-lg min-w-[14rem] bg-white h-10"
                  />
                  <SearchableSelect
                    options={[{ value: "", label: "(Count events)" }, ...displayHeaders.map((h) => ({ value: h, label: h }))]}
                    value={trendsValueKey}
                    onChange={(e) => setTrendsValueKey(e.target.value)}
                    placeholder="Value column (optional)…"
                    buttonClassName="border border-sky-200 p-2 rounded-lg min-w-[16rem] bg-white h-10"
                  />
                  <SearchableSelect
                    options={[
                      { value: "", label: "Granularity…" },
                      { value: "daily", label: "Daily (same day across years)" },
                      { value: "month", label: "Month Total (same month across years)" },
                      { value: "year", label: "Year Total (per year)" },
                    ]}
                    value={trendGranularity}
                    onChange={(e) => setTrendGranularity(e.target.value)}
                    placeholder="Granularity…"
                    buttonClassName="border border-sky-200 p-2 rounded-lg min-w-[18rem] bg-white h-10"
                  />
                  <SearchableSelect
                    options={[
                      { value: "", label: "Years back…" },
                      { value: "1", label: "1 year back" },
                      { value: "2", label: "2 years back" },
                      { value: "3", label: "3 years back" },
                      { value: "4", label: "4 years back" },
                      { value: "5", label: "5 years back" },
                    ]}
                    value={yearsBack}
                    onChange={(e) => setYearsBack(e.target.value)}
                    placeholder="Years back…"
                    buttonClassName="border border-sky-200 p-2 rounded-lg min-w-[14rem] bg-white h-10"
                  />
                </div>
              </div>

              <div className="px-3 pb-3">
                {trendsDateKey && trendGranularity && yearsBack && trendsData.length ? (
                  <ResponsiveContainer width="100%" height={320}>
                    {(() => {
                      const measureKeyLocal = trendsValueKey ? "sum" : "count";
                      const maxBack = Math.min(5, Math.max(1, parseInt(yearsBack, 10)));
                      const COLORS = ["#2563EB", "#059669", "#F59E0B", "#DC2626", "#7C3AED", "#0EA5E9"];
                      const lines = [];
                      const currentKey = trendGranularity === "daily" ? measureKeyLocal : "currentAgg";

                      lines.push(
                        <Line
                          key="current"
                          type="monotone"
                          dataKey={currentKey}
                          name={`Current ${trendGranularity}`}
                          dot={false}
                          stroke={COLORS[0]}
                          strokeWidth={3}
                        />
                      );

                      for (let k = 1; k <= maxBack; k++) {
                        lines.push(
                          <Line
                            key={`prev_${k}y`}
                            type="monotone"
                            dataKey={`prev_${k}y`}
                            name={`${k}y back`}
                            dot={false}
                            stroke={COLORS[k] || COLORS[COLORS.length - 1]}
                            strokeWidth={3}
                            strokeDasharray={k % 2 === 0 ? "6 4" : "4 4"}
                          />
                        );
                      }

                      return (
                        <LineChart data={trendsData} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="date" />
                          <YAxis tickFormatter={(v) => Number(v).toFixed(2)} />
                          <Tooltip content={<TrendTooltip />} />
                          <Legend />
                          {lines}
                        </LineChart>
                      );
                    })()}
                  </ResponsiveContainer>
                ) : (
                  <div className="text-sm text-gray-600">
                    Pick a <b>Date</b>, choose <b>Count/Sum</b>, then set <b>Granularity</b> and <b>Years back (1–5)</b>.
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="mx-4 my-2 p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-800 text-sm flex items-center gap-2">
              <span>ℹ️</span>
              <span> Please select a <b>Date column</b>, <b>Granularity</b>, and <b>Years back</b> to view the Trends chart.</span>
            </div>
          )
        )}


        {/* Data Table */}
        <div className="m-4 bg-white rounded-2xl shadow-2xl border border-gray-200 focus:ring-slate-100 relative z-0">
          {sortedData?.length > 0 ? (
            <>
              <div className="p-3 text-sm text-gray-600 border-b border-slate-100 bg-gradient-to-r from-white to-slate-50/60">
                {activeFilename ? (
                  <>Loaded: <b>{activeFilename}</b></>
                ) : (
                  "No sheet loaded"
                )}
              </div>

              {/* Limit viewport to ~30 rows; keep header sticky; scroll the rest */}
              <div
                ref={tableContainerRef}
                className="overflow-auto"
                style={{ maxHeight: "960px" }}
              >
                <table className="table-auto border-collapse w-full text-sm">
                  <thead className="sticky top-0 bg-gradient-to-r from-cyan-600 to-teal-600 text-white shadow-sm z-10">
                    <tr>
                      {displayHeaders.map((h) => (
                        <th
                          key={h}
                          ref={(el) => {
                            if (!filterAnchorRefs.current) filterAnchorRefs.current = {};
                            filterAnchorRefs.current[h] = el;
                          }}
                          className="relative border border-slate-200 border-dashed px-4 py-2 text-left whitespace-nowrap cursor-pointer group"
                          onClick={(e) => {
                            if (openFilterCol === h) return;
                            const isFilterBtn = e.target.closest && e.target.closest(".filter-btn");
                            if (!isFilterBtn) requestSort(h);
                          }}
                        >
                          <div className="flex items-center gap-2">
                            <span className="truncate">
                              {h}
                              {sortConfig?.key === h ? (sortConfig.direction === "asc" ? " ▲" : " ▼") : " ⬍"}
                            </span>

                            <button
                              type="button"
                              ref={(el) => {
                                if (!filterBtnRefs.current) filterBtnRefs.current = {};
                                filterBtnRefs.current[h] = el;
                              }}

                              className={`filter-btn ml-auto text-[11px] h-7 px-2 rounded-md bg-white/80 backdrop-blur border ${columnFilters[h] && columnFilters[h] instanceof Set && columnFilters[h].size > 0
                                ? "border-slate-400 ring-1 ring-slate-300"
                                : "border-slate-200"
                                } text-gray-800 hover:bg-slate-50 focus:outline-none focus:ring focus:ring-slate-100`}
                              title="Filter"
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenFilterCol((prev) => (prev === h ? null : h));
                              }}
                            >
                              ▾ Filter
                            </button>

                            {openFilterCol === h && (
                              <ColumnFilterMenu
                                anchorMapRef={filterBtnRefs}
                                columnKey={h}
                                column={h}
                                allValues={uniqueValuesByColumn[h] || []}
                                appliedSelected={
                                  columnFilters[h] && columnFilters[h] instanceof Set ? columnFilters[h] : null
                                }
                                onApply={(col, set) => {
                                  setColumnFilters((prev) => {
                                    const next = { ...prev };
                                    if (set === null) delete next[col];
                                    else next[col] = new Set(set);
                                    return next;
                                  });
                                }}
                                onClear={(col) => {
                                  setColumnFilters((prev) => {
                                    const next = { ...prev };
                                    delete next[col];
                                    return next;
                                  });
                                }}
                                onClose={() => setOpenFilterCol(null)}
                                tableContainerRef={tableContainerRef}
                              />
                            )}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="[&>tr]:h-8">
                    {sortedData.map((row, i) => (
                      <tr key={i} className="odd:bg-white even:bg-slate-50/40 hover:bg-slate-50 transition-colors">
                        {displayHeaders.map((h) => (
                          <td key={h} className="border border-slate-200 border-dashed px-4 py-2 whitespace-nowrap">
                            {renderMaybeDate(h, row[h])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

            </>
          ) : (
            <div className="text-gray-600 text-center py-10">
              📂 Use <b>Select Sheet</b> to pick a file you have access to, or upload (admin).
            </div>
          )}
        </div>
      </div >
    );
  };

  /* -------- Router + Header -------- */
  return (
    <Router>
      <div className="bg-gradient-to-r from-teal-700 via-cyan-700 to-teal-600 text-white px-6 py-4 flex justify-between items-center shadow-lg">
        <h1 className="text-xl font-bold">📊 Dashboard</h1>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={openSelect}
            className="bg-white text-gray-900 border border-slate-200 hover:bg-slate-50 px-3 py-1 rounded-lg h-10 shadow"
            title="Choose a sheet you have access to"
          >
            Select Sheet
          </button>
          <span className="italic opacity-90">{user.email}</span>
          <button
            onClick={() => {
              localStorage.removeItem("token");
              setToken("");
              setUser(null);
              setData([]);
              setHeaders([]);
              setActiveFilename("");
              setSelectedFileName("");
              setTotalsCol("");
              setCondCol1("");
              setCondCol2("");
              setValueCol("");
              setSortConfig(null);
              setPivotOn(false);
              setTwoOn(false);
              setPivotRowKey("");
              setPivotColKey("");
              setPivotValKey("");
              setPivotAgg("sum");
              setColumnFilters({});
              setOpenFilterCol(null);
              setPieMode("rows");
              setPieTopN("10");
              setTrendsOn(false);
            }}
            className="bg-rose-600 hover:bg-rose-700 px-3 py-1 rounded-lg h-10 text-white shadow"
          >
            Logout
          </button>
        </div>
      </div>

      <nav className="bg-gradient-to-r from-white to-slate-50 text-gray-900 p-3 flex gap-4 border-b border-slate-100">
        <Link className="hover:underline" to="/">Dashboard</Link>
        {user?.role === "admin" && <Link className="hover:underline" to="/users">Manage Users</Link>}
      </nav>

      <Routes>
        <Route path="/" element={<ErrorBoundary><DashboardBody /></ErrorBoundary>} />
        {user?.role === "admin" && (
          <Route path="/users" element={<div className="pt-0"><UserManagement token={token} sheetId={sheetId} /></div>} />
        )}
      </Routes>

      <Modal open={selectOpen} onClose={() => setSelectOpen(false)} title={user.role === "admin" ? "Select or Delete a Sheet" : "Select a Sheet"}>
        {selectError ? (
          <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 text-rose-800 px-3 py-2 text-sm">
            {selectError}
          </div>
        ) : null}

        {myFilesLoading ? (
          <div>Loading…</div>
        ) : myFiles.length ? (
          <div className="overflow-auto">
            <table className="table-auto border-collapse w-full text-sm">
              <thead className="bg-gradient-to-r from-slate-50 to-white">
                <tr>
                  <th className="p-2 border border-slate-200 border-dashed text-left">Filename</th>
                  <th className="p-2 border border-slate-200 border-dashed text-left">Folder</th>
                  <th className="p-2 border border-slate-200 border-dashed text-left">Uploaded</th>
                  <th className="p-2 border border-slate-200 border-dashed"></th>
                  {user.role === "admin" && <th className="p-2 border border-slate-200 border-dashed"></th>}
                </tr>
              </thead>
              <tbody>
                {myFiles.map((f) => (
                  <tr key={f.id} className="odd:bg-white even:bg-slate-50/40">
                    <td className="p-2 border border-slate-200 border-dashed">{f.filename}</td>
                    <td className="p-2 border border-slate-200 border-dashed">{f.folder_name || "—"}</td>
                    <td className="p-2 border border-slate-200 border-dashed">{new Date(f.uploaded_at).toLocaleString()}</td>
                    <td className="p-2 border border-slate-200 border-dashed">
                      <button onClick={() => loadStored(f.id)} className="bg-gradient-to-r from-cyan-600 to-teal-600 hover:from-cyan-500 hover:to-teal-500 text-white px-3 py-1 rounded shadow">
                        Load
                      </button>
                    </td>
                    {user.role === "admin" && (
                      <td className="p-2 border border-slate-200 border-dashed">
                        <button
                          onClick={async () => {
                            await deleteSheet(f.id);
                            await refreshMyFiles();
                          }}
                          className="bg-gradient-to-r from-rose-600 to-rose-500 hover:from-rose-600 hover:to-rose-600 text-white px-3 py-1 rounded shadow"
                        >
                          Delete
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-gray-600">
            {selectError
              ? "Could not retrieve your files."
              : "No files found. If you expect files, check your permissions."}
          </div>
        )}
      </Modal>

      <Modal open={folderFilesOpen} onClose={() => setFolderFilesOpen(false)} title={`Files in: ${folderFilesMeta.name || ""}`} widthClass="max-w-4xl">
        {folderFilesLoading ? (
          <div>Loading…</div>
        ) : folderFiles.length ? (
          <table className="table-auto border-collapse w-full text-sm">
            <thead className="bg-gradient-to-r from-slate-50 to-white">
              <tr>
                <th className="p-2 border border-slate-200 border-dashed text-left">Filename</th>
                <th className="p-2 border border-slate-200 border-dashed text-left">Uploaded</th>
                <th className="p-2 border border-slate-200 border-dashed text-left">Active</th>
                <th className="p-2 border border-slate-200 border-dashed"></th>
              </tr>
            </thead>
            <tbody>
              {folderFiles.map((f) => (
                <tr key={f.id} className="odd:bg-white even:bg-slate-50/40">
                  <td className="p-2 border border-slate-200 border-dashed">{f.filename}</td>
                  <td className="p-2 border border-slate-200 border-dashed">{fmtDateOnly(f.uploaded_at)}</td>
                  <td className="p-2 border border-slate-200 border-dashed">{f.active ? "Yes" : "No"}</td>
                  <td className="p-2 border border-slate-200 border-dashed">
                    <button onClick={() => deleteSheet(f.id)} className="bg-gradient-to-r from-rose-600 to-rose-500 hover:from-rose-600 hover:to-rose-600 text-white px-3 py-1 rounded shadow">
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="text-gray-600">No files in this folder.</div>
        )}
      </Modal>

      {/* Column Visibility Selector Modal */}
      {showColumnSelector && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl p-6 max-w-2xl w-full max-h-[80vh] overflow-auto">
            <h2 className="text-xl font-bold mb-4">Select Visible Columns for View: {pendingViewName}</h2>
            <p className="text-sm text-gray-600 mb-4">
              Choose which columns should be visible to users when this view is loaded.
              If no columns are selected, all columns will be visible.
            </p>

            <div className="grid grid-cols-2 gap-2 mb-6">
              {headers.map((h) => (
                <label key={h} className="flex items-center gap-2 p-2 hover:bg-gray-50 rounded cursor-pointer">
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
                    className="w-4 h-4"
                  />
                  <span className="text-sm">{h}</span>
                </label>
              ))}
            </div>

            <div className="flex gap-3 justify-end">
              <button
                onClick={() => {
                  setShowColumnSelector(false);
                  setPendingViewName("");
                  setVisibleColumns([]);
                }}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const serializableColumnFilters = {};
                  for (const key in columnFilters) {
                    serializableColumnFilters[key] = Array.from(columnFilters[key]);
                  }
                  const config = {
                    columnFilters: serializableColumnFilters,
                    sortConfig,
                    visibleColumns: visibleColumns.length > 0 ? visibleColumns : [], // Save selected columns
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
                    { name: pendingViewName, sheetId, config },
                    { headers: { Authorization: `Bearer ${token}` } }
                  );
                  const res = await axios.get(`${API}/views/${sheetId}`, {
                    headers: { Authorization: `Bearer ${token}` },
                  });
                  setViews(res.data || []);
                  setShowColumnSelector(false);
                  setPendingViewName("");
                  setVisibleColumns([]);
                }}
                className="px-4 py-2 bg-gradient-to-r from-cyan-600 to-teal-600 text-white rounded-lg hover:from-cyan-500 hover:to-teal-500"
              >
                Save View
              </button>
            </div>
          </div>
        </div>
      )}
    </Router>
  );
}

