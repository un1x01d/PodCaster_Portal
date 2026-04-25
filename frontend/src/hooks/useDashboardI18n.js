import { useEffect, useMemo, useState } from "react";
import api from "../api";

const DASHBOARD_COPY_CACHE = new Map();
const DASHBOARD_COPY_IN_FLIGHT = new Map();

export const DASHBOARD_COPY_EN = {
  portalTitle: "Data Insights Portal",
  selectSheet: "Select a sheet...",
  searchSpreadsheets: "Search spreadsheets...",
  signOut: "Sign out",
  language: "Language",
  dashboardOverview: "Dashboard Overview",
  dashboardSubtitle: "Common metrics and system state for {user}.",
  openWorkspace: "Open Workspace",
  adminPanel: "Admin Panel",
  trendOverTime: "Trend Over Time",
  by: "by",
  resetRange: "Reset range",
  range: "Range",
  to: "to",
  needDateAndMetric: "Need a date column and numeric metric to render the trend chart.",
  topCategories: "Top Categories",
  needCategoryColumn: "Need a categorical column to render category bar chart.",
  total: "Total",
  average: "Average",
  median: "Median",
  income: "Income",
  expense: "Expense",
  ratio: "Ratio",
  margin: "Margin",
  primaryMetricTotal: "Primary Metric Total",
  primaryMetricAverage: "Primary Metric Average",
  incomeMargin: "Income Margin",
  expenseShare: "Expense Share",
  incomeRatio: "Income Ratio",
  latestPeriodValue: "Latest Period Value",
  topCategoryValue: "Top Category Value",
  topCategoryShare: "Top Category Share",
  noCategory: "No category",
  insightFeed: "Insight Feed",
  automaticInsights: "Automatic trends, drivers, and anomalies",
  settings: "Settings",
  hideSettings: "Hide Settings",
  refresh: "Refresh",
  sensitivity: "Sensitivity",
  minImpactPercent: "Min Impact %",
  preferredDateColumn: "Preferred Date Column",
  preferredMetricColumn: "Preferred Metric Column",
  autoDetect: "Auto-detect",
  mutedMetrics: "Muted Metrics",
  unmute: "Unmute",
  mute: "Mute",
  saving: "Saving...",
  saveInsightSettings: "Save Insight Settings",
  loadingInsights: "Loading insights...",
  noInsightsYet: "No insights yet for this sheet.",
  needsAttention: "Needs Attention",
  aiRecommendations: "AI Recommendations",
  recommendation: "Recommendation",
  date: "Date",
  forecast: "Forecast",
  period: "Period",
  start: "Start",
  end: "End",
  value: "Value",
  point: "Point",
  failedToLoadInsights: "Failed to load insights",
  failedToSaveSettings: "Failed to save settings",
  dataAssistant: "Data Assistant",
  resetChat: "Reset Chat",
  expand: "Expand",
  collapse: "Collapse",
  close: "Close",
  openDataAssistant: "Open Data Assistant",
  askQuestion: "Ask a question...",
  send: "Send",
  chatResetMessage: "Chat reset. Ask another question about this spreadsheet.",
  chatInitialMessage: "Ask about what changed, why it changed, top drivers, and year-over-year differences in this dataset.",
  chatNoResponse: "I could not produce a response.",
  chatRequestFailed: "AI chat request failed.",
  appliedFilters: "Applied filters",
  revertFilter: "Revert Filter",
};

export const DASHBOARD_LANGUAGES = [
  { code: "en", label: "English" },
  { code: "uk", label: "Українська" },
  { code: "ru", label: "Русский" },
  { code: "es", label: "Español" },
];

export function normalizeDashboardLocale(locale) {
  const raw = String(locale || "").trim();
  if (!raw) return "en";
  const lower = raw.toLowerCase().replace("_", "-");
  const exact = DASHBOARD_LANGUAGES.find((item) => item.code.toLowerCase() === lower);
  if (exact) return exact.code;
  const base = lower.split("-")[0];
  const fallback = DASHBOARD_LANGUAGES.find((item) => item.code.toLowerCase().split("-")[0] === base);
  return fallback?.code || "en";
}

export function isDashboardEnglish(locale) {
  return normalizeDashboardLocale(locale).toLowerCase().startsWith("en");
}

export function formatTemplate(template, variables = {}) {
  let out = String(template ?? "");
  Object.entries(variables).forEach(([key, value]) => {
    const pattern = new RegExp(`\\{${key}\\}`, "g");
    out = out.replace(pattern, String(value ?? ""));
  });
  return out;
}

function getBrowserLocale() {
  if (typeof navigator === "undefined") return "en";
  return navigator.language || navigator.languages?.[0] || "en";
}

function initialLocale() {
  if (typeof window !== "undefined") {
    const saved = window.localStorage.getItem("dashboardLocale");
    if (saved) return normalizeDashboardLocale(saved);
  }
  return normalizeDashboardLocale(getBrowserLocale());
}

export function useDashboardI18n({ enabled = true } = {}) {
  const [locale, setLocale] = useState(initialLocale);
  const [copy, setCopy] = useState(DASHBOARD_COPY_EN);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("dashboardLocale", locale);
    }
  }, [locale]);

  useEffect(() => {
    let cancelled = false;
    const normalized = normalizeDashboardLocale(locale);
    if (!enabled) {
      setCopy(DASHBOARD_COPY_EN);
      setLoading(false);
      return undefined;
    }
    if (isDashboardEnglish(normalized)) {
      setCopy(DASHBOARD_COPY_EN);
      setLoading(false);
      return undefined;
    }

    const cached = DASHBOARD_COPY_CACHE.get(normalized);
    if (cached) {
      setCopy({ ...DASHBOARD_COPY_EN, ...cached });
      setLoading(false);
      return undefined;
    }

    const inFlight = DASHBOARD_COPY_IN_FLIGHT.get(normalized);
    if (inFlight) {
      setLoading(true);
      inFlight.then((translations) => {
        if (cancelled) return;
        setCopy({ ...DASHBOARD_COPY_EN, ...translations });
      }).finally(() => {
        if (!cancelled) setLoading(false);
      });
      return undefined;
    }

    setLoading(true);
    const request = api.post("/dashboard/translate", {
      locale: normalized,
      items: Object.entries(DASHBOARD_COPY_EN).map(([key, text]) => ({ key, text })),
    })
      .then((res) => {
        const translations = res?.data?.translations || {};
        DASHBOARD_COPY_CACHE.set(normalized, translations);
        return translations;
      });
    DASHBOARD_COPY_IN_FLIGHT.set(normalized, request);
    request
      .then((translations) => {
        if (cancelled) return;
        setCopy({ ...DASHBOARD_COPY_EN, ...translations });
      })
      .catch(() => {
        if (!cancelled) setCopy(DASHBOARD_COPY_EN);
      })
      .finally(() => {
        DASHBOARD_COPY_IN_FLIGHT.delete(normalized);
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [locale, enabled]);

  const supportedLanguages = useMemo(() => DASHBOARD_LANGUAGES, []);

  return {
    locale,
    setLocale: (next) => setLocale(normalizeDashboardLocale(next)),
    copy,
    supportedLanguages,
    loading,
  };
}
