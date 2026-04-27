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
  sheetId,
  activeFilename,
  tabs = [],
  activeTab = "",
  onTabChange,
  headers = [],
  sortedData = [],
  columnFilters = {},
  views = [],
  pivotOn,
  twoOn,
  trendsOn,
  chatSection = null,
  insightSection = null,
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
  const [kpiEditorOpen, setKpiEditorOpen] = React.useState({});
  const [kpiOverridesLoaded, setKpiOverridesLoaded] = React.useState(false);
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
  const pinnedTitleTranslateInFlightRef = React.useRef(new Set());
  const pinnedTitleTranslateCooldownRef = React.useRef(new Map());
  const pinnedConfigRef = React.useRef(null);

  React.useEffect(() => {
    pinnedConfigRef.current = pinnedConfig;
  }, [pinnedConfig]);

  const { metricCol, dateCol, categoryCol, profitCol, incomeCol, revenueCol, expenseCol } = React.useMemo(
    () => detectColumns(headers, sortedData),
    [headers, sortedData]
  );
  const revenueMetricCol = revenueCol || metricCol;
  const incomeMetricCol = incomeCol || profitCol;
  const canDeriveExpense = !expenseCol && !!revenueMetricCol && !!incomeMetricCol;

  const sheetStructureSignature = React.useMemo(
    () => headers.map((h) => String(h || "").trim().toLowerCase()).join("|"),
    [headers]
  );

  React.useEffect(() => {
    if (!headers.length) return;
    setKpiOverrides((prev) => {
        const next = { ...prev };
        const ids = ["metricAvg", "incomeTotal", "incomeAvg", "incomeMargin", "latestPeriod", "topValue", "topShare"];
        
        ids.forEach(id => {
            // If this card is new to this sheet structure, or if it contains an AI override, reset it
            if (!next[id]?.column || next[id]?.aiOverride || next[id]?.manualOverride) {
                const defaultCol = (id === "metricAvg") ? (metricCol || "") :
                                 (id === "incomeTotal" || id === "incomeAvg" || id === "incomeMargin") ? (incomeMetricCol || "") :
                                 (revenueMetricCol || "");
                
                const defaultCat = (id === "topValue" || id === "topShare") ? (categoryCol || "") : "";

                next[id] = { 
                    ...next[id], 
                    column: defaultCol, 
                    categoryColumn: defaultCat,
                    label: "", 
                    subtitle: "",
                    aiValue: "", 
                    manualOverride: false, 
                    aiOverride: false 
                };
            }
        });

        return next;
    });
  }, [headers, metricCol, incomeMetricCol, revenueMetricCol, categoryCol, sheetStructureSignature]);

  const numericHeaderOptions = React.useMemo(() => {
    return headers.filter((h) => {
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
  }, [headers, sortedData]);

  const categoryHeaderOptions = React.useMemo(() => {
    return headers.filter((h) => {
      if (numericHeaderOptions.includes(h)) return false;
      const seen = new Set();
      for (let i = 0; i < Math.min(sortedData.length, 400); i += 1) {
        const raw = String(sortedData[i]?.[h] ?? "").trim();
        if (!raw) continue;
        seen.add(raw);
      }
      return seen.size >= 2 && seen.size <= 80;
    });
  }, [headers, numericHeaderOptions, sortedData]);

  React.useEffect(() => {
    setTopCategoriesConfig((prev) => {
      const hasCategory = String(prev.categoryColumn || "").trim().length > 0;
      const hasValue = String(prev.valueColumn || "").trim().length > 0;
      const categoryValid = hasCategory && headers.includes(prev.categoryColumn);
      const valueValid = hasValue && headers.includes(prev.valueColumn);

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
  }, [categoryCol, metricCol, headers, sheetStructureSignature]);

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
    try {
      const raw = localStorage.getItem(KPI_OVERRIDES_KEY);
      if (!raw) {
        setKpiOverrides({});
        setKpiOverridesLoaded(true);
        return;
      }
      const parsed = JSON.parse(raw);
      const bySignature = parsed?.bySignature && typeof parsed.bySignature === "object" ? parsed.bySignature : {};
      const current = bySignature[sheetStructureSignature];
      setKpiOverrides(current && typeof current === "object" ? current : {});
      setKpiOverridesLoaded(true);
    } catch (_) {
      setKpiOverrides({});
      setKpiOverridesLoaded(true);
    }
  }, [sheetStructureSignature]);

  React.useEffect(() => {
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
      bySignature[sheetStructureSignature] = kpiOverrides;
      localStorage.setItem(KPI_OVERRIDES_KEY, JSON.stringify({ version: 1, bySignature }));
    } catch (_) {
      // ignore storage failures
    }
  }, [sheetStructureSignature, kpiOverrides, kpiOverridesLoaded]);

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
    const handleDashboardChatResponse = (event) => {
      const detail = event?.detail || {};
      if (!detail?.sheetId || String(detail.sheetId) !== String(sheetId)) return;
      const answer = String(detail.answer || "").trim();
      if (!answer) return;
      const meta = detail?.meta || {};

      // 1. KPI / Ticket Update
      if (meta.ticketId) {
        const cleaned = answer.replace(/[^\d.-]/g, "");
        const numeric = parseFloat(cleaned);
        if (!Number.isFinite(numeric)) return;

        if (meta.ticketId === "__top_categories__") {
          setTopCategoriesConfig((prev) => ({ ...prev, aiValue: String(numeric) }));
          return;
        }
        if (meta.ticketId === "__trend_over_time__") {
          setTrendConfig((prev) => ({ ...prev, aiValue: String(numeric) }));
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
        const cleaned = answer.replace(/[^\d.-]/g, "");
        const numeric = parseFloat(cleaned);
        if (Number.isNaN(numeric)) return;

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
  }, [sheetId, sheetStructureSignature, persistPinnedConfig]);

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

  const applyKpiOverride = React.useCallback((card) => {
    if (!card || card.id === "pinnedMetrics") return card;
    const override = kpiOverrides?.[card.id];
    if (!override || typeof override !== "object") return card;
    const labelOverride = String(override.label || "").trim();
    const column = String(override.column || "").trim();
    const agg = String(override.agg || "").toLowerCase();
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

    const manualOverride = !!override?.manualOverride;
    const aiParsed = Number(String(override?.aiValue ?? "").replace(/,/g, ""));
    const forcedValue = (manualOverride && Number.isFinite(aiParsed)) ? aiParsed : null;

    // Recalculate subtitle if it's a category card
    let finalSubtitle = card.subtitle;
    const categoryColumnOverride = String(override.categoryColumn || "").trim();
    const finalCategoryCol = categoryColumnOverride || categoryCol;

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
    }

    if (!column || !headers.includes(column)) {
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
      value: forcedValue !== null ? forcedValue : (Number.isFinite(nextValue) ? nextValue : 0),
      sparkline: dateCol ? buildSeriesFromRows(rows, dateCol, (r) => {
        if (agg === "count") {
          const raw = r?.[column];
          return raw === null || raw === undefined || String(raw).trim() === "" ? 0 : 1;
        }
        return parseNumber(r?.[column]);
      }, sparklineGranularity) : card.sparkline,
      sparklineType: agg === "count" ? "count" : "currency",
    };
  }, [kpiOverrides, effectiveRows, dateCol, headers, sparklineGranularity]);

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

  return (
    <div className="flex-1 min-h-0 bg-slate-50 relative overflow-y-auto scroll-smooth">
      <div className="p-5 md:p-7 bg-gradient-to-b from-slate-100 to-blue-50/60">
      <div className="rounded-lg p-5 md:p-7 border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h2 className="text-2xl md:text-3xl font-bold text-slate-900 tracking-tight">
              Hello {user?.name?.split(' ')[0] || user?.email?.split('@')[0]}!
            </h2>
          </div>
          <div className="flex gap-3">
            <Link
              to="/workspace"
              className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm transition-all duration-150 hover:-translate-y-px hover:border-slate-400 hover:bg-slate-50 hover:shadow focus:outline-none focus:ring-2 focus:ring-slate-200"
            >
              {ui.openWorkspace}
            </Link>
          </div>
        </div>

        <div className={`mt-6 grid grid-cols-1 ${chatSection ? "2xl:grid-cols-[minmax(0,1fr)_22rem]" : ""} gap-3`}>
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
                    ? (queryOpen ? "p-2.5" : "h-[160px] p-2.5 overflow-hidden")
                    : (kpiEditorOpen[card.id] ? "p-3" : "h-[160px] p-3 overflow-hidden")
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
                    {!queryOpen && <div className="mt-2 h-12" />}
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
                                disabled={!String(item.description || "").trim()}
                                className={`mt-1 w-full rounded-md border px-2 py-1 text-[11px] font-semibold ${
                                  !String(item.description || "").trim()
                                    ? "border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed"
                                    : "border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100"
                                }`}
                              >
                                Submit to AI
                              </button>
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
                      value={String(kpiOverrides?.[card.id]?.label || "")}
                      onChange={(e) => {
                        const value = e.target.value;
                        setKpiOverrides((prev) => ({
                          ...prev,
                          [card.id]: { ...(prev?.[card.id] || {}), label: value },
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
                        value={String(kpiOverrides?.[card.id]?.column || "")}
                        onChange={(e) => {
                          const value = e.target.value;
                          setKpiOverrides((prev) => ({
                            ...prev,
                            [card.id]: { ...(prev?.[card.id] || {}), column: value },
                          }));
                        }}
                        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-900"
                      >
                        <option value="">Column…</option>
                        {headers.map((h) => (
                          <option key={`kpi-col-${card.id}-${h}`} value={h}>{h}</option>
                        ))}
                      </select>
                      <select
                        value={String(kpiOverrides?.[card.id]?.agg || "sum")}
                        onChange={(e) => {
                          const value = e.target.value;
                          setKpiOverrides((prev) => ({
                            ...prev,
                            [card.id]: { ...(prev?.[card.id] || {}), agg: value },
                          }));
                        }}
                        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-900"
                      >
                        <option value="sum">Sum</option>
                        <option value="avg">Avg</option>
                        <option value="count">Count</option>
                      </select>
                    </div>
                    <div
                      className="mt-1 rounded-md border border-slate-200 bg-slate-50/80 p-2"
                      style={{ fontFamily: "'Aptos', 'Segoe UI Variable Text', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif" }}
                    >
                      <div className="grid grid-cols-2 gap-1">
                        <KpiCalendarField
                          label="From"
                          value={String(kpiOverrides?.[card.id]?.from || "")}
                          onChange={(nextValue) => {
                            setKpiOverrides((prev) => ({
                              ...prev,
                              [card.id]: { ...(prev?.[card.id] || {}), from: nextValue },
                            }));
                          }}
                        />
                        <KpiCalendarField
                          label="To"
                          value={String(kpiOverrides?.[card.id]?.to || "")}
                          onChange={(nextValue) => {
                            setKpiOverrides((prev) => ({
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
                            setKpiOverrides((prev) => ({
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
                        value={String(kpiOverrides?.[card.id]?.aiQuery || "")}
                        onChange={(e) => {
                          const value = e.target.value;
                          setKpiOverrides((prev) => ({
                            ...prev,
                            [card.id]: { ...(prev?.[card.id] || {}), aiQuery: value },
                          }));
                        }}
                        placeholder="Example: What is the latest value for Net Income? Return only the number."
                        className="col-span-2 rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-900"
                      />
                      <button
                        type="button"
                        onClick={() => submitTicketPromptToAI(card.id, kpiOverrides?.[card.id]?.aiQuery || "")}
                        disabled={!String(kpiOverrides?.[card.id]?.aiQuery || "").trim()}
                        className={`col-span-2 rounded-md border px-2 py-1 text-[11px] font-semibold ${
                          !String(kpiOverrides?.[card.id]?.aiQuery || "").trim()
                            ? "border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed"
                            : "border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100"
                        }`}
                      >
                        Get Value from AI
                      </button>
                    </div>
                    <div className="mt-1 grid grid-cols-2 gap-1 items-center">
                      <label className="col-span-2 inline-flex items-center gap-1.5 text-[10px] font-semibold text-slate-700">
                        <input
                          type="checkbox"
                          checked={!!kpiOverrides?.[card.id]?.manualOverride}
                          onChange={(e) => {
                            const value = e.target.checked;
                            setKpiOverrides((prev) => ({
                              ...prev,
                              [card.id]: { ...(prev?.[card.id] || {}), manualOverride: value },
                            }));
                          }}
                          className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-200"
                        />
                        <span>AI override calculated value</span>
                      </label>
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
                <div className="mt-1 text-[1.35rem] font-semibold text-slate-900">
                  {typeof card.value === "number" ? formatMoneyIfLarge(card.value, locale) : metricValue(card.value, locale)}
                </div>
                {card.sparkline?.length > 1 ? (
                  <div className="mt-1.5 h-11">
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
                ) : <div className="mt-1.5 h-11" />}
                  </>
                )}
                </div>
              );
            })}
          </div>
        {chatSection && (
          <div className="rounded-md border border-slate-200 bg-white p-2 shadow-sm h-[360px] max-h-[42vh] overflow-hidden">
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
                      disabled={!String(trendConfig.aiQuery || "").trim()}
                      className={`rounded-md border px-2 py-1 text-[11px] font-semibold ${
                        !String(trendConfig.aiQuery || "").trim()
                          ? "border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed"
                          : "border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100"
                      }`}
                    >
                      Get Value from AI
                    </button>
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
                    disabled={!String(topCategoriesConfig.aiQuery || "").trim()}
                    className={`md:col-span-2 rounded-md border px-2 py-1 text-[11px] font-semibold ${
                      !String(topCategoriesConfig.aiQuery || "").trim()
                        ? "border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed"
                        : "border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100"
                    }`}
                  >
                    Get Value from AI
                  </button>
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
