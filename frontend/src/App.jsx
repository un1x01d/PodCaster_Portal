// App.jsx
import React, { useState, useEffect, useRef } from "react";
import { BrowserRouter as Router, Routes, Route, Link } from "react-router-dom";
import axios from "axios";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import UserManagement from "./UserManagement";
import Dashboard from "./Dashboard";
import Modal from "./components/Modal";
import { fmtDateOnly } from "./utils";
import "./index.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

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

  // My Files modal
  const [selectOpen, setSelectOpen] = useState(false);
  const [myFiles, setMyFiles] = useState([]);
  const [myFilesLoading, setMyFilesLoading] = useState(false);
  const [selectError, setSelectError] = useState(""); // <-- added

  // Admin Folder Files modal
  const [folderFilesOpen, setFolderFilesOpen] = useState(false);
  const [folderFilesLoading, setFolderFilesLoading] = useState(false);
  const [folderFiles, setFolderFiles] = useState([]);
  const [folderFilesMeta, setFolderFilesMeta] = useState({ id: null, name: "" });

  // Two-condition summary
  const [condCol1, setCondCol1] = useState("");
  const [condCol2, setCondCol2] = useState("");
  const [valueCol, setValueCol] = useState("");
  const [twoOn, setTwoOn] = useState(false);

  // Pivot
  const [pivotOn, setPivotOn] = useState(false);
  const [pivotRowKey, setPivotRowKey] = useState("");
  const [pivotColKey, setPivotColKey] = useState("");
  const [pivotValKey, setPivotValKey] = useState("");
  const [pivotAgg, setPivotAgg] = useState("sum");

  const pivotChartRef = useRef(null);

  // Pie chart controls
  const [pieMode, setPieMode] = useState("rows");
  const [pieTopN, setPieTopN] = useState("10");

  // Totals (kept in state for PDF, UI removed)
  const [totalsCol, setTotalsCol] = useState("");

  // Trends
  const [trendsOn, setTrendsOn] = useState(false);
  const [trendsDateKey, setTrendsDateKey] = useState("");
  const [trendsValueKey, setTrendsValueKey] = useState("");
  const [trendGranularity, setTrendGranularity] = useState("");
  const [yearsBack, setYearsBack] = useState("");

  const [guessedNumericKey, setGuessedNumericKey] = useState("");

  /* -------- Auth -------- */
  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      const res = await axios.post(`${API}/login`, { email, password });
      localStorage.setItem("token", res.data.token);
      setToken(res.data.token);
      decodeToken(res.data.token);
    } catch {
      alert("❌ Invalid login");
    }
  };

  const decodeToken = (t) => {
    try {
      const payload = JSON.parse(atob(t.split(".")[1]));
      setUser(payload);
    } catch {
      setUser(null);
    }
  };

  useEffect(() => {
    if (token) decodeToken(token);
  }, [token]);

  /* -------- Init & Meta -------- */
  useEffect(() => {
    const init = async () => {
      try {
        const res = await axios.get(`${API}/sheets/active`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.data?.sheetId) {
          setSheetId(res.data.sheetId);
          setActiveFilename(res.data.filename || "");
          setTotalsCol(res.data.totals_column || "");
          await loadData(res.data.sheetId);
        } else {
          setSheetId(null);
          setActiveFilename("");
          setTotalsCol("");
          setData([]);
          setHeaders([]);
        }
      } catch (e) {
        console.error("active sheet fetch failed", e);
      }
    };
    if (token && user) init();
  }, [token, user]);

  const fetchMeta = async () => {
    if (user?.role !== "admin") return;
    try {
      const fRes = await axios.get(`${API}/folders`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setFolders(fRes.data || []);
    } catch (e) {
      console.error("meta fetch failed", e);
    }
  };
  useEffect(() => {
    if (token && user) fetchMeta();
  }, [token, user]);

  /* -------- Data Load -------- */
  const loadData = async (sid = sheetId) => {
    if (!sid) return;
    try {
      const res = await axios.get(`${API}/data/${sid}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const rows = res.data || [];
      const hdrs = rows.length ? Object.keys(rows[0]) : [];
      setData(rows);
      setHeaders(hdrs);
      setColumnFilters({});
      setOpenFilterCol(null);

      if (rows.length) {
        const first = rows[0];
        const guessVal = Object.keys(first).find((k) => typeof first?.[k] === "number") || "";
        setGuessedNumericKey(guessVal || "");
      }
    } catch (err) {
      console.error("❌ Load data failed:", err.message);
    }
  };

  /* -------- Upload (admin) -------- */
  const handleUpload = async () => {
    if (!file) return;
    if (!selectedFolderId) {
      alert("Please select a folder before uploading.");
      return;
    }
    const formData = new FormData();
    formData.append("file", file);
    formData.append("folderId", String(selectedFolderId));
    try {
      const uploadRes = await axios.post(`${API}/upload`, formData, {
        headers: {
          "Content-Type": "multipart/form-data",
          Authorization: `Bearer ${token}`,
        },
      });

      setCondCol1("");
      setCondCol2("");
      setValueCol("");
      setSortConfig(null);
      setPivotOn(false);
      setTwoOn(false);
      setPivotRowKey("");
      setPivotColKey("");
      setPivotValKey("");
      setPivotAgg("sum");
      setColumnFilters({});
      setOpenFilterCol(null);

      const res = await axios.get(`${API}/sheets/active`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.data?.sheetId) {
        setSheetId(res.data.sheetId);
        setActiveFilename(res.data.filename || uploadRes.data?.filename || "");
        setTotalsCol(res.data.totals_column || "");
        await loadData(res.data.sheetId);
      }
      alert("✅ Upload complete");
    } catch (e) {
      console.error("upload failed", e);
      alert("❌ Upload failed");
    }
  };

  /* -------- My Files modal -------- */
  const openSelect = async () => {
    setSelectOpen(true);
    setMyFilesLoading(true);
    setSelectError("");
    try {
      const r = await axios.get(`${API}/my-files`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setMyFiles(Array.isArray(r.data) ? r.data : []);
    } catch (e) {
      console.error("my-files failed", e);
      const msg = e?.response?.status
        ? `Failed to load files (HTTP ${e.response.status}).`
        : "Failed to load files. Check your API URL, CORS, and token.";
      setSelectError(msg);
      setMyFiles([]);
    } finally {
      setMyFilesLoading(false);
    }
  };
  const refreshMyFiles = async () => {
    try {
      const r = await axios.get(`${API}/my-files`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setMyFiles(r.data || []);
    } catch (e) {
      console.error("refresh my-files failed", e);
    }
  };
  const loadStored = async (id) => {
    try {
      await axios.post(
        `${API}/load-sheet`,
        { sheetId: id },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const res = await axios.get(`${API}/sheets/active`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.data?.sheetId) {
        setSheetId(res.data.sheetId);
        setActiveFilename(res.data.filename || "");
        setTotalsCol(res.data.totals_column || "");
        await loadData(res.data.sheetId);
      }
      setSelectOpen(false);
    } catch (e) {
      console.error("load-sheet failed:", e);
      alert("❌ Could not load the selected sheet");
    }
  };

  /* -------- Folder Files modal (admin) -------- */
  const openFolderFiles = async (fid, fname) => {
    setFolderFilesMeta({ id: fid, name: fname });
    setFolderFilesOpen(true);
    setFolderFilesLoading(true);
    try {
      const r = await axios.get(`${API}/folders/${fid}/files`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setFolderFiles(r.data || []);
    } catch (e) {
      console.error("folder files failed", e);
      setFolderFiles([]);
    } finally {
      setFolderFilesLoading(false);
    }
  };

  const deleteSheet = async (sid) => {
    if (!window.confirm("Delete this file permanently?")) return;
    try {
      await axios.delete(`${API}/sheets/${sid}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (folderFilesOpen) await openFolderFiles(folderFilesMeta.id, folderFilesMeta.name);
      if (selectOpen) await refreshMyFiles();
      if (String(sheetId) === String(sid)) {
        const res = await axios.get(`${API}/sheets/active`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.data) {
          setSheetId(null);
          setActiveFilename("");
          setTotalsCol("");
          setData([]);
          setHeaders([]);
          setColumnFilters({});
          setOpenFilterCol(null);
        } else {
          setSheetId(res.data.sheetId);
          setActiveFilename(res.data.filename || "");
          setTotalsCol(res.data.totals_column || "");
          await loadData(res.data.sheetId);
        }
      }
    } catch (e) {
      console.error("delete sheet failed", e);
      alert("❌ Could not delete file");
    }
  };

  /* -------- Filtering -------- */
  const uniqueValuesByColumn = React.useMemo(() => {
    const map = {};
    for (const h of headers) {
      const set = new Set();
      for (const r of data) {
        const v = r[h];
        set.add(v == null || v === "" ? "" : String(v));
      }
      map[h] = Array.from(set.values()).sort((a, b) => String(a).localeCompare(String(b)));
    }
    return map;
  }, [headers, data]);

  const filteredData = React.useMemo(() => {
    const activeCols = Object.keys(columnFilters).filter(
      (c) => columnFilters[c] && columnFilters[c] instanceof Set && columnFilters[c].size > 0
    );
    if (!activeCols.length) return data;

    return (data || []).filter((row) => {
      for (const col of activeCols) {
        const set = columnFilters[col];
        if (!set || set.size === 0) return false;
        const val = row[col];
        const sval = val == null || val === "" ? "" : String(val);
        if (!set.has(sval)) return false;
      }
      return true;
    });
  }, [data, columnFilters]);

  /* -------- Sorting -------- */
  const sortedData = React.useMemo(() => {
    let rows = [...(filteredData || [])];
    if (sortConfig) {
      const { key, direction } = sortConfig;
      rows.sort((a, b) => {
        const aVal = a[key] ?? "";
        const bVal = b[key] ?? "";
        if (aVal < bVal) return direction === "asc" ? -1 : 1;
        if (aVal > bVal) return direction === "asc" ? 1 : -1;
        return 0;
      });
    }
    return rows;
  }, [filteredData, sortConfig]);

  const requestSort = (key) => {
    let direction = "asc";
    if (sortConfig && sortConfig.key === key && sortConfig.direction === "asc") {
      direction = "desc";
    }
    setSortConfig({ key, direction });
  };

  /* -------- Two-Condition Summary -------- */
  const summaryData = React.useMemo(() => {
    if (!condCol1 || !condCol2 || !valueCol) return [];
    const map = {};
    (sortedData || []).forEach((row) => {
      const c1 = row[condCol1] || "N/A";
      const c2 = row[condCol2] || "N/A";
      const raw = String(row[valueCol] ?? "").replace(/[\$,]/g, "");
      const num = parseFloat(raw);
      if (isNaN(num)) return;
      const key = `${c1}__${c2}`;
      if (!map[key]) map[key] = { [condCol1]: c1, [condCol2]: c2, total: 0 };
      map[key].total += num;
    });
    return Object.values(map);
  }, [condCol1, condCol2, valueCol, sortedData]);

  /* -------- Pivot compute -------- */
  const { pivotHeaders, pivotRows } = React.useMemo(() => {
    if (!pivotRowKey || !pivotColKey) return { pivotHeaders: [], pivotRows: [] };

    const dynSet = new Set();
    (sortedData || []).forEach((r) => {
      const k = r[pivotColKey];
      if (k !== undefined && k !== null && k !== "") dynSet.add(String(k));
    });
    const dynHeaders = Array.from(dynSet).sort();

    const groups = new Map();
    (sortedData || []).forEach((r) => {
      const rowK = String(r[pivotRowKey] ?? "N/A");
      const colK = String(r[pivotColKey] ?? "N/A");
      let v = 1;
      if (pivotAgg === "sum") {
        const num = parseFloat(String(r[pivotValKey] ?? "").replace(/[\$,]/g, ""));
        v = Number.isFinite(num) ? num : 0;
      }
      if (!groups.has(rowK)) groups.set(rowK, {});
      const rowObj = groups.get(rowK);
      rowObj[colK] = (rowObj[colK] || 0) + v;
    });

    const outRows = Array.from(groups.entries())
      .map(([rk, cols]) => {
        const o = { [pivotRowKey]: rk };
        let total = 0;
        dynHeaders.forEach((h) => {
          const val = cols[h] || 0;
          o[h] = val;
          total += val;
        });
        o._Total = total;
        return o;
      })
      .sort((a, b) => String(a[pivotRowKey]).localeCompare(String(b[pivotRowKey])));

    const headers2 = [pivotRowKey, ...dynHeaders, "_Total"];
    return { pivotHeaders: headers2, pivotRows: outRows };
  }, [pivotRowKey, pivotColKey, pivotValKey, pivotAgg, sortedData]);

  const pivotSeriesKeys = React.useMemo(() => {
    if (!pivotHeaders?.length || !pivotRowKey) return [];
    return pivotHeaders.filter((h) => h !== pivotRowKey && h !== "_Total");
  }, [pivotHeaders, pivotRowKey]);

  /* -------- Totals Sum (for PDF header only) -------- */
  const totalsSum = React.useMemo(() => {
    if (!totalsCol) return null;
    let sum = 0;
    for (const r of sortedData) {
      const raw = String(r[totalsCol] ?? "").replace(/[\$,]/g, "");
      const num = parseFloat(raw);
      if (Number.isFinite(num)) sum += num;
    }
    return sum;
  }, [sortedData, totalsCol]);

  /* -------- Pie Data (based on Pivot) -------- */
  const pieData = React.useMemo(() => {
    if (!pivotRows.length) return [];
    const topN = Math.max(1, parseInt(pieTopN || "10", 10));
    if (pieMode === "rows") {
      const arr = pivotRows
        .map((r) => ({
          name: String(r[pivotRowKey]),
          value: Number.isFinite(r._Total) ? r._Total : 0,
        }))
        .sort((a, b) => b.value - a.value);
      const head = arr.slice(0, topN);
      const tail = arr.slice(topN);
      const other = tail.reduce((s, x) => s + x.value, 0);
      return other > 0 ? [...head, { name: "Other", value: other }] : head;
    } else {
      const totalsByCol = {};
      pivotSeriesKeys.forEach((k) => (totalsByCol[k] = 0));
      pivotRows.forEach((row) => {
        pivotSeriesKeys.forEach((k) => {
          const v = Number(row[k]) || 0;
          totalsByCol[k] += v;
        });
      });
      const arr = Object.entries(totalsByCol)
        .map(([k, v]) => ({ name: k, value: v }))
        .sort((a, b) => b.value - a.value);
      const head = arr.slice(0, topN);
      const tail = arr.slice(topN);
      const other = tail.reduce((s, x) => s + x.value, 0);
      return other > 0 ? [...head, { name: "Other", value: other }] : head;
    }
  }, [pivotRows, pivotSeriesKeys, pieMode, pieTopN, pivotRowKey]);

  const PIE_COLORS = [
    "#059669", "#10B981", "#34D399", "#6EE7B7", "#A7F3D0",
    "#16A34A", "#22C55E", "#4ADE80", "#86EFAC", "#BBF7D0",
    "#F59E0B", "#FCD34D", "#FDE68A", "#93C5FD", "#60A5FA",
  ];

  /* -------- Trends (multi-line, N years back) -------- */
  const trendsData = React.useMemo(() => {
    if (!trendsOn || !trendsDateKey) return [];

    const measureKey = trendsValueKey ? "sum" : "count";

    // Aggregate daily
    const daily = new Map(); // date -> { date, count, sum }
    for (const r of sortedData) {
      const raw = r[trendsDateKey];
      const d = fmtDateOnly(raw); // YYYY-MM-DD
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
      if (!daily.has(d)) daily.set(d, { date: d, count: 0, sum: 0 });
      const item = daily.get(d);
      if (trendsValueKey) {
        const v = parseFloat(String(r[trendsValueKey] ?? "").replace(/[\$,]/g, ""));
        if (Number.isFinite(v)) item.sum += v;
      } else {
        item.count += 1;
      }
    }

    const rows = Array.from(daily.values()).sort((a, b) => (a.date < b.date ? -1 : 1));
    if (!rows.length) return rows;

    // Month & year totals across data (for lookup)
    const monthTotals = new Map(); // 'YYYY-MM' -> {count,sum}
    const yearTotals  = new Map(); // 'YYYY'    -> {count,sum}
    for (const r of rows) {
      const ym = r.date.slice(0, 7);
      const y  = r.date.slice(0, 4);
      if (!monthTotals.has(ym)) monthTotals.set(ym, { count: 0, sum: 0 });
      if (!yearTotals.has(y))   yearTotals.set(y,  { count: 0, sum: 0 });
      monthTotals.get(ym).count += r.count || 0;
      monthTotals.get(ym).sum   += r.sum   || 0;
      yearTotals.get(y).count   += r.count || 0;
      yearTotals.get(y).sum     += r.sum   || 0;
    }

    const dailyMap = new Map(rows.map((r) => [r.date, r]));

    const maxBack = Math.min(5, Math.max(0, parseInt(yearsBack || "0", 10) || 0));
    for (const r of rows) {
      const y = r.date.slice(0, 4);
      const m = r.date.slice(5, 7);
      const d = r.date.slice(8, 10);
      const ym = `${y}-${m}`;

      if (trendGranularity === "daily") {
        for (let k = 1; k <= maxBack; k++) {
          const prevY = String(Number(y) - k).padStart(4, "0");
          const prevDate = `${prevY}-${m}-${d}`;
          const prev = dailyMap.get(prevDate);
          r[`prev_${k}y`] = prev ? (trendsValueKey ? prev.sum : prev.count) : 0;
        }
      } else if (trendGranularity === "month") {
        r.currentAgg = (monthTotals.get(ym)?.[measureKey]) || 0;
        for (let k = 1; k <= maxBack; k++) {
          const prevYm = `${String(Number(y) - k).padStart(4, "0")}-${m}`;
          r[`prev_${k}y`] = (monthTotals.get(prevYm)?.[measureKey]) || 0;
        }
      } else if (trendGranularity === "year") {
        r.currentAgg = (yearTotals.get(y)?.[measureKey]) || 0;
        for (let k = 1; k <= maxBack; k++) {
          const prevY = String(Number(y) - k).padStart(4, "0");
          r[`prev_${k}y`] = (yearTotals.get(prevY)?.[measureKey]) || 0;
        }
      } else {
        r.currentAgg = undefined;
      }
    }

    return rows;
  }, [sortedData, trendsOn, trendsDateKey, trendsValueKey, trendGranularity, yearsBack]);

  /* -------- Exports -------- */
  const exportCSV = () => {
    try {
      const fileName = "report.csv";
      const ws = XLSX.utils.json_to_sheet(sortedData || []);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Filtered Data");
      if (summaryData?.length > 0) {
        const ws2 = XLSX.utils.json_to_sheet(summaryData);
        XLSX.utils.book_append_sheet(wb, ws2, "Summary");
      }
      XLSX.writeFile(wb, fileName, { bookType: "csv" });
    } catch (err) {
      console.error("CSV Export failed:", err);
    }
  };

  const exportXLSX = () => {
    try {
      const fileName = "report.xlsx";
      const ws = XLSX.utils.json_to_sheet(sortedData || []);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Filtered Data");
      if (summaryData?.length > 0) {
        const ws2 = XLSX.utils.json_to_sheet(summaryData);
        XLSX.utils.book_append_sheet(wb, ws2, "Summary");
      }
      XLSX.writeFile(wb, fileName);
    } catch (err) {
      console.error("XLSX Export failed:", err);
    }
  };

  const exportPDF = () => {
    try {
      const doc = new jsPDF({ orientation: "landscape" });
      autoTable(doc, {
        head: [headers],
        body: sortedData.map((row) => headers.map((h) => row[h])),
      });
      doc.save("report.pdf");
    } catch (err) {
      console.error("PDF Export failed:", err);
    }
  };

  const exportPivotPDF = async () => {
    try {
      if (!pivotRows.length || !pivotHeaders.length) {
        alert("Nothing to export — set Pivot options first.");
        return;
      }

      let chartPngUrl = null;
      let chartW = 0;
      let chartH = 0;
      if (pivotChartRef.current) {
        const svgEl = pivotChartRef.current.querySelector("svg");
        if (svgEl) {
          const xml = new XMLSerializer().serializeToString(svgEl);
          const svgUrl = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(xml)));

          const img = await new Promise((resolve) => {
            const im = new Image();
            im.onload = () => resolve(im);
            im.onerror = () => resolve(null);
            im.src = svgUrl;
          });

          if (img) {
            chartW = img.width || 1200;
            chartH = img.height || 600;
            const canvas = document.createElement("canvas");
            canvas.width = chartW;
            canvas.height = chartH;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0);
            chartPngUrl = canvas.toDataURL("image/png");
          }
        }
      }

      let doc = new jsPDF({ orientation: "l" });
      const margins = { left: 14, right: 14, top: 16, bottom: 12 };

      const fit = { fontSize: 9, columnStyles: {} };

      let cursorY = margins.top;
      if (chartPngUrl) {
        const pageW = doc.internal.pageSize.getWidth() - margins.left - margins.right;
        const aspect = chartW / chartH;
        let drawW = pageW;
        let drawH = drawW / aspect;
        const maxChartH = 90;
        if (drawH > maxChartH) {
          drawH = maxChartH;
          drawW = drawH * aspect;
        }
        const x = margins.left + (pageW - drawW) / 2;
        doc.addImage(chartPngUrl, "PNG", x, cursorY, drawW, drawH);
        cursorY += drawH + 6;
      } else {
        doc.setFontSize(14);
        doc.text("Pivot Report", margins.left, cursorY);
        cursorY += 8;
      }

      autoTable(doc, {
        startY: cursorY,
        margin: { left: margins.left, right: margins.right, top: margins.top, bottom: margins.bottom },
        head: [pivotHeaders],
        body: pivotRows.map((r) => pivotHeaders.map((h) => (r[h] == null ? "" : r[h]))),
        styles: {
          fontSize: fit.fontSize,
          cellPadding: 1.1,
          overflow: "ellipsize",
          lineColor: [209, 250, 229],
          lineWidth: 0.1,
        },
        headStyles: {
          fillColor: [5, 150, 105],
          textColor: 255,
          halign: "left",
          valign: "middle",
          fontStyle: "bold",
        },
        bodyStyles: { halign: "left", valign: "middle" },
        columnStyles: fit.columnStyles,
        didParseCell: (data) => {
          if (data.section === "head") data.cell.styles.overflow = "ellipsize";
        },
        didDrawPage: (data) => {
          const pageStr = `Page ${doc.internal.getNumberOfPages()}`;
          doc.setFontSize(8);
          doc.text(pageStr, data.settings.margin.left, doc.internal.pageSize.getHeight() - 5);
        },
      });

      doc.save("pivot.pdf");
    } catch (err) {
      console.error("Pivot PDF export failed:", err);
      alert("❌ Pivot PDF export failed, check console");
    }
  };

  /* -------- Resets -------- */
  const resetSummary = () => {
    setCondCol1("");
    setCondCol2("");
    setValueCol("");
  };
  const resetPivot = () => {
    setPivotRowKey("");
    setPivotColKey("");
    setPivotValKey("");
    setPivotAgg("sum");
    setPieMode("rows");
    setPieTopN("10");
  };

  const folderOptions = [{ value: "", label: "Folder (required)…" }].concat(
    folders.map((f) => ({ value: String(f.id), label: f.name }))
  );

  /* -------- Login Screen -------- */
  if (!token || !user) {
    return (
      <div className="w-full min-h-0 flex items-center justify-center bg-gradient-to-br from-emerald-50 to-white py-16">
        <form className="bg-white/95 backdrop-blur shadow-xl rounded-2xl p-8 w-96 border border-emerald-100" onSubmit={handleLogin}>
          <h2 className="text-2xl font-bold mb-6 text-center text-gray-900">🔐 Universal Analytics</h2>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border border-emerald-200 p-3 mb-3 rounded-md focus:outline-none focus:ring focus:ring-emerald-100"
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full border border-emerald-200 p-3 mb-6 rounded-md focus:outline-none focus:ring focus:ring-emerald-100"
          />
          <button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-2 rounded-lg font-semibold h-11 shadow">
            Login
          </button>
        </form>
      </div>
    );
  }

  return (
    <Router>
      <div className="bg-gradient-to-r from-gray-900 via-emerald-800 to-emerald-600 text-white px-6 py-4 flex justify-between items-center shadow-lg">
        <h1 className="text-xl font-bold">📊 Dashboard</h1>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={openSelect}
            className="bg-white text-gray-900 border border-emerald-200 hover:bg-emerald-50 px-3 py-1 rounded-lg h-10 shadow"
            title="Choose a sheet you have access to"
          >
            Select Sheet
          </button>
          <span className="italic opacity-90">{user.email}</span>
          <button
            onClick={() => {
              localStorage.removeItem("token");
              setToken("");
              setUser(null);
              setData([]);
              setHeaders([]);
              setActiveFilename("");
              setSelectedFileName("");
              setTotalsCol("");
              setCondCol1("");
              setCondCol2("");
              setValueCol("");
              setSortConfig(null);
              setPivotOn(false);
              setTwoOn(false);
              setPivotRowKey("");
              setPivotColKey("");
              setPivotValKey("");
              setPivotAgg("sum");
              setColumnFilters({});
              setOpenFilterCol(null);
              setPieMode("rows");
              setPieTopN("10");
              setTrendsOn(false);
            }}
            className="bg-rose-600 hover:bg-rose-700 px-3 py-1 rounded-lg h-10 text-white shadow"
          >
            Logout
          </button>
        </div>
      </div>

      <nav className="bg-gradient-to-r from-white to-emerald-50 text-gray-900 p-3 flex gap-4 border-b border-emerald-100">
        <Link className="hover:underline" to="/">Dashboard</Link>
        {user?.role === "admin" && <Link className="hover:underline" to="/users">Manage Users</Link>}
      </nav>

      <Routes>
        <Route path="/" element={<Dashboard
          user={user}
          data={data}
          headers={headers}
          sortConfig={sortConfig}
          columnFilters={columnFilters}
          openFilterCol={openFilterCol}
          setOpenFilterCol={setOpenFilterCol}
          filterAnchorRefs={filterAnchorRefs}
          filterBtnRefs={filterBtnRefs}
          uniqueValuesByColumn={uniqueValuesByColumn}
          setColumnFilters={setColumnFilters}
          requestSort={requestSort}
          sortedData={sortedData}
          activeFilename={activeFilename}
          handleUpload={handleUpload}
          setFile={setFile}
          setSelectedFileName={setSelectedFileName}
          selectedFileName={selectedFileName}
          folderOptions={folderOptions}
          selectedFolderId={selectedFolderId}
          setSelectedFolderId={setSelectedFolderId}
          loadData={loadData}
          exportCSV={exportCSV}
          exportXLSX={exportXLSX}
          exportPDF={exportPDF}
          pivotOn={pivotOn}
          setPivotOn={setPivotOn}
          twoOn={twoOn}
          setTwoOn={setTwoOn}
          trendsOn={trendsOn}
          setTrendsOn={setTrendsOn}
          pivotRowKey={pivotRowKey}
          setPivotRowKey={setPivotRowKey}
          pivotColKey={pivotColKey}
          setPivotColKey={setPivotColKey}
          pivotValKey={pivotValKey}
          setPivotValKey={setPivotValKey}
          pivotAgg={pivotAgg}
          setPivotAgg={setPivotAgg}
          pivotRows={pivotRows}
          pivotHeaders={pivotHeaders}
          exportPivotPDF={exportPivotPDF}
          resetPivot={resetPivot}
          pivotChartRef={pivotChartRef}
          pivotSeriesKeys={pivotSeriesKeys}
          pieMode={pieMode}
          setPieMode={setPieMode}
          pieTopN={pieTopN}
          setPieTopN={setPieTopN}
          pieData={pieData}
          PIE_COLORS={PIE_COLORS}
          condCol1={condCol1}
          setCondCol1={setCondCol1}
          condCol2={condCol2}
          setCondCol2={setCondCol2}
          valueCol={valueCol}
          setValueCol={setValueCol}
          summaryData={summaryData}
          resetSummary={resetSummary}
          trendsDateKey={trendsDateKey}
          setTrendsDateKey={setTrendsDateKey}
          trendsValueKey={trendsValueKey}
          setTrendsValueKey={setTrendsValueKey}
          trendGranularity={trendGranularity}
          setTrendGranularity={setTrendGranularity}
          yearsBack={yearsBack}
          setYearsBack={setYearsBack}
          trendsData={trendsData}
          totalsCol={totalsCol}
          guessedNumericKey={guessedNumericKey}
        />} />
        {user?.role === "admin" && (
          <Route path="/users" element={<div className="pt-0"><UserManagement token={token} sheetId={sheetId} /></div>} />
        )}
      </Routes>

      <Modal open={selectOpen} onClose={() => setSelectOpen(false)} title={user.role === "admin" ? "Select or Delete a Sheet" : "Select a Sheet"}>
        {selectError ? (
          <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 text-rose-800 px-3 py-2 text-sm">
            {selectError}
          </div>
        ) : null}

        {myFilesLoading ? (
          <div>Loading…</div>
        ) : myFiles.length ? (
          <div className="overflow-auto">
            <table className="table-auto border-collapse w-full text-sm">
              <thead className="bg-gradient-to-r from-emerald-50 to-white">
                <tr>
                  <th className="p-2 border border-emerald-200 border-dashed text-left">Filename</th>
                  <th className="p-2 border border-emerald-200 border-dashed text-left">Folder</th>
                  <th className="p-2 border border-emerald-200 border-dashed text-left">Uploaded</th>
                  <th className="p-2 border border-emerald-200 border-dashed"></th>
                  {user.role === "admin" && <th className="p-2 border border-emerald-200 border-dashed"></th>}
                </tr>
              </thead>
              <tbody>
                {myFiles.map((f) => (
                  <tr key={f.id} className="odd:bg-white even:bg-emerald-50/40">
                    <td className="p-2 border border-emerald-200 border-dashed">{f.filename}</td>
                    <td className="p-2 border border-emerald-200 border-dashed">{f.folder_name || "—"}</td>
                    <td className="p-2 border border-emerald-200 border-dashed">{fmtDateOnly(f.uploaded_at)}</td>
                    <td className="p-2 border border-emerald-200 border-dashed">
                      <button onClick={() => loadStored(f.id)} className="bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-600 hover:to-emerald-600 text-white px-3 py-1 rounded shadow">
                        Load
                      </button>
                    </td>
                    {user.role === "admin" && (
                      <td className="p-2 border border-emerald-200 border-dashed">
                        <button
                          onClick={async () => {
                            await deleteSheet(f.id);
                            await refreshMyFiles();
                          }}
                          className="bg-gradient-to-r from-rose-600 to-rose-500 hover:from-rose-600 hover:to-rose-600 text-white px-3 py-1 rounded shadow"
                        >
                          Delete
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-gray-600">
            {selectError
              ? "Could not retrieve your files."
              : "No files found. If you expect files, check your permissions."}
          </div>
        )}
      </Modal>

      <Modal open={folderFilesOpen} onClose={() => setFolderFilesOpen(false)} title={`Files in: ${folderFilesMeta.name || ""}`} widthClass="max-w-4xl">
        {folderFilesLoading ? (
          <div>Loading…</div>
        ) : folderFiles.length ? (
          <table className="table-auto border-collapse w-full text-sm">
            <thead className="bg-gradient-to-r from-emerald-50 to-white">
              <tr>
                <th className="p-2 border border-emerald-200 border-dashed text-left">Filename</th>
                <th className="p-2 border border-emerald-200 border-dashed text-left">Uploaded</th>
                <th className="p-2 border border-emerald-200 border-dashed text-left">Active</th>
                <th className="p-2 border border-emerald-200 border-dashed"></th>
              </tr>
            </thead>
            <tbody>
              {folderFiles.map((f) => (
                <tr key={f.id} className="odd:bg-white even:bg-emerald-50/40">
                  <td className="p-2 border border-emerald-200 border-dashed">{f.filename}</td>
                  <td className="p-2 border border-emerald-200 border-dashed">{fmtDateOnly(f.uploaded_at)}</td>
                  <td className="p-2 border border-emerald-200 border-dashed">{f.active ? "Yes" : "No"}</td>
                  <td className="p-2 border border-emerald-200 border-dashed">
                    <button onClick={() => deleteSheet(f.id)} className="bg-gradient-to-r from-rose-600 to-rose-500 hover:from-rose-600 hover:to-rose-600 text-white px-3 py-1 rounded shadow">
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="text-gray-600">No files in this folder.</div>
        )}
      </Modal>
    </Router>
  );
}