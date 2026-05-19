import { useMemo, useCallback } from "react";
import { looksLikeDateColumn } from "../utils/dateColumns";
import { parseTemporalValue } from "./appHelpers";

export function useAppDataTransforms({
  API,
  token,
  axios,
  sheetId,
  activeTab,
  headers,
  data,
  columnFilters,
  sortConfig,
  setColumnFilters,
  setUniqueValuesByColumn,
  setTrendsOn,
  setPivotOn,
  setTwoOn,
  setTrendsValueKey,
  setTrendsDateKey,
  setTrendGranularity,
  setPendingViewName,
  setPivotRowKey,
  setPivotValKey,
  setPivotColKey,
  setPivotAgg,
  primaryDlpMaskedColumns,
  compareYears,
  trendsDateKey,
  trendsValueKey,
  sortedDataInput,
  pivotOn,
  pivotRowKey,
  pivotColKey,
  pivotValKey,
  pivotAgg,
  pieTopN,
  twoOn,
  valueCol,
  condCol2,
  trendsOn,
  trendGranularity,
}) {
  const displayHeaders = useMemo(() => {
    if (!headers.length) return [];
    return headers;
  }, [headers]);

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

  const { sortedData } = useMemo(() => {
    if (!data || !data.length) return { sortedData: [] };

    let processed = [...data];
    const activeCols = Object.keys(columnFilters);
    if (activeCols.length > 0) {
      processed = processed.filter((row) => {
        for (const col of activeCols) {
          const allowed = columnFilters[col];
          if (!allowed) continue;
          const headerMissing = !headers.includes(col) && !headers.some((h) => String(h || "").trim().toLowerCase() === String(col || "").trim().toLowerCase());
          if (headerMissing) continue;

          let rowValue = row[col];
          if (rowValue === undefined) {
            const actualCol = headers.find(h => h && String(h).trim().toLowerCase() === String(col).trim().toLowerCase());
            if (actualCol) rowValue = row[actualCol];
          }

          const stringified = String(rowValue ?? "");
          if (allowed instanceof Set) {
            if (allowed.size > 0 && !allowed.has(stringified)) return false;
          } else if (allowed && typeof allowed === "object" && (allowed.type === "contains" || allowed.type === "filter")) {
            const filterValue = String(allowed.value || "").toLowerCase();
            const op = allowed.operator || "contains";
            if (op === "equals") {
              if (stringified.toLowerCase() !== filterValue) return false;
            } else if (!stringified.toLowerCase().includes(filterValue)) return false;
          } else if (Array.isArray(allowed)) {
            if (allowed.length > 0 && !allowed.includes(stringified)) return false;
          }
        }
        return true;
      });
    }

    if (sortConfig) {
      const { key, direction } = sortConfig;
      processed.sort((a, b) => {
        let valA = a[key];
        let valB = b[key];
        const numA = Number(valA);
        const numB = Number(valB);
        if (!isNaN(numA) && !isNaN(numB) && valA !== "" && valB !== "") {
          return direction === "asc" ? numA - numB : numB - numA;
        }
        valA = String(valA || "").toLowerCase();
        valB = String(valB || "").toLowerCase();
        if (valA < valB) return direction === "asc" ? -1 : 1;
        if (valA > valB) return direction === "asc" ? 1 : -1;
        return 0;
      });
    }

    return { sortedData: processed };
  }, [data, columnFilters, sortConfig, headers]);

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

  const parseNum = (v) => {
    if (typeof v === "number") return Number.isFinite(v) ? v : 0;
    if (v === null || v === undefined || v === "") return 0;
    const raw = String(v).trim();
    if (!raw) return 0;
    const negativeByParens = raw.startsWith("(") && raw.endsWith(")");
    const normalized = raw.replace(/[(),\s$,%]/g, "").replace(/[−–—]/g, "-");
    const n = Number(normalized);
    if (!Number.isFinite(n)) return 0;
    return negativeByParens ? -Math.abs(n) : n;
  };

  const resolveHeaderName = useCallback((col) => {
    const target = String(col || "").trim();
    if (!target) return "";
    const exact = headers.find((h) => String(h || "").trim() === target);
    if (exact) return exact;
    const normalized = target.toLowerCase();
    return headers.find((h) => String(h || "").trim().toLowerCase() === normalized) || target;
  }, [headers]);

  const applyContainsFilter = useCallback((col, val) => {
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
  }, [resolveHeaderName, setColumnFilters]);

  const applyChartConfig = useCallback((config) => {
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
  }, [headers, primaryDlpMaskedColumns, setPendingViewName, setPivotAgg, setPivotColKey, setPivotOn, setPivotRowKey, setPivotValKey, setTrendGranularity, setTrendsDateKey, setTrendsOn, setTrendsValueKey, setTwoOn]);

  const saveInsightView = useCallback((name) => {
    setPendingViewName(name || "Insight View");
  }, [setPendingViewName]);

  return {
    displayHeaders,
    fetchUniqueValues,
    sortedData,
    trendYearOptions,
    parseNum,
    resolveHeaderName,
    applyContainsFilter,
    applyChartConfig,
    saveInsightView,
  };
}
