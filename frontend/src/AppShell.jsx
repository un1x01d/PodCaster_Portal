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

import Icon from "./components/common/Icon";
import Badge from "./components/common/Badge";
import SectionHeading from "./components/common/SectionHeading";
import Header from "./components/common/Header";
import Footer from "./components/common/Footer";
import AuthenticatedAppHeader from "./components/common/AuthenticatedAppHeader";
import ProductLandingPage from "./components/landing/ProductLandingPage";
import PricingPage from "./components/landing/PricingPage";
import DemoBookingScreen from "./components/screens/DemoBookingScreen";
import SupportScreen from "./components/screens/SupportScreen";
import AuthScreen from "./components/screens/AuthScreen";
import InviteAcceptScreen from "./components/screens/InviteAcceptScreen";

import {
  themeTextClass,
  themeHoverTextClass,
  themeBorderClass,
  themeHoverBorderClass,
  themeSoftClass,
  themeGlowClass,
  primaryActionClass,
  secondaryActionClass,
  formLabelClass,
  formFieldClass,
  formTextareaClass,
  publicPageClass,
  publicPanelClass,
  publicMiniPanelClass,
  publicMutedPanelClass
} from "./utils/theme";

import {
  SESSION_ACTIVE_TOKEN,
  createSessionMarker,
  readCookie,
  clearStoredAuthTokens,
  stripSessionMarkerBearer,
  setupAxiosInterceptors
} from "./utils/auth";

import { useAuth } from "./hooks/useAuth";
import { useSheetData } from "./hooks/useSheetData";
import { useViews } from "./hooks/useViews";

import "./index.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";
const DEBUG_SPREADSHEET = import.meta.env.DEV;
const DashboardBody = lazy(() => import("./components/dashboard/DashboardBody"));
const DashboardHome = lazy(() => import("./components/dashboard/DashboardHome"));
const InsightFeed = lazy(() => import("./components/dashboard/InsightFeed"));
const SpreadsheetChatbot = lazy(() => import("./SpreadsheetChatbot"));
const UserManagement = lazy(() => import("./UserManagement"));

setupAxiosInterceptors();

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

export default function App() {
  const isFrontendAdminUser = React.useCallback((nextUser) => {
    const role = String(nextUser?.role || "").trim().toLowerCase();
    return role === "admin" || role === "super_admin" || role === "superadmin";
  }, []);
  const auth = useAuth();
  const {
    user,
    setUser,
    token,
    setToken,
    authChecking,
    email,
    setEmail,
    password,
    setPassword,
    loginError,
    handleLogout: authHandleLogout,
  } = auth;
  const {
    googleEnabled = true,
    dropboxEnabled = true,
    oneDriveEnabled = true,
    sftpStorageEnabled = true,
    gcsStorageEnabled = true,
    s3StorageEnabled = true,
    azureBlobStorageEnabled = true,
  } = auth.integrations || {};
  const sheetData = useSheetData({ token, user });
  const {
    sheetId, setSheetId, activeFilename, setActiveFilename, 
    data, setData, headers, setHeaders, 
    sortConfig, setSortConfig, columnFilters, setColumnFilters,
    isBatchLoading, setIsBatchLoading, hasMoreData, setHasMoreData
  } = sheetData;
  const viewsHook = useViews({ sheetId, token, user });
  const { 
    views, setViews, selectedViewId, setSelectedViewId, 
    activeViewConfig, showColumnSelector, setShowColumnSelector, 
    pendingViewName, setPendingViewName 
  } = viewsHook;
  const [inviteToken, setInviteToken] = useState("");
  const [inviteInfo, setInviteInfo] = useState(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [invitePassword, setInvitePassword] = useState("");
  const [inviteRepeat, setInviteRepeat] = useState("");

  const dashboardI18n = useDashboardI18n({ enabled: !!user });
  const [workspaceView, setWorkspaceView] = useState("home");
  const pendingSharedViewRef = useRef({ viewId: "", sheetId: "" });
  const landingViewInitializedForUserRef = useRef(null);

  // Secondary Data (Comparison Mode)
  const [secondaryData, setSecondaryData] = useState([]);
  const [secondaryHeaders, setSecondaryHeaders] = useState([]);
  const [secondarySortConfig, setSecondarySortConfig] = useState(null);
  const [secondaryIsBatchLoading, setSecondaryIsBatchLoading] = useState(false);
  const [secondaryHasMoreData, setSecondaryHasMoreData] = useState(true);
  const [secondarySheetId, setSecondarySheetId] = useState("");
  const [secondaryTab, setSecondaryTab] = useState(null);
  const [primaryDlpMaskedColumns, setPrimaryDlpMaskedColumns] = useState([]);
  const [secondaryDlpMaskedColumns, setSecondaryDlpMaskedColumns] = useState([]);

  const BATCH_SIZE = 200;
  const primaryLoadOffsetRef = useRef(null);
  const secondaryLoadOffsetRef = useRef(null);
  const primaryLoadSeqRef = useRef(0);
  const secondaryLoadSeqRef = useRef(0);
  const primaryLatestLoadSeqRef = useRef(0);
  const secondaryLatestLoadSeqRef = useRef(0);
  const primaryAbortControllerRef = useRef(null);
  const secondaryAbortControllerRef = useRef(null);
  const primaryLoadedContextRef = useRef({ sheet: "", tab: "", view: "" });
  const skipNextPrimaryAutoLoadRef = useRef(false);

  // Upload, filtering, and review prompt state owned by the workspace shell.
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
  const LAST_VIEWED_SHEET_CONTEXT_KEY = "lastViewedSheetContext";


  // View editor state not owned by useViews.
  const [viewLevel, setViewLevel] = useState("revision");
  const [editingViewId, setEditingViewId] = useState(null);
  const [visibleColumns, setVisibleColumns] = useState([]); // columns to save
  const [secondaryVisibleColumns, setSecondaryVisibleColumns] = useState([]);
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
              const headerMissing = !headers.includes(col) && !headers.some((h) => String(h || "").trim().toLowerCase() === String(col || "").trim().toLowerCase());
              if (headerMissing) continue;

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
    const masked = new Set((Array.isArray(primaryDlpMaskedColumns) ? primaryDlpMaskedColumns : []).map((h) => String(h || "").trim().toLowerCase()).filter(Boolean));
    const blocked = (col) => {
      const normalized = String(col || "").trim().toLowerCase();
      return !!normalized && masked.has(normalized);
    };
    if (!resolvedValue) return;
    if (blocked(resolvedValue) || blocked(resolvedDate) || blocked(resolvedSegment)) return;

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
  }, [headers, primaryDlpMaskedColumns]);

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

  const applyLoadedRows = (sid, raw, preserveFilters = false, append = false, activeTabHint = null) => {
    const rows = Array.isArray(raw) ? raw : [];
    if (!raw || !Array.isArray(raw)) {
      console.warn("loadData: response is not an array", raw);
      if (!append) {
        setData([]);
        setHeaders([]);
      }
      if (append) {
        setHasMoreData(false);
        return;
      }
      return;
    }
    
    if (append) {
        setData(prev => [...prev, ...rows]);
        if (rows.length === 0) setHasMoreData(false);
    } else {
        setData(rows);
        const isSameSheet = String(sid) === String(sheetId);
        const heads = rows.length
          ? Object.keys(rows[0])
          : ((preserveFilters || isSameSheet) ? headers : []);
        setHeaders(heads);
        setHasMoreData(rows.length > 0);
        primaryLoadedContextRef.current = {
          sheet: String(sid || ""),
          tab: String(activeTabHint || activeTab || ""),
          view: String(selectedViewId || ""),
        };
    }

    setSheetId(sid);
    localStorage.setItem("sheetId", sid);
    const persisted = {
      sheetId: String(sid),
      activeTab: activeTabHint || activeTab || null,
      savedAt: Date.now(),
    };
    try {
      localStorage.setItem(LAST_VIEWED_SHEET_CONTEXT_KEY, JSON.stringify(persisted));
    } catch {
      // localStorage unavailable
    }
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
    if (!append) {
      const abortRef = isPrimary ? primaryAbortControllerRef : secondaryAbortControllerRef;
      try {
        if (abortRef.current) abortRef.current.abort();
      } catch {}
      abortRef.current = new AbortController();
    }
    const requestSignal = isPrimary ? primaryAbortControllerRef.current?.signal : secondaryAbortControllerRef.current?.signal;
    const requestSeq = (isPrimary ? primaryLoadSeqRef : secondaryLoadSeqRef).current + 1;
    if (isPrimary) primaryLoadSeqRef.current = requestSeq;
    else secondaryLoadSeqRef.current = requestSeq;
    if (isPrimary) primaryLatestLoadSeqRef.current = requestSeq;
    else secondaryLatestLoadSeqRef.current = requestSeq;

    if (!append) {
      if (isPrimary) {
        setHasMoreData(true);
      } else {
        setSecondaryHasMoreData(true);
      }
    }
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
      if (DEBUG_SPREADSHEET) {
        console.log("[spreadsheet] requesting batch", {
          context,
          sid,
          append,
          limit,
          offset,
          tabName: tabName || null,
          hasMoreData: isPrimary ? hasMoreData : secondaryHasMoreData,
          isLoading: isPrimary ? isBatchLoading : secondaryIsBatchLoading,
        });
      }

      const cacheKey = getDataCacheKey(sid, tabName) + "?" + params.toString();
      if (preferCache && !append && isPrimary && tabDataCacheRef.current[cacheKey]) {
        applyLoadedRows(sid, tabDataCacheRef.current[cacheKey], preserveFilters, false, tabName);
        return;
      }

      const sheetDataParams = new URLSearchParams(params.toString());
      sheetDataParams.append("_ts", Date.now().toString());
      const url = `${API}/sheets/${sid}/data?${sheetDataParams.toString()}`;
      const res = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        signal: requestSignal,
      });
      const raw = res.data;
      const rawDlpMaskedColumns = res?.headers?.["x-dlp-masked-columns"];
      let parsedDlpMaskedColumns = [];
      if (typeof rawDlpMaskedColumns === "string" && rawDlpMaskedColumns.trim()) {
        try {
          const parsed = JSON.parse(rawDlpMaskedColumns);
          parsedDlpMaskedColumns = Array.isArray(parsed) ? parsed.map((v) => String(v)) : [];
        } catch {
          parsedDlpMaskedColumns = [];
        }
      }
      if (isPrimary) setPrimaryDlpMaskedColumns(parsedDlpMaskedColumns);
      else setSecondaryDlpMaskedColumns(parsedDlpMaskedColumns);
      if (requestSeq !== (isPrimary ? primaryLatestLoadSeqRef.current : secondaryLatestLoadSeqRef.current)) {
        return;
      }
      if (DEBUG_SPREADSHEET) {
        const count = Array.isArray(raw) ? raw.length : 0;
        console.log("[spreadsheet] received batch", {
          context,
          sid,
          count,
          append,
          offset,
          nextHasMore: count > 0,
          status: res?.status,
          code: res?.statusText,
        });
      }
      const activeViewConfig = (() => {
        const v = views.find((vv) => String(vv.id) === String(selectedViewId));
        if (!v) return null;
        return typeof v.config === "string" ? (() => { try { return JSON.parse(v.config); } catch { return null; } })() : v.config;
      })();

      if (isPrimary) {
          if (!append) tabDataCacheRef.current[cacheKey] = Array.isArray(raw) ? raw : [];
          applyLoadedRows(sid, raw, preserveFilters, append, tabName);
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
              if (effectiveSecondaryRows.length === 0) setSecondaryHasMoreData(false);
          } else {
              setSecondaryData(effectiveSecondaryRows);
              setSecondaryHeaders(effectiveSecondaryRows.length ? Object.keys(effectiveSecondaryRows[0]) : []);
              setSecondaryHasMoreData(effectiveSecondaryRows.length > 0);
          }
          if (DEBUG_SPREADSHEET) {
            const count = Array.isArray(raw) ? raw.length : 0;
            console.log("[spreadsheet] received secondary batch", {
              context,
              sid,
              count,
              append,
              offset,
              nextHasMore: count > 0,
            });
          }
      }
    } catch (e) {
      if (e?.name === "CanceledError" || e?.code === "ERR_CANCELED") return;
      console.error(e);
      if (context === "primary") {
        if (!append) {
          setHasMoreData(false);
          setData([]);
          setHeaders([]);
        } else {
          setHasMoreData(false);
        }
      } else {
        if (!append) {
          setSecondaryData([]);
          setSecondaryHeaders([]);
          setSecondaryHasMoreData(false);
        } else {
          setSecondaryHasMoreData(false);
        }
      }
    } finally {
      if (isPrimary) setIsBatchLoading(false);
      else setSecondaryIsBatchLoading(false);
    }
  };

  const onLoadMore = () => {
    if (isBatchLoading || !hasMoreData || !sheetId) return Promise.resolve();
    const nextOffset = data.length;
    if (primaryLoadOffsetRef.current === nextOffset) return Promise.resolve();
    if (DEBUG_SPREADSHEET) {
      console.log("[spreadsheet] onLoadMore", {
        appendOffset: nextOffset,
        loaded: data.length,
      });
    }
    primaryLoadOffsetRef.current = nextOffset;
    const request = loadData(sheetId, true, activeTab, { 
        offset: data.length, 
        append: true,
        preferCache: false 
    });
    request.finally(() => {
      primaryLoadOffsetRef.current = null;
    });
    return request;
  };

  const onLoadMoreSecondary = (filters = null) => {
    if (secondaryIsBatchLoading || !secondaryHasMoreData || !secondarySheetId) return Promise.resolve();
    const nextOffset = secondaryData.length;
    if (secondaryLoadOffsetRef.current === nextOffset) return Promise.resolve();
    if (DEBUG_SPREADSHEET) {
      console.log("[spreadsheet] onLoadMoreSecondary", {
        appendOffset: nextOffset,
        loaded: secondaryData.length,
      });
    }
    secondaryLoadOffsetRef.current = nextOffset;
    const request = loadData(secondarySheetId, true, secondaryTab, {
        offset: secondaryData.length,
        append: true,
        context: "secondary",
        preferCache: false,
        filters
    });
    request.finally(() => {
      secondaryLoadOffsetRef.current = null;
    });
    return request;
  };

  const requestPrimaryReload = React.useCallback(() => {
    if (!sheetId) return;
    primaryLoadedContextRef.current = { sheet: "", tab: "", view: "" };
    loadData(sheetId, true, activeTab, { preferCache: false });
  }, [activeTab, loadData, sheetId]);

  // Re-fetch data when spreadsheet context changes.
  useEffect(() => {
    if (!sheetId || !user) return;
    if (skipNextPrimaryAutoLoadRef.current) {
      skipNextPrimaryAutoLoadRef.current = false;
      return;
    }

    const loaded = primaryLoadedContextRef.current || {};
    const sameContext = (
      String(loaded.sheet || "") === String(sheetId || "")
      && String(loaded.tab || "") === String(activeTab || "")
      && String(loaded.view || "") === String(selectedViewId || "")
    );

    if (sameContext) return;

    loadData(sheetId, true, activeTab, { preferCache: false });
  }, [sheetId, user, activeTab, selectedViewId]);

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
  };

  const hydrateSheetContext = async (sid, options = {}) => {
    if (!sid) return;
    skipNextPrimaryAutoLoadRef.current = true;
    if (String(sid) !== String(sheetId)) {
      setSelectedViewId("");
    }
    const safeSid = String(sid).trim();
    if (!safeSid) return;
    if (String(sheetId) !== safeSid) {
      setSheetId(safeSid);
      localStorage.setItem("sheetId", safeSid);
    }
    const {
      preferredTab = null,
      preserveFilters = false,
      preferCache = true,
    } = options;
    const cachedTabs = tabListCacheRef.current[safeSid];
    const hasCachedTabs = Array.isArray(cachedTabs) && cachedTabs.length > 0;
    const immediateTab = hasCachedTabs
      ? ((preferredTab && cachedTabs.includes(preferredTab)) ? preferredTab : cachedTabs[0])
      : null;
    const tabListPromise = fetchTabs(safeSid, { preferredTab, preserveActive: false });
    if (hasCachedTabs) {
      await loadData(safeSid, preserveFilters, immediateTab, { preferCache });
      return;
    }
    const tabList = await tabListPromise;
    const resolvedTab = Array.isArray(tabList) && tabList.length
      ? ((preferredTab && tabList.includes(preferredTab)) ? preferredTab : tabList[0])
      : null;
    await loadData(safeSid, preserveFilters, resolvedTab, { preferCache: false });
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
        const dlpWarning = String(res.data?.dlp?.warningMessage || "").trim();
        setUploadProgressError(dlpWarning || "Upload queued for import processing.");
        refreshReportSources();
        return;
      }
      if (res.data?.status === "pending_approval") {
        maybePromptBusinessClassification(res.data);
        setUploadProgressError("Uploaded and held for review before publishing.");
        setUploadDisplayName("");
        setReportSourceName("");
        refreshReportSources();
        return;
      }
      if (res.data.sheetId) {
        if (res.data?.dlp?.message) {
          setUploadProgressError(String(res.data.dlp.message));
        } else if (res.data?.dlp?.warning && res.data?.dlp?.warningMessage) {
          setUploadProgressError(String(res.data.dlp.warningMessage));
        }
        const sid = String(res.data.sheetId);
        const activeName = res.data.display_name || res.data.filename;
        setActiveFilename(activeName);
        localStorage.setItem("activeFilename", activeName);
        setUploadDisplayName("");
        setReportSourceName("");
        
        if (res.data.tabs && res.data.tabs.length > 0) {
          tabListCacheRef.current[sid] = res.data.tabs;
        }

        // Use unified context hydration to avoid race conditions
        await hydrateSheetContext(sid, {
          preferredTab: (res.data.tabs && res.data.tabs.length > 0) ? res.data.tabs[0] : null,
          preserveFilters: false,
          preferCache: false
        });

        maybePromptBusinessClassification(res.data);
        
        // Refresh file lists
        refreshReportSources();
        if (token) {
          axios.get(`${API}/my-sheets`, { headers: { Authorization: `Bearer ${token}` } })
            .then(r => setMyFiles(r.data || []));
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
        maybePromptBusinessClassification(res.data);
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
        localStorage.removeItem(LAST_VIEWED_SHEET_CONTEXT_KEY);
        localStorage.removeItem("activeTab");
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

  const getParsedLastViewedContext = () => {
    const raw = localStorage.getItem(LAST_VIEWED_SHEET_CONTEXT_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      const sheetId = String(parsed.sheetId || "").trim();
      if (!sheetId) return null;
      return {
        sheetId,
        activeTab: parsed.activeTab ? String(parsed.activeTab) : null,
      };
    } catch {
      return null;
    }
  };

  const pickLatestSheetIdFromList = (files = []) => {
    if (!Array.isArray(files) || !files.length) return null;
    const prioritized = files.filter((f) => f?.active || f?.is_current_source_version);
    const candidates = prioritized.length ? prioritized : files;
    const sorted = [...candidates].sort((a, b) => {
      const at = Date.parse(a?.uploaded_at || a?.created_at || 0) || 0;
      const bt = Date.parse(b?.uploaded_at || b?.created_at || 0) || 0;
      return bt - at;
    });
    return String(sorted[0]?.id || "").trim() || null;
  };

  const isPreferredSheet = (files = [], sheetId) => {
    const candidate = (Array.isArray(files) ? files : []).find((f) => String(f?.id || "") === String(sheetId || ""));
    if (!candidate) return false;
    return Boolean(candidate.active || candidate.is_current_source_version);
  };

  useEffect(() => {
    if (!token || !user) {
      setMyFiles([]);
      setReportSources([]);
      setReportSourceImports({});
      return;
    }

    (async () => {
      try {
        const [mySheetsRes] = await Promise.all([
          axios.get(`${API}/my-sheets`, { headers: { Authorization: `Bearer ${token}` } }),
          refreshReportSources(),
        ]);
        const files = Array.isArray(mySheetsRes?.data) ? mySheetsRes.data : [];
        setMyFiles(files);

        const savedSheetId = localStorage.getItem("sheetId");
        const savedTab = localStorage.getItem("activeTab");
        const lastViewed = getParsedLastViewedContext();

        const availableSheetIds = new Set(files.map((f) => String(f?.id)));
        let targetSheetId = savedSheetId && savedSheetId !== "null" && availableSheetIds.has(String(savedSheetId))
          ? String(savedSheetId)
          : null;
        if (targetSheetId && !isPreferredSheet(files, targetSheetId)) {
          targetSheetId = null;
        }

        if (!targetSheetId && lastViewed?.sheetId) {
          if (availableSheetIds.has(String(lastViewed.sheetId))) {
            targetSheetId = String(lastViewed.sheetId);
          }
          if (targetSheetId && !isPreferredSheet(files, targetSheetId)) {
            targetSheetId = null;
          }
        }

        if (!targetSheetId) {
          targetSheetId = pickLatestSheetIdFromList(files);
          localStorage.removeItem("sheetId");
          localStorage.removeItem("activeTab");
          localStorage.removeItem("activeFilename");
          localStorage.removeItem(LAST_VIEWED_SHEET_CONTEXT_KEY);
          if (!targetSheetId) {
            setSheetId(null);
            setActiveFilename("");
            setTabs([]);
            setActiveTab("");
          }
        }

        if (targetSheetId) {
          const preferredTab = lastViewed?.sheetId === targetSheetId && lastViewed.activeTab
            ? lastViewed.activeTab
            : (savedSheetId && savedTab ? savedTab : null);
          hydrateSheetContext(targetSheetId, {
            preferredTab,
            preserveFilters: false,
            preferCache: true,
          });
        }
      } catch (e) {
        if (user) console.error("Fetch files failed", e);
      }
    })();
  }, [token, user, refreshReportSources]);

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
    if (!user?.id) {
      landingViewInitializedForUserRef.current = null;
      return;
    }
    if (landingViewInitializedForUserRef.current === user.id) return;
    landingViewInitializedForUserRef.current = user.id;
    // Publish-first default for stakeholders; admins keep edit/explore-first flow.
    setWorkspaceView(isFrontendAdminUser(user) ? "grid" : "home");
  }, [user?.id, user, isFrontendAdminUser]);

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
    const params = new URLSearchParams(window.location.search);
    const viewId = String(params.get("view") || "").trim();
    const linkedSheetId = String(params.get("sheet") || "").trim();
    pendingSharedViewRef.current = { viewId, sheetId: linkedSheetId };
  }, []);

  useEffect(() => {
    if (!user) return;
    const pending = pendingSharedViewRef.current || { viewId: "", sheetId: "" };
    if (!pending.viewId) return;
    if (pending.sheetId && String(sheetId || "") !== pending.sheetId) {
      setSheetId(pending.sheetId);
    }
  }, [user, sheetId, setSheetId]);

  useEffect(() => {
    if (!user) return;
    const pending = pendingSharedViewRef.current || { viewId: "", sheetId: "" };
    if (!pending.viewId) return;
    if (pending.sheetId && String(sheetId || "") !== pending.sheetId) return;
    const hasSharedView = (views || []).some((v) => String(v.id) === String(pending.viewId));
    if (!hasSharedView) return;
    setSelectedViewId(String(pending.viewId));
    pendingSharedViewRef.current = { viewId: "", sheetId: "" };
  }, [user, sheetId, views, setSelectedViewId]);

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
    authHandleLogout();
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
                    error={loginError}
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
                    dlpMaskedColumns={primaryDlpMaskedColumns}
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
                    chatSection={
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
                    }
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
                    dlpMaskedColumns={primaryDlpMaskedColumns}
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
                    chatSection={
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
                    }
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
                      error={loginError}
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
                      onRequestPrimaryReload={requestPrimaryReload}
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
                      myFiles={myFiles} loadStored={(id, selectedName = "") => { handleSwitchSheet(id, selectedName); }}
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
                      hasMoreData={hasMoreData}
                      secondaryData={secondaryData}
                      secondaryHeaders={secondaryHeaders}
                      secondarySortConfig={secondarySortConfig}
                      secondaryIsBatchLoading={secondaryIsBatchLoading}
                      onLoadMoreSecondary={onLoadMoreSecondary}
                      secondaryHasMoreData={secondaryHasMoreData}
                      secondarySheetId={secondarySheetId}
                      setSecondarySheetId={setSecondarySheetId}
                      secondaryTab={secondaryTab}
                      setSecondaryTab={setSecondaryTab}
                      primaryDlpMaskedColumns={primaryDlpMaskedColumns}
                      secondaryDlpMaskedColumns={secondaryDlpMaskedColumns}
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
                      dlpMaskedColumns={primaryDlpMaskedColumns}
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
                      chatSection={
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
                      }
                    />
                    )}
                    {workspaceView === "grid" && (
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
            <Route path="/workspace/imports" element={
              <ErrorBoundary>
                {authChecking ? (
                  <div className="min-h-screen w-full flex items-center justify-center bg-[#fafafa]">
                    <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Loading workspace...</div>
                  </div>
                ) : !user ? (
                  <Navigate to="/login" replace />
                ) : (
                    <DashboardBody
                    user={user} token={token} API={API}
                    importsOnly
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
                    onRequestPrimaryReload={requestPrimaryReload}
                    refreshReportSources={refreshReportSources}
                    onBusinessClassificationGuess={maybePromptBusinessClassification}
                    selectedViewId={selectedViewId} setSelectedViewId={setSelectedViewId}
                    views={views} setViews={setViews}
                    setPendingViewName={setPendingViewName}
                    setShowColumnSelector={setShowColumnSelector}
                    setSaveViewConfigOverride={setSaveViewConfigOverride}
                    setEditingViewId={setEditingViewId}
                    sortedData={sortedData}
                    displayHeaders={displayHeaders}
                    openFilterCol={openFilterCol} setOpenFilterCol={setOpenFilterCol}
                    columnFilters={columnFilters} setColumnFilters={setColumnFilters}
                    sortConfig={sortConfig} requestSort={requestSort}
                    uniqueValuesByColumn={uniqueValuesByColumn}
                    pivotOn={pivotOn} setPivotOn={setPivotOn}
                    pivotRowKey={pivotRowKey} setPivotRowKey={setPivotRowKey}
                    pivotColKey={pivotColKey} setPivotColKey={setPivotColKey}
                    pivotValKey={pivotValKey} setPivotValKey={setPivotValKey}
                    pivotAgg={pivotAgg} setPivotAgg={setPivotAgg}
                    pivotRows={pivotRows}
                    pivotHeaders={pivotHeaders}
                    pieData={pieData}
                    resetPivot={resetPivot}
                    pivotChartRef={pivotChartRef}
                    twoOn={twoOn} setTwoOn={setTwoOn}
                    condCol1={condCol1} setCondCol1={setCondCol1}
                    condCol2={condCol2} setCondCol2={setCondCol2}
                    valueCol={valueCol} setValueCol={setValueCol}
                    summaryData={summaryData} resetSummary={resetSummary}
                    trendsOn={trendsOn} setTrendsOn={setTrendsOn}
                    trendsDateKey={trendsDateKey} setTrendsDateKey={setTrendsDateKey}
                    trendsValueKey={trendsValueKey} setTrendsValueKey={setTrendsValueKey}
                    trendGranularity={trendGranularity} setTrendGranularity={setTrendGranularity}
                    yearsBack={yearsBack} setYearsBack={setYearsBack}
                    trendsData={trendsData}
                    trendYearOptions={trendYearOptions}
                    compareYears={compareYears} setCompareYears={setCompareYears}
                    maxYear={trendYearOptions[0]}
                    exportCSV={exportCSV} exportXLSX={exportXLSX} exportPDF={exportPDF}
                    tableContainerRef={tableContainerRef}
                    filterAnchorRefs={filterAnchorRefs}
                    filterBtnRefs={filterBtnRefs}
                    myFiles={myFiles} loadStored={(id, selectedName = "") => { handleSwitchSheet(id, selectedName); }}
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
                    hasMoreData={hasMoreData}
                    secondaryData={secondaryData}
                    secondaryHeaders={secondaryHeaders}
                    secondarySortConfig={secondarySortConfig}
                    secondaryIsBatchLoading={secondaryIsBatchLoading}
                    onLoadMoreSecondary={onLoadMoreSecondary}
                    secondaryHasMoreData={secondaryHasMoreData}
                    secondarySheetId={secondarySheetId}
                    setSecondarySheetId={setSecondarySheetId}
                    secondaryTab={secondaryTab}
                    setSecondaryTab={setSecondaryTab}
                    workspaceChartStateRef={workspaceChartStateRef}
                    locale={dashboardI18n.locale}
                    copy={dashboardI18n.copy}
                  />
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
