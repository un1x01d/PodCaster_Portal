import { useState, useEffect, useRef, useMemo } from "react";
import axios from "axios";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";
const BATCH_SIZE = 50;

export function useSheetData({ token, user }) {
  const [sheetId, setSheetId] = useState(() => localStorage.getItem("sheetId") || null);
  const [activeFilename, setActiveFilename] = useState(() => localStorage.getItem("activeFilename") || "");
  const [data, setData] = useState([]);
  const [headers, setHeaders] = useState([]);
  const [sortConfig, setSortConfig] = useState(null);
  const [columnFilters, setColumnFilters] = useState({});
  const [isBatchLoading, setIsBatchLoading] = useState(false);
  const [hasMoreData, setHasMoreData] = useState(true);

  // Multi-tab workbook support
  const [tabs, setTabs] = useState([]);
  const [activeTab, setActiveTab] = useState("");
  const tabListCacheRef = useRef({});
  const tabDataCacheRef = useRef({});

  const getDataCacheKey = (sid, tabName = null) => `${String(sid)}::${tabName ? String(tabName) : "__all__"}`;

  const loadData = async (sid = sheetId, options = {}) => {
    if (!sid || !token) return;
    const { 
      preserveFilters = false, 
      tabName = activeTab, 
      preferCache = true, 
      limit = BATCH_SIZE, 
      offset = 0, 
      append = false,
      selectedViewId = null
    } = options;
    
    if (append) setIsBatchLoading(true);

    try {
      const params = new URLSearchParams();
      if (tabName) params.append("tab", tabName);
      if (selectedViewId) params.append("viewId", selectedViewId);

      if (sortConfig) {
        params.append("sort_by", sortConfig.key);
        params.append("sort_order", sortConfig.direction);
      }
      
      if (columnFilters && Object.keys(columnFilters).length > 0) {
        const serializableFilters = {};
        Object.entries(columnFilters).forEach(([col, val]) => {
          serializableFilters[col] = (val instanceof Set) ? Array.from(val) : val;
        });
        params.append("filters", JSON.stringify(serializableFilters));
      }

      params.append("limit", limit);
      params.append("offset", offset);

      const cacheKey = getDataCacheKey(sid, tabName) + "?" + params.toString();
      if (preferCache && !append && tabDataCacheRef.current[cacheKey]) {
        const cached = tabDataCacheRef.current[cacheKey];
        setData(cached);
        setHeaders(cached.length ? Object.keys(cached[0]) : []);
        return;
      }

      const url = `${API}/sheets/${sid}/data?${params.toString()}`;
      const res = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } });
      const raw = res.data;

      if (!Array.isArray(raw)) return;

      if (append) {
        setData(prev => [...prev, ...raw]);
        if (raw.length < BATCH_SIZE) setHasMoreData(false);
      } else {
        setData(raw);
        const heads = raw.length ? Object.keys(raw[0]) : (preserveFilters ? headers : []);
        setHeaders(heads);
        setHasMoreData(raw.length >= BATCH_SIZE);
        tabDataCacheRef.current[cacheKey] = raw;
      }

      setSheetId(sid);
      localStorage.setItem("sheetId", sid);
      if (!preserveFilters && !append) {
        setColumnFilters({});
      }
    } catch (e) {
      console.error("loadData failed:", e);
    } finally {
      setIsBatchLoading(false);
    }
  };

  const fetchTabs = async (sid, options = {}) => {
    if (!sid || !token) {
      setTabs([]);
      setActiveTab("");
      return [];
    }
    const { preferredTab = null, preserveActive = false } = options;
    const cached = tabListCacheRef.current[String(sid)];
    if (Array.isArray(cached)) {
      setTabs(cached);
      const nextTab = (preferredTab && cached.includes(preferredTab))
        ? preferredTab
        : (preserveActive && activeTab && cached.includes(activeTab) ? activeTab : cached[0] || "");
      setActiveTab(nextTab);
      return cached;
    }
    try {
      const res = await axios.get(`${API}/sheets/${sid}/tabs`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const tabList = res.data?.tabs || [];
      tabListCacheRef.current[String(sid)] = tabList;
      setTabs(tabList);
      const nextTab = (preferredTab && tabList.includes(preferredTab))
        ? preferredTab
        : (preserveActive && activeTab && tabList.includes(activeTab) ? activeTab : tabList[0] || "");
      setActiveTab(nextTab);
      return tabList;
    } catch (e) {
      console.error("fetchTabs failed:", e);
      setTabs([]);
      setActiveTab("");
      return [];
    }
  };

  const sortedData = useMemo(() => {
    if (sortConfig) return data; // Backend handles sorting if sortConfig is present
    return data; // Simplified for now, backend-only sorting preferred
  }, [data, sortConfig]);

  return {
    sheetId,
    setSheetId,
    activeFilename,
    setActiveFilename,
    data,
    setData,
    headers,
    setHeaders,
    sortConfig,
    setSortConfig,
    columnFilters,
    setColumnFilters,
    isBatchLoading,
    hasMoreData,
    setIsBatchLoading,
    setHasMoreData,
    loadData,
    tabs,
    setTabs,
    activeTab,
    setActiveTab,
    fetchTabs,
    sortedData,
    tabListCacheRef,
    tabDataCacheRef
  };
}
