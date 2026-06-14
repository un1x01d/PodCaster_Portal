import React from "react";
import { Link } from "react-router-dom";
import { DASHBOARD_COPY_EN, formatTemplate, normalizeDashboardLocale, isDashboardEnglish } from "../../hooks/useDashboardI18n";
import api from "../../api";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  AreaChart,
  Area,
  ReferenceArea,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import SheetTabBar from "./SheetTabBar";

const DATE_HINTS = ["date", "time", "month", "year", "day"];
const METRIC_HINTS = ["revenue", "sales", "amount", "total", "cost", "income", "value", "ebitda"];
const PROFIT_HINTS = ["profit", "net income", "gross income"];
const REVENUE_HINTS = ["revenue", "sales", "turnover", "booking", "billings"];
const INCOME_HINTS = ["income", "net income", "gross income", "operating income", "earnings"];
const EXPENSE_HINTS = ["expense", "cost", "cogs", "opex", "operating expense"];
const PIE_COLORS = ["#2f5d8a", "#4b7aa3", "#5f93b2", "#6da8a2", "#7e8ea8", "#5d86c7", "#4f6f96", "#6c8fa8"];

function metricValue(value, locale) {
  if (value === null || value === undefined) return "0";
  if (typeof value === "number") {
    return value.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  return String(value);
}

function pct(value) {
  if (!Number.isFinite(value)) return "0%";
  return `${value.toFixed(2)}%`;
}

function formatMoneyIfLarge(value, locale) {
  if (!Number.isFinite(value)) return "0";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  return `${sign}$${abs.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatCompactCurrency(value, locale) {
  if (!Number.isFinite(value)) return "$0";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(2)}K`;
  return `${sign}$${abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatSparkValue(value, type, locale) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "0";
  if (type === "percent") return `${numeric.toFixed(2)}%`;
  if (type === "count") return Math.round(numeric).toLocaleString(locale);
  return formatMoneyIfLarge(numeric, locale);
}

function formatPinnedDisplayValue(raw, title = "") {
  const text = String(raw ?? "").trim();
  if (!text) return "";
  const numeric = Number(text.replace(/[$,]/g, ""));
  if (!Number.isFinite(numeric)) return text;

  const isCurrency = title && /price|cost|revenue|income|profit|earnings|salary|wage|amount|balance|total|summ|ebitda|val|fee|tax|debt|loan|payment|capital|asset|liability|equity|budget|spend|cash|funding|sales|purchase|gross|net|operating|opex|capex|amortization|depreciation|interest|dividend|expenditure|cogs|доход|выручка|прибуток|оборот|расход|витрати|затраты|опекс|капекс/i.test(String(title));
  const isPercent = title && /percent|margin|rate|ratio|%|markup|yield|growth|change|variance|contribution|roi|roe|roa|discount|utilization|liquidity|solvency|leverage|turnover/i.test(String(title));

  if (isCurrency) {
    return "$" + numeric.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (isPercent) {
    return numeric.toFixed(2) + "%";
  }

  return numeric.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatMMDDYYYY(dateLike) {
  const d = dateLike instanceof Date ? dateLike : new Date(dateLike);
  if (Number.isNaN(d.getTime())) return "";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  return `${mm}-${dd}-${yyyy}`;
}

function formatPeriodAsDateRange(period, locale) {
  if (typeof period !== "string") return String(period || "");
  if (/^\d{1,2}$/.test(period)) {
    const month = Number(period);
    if (month >= 1 && month <= 12) {
      const y = new Date().getFullYear();
      const start = new Date(y, month - 1, 1);
      const end = new Date(y, month, 0);
      return `${formatMMDDYYYY(start)} - ${formatMMDDYYYY(end)}`;
    }
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(period)) {
    const [y, m, d] = period.split("-").map((v) => Number(v));
    if (!y || !m || !d) return period;
    const sameDay = formatMMDDYYYY(new Date(y, m - 1, d));
    return `${sameDay} - ${sameDay}`;
  }
  if (!/^\d{4}-\d{2}$/.test(period)) return String(period || "");
  const [y, m] = period.split("-").map((v) => Number(v));
  if (!y || !m || m < 1 || m > 12) return period;
  const start = new Date(y, m - 1, 1);
  const end = new Date(y, m, 0);
  return `${formatMMDDYYYY(start)} - ${formatMMDDYYYY(end)}`;
}

function formatPeriodForTooltip(period, locale) {
  if (typeof period !== "string") return String(period || "");
  if (/^\d{1,2}$/.test(period)) {
    const month = Number(period);
    if (month >= 1 && month <= 12) {
      const y = new Date().getFullYear();
      return formatMMDDYYYY(new Date(y, month - 1, 1));
    }
  }
  if (/^\d{4}-\d{2}$/.test(period)) {
    const [y, m] = period.split("-").map((v) => Number(v));
    if (!y || !m || m < 1 || m > 12) return period;
    return formatMMDDYYYY(new Date(y, m - 1, 1));
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(period)) {
    const [y, m, d] = period.split("-").map((v) => Number(v));
    if (!y || !m || !d) return period;
    return formatMMDDYYYY(new Date(y, m - 1, d));
  }
  return String(period || "");
}

function formatPeriodAsExactDate(period, locale) {
  if (typeof period !== "string") return String(period || "");
  if (/^\d{4}$/.test(period)) {
    return formatMMDDYYYY(new Date(Number(period), 0, 1));
  }
  if (/^\d{1,2}$/.test(period)) {
    const month = Number(period);
    if (month >= 1 && month <= 12) return formatMMDDYYYY(new Date(new Date().getFullYear(), month - 1, 1));
  }
  if (/^\d{4}-\d{2}$/.test(period)) {
    const [y, m] = period.split("-").map((v) => Number(v));
    if (!y || !m || m < 1 || m > 12) return period;
    return formatMMDDYYYY(new Date(y, m - 1, 1));
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(period)) {
    const [y, m, d] = period.split("-").map((v) => Number(v));
    if (!y || !m || !d) return period;
    return formatMMDDYYYY(new Date(y, m - 1, d));
  }
  return String(period || "");
}

function toDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function toMonthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function toBucketKey(d, granularity) {
  return granularity === "month" ? toMonthKey(d) : toDateKey(d);
}

function formatDateDisplay(date, locale) {
  return formatMMDDYYYY(date);
}

function periodKeyToBounds(key) {
  if (typeof key !== "string") return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    const [y, m, d] = key.split("-").map((v) => Number(v));
    const date = new Date(y, m - 1, d);
    return { start: date, end: date };
  }
  if (/^\d{4}-\d{2}$/.test(key)) {
    const [y, m] = key.split("-").map((v) => Number(v));
    return { start: new Date(y, m - 1, 1), end: new Date(y, m, 0) };
  }
  return null;
}

function parseNumber(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v === null || v === undefined || v === "") return null;
  const n = Number.parseFloat(String(v).replace(/[$,%\s,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function parseDate(v) {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return new Date(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate());
  }
  if (typeof v === "string") {
    const text = v.trim();
    const isoDateOnly = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoDateOnly) {
      const [, y, m, d] = isoDateOnly;
      return new Date(Number(y), Number(m) - 1, Number(d));
    }
    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) {
      return new Date(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate());
    }
  }
  const n = Number(v);
  if (!Number.isNaN(n) && n > 25569 && n < 60000) {
    const excelDate = new Date(Date.UTC(1970, 0, 1) + (n - 25569) * 86400 * 1000);
    if (!Number.isNaN(excelDate.getTime())) return excelDate;
  }
  return null;
}

function toIsoDateLocal(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseIsoDate(v) {
  if (!v || typeof v !== "string") return null;
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function formatMonthTitle(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function KpiCalendarField({ label, value, onChange }) {
  const selectedDate = parseIsoDate(value);
  const [open, setOpen] = React.useState(false);
  const [monthAnchor, setMonthAnchor] = React.useState(() => {
    const base = selectedDate || new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });

  React.useEffect(() => {
    if (!selectedDate) return;
    setMonthAnchor(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1));
  }, [value]);

  const monthStart = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth(), 1);
  const monthEnd = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() + 1, 0);
  const startWeekday = monthStart.getDay(); // 0=Sun
  const daysInMonth = monthEnd.getDate();
  const cells = [];
  for (let i = 0; i < startWeekday; i += 1) cells.push(null);
  for (let d = 1; d <= daysInMonth; d += 1) cells.push(new Date(monthAnchor.getFullYear(), monthAnchor.getMonth(), d));
  while (cells.length % 7 !== 0) cells.push(null);

  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const selectedIso = value || "";
  const todayIso = toIsoDateLocal(new Date());

  return (
    <div className="relative">
      <label className="flex flex-col gap-1 text-[10px] font-bold text-slate-600">
        <span>{label}</span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-bold text-slate-900 text-left hover:bg-slate-50"
          style={{ fontFamily: "'Aptos', 'Segoe UI Variable Text', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif" }}
        >
          {selectedDate ? formatMMDDYYYY(selectedDate) : (value === "latest" ? "Latest" : "Select date")}
        </button>
      </label>
      {open && (
        <div
          className="absolute z-[220] mt-1 w-[220px] rounded-md border border-slate-300 bg-white shadow-lg p-2"
          style={{ fontFamily: "'Aptos', 'Segoe UI Variable Text', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif" }}
        >
          <div className="mb-1 flex items-center justify-between">
            <button
              type="button"
              className="h-6 w-6 rounded border border-slate-300 bg-white text-[10px] font-bold text-slate-700 hover:bg-slate-50"
              onClick={() => setMonthAnchor((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
            >
              ‹
            </button>
            <div className="text-[10px] font-bold text-slate-700">{formatMonthTitle(monthAnchor)}</div>
            <button
              type="button"
              className="h-6 w-6 rounded border border-slate-300 bg-white text-[10px] font-bold text-slate-700 hover:bg-slate-50"
              onClick={() => setMonthAnchor((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
            >
              ›
            </button>
          </div>
          <div className="grid grid-cols-7 gap-[2px]">
            {weekday.map((w, idx) => (
              <div
                key={`wk-${w}`}
                className={`h-5 flex items-center justify-center text-[9px] font-bold ${
                  idx === 0 ? "bg-blue-50 text-blue-700 rounded-sm" : "text-slate-500"
                }`}
              >
                {w}
              </div>
            ))}
            {cells.map((d, idx) => {
              if (!d) return <div key={`blank-${idx}`} className="h-6" />;
              const iso = toIsoDateLocal(d);
              const isSelected = iso === selectedIso;
              const isToday = iso === todayIso;
              const isSunday = d.getDay() === 0;
              return (
                <button
                  type="button"
                  key={`day-${iso}`}
                  className={`h-6 rounded-sm text-[10px] font-bold transition-colors ${
                    isSelected
                      ? "bg-blue-600 text-white"
                      : isSunday
                        ? "bg-blue-50 text-blue-700 hover:bg-blue-100"
                        : "text-slate-700 hover:bg-slate-100"
                  } ${isToday && !isSelected ? "ring-1 ring-blue-300" : ""}`}
                  onClick={() => {
                    onChange(iso);
                    setOpen(false);
                  }}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex gap-1">
            <button
              type="button"
              className="flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-[10px] font-bold text-slate-700 hover:bg-slate-50"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
            >
              Clear
            </button>
            <button
              type="button"
              className="flex-1 rounded border border-indigo-200 bg-indigo-50 px-2 py-1 text-[10px] font-bold text-indigo-700 hover:bg-indigo-100 transition-colors"
              onClick={() => {
                onChange("latest");
                setOpen(false);
              }}
            >
              Latest
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function buildSeriesFromRows(rows, dateCol, valueGetter, granularity = "day") {
  if (!dateCol || !Array.isArray(rows)) return [];
  const map = new Map();
  rows.forEach((r) => {
    const d = parseDate(r?.[dateCol]);
    if (!d) return;
    const value = valueGetter(r);
    if (!Number.isFinite(value)) return;
    const period = toBucketKey(d, granularity);
    map.set(period, (map.get(period) || 0) + value);
  });
  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([period, value]) => ({ period, value: Number(value.toFixed(2)) }));
}

function columnMatchScore(header, hints) {
  const normalized = header.toLowerCase();
  return hints.reduce((score, hint) => {
    if (normalized === hint) return score + 5;
    if (normalized.startsWith(`${hint} `) || normalized.endsWith(` ${hint}`)) return score + 4;
    if (normalized.includes(hint)) return score + 3;
    return score;
  }, 0);
}

function findBestSemanticColumn(numericCols, hints) {
  return [...numericCols]
    .map((c) => ({
      ...c,
      semanticScore: columnMatchScore(c.header, hints),
    }))
    .filter((c) => c.semanticScore > 0)
    .sort((a, b) => {
      if (a.semanticScore !== b.semanticScore) return b.semanticScore - a.semanticScore;
      return b.nonEmpty - a.nonEmpty;
    })[0]?.header || null;
}

function detectColumns(headers, rows) {
  const sample = rows.slice(0, 400);
  const stats = headers.map((h) => {
    let nonEmpty = 0;
    let numeric = 0;
    let date = 0;
    const unique = new Set();
    sample.forEach((r) => {
      const raw = r?.[h];
      if (raw === null || raw === undefined || raw === "") return;
      nonEmpty += 1;
      const n = parseNumber(raw);
      if (n !== null) numeric += 1;
      const d = parseDate(raw);
      if (d) date += 1;
      unique.add(String(raw));
    });
    return { header: h, nonEmpty, numeric, date, uniqueCount: unique.size };
  });

  const numericCols = stats.filter((s) => s.nonEmpty > 0 && s.numeric / s.nonEmpty >= 0.65);
  const dateCols = stats.filter((s) => {
    const hint = DATE_HINTS.some((k) => s.header.toLowerCase().includes(k));
    return s.nonEmpty > 0 && (s.date / s.nonEmpty >= 0.6 || hint);
  });
  const categoryCols = stats.filter((s) => {
    if (numericCols.some((n) => n.header === s.header)) return false;
    if (dateCols.some((d) => d.header === s.header)) return false;
    return s.uniqueCount >= 2 && s.uniqueCount <= 40;
  });

  const primaryMetricCandidates = numericCols.filter(
    (s) => !PROFIT_HINTS.some((k) => s.header.toLowerCase().includes(k))
  );

  const revenueCol = findBestSemanticColumn(numericCols, REVENUE_HINTS);
  const incomeCol = findBestSemanticColumn(numericCols, INCOME_HINTS);
  const profitCol = findBestSemanticColumn(numericCols, PROFIT_HINTS);
  const expenseCol = findBestSemanticColumn(numericCols, EXPENSE_HINTS);

  const metricCol = revenueCol || [...(primaryMetricCandidates.length ? primaryMetricCandidates : numericCols)].sort((a, b) => {
    const aHint = METRIC_HINTS.some((k) => a.header.toLowerCase().includes(k)) ? 1 : 0;
    const bHint = METRIC_HINTS.some((k) => b.header.toLowerCase().includes(k)) ? 1 : 0;
    if (aHint !== bHint) return bHint - aHint;
    return b.nonEmpty - a.nonEmpty;
  })[0]?.header || null;

  const dateCol = dateCols.sort((a, b) => b.nonEmpty - a.nonEmpty)[0]?.header || null;
  const categoryCol = categoryCols.sort((a, b) => a.uniqueCount - b.uniqueCount)[0]?.header || null;
  return { metricCol, dateCol, categoryCol, profitCol, incomeCol, revenueCol, expenseCol };
}

export default function DashboardHome({
  user,
  myFiles = [],
  reportSources = [],
  reportSourceImports = {},
  refreshReportSources = () => {},
  sheetId,
  activeFilename,
  tabs = [],
  activeTab = "",
  onTabChange,
  headers = [],
  sortedData = [],
  dlpMaskedColumns = [],
  columnFilters = {},
  views = [],
  pivotOn,
  twoOn,
  trendsOn,
  chatSection = null,
  insightSection = null,
  focusReviewQueue = false,
  onOpenWorkspace = null,
  locale,
  copy = DASHBOARD_COPY_EN,
}) {
  const ui = copy || DASHBOARD_COPY_EN;
  const PINNED_METRICS_KEY = "dashboardPinnedMetricsV1";
  const PINNED_AI_CACHE_MS = 60 * 60 * 1000;
  const KPI_OVERRIDES_KEY = "dashboardKpiOverridesV1";
  const EMPTY_PINNED_ITEM = { title: "Value", value: "", description: "", pinned: false };
  const ensurePinnedItems = (items) => {
    const source = Array.isArray(items) ? items : [];
    const out = [];
    for (let i = 0; i < 4; i += 1) {
      const row = source[i] || {};
      out.push({
        title: String(row.title ?? EMPTY_PINNED_ITEM.title),
        value: String(row.value ?? ""),
        description: String(row.description ?? ""),
        pinned: !!row.pinned,
      });
    }
    return out;
  };
  const [rangeDraft, setRangeDraft] = React.useState(null);
  const [appliedRange, setAppliedRange] = React.useState(null);
  const [pinnedInput, setPinnedInput] = React.useState({ items: ensurePinnedItems([]) });
  const [pinnedConfig, setPinnedConfig] = React.useState(null);
  const [queryOpen, setQueryOpen] = React.useState(false);
  const [pinnedLoaded, setPinnedLoaded] = React.useState(false);
  const [kpiOverrides, setKpiOverrides] = React.useState({});
  const [kpiDraftOverrides, setKpiDraftOverrides] = React.useState({});
  const [kpiEditorOpen, setKpiEditorOpen] = React.useState({});
  const [kpiOverridesLoaded, setKpiOverridesLoaded] = React.useState(false);
  const [reviewBusyId, setReviewBusyId] = React.useState("");
  const [reviewInlineErrorByImportId, setReviewInlineErrorByImportId] = React.useState({});
  const [headerRepairModal, setHeaderRepairModal] = React.useState({
    open: false,
    row: null,
    loading: false,
    saving: false,
    error: "",
    success: "",
    preview: null,
    tabName: "",
    previewLimit: 300,
    showHeaderRowTools: false,
    headerRowIndex: "",
    sourceHeader: "",
    targetHeader: "",
  });
  const reviewQueueRef = React.useRef(null);
  const autoOpenedHeaderRepairImportRef = React.useRef(new Set());
  const [topCategoriesConfig, setTopCategoriesConfig] = React.useState({
    title: "",
    categoryColumn: "",
    valueColumn: "",
    agg: "sum",
    aiQuery: "",
    aiValue: "",
    aiOverride: false,
  });
  const [topCategoriesEditOpen, setTopCategoriesEditOpen] = React.useState(false);
  const [trendEditOpen, setTrendEditOpen] = React.useState(false);
  const [trendConfig, setTrendConfig] = React.useState({
    title: "",
    lines: [],
    aiQuery: "",
    aiValue: "",
    aiOverride: false,
  });
  const autoSubmitKeyRef = React.useRef("");
  const [topCardsOrder, setTopCardsOrder] = React.useState([]);
  const [dragCardId, setDragCardId] = React.useState("");
  const [dropCardId, setDropCardId] = React.useState("");
  const [dashboardAiState, setDashboardAiState] = React.useState({
    pendingByKey: {},
    errorByKey: {},
  });
  const pinnedTitleTranslateInFlightRef = React.useRef(new Set());
  const pinnedTitleTranslateCooldownRef = React.useRef(new Map());
  const pinnedConfigRef = React.useRef(null);
  const aiRequestByPendingKeyRef = React.useRef({});
  const maskedColumnSet = React.useMemo(() => {
    const out = new Set();
    (Array.isArray(dlpMaskedColumns) ? dlpMaskedColumns : []).forEach((col) => {
      const normalized = String(col || "").trim().toLowerCase();
      if (normalized) out.add(normalized);
    });
    return out;
  }, [dlpMaskedColumns]);

  const isMaskedColumn = React.useCallback((col) => {
    const normalized = String(col || "").trim().toLowerCase();
    return !!normalized && maskedColumnSet.has(normalized);
  }, [maskedColumnSet]);

  const allowedHeaders = React.useMemo(
    () => headers.filter((h) => !isMaskedColumn(h)),
    [headers, isMaskedColumn]
  );

  React.useEffect(() => {
    pinnedConfigRef.current = pinnedConfig;
  }, [pinnedConfig]);

  const markAiPending = React.useCallback((key, pending) => {
    const safeKey = String(key || "").trim();
    if (!safeKey) return;
    setDashboardAiState((prev) => ({
      pendingByKey: { ...prev.pendingByKey, [safeKey]: !!pending },
      errorByKey: pending ? { ...prev.errorByKey, [safeKey]: "" } : prev.errorByKey,
    }));
  }, []);

  const setAiError = React.useCallback((key, errorMessage) => {
    const safeKey = String(key || "").trim();
    if (!safeKey) return;
    const message = String(errorMessage || "").trim();
    setDashboardAiState((prev) => ({
      pendingByKey: { ...prev.pendingByKey, [safeKey]: false },
      errorByKey: { ...prev.errorByKey, [safeKey]: message || "AI request failed." },
    }));
  }, []);

  const clearAiError = React.useCallback((key) => {
    const safeKey = String(key || "").trim();
    if (!safeKey) return;
    setDashboardAiState((prev) => ({
      ...prev,
      errorByKey: { ...prev.errorByKey, [safeKey]: "" },
    }));
  }, []);

  const submitDashboardPrompt = React.useCallback((query, meta, pendingKey) => {
    const sheetKey = String(sheetId || "").trim();
    const text = String(query || "").trim();
    if (!sheetKey || !text) return;
    const key = String(pendingKey || "").trim();
    const requestId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    if (key && dashboardAiState.pendingByKey?.[key]) return;
    if (key) markAiPending(key, true);
    if (key) aiRequestByPendingKeyRef.current[key] = requestId;
    if (typeof window === "undefined") {
      if (key) markAiPending(key, false);
      return;
    }
    window.dispatchEvent(new CustomEvent("dashboard:submit-chat", {
      detail: {
        sheetId: sheetKey,
        locale,
        message: text,
        meta: { ...(meta || {}), source: "dashboard-ai", silent: true, pendingKey: key || null, requestId },
      },
    }));
  }, [sheetId, locale, dashboardAiState.pendingByKey, markAiPending]);

  const submitPinnedPromptToAI = React.useCallback((index) => {
    const idx = Number(index);
    const items = ensurePinnedItems(pinnedInput.items);
    if (!Number.isInteger(idx) || idx < 0 || idx >= items.length) return;
    const query = String(items[idx]?.description || "").trim();
    if (!query) return;
    submitDashboardPrompt(query, { index: idx }, `pinned:${idx}`);
  }, [pinnedInput.items, submitDashboardPrompt]);

  const submitTicketPromptToAI = React.useCallback((ticketId, query) => {
    const id = String(ticketId || "").trim();
    const text = String(query || "").trim();
    if (!id || !text) return;
    const q = text.toLowerCase();

    const requestedAgg =
      /\b(percent|percentage|pct|rate|ratio|margin|share)\b|%/.test(q) ? "percent" :
      /\b(avg|average|mean)\b/.test(q) ? "avg" :
      /\b(count|how many|number of)\b/.test(q) ? "count" :
      "sum";

    const bestColumn = allowedHeaders
      .map((h) => {
        const key = String(h || "").toLowerCase();
        let score = 0;
        if (!key) return { header: h, score };
        if (q.includes(key)) score += 8;
        key.split(/[^a-z0-9]+/i).filter(Boolean).forEach((token) => {
          if (token.length >= 3 && q.includes(token)) score += 1;
        });
        if (/\brevenue|sales|income|profit|amount|value|cost|expense|total|ebitda\b/.test(q)
            && /\brevenue|sales|income|profit|amount|value|cost|expense|total|ebitda\b/.test(key)) score += 3;
        return { header: h, score };
      })
      .sort((a, b) => b.score - a.score)[0];

    const column = bestColumn?.score > 0 ? String(bestColumn.header || "") : "";
    const isMatchedColumnNumeric = (() => {
      if (!column) return true;
      let nonEmpty = 0;
      let numeric = 0;
      for (let i = 0; i < Math.min(sortedData.length, 300); i += 1) {
        const raw = sortedData[i]?.[column];
        if (raw === null || raw === undefined || String(raw).trim() === "") continue;
        nonEmpty += 1;
        if (parseNumber(raw) !== null) numeric += 1;
      }
      return nonEmpty === 0 ? true : (numeric / nonEmpty) >= 0.65;
    })();
    const agg = (!["count"].includes(requestedAgg) && !isMatchedColumnNumeric) ? "count" : requestedAgg;

    setKpiDraftOverrides((prev) => ({
      ...prev,
      [id]: {
        ...(prev?.[id] || {}),
        aiQuery: text,
        column: column || (prev?.[id]?.column || kpiOverrides?.[id]?.column || ""),
        agg: agg || (prev?.[id]?.agg || kpiOverrides?.[id]?.agg || "sum"),
        percentBaseValue: prev?.[id]?.percentBaseValue || kpiOverrides?.[id]?.percentBaseValue || "",
        categoryColumn: prev?.[id]?.categoryColumn || kpiOverrides?.[id]?.categoryColumn || "",
      },
    }));
  }, [allowedHeaders, sortedData, kpiOverrides]);

  const submitChartPromptToAI = React.useCallback((ticketId, query) => {
    const id = String(ticketId || "").trim();
    const text = String(query || "").trim();
    if (!id || !text) return;
    submitDashboardPrompt(text, { ticketId: id }, `chart:${id}`);
  }, [submitDashboardPrompt]);

  const { metricCol, dateCol, categoryCol, profitCol, incomeCol, revenueCol, expenseCol } = React.useMemo(
    () => detectColumns(allowedHeaders, sortedData),
    [allowedHeaders, sortedData]
  );
  const revenueMetricCol = revenueCol || metricCol;
  const incomeMetricCol = incomeCol || profitCol;
  const canDeriveExpense = !expenseCol && !!revenueMetricCol && !!incomeMetricCol;

  const sheetStructureSignature = React.useMemo(
    () => allowedHeaders.map((h) => String(h || "").trim().toLowerCase()).join("|"),
    [allowedHeaders]
  );

  const kpiEditorDefaults = React.useMemo(() => {
    const metricLabel = metricCol || (ui.primaryMetricAverage || "Primary Metric");
    const incomeLabel = incomeMetricCol || profitCol || metricCol || (ui.total || "Total");
    const revenueLabel = revenueMetricCol || metricCol || (ui.value || "Value");
    const categoryLabel = categoryCol || (ui.topCategory || "Category");
    return {
      metricAvg: {
        agg: "avg",
        label: metricCol ? `${metricCol} ${ui.average}` : ui.primaryMetricAverage,
        aiQuery: `What is the average value for ${metricLabel}? Return only the number.`,
      },
      incomeTotal: {
        agg: "sum",
        label: incomeCol ? `${incomeCol} ${ui.total}` : (profitCol ? `${profitCol} ${ui.total}` : (metricCol ? `${metricCol} ${ui.median}` : ui.primaryMetricTotal)),
        aiQuery: `What is the total value for ${incomeLabel}? Return only the number.`,
      },
      incomeAvg: {
        agg: "avg",
        label: incomeCol ? `${incomeCol} ${ui.average}` : (expenseCol ? `${expenseCol} ${ui.total}` : `${ui.income} / ${ui.expense}`),
        aiQuery: `What is the average value for ${incomeLabel}? Return only the number.`,
      },
      incomeMargin: {
        agg: "avg",
        label: incomeCol && revenueCol ? ui.incomeMargin : (expenseCol ? ui.expenseShare : ui.incomeRatio),
        aiQuery: `What is the margin ratio for ${incomeLabel}? Return only the number.`,
      },
      latestPeriod: {
        agg: "sum",
        label: ui.latestPeriodValue,
        aiQuery: `What is the latest value for ${revenueLabel}? Return only the number.`,
      },
      topValue: {
        agg: "sum",
        label: ui.topCategoryValue,
        aiQuery: `Which ${categoryLabel} has the highest ${revenueLabel} value? Return only the number.`,
      },
      topShare: {
        agg: "avg",
        label: ui.topCategoryShare,
        aiQuery: `What is the percentage share for the top ${categoryLabel} by ${revenueLabel}? Return only the number.`,
      },
    };
  }, [metricCol, incomeMetricCol, revenueMetricCol, profitCol, incomeCol, revenueCol, expenseCol, categoryCol, ui]);

  const isDefaultKpiLabel = React.useCallback((cardId, labelText) => {
    const text = String(labelText || "").trim();
    if (!text) return false;
    const defaults = new Set();
    Object.values(kpiEditorDefaults || {}).forEach((d) => {
      const l = String(d?.label || "").trim();
      if (l) defaults.add(l.toLowerCase());
    });
    const currentCard = cardsRef.current?.find?.((c) => c?.id === cardId);
    const cardLabel = String(currentCard?.label || "").trim();
    if (cardLabel) defaults.add(cardLabel.toLowerCase());
    return defaults.has(text.toLowerCase());
  }, [kpiEditorDefaults]);

  const cardsRef = React.useRef([]);

  React.useEffect(() => {
    if (!headers.length) return;
    setKpiOverrides((prev) => {
        const next = { ...prev };
        const ids = ["metricAvg", "incomeTotal", "incomeAvg", "incomeMargin", "latestPeriod", "topValue", "topShare"];
        
        ids.forEach(id => {
            const defaults = kpiEditorDefaults[id] || {};
            const defaultCol = (id === "metricAvg") ? (metricCol || "") :
                             (id === "incomeTotal" || id === "incomeAvg" || id === "incomeMargin") ? (incomeMetricCol || "") :
                             (revenueMetricCol || "");
            const current = next[id] || {};

            // Initialize only missing cards/columns; do not wipe active AI/manual overrides.
            if (!current?.column) {

                next[id] = { 
                    ...current, 
                    column: defaultCol, 
                    agg: current?.agg || defaults.agg || "sum",
                    label: current?.label || "",
                    subtitle: "",
                    aiQuery: current?.aiQuery || defaults.aiQuery || "",
                    aiValue: current?.aiValue || "",
                    manualOverride: !!current?.manualOverride,
                    aiOverride: !!current?.aiOverride
                };
                return;
            }

            // Backfill missing editor fields for existing overrides without clobbering user-entered values.
            next[id] = {
                ...current,
                column: current?.column || defaultCol,
                agg: current?.agg || defaults.agg || "sum",
                label: current?.label || "",
                aiQuery: current?.aiQuery || defaults.aiQuery || "",
            };
        });

        return next;
    });
  }, [headers, metricCol, incomeMetricCol, revenueMetricCol, categoryCol, sheetStructureSignature, kpiEditorDefaults]);

  const numericHeaderOptions = React.useMemo(() => {
    return allowedHeaders.filter((h) => {
      let nonEmpty = 0;
      let numeric = 0;
      for (let i = 0; i < Math.min(sortedData.length, 400); i += 1) {
        const raw = sortedData[i]?.[h];
        if (raw === null || raw === undefined || raw === "") continue;
        nonEmpty += 1;
        if (parseNumber(raw) !== null) numeric += 1;
      }
      return nonEmpty > 0 && numeric / nonEmpty >= 0.65;
    });
  }, [allowedHeaders, sortedData]);

  const categoryHeaderOptions = React.useMemo(() => {
    return allowedHeaders.filter((h) => {
      if (numericHeaderOptions.includes(h)) return false;
      const seen = new Set();
      for (let i = 0; i < Math.min(sortedData.length, 400); i += 1) {
        const raw = String(sortedData[i]?.[h] ?? "").trim();
        if (!raw) continue;
        seen.add(raw);
      }
      return seen.size >= 2 && seen.size <= 80;
    });
  }, [allowedHeaders, numericHeaderOptions, sortedData]);

  React.useEffect(() => {
    setTopCategoriesConfig((prev) => {
      const hasCategory = String(prev.categoryColumn || "").trim().length > 0;
      const hasValue = String(prev.valueColumn || "").trim().length > 0;
      const categoryValid = hasCategory && allowedHeaders.includes(prev.categoryColumn);
      const valueValid = hasValue && allowedHeaders.includes(prev.valueColumn);

      const nextCategory = categoryValid
        ? prev.categoryColumn
        : (categoryCol || "");
      const nextValue = valueValid
        ? prev.valueColumn
        : (metricCol || "");

      if (nextCategory === prev.categoryColumn && nextValue === prev.valueColumn) {
        return prev;
      }
      return {
        ...prev,
        categoryColumn: nextCategory,
        valueColumn: nextValue,
      };
    });
  }, [categoryCol, metricCol, allowedHeaders, sheetStructureSignature]);

  React.useEffect(() => {
    setKpiOverrides((prev) => {
      if (!prev || typeof prev !== "object") return prev;
      let changed = false;
      const next = { ...prev };
      Object.entries(next).forEach(([id, cfg]) => {
        if (!cfg || typeof cfg !== "object") return;
        const col = String(cfg.column || "").trim();
        if (col && isMaskedColumn(col)) {
          next[id] = { ...cfg, column: "" };
          changed = true;
        }
      });
      return changed ? next : prev;
    });
    setKpiDraftOverrides((prev) => {
      if (!prev || typeof prev !== "object") return prev;
      let changed = false;
      const next = { ...prev };
      Object.entries(next).forEach(([id, cfg]) => {
        if (!cfg || typeof cfg !== "object") return;
        const col = String(cfg.column || "").trim();
        if (col && isMaskedColumn(col)) {
          next[id] = { ...cfg, column: "" };
          changed = true;
        }
      });
      return changed ? next : prev;
    });
    setTrendConfig((prev) => {
      const lines = Array.isArray(prev?.lines) ? prev.lines : [];
      const filtered = lines.filter((line) => !isMaskedColumn(line?.column));
      if (filtered.length === lines.length) return prev;
      return { ...prev, lines: filtered };
    });
    setTopCategoriesConfig((prev) => {
      const nextCategory = isMaskedColumn(prev?.categoryColumn) ? "" : prev?.categoryColumn;
      const nextValue = isMaskedColumn(prev?.valueColumn) ? "" : prev?.valueColumn;
      if (nextCategory === prev?.categoryColumn && nextValue === prev?.valueColumn) return prev;
      return { ...prev, categoryColumn: nextCategory, valueColumn: nextValue };
    });
  }, [isMaskedColumn]);

  const PIE_COLORS = ["#2563eb", "#16a34a", "#fb923c", "#7c3aed", "#0369a1", "#0f766e", "#be185d", "#e11d48"];

  React.useEffect(() => {
    setTrendConfig((prev) => {
      if (!sheetStructureSignature) return prev;
      if (Array.isArray(prev.lines) && prev.lines.length) return prev;
      
      const lines = [];
      if (revenueMetricCol) {
        lines.push({ id: "line_rev", label: "Revenue", column: revenueMetricCol, mode: "sum", color: "#2563eb" });
      }
      if (incomeMetricCol && incomeMetricCol !== revenueMetricCol) {
        lines.push({ id: "line_inc", label: "Income", column: incomeMetricCol, mode: "sum", color: "#16a34a" });
      }
      // If we have both, we used to show expenses as a gap. 
      // For simplicity, we can add a 'derived' expense or just let user add it if they have a column.
      if (expenseCol) {
         lines.push({ id: "line_exp", label: "Expense", column: expenseCol, mode: "sum", color: "#fb923c" });
      }

      if (lines.length === 0 && metricCol) {
        lines.push({ id: "line_1", label: metricCol, column: metricCol, mode: "sum", color: "#2563eb" });
      }

      return {
        ...prev,
        lines: lines,
      };
    });
  }, [revenueMetricCol, incomeMetricCol, expenseCol, metricCol, sheetStructureSignature]);

  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(PINNED_METRICS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          let bySignature = {};
          if (parsed.bySignature && typeof parsed.bySignature === "object") {
            bySignature = parsed.bySignature;
          } else if (parsed.signature && Array.isArray(parsed.items)) {
            // Backward compatibility: migrate legacy single-config payload.
            bySignature[String(parsed.signature)] = {
              items: ensurePinnedItems(parsed.items),
              updatedAt: parsed.updatedAt || new Date().toISOString(),
            };
          }
          const current = bySignature[sheetStructureSignature];
          if (current) {
            const currentConfig = {
              signature: sheetStructureSignature,
              items: ensurePinnedItems(current.items),
              updatedAt: current.updatedAt || new Date().toISOString(),
              aiPromptedAt: current.aiPromptedAt || null,
              knownSheetIds: Array.isArray(current.knownSheetIds) ? current.knownSheetIds.map((x) => String(x)) : [],
              titleTranslations: current.titleTranslations && typeof current.titleTranslations === "object" ? current.titleTranslations : {},
            };
            setPinnedConfig(currentConfig);
            setPinnedInput({ items: ensurePinnedItems(current.items) });
          } else {
            setPinnedConfig(null);
            setPinnedInput({ items: ensurePinnedItems([]) });
          }
        }
      }
    } catch (_) {
      // ignore localStorage parse errors
    } finally {
      setPinnedLoaded(true);
    }
  }, [sheetStructureSignature]);

  const canShowPinnedValues = React.useMemo(() => {
    if (!pinnedConfig || pinnedConfig.signature !== sheetStructureSignature) return false;
    const items = ensurePinnedItems(pinnedConfig.items);
    return items.some((item) => String(item.value || "").trim() || String(item.description || "").trim());
  }, [pinnedConfig, sheetStructureSignature]);

  const canEditTickets = React.useMemo(() => {
    if (!user) return false;
    if (String(user.role || "").toLowerCase() === "admin") return true;
    return Boolean(
      user.is_group_admin === true
      || user.group_admin === true
      || user.is_admin === true
    );
  }, [user]);
  const hasMultipleTabs = Array.isArray(tabs) && tabs.length > 1;

  const persistPinnedConfig = React.useCallback((itemsOverride = null) => {
    if (!sheetStructureSignature) return;
    const items = ensurePinnedItems(itemsOverride || []);
    const currentPinned = pinnedConfigRef.current;
    let aiPromptedAt = currentPinned?.signature === sheetStructureSignature ? (currentPinned.aiPromptedAt || null) : null;
    let knownSheetIds = currentPinned?.signature === sheetStructureSignature
      ? (Array.isArray(currentPinned.knownSheetIds) ? currentPinned.knownSheetIds.map((x) => String(x)) : [])
      : [];
    let titleTranslations = currentPinned?.signature === sheetStructureSignature && currentPinned?.titleTranslations && typeof currentPinned.titleTranslations === "object"
      ? currentPinned.titleTranslations
      : {};
    const current = {
      signature: sheetStructureSignature,
      items,
      updatedAt: new Date().toISOString(),
      aiPromptedAt,
      knownSheetIds,
      titleTranslations,
    };
    try {
      const raw = localStorage.getItem(PINNED_METRICS_KEY);
      let bySignature = {};
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.bySignature && typeof parsed.bySignature === "object") {
          bySignature = parsed.bySignature;
        } else if (parsed?.signature && Array.isArray(parsed.items)) {
          bySignature[String(parsed.signature)] = {
            items: ensurePinnedItems(parsed.items),
            updatedAt: parsed.updatedAt || new Date().toISOString(),
          };
        }
      }
      const existing = bySignature[sheetStructureSignature];
      // Preserve cached AI metadata during refresh/bootstrap writes.
      if (!aiPromptedAt && existing?.aiPromptedAt) aiPromptedAt = existing.aiPromptedAt;
      if ((!Array.isArray(knownSheetIds) || knownSheetIds.length === 0) && Array.isArray(existing?.knownSheetIds)) {
        knownSheetIds = existing.knownSheetIds.map((x) => String(x));
      }
      if ((!titleTranslations || typeof titleTranslations !== "object" || Object.keys(titleTranslations).length === 0)
          && existing?.titleTranslations && typeof existing.titleTranslations === "object") {
        titleTranslations = existing.titleTranslations;
      }
      current.aiPromptedAt = aiPromptedAt || null;
      current.knownSheetIds = Array.isArray(knownSheetIds) ? knownSheetIds : [];
      current.titleTranslations = titleTranslations && typeof titleTranslations === "object" ? titleTranslations : {};
      bySignature[sheetStructureSignature] = {
        items,
        updatedAt: current.updatedAt,
        aiPromptedAt: current.aiPromptedAt,
        knownSheetIds: current.knownSheetIds,
        titleTranslations: current.titleTranslations,
      };
      const payload = { version: 2, bySignature };
      localStorage.setItem(PINNED_METRICS_KEY, JSON.stringify(payload));
    } catch (_) {
      // ignore storage failures
    }
    setPinnedConfig(current);
  }, [sheetStructureSignature]);

  const markPinnedAiPrompted = React.useCallback((promptedAtIso, knownSheetIds = []) => {
    if (!sheetStructureSignature) return;
    const iso = promptedAtIso || new Date().toISOString();
    const normalizedSheetIds = Array.isArray(knownSheetIds) ? knownSheetIds.map((x) => String(x)) : [];
    setPinnedConfig((prev) => {
      if (!prev || prev.signature !== sheetStructureSignature) return prev;
      const next = { ...prev, aiPromptedAt: iso, knownSheetIds: normalizedSheetIds };
      try {
        const raw = localStorage.getItem(PINNED_METRICS_KEY);
        let bySignature = {};
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.bySignature && typeof parsed.bySignature === "object") {
            bySignature = parsed.bySignature;
          } else if (parsed?.signature && Array.isArray(parsed.items)) {
            bySignature[String(parsed.signature)] = {
              items: ensurePinnedItems(parsed.items),
              updatedAt: parsed.updatedAt || new Date().toISOString(),
            };
          }
        }
        const existing = bySignature[sheetStructureSignature] || {};
        bySignature[sheetStructureSignature] = {
          ...existing,
          items: ensurePinnedItems(existing.items || prev.items),
          updatedAt: existing.updatedAt || prev.updatedAt || new Date().toISOString(),
          aiPromptedAt: iso,
          knownSheetIds: normalizedSheetIds,
        };
        localStorage.setItem(PINNED_METRICS_KEY, JSON.stringify({ version: 2, bySignature }));
      } catch (_) {
        // ignore storage failures
      }
      return next;
    });
  }, [sheetStructureSignature]);

  const upsertPinnedTitleTranslations = React.useCallback((localeKey, translationsByIndex) => {
    if (!sheetStructureSignature || !localeKey || !translationsByIndex || typeof translationsByIndex !== "object") return;
    setPinnedConfig((prev) => {
      if (!prev || prev.signature !== sheetStructureSignature) return prev;
      const existingByLocale = prev.titleTranslations && typeof prev.titleTranslations === "object" ? prev.titleTranslations : {};
      const nextLocale = {
        ...(existingByLocale[localeKey] && typeof existingByLocale[localeKey] === "object" ? existingByLocale[localeKey] : {}),
      };
      Object.entries(translationsByIndex).forEach(([idx, entry]) => {
        if (!entry || typeof entry !== "object") return;
        nextLocale[String(idx)] = {
          sourceTitle: String(entry.sourceTitle || ""),
          translatedTitle: String(entry.translatedTitle || ""),
          updatedAt: entry.updatedAt || new Date().toISOString(),
        };
      });
      const next = {
        ...prev,
        titleTranslations: {
          ...existingByLocale,
          [localeKey]: nextLocale,
        },
      };
      try {
        const raw = localStorage.getItem(PINNED_METRICS_KEY);
        let bySignature = {};
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.bySignature && typeof parsed.bySignature === "object") {
            bySignature = parsed.bySignature;
          } else if (parsed?.signature && Array.isArray(parsed.items)) {
            bySignature[String(parsed.signature)] = {
              items: ensurePinnedItems(parsed.items),
              updatedAt: parsed.updatedAt || new Date().toISOString(),
            };
          }
        }
        const existing = bySignature[sheetStructureSignature] || {};
        bySignature[sheetStructureSignature] = {
          ...existing,
          items: ensurePinnedItems(existing.items || prev.items),
          updatedAt: existing.updatedAt || prev.updatedAt || new Date().toISOString(),
          aiPromptedAt: existing.aiPromptedAt || prev.aiPromptedAt || null,
          knownSheetIds: Array.isArray(existing.knownSheetIds) ? existing.knownSheetIds : (Array.isArray(prev.knownSheetIds) ? prev.knownSheetIds : []),
          titleTranslations: next.titleTranslations,
        };
        localStorage.setItem(PINNED_METRICS_KEY, JSON.stringify({ version: 2, bySignature }));
      } catch (_) {
        // ignore storage failures
      }
      return next;
    });
  }, [sheetStructureSignature]);

  React.useEffect(() => {
    if (!pinnedLoaded || !sheetStructureSignature) return;
    persistPinnedConfig(pinnedInput.items);
  }, [pinnedInput.items, persistPinnedConfig, pinnedLoaded, sheetStructureSignature]);

  React.useEffect(() => {
    if (!sheetStructureSignature) return;
    setKpiOverridesLoaded(false);
    (async () => {
      try {
        const dbRes = await api.get("/users/me/kpi-overrides", { params: { sheetSignature: sheetStructureSignature } });
        const dbValue = dbRes?.data?.value;
        if (dbValue && typeof dbValue === "object") {
          setKpiOverrides(dbValue);
          setKpiDraftOverrides(dbValue);
          setKpiOverridesLoaded(true);
          return;
        }
      } catch (_) {
        // fallback to local storage
      }
      try {
        const raw = localStorage.getItem(KPI_OVERRIDES_KEY);
        if (!raw) {
          setKpiOverrides({});
          setKpiDraftOverrides({});
          setKpiOverridesLoaded(true);
          return;
        }
        const parsed = JSON.parse(raw);
        const bySignature = parsed?.bySignature && typeof parsed.bySignature === "object" ? parsed.bySignature : {};
        const current = bySignature[sheetStructureSignature];
        const next = current && typeof current === "object" ? current : {};
        setKpiOverrides(next);
        setKpiDraftOverrides(next);
        setKpiOverridesLoaded(true);
      } catch (_) {
        setKpiOverrides({});
        setKpiDraftOverrides({});
        setKpiOverridesLoaded(true);
      }
    })();
  }, [sheetStructureSignature]);

  const persistKpiOverrides = React.useCallback(async (nextOverrides) => {
    if (!sheetStructureSignature) return;
    setKpiOverrides(nextOverrides);
    if (!sheetStructureSignature || !kpiOverridesLoaded) return;
    try {
      const raw = localStorage.getItem(KPI_OVERRIDES_KEY);
      let bySignature = {};
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.bySignature && typeof parsed.bySignature === "object") {
          bySignature = parsed.bySignature;
        }
      }
      bySignature[sheetStructureSignature] = nextOverrides;
      localStorage.setItem(KPI_OVERRIDES_KEY, JSON.stringify({ version: 1, bySignature }));
    } catch (_) {
      // ignore storage failures
    }
    try {
      await api.put("/users/me/kpi-overrides", { sheetSignature: sheetStructureSignature, value: nextOverrides });
    } catch (_) {
      // keep local fallback even if DB save fails
    }
  }, [sheetStructureSignature, kpiOverridesLoaded]);

  const normalizedLocale = React.useMemo(() => normalizeDashboardLocale(locale), [locale]);
  const pinnedTitleDisplayMap = React.useMemo(() => {
    const map = {};
    if (isDashboardEnglish(normalizedLocale)) return map;
    const localeTranslations = pinnedConfig?.titleTranslations?.[normalizedLocale];
    if (!localeTranslations || typeof localeTranslations !== "object") return map;
    const items = ensurePinnedItems(pinnedInput.items);
    items.forEach((item, index) => {
      const cached = localeTranslations[String(index)];
      const source = String(item.title || "");
      if (!cached || String(cached.sourceTitle || "") !== source) return;
      const translated = String(cached.translatedTitle || "").trim();
      if (translated.toLowerCase() === source.trim().toLowerCase()) return;
      if (!translated) return;
      map[index] = translated;
    });
    return map;
  }, [pinnedConfig, pinnedInput.items, normalizedLocale]);

  React.useEffect(() => {
    if (!sheetStructureSignature || !pinnedLoaded || !pinnedConfig || pinnedConfig.signature !== sheetStructureSignature) return undefined;
    if (isDashboardEnglish(normalizedLocale)) return undefined;
    const items = ensurePinnedItems(pinnedInput.items);
    const localeTranslations = pinnedConfig?.titleTranslations?.[normalizedLocale];
    const missing = [];
    const nowMs = Date.now();
    items.forEach((item, index) => {
      if (!item.pinned) return;
      const sourceTitle = String(item.title || "").trim();
      if (!sourceTitle) return;
      const cached = localeTranslations?.[String(index)];
      const cachedSource = String(cached?.sourceTitle || "");
      const cachedValue = String(cached?.translatedTitle || "").trim();
      const looksUntranslated = cachedValue && cachedValue.toLowerCase() === sourceTitle.toLowerCase();
      if (cachedSource === sourceTitle && cachedValue && !looksUntranslated) return;
      const requestKey = `${sheetStructureSignature}:${normalizedLocale}:${index}:${sourceTitle}`;
      if (pinnedTitleTranslateInFlightRef.current.has(requestKey)) return;
      const cooldownUntil = Number(pinnedTitleTranslateCooldownRef.current.get(requestKey) || 0);
      if (cooldownUntil > nowMs) return;
      missing.push({ index, sourceTitle, requestKey });
    });
    if (!missing.length) return undefined;
    let cancelled = false;
    missing.forEach((entry) => {
      pinnedTitleTranslateInFlightRef.current.add(entry.requestKey);
    });
    api.post("/dashboard/translate", {
      locale: normalizedLocale,
      items: missing.map((entry) => ({ key: `pinned_${entry.index}`, text: entry.sourceTitle })),
    })
      .then((res) => {
        if (cancelled) return;
        const translations = res?.data?.translations || {};
        const next = {};
        missing.forEach((entry) => {
          const translated = String(translations[`pinned_${entry.index}`] || "").trim();
          if (!translated) {
            // Retry later; do not cache source text as "translated".
            pinnedTitleTranslateCooldownRef.current.set(entry.requestKey, Date.now() + 30 * 1000);
            return;
          }
          pinnedTitleTranslateCooldownRef.current.delete(entry.requestKey);
          next[String(entry.index)] = {
            sourceTitle: entry.sourceTitle,
            translatedTitle: translated,
            updatedAt: new Date().toISOString(),
          };
        });
        if (Object.keys(next).length) {
          upsertPinnedTitleTranslations(normalizedLocale, next);
        }
      })
      .catch(() => {
        // leave original titles if translation fails
      })
      .finally(() => {
        missing.forEach((entry) => {
          pinnedTitleTranslateInFlightRef.current.delete(entry.requestKey);
        });
      });
    return () => {
      cancelled = true;
    };
  }, [sheetStructureSignature, pinnedLoaded, pinnedConfig, pinnedInput.items, normalizedLocale, upsertPinnedTitleTranslations]);

  // --- Unified Dashboard Chat Response Handler ---
  React.useEffect(() => {
    const parseStrictSingleNumber = (rawText) => {
      const matches = String(rawText || "").match(/-?\d+(?:[.,]\d+)?/g) || [];
      if (matches.length !== 1) return null;
      const value = Number(matches[0].replace(",", "."));
      return Number.isFinite(value) ? value : null;
    };
    const handleDashboardChatResponse = (event) => {
      const detail = event?.detail || {};
      if (!detail?.sheetId || String(detail.sheetId) !== String(sheetId)) return;
      const meta = detail?.meta || {};
      const isDashboardAiEvent = meta?.source === "dashboard-ai";
      const pendingKey = String(meta?.pendingKey || "").trim();
      const requestId = String(meta?.requestId || "").trim();
      if (pendingKey && requestId) {
        const latest = String(aiRequestByPendingKeyRef.current[pendingKey] || "");
        if (latest && latest !== requestId) return;
      }
      if (pendingKey) {
        markAiPending(pendingKey, false);
      }
      if (detail?.error) {
        if (pendingKey) setAiError(pendingKey, detail.error);
        return;
      }
      const answer = String(detail.answer || "").trim();
      if (!answer) return;
      if (pendingKey) clearAiError(pendingKey);

      if (!isDashboardAiEvent) return;

      // 1. KPI / Ticket Update
      if (meta.ticketId) {
        const numeric = parseStrictSingleNumber(answer);
        if (!Number.isFinite(numeric)) {
          if (pendingKey) setAiError(pendingKey, "AI returned non-numeric output. Please ask for a single number.");
          return;
        }

        if (meta.ticketId === "__top_categories__") {
          setTopCategoriesConfig((prev) => ({ ...prev, aiValue: String(numeric), aiOverride: true }));
          return;
        }
        if (meta.ticketId === "__trend_over_time__") {
          setTrendConfig((prev) => ({ ...prev, aiValue: String(numeric), aiOverride: true }));
          return;
        }
        setKpiOverrides((prev) => ({
          ...prev,
          [meta.ticketId]: {
            ...(prev?.[meta.ticketId] || {}),
            aiValue: String(numeric),
            aiUpdatedAt: new Date().toISOString(),
            aiOverride: true,
            manualOverride: true
          },
        }));
        return;
      }

      // 2. Pinned Metric Update
      if (Number.isInteger(meta.index) && meta.index >= 0 && meta.index <= 3) {
        const numeric = parseStrictSingleNumber(answer);
        if (!Number.isFinite(numeric)) {
          if (pendingKey) setAiError(pendingKey, "AI returned non-numeric output. Please ask for a single number.");
          return;
        }

        setPinnedInput((prev) => {
          const items = ensurePinnedItems(prev.items);
          items[meta.index] = { ...items[meta.index], value: String(numeric) };
          persistPinnedConfig(items);
          return { ...prev, items };
        });
      }
    };

    window.addEventListener("dashboard:chat-response", handleDashboardChatResponse);
    return () => window.removeEventListener("dashboard:chat-response", handleDashboardChatResponse);
  }, [sheetId, sheetStructureSignature, persistPinnedConfig, markAiPending, setAiError, clearAiError]);

  // Auto AI refresh is intentionally disabled: pinned values update only on manual "Submit to AI".

  const dailyTrendData = React.useMemo(() => {
    if (!metricCol || !dateCol) return [];
    const map = new Map();
    sortedData.forEach((r) => {
      const d = parseDate(r?.[dateCol]);
      const metricValue = parseNumber(r?.[metricCol]);
      const profitValue = profitCol && profitCol !== metricCol ? parseNumber(r?.[profitCol]) : null;
      const revenueValue = revenueMetricCol ? parseNumber(r?.[revenueMetricCol]) : null;
      const incomeValue = incomeMetricCol ? parseNumber(r?.[incomeMetricCol]) : null;
      let expenseValue = expenseCol ? parseNumber(r?.[expenseCol]) : null;
      if (expenseValue === null && revenueValue !== null && incomeValue !== null) {
        expenseValue = revenueValue - incomeValue;
      }
      if (!d || metricValue === null) return;
      const key = toDateKey(d);
      const prev = map.get(key) || {
        metricValue: 0,
        profitValue: 0,
        revenueValue: 0,
        incomeValue: 0,
        expenseValue: 0,
        revenueCount: 0,
        incomeCount: 0,
        expenseCount: 0,
      };
      prev.metricValue += metricValue;
      if (profitValue !== null) prev.profitValue += profitValue;
      if (revenueValue !== null) {
        prev.revenueValue += revenueValue;
        prev.revenueCount += 1;
      }
      if (incomeValue !== null) {
        prev.incomeValue += incomeValue;
        prev.incomeCount += 1;
      }
      if (expenseValue !== null) {
        prev.expenseValue += expenseValue;
        prev.expenseCount += 1;
      }
      map.set(key, prev);
    });
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([period, value]) => ({
        period,
        metricValue: Number(value.metricValue.toFixed(2)),
        profitValue: Number(value.profitValue.toFixed(2)),
        revenueValue: value.revenueCount ? Number(value.revenueValue.toFixed(2)) : null,
        incomeValue: value.incomeCount ? Number(value.incomeValue.toFixed(2)) : null,
        expenseValue: value.expenseCount ? Number(value.expenseValue.toFixed(2)) : null,
      }));
  }, [sortedData, metricCol, dateCol, profitCol, revenueMetricCol, incomeMetricCol, expenseCol]);

  const monthlyTrendData = React.useMemo(() => {
    const map = new Map();
    dailyTrendData.forEach((p) => {
      const monthKey = p.period.slice(0, 7);
      const prev = map.get(monthKey) || {
        metricValue: 0,
        profitValue: 0,
        revenueValue: 0,
        incomeValue: 0,
        expenseValue: 0,
        revenueCount: 0,
        incomeCount: 0,
        expenseCount: 0,
      };
      prev.metricValue += p.metricValue;
      prev.profitValue += p.profitValue;
      if (p.revenueValue !== null && p.revenueValue !== undefined) {
        prev.revenueValue += p.revenueValue;
        prev.revenueCount += 1;
      }
      if (p.incomeValue !== null && p.incomeValue !== undefined) {
        prev.incomeValue += p.incomeValue;
        prev.incomeCount += 1;
      }
      if (p.expenseValue !== null && p.expenseValue !== undefined) {
        prev.expenseValue += p.expenseValue;
        prev.expenseCount += 1;
      }
      map.set(monthKey, prev);
    });
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([period, value]) => ({
        period,
        metricValue: Number(value.metricValue.toFixed(2)),
        profitValue: Number(value.profitValue.toFixed(2)),
        revenueValue: value.revenueCount ? Number(value.revenueValue.toFixed(2)) : null,
        incomeValue: value.incomeCount ? Number(value.incomeValue.toFixed(2)) : null,
        expenseValue: value.expenseCount ? Number(value.expenseValue.toFixed(2)) : null,
      }));
  }, [dailyTrendData]);

  const appliedBounds = React.useMemo(() => {
    if (!appliedRange) return null;
    const startBounds = periodKeyToBounds(appliedRange.start);
    const endBounds = periodKeyToBounds(appliedRange.end);
    if (!startBounds || !endBounds) return null;
    const start = startBounds.start <= endBounds.start ? startBounds.start : endBounds.start;
    const end = startBounds.end >= endBounds.end ? startBounds.end : endBounds.end;
    return { start, end };
  }, [appliedRange]);

  const effectiveRows = React.useMemo(() => {
    if (!appliedBounds || !dateCol) return sortedData;
    return sortedData.filter((r) => {
      const d = parseDate(r?.[dateCol]);
      if (!d) return false;
      return d >= appliedBounds.start && d <= appliedBounds.end;
    });
  }, [sortedData, dateCol, appliedBounds]);

  const trendData = React.useMemo(() => {
    const base = !appliedBounds ? monthlyTrendData : dailyTrendData.filter((p) => {
      const d = parseDate(p.period);
      return d && d >= appliedBounds.start && d <= appliedBounds.end;
    });
    return base.map((p) => {
      const revenueValue = Number.isFinite(p.revenueValue) ? p.revenueValue : null;
      const incomeValue = Number.isFinite(p.incomeValue) ? p.incomeValue : null;
      const expenseFromRevenueIncome = revenueValue !== null && incomeValue !== null
        ? Number(Math.max(revenueValue - incomeValue, 0).toFixed(2))
        : null;
      const gapLower = revenueValue !== null && incomeValue !== null ? incomeValue : null;
      const gapBand = revenueValue !== null && incomeValue !== null ? Math.max(revenueValue - incomeValue, 0) : null;
      return { ...p, gapLower, gapBand, expenseFromRevenueIncome };
    });
  }, [monthlyTrendData, dailyTrendData, appliedBounds]);

  const sparklineGranularity = appliedBounds ? "day" : "month";

  const metricSeries = React.useMemo(
    () => trendData.map((p) => ({ period: p.period, value: p.metricValue })),
    [trendData]
  );

  const profitSeries = React.useMemo(
    () => trendData.map((p) => ({ period: p.period, value: p.profitValue })),
    [trendData]
  );

  React.useEffect(() => {
    if (!appliedRange) return;
    if (!appliedBounds) {
      setAppliedRange(null);
      return;
    }
    const hasDataInRange = dailyTrendData.some((p) => {
      const d = parseDate(p.period);
      return d && d >= appliedBounds.start && d <= appliedBounds.end;
    });
    if (!hasDataInRange) setAppliedRange(null);
  }, [dailyTrendData, appliedRange, appliedBounds]);

  React.useEffect(() => {
    setRangeDraft(null);
    setAppliedRange(null);
  }, [sheetId, activeFilename]);

  const metricValues = React.useMemo(() => {
    if (!metricCol) return [];
    return effectiveRows.map((r) => parseNumber(r?.[metricCol])).filter((v) => v !== null);
  }, [effectiveRows, metricCol]);

  const metricSum = React.useMemo(
    () => metricValues.reduce((acc, n) => acc + n, 0),
    [metricValues]
  );
  const metricAvg = React.useMemo(
    () => (metricValues.length ? metricSum / metricValues.length : 0),
    [metricValues, metricSum]
  );
  const metricMedian = React.useMemo(() => {
    if (!metricValues.length) return 0;
    const s = [...metricValues].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }, [metricValues]);

  const profitValues = React.useMemo(() => {
    if (!profitCol) return [];
    return effectiveRows.map((r) => parseNumber(r?.[profitCol])).filter((v) => v !== null);
  }, [effectiveRows, profitCol]);

  const incomeValues = React.useMemo(() => {
    if (!incomeCol) return [];
    return effectiveRows.map((r) => parseNumber(r?.[incomeCol])).filter((v) => v !== null);
  }, [effectiveRows, incomeCol]);

  const expenseValues = React.useMemo(() => {
    if (expenseCol) {
      return effectiveRows.map((r) => parseNumber(r?.[expenseCol])).filter((v) => v !== null);
    }
    if (!revenueMetricCol || !incomeMetricCol) return [];
    return effectiveRows
      .map((r) => {
        const revenue = parseNumber(r?.[revenueMetricCol]);
        const income = parseNumber(r?.[incomeMetricCol]);
        if (revenue === null || income === null) return null;
        return revenue - income;
      })
      .filter((v) => v !== null);
  }, [effectiveRows, expenseCol, revenueMetricCol, incomeMetricCol]);

  const incomeTotal = React.useMemo(
    () => incomeValues.reduce((acc, n) => acc + n, 0),
    [incomeValues]
  );
  const incomeAvg = React.useMemo(
    () => (incomeValues.length ? incomeTotal / incomeValues.length : 0),
    [incomeValues, incomeTotal]
  );
  const expenseTotal = React.useMemo(
    () => expenseValues.reduce((acc, n) => acc + n, 0),
    [expenseValues]
  );
  const profitTotal = React.useMemo(
    () => profitValues.reduce((acc, n) => acc + n, 0),
    [profitValues]
  );
  const marginPct = React.useMemo(() => {
    const effectiveRevenue = revenueCol ? metricSum : 0;
    const effectiveIncome = incomeCol ? incomeTotal : 0;
    if (!effectiveRevenue) return 0;
    return (effectiveIncome / effectiveRevenue) * 100;
  }, [revenueCol, metricSum, incomeCol, incomeTotal]);

  const incomeSeries = React.useMemo(
    () => buildSeriesFromRows(effectiveRows, dateCol, (r) => parseNumber(r?.[incomeCol]), sparklineGranularity),
    [effectiveRows, dateCol, incomeCol, sparklineGranularity]
  );

  const expenseSeries = React.useMemo(
    () => buildSeriesFromRows(effectiveRows, dateCol, (r) => {
      if (expenseCol) return parseNumber(r?.[expenseCol]);
      if (!revenueMetricCol || !incomeMetricCol) return null;
      const revenue = parseNumber(r?.[revenueMetricCol]);
      const income = parseNumber(r?.[incomeMetricCol]);
      if (revenue === null || income === null) return null;
      return revenue - income;
    }, sparklineGranularity),
    [effectiveRows, dateCol, expenseCol, revenueMetricCol, incomeMetricCol, sparklineGranularity]
  );

  const marginSeries = React.useMemo(() => {
    const revenueMetricCol = revenueCol || metricCol;
    if (!incomeCol || !revenueMetricCol || !dateCol) return [];
    const map = new Map();
    effectiveRows.forEach((r) => {
      const d = parseDate(r?.[dateCol]);
      if (!d) return;
      const income = parseNumber(r?.[incomeCol]);
      const revenue = parseNumber(r?.[revenueMetricCol]);
      if (income === null || revenue === null) return;
      const period = toBucketKey(d, sparklineGranularity);
      const prev = map.get(period) || { income: 0, revenue: 0 };
      prev.income += income;
      prev.revenue += revenue;
      map.set(period, prev);
    });
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([period, t]) => ({ period, value: t.revenue ? Number(((t.income / t.revenue) * 100).toFixed(2)) : 0 }));
  }, [effectiveRows, dateCol, incomeCol, revenueCol, metricCol, sparklineGranularity]);

  const categoryAgg = React.useMemo(() => {
    if (!categoryCol) return [];
    const map = new Map();
    effectiveRows.forEach((r) => {
      const key = String(r?.[categoryCol] ?? "").trim();
      if (!key) return;
      const amount = metricCol ? parseNumber(r?.[metricCol]) : 1;
      map.set(key, (map.get(key) || 0) + (amount === null ? 0 : amount));
    });
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value: Number(value.toFixed(2)) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [effectiveRows, categoryCol, metricCol]);

  const topChartCategoryCol = topCategoriesConfig.categoryColumn || categoryCol || "";
  const topChartValueCol = topCategoriesConfig.valueColumn || metricCol || "";
  const topChartAggMode = String(topCategoriesConfig.agg || "sum").toLowerCase() === "avg" ? "avg" : "sum";
  const topChartTitle = String(topCategoriesConfig.title || "").trim() || ui.topCategories;

  const topChartCategoryAgg = React.useMemo(() => {
    if (!topChartCategoryCol || !topChartValueCol) return [];
    const map = new Map();
    effectiveRows.forEach((r) => {
      const key = String(r?.[topChartCategoryCol] ?? "").trim();
      if (!key) return;
      const amount = parseNumber(r?.[topChartValueCol]);
      const prev = map.get(key) || { sum: 0, count: 0 };
      if (amount !== null) {
        prev.sum += amount;
        prev.count += 1;
      }
      map.set(key, prev);
    });
    return Array.from(map.entries())
      .map(([name, stat]) => ({
        name,
        value: Number((topChartAggMode === "avg" ? (stat.count ? stat.sum / stat.count : 0) : stat.sum).toFixed(2)),
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [effectiveRows, topChartCategoryCol, topChartValueCol, topChartAggMode]);
  const topChartAiValue = Number(String(topCategoriesConfig.aiValue || "").replace(/,/g, ""));
  const topChartCategoryAggDisplay = React.useMemo(() => {
    if (topCategoriesConfig.aiOverride && Number.isFinite(topChartAiValue)) {
      return [{ name: "AI", value: Number(topChartAiValue.toFixed(2)) }];
    }
    return topChartCategoryAgg;
  }, [topCategoriesConfig.aiOverride, topChartAiValue, topChartCategoryAgg]);

  const configuredTrendLines = React.useMemo(
    () => (Array.isArray(trendConfig.lines) ? trendConfig.lines.filter((l) => l && l.id && l.column) : []),
    [trendConfig.lines]
  );

  const trendDataWithConfiguredLines = React.useMemo(() => {
    if (!dateCol || configuredTrendLines.length === 0) return trendData;
    const accum = new Map();
    effectiveRows.forEach((r) => {
      const d = parseDate(r?.[dateCol]);
      if (!d) return;
      const period = toBucketKey(d, sparklineGranularity);
      const prev = accum.get(period) || {};
      configuredTrendLines.forEach((line) => {
        const key = `cfg_${line.id}`;
        const mode = String(line.mode || "sum").toLowerCase();
        const value = parseNumber(r?.[line.column]);
        if (!Number.isFinite(value)) return;
        const bucket = prev[key] || { sum: 0, count: 0, last: null };
        bucket.sum += value;
        bucket.count += 1;
        bucket.last = value;
        prev[key] = bucket;
        prev.__period = period;
      });
      accum.set(period, prev);
    });
    const byPeriod = new Map(trendData.map((p) => [p.period, { ...p }]));
    Array.from(accum.entries()).forEach(([period, row]) => {
      const target = byPeriod.get(period) || { period };
      configuredTrendLines.forEach((line) => {
        const key = `cfg_${line.id}`;
        const mode = String(line.mode || "sum").toLowerCase();
        const bucket = row[key];
        if (!bucket) return;
        const out = mode === "avg"
          ? (bucket.count ? bucket.sum / bucket.count : 0)
          : (mode === "current" ? (bucket.last ?? 0) : bucket.sum);
        target[key] = Number(out.toFixed(2));
      });
      byPeriod.set(period, target);
    });
    return Array.from(byPeriod.values()).sort((a, b) => String(a.period).localeCompare(String(b.period)));
  }, [dateCol, configuredTrendLines, effectiveRows, sparklineGranularity, trendData]);

  const trendAiValue = Number(String(trendConfig.aiValue || "").replace(/,/g, ""));
  const trendDataDisplay = React.useMemo(() => {
    if (!(trendConfig.aiOverride && Number.isFinite(trendAiValue))) return trendDataWithConfiguredLines;
    return trendDataWithConfiguredLines.map((row) => ({ ...row, __ai_override__: Number(trendAiValue.toFixed(2)) }));
  }, [trendDataWithConfiguredLines, trendConfig.aiOverride, trendAiValue]);

  const onTrendMouseDown = (state) => {
    const label = state?.activeLabel;
    if (!label) return;
    setRangeDraft({ start: label, end: label });
  };

  const onTrendMouseMove = (state) => {
    if (!rangeDraft) return;
    const label = state?.activeLabel;
    if (!label) return;
    setRangeDraft((prev) => ({ ...prev, end: label }));
  };

  const onTrendMouseUp = () => {
    if (!rangeDraft) return;
    const { start, end } = rangeDraft;
    if (!start || !end) {
      setRangeDraft(null);
      return;
    }
    const ordered = start <= end ? { start, end } : { start: end, end: start };
    setAppliedRange(ordered);
    setRangeDraft(null);
  };

  const latestTrendPoint = trendData.length ? trendData[trendData.length - 1] : null;
  const topCategory = categoryAgg.length ? categoryAgg[0] : null;
  const topCategoryName = topCategory ? topCategory.name : ui.noCategory;
  const topCategoryValue = topCategory ? topCategory.value : 0;
  const topCategoryShare = topCategory && metricSum ? (topCategory.value / metricSum) * 100 : 0;

  const topCategoryShareSeries = React.useMemo(() => {
    if (!categoryCol || !metricCol || !dateCol) return [];
    const totalsByCategory = new Map();
    effectiveRows.forEach((r) => {
      const k = String(r?.[categoryCol] ?? "").trim();
      const v = parseNumber(r?.[metricCol]);
      if (!k || v === null) return;
      totalsByCategory.set(k, (totalsByCategory.get(k) || 0) + v);
    });
    const topKey = Array.from(totalsByCategory.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!topKey) return [];
    const map = new Map();
    effectiveRows.forEach((r) => {
      const d = parseDate(r?.[dateCol]);
      const category = String(r?.[categoryCol] ?? "").trim();
      const value = parseNumber(r?.[metricCol]);
      if (!d || value === null) return;
      const period = toBucketKey(d, sparklineGranularity);
      const prev = map.get(period) || { total: 0, top: 0 };
      prev.total += value;
      if (category === topKey) prev.top += value;
      map.set(period, prev);
    });
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([period, t]) => ({ period, value: t.total ? Number(((t.top / t.total) * 100).toFixed(2)) : 0 }));
  }, [effectiveRows, categoryCol, metricCol, dateCol, sparklineGranularity]);

  const topCategoryValueSeries = React.useMemo(() => {
    if (!categoryCol || !metricCol || !dateCol) return [];
    const totalsByCategory = new Map();
    effectiveRows.forEach((r) => {
      const k = String(r?.[categoryCol] ?? "").trim();
      const v = parseNumber(r?.[metricCol]);
      if (!k || v === null) return;
      totalsByCategory.set(k, (totalsByCategory.get(k) || 0) + v);
    });
    const topKey = Array.from(totalsByCategory.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!topKey) return [];
    const map = new Map();
    effectiveRows.forEach((r) => {
      const d = parseDate(r?.[dateCol]);
      const category = String(r?.[categoryCol] ?? "").trim();
      const value = parseNumber(r?.[metricCol]);
      if (!d || value === null || category !== topKey) return;
      const period = toBucketKey(d, sparklineGranularity);
      map.set(period, (map.get(period) || 0) + value);
    });
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([period, value]) => ({ period, value: Number(value.toFixed(2)) }));
  }, [effectiveRows, categoryCol, metricCol, dateCol, sparklineGranularity]);

  const kpiDateRangeText = React.useMemo(() => {
    if (!dateCol || !effectiveRows.length) return "";
    let minDate = null;
    let maxDate = null;
    effectiveRows.forEach((r) => {
      const d = parseDate(r?.[dateCol]);
      if (!d) return;
      if (!minDate || d < minDate) minDate = d;
      if (!maxDate || d > maxDate) maxDate = d;
    });
    if (!minDate || !maxDate) return "";
    if (toDateKey(minDate) === toDateKey(maxDate)) return formatDateDisplay(minDate, locale);
    return `${formatDateDisplay(minDate, locale)} ${ui.to} ${formatDateDisplay(maxDate, locale)}`;
  }, [effectiveRows, dateCol, locale, ui.to]);

  const availableSheetDates = React.useMemo(() => {
    if (!dateCol) return [];
    const keys = new Set();
    sortedData.forEach((r) => {
      const d = parseDate(r?.[dateCol]);
      if (!d) return;
      keys.add(toDateKey(d));
    });
    return Array.from(keys).sort((a, b) => a.localeCompare(b));
  }, [sortedData, dateCol]);

  const cards = [
    { id: "pinnedMetrics", label: ui.pinnedMetrics || "Pinned Metrics", value: 0, sparkline: [], color: "#2563eb", sparklineType: "currency" },
    { id: "metricAvg", label: metricCol ? `${metricCol} ${ui.average}` : ui.primaryMetricAverage, value: metricCol ? metricAvg : 0, sparkline: metricSeries, color: "#2563eb", sparklineType: "currency" },
    {
      id: "incomeTotal",
      label: incomeCol ? `${incomeCol} ${ui.total}` : (profitCol ? `${profitCol} ${ui.total}` : (metricCol ? `${metricCol} ${ui.median}` : ui.primaryMetricTotal)),
      value: incomeCol ? incomeTotal : (profitCol ? profitTotal : metricMedian),
      sparkline: incomeCol ? incomeSeries : (profitCol ? profitSeries : metricSeries),
      color: incomeCol || profitCol ? "#16a34a" : "#2563eb",
      sparklineType: "currency",
    },
    {
      id: "incomeAvg",
      label: incomeCol ? `${incomeCol} ${ui.average}` : (expenseCol ? `${expenseCol} ${ui.total}` : `${ui.income} / ${ui.expense}`),
      value: incomeCol ? incomeAvg : (expenseCol ? expenseTotal : 0),
      sparkline: incomeCol ? incomeSeries : (expenseCol ? expenseSeries : metricSeries),
      color: incomeCol ? "#16a34a" : "#b45309",
      sparklineType: "currency",
    },
    {
      id: "incomeMargin",
      label: incomeCol && revenueCol ? ui.incomeMargin : (expenseCol ? ui.expenseShare : ui.incomeRatio),
      value: incomeCol && revenueCol
        ? pct(marginPct)
        : (expenseCol && metricSum ? pct((expenseTotal / metricSum) * 100) : "0%"),
      sparkline: incomeCol && revenueCol ? marginSeries : (expenseCol ? expenseSeries : metricSeries),
      color: "#0f766e",
      sparklineType: "percent",
    },
    { id: "latestPeriod", label: ui.latestPeriodValue, value: latestTrendPoint ? latestTrendPoint.metricValue : 0, sparkline: metricSeries, color: "#2563eb", sparklineType: "currency" },
    { id: "topValue", label: ui.topCategoryValue, subtitle: topCategoryName, value: topCategoryValue, sparkline: topCategoryValueSeries, color: "#7c3aed", sparklineType: "currency" },
    { id: "topShare", label: ui.topCategoryShare, value: pct(topCategoryShare), sparkline: topCategoryShareSeries, color: "#0369a1", sparklineType: "percent" },
  ];
  cardsRef.current = cards;

  const applyKpiOverride = React.useCallback((card) => {
    if (!card || card.id === "pinnedMetrics") return card;
    const override = kpiOverrides?.[card.id];
    if (!override || typeof override !== "object") return card;
    const rawLabelOverride = String(override.label || "").trim();
    const labelOverride = override?.labelCustom === true ? rawLabelOverride : "";
    const column = String(override.column || "").trim();
    const agg = String(override.agg || "").toLowerCase();
    const percentBaseValue = parseNumber(override.percentBaseValue);
    const hasPercentBase = Number.isFinite(percentBaseValue) && percentBaseValue > 0;
    const from = String(override.from || "").trim();
    const to = String(override.to || "").trim();

    let rows = effectiveRows;
    if (dateCol && (from || to)) {
      let latestInSheet = null;
      if (from === "latest" || to === "latest") {
          effectiveRows.forEach(r => {
              const d = parseDate(r[dateCol]);
              if (d && (!latestInSheet || d > latestInSheet)) latestInSheet = d;
          });
      }

      const fromDate = from === "latest" ? latestInSheet : (from ? parseDate(from) : null);
      const toDate = to === "latest" ? latestInSheet : (to ? parseDate(to) : null);

      rows = effectiveRows.filter((r) => {
        const d = parseDate(r?.[dateCol]);
        if (!d) return false;
        if (fromDate && d < fromDate) return false;
        if (toDate && d > toDate) return false;
        return true;
      });
    }

    const aiParsed = Number(String(override?.aiValue ?? "").replace(/,/g, ""));
    const hasValidAiOverride = Number.isFinite(aiParsed);
    const manualOverride = !!override?.manualOverride && hasValidAiOverride;
    const forcedValue = manualOverride ? aiParsed : null;

    // Recalculate subtitle if it's a category card
    let finalSubtitle = card.subtitle;
    const finalCategoryCol = categoryCol;

    if ((card.id === "topValue" || card.id === "topShare") && finalCategoryCol) {
        const map = new Map();
        rows.forEach(r => {
            const k = String(r[finalCategoryCol] || "").trim();
            if (!k) return;
            const v = parseNumber(r[column || metricCol]);
            map.set(k, (map.get(k) || 0) + (v || 0));
        });
        const sorted = Array.from(map.entries()).sort((a,b) => b[1] - a[1]);
        finalSubtitle = sorted.length ? sorted[0][0] : ui.noCategory;
        if (card.id === "topValue") {
          const topComputed = sorted.length ? Number(sorted[0][1] || 0) : 0;
          const topKey = sorted.length ? String(sorted[0][0]) : "";
          const topSeries = (dateCol && topKey)
            ? buildSeriesFromRows(rows, dateCol, (r) => {
                const k = String(r?.[finalCategoryCol] || "").trim();
                if (k !== topKey) return null;
                return parseNumber(r?.[column || metricCol]);
              }, sparklineGranularity)
            : card.sparkline;
          return {
            ...card,
            label: labelOverride || card.label,
            subtitle: finalSubtitle,
            value: forcedValue !== null ? forcedValue : (Number.isFinite(topComputed) ? topComputed : 0),
            sparkline: topSeries,
            sparklineType: "currency",
          };
        }
        if (card.id === "topShare") {
          const topComputed = sorted.length ? Number(sorted[0][1] || 0) : 0;
          const totalComputed = sorted.reduce((acc, [, value]) => acc + (Number(value) || 0), 0);
          const topPct = totalComputed > 0 ? (topComputed / totalComputed) * 100 : 0;
          const topKey = sorted.length ? String(sorted[0][0]) : "";
          const topShareSeries = (dateCol && topKey)
            ? (() => {
                const bucket = new Map();
                rows.forEach((r) => {
                  const d = parseDate(r?.[dateCol]);
                  if (!d) return;
                  const v = parseNumber(r?.[column || metricCol]);
                  if (v === null) return;
                  const period = toBucketKey(d, sparklineGranularity);
                  const prev = bucket.get(period) || { total: 0, top: 0 };
                  prev.total += v;
                  const k = String(r?.[finalCategoryCol] || "").trim();
                  if (k === topKey) prev.top += v;
                  bucket.set(period, prev);
                });
                return Array.from(bucket.entries())
                  .sort((a, b) => a[0].localeCompare(b[0]))
                  .map(([period, t]) => ({ period, value: t.total ? Number(((t.top / t.total) * 100).toFixed(2)) : 0 }));
              })()
            : card.sparkline;
          return {
            ...card,
            label: labelOverride || card.label,
            subtitle: finalSubtitle,
            value: forcedValue !== null ? forcedValue : pct(topPct),
            sparkline: topShareSeries,
            sparklineType: "percent",
          };
        }
    }

    if (!column || !allowedHeaders.includes(column) || isMaskedColumn(column)) {
      return {
        ...card,
        label: labelOverride || card.label,
        subtitle: finalSubtitle,
        value: forcedValue !== null ? forcedValue : card.value,
      };
    }

    let nextValue = 0;
    if (agg === "count") {
      nextValue = rows.reduce((acc, r) => {
        const raw = r?.[column];
        return raw === null || raw === undefined || String(raw).trim() === "" ? acc : acc + 1;
      }, 0);
    } else if (agg === "percent") {
      const nums = rows.map((r) => parseNumber(r?.[column])).filter((v) => v !== null);
      const numerator = nums.reduce((acc, n) => acc + n, 0);
      nextValue = hasPercentBase ? (numerator / percentBaseValue) * 100 : 0;
    } else {
      const nums = rows.map((r) => parseNumber(r?.[column])).filter((v) => v !== null);
      if (agg === "avg") {
        nextValue = nums.length ? nums.reduce((acc, n) => acc + n, 0) / nums.length : 0;
      } else {
        nextValue = nums.reduce((acc, n) => acc + n, 0);
      }
    }

    return {
      ...card,
      label: labelOverride || card.label,
      value: agg === "percent"
        ? pct(forcedValue !== null ? forcedValue : (Number.isFinite(nextValue) ? nextValue : 0))
        : (forcedValue !== null ? forcedValue : (Number.isFinite(nextValue) ? nextValue : 0)),
      sparkline: dateCol
        ? (agg === "percent"
            ? buildSeriesFromRows(rows, dateCol, (r) => {
                const value = parseNumber(r?.[column]);
                return value === null || !hasPercentBase ? null : (value / percentBaseValue) * 100;
              }, sparklineGranularity)
            : buildSeriesFromRows(rows, dateCol, (r) => {
                if (agg === "count") {
                  const raw = r?.[column];
                  return raw === null || raw === undefined || String(raw).trim() === "" ? 0 : 1;
                }
                return parseNumber(r?.[column]);
              }, sparklineGranularity))
        : card.sparkline,
      sparklineType: agg === "count" ? "count" : (agg === "percent" ? "percent" : "currency"),
    };
  }, [kpiOverrides, effectiveRows, dateCol, allowedHeaders, sparklineGranularity, isMaskedColumn]);

  const cardsWithOverrides = React.useMemo(
    () => cards.map((card) => applyKpiOverride(card)),
    [cards, applyKpiOverride]
  );

  React.useEffect(() => {
    const ids = cardsWithOverrides.map((c) => c.id);
    setTopCardsOrder((prev) => {
      if (!Array.isArray(prev) || prev.length === 0) return ids;
      const kept = prev.filter((id) => ids.includes(id));
      const appended = ids.filter((id) => !kept.includes(id));
      const next = [...kept, ...appended];
      return next.length ? next : ids;
    });
  }, [cardsWithOverrides]);

  const orderedCardsWithOverrides = React.useMemo(() => {
    const order = Array.isArray(topCardsOrder) && topCardsOrder.length
      ? topCardsOrder
      : cardsWithOverrides.map((c) => c.id);
    const byId = new Map(cardsWithOverrides.map((c) => [c.id, c]));
    const ordered = order.map((id) => byId.get(id)).filter(Boolean);
    const missing = cardsWithOverrides.filter((c) => !order.includes(c.id));
    return [...ordered, ...missing];
  }, [cardsWithOverrides, topCardsOrder]);

  const explicitReportSources = React.useMemo(() => (
    (reportSources || []).filter((source) => source && !source.is_inferred)
  ), [reportSources]);

  const aiCompatibilityBySheetId = React.useMemo(() => {
    const out = new Map();
    Object.values(reportSourceImports || {}).forEach((imports) => {
      if (!Array.isArray(imports)) return;
      imports.forEach((item) => {
        const sid = String(item?.sheet_id || "").trim();
        if (!sid) return;
        const backendStatus = item?.ai_chat_compatibility && typeof item.ai_chat_compatibility === "object"
          ? item.ai_chat_compatibility
          : null;
        out.set(sid, {
          ready: !!backendStatus?.ready,
          approvalReady: backendStatus?.approval_ready === true,
          missing: Array.isArray(backendStatus?.missing) && backendStatus.missing.length
            ? backendStatus.missing.map((m) => String(m))
            : (backendStatus ? [] : ["compatibility not evaluated yet"]),
        });
      });
    });
    (Array.isArray(myFiles) ? myFiles : []).forEach((file) => {
      const sid = String(file?.id || "").trim();
      if (!sid || out.has(sid)) return;
      const backendStatus = file?.ai_chat_compatibility && typeof file.ai_chat_compatibility === "object"
        ? file.ai_chat_compatibility
        : null;
      out.set(sid, {
        ready: !!backendStatus?.ready,
        approvalReady: backendStatus?.approval_ready === true || !!backendStatus?.ready,
        missing: Array.isArray(backendStatus?.missing) && backendStatus.missing.length
          ? backendStatus.missing.map((m) => String(m))
          : (backendStatus ? [] : ["compatibility not evaluated yet"]),
      });
    });
    return out;
  }, [myFiles, reportSourceImports]);

  const allImportRows = React.useMemo(() => {
    const rows = [];
    explicitReportSources.forEach((source) => {
      const imports = [...(reportSourceImports[String(source.id)] || [])]
        .sort((a, b) => new Date(b.uploaded_at || b.created_at || 0) - new Date(a.uploaded_at || a.created_at || 0));
      if (!imports.length) {
        rows.push({
          id: `source-${source.id}`,
          importId: "",
          sourceId: source.id,
          source: source.name || `Report source ${source.id}`,
          latestFile: "No revision yet",
          revision: "New",
          status: "needs_source",
          statusLabel: "Needs source",
          schema: "Waiting",
          uploadedBy: "",
          uploadedAt: "",
        });
        return;
      }
      imports.forEach((item) => {
        const status = String(item?.status || "").trim().toLowerCase() || "unknown";
        const statusLabel = status === "published"
          ? "Published"
          : status === "pending_approval"
            ? "Review required"
            : status === "rejected"
              ? "Rejected"
              : status === "superseded"
                ? ((Number(item?.import_version || 0) > 1) ? "Updated" : "Published")
                : "Review";
        rows.push({
        id: item?.id || `${source.id}:${item?.sheet_id || item?.import_version || rows.length}`,
        importId: item?.id || "",
        sheetId: item?.sheet_id || "",
        sourceId: source.id,
        source: source.name || `Report source ${source.id}`,
        latestFile: item?.file_label || item?.display_name || item?.original_filename || item?.filename || "Untitled import",
        revision: item?.import_version ? `v${item.import_version}` : "New",
        status,
        statusLabel,
        schema: item?.schema_status || "tracked",
        uploadedBy: item?.imported_by_name || "",
        uploadedAt: item?.uploaded_at || item?.created_at || "",
        });
      });
    });
    return rows.sort((a, b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0));
  }, [explicitReportSources, reportSourceImports]);

  const fileRows = React.useMemo(
    () => allImportRows
      .filter((row) => row.status === "published" || row.status === "superseded")
      .slice(0, 8),
    [allImportRows]
  );
  const reviewRows = React.useMemo(
    () => allImportRows.filter((row) => row.status === "pending_approval" || row.status === "rejected"),
    [allImportRows]
  );

  const totalImports = React.useMemo(() => (
    Object.values(reportSourceImports || {}).reduce((sum, imports) => sum + (Array.isArray(imports) ? imports.length : 0), 0)
  ), [reportSourceImports]);

  const publishedImports = React.useMemo(() => (
    allImportRows.filter((row) => row.status === "published").length
  ), [allImportRows]);

  const handleReviewAction = React.useCallback(async (row, action) => {
    if (!row?.importId || reviewBusyId) return;
    const importKey = String(row.importId);
    setReviewInlineErrorByImportId((prev) => {
      if (!prev?.[importKey]) return prev;
      const next = { ...prev };
      delete next[importKey];
      return next;
    });
    setReviewBusyId(`${action}:${row.importId}`);
    try {
      await api.post(`/report-source-imports/${row.importId}/${action}`);
      await refreshReportSources?.();
    } catch (error) {
      const apiError = String(error?.response?.data?.error || "");
      if (action === "publish" && apiError === "ai_chat_compatibility_blocked") {
        const reasons = Array.isArray(error?.response?.data?.details?.reasons)
          ? error.response.data.details.reasons.map((r) => String(r || "").trim()).filter(Boolean)
          : [];
        const message = reasons.length
          ? `Cannot publish: required mappings/fields are missing.\n${reasons.slice(0, 4).map((r, i) => `${i + 1}. ${r}`).join("\n")}`
          : "Cannot publish: required mappings/fields are missing.";
        setReviewInlineErrorByImportId((prev) => ({
          ...(prev || {}),
          [importKey]: message,
        }));
      } else {
        alert(error?.response?.data?.error || `Failed to ${action} import`);
      }
    } finally {
      setReviewBusyId("");
    }
  }, [reviewBusyId, refreshReportSources]);

  const loadHeaderRepairPreview = React.useCallback(async (importId, tabName = "", previewLimit = 300) => {
    const params = {};
    const safeTab = String(tabName || "").trim();
    const safeLimit = Number.parseInt(String(previewLimit || 300), 10);
    if (safeTab) params.tab = safeTab;
    if (Number.isInteger(safeLimit) && safeLimit > 0) params.limit = safeLimit;
    const response = await api.get(`/report-source-imports/${importId}/header-repair-preview`, {
      params,
    });
    return response?.data || {};
  }, []);

  const openHeaderRepairModal = React.useCallback(async (row) => {
    if (!row?.importId) return;
    setHeaderRepairModal({
      open: true,
      row,
      loading: true,
      saving: false,
      error: "",
      success: "",
      preview: null,
      tabName: "",
      previewLimit: 300,
      showHeaderRowTools: false,
      headerRowIndex: "",
      sourceHeader: "",
      targetHeader: "",
    });
    try {
      const preview = await loadHeaderRepairPreview(row.importId, "", 300);
      const firstTarget = Array.isArray(preview.repair_targets) ? preview.repair_targets[0] : null;
      const firstRowIndex = Array.isArray(preview.sample_row_indexes) ? Number(preview.sample_row_indexes[0]) : null;
      const previewHasUsableHeaders = (Array.isArray(preview?.headers) ? preview.headers : []).some((header) => {
        const text = String(header || "").trim();
        if (!text) return false;
        if (isHeaderRepairRedactedValue(text)) return false;
        return /[A-Za-z]/.test(text);
      });
      setHeaderRepairModal((prev) => ({
        ...prev,
        loading: false,
        preview,
        tabName: String(preview?.tab_name || "").trim(),
        showHeaderRowTools: prev.showHeaderRowTools || !previewHasUsableHeaders,
        headerRowIndex: Number.isInteger(firstRowIndex) && firstRowIndex >= 0 ? String(firstRowIndex) : "",
        targetHeader: firstTarget?.targetHeader || firstTarget?.options?.[0] || "Date",
      }));
    } catch (error) {
      setHeaderRepairModal((prev) => ({
        ...prev,
        loading: false,
        error: error?.response?.data?.error || "Failed to load uploaded sheet preview.",
      }));
    }
  }, [loadHeaderRepairPreview]);

  const closeHeaderRepairModal = React.useCallback(() => {
    if (headerRepairModal.saving) return;
    setHeaderRepairModal({
      open: false,
      row: null,
      loading: false,
      saving: false,
      error: "",
      success: "",
      preview: null,
      tabName: "",
      previewLimit: 300,
      showHeaderRowTools: false,
      headerRowIndex: "",
      sourceHeader: "",
      targetHeader: "",
    });
  }, [headerRepairModal.saving]);

  const handleHeaderRepairTabChange = React.useCallback(async (nextTabName) => {
    const row = headerRepairModal.row;
    if (!row?.importId) return;
    const tabName = String(nextTabName || "").trim();
    setHeaderRepairModal((prev) => ({
      ...prev,
      loading: true,
      error: "",
      success: "",
      tabName,
    }));
    try {
      const preview = await loadHeaderRepairPreview(row.importId, tabName, headerRepairModal.previewLimit || 300);
      const firstTarget = Array.isArray(preview.repair_targets) ? preview.repair_targets[0] : null;
      const firstRowIndex = Array.isArray(preview.sample_row_indexes) ? Number(preview.sample_row_indexes[0]) : null;
      const previewHasUsableHeaders = (Array.isArray(preview?.headers) ? preview.headers : []).some((header) => {
        const text = String(header || "").trim();
        if (!text) return false;
        if (isHeaderRepairRedactedValue(text)) return false;
        return /[A-Za-z]/.test(text);
      });
      setHeaderRepairModal((prev) => ({
        ...prev,
        loading: false,
        preview,
        tabName: String(preview?.tab_name || tabName || "").trim(),
        showHeaderRowTools: prev.showHeaderRowTools || !previewHasUsableHeaders,
        headerRowIndex: Number.isInteger(firstRowIndex) && firstRowIndex >= 0 ? String(firstRowIndex) : prev.headerRowIndex,
        sourceHeader: "",
        targetHeader: firstTarget?.targetHeader || firstTarget?.options?.[0] || prev.targetHeader,
      }));
    } catch (error) {
      setHeaderRepairModal((prev) => ({
        ...prev,
        loading: false,
        error: error?.response?.data?.error || "Failed to load uploaded sheet preview.",
      }));
    }
  }, [headerRepairModal.row, headerRepairModal.previewLimit, loadHeaderRepairPreview]);

  const loadMoreHeaderRepairRows = React.useCallback(async () => {
    const row = headerRepairModal.row;
    if (!row?.importId || headerRepairModal.loading || headerRepairModal.saving) return;
    const nextLimit = Math.min(2000, Number(headerRepairModal.previewLimit || 300) + 300);
    if (nextLimit === Number(headerRepairModal.previewLimit || 300)) return;
    setHeaderRepairModal((prev) => ({
      ...prev,
      loading: true,
      error: "",
      previewLimit: nextLimit,
    }));
    try {
      const preview = await loadHeaderRepairPreview(row.importId, headerRepairModal.tabName || "", nextLimit);
      const firstTarget = Array.isArray(preview.repair_targets) ? preview.repair_targets[0] : null;
      const firstRowIndex = Array.isArray(preview.sample_row_indexes) ? Number(preview.sample_row_indexes[0]) : null;
      const previewHasUsableHeaders = (Array.isArray(preview?.headers) ? preview.headers : []).some((header) => {
        const text = String(header || "").trim();
        if (!text) return false;
        if (isHeaderRepairRedactedValue(text)) return false;
        return /[A-Za-z]/.test(text);
      });
      setHeaderRepairModal((prev) => ({
        ...prev,
        loading: false,
        preview,
        tabName: String(preview?.tab_name || prev.tabName || "").trim(),
        showHeaderRowTools: prev.showHeaderRowTools || !previewHasUsableHeaders,
        headerRowIndex: Number.isInteger(firstRowIndex) && firstRowIndex >= 0 ? prev.headerRowIndex || String(firstRowIndex) : prev.headerRowIndex,
        targetHeader: firstTarget?.targetHeader || firstTarget?.options?.[0] || prev.targetHeader,
      }));
    } catch (error) {
      setHeaderRepairModal((prev) => ({
        ...prev,
        loading: false,
        error: error?.response?.data?.error || "Failed to load more preview rows.",
      }));
    }
  }, [headerRepairModal, loadHeaderRepairPreview]);

  const submitHeaderRowRepair = React.useCallback(async () => {
    const row = headerRepairModal.row;
    const headerRowIndex = Number.parseInt(String(headerRepairModal.headerRowIndex || "").trim(), 10);
    if (!row?.importId || !Number.isInteger(headerRowIndex) || headerRowIndex < 0) {
      setHeaderRepairModal((prev) => ({ ...prev, error: "Select which row contains the real headers first." }));
      return;
    }
    const selectedInternalRow = Number.parseInt(String(headerRepairModal.headerRowIndex || "").trim(), 10);
    const sampleIndexes = Array.isArray(headerRepairModal.preview?.sample_row_indexes)
      ? headerRepairModal.preview.sample_row_indexes
        .map((v) => Number(v))
        .filter((v) => Number.isInteger(v) && v >= 0)
      : [];
    const orderedIndexes = Array.from(new Set(sampleIndexes)).sort((a, b) => a - b);
    const foundPos = orderedIndexes.findIndex((v) => v === selectedInternalRow);
    const selectedDisplayRow = foundPos >= 0 ? (foundPos + 1) : 1;
    const confirmed = window.confirm(`Use file row ${selectedDisplayRow} as the header row? Rows up to that line will be removed from the dataset.`);
    if (!confirmed) return;
    setHeaderRepairModal((prev) => ({ ...prev, saving: true, error: "", success: "" }));
    try {
      const response = await api.post(`/report-source-imports/${row.importId}/header-row`, {
        headerRowIndex,
        tabName: headerRepairModal.tabName || "",
        previewLimit: headerRepairModal.previewLimit || 300,
        confirm: true,
      });
      const preview = response?.data || {};
      const nextTarget = Array.isArray(preview.repair_targets) ? preview.repair_targets[0] : null;
      const nextFirstRowIndex = Array.isArray(preview.sample_row_indexes) ? Number(preview.sample_row_indexes[0]) : null;
      await refreshReportSources?.();
      setHeaderRepairModal((prev) => ({
        ...prev,
        saving: false,
        preview,
        tabName: String(preview?.tab_name || prev.tabName || "").trim(),
        headerRowIndex: Number.isInteger(nextFirstRowIndex) && nextFirstRowIndex >= 0 ? String(nextFirstRowIndex) : prev.headerRowIndex,
        sourceHeader: "",
        targetHeader: nextTarget?.targetHeader || nextTarget?.options?.[0] || prev.targetHeader,
        success: preview?.compatibility?.approval_ready
          ? "Header row applied. This import can now be published."
          : "Header row applied. Additional required mappings may still be missing.",
      }));
    } catch (error) {
      const raw = String(error?.response?.data?.error || "").trim();
      const human = raw === "header_row_not_found_in_tab"
        ? "The selected row was not found in this tab. Refresh preview and try again."
        : raw === "invalid_header_row_index"
          ? "Selected header row index is invalid."
          : raw || "Failed to apply the selected header row.";
      setHeaderRepairModal((prev) => ({
        ...prev,
        saving: false,
        error: human,
      }));
    }
  }, [headerRepairModal, refreshReportSources]);

  const submitHeaderRepair = React.useCallback(async () => {
    const row = headerRepairModal.row;
    const sourceHeader = String(headerRepairModal.sourceHeader || "").trim();
    const targetHeader = String(headerRepairModal.targetHeader || "").trim();
    if (!row?.importId || !sourceHeader || !targetHeader) {
      setHeaderRepairModal((prev) => ({ ...prev, error: "Select the uploaded column and the required header first." }));
      return;
    }
    const confirmed = window.confirm(`Rename uploaded column "${sourceHeader}" to required header "${targetHeader}"? Continue or cancel.`);
    if (!confirmed) return;
    setHeaderRepairModal((prev) => ({ ...prev, saving: true, error: "", success: "" }));
    try {
      const response = await api.post(`/report-source-imports/${row.importId}/header-rename`, {
        sourceHeader,
        targetHeader,
        tabName: headerRepairModal.tabName || "",
        previewLimit: headerRepairModal.previewLimit || 300,
        confirm: true,
      });
      const preview = response?.data || {};
      const nextTarget = Array.isArray(preview.repair_targets) ? preview.repair_targets[0] : null;
      await refreshReportSources?.();
      setHeaderRepairModal((prev) => ({
        ...prev,
        saving: false,
        preview,
        tabName: String(preview?.tab_name || prev.tabName || "").trim(),
        sourceHeader: "",
        targetHeader: nextTarget?.targetHeader || nextTarget?.options?.[0] || prev.targetHeader,
        success: preview?.compatibility?.approval_ready
          ? "Header repaired. This import can now be published."
          : "Header repaired. Additional required mappings may still be missing.",
      }));
    } catch (error) {
      setHeaderRepairModal((prev) => ({
        ...prev,
        saving: false,
        error: error?.response?.data?.error || "Failed to rename the uploaded column.",
      }));
    }
  }, [headerRepairModal, refreshReportSources]);

  const handleDeleteImport = React.useCallback(async (row) => {
    if (!row?.importId || reviewBusyId) return;
    const status = String(row?.status || "");
    const isPending = status === "pending_approval";
    const isSuperseded = status === "superseded";
    const isPublished = status === "published";
    const confirmed = window.confirm(
      isPending
        ? `Delete pending file "${row.latestFile}" (${row.revision})? It will be rejected and removed.`
        : isSuperseded
          ? `Delete old revision "${row.latestFile}" (${row.revision})?`
          : isPublished
            ? `Delete published file "${row.latestFile}" (${row.revision})? The previous revision (if any) will become published.`
          : `Delete rejected file "${row.latestFile}" (${row.revision})?`
    );
    if (!confirmed) return;
    setReviewBusyId(`delete:${row.importId}`);
    try {
      if (isPending) {
        await api.post(`/report-source-imports/${row.importId}/reject`);
      }
      await api.delete(`/report-source-imports/${row.importId}`);
      await refreshReportSources?.();
    } catch (error) {
      alert(error?.response?.data?.error || "Failed to delete import");
    } finally {
      setReviewBusyId("");
    }
  }, [reviewBusyId, refreshReportSources]);

  const canReviewImports = React.useMemo(() => {
    const role = String(user?.role || "").toLowerCase();
    return role === "admin" || role === "super_admin" || role === "superadmin" || !!user?.is_admin || !!user?.super_admin || !!user?.is_group_admin || !!user?.group_admin;
  }, [user]);

  const statusBadgeClass = (status, revision = "") => {
    const revNum = Number(String(revision || "").replace(/^v/i, ""));
    if (status === "published") return "bg-emerald-50 text-emerald-700";
    if (status === "superseded" && Number.isFinite(revNum) && revNum <= 1) return "bg-emerald-50 text-emerald-700";
    if (status === "pending_approval") return "bg-amber-50 text-amber-700";
    if (status === "rejected") return "bg-rose-50 text-rose-700";
    if (status === "superseded") return "bg-slate-100 text-slate-500";
    return "bg-blue-50 text-blue-700";
  };

  const summarizeCompatibilityMissing = React.useCallback((missingList = []) => {
    const text = (Array.isArray(missingList) ? missingList : []).map((m) => String(m || "").toLowerCase());
    if (!text.length) return "Required mappings are missing.";
    if (text.some((m) => m.includes("dlp findings") || m.includes("sensitive"))) {
      return "DLP findings must be resolved before publish.";
    }
    if (text.some((m) => m.includes("date") || m.includes("year") || m.includes("period"))) {
      if (text.some((m) => m.includes("metric") || m.includes("numeric"))) {
        return "Date and metric mappings are missing.";
      }
      return "Date mapping is missing.";
    }
    if (text.some((m) => m.includes("metric") || m.includes("numeric"))) {
      return "Metric mapping is missing.";
    }
    return "Required mappings are missing.";
  }, []);

  const sourceStats = [
    ["Uploads", totalImports.toLocaleString("en-US"), "Spreadsheets added"],
    ["Need approval", reviewRows.length.toLocaleString("en-US"), "Waiting before publish"],
    ["Published", publishedImports.toLocaleString("en-US"), "Ready for questions"],
    ["Sources", explicitReportSources.length.toLocaleString("en-US"), "Data collections"],
  ];
  const headerRepairPreview = headerRepairModal.preview || {};
  const headerRepairTabs = Array.isArray(headerRepairPreview.tabs)
    ? headerRepairPreview.tabs.map((tab) => String(tab || "").trim()).filter(Boolean)
    : [];
  const headerRepairTabStatuses = Array.isArray(headerRepairPreview.tab_statuses)
    ? headerRepairPreview.tab_statuses
    : [];
  const headerRepairTabStatusByName = React.useMemo(() => {
    const out = new Map();
    headerRepairTabStatuses.forEach((status) => {
      const tabName = String(status?.tab_name || "").trim();
      if (!tabName) return;
      out.set(tabName, status);
    });
    return out;
  }, [headerRepairTabStatuses]);
  const headerRepairHeaders = Array.isArray(headerRepairPreview.headers) ? headerRepairPreview.headers : [];
  const headerRepairSourceHeaderOptions = React.useMemo(() => {
    return Array.from(new Set(
      headerRepairHeaders.map((header) => String(header || "").trim()).filter(Boolean)
    ));
  }, [headerRepairHeaders]);
  const headerRepairVisibleHeaders = headerRepairHeaders.slice(0, 12);
  const headerRepairRows = Array.isArray(headerRepairPreview.sample_rows) ? headerRepairPreview.sample_rows : [];
  const headerRepairRowIndexes = Array.isArray(headerRepairPreview.sample_row_indexes) ? headerRepairPreview.sample_row_indexes : [];
  const headerRepairPreviewRowCount = Number(headerRepairPreview?.preview_row_count || 0);
  const headerRepairHasMoreRows = !!headerRepairPreview?.has_more_rows;
  const headerRepairTargets = Array.isArray(headerRepairPreview.repair_targets) ? headerRepairPreview.repair_targets : [];
  const headerRepairTargetOptions = Array.from(new Set(
    headerRepairTargets.flatMap((target) => Array.isArray(target?.options) ? target.options : []).filter(Boolean)
  ));
  const headerRepairMissing = Array.isArray(headerRepairPreview?.compatibility?.missing)
    ? headerRepairPreview.compatibility.missing.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  const isHeaderRepairRedactedValue = React.useCallback((value) => {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (!normalized) return false;
    if (normalized === "[redacted]" || normalized === "redacted" || normalized === "[masked]" || normalized === "masked") return true;
    return normalized.includes("redacted") || normalized.includes("masked");
  }, []);
  const headerRepairHeaderRowOptions = React.useMemo(() => {
    const options = [];
    headerRepairRows.forEach((row, idx) => {
      const rowIndexCandidate = Number(headerRepairRowIndexes[idx]);
      const rowIndex = Number.isInteger(rowIndexCandidate) && rowIndexCandidate >= 0 ? rowIndexCandidate : idx;
      const byHeader = headerRepairVisibleHeaders
        .slice(0, 3)
        .map((header) => String(row?.[header] ?? "").trim())
        .filter(Boolean);
      const fallback = Object.values(row || {})
        .slice(0, 3)
        .map((value) => String(value ?? "").trim())
        .filter(Boolean);
      const previewValues = (byHeader.length ? byHeader : fallback).slice(0, 3);
      const labelSuffix = previewValues.length ? ` - ${previewValues.join(" | ").slice(0, 90)}` : "";
      options.push({
        value: String(rowIndex),
        labelSuffix,
      });
    });
    return options
      .sort((a, b) => Number(a.value) - Number(b.value))
      .map((opt, idx) => ({
        value: opt.value,
        label: `Row ${idx + 1}${opt.labelSuffix || ""}`,
      }));
  }, [headerRepairRows, headerRepairVisibleHeaders, headerRepairRowIndexes]);
  const headerRepairHasUsableHeaders = React.useMemo(() => {
    return headerRepairHeaders.some((header) => {
      const text = String(header || "").trim();
      if (!text) return false;
      if (isHeaderRepairRedactedValue(text)) return false;
      return /[A-Za-z]/.test(text);
    });
  }, [headerRepairHeaders, isHeaderRepairRedactedValue]);
  React.useEffect(() => {
    if (!focusReviewQueue) return;
    window.requestAnimationFrame(() => {
      reviewQueueRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [focusReviewQueue]);




  return (
    <div className="flex-1 min-h-0 bg-[#f6f8fb] relative">
      <div className="p-5 md:p-7 bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.10),transparent_34%),linear-gradient(180deg,#f8fafc_0%,#eef6f8_100%)]">
      <div className="rounded-2xl p-5 md:p-7 border border-slate-200 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.08)]">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h2 className="text-2xl md:text-3xl font-black text-slate-950 tracking-tight">
              Upload, approve, ask, and share.
            </h2>
            <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-slate-500">
              {user?.name?.split(' ')[0] || user?.email?.split('@')[0]}, use this simple flow: upload a spreadsheet, preview it, approve it, ask questions, then share a view.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            {/*
              Keep top actions visually consistent: same size + same color family.
            */}
            <Link
              to="/workspace/imports"
              className="inline-flex h-10 min-w-[160px] items-center justify-center gap-2 rounded-md bg-slate-800 px-4 text-sm font-black text-white shadow-sm transition-all duration-150 hover:-translate-y-px hover:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
            >
              <span aria-hidden="true">⬆</span>
              <span>Upload File</span>
            </Link>
            {onOpenWorkspace ? (
              <button
                type="button"
                onClick={onOpenWorkspace}
                className="inline-flex h-10 min-w-[160px] items-center justify-center gap-2 rounded-md bg-slate-800 px-4 text-sm font-black text-white shadow-sm transition-all duration-150 hover:-translate-y-px hover:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
              >
                <span>Open Workspace</span>
                <span aria-hidden="true">→</span>
              </button>
            ) : (
              <Link
                to="/workspace"
                className="inline-flex h-10 min-w-[160px] items-center justify-center gap-2 rounded-md bg-slate-800 px-4 text-sm font-black text-white shadow-sm transition-all duration-150 hover:-translate-y-px hover:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
              >
                <span>Open Workspace</span>
                <span aria-hidden="true">→</span>
              </Link>
            )}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {sourceStats.map(([label, value, caption]) => (
            <div key={label} className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
              <div className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">{label}</div>
              <div className="mt-2 text-2xl font-black text-slate-950">{value}</div>
              <div className="mt-1 text-xs font-bold text-slate-500">{caption}</div>
            </div>
          ))}
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
              <div>
                <h3 className="text-sm font-black text-slate-950">Files</h3>
                <p className="mt-0.5 text-xs font-semibold text-slate-500">Track uploaded files and whether they are ready to use.</p>
              </div>
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-black text-emerald-700">
                {publishedImports} published
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-left">
                <thead className="border-b border-slate-100 bg-white">
                  <tr>
                    {["Source", "File", "Revision", "Uploaded by", "Date", "Publish state"].map((head) => (
                      <th key={head} className="px-4 py-3 text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">{head}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {fileRows.length ? fileRows.map((row) => (
                    <tr key={row.id} className="border-b border-slate-100 last:border-b-0 hover:bg-blue-50/40">
                      <td className="px-4 py-3 text-sm font-black text-slate-900">{row.source}</td>
                      <td className="px-4 py-3 text-sm font-semibold text-slate-600">{row.latestFile}</td>
                      <td className="px-4 py-3 text-xs font-black text-slate-500">{row.revision}</td>
                      <td className="px-4 py-3 text-xs font-semibold text-slate-600">{row.uploadedBy || "-"}</td>
                      <td className="px-4 py-3 text-xs font-semibold text-slate-600">{row.uploadedAt ? new Date(row.uploadedAt).toLocaleDateString() : "-"}</td>
                      <td className="px-4 py-3">
                        <div className="inline-flex items-center gap-2">
                          <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${statusBadgeClass(row.status, row.revision)}`}>
                            {row.statusLabel}
                          </span>
                          {canReviewImports && row.importId ? (
                            <button
                              type="button"
                              onClick={() => handleDeleteImport(row)}
                              disabled={!!reviewBusyId}
                              title={
                                row.status === "pending_approval"
                                  ? "Delete pending file"
                                  : row.status === "superseded"
                                    ? "Delete old revision"
                                    : row.status === "published"
                                      ? "Delete published file"
                                    : "Delete rejected file"
                              }
                              aria-label={
                                row.status === "pending_approval"
                                  ? "Delete pending file"
                                  : row.status === "superseded"
                                    ? "Delete old revision"
                                    : row.status === "published"
                                      ? "Delete published file"
                                    : "Delete rejected file"
                              }
                              className={`inline-flex h-6 w-6 items-center justify-center rounded-md border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 ${reviewBusyId ? "opacity-60 cursor-not-allowed" : ""}`}
                            >
                              🗑
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan="6" className="px-4 py-8 text-center text-sm font-semibold text-slate-500">
                        No governed financial sources yet. Open the workspace to create a source and upload the first revision.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div ref={reviewQueueRef} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm scroll-mt-24">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-black text-slate-950">Review Required</h3>
              <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-black text-amber-700">{reviewRows.length} waiting</span>
            </div>
            <div className="mt-4 space-y-3">
              {reviewRows.length ? reviewRows.slice(0, 4).map((row) => {
                const isRejected = row.status === "rejected";
                const publishBusy = reviewBusyId === `publish:${row.importId}`;
                const rejectBusy = reviewBusyId === `reject:${row.importId}`;
                const deleteBusy = reviewBusyId === `delete:${row.importId}`;
                const compatibility = aiCompatibilityBySheetId.get(String(row.sheetId || ""));
                const publishBlockedByCompatibility = compatibility ? compatibility.approvalReady === false : false;
                const compatibilityBlockReason = summarizeCompatibilityMissing(compatibility?.missing || []);
                const compatibilityMissingList = Array.isArray(compatibility?.missing)
                  ? compatibility.missing.map((m) => String(m || "").trim()).filter(Boolean)
                  : [];
                const publishDisabled = !!reviewBusyId || publishBlockedByCompatibility;
                const inlineError = reviewInlineErrorByImportId[String(row.importId || "")] || "";
                return (
                  <div key={`review-${row.id}`} className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-xs font-black text-slate-900">{row.source}</div>
                        <div className="mt-1 truncate text-xs font-semibold text-slate-600">{row.latestFile} · {row.revision}</div>
                      </div>
                      <span className={`shrink-0 rounded-full bg-white px-2 py-0.5 text-[10px] font-black ${isRejected ? "text-rose-700" : "text-amber-700"}`}>
                        {isRejected ? "Rejected" : "Review"}
                      </span>
                    </div>
                    {canReviewImports && (
                      isRejected ? (
                        <div className="mt-3">
                          <button
                            type="button"
                            disabled={!!reviewBusyId}
                            onClick={() => handleDeleteImport(row)}
                            className={`w-full rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-[11px] font-black text-rose-700 hover:bg-rose-100 ${reviewBusyId ? "opacity-60 cursor-not-allowed" : ""}`}
                          >
                            {deleteBusy ? "Deleting..." : "Delete"}
                          </button>
                        </div>
                      ) : (
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            disabled={!!reviewBusyId}
                            onClick={() => handleReviewAction(row, "reject")}
                            className={`rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-black text-slate-600 hover:bg-slate-50 ${reviewBusyId ? "opacity-60 cursor-not-allowed" : ""}`}
                          >
                            {rejectBusy ? "Rejecting..." : "Reject"}
                          </button>
                          <button
                            type="button"
                            disabled={publishDisabled}
                            onClick={() => handleReviewAction(row, "publish")}
                            className={`rounded-md bg-emerald-600 px-2 py-1.5 text-[11px] font-black text-white hover:bg-emerald-700 ${publishDisabled ? "opacity-60 cursor-not-allowed" : ""}`}
                          >
                            {publishBusy ? "Publishing..." : "Publish"}
                          </button>
                        </div>
                      )
                    )}
                    {publishBlockedByCompatibility ? (
                      <div className="mt-2 rounded-md border border-amber-200 bg-white/70 p-2 text-[10px] font-semibold text-amber-700">
                        <div>Cannot publish: {compatibilityBlockReason}</div>
                        {compatibilityMissingList.length ? (
                          <div className="mt-1 space-y-0.5 text-[10px] font-semibold text-amber-700/90">
                            {compatibilityMissingList.slice(0, 5).map((reason, idx) => (
                              <div key={`compat-missing-${idx}`}>{idx + 1}. {reason}</div>
                            ))}
                          </div>
                        ) : null}
                        {canReviewImports ? (
                          <button
                            type="button"
                            disabled={headerRepairModal.loading || headerRepairModal.saving}
                            onClick={() => openHeaderRepairModal(row)}
                            className="mt-2 rounded-md border border-amber-300 bg-amber-100 px-2 py-1 text-[10px] font-black text-amber-800 hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Fix headers in uploaded sheet
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                    {!publishBlockedByCompatibility && inlineError ? (
                      <div className="mt-2 text-[10px] font-semibold text-amber-700">
                        {inlineError}
                      </div>
                    ) : null}
                  </div>
                );
              }) : (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-black text-slate-900">No imports waiting for review</div>
                  <div className="mt-1 text-xs font-semibold leading-5 text-slate-500">
                    Files held by review rules appear here before they become the published revision.
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className={`mt-6 grid grid-cols-1 ${chatSection ? "2xl:grid-cols-[minmax(0,1fr)_36rem]" : ""} gap-3`}>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            {orderedCardsWithOverrides.map((card) => {
              const isEditingCard = card.id === "pinnedMetrics" ? queryOpen : !!kpiEditorOpen[card.id];
              return (
                <div
                  key={card.id}
                  draggable={!isEditingCard}
                  onDragStart={(e) => {
                  if (isEditingCard) {
                    e.preventDefault();
                    return;
                  }
                  setDragCardId(card.id);
                  setDropCardId("");
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", card.id);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                }}
                onDragEnter={(e) => {
                  e.preventDefault();
                  if (!dragCardId || dragCardId === card.id) return;
                  setDropCardId(card.id);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const sourceId = dragCardId || e.dataTransfer.getData("text/plain");
                  const targetId = card.id;
                  if (!sourceId || !targetId || sourceId === targetId) {
                    setDragCardId("");
                    setDropCardId("");
                    return;
                  }
                  setTopCardsOrder((prev) => {
                    const current = Array.isArray(prev) && prev.length
                      ? [...prev]
                      : orderedCardsWithOverrides.map((c) => c.id);
                    const sourceIdx = current.indexOf(sourceId);
                    const targetIdx = current.indexOf(targetId);
                    if (sourceIdx < 0 || targetIdx < 0) return current;
                    const tmp = current[sourceIdx];
                    current[sourceIdx] = current[targetIdx];
                    current[targetIdx] = tmp;
                    return current;
                  });
                  setDragCardId("");
                  setDropCardId("");
                }}
                onDragEnd={() => {
                  setDragCardId("");
                  setDropCardId("");
                }}
                className={`rounded-md border border-slate-200 bg-white shadow-sm ${
                  card.id === "pinnedMetrics"
                    ? (queryOpen ? "p-2.5" : "min-h-[156px] p-2.5")
                    : (kpiEditorOpen[card.id] ? "p-3" : "min-h-[132px] p-2.5")
                } ${!isEditingCard ? "cursor-grab active:cursor-grabbing" : "cursor-default"} ${dragCardId === card.id ? "opacity-70 ring-2 ring-blue-300" : ""} ${dropCardId === card.id ? "ring-2 ring-slate-300" : ""}`}
                >
                {card.id === "pinnedMetrics" ? (
                  <>
                    <div className="flex items-center justify-between">
                      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-700">{ui.pinnedMetrics || "Pinned Metrics"}</div>
                      {canEditTickets && (
                        <button
                          type="button"
                          onClick={() => setQueryOpen((v) => !v)}
                          className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-slate-300 bg-white text-[13px] font-bold text-slate-700 hover:bg-slate-50"
                          title={queryOpen ? "Close pinned editor" : "Edit pinned metrics"}
                          aria-label={queryOpen ? "Close pinned editor" : "Edit pinned metrics"}
                        >
                          ✓
                        </button>
                      )}
                    </div>
                    {!canShowPinnedValues && pinnedConfig?.signature && pinnedConfig.signature !== sheetStructureSignature && (
                      <div className="mt-1 text-[10px] font-semibold text-amber-700">
                        Sheet structure changed. Values hidden until this structure is pinned again.
                      </div>
                    )}
                    <div className="mt-1">
                      <div className="grid grid-cols-2 gap-1">
                        {ensurePinnedItems(pinnedInput.items).map((item, idx) => (
                          <div key={`pinned-value-${idx}`} className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5">
                            <div className="text-[11px] font-semibold tracking-wide text-slate-700 truncate">
                              {String(pinnedTitleDisplayMap[idx] || item.title || `Value ${idx + 1}`)}
                            </div>
                            <div className="mt-1 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] font-semibold text-slate-900">
                              {formatPinnedDisplayValue(item.value, pinnedTitleDisplayMap[idx] || item.title) || "—"}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    {canEditTickets && queryOpen && (
                      <>
                        <div className="mt-2 rounded-md border border-slate-200 bg-slate-50/70 p-1.5 space-y-1.5">
                          {ensurePinnedItems(pinnedInput.items).map((item, idx) => (
                            <div key={`pinned-edit-${idx}`} className="rounded-md border border-slate-200 bg-white p-1.5">
                              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-600">{`Metric ${idx + 1}`}</div>
                              <label className="mt-1 inline-flex items-center gap-1.5 text-[10px] font-semibold text-slate-700">
                                <input
                                  type="checkbox"
                                  checked={!!item.pinned}
                                  onChange={(e) => {
                                    const next = ensurePinnedItems(pinnedInput.items);
                                    next[idx] = { ...next[idx], pinned: e.target.checked };
                                    setPinnedInput((prev) => ({ ...prev, items: next }));
                                  }}
                                  className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-200"
                                />
                                <span>Pinned</span>
                              </label>
                              <input
                                type="text"
                                value={item.title}
                                onChange={(e) => {
                                  const next = ensurePinnedItems(pinnedInput.items);
                                  next[idx] = { ...next[idx], title: e.target.value };
                                  setPinnedInput((prev) => ({ ...prev, items: next }));
                                }}
                                placeholder={`Title ${idx + 1}`}
                                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-[13px] font-semibold text-slate-900"
                              />
                              <textarea
                                value={item.description}
                                onChange={(e) => {
                                  const next = ensurePinnedItems(pinnedInput.items);
                                  next[idx] = { ...next[idx], description: e.target.value };
                                  setPinnedInput((prev) => ({ ...prev, items: next }));
                                }}
                                placeholder="Example: What is the total revenue for Q4 2025? Return only the number."
                                className="mt-1 h-12 w-full resize-none rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-900"
                              />
                              <button
                                type="button"
                                onClick={() => submitPinnedPromptToAI(idx)}
                                disabled={!String(item.description || "").trim() || !!dashboardAiState.pendingByKey?.[`pinned:${idx}`]}
                                className={`mt-1 w-full rounded-md border px-2 py-1 text-[11px] font-semibold ${
                                  (!String(item.description || "").trim() || !!dashboardAiState.pendingByKey?.[`pinned:${idx}`])
                                    ? "border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed"
                                    : "border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100"
                                }`}
                              >
                                {dashboardAiState.pendingByKey?.[`pinned:${idx}`] ? "Submitting..." : "Submit to AI"}
                              </button>
                              {!!dashboardAiState.errorByKey?.[`pinned:${idx}`] && (
                                <div className="mt-1 text-[10px] font-semibold text-rose-700">
                                  {dashboardAiState.errorByKey[`pinned:${idx}`]}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </>
                ) : (
                  <>
                <div className="flex items-center justify-between">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-700 truncate" title={card.label}>
                    {card.label}
                  </div>
                  {canEditTickets && (
                    <button
                      type="button"
                      onClick={() => setKpiEditorOpen((prev) => ({ ...prev, [card.id]: !prev?.[card.id] }))}
                      className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-slate-300 bg-white text-[12px] font-bold text-slate-700 hover:bg-slate-50"
                      title={kpiEditorOpen[card.id] ? "Close ticket editor" : "Edit ticket"}
                      aria-label={kpiEditorOpen[card.id] ? "Close ticket editor" : "Edit ticket"}
                    >
                      ✎
                    </button>
                  )}
                </div>
                {canEditTickets && kpiEditorOpen[card.id] && (
                  <div className="mt-1 rounded-md border border-slate-200 bg-slate-50 p-2">
                    <input
                      type="text"
                      value={String(kpiDraftOverrides?.[card.id]?.labelCustom ? (kpiDraftOverrides?.[card.id]?.label || "") : (kpiOverrides?.[card.id]?.label || card.label || ""))}
                      onChange={(e) => {
                        const value = e.target.value;
                        setKpiDraftOverrides((prev) => ({
                          ...prev,
                          [card.id]: { ...(prev?.[card.id] || {}), label: value, labelCustom: true },
                        }));
                      }}
                      placeholder="Ticket name"
                      className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-900"
                    />
                    {hasMultipleTabs && (
                      <div className="mt-1 flex items-center gap-2">
                        <span className="shrink-0 text-[11px] font-semibold text-slate-700">Tab</span>
                        <select
                          value={String(activeTab || tabs[0] || "")}
                          onChange={(e) => onTabChange && onTabChange(e.target.value)}
                          className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-900"
                        >
                          {tabs.map((t) => (
                            <option key={`kpi-tab-${card.id}-${t}`} value={t}>{t}</option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div className="mt-1 grid grid-cols-2 gap-1">
                      <select
                        value={String(kpiDraftOverrides?.[card.id]?.column || "")}
                        onChange={(e) => {
                          const value = e.target.value;
                          setKpiDraftOverrides((prev) => ({
                            ...prev,
                            [card.id]: { ...(prev?.[card.id] || {}), column: value },
                          }));
                        }}
                        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-900"
                      >
                        <option value="">Column…</option>
                        {allowedHeaders.map((h) => (
                          <option key={`kpi-col-${card.id}-${h}`} value={h}>{h}</option>
                        ))}
                      </select>
                      <select
                        value={String(kpiDraftOverrides?.[card.id]?.agg || "sum")}
                        onChange={(e) => {
                          const value = e.target.value;
                          setKpiDraftOverrides((prev) => ({
                            ...prev,
                            [card.id]: { ...(prev?.[card.id] || {}), agg: value },
                          }));
                        }}
                        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-900"
                      >
                        <option value="sum">Sum</option>
                        <option value="avg">Avg</option>
                        <option value="percent">Percentage</option>
                        <option value="count">Count</option>
                      </select>
                    </div>
                    {String(kpiDraftOverrides?.[card.id]?.agg || "sum") === "percent" && (
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={String(kpiDraftOverrides?.[card.id]?.percentBaseValue || "")}
                        onChange={(e) => {
                          const value = e.target.value;
                          setKpiDraftOverrides((prev) => ({
                            ...prev,
                            [card.id]: { ...(prev?.[card.id] || {}), percentBaseValue: value },
                          }));
                        }}
                        placeholder="Base value for %"
                        className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-900"
                      />
                    )}
                    <div
                      className="mt-1 rounded-md border border-slate-200 bg-slate-50/80 p-2"
                      style={{ fontFamily: "'Aptos', 'Segoe UI Variable Text', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif" }}
                    >
                      <div className="grid grid-cols-2 gap-1">
                        <KpiCalendarField
                          label="From"
                          value={String(kpiDraftOverrides?.[card.id]?.from || "")}
                          onChange={(nextValue) => {
                            setKpiDraftOverrides((prev) => ({
                              ...prev,
                              [card.id]: { ...(prev?.[card.id] || {}), from: nextValue },
                            }));
                          }}
                        />
                        <KpiCalendarField
                          label="To"
                          value={String(kpiDraftOverrides?.[card.id]?.to || "")}
                          onChange={(nextValue) => {
                            setKpiDraftOverrides((prev) => ({
                              ...prev,
                              [card.id]: { ...(prev?.[card.id] || {}), to: nextValue },
                            }));
                          }}
                        />
                      </div>
                      <div className="mt-2">
                        <button
                          type="button"
                          className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                          onClick={() => {
                            setKpiDraftOverrides((prev) => ({
                              ...prev,
                              [card.id]: { ...(prev?.[card.id] || {}), from: "", to: "" },
                            }));
                          }}
                        >
                          All time
                        </button>
                      </div>
                    </div>
                    <div className="mt-1 grid grid-cols-2 gap-1">
                      <input
                        type="text"
                        value={String(kpiDraftOverrides?.[card.id]?.aiQuery || "")}
                        onChange={(e) => {
                          const value = e.target.value;
                          setKpiDraftOverrides((prev) => ({
                            ...prev,
                            [card.id]: { ...(prev?.[card.id] || {}), aiQuery: value },
                          }));
                        }}
                        placeholder="Example: What is the latest value for Net Income? Return only the number."
                        className="col-span-2 rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-900"
                      />
                      <button
                        type="button"
                        onClick={() => submitTicketPromptToAI(card.id, kpiDraftOverrides?.[card.id]?.aiQuery || "")}
                        disabled={!String(kpiDraftOverrides?.[card.id]?.aiQuery || "").trim() || !!dashboardAiState.pendingByKey?.[`ticket:${card.id}`]}
                        className={`col-span-2 rounded-md border px-2 py-1 text-[11px] font-semibold ${
                          (!String(kpiDraftOverrides?.[card.id]?.aiQuery || "").trim() || !!dashboardAiState.pendingByKey?.[`ticket:${card.id}`])
                            ? "border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed"
                            : "border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100"
                        }`}
                      >
                        {dashboardAiState.pendingByKey?.[`ticket:${card.id}`] ? "Applying..." : "Apply AI to fields"}
                      </button>
                      {!!dashboardAiState.errorByKey?.[`ticket:${card.id}`] && (
                        <div className="col-span-2 text-[10px] font-semibold text-rose-700">
                          {dashboardAiState.errorByKey[`ticket:${card.id}`]}
                        </div>
                      )}
                    </div>
                    <div className="mt-1 grid grid-cols-2 gap-1 items-center">
                      <label className="col-span-2 inline-flex items-center gap-1.5 text-[10px] font-semibold text-slate-700">
                        <input
                          type="checkbox"
                          checked={!!kpiDraftOverrides?.[card.id]?.manualOverride}
                          onChange={(e) => {
                            const value = e.target.checked;
                            setKpiDraftOverrides((prev) => ({
                              ...prev,
                              [card.id]: { ...(prev?.[card.id] || {}), manualOverride: value },
                            }));
                          }}
                          className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-200"
                        />
                        <span>AI override calculated value</span>
                      </label>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-1">
                      <button
                        type="button"
                        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                        onClick={() => {
                          setKpiDraftOverrides((prev) => ({ ...prev, [card.id]: { ...(kpiOverrides?.[card.id] || {}) } }));
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100"
                        onClick={() => {
                          const next = { ...kpiOverrides, [card.id]: { ...(kpiDraftOverrides?.[card.id] || {}) } };
                          persistKpiOverrides(next);
                        }}
                      >
                        Save
                      </button>
                    </div>
                  </div>
                )}
                {card.subtitle && (
                  <div className="mt-0.5 text-[11px] font-semibold text-slate-800 truncate" title={card.subtitle}>
                    {card.subtitle}
                  </div>
                )}
                {kpiDateRangeText && (
                  <div className="mt-0.5 text-[10px] font-semibold text-slate-700 truncate" title={kpiDateRangeText}>
                    {kpiDateRangeText}
                  </div>
                )}
                <div className="mt-0.5 text-[1.18rem] font-semibold text-slate-900">
                  {typeof card.value === "number" ? formatMoneyIfLarge(card.value, locale) : metricValue(card.value, locale)}
                </div>
                {card.sparkline?.length > 1 ? (
                  <div className="mt-1 h-9">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={card.sparkline}>
                      <Tooltip
                        content={({ active, payload, label }) => {
                          if (!active || !payload?.length) return null;
                          const row = payload[0];
                          const pointPeriod = row?.payload?.period ?? label;
                          return (
                            <div style={{
                              fontSize: "11px",
                              borderRadius: "8px",
                              border: "1px solid #cbd5e1",
                              boxShadow: "0 8px 20px rgba(15,23,42,0.08)",
                              padding: "6px 8px",
                              background: "rgba(255,255,255,0.96)"
                            }}>
                              <div style={{ fontSize: "11px", fontWeight: 700, color: "#0f172a", marginBottom: "2px" }}>
                                {ui.date}: {formatPeriodAsExactDate(pointPeriod, locale)}
                              </div>
                              <div style={{ fontSize: "11px", color: "#0f172a", fontWeight: 600 }}>
                                {formatSparkValue(row?.value, card.sparklineType, locale)}
                              </div>
                            </div>
                          );
                        }}
                      />
                        <defs>
                          <linearGradient id={`spark-${card.id}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={card.color} stopOpacity={0.35} />
                            <stop offset="95%" stopColor={card.color} stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <Area
                          type="monotone"
                          dataKey="value"
                          stroke={card.color}
                          strokeOpacity={0.6}
                          strokeWidth={1.8}
                          fill={`url(#spark-${card.id})`}
                          dot={false}
                          isAnimationActive={false}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                ) : <div className="mt-1 h-9" />}
                  </>
                )}
                </div>
              );
            })}
          </div>
        {chatSection && (
          <div className="rounded-md border border-slate-200 bg-white p-2 shadow-sm h-[296px] max-h-[42vh] overflow-hidden">
            <div className="h-full min-h-0">{chatSection}</div>
          </div>
        )}
      </div>

        <div className="mt-5 grid grid-cols-1 gap-3">
          <div className="min-w-0 space-y-3">
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
              <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm xl:col-span-2">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-700">
                    {(String(trendConfig.title || "").trim() || ui.trendOverTime)} {dateCol && (configuredTrendLines.length > 0) ? `(${configuredTrendLines.map(l => l.label || l.column).join(", ")} ${ui.by} ${dateCol})` : ""}
                  </div>
                  <button
                    type="button"
                    onClick={() => setTrendEditOpen((v) => !v)}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-slate-300 bg-white text-[12px] font-bold text-slate-700 hover:bg-slate-50"
                    title={trendEditOpen ? "Close Trend editor" : "Edit Trend"}
                    aria-label={trendEditOpen ? "Close Trend editor" : "Edit Trend"}
                  >
                    ✎
                  </button>
                </div>
                {trendEditOpen && (
                  <div className="mb-2 rounded-md border border-slate-200 bg-slate-50 p-2 space-y-2">
                    {hasMultipleTabs && (
                      <div className="flex items-center gap-2">
                        <span className="shrink-0 text-[11px] font-semibold text-slate-700">Tab</span>
                        <select
                          value={String(activeTab || tabs[0] || "")}
                          onChange={(e) => onTabChange && onTabChange(e.target.value)}
                          className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-900"
                        >
                          {tabs.map((t) => (
                            <option key={`trend-tab-${t}`} value={t}>{t}</option>
                          ))}
                        </select>
                      </div>
                    )}
                    <input
                      type="text"
                      value={String(trendConfig.title || "")}
                      onChange={(e) => setTrendConfig((prev) => ({ ...prev, title: e.target.value }))}
                      placeholder={ui.trendOverTime}
                      className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-900"
                    />
                    <div className="space-y-1">
                      {configuredTrendLines.map((line) => (
                        <div key={`trend-line-${line.id}`} className="grid grid-cols-12 gap-1">
                          <input
                            type="text"
                            value={String(line.label || "")}
                            onChange={(e) => {
                              const value = e.target.value;
                              setTrendConfig((prev) => ({
                                ...prev,
                                lines: (prev.lines || []).map((x) => (x.id === line.id ? { ...x, label: value } : x)),
                              }));
                            }}
                            placeholder="Line name"
                            className="col-span-4 rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-900"
                          />
                          <select
                            value={String(line.column || "")}
                            onChange={(e) => {
                              const value = e.target.value;
                              setTrendConfig((prev) => ({
                                ...prev,
                                lines: (prev.lines || []).map((x) => (x.id === line.id ? { ...x, column: value } : x)),
                              }));
                            }}
                            className="col-span-4 rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-900"
                          >
                            <option value="">Column…</option>
                            {numericHeaderOptions.map((h) => (
                              <option key={`trend-col-${line.id}-${h}`} value={h}>{h}</option>
                            ))}
                          </select>
                          <select
                            value={String(line.mode || "sum")}
                            onChange={(e) => {
                              const value = e.target.value;
                              setTrendConfig((prev) => ({
                                ...prev,
                                lines: (prev.lines || []).map((x) => (x.id === line.id ? { ...x, mode: value } : x)),
                              }));
                            }}
                            className="col-span-3 rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-900"
                          >
                            <option value="current">Current</option>
                            <option value="sum">Sum</option>
                            <option value="avg">Average</option>
                          </select>
                          <button
                            type="button"
                            onClick={() => {
                              setTrendConfig((prev) => ({
                                ...prev,
                                lines: (prev.lines || []).filter((x) => x.id !== line.id),
                              }));
                            }}
                            className="col-span-1 rounded-md border border-slate-300 bg-white px-1 py-1 text-[11px] font-bold text-slate-700 hover:bg-slate-50"
                            title="Remove line"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const id = `line_${Date.now()}`;
                        const defaultCol = numericHeaderOptions[0] || "";
                        setTrendConfig((prev) => ({
                          ...prev,
                          lines: [...(prev.lines || []), { id, label: defaultCol || "Line", column: defaultCol, mode: "sum" }],
                        }));
                      }}
                      className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      + Add line
                    </button>
                    <input
                      type="text"
                      value={String(trendConfig.aiQuery || "")}
                      onChange={(e) => setTrendConfig((prev) => ({ ...prev, aiQuery: e.target.value }))}
                      placeholder="Example: What is the average monthly revenue in the selected range? Return only the number."
                      className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-900"
                    />
                    <button
                      type="button"
                      onClick={() => submitChartPromptToAI("__trend_over_time__", trendConfig.aiQuery || "")}
                      disabled={!String(trendConfig.aiQuery || "").trim() || !!dashboardAiState.pendingByKey?.["chart:__trend_over_time__"]}
                      className={`rounded-md border px-2 py-1 text-[11px] font-semibold ${
                        (!String(trendConfig.aiQuery || "").trim() || !!dashboardAiState.pendingByKey?.["chart:__trend_over_time__"])
                          ? "border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed"
                          : "border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100"
                      }`}
                    >
                      {dashboardAiState.pendingByKey?.["chart:__trend_over_time__"] ? "Getting..." : "Get Value from AI"}
                    </button>
                    {!!dashboardAiState.errorByKey?.["chart:__trend_over_time__"] && (
                      <div className="text-[10px] font-semibold text-rose-700">
                        {dashboardAiState.errorByKey["chart:__trend_over_time__"]}
                      </div>
                    )}
                    <label className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-slate-700">
                      <input
                        type="checkbox"
                        checked={!!trendConfig.aiOverride}
                        onChange={(e) => setTrendConfig((prev) => ({ ...prev, aiOverride: e.target.checked }))}
                        className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-200"
                      />
                      <span>AI override calculated trend</span>
                    </label>
                  </div>
                )}
                {appliedRange && (
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-[11px] text-slate-800 font-semibold">
                      {ui.range}: {formatPeriodAsDateRange(appliedRange.start, locale)} {ui.to} {formatPeriodAsDateRange(appliedRange.end, locale)}
                    </span>
                    <button
                      type="button"
                      className="text-[11px] font-bold text-slate-700 hover:text-slate-900 underline"
                      onClick={() => setAppliedRange(null)}
                    >
                      {ui.resetRange}
                    </button>
                  </div>
                )}
                {trendDataDisplay.length > 1 ? (
                  <div
                    className="h-64 select-none"
                    onMouseDownCapture={(e) => e.preventDefault()}
                  >
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart
                        data={trendDataDisplay}
                        onMouseDown={onTrendMouseDown}
                        onMouseMove={onTrendMouseMove}
                        onMouseUp={onTrendMouseUp}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis
                          dataKey="period"
                          tick={{ fontSize: 11, fill: "#334155" }}
                          tickFormatter={(v) => formatPeriodAsDateRange(v, locale)}
                          interval="preserveStartEnd"
                          minTickGap={46}
                        />
                        <YAxis width={68} tick={{ fontSize: 11, fill: "#334155" }} tickFormatter={(v) => formatCompactCurrency(Number(v), locale)} />
                        <Tooltip
                          content={({ active, payload, label }) => {
                            if (!active || !payload?.length) return null;
                            const rows = payload.filter((p) => p?.dataKey !== "gapLower");
                            if (!rows.length) return null;
                            const rowOrder = (name = "") => {
                              const n = String(name).toLowerCase();
                              if (n.includes("revenue")) return 0;
                              if (n.includes("expense") || n === "gapband") return 1;
                              if (n.includes("income")) return 2;
                              return 3;
                            };
                            const orderedRows = [...rows].sort((a, b) => {
                              const aName = (a?.name || a?.dataKey || "").toString();
                              const bName = (b?.name || b?.dataKey || "").toString();
                              return rowOrder(aName) - rowOrder(bName);
                            });
                            const metricColor = (name = "") => {
                              const lower = String(name).toLowerCase();
                              if (lower.includes("expense") || lower === "gapband") return "#ea580c";
                              if (lower.includes("income")) return "#16a34a";
                              if (lower.includes("revenue")) return "#2563eb";
                              return "#334155";
                            };
                            return (
                              <div style={{
                                fontSize: "11px",
                                borderRadius: "10px",
                                border: "1px solid #e2e8f0",
                                boxShadow: "0 10px 22px rgba(15,23,42,0.10)",
                                padding: "8px 10px",
                                background: "rgba(255,255,255,0.96)"
                              }}>
                                <div style={{ fontSize: "11px", fontWeight: 800, color: "#0f172a", marginBottom: "4px" }}>
                                  {formatPeriodForTooltip(label, locale)}
                                </div>
                                {orderedRows.map((row, idx) => {
                                  const displayName = row?.name || row?.dataKey || ui.value;
                                  const rawVal = row?.value;
                                  const color = row?.color || row?.stroke || "#64748b";
                                  return (
                                    <div key={`${displayName}-${idx}`} style={{ fontSize: "11px", color: "#334155", margin: "1px 0", padding: 0, display: "flex", alignItems: "center", gap: "6px" }}>
                                      <span style={{ width: "8px", height: "8px", borderRadius: "9999px", background: color, display: "inline-block" }} />
                                      <span style={{ fontWeight: 800, color }}>{displayName}:</span>
                                      <span style={{ fontWeight: 600 }}>{formatMoneyIfLarge(Number(rawVal), locale)}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          }}
                        />
                        <Legend wrapperStyle={{ fontSize: "11px", color: "#1e293b" }} />
                        {trendConfig.aiOverride && Number.isFinite(trendAiValue) && (
                          <Line type="monotone" dataKey="__ai_override__" name="AI Override" stroke="#7c3aed" strokeWidth={2.2} dot={false} connectNulls />
                        )}
                        {!trendConfig.aiOverride && configuredTrendLines.map((line, idx) => (
                          <Line
                            key={`cfg-line-${line.id}`}
                            type="monotone"
                            dataKey={`cfg_${line.id}`}
                            name={String(line.label || line.column || `Line ${idx + 1}`)}
                            stroke={line.color || PIE_COLORS[idx % PIE_COLORS.length]}
                            strokeWidth={2.2}
                            dot={false}
                            connectNulls
                          />
                        ))}
                        {rangeDraft?.start && rangeDraft?.end && (
                          <ReferenceArea
                            x1={rangeDraft.start}
                            x2={rangeDraft.end}
                            strokeOpacity={0.25}
                            fill="#93c5fd"
                            fillOpacity={0.3}
                          />
                        )}
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="text-sm text-slate-700">{ui.needDateAndMetric}</div>
                )}
              </div>

              <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-700">
                    {topChartTitle} {topChartCategoryCol && topChartValueCol ? `(${topChartCategoryCol} ${ui.by} ${topChartValueCol})` : ""}
                  </div>
                  <button
                    type="button"
                    onClick={() => setTopCategoriesEditOpen((v) => !v)}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-slate-300 bg-white text-[12px] font-bold text-slate-700 hover:bg-slate-50"
                    title={topCategoriesEditOpen ? "Close Top Categories editor" : "Edit Top Categories"}
                    aria-label={topCategoriesEditOpen ? "Close Top Categories editor" : "Edit Top Categories"}
                  >
                    ✎
                  </button>
                </div>
                {topCategoriesEditOpen && (
                  <div className="mb-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                  {hasMultipleTabs && (
                    <div className="md:col-span-2 flex items-center gap-2">
                      <span className="shrink-0 text-[11px] font-semibold text-slate-700">Tab</span>
                      <select
                        value={String(activeTab || tabs[0] || "")}
                        onChange={(e) => onTabChange && onTabChange(e.target.value)}
                        className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-900"
                      >
                        {tabs.map((t) => (
                          <option key={`top-tab-${t}`} value={t}>{t}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <input
                    type="text"
                    value={String(topCategoriesConfig.title || "")}
                    onChange={(e) => setTopCategoriesConfig((prev) => ({ ...prev, title: e.target.value }))}
                    placeholder={ui.topCategories}
                    className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-900"
                  />
                  <select
                    value={String(topCategoriesConfig.agg || "sum")}
                    onChange={(e) => setTopCategoriesConfig((prev) => ({ ...prev, agg: e.target.value }))}
                    className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-900"
                  >
                    <option value="sum">Sum</option>
                    <option value="avg">Avg</option>
                  </select>
                  <select
                    value={String(topCategoriesConfig.categoryColumn || "")}
                    onChange={(e) => setTopCategoriesConfig((prev) => ({ ...prev, categoryColumn: e.target.value }))}
                    className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-900"
                  >
                    <option value="">Category column…</option>
                    {categoryHeaderOptions.map((h) => (
                      <option key={`top-cat-col-${h}`} value={h}>{h}</option>
                    ))}
                  </select>
                  <select
                    value={String(topCategoriesConfig.valueColumn || "")}
                    onChange={(e) => setTopCategoriesConfig((prev) => ({ ...prev, valueColumn: e.target.value }))}
                    className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-900"
                  >
                    <option value="">Value column…</option>
                    {numericHeaderOptions.map((h) => (
                      <option key={`top-val-col-${h}`} value={h}>{h}</option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={String(topCategoriesConfig.aiQuery || "")}
                    onChange={(e) => setTopCategoriesConfig((prev) => ({ ...prev, aiQuery: e.target.value }))}
                    placeholder="Example: What is the summed value for the top category by this metric? Return only the number."
                    className="md:col-span-2 rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-900"
                  />
                  <button
                    type="button"
                    onClick={() => submitChartPromptToAI("__top_categories__", topCategoriesConfig.aiQuery || "")}
                    disabled={!String(topCategoriesConfig.aiQuery || "").trim() || !!dashboardAiState.pendingByKey?.["chart:__top_categories__"]}
                    className={`md:col-span-2 rounded-md border px-2 py-1 text-[11px] font-semibold ${
                      (!String(topCategoriesConfig.aiQuery || "").trim() || !!dashboardAiState.pendingByKey?.["chart:__top_categories__"])
                        ? "border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed"
                        : "border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100"
                    }`}
                  >
                    {dashboardAiState.pendingByKey?.["chart:__top_categories__"] ? "Getting..." : "Get Value from AI"}
                  </button>
                  {!!dashboardAiState.errorByKey?.["chart:__top_categories__"] && (
                    <div className="md:col-span-2 text-[10px] font-semibold text-rose-700">
                      {dashboardAiState.errorByKey["chart:__top_categories__"]}
                    </div>
                  )}
                  <label className="md:col-span-2 inline-flex items-center gap-1.5 text-[10px] font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      checked={!!topCategoriesConfig.aiOverride}
                      onChange={(e) => setTopCategoriesConfig((prev) => ({ ...prev, aiOverride: e.target.checked }))}
                      className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-200"
                    />
                    <span>AI override calculated categories</span>
                  </label>
                  </div>
                )}
                {topChartCategoryAggDisplay.length > 0 ? (
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={topChartCategoryAggDisplay}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#334155" }} interval={0} angle={-15} textAnchor="end" height={60} />
                        <YAxis width={68} tick={{ fontSize: 11, fill: "#334155" }} tickFormatter={(v) => formatCompactCurrency(Number(v), locale)} />
                        <Tooltip
                          content={({ active, payload, label }) => {
                            if (!active || !payload?.length) return null;
                            const row = payload[0];
                            const color = row?.color || "#334155";
                            return (
                              <div style={{
                                fontSize: "11px",
                                borderRadius: "10px",
                                border: "1px solid #e2e8f0",
                                boxShadow: "0 10px 22px rgba(15,23,42,0.10)",
                                padding: "8px 10px",
                                background: "rgba(255,255,255,0.96)"
                              }}>
                                <div style={{ fontSize: "11px", fontWeight: 800, color: "#0f172a", marginBottom: "4px" }}>
                                  {label}
                                </div>
                                <div style={{ fontSize: "11px", margin: 0, padding: 0, display: "flex", alignItems: "center", gap: "6px" }}>
                                  <span style={{ width: "8px", height: "8px", borderRadius: "9999px", background: color, display: "inline-block" }} />
                                  <span style={{ fontWeight: 800, color }}>{topChartAggMode === "avg" ? "Avg" : ui.value}:</span>
                                  <span style={{ fontWeight: 600, color: "#334155" }}>{formatMoneyIfLarge(Number(row?.value), locale)}</span>
                                </div>
                              </div>
                            );
                          }}
                        />
                        <Bar dataKey="value" radius={[2, 2, 0, 0]}>
                          {topChartCategoryAggDisplay.map((entry, idx) => (
                            <Cell key={entry.name} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="text-sm text-slate-700">{ui.needCategoryColumn}</div>
                )}
              </div>
            </div>
          </div>
        </div>

        {headerRepairModal.open && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4">
            <div className="max-h-[90vh] w-full max-w-6xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
              <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
                <div>
                  <h3 className="text-base font-black text-slate-950">Repair required upload headers</h3>
                  <p className="mt-1 text-xs font-semibold text-slate-500">
                    Preview the uploaded sheet, choose the wrong column, and rename it to the required publish header.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeHeaderRepairModal}
                  disabled={headerRepairModal.saving}
                  className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-black text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {headerRepairPreview?.compatibility?.approval_ready ? "OK" : "Cancel"}
                </button>
              </div>
              <div className="max-h-[calc(90vh-88px)] overflow-auto p-5">
                {headerRepairModal.loading ? (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-600">
                    Loading uploaded sheet preview...
                  </div>
                ) : (
                  <>
                    {headerRepairModal.error ? (
                      <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700">
                        {headerRepairModal.error}
                      </div>
                    ) : null}
                    {headerRepairModal.success ? (
                      <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-700">
                        {headerRepairModal.success}
                      </div>
                    ) : null}
                    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_22rem]">
                      <div className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <div className="text-xs font-black text-slate-900">{headerRepairPreview.file_label || headerRepairModal.row?.latestFile || "Uploaded sheet"}</div>
                            <div className="mt-0.5 text-[11px] font-semibold text-slate-500">
                              Showing {headerRepairRows.length.toLocaleString("en-US")} of {headerRepairPreviewRowCount.toLocaleString("en-US")} rows and {headerRepairVisibleHeaders.length.toLocaleString("en-US")} columns.
                            </div>
                          </div>
                          {headerRepairPreview?.compatibility?.approval_ready ? (
                            <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-black text-emerald-700">Ready to publish</span>
                          ) : (
                            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-black text-amber-700">Needs repair</span>
                          )}
                        </div>
                        <div className="mt-3 max-h-[380px] overflow-auto rounded-lg border border-slate-200 bg-white">
                          <table className="min-w-full table-fixed divide-y divide-slate-200 text-left text-[11px]">
                            <thead className="sticky top-0 z-20 bg-slate-100 text-slate-700">
                              <tr>
                                <th className="sticky left-0 top-0 z-30 w-16 whitespace-nowrap border-r border-slate-200 bg-slate-100 px-2 py-2 font-black">
                                  Row
                                </th>
                                {headerRepairVisibleHeaders.map((header) => {
                                  return (
                                    <th
                                      key={`repair-head-${header}`}
                                      className="sticky top-0 whitespace-nowrap px-2 py-2 font-black"
                                    >
                                      {header}
                                    </th>
                                  );
                                })}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 bg-white">
                              {headerRepairRows.length ? headerRepairRows.map((row, rowIdx) => (
                                <tr key={`repair-row-${rowIdx}`}>
                                  <td className="sticky left-0 z-10 w-16 whitespace-nowrap border-r border-slate-100 bg-white px-2 py-1.5 font-bold text-slate-500">
                                    {rowIdx + 1}
                                  </td>
                                  {headerRepairVisibleHeaders.map((header) => {
                                    const cellValue = String(row?.[header] ?? "");
                                    const maskedCell = isMaskedColumn(header) || isHeaderRepairRedactedValue(cellValue);
                                    return (
                                      <td
                                        key={`repair-cell-${rowIdx}-${header}`}
                                        className={`max-w-[180px] truncate px-2 py-1.5 font-semibold ${maskedCell ? "bg-amber-50 ring-1 ring-inset ring-amber-300 font-bold text-slate-900" : "text-slate-600"}`}
                                        title={cellValue}
                                      >
                                        {cellValue}
                                      </td>
                                    );
                                  })}
                                </tr>
                              )) : (
                                <tr>
                                  <td className="px-2 py-4 text-center font-semibold text-slate-500" colSpan={Math.max(2, headerRepairVisibleHeaders.length + 1)}>
                                    No preview rows available.
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                        {headerRepairTabs.length > 1 ? (
                          <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
                            <SheetTabBar
                              tabs={headerRepairTabs}
                              activeTab={headerRepairModal.tabName || headerRepairTabs[0]}
                              onTabClick={handleHeaderRepairTabChange}
                              warningTabs={headerRepairTabs.filter((tab) => !!headerRepairTabStatusByName.get(tab)?.needs_repair)}
                            />
                          </div>
                        ) : null}
                        {headerRepairHasMoreRows ? (
                          <div className="mt-2 flex justify-end">
                            <button
                              type="button"
                              onClick={loadMoreHeaderRepairRows}
                              disabled={headerRepairModal.loading || headerRepairModal.saving}
                              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-black text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {headerRepairModal.loading ? "Loading..." : "Load more rows"}
                            </button>
                          </div>
                        ) : null}
                      </div>

                      <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 lg:sticky lg:top-0 self-start">
                        <div className="text-xs font-black text-slate-950">Required publish columns</div>
                        {headerRepairMissing.length ? (
                          <div className="mt-2 space-y-1 text-[11px] font-semibold text-amber-800">
                            {headerRepairMissing.slice(0, 6).map((reason, idx) => (
                              <div key={`repair-missing-${idx}`}>{idx + 1}. {reason}</div>
                            ))}
                          </div>
                        ) : (
                          <div className="mt-2 text-[11px] font-semibold text-emerald-700">No required publish header issues are currently detected.</div>
                        )}
                        <div className="mt-3 space-y-3">
                          <button
                            type="button"
                            onClick={() => setHeaderRepairModal((prev) => ({ ...prev, showHeaderRowTools: !prev.showHeaderRowTools }))}
                            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-left text-[11px] font-black text-slate-700 hover:bg-slate-50"
                          >
                            {headerRepairModal.showHeaderRowTools ? "Hide header-row adjustment" : "Adjust header row (optional)"}
                          </button>
                          {!headerRepairModal.showHeaderRowTools && headerRepairHasUsableHeaders ? (
                            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-[11px] font-semibold text-emerald-700">
                              Existing headers look usable. You can continue with column rename fixes below.
                            </div>
                          ) : null}
                          {(headerRepairModal.showHeaderRowTools || !headerRepairHasUsableHeaders) ? (
                            <>
                              <label className="block text-[11px] font-black text-slate-700">
                                Header row in uploaded file
                                  <select
                                    value={headerRepairModal.headerRowIndex}
                                    onChange={(e) => setHeaderRepairModal((prev) => ({ ...prev, headerRowIndex: e.target.value, error: "" }))}
                                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-xs font-semibold text-slate-900"
                                  >
                                    <option value="">Select row...</option>
                                    {headerRepairHeaderRowOptions.map((opt) => (
                                      <option key={`repair-header-row-${opt.value}`} value={opt.value}>{opt.label}</option>
                                    ))}
                                  </select>
                                </label>
                                {headerRepairHasMoreRows ? (
                                  <div className="text-[10px] font-semibold text-slate-500">
                                    More rows exist. Use "Load more rows" below to include additional row options with values.
                                  </div>
                                ) : null}
                              <button
                                type="button"
                                onClick={submitHeaderRowRepair}
                                disabled={headerRepairModal.saving || !headerRepairModal.headerRowIndex}
                                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-800 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {headerRepairModal.saving ? "Applying row..." : "Apply selected row as headers"}
                              </button>
                              <div className="rounded-lg border border-slate-200 bg-white p-2 text-[11px] font-semibold text-slate-600">
                                This will rebuild column headers from the selected row and remove rows up to that line from this tab.
                              </div>
                            </>
                          ) : null}
                        </div>
                        {headerRepairTargets.length ? (
                          <div className="mt-3 space-y-3">
                            <label className="block text-[11px] font-black text-slate-700">
                              Uploaded column to rename
                              <select
                                value={headerRepairModal.sourceHeader}
                                onChange={(e) => setHeaderRepairModal((prev) => ({ ...prev, sourceHeader: e.target.value, error: "" }))}
                                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-xs font-semibold text-slate-900"
                              >
                                <option value="">Select uploaded column...</option>
                                {headerRepairSourceHeaderOptions.map((header) => (
                                  <option key={`repair-source-${header}`} value={header}>{header}</option>
                                ))}
                              </select>
                            </label>
                            <label className="block text-[11px] font-black text-slate-700">
                              Required header name
                              <select
                                value={headerRepairModal.targetHeader}
                                onChange={(e) => setHeaderRepairModal((prev) => ({ ...prev, targetHeader: e.target.value, error: "" }))}
                                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-xs font-semibold text-slate-900"
                              >
                                {headerRepairTargetOptions.map((header) => (
                                  <option key={`repair-target-${header}`} value={header}>{header}</option>
                                ))}
                              </select>
                            </label>
                            <div className="rounded-lg border border-amber-200 bg-white p-2 text-[11px] font-semibold text-amber-800">
                              This will rename the selected uploaded column header and stored row key. It does not create calculated data or change cell values.
                            </div>
                            <button
                              type="button"
                              onClick={submitHeaderRepair}
                              disabled={headerRepairModal.saving || !headerRepairModal.sourceHeader || !headerRepairModal.targetHeader}
                              className="w-full rounded-md bg-slate-900 px-3 py-2 text-xs font-black text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {headerRepairModal.saving ? "Renaming..." : "Continue and rename header"}
                            </button>
                          </div>
                        ) : (
                          <div className="mt-3 rounded-lg border border-slate-200 bg-white p-2 text-[11px] font-semibold text-slate-600">
                            No rename repair is available for the current publish block.
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {insightSection && (
          <div className="mt-5">
            {insightSection}
          </div>
        )}
      </div>
    </div>
    </div>
  );
}
