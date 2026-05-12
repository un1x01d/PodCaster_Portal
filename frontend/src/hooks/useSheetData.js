import { useState } from "react";

export function useSheetData() {
  const [sheetId, setSheetId] = useState(() => localStorage.getItem("sheetId") || null);
  const [activeFilename, setActiveFilename] = useState(() => localStorage.getItem("activeFilename") || "");
  const [data, setData] = useState([]);
  const [headers, setHeaders] = useState([]);
  const [sortConfig, setSortConfig] = useState(null);
  const [columnFilters, setColumnFilters] = useState({});
  const [isBatchLoading, setIsBatchLoading] = useState(false);
  const [hasMoreData, setHasMoreData] = useState(true);

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
    setHasMoreData
  };
}
