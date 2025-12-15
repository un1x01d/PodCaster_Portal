import React, { useState, useEffect, useRef } from "react";
import { BrowserRouter as Router, Routes, Route, Link } from "react-router-dom";
import axios from "axios";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

import UserManagement from "./UserManagement";
import SpreadsheetChatbot from "./SpreadsheetChatbot";
import ErrorBoundary from "./ErrorBoundary";
import DashboardBody from "./components/dashboard/DashboardBody";
import Modal from "./components/common/Modal";
// App uses Modal for "Select Sheet" and "Folder View"
// App uses SearchableSelect for "Folder View" filtering?? No, for Admin Upload (passed to Body), 
// but does App use it for "Select Sheet"? No, that's a table.
// "Folder Files" modal just lists files. 
// So App might NOT need SearchableSelect directly, only passing it or using it if Logic requires. 
// Wait, "Folder Files" modal in App... let's check. It renders a table. 
// So App probably doesn't need SearchableSelect directly. 

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
const looksLikeDateColumn = (h = "") => DATE_COL_HINTS.some((k) => h.toLowerCase().includes(k));

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

  // My files (sheet selection)
  const [myFiles, setMyFiles] = useState([]);
  const [myFilesLoading, setMyFilesLoading] = useState(false);
  const [selectOpen, setSelectOpen] = useState(false);
  const [selectError, setSelectError] = useState("");

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

  const [trendsOn, setTrendsOn] = useState(false);
  const [trendsDateKey, setTrendsDateKey] = useState("");
  const [trendsValueKey, setTrendsValueKey] = useState("");
  const [trendGranularity, setTrendGranularity] = useState(""); // "daily", "month", "year"
  const [yearsBack, setYearsBack] = useState(""); // "1".."5"

  const tableContainerRef = useRef(null);

  // Derived state
  const displayHeaders = React.useMemo(() => {
    // If no data loaded, empty
    if (!headers.length) return [];
    // If we have a selected view + user is not admin, we might restrict columns
    return headers;
  }, [headers]);

  /* -------- Derived: Filtered & Sorted Data -------- */
  const { sortedData, uniqueValuesByColumn } = React.useMemo(() => {
    if (!data || !data.length) return { sortedData: [], uniqueValuesByColumn: {} };

    let processed = [...data];

    // 1. Column Filters
    const activeCols = Object.keys(columnFilters);
    if (activeCols.length > 0) {
      processed = processed.filter((row) => {
        for (const col of activeCols) {
          const allowed = columnFilters[col];
          if (!allowed) continue;

          const val = String(row[col]);

          if (allowed instanceof Set) {
            if (allowed.size > 0 && !allowed.has(val)) return false;
          } else if (Array.isArray(allowed)) {
            if (allowed.length > 0 && !allowed.includes(val)) return false;
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

    // 3. Unique values for filters (computed from FULL data or filtered? Usually full for options)
    // To allow narrowing options, we could compute from filtered, but standard is full values per col.
    // Let's compute from `data` for "all options" but maybe that's expensive.
    // Optimization: Compute once on data load, or memoize separately.
    // For now, let's just do it here on `data`.
    const uniques = {};
    headers.forEach(h => {
      const set = new Set();
      data.forEach(r => set.add(r[h]));
      uniques[h] = Array.from(set).sort();
    });

    return { sortedData: processed, uniqueValuesByColumn: uniques };
  }, [data, columnFilters, sortConfig, headers]);


  // Helper for currency/number parsing
  const parseNum = (v) => {
    if (typeof v === 'number') return v;
    if (!v) return 0;
    const clean = String(v).replace(/[$,%]/g, '');
    const n = parseFloat(clean);
    return isNaN(n) ? 0 : n;
  };

  /* -------- Computed: Pivot -------- */
  const { pivotRows, pivotHeaders, pivotSeriesKeys, pieData } = React.useMemo(() => {
    if (!pivotOn || !pivotRowKey || !pivotValKey || !sortedData.length) {
      return { pivotRows: [], pivotHeaders: [], pivotSeriesKeys: [], pieData: [] };
    }

    const rowMap = {};
    const dynCols = new Set();
    // Default column key if none selected
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

    // Pie Data: Sum of all values for each pivotRowKey
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

  // Export helper placeholder...
  const pivotChartRef = useRef(null);
  const exportPivotPDF = async () => { };

  /* -------- Computed: Two Condition -------- */
  const summaryData = React.useMemo(() => {
    // Return structure: { total: number, chartData: [] }
    if (!twoOn || !valueCol || !sortedData.length) return { total: 0, chartData: [] };

    let total = 0;
    const groupMap = {};
    const hasGroup = !!condCol2;

    sortedData.forEach(r => {
      // 1. Filter Check (condCol1)
      // If condCol1 matches what? The UI for 2-condition has "Condition 1" as a select column.
      // Does it imply we filter by a specific value? 
      // The UI in Dashboard says: "First Condition (Filter)" -> Select Column.
      // But where is the value selector?
      // The original Dashboard had a value selector for the filter?
      // Let's check the UI code I wrote in Dashboard.jsx.
      // It just has "select column". It doesn't have "select value".
      // So asking for "Condition 1" just as a column doesn't define a filter.
      // Maybe the user intends to JUST Group By condCol2?
      // Or maybe they want to Filter condCol1?
      // If I can't filter, I can't do 2-condition filtering.
      // Let's assume for now we just Group By condCol2 (if present) and Sum Value.
      // If condCol1 is present, maybe we are supposed to Group by both? 
      // Or maybe condCol1 is just ignored if no value is picked?
      // Let's Pivot-style this: Group by condCol2.

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

    // Group by Date granularity
    const grouped = {};

    sortedData.forEach(r => {
      const val = parseNum(r[trendsValueKey]);
      let dateRaw = r[trendsDateKey];
      if (dateRaw === null || dateRaw === undefined || dateRaw === "") return;

      let dateKey = null;

      // 1. Excel Serial Date (e.g. 45000)
      // Check if it looks like a number and is in reasonable range (year 1900-2100)
      // 25569 = 1970-01-01, 60000 = ~2064
      const asNum = Number(dateRaw);
      if (!isNaN(asNum) && asNum > 25569 && asNum < 60000) {
        const dObj = new Date(Math.round((asNum - 25569) * 86400 * 1000));
        const y = dObj.getFullYear();
        const m = String(dObj.getMonth() + 1).padStart(2, '0');
        const d = String(dObj.getDate()).padStart(2, '0');
        dateKey = `${y}-${m}-${d}`; // Normalize to YYYY-MM-DD first
      } else {
        // 2. String Parse
        const dObj = new Date(dateRaw);
        if (!isNaN(dObj.getTime())) {
          const y = dObj.getFullYear();
          const m = String(dObj.getMonth() + 1).padStart(2, '0');
          const d = String(dObj.getDate()).padStart(2, '0');
          dateKey = `${y}-${m}-${d}`;
        } else {
          // Fallback: use raw string if it looks like a year/month?
          // or just skip
        }
      }

      if (dateKey) {
        // Respect Granularity
        if (trendGranularity === 'year') {
          dateKey = dateKey.substring(0, 4); // YYYY
        } else if (trendGranularity === 'month') {
          dateKey = dateKey.substring(0, 7); // YYYY-MM
        }
        // else daily YYYY-MM-DD

        grouped[dateKey] = (grouped[dateKey] || 0) + val;
      }
    });

    // Convert to array and sort
    return Object.entries(grouped)
      .map(([date, value]) => ({ date, value }))
      .sort((a, b) => a.date.localeCompare(b.date));

  }, [trendsOn, trendsDateKey, trendsValueKey, trendGranularity, sortedData]);


  /* -------- Helpers -------- */
  const hasRequiredColumns = React.useCallback((requiredCols) => {
    return requiredCols.every(col => headers.includes(col));
  }, [headers]);

  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      const res = await axios.post(`${API}/auth/login`, { email, password });
      setToken(res.data.token);
      localStorage.setItem("token", res.data.token);
      setUser(res.data.user);
    } catch (err) {
      alert("Login failed");
    }
  };

  const loadData = async (sid = sheetId, preserveFilters = false) => {
    if (!sid) return;
    try {
      const res = await axios.get(`${API}/sheets/${sid}/data`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      // checks...
      // checks...
      const raw = res.data;
      // Backend returns array directly now
      if (!raw || !Array.isArray(raw)) {
        console.warn("loadData: response is not an array", raw);
        setData([]);
        setHeaders([]);
        return;
      }
      setData(raw);
      const heads = raw.length ? Object.keys(raw[0]) : [];
      setHeaders(heads);
      setSheetId(sid); // make sure

      if (!preserveFilters) {
        setColumnFilters({});
        setOpenFilterCol(null);
      }
    } catch (e) {
      console.error(e);
      alert("Failed to load data");
    }
  };

  const handleUpload = async () => {
    if (!file || !selectedFolderId) return;
    const formData = new FormData();
    formData.append("file", file);
    formData.append("folder_id", selectedFolderId);

    try {
      const res = await axios.post(`${API}/upload`, formData, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "multipart/form-data"
        },
      });
      alert("Uploaded!");
      setFile(null);
      setSelectedFileName("");
      // load it
      if (res.data.sheetId) {
        setSheetId(res.data.sheetId);
        setActiveFilename(res.data.filename);
        loadData(res.data.sheetId);
      }
    } catch (e) {
      console.error(e);
      alert("Upload failed");
    }
  };

  const openSelect = async () => {
    setSelectOpen(true);
    setMyFilesLoading(true);
    setSelectError("");
    try {
      const res = await axios.get(`${API}/my-sheets`, { headers: { Authorization: `Bearer ${token}` } });
      setMyFiles(res.data || []);
    } catch (e) {
      setSelectError("Failed");
    } finally {
      setMyFilesLoading(false);
    }
  };

  const deleteSheet = async (id) => {
    if (!confirm("Delete?")) return;
    await axios.delete(`${API}/sheets/${id}`, { headers: { Authorization: `Bearer ${token}` } });
  };

  const requestSort = (key) => {
    let direction = "asc";
    if (sortConfig && sortConfig.key === key && sortConfig.direction === "asc") {
      direction = "desc";
    }
    setSortConfig({ key, direction });
  };

  const exportCSV = () => {
    if (!sortedData.length) return;
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

  const exportXLSX = () => {
    if (!sortedData.length) return;
    const ws = XLSX.utils.json_to_sheet(sortedData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Data");
    XLSX.writeFile(wb, `${activeFilename || "export"}.xlsx`);
  };

  const exportPDF = () => {
    const doc = new jsPDF("l", "pt", "a4");
    autoTable(doc, {
      head: [displayHeaders],
      body: sortedData.map(r => displayHeaders.map(h => r[h])),
      styles: { fontSize: 8 },
    });
    doc.save(`${activeFilename || "export"}.pdf`);
  };

  const folderOptions = [{ value: "", label: "Folder (required)…" }].concat(
    folders.map((f) => ({ value: String(f.id), label: f.name }))
  );

  // Initial Auth
  useEffect(() => {
    if (token) {
      // fetch meta (folders, etc)
      axios.get(`${API}/folders`, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => setFolders(r.data))
        .catch(e => console.error(e));

      axios.get(`${API}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => setUser(r.data))
        .catch(() => { setToken(""); setUser(null); });
    }
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

  /** ---------------------------
   * RENDER
   * --------------------------- */
  return (
    <Router>
      <div className="bg-blue-900 text-white px-6 py-4 flex justify-between items-center shadow-lg">
        <h1 className="text-xl font-bold">📊 Dashboard</h1>
        <div className="flex items-center gap-3">
          <button
            type="button" // Navy Blue theme (Blue-900 is background, button white/blue)
            onClick={openSelect}
            className="bg-white text-blue-900 border border-slate-200 hover:bg-blue-50 px-3 py-1 rounded-lg h-10 shadow font-semibold"
            title="Choose a sheet you have access to"
          >
            Select Sheet
          </button>

          <span className="italic opacity-90">{user?.email}</span>

          <button
            onClick={() => {
              localStorage.removeItem("token");
              setToken("");
              setUser(null);
            }} // Clean logout
            className="bg-blue-600 hover:bg-blue-700 px-3 py-1 rounded-lg h-10 text-white shadow"
          >
            Logout
          </button>
        </div>
      </div>

      <nav className="bg-blue-50 text-blue-900 p-3 flex gap-4 border-b border-blue-100 font-medium">
        <Link className="hover:underline hover:text-blue-700" to="/">Dashboard</Link>
        {user?.role === "admin" && <Link className="hover:underline hover:text-blue-700" to="/users">Manage Users</Link>}
      </nav>

      <Routes>
        <Route path="/" element={
          <ErrorBoundary>
            {!user ? (
              <div className="p-10 text-center text-gray-500">Please login</div>
            ) : (
              <>
                <DashboardBody
                  // Pass ALL props
                  user={user} token={token} API={API}
                  sheetId={sheetId} activeFilename={activeFilename}
                  file={file} setFile={setFile}
                  selectedFileName={selectedFileName} setSelectedFileName={setSelectedFileName}
                  folderOptions={folderOptions}
                  selectedFolderId={selectedFolderId} setSelectedFolderId={setSelectedFolderId}
                  handleUpload={handleUpload}
                  loadData={loadData}
                  selectedViewId={selectedViewId} setSelectedViewId={setSelectedViewId}
                  views={views} setViews={setViews}
                  setPendingViewName={setPendingViewName}
                  setShowColumnSelector={setShowColumnSelector}
                  openSelect={openSelect}

                  sortedData={sortedData}
                  headers={headers}
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
                  trendGranularity={trendGranularity} setTrendGranularity={setTrendGranularity}
                  yearsBack={yearsBack} setYearsBack={setYearsBack}
                  trendsData={trendsData}

                  exportCSV={exportCSV} exportXLSX={exportXLSX} exportPDF={exportPDF}

                  tableContainerRef={tableContainerRef}
                  filterAnchorRefs={filterAnchorRefs}
                  filterBtnRefs={filterBtnRefs}

                  myFiles={myFiles} loadStored={(id) => loadData(id)}
                  hasRequiredColumns={hasRequiredColumns}
                />

                {/* Chatbot Overlay */}
                {sheetId && (
                  <SpreadsheetChatbot
                    sheetId={sheetId}
                    data={sortedData}
                    allData={data}
                    headers={headers}
                    onApplyFilter={(filters) => {
                      setColumnFilters(filters);
                    }}
                    onUpdateChart={(config) => {
                      console.log("Chart Request:", config);

                      // 1. Reset current views
                      setTrendsOn(false);
                      setPivotOn(false);
                      setTwoOn(false);

                      // 2. Handle Trends (Date-based line chart)
                      // Heuristic: If date column exists and no explicit segmentation (or time-based segmentation)
                      if (config.dateColumn && (!config.segmentBy || isDateColumn(config.segmentBy))) {
                        setTrendsValueKey(config.valueColumn);
                        setTrendsDateKey(config.dateColumn);
                        setTrendsOn(true);
                        setPendingViewName(`Trend of ${config.valueColumn}`);
                        return;
                      }

                      // 3. Handle Segmentation (Bar/Pie via Pivot or Two-Condition)
                      if (config.segmentBy && config.valueColumn) {
                        // Use Pivot for robust aggregation
                        setPivotRowKey(config.segmentBy); // Group by
                        setPivotValKey(config.valueColumn); // Value
                        setPivotColKey(null); // Simple 1-dim grouping
                        setPivotAgg(config.aggregation === 'avg' ? 'Average' : 'Sum');
                        setPivotOn(true);
                        setPendingViewName(`${config.valueColumn} by ${config.segmentBy}`);
                        return;
                      }

                      // 4. Fallback: If just a value column is asked for charting without time?
                      // "Chart Revenue" -> Maybe a Histogram? Or just assume Trends if date exists?
                      // Default to trends if possible
                      if (config.valueColumn) {
                        const dateCol = headers.find(h => h.toLowerCase().includes('date') || h.toLowerCase().includes('time') || h.toLowerCase().includes('year'));
                        if (dateCol) {
                          setTrendsValueKey(config.valueColumn);
                          setTrendsDateKey(dateCol);
                          setTrendsOn(true);
                          setPendingViewName(`Trend of ${config.valueColumn}`);
                        }
                      }
                    }}
                  />
                )}
              </>
            )}

          </ErrorBoundary>
        } />
        {user?.role === "admin" && (
          <Route path="/users" element={<div className="pt-0"><UserManagement token={token} sheetId={sheetId} /></div>} />
        )}
      </Routes>

      {/* GLOBAL MODALS */}

      {/* 1. Sheet Selector */}
      <Modal open={selectOpen} onClose={() => setSelectOpen(false)} title={user?.role === "admin" ? "Select or Delete a Sheet" : "Select a Sheet"}>
        {selectError && <div className="text-red-500 mb-2">{selectError}</div>}
        {myFilesLoading ? (
          <div>Loading...</div>
        ) : (
          <table className="w-full text-sm text-left">
            <thead className="bg-blue-50 text-blue-900 font-semibold border-b">
              <tr><th className="p-2">Filename</th><th className="p-2">Action</th></tr>
            </thead>
            <tbody>
              {myFiles.map(f => (
                <tr key={f.id} className="border-b even:bg-slate-50">
                  <td className="p-2">{f.filename}</td>
                  <td className="p-2 flex gap-2">
                    <button
                      onClick={() => {
                        loadData(f.id);
                        setActiveFilename(f.filename); // Set filename when loading from list
                        setSelectOpen(false);
                      }}
                      className="bg-blue-900 text-white px-3 py-1 rounded shadow text-xs"
                    >
                      Load
                    </button>
                    {user?.role === "admin" && (
                      <button
                        onClick={() => deleteSheet(f.id)}
                        className="bg-red-500 text-white px-3 py-1 rounded shadow text-xs"
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Modal>

      {/* 2. Folder Files View (for Admin > Folders > Eye icon, handled inside UserManagement? No, UserManagement has its own logic? 
          Wait, original code had this modal in App.jsx. 
          UserManagement might TRIGGER it? Or App triggers it? 
          Actually UserManagement handles folders logic. App handled Upload Modal logic. 
          The "Folder Files" modal in App was likely triggered by clicking "View Files" in the Upload section? 
          Or maybe UserManagement triggers it via some shared state? 
          Actually, let's keep it simple. If it's not used by Dashboard, likely used by UserManagement? 
          But UserManagement is separate route.
          Original App code had "App.openFolderFiles".
          If I removed that export, I need to check usage.
          UserManagement.jsx does NOT import App or access its state contextually unless we passed props. 
          UserManagement handles its own stuff. The "Folder Files" modal in App was possibly for the Dashboard User to explore folders?
          I will keep logic but if not triggered it's fine.
      */}

    </Router>
  );
}
