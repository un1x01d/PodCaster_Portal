import React from "react";
import { Link } from "react-router-dom";
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

function metricValue(value) {
  if (value === null || value === undefined) return "0";
  if (typeof value === "number") return value.toLocaleString();
  return String(value);
}

function pct(value) {
  if (!Number.isFinite(value)) return "0%";
  return `${value.toFixed(1)}%`;
}

function formatMoneyIfLarge(value) {
  if (!Number.isFinite(value)) return "0";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1000) {
    return `${sign}$${Math.round(abs).toLocaleString()}`;
  }
  return `${sign}$${abs.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function formatCompactCurrency(value) {
  if (!Number.isFinite(value)) return "$0";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${Math.round(abs).toLocaleString()}`;
}

function formatSparkValue(value, type) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "0";
  if (type === "percent") return `${numeric.toFixed(1)}%`;
  if (type === "count") return Math.round(numeric).toLocaleString();
  return formatMoneyIfLarge(numeric);
}

function formatPeriodAsDateRange(period) {
  if (typeof period !== "string") return String(period || "");
  const fmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });
  if (/^\d{1,2}$/.test(period)) {
    const month = Number(period);
    if (month >= 1 && month <= 12) {
      const y = new Date().getFullYear();
      const start = new Date(y, month - 1, 1);
      const end = new Date(y, month, 0);
      return `${fmt.format(start)} - ${fmt.format(end)}`;
    }
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(period)) {
    const [y, m, d] = period.split("-").map((v) => Number(v));
    if (!y || !m || !d) return period;
    const sameDay = fmt.format(new Date(y, m - 1, d));
    return `${sameDay} - ${sameDay}`;
  }
  if (!/^\d{4}-\d{2}$/.test(period)) return String(period || "");
  const [y, m] = period.split("-").map((v) => Number(v));
  if (!y || !m || m < 1 || m > 12) return period;
  const start = new Date(y, m - 1, 1);
  const end = new Date(y, m, 0);
  return `${fmt.format(start)} - ${fmt.format(end)}`;
}

function formatPeriodForTooltip(period) {
  if (typeof period !== "string") return String(period || "");
  if (/^\d{1,2}$/.test(period)) {
    const month = Number(period);
    if (month >= 1 && month <= 12) {
      const y = new Date().getFullYear();
      return new Intl.DateTimeFormat(undefined, { month: "short", year: "numeric" }).format(new Date(y, month - 1, 1));
    }
  }
  if (/^\d{4}-\d{2}$/.test(period)) {
    const [y, m] = period.split("-").map((v) => Number(v));
    if (!y || !m || m < 1 || m > 12) return period;
    return new Intl.DateTimeFormat(undefined, { month: "short", year: "numeric" }).format(new Date(y, m - 1, 1));
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(period)) {
    const [y, m, d] = period.split("-").map((v) => Number(v));
    if (!y || !m || !d) return period;
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(y, m - 1, d));
  }
  return String(period || "");
}

function formatPeriodAsExactDate(period) {
  const fmt = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" });
  if (typeof period !== "string") return String(period || "");
  if (/^\d{4}$/.test(period)) {
    return fmt.format(new Date(Number(period), 0, 1));
  }
  if (/^\d{1,2}$/.test(period)) {
    const month = Number(period);
    if (month >= 1 && month <= 12) return fmt.format(new Date(new Date().getFullYear(), month - 1, 1));
  }
  if (/^\d{4}-\d{2}$/.test(period)) {
    const [y, m] = period.split("-").map((v) => Number(v));
    if (!y || !m || m < 1 || m > 12) return period;
    return fmt.format(new Date(y, m - 1, 1));
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(period)) {
    const [y, m, d] = period.split("-").map((v) => Number(v));
    if (!y || !m || !d) return period;
    return fmt.format(new Date(y, m - 1, d));
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

function formatDateDisplay(date) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
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
  const d = new Date(v);
  if (!Number.isNaN(d.getTime())) return d;
  const n = Number(v);
  if (!Number.isNaN(n) && n > 25569 && n < 60000) {
    const excelDate = new Date(Math.round((n - 25569) * 86400 * 1000));
    if (!Number.isNaN(excelDate.getTime())) return excelDate;
  }
  return null;
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
  headers = [],
  sortedData = [],
  columnFilters = {},
  views = [],
  pivotOn,
  twoOn,
  trendsOn,
  chatSection = null,
}) {
  const [rangeDraft, setRangeDraft] = React.useState(null);
  const [appliedRange, setAppliedRange] = React.useState(null);

  const activeFilterCount = Object.entries(columnFilters).filter(([, v]) => {
    if (!v) return false;
    if (v instanceof Set) return v.size > 0;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === "object" && v.type === "contains") return !!v.value;
    return true;
  }).length;

  const { metricCol, dateCol, categoryCol, profitCol, incomeCol, revenueCol, expenseCol } = React.useMemo(
    () => detectColumns(headers, sortedData),
    [headers, sortedData]
  );
  const revenueMetricCol = revenueCol || metricCol;
  const incomeMetricCol = incomeCol || profitCol;
  const canDeriveExpense = !expenseCol && !!revenueMetricCol && !!incomeMetricCol;

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
  const topCategoryName = topCategory ? topCategory.name : "No category";
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
    if (toDateKey(minDate) === toDateKey(maxDate)) return formatDateDisplay(minDate);
    return `${formatDateDisplay(minDate)} to ${formatDateDisplay(maxDate)}`;
  }, [effectiveRows, dateCol]);

  const cards = [
    { id: "metricTotal", label: metricCol ? `${metricCol} Total` : "Primary Metric Total", value: metricCol ? metricSum : 0, sparkline: metricSeries, color: "#2563eb", sparklineType: "currency" },
    { id: "metricAvg", label: metricCol ? `${metricCol} Average` : "Primary Metric Average", value: metricCol ? metricAvg : 0, sparkline: metricSeries, color: "#2563eb", sparklineType: "currency" },
    {
      id: "incomeTotal",
      label: incomeCol ? `${incomeCol} Total` : (profitCol ? `${profitCol} Total` : (metricCol ? `${metricCol} Median` : "Primary Metric Median")),
      value: incomeCol ? incomeTotal : (profitCol ? profitTotal : metricMedian),
      sparkline: incomeCol ? incomeSeries : (profitCol ? profitSeries : metricSeries),
      color: incomeCol || profitCol ? "#16a34a" : "#2563eb",
      sparklineType: "currency",
    },
    {
      id: "incomeAvg",
      label: incomeCol ? `${incomeCol} Average` : (expenseCol ? `${expenseCol} Total` : "Income / Expense"),
      value: incomeCol ? incomeAvg : (expenseCol ? expenseTotal : 0),
      sparkline: incomeCol ? incomeSeries : (expenseCol ? expenseSeries : metricSeries),
      color: incomeCol ? "#16a34a" : "#b45309",
      sparklineType: "currency",
    },
    {
      id: "incomeMargin",
      label: incomeCol && revenueCol ? "Income Margin" : (expenseCol ? "Expense Share" : "Income Ratio"),
      value: incomeCol && revenueCol
        ? pct(marginPct)
        : (expenseCol && metricSum ? pct((expenseTotal / metricSum) * 100) : "0%"),
      sparkline: incomeCol && revenueCol ? marginSeries : (expenseCol ? expenseSeries : metricSeries),
      color: "#0f766e",
      sparklineType: "percent",
    },
    { id: "latestPeriod", label: "Latest Period Value", value: latestTrendPoint ? latestTrendPoint.metricValue : 0, sparkline: metricSeries, color: "#2563eb", sparklineType: "currency" },
    { id: "topValue", label: "Top Category Value", subtitle: topCategoryName, value: topCategoryValue, sparkline: topCategoryValueSeries, color: "#7c3aed", sparklineType: "currency" },
    { id: "topShare", label: "Top Category Share", value: pct(topCategoryShare), sparkline: topCategoryShareSeries, color: "#0369a1", sparklineType: "percent" },
  ];

  return (
    <div className="p-5 md:p-7 bg-gradient-to-b from-slate-100 to-blue-50/60">
      <div className="rounded-lg p-5 md:p-7 border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h2 className="text-2xl md:text-3xl font-bold text-slate-900 tracking-tight">
              Dashboard Overview
            </h2>
            <p className="text-slate-600 mt-1 text-sm md:text-base">
              Common metrics and system state for {user?.email || "current user"}.
            </p>
          </div>
          <div className="flex gap-3">
            <Link
              to="/workspace"
              className="btn-premium bg-blue-700 hover:bg-blue-800 text-white px-5"
            >
              Open Workspace
            </Link>
            {user?.role === "admin" && (
              <Link
                to="/users"
                className="btn-premium bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 px-5"
              >
                Admin Panel
              </Link>
            )}
          </div>
        </div>

        <div className={`mt-6 grid grid-cols-1 ${chatSection ? "2xl:grid-cols-[minmax(0,1fr)_22rem]" : ""} gap-3`}>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            {cards.map((card) => (
              <div
                key={card.label}
                className="rounded-md border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-700">
                  {card.label}
                </div>
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
                <div className="mt-1.5 text-2xl font-semibold text-slate-900">
                  {typeof card.value === "number" ? formatMoneyIfLarge(card.value) : metricValue(card.value)}
                </div>
                {card.sparkline?.length > 1 && (
                  <div className="mt-2 h-12">
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
                                Date: {formatPeriodAsExactDate(pointPeriod)}
                              </div>
                              <div style={{ fontSize: "11px", color: "#0f172a", fontWeight: 600 }}>
                                {formatSparkValue(row?.value, card.sparklineType)}
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
                )}
              </div>
            ))}
          </div>
          {chatSection && (
            <div className="rounded-md border border-slate-200 bg-white p-2 shadow-sm h-full">
              <div className="h-full">{chatSection}</div>
            </div>
          )}
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3">
          <div className="min-w-0 space-y-3">
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
              <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm xl:col-span-2">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-700 mb-2">
              Trend Over Time {dateCol && revenueMetricCol ? `(${revenueMetricCol}${incomeMetricCol ? `, ${incomeMetricCol}` : ""}${expenseCol || canDeriveExpense ? ", Expense" : ""} by ${dateCol})` : ""}
            </div>
            {appliedRange && (
              <div className="mb-2 flex items-center gap-2">
                <span className="text-[11px] text-slate-800 font-semibold">
                  Range: {formatPeriodAsDateRange(appliedRange.start)} to {formatPeriodAsDateRange(appliedRange.end)}
                </span>
                <button
                  type="button"
                  className="text-[11px] font-bold text-slate-700 hover:text-slate-900 underline"
                  onClick={() => setAppliedRange(null)}
                >
                  Reset range
                </button>
              </div>
            )}
            {trendData.length > 1 ? (
              <div
                className="h-64 select-none"
                onMouseDownCapture={(e) => e.preventDefault()}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={trendData}
                    onMouseDown={onTrendMouseDown}
                    onMouseMove={onTrendMouseMove}
                    onMouseUp={onTrendMouseUp}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis
                      dataKey="period"
                      tick={{ fontSize: 11, fill: "#334155" }}
                      tickFormatter={(v) => formatPeriodAsDateRange(v)}
                      interval="preserveStartEnd"
                      minTickGap={46}
                    />
                    <YAxis width={68} tick={{ fontSize: 11, fill: "#334155" }} tickFormatter={(v) => formatCompactCurrency(Number(v))} />
                    <Tooltip
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        const rows = payload.filter((p) => p?.dataKey !== "gapLower");
                        if (!rows.length) return null;
                        const rowOrder = (name = "") => {
                          const n = String(name).toLowerCase();
                          if (n.includes("revenue")) return 0;
                          if (n.includes("expense")) return 1;
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
                          if (lower.includes("expense")) return "#ea580c";
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
                              {formatPeriodForTooltip(label)}
                            </div>
                            {orderedRows.map((row, idx) => {
                              const rawName = row?.name || row?.dataKey || "Value";
                              const name = rawName === "gapBand" ? "Expenses" : rawName;
                              const rawVal = name === "Expenses"
                                ? row?.payload?.expenseFromRevenueIncome
                                : row?.value;
                              const color = metricColor(name);
                              return (
                                <div key={`${name}-${idx}`} style={{ fontSize: "11px", color: "#334155", margin: "1px 0", padding: 0, display: "flex", alignItems: "center", gap: "6px" }}>
                                  <span style={{ width: "8px", height: "8px", borderRadius: "9999px", background: color, display: "inline-block" }} />
                                  <span style={{ fontWeight: 800, color }}>{name}:</span>
                                  <span style={{ fontWeight: 600 }}>{formatMoneyIfLarge(Number(rawVal))}</span>
                                </div>
                              );
                            })}
                          </div>
                        );
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: "11px", color: "#1e293b" }} />
                    <Area
                      type="monotone"
                      dataKey="gapLower"
                      stackId="revIncomeGap"
                      fill="transparent"
                      fillOpacity={0}
                      stroke="none"
                      legendType="none"
                      isAnimationActive={false}
                      connectNulls
                    />
                    <Area type="monotone" dataKey="gapBand" stackId="revIncomeGap" fill="#fb923c" fillOpacity={0.2} stroke="none" isAnimationActive={false} connectNulls name="Expenses" />
                    <Line type="monotone" dataKey="revenueValue" name={revenueMetricCol || "Revenue"} stroke="#2563eb" strokeWidth={2.2} dot={false} connectNulls />
                    {incomeMetricCol && (
                      <Line type="monotone" dataKey="incomeValue" name={incomeMetricCol} stroke="#16a34a" strokeWidth={2.2} dot={false} connectNulls />
                    )}
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
              <div className="text-sm text-slate-700">Need both a date column and numeric metric to render trend chart.</div>
            )}
              </div>

              <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-700 mb-2">
              Top Categories {categoryCol && metricCol ? `(${categoryCol} by ${metricCol})` : ""}
            </div>
            {categoryAgg.length > 0 ? (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={categoryAgg}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#334155" }} interval={0} angle={-15} textAnchor="end" height={60} />
                    <YAxis width={68} tick={{ fontSize: 11, fill: "#334155" }} tickFormatter={(v) => formatCompactCurrency(Number(v))} />
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
                              <span style={{ fontWeight: 800, color }}>Value:</span>
                              <span style={{ fontWeight: 600, color: "#334155" }}>{formatMoneyIfLarge(Number(row?.value))}</span>
                            </div>
                          </div>
                        );
                      }}
                    />
                    <Bar dataKey="value" radius={[2, 2, 0, 0]}>
                      {categoryAgg.map((entry, idx) => (
                        <Cell key={entry.name} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="text-sm text-slate-700">Need a categorical column to render category bar chart.</div>
            )}
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
