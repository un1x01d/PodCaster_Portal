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

export default function App() {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() => readStoredAuthToken());
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [googleEnabled, setGoogleEnabled] = useState(true);
  const [dropboxEnabled, setDropboxEnabled] = useState(true);
  const [oneDriveEnabled, setOneDriveEnabled] = useState(true);
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
  const [uploadDisplayName, setUploadDisplayName] = useState("");

  // My files (sheet selection)
  const [myFiles, setMyFiles] = useState([]);
  const [myFilesLoading, setMyFilesLoading] = useState(false);


  // Admin folder files view
  const [folderFiles, setFolderFiles] = useState([]);
  const [folderFilesMeta, setFolderFilesMeta] = useState({});
  const [folderFilesOpen, setFolderFilesOpen] = useState(false);
  const [folderFilesLoading, setFolderFilesLoading] = useState(false);

  // Views
  const [views, setViews] = useState([]);
  const [selectedViewId, setSelectedViewId] = useState("");
  const [pendingViewName, setPendingViewName] = useState("");
  const [showColumnSelector, setShowColumnSelector] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState([]); // columns to save

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

  const fetchUniqueValues = async (col, sid = sheetId, tabName = activeTab) => {
    if (!sid || !col) return;
    try {
      const url = `${API}/sheets/${sid}/unique-values?col=${encodeURIComponent(col)}${tabName ? `&tab=${encodeURIComponent(tabName)}` : ""}`;
      const res = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setUniqueValuesByColumn(prev => ({
        ...prev,
        [col]: res.data || []
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
    setTrendsOn(false);
    setPivotOn(false);
    setTwoOn(false);
    const isTemporalColumn = (col = "") => looksLikeDateColumn(col);
    if (config.dateColumn && (!config.segmentBy || isTemporalColumn(config.segmentBy))) {
      setTrendsValueKey(config.valueColumn);
      setTrendsDateKey(config.dateColumn);
      setTrendGranularity(isTemporalColumn(config.dateColumn) && /quarter|fiscal/i.test(config.dateColumn) ? "quarter" : "month");
      setTrendsOn(true);
      setPendingViewName(`Trend of ${config.valueColumn}`);
      return;
    }
    if (!config.dateColumn && config.segmentBy && config.valueColumn && isTemporalColumn(config.segmentBy)) {
      setTrendsValueKey(config.valueColumn);
      setTrendsDateKey(config.segmentBy);
      setTrendGranularity(/quarter|fiscal/i.test(config.segmentBy) ? "quarter" : "month");
      setTrendsOn(true);
      setPendingViewName(`Trend of ${config.valueColumn}`);
      return;
    }
    if (config.segmentBy && config.valueColumn) {
      setPivotRowKey(config.segmentBy);
      setPivotValKey(config.valueColumn);
      setPivotColKey(null);
      setPivotAgg(config.aggregation === "avg" ? "Average" : "Sum");
      setPivotOn(true);
      setPendingViewName(`${config.valueColumn} by ${config.segmentBy}`);
      return;
    }
    const dateCol = headers.find((h) => h.toLowerCase().includes("date") || h.toLowerCase().includes("time") || h.toLowerCase().includes("year"));
    if (dateCol) {
      setTrendsValueKey(config.valueColumn);
      setTrendsDateKey(dateCol);
      setTrendsOn(true);
      setPendingViewName(`Trend of ${config.valueColumn}`);
    }
  }, [headers]);

  const saveInsightView = React.useCallback((name) => {
    setPendingViewName(name || "Insight View");
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

  const handleGoogleLogin = async () => {
    if (!googleEnabled) {
      alert("Google sign-in is disabled.");
      return;
    }
    try {
      const res = await axios.get(`${API}/auth/google/url`);
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
        const heads = raw.length ? Object.keys(raw[0]) : [];
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
    const { preferCache = true, limit = BATCH_SIZE, offset = 0, append = false, context = "primary" } = options;
    
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
      
      if (isPrimary && columnFilters && Object.keys(columnFilters).length > 0) {
        const serializableFilters = {};
        Object.entries(columnFilters).forEach(([col, val]) => {
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

      if (isPrimary) {
          if (!append) tabDataCacheRef.current[cacheKey] = Array.isArray(raw) ? raw : [];
          applyLoadedRows(sid, raw, preserveFilters, append);
      } else {
          if (append) {
              setSecondaryData(prev => [...prev, ...raw]);
              if (raw.length < BATCH_SIZE) setSecondaryHasMoreData(false);
          } else {
              setSecondaryData(raw);
              setSecondaryHeaders(raw.length ? Object.keys(raw[0]) : []);
              setSecondaryHasMoreData(raw.length >= BATCH_SIZE);
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

  const onLoadMoreSecondary = () => {
    if (secondaryIsBatchLoading || !secondaryHasMoreData || !secondarySheetId) return;
    loadData(secondarySheetId, true, secondaryTab, {
        offset: secondaryData.length,
        append: true,
        context: "secondary",
        preferCache: false
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
  }, [secondarySheetId, secondaryTab, secondarySortConfig]);

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

  const handleUpload = async (uploadFile, folderId, displayName) => {
    if (!uploadFile || !folderId || !String(displayName || "").trim()) return;
    const formData = new FormData();
    formData.append("file", uploadFile);
    formData.append("folder_id", folderId);
    formData.append("display_name", String(displayName).trim());

    try {
      const res = await axios.post(`${API}/upload`, formData, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "multipart/form-data"
        },
      });
      alert("Uploaded!");
      if (res.data.sheetId) {
        setSheetId(res.data.sheetId);
        const activeName = res.data.display_name || res.data.filename;
        setActiveFilename(activeName);
        localStorage.setItem("activeFilename", activeName);
        setUploadDisplayName("");
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
        }
      }
    } catch (e) {
      console.error(e);
      alert("Upload failed");
    }
  };

  const handleGoogleDriveImport = async ({ fileId, name, mimeType, folderId, displayName }) => {
    if (!fileId || !folderId || !String(displayName || "").trim()) return;
    try {
      const res = await axios.post(
        `${API}/google/drive/import`,
        {
          fileId,
          name,
          mimeType,
          folder_id: folderId,
          display_name: String(displayName).trim(),
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      alert("Imported from Google Drive!");
      if (res.data?.sheetId) {
        setSheetId(res.data.sheetId);
        const activeName = res.data.display_name || res.data.filename;
        setActiveFilename(activeName);
        localStorage.setItem("activeFilename", activeName);
        setUploadDisplayName("");
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
        }
      }
    } catch (e) {
      console.error(e);
      alert(e.response?.data?.error || "Google Drive import failed");
    }
  };

  const handleDropboxImport = async ({ pathLower, name, folderId, displayName }) => {
    if (!pathLower || !folderId || !String(displayName || "").trim()) return;
    try {
      const res = await axios.post(
        `${API}/dropbox/import`,
        {
          pathLower,
          name,
          folder_id: folderId,
          display_name: String(displayName).trim(),
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      alert("Imported from Dropbox!");
      if (res.data?.sheetId) {
        setSheetId(res.data.sheetId);
        const activeName = res.data.display_name || res.data.filename;
        setActiveFilename(activeName);
        localStorage.setItem("activeFilename", activeName);
        setUploadDisplayName("");
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
        }
      }
    } catch (e) {
      console.error(e);
      alert(e.response?.data?.error || "Dropbox import failed");
    }
  };

  const handleOneDriveImport = async ({ itemId, name, folderId, displayName }) => {
    if (!itemId || !folderId || !String(displayName || "").trim()) return;
    try {
      const res = await axios.post(
        `${API}/onedrive/import`,
        {
          itemId,
          name,
          folder_id: folderId,
          display_name: String(displayName).trim(),
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      alert("Imported from OneDrive!");
      if (res.data?.sheetId) {
        setSheetId(res.data.sheetId);
        const activeName = res.data.display_name || res.data.filename;
        setActiveFilename(activeName);
        localStorage.setItem("activeFilename", activeName);
        setUploadDisplayName("");
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

  const exportCSV = async () => {
    if (!sortedData.length) return;
    const XLSX = await loadXlsxModule();
    const ws = XLSX.utils.json_to_sheet(sortedData);
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
    const ws = XLSX.utils.json_to_sheet(sortedData);
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
    axios.get(`${API}/auth/me`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
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
      .catch(() => { setToken(""); setUser(null); setMyFiles([]); });

    axios.get(`${API}/my-sheets`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(r => setMyFiles(r.data || []))
      .catch(e => {
        if (user) console.error("Fetch files failed", e);
      });
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
    setToken("");
    setUser(null);
    setData([]);
    setHeaders([]);
    setSheetId(null);
    setActiveFilename("");
  };

  const handleSwitchSheet = (newSheetId) => {
    if (!newSheetId) return;
    const f = myFiles.find(file => String(file.id) === String(newSheetId));
    if (f) {
      const activeName = f.display_name || f.filename;
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
                {!user ? (
                  <div className="min-h-screen flex items-center justify-center p-6">
                    <div className="glass rounded-3xl p-10 w-full max-w-md animate-in fade-in zoom-in duration-500">
                      <div className="mb-8 text-center">
                        <div className="bg-indigo-600 text-white w-16 h-16 rounded-2xl flex items-center justify-center text-3xl shadow-xl shadow-indigo-200 mx-auto mb-4">📊</div>
                        <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight">Welcome Back</h2>
                        <p className="text-slate-500 mt-2">Sign in to manage your data workspace</p>
                      </div>
                      <form onSubmit={handleLogin} className="flex flex-col gap-5">
                        <div className="space-y-1.5">
                          <label className="text-xs font-bold uppercase tracking-wider text-slate-500 ml-1">Email Address</label>
                          <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="admin@example.com"
                            className="input-premium"
                            required
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-bold uppercase tracking-wider text-slate-500 ml-1">Password</label>
                          <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="••••••••"
                            className="input-premium"
                            required
                          />
                        </div>
                        <button
                          type="submit"
                          className="btn-premium bg-indigo-600 hover:bg-indigo-700 text-white w-full py-4 mt-4 shadow-xl shadow-indigo-200"
                        >
                          Sign In
                        </button>
                        <button
                          type="button"
                          onClick={handleGoogleLogin}
                          disabled={!googleEnabled}
                          className={`btn-premium bg-white text-slate-800 border border-slate-300 w-full py-4 shadow-sm ${googleEnabled ? "hover:bg-slate-50" : "opacity-50 cursor-not-allowed"}`}
                        >
                          {googleEnabled ? "Continue with Google" : "Google Sign-In Disabled"}
                        </button>
                      </form>
                    </div>
                  </div>
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
                {!user ? (
                  <div className="min-h-screen flex items-center justify-center p-6">
                    <div className="glass rounded-3xl p-10 w-full max-w-md animate-in fade-in zoom-in duration-500">
                      <div className="mb-8 text-center">
                        <div className="bg-indigo-600 text-white w-16 h-16 rounded-2xl flex items-center justify-center text-3xl shadow-xl shadow-indigo-200 mx-auto mb-4">📊</div>
                        <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight">Welcome Back</h2>
                        <p className="text-slate-500 mt-2">Sign in to manage your data workspace</p>
                      </div>
                      <form onSubmit={handleLogin} className="flex flex-col gap-5">
                        <div className="space-y-1.5">
                          <label className="text-xs font-bold uppercase tracking-wider text-slate-500 ml-1">Email Address</label>
                          <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="admin@example.com"
                            className="input-premium"
                            required
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-bold uppercase tracking-wider text-slate-500 ml-1">Password</label>
                          <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="••••••••"
                            className="input-premium"
                            required
                          />
                        </div>
                        <button
                          type="submit"
                          className="btn-premium bg-indigo-600 hover:bg-indigo-700 text-white w-full py-4 mt-4 shadow-xl shadow-indigo-200"
                        >
                          Sign In
                        </button>
                        <button
                          type="button"
                          onClick={handleGoogleLogin}
                          disabled={!googleEnabled}
                          className={`btn-premium bg-white text-slate-800 border border-slate-300 w-full py-4 shadow-sm ${googleEnabled ? "hover:bg-slate-50" : "opacity-50 cursor-not-allowed"}`}
                        >
                          {googleEnabled ? "Continue with Google" : "Google Sign-In Disabled"}
                        </button>
                      </form>
                    </div>
                  </div>
                ) : (
                  <>
                    <DashboardBody
                      user={user} token={token} API={API}
                      sheetId={sheetId} activeFilename={activeFilename}
                      file={file} setFile={setFile}
                      selectedFileName={selectedFileName} setSelectedFileName={setSelectedFileName}
                      uploadDisplayName={uploadDisplayName} setUploadDisplayName={setUploadDisplayName}
                      handleUpload={handleUpload}
                      handleGoogleDriveImport={handleGoogleDriveImport}
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
                      secondaryIsBatchLoading={secondaryIsBatchLoading}
                      onLoadMoreSecondary={onLoadMoreSecondary}
                      secondarySheetId={secondarySheetId}
                      setSecondarySheetId={setSecondarySheetId}
                      secondaryTab={secondaryTab}
                      setSecondaryTab={setSecondaryTab}
                    />
                    {sheetId && (
                    <SpreadsheetChatbot
                      mode="floating"
                      sheetId={sheetId}
                      data={sortedData}
                      allData={data}
                      headers={headers}
                      activeFilters={columnFilters}
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
              user?.role === "admin"
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
        </main>
      </div>

      {/* Column Visibility Selector Modal for Saving Views */}
      {
        showColumnSelector && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[100] animate-in fade-in duration-300">
            <div className="glass rounded-[2.5rem] p-10 max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl animate-in zoom-in-95 duration-300">
              <div className="flex items-center justify-between mb-8 border-b border-slate-200/50 pb-6">
                <div>
                  <h2 className="text-2xl font-extrabold text-slate-900">Configure View</h2>
                  <p className="text-slate-500 text-sm mt-1">Select visible columns for <span className="text-indigo-600 font-bold">{pendingViewName}</span></p>
                </div>
                <button 
                  onClick={() => setShowColumnSelector(false)}
                  className="w-10 h-10 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 transition-colors"
                >✕</button>
              </div>
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
                  className="btn-premium bg-slate-100 hover:bg-slate-200 text-slate-600 px-6"
                  onClick={() => {
                    setShowColumnSelector(false);
                    setPendingViewName("");
                    setVisibleColumns([]);
                  }}
                >
                  Cancel
                </button>
                <button
                  className="btn-premium bg-indigo-600 hover:bg-indigo-700 text-white px-10 shadow-lg shadow-indigo-100"
                  onClick={async () => {
                    try {
                      const serializableColumnFilters = {};
                      for (const key in columnFilters) {
                        serializableColumnFilters[key] = Array.from(columnFilters[key]);
                      }
                      const config = {
                        columnFilters: serializableColumnFilters,
                        sortConfig,
                        visibleColumns: visibleColumns.length > 0 ? visibleColumns : [],
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
