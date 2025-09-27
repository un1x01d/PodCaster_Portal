// App.jsx
import React, { useState, useEffect, useRef } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Link,
} from "react-router-dom";
import axios from "axios";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import UserManagement from "./UserManagement";
import "./index.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

/* SearchableSelect (unchanged) */
function SearchableSelect({
  options = [],
  value = "",
  onChange = () => {},
  placeholder = "Select…",
  className = "",
  disabled = false,
  buttonClassName = "border p-2 rounded min-w-[10rem] bg-white",
  panelWidth = 260,
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const btnRef = useRef(null);
  const panelRef = useRef(null);

  const selected = options.find(o => String(o.value) === String(value));
  const filtered = q
    ? options.filter(o => o.label.toLowerCase().includes(q.toLowerCase()))
    : options;

  useEffect(() => {
    function onDocClick(e) {
      const b = btnRef.current;
      const p = panelRef.current;
      if (!b || !p) return;
      if (b.contains(e.target) || p.contains(e.target)) return;
      setOpen(false);
    }
    function onEsc(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, []);

  useEffect(() => {
    if (!open) setQ("");
  }, [open]);

  return (
    <div className={`relative inline-block ${className}`}>
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen(o => !o)}
        className={`${buttonClassName} flex items-center justify-between gap-2 ${disabled ? "bg-gray-100 cursor-not-allowed text-gray-400" : ""}`}
        title={selected?.label || placeholder}
      >
        <span className="truncate">{selected?.label || placeholder}</span>
        <span className="opacity-70">▾</span>
      </button>

      {open && !disabled && (
        <div
          ref={panelRef}
          className="absolute z-50 mt-1 bg-white border rounded shadow-lg p-2"
          style={{ width: panelWidth }}
        >
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Type to search…"
            className="w-full border rounded px-2 py-1 mb-2"
          />
          <div className="max-h-56 overflow-auto">
            {filtered.length ? (
              filtered.map(o => (
                <div
                  key={String(o.value)}
                  className={`px-2 py-1 rounded cursor-pointer hover:bg-blue-50 ${String(o.value) === String(value) ? "bg-blue-100" : ""}`}
                  title={o.label}
                  onClick={() => {
                    onChange({ target: { value: o.value } });
                    setOpen(false);
                  }}
                >
                  {o.label}
                </div>
              ))
            ) : (
              <div className="text-gray-500 text-sm px-2 py-1">No matches</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Modal({ open, onClose, title, children, widthClass = "max-w-3xl" }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className={`relative bg-white rounded-xl shadow-xl w-[95vw] ${widthClass} max-h-[85vh] overflow-auto`}>
        <div className="p-4 border-b flex items-center justify-between">
          <div className="font-bold">{title}</div>
          <button onClick={onClose} className="text-gray-600 hover:text-black">✕</button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

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

  const [file, setFile] = useState(null);
  const [selectedFileName, setSelectedFileName] = useState("");

  // folders (admin upload only)
  const [folders, setFolders] = useState([]);
  const [selectedFolderId, setSelectedFolderId] = useState("");

  // My Files modal
  const [selectOpen, setSelectOpen] = useState(false);
  const [myFiles, setMyFiles] = useState([]);
  const [myFilesLoading, setMyFilesLoading] = useState(false);

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

  // Totals
  const [totalsCol, setTotalsCol] = useState("");

  const fmt2 = (n) =>
    Number(n ?? 0).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  // --- Auth ---
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

  // --- Init active sheet then data ---
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
      const fRes = await axios.get(`${API}/folders`, { headers: { Authorization: `Bearer ${token}` } });
      setFolders(fRes.data || []);
    } catch (e) {
      console.error("meta fetch failed", e);
    }
  };
  useEffect(() => {
    if (token && user) fetchMeta();
  }, [token, user]);

  // --- Data Load ---
  const loadData = async (sid = sheetId) => {
    if (!sid) return;
    try {
      const res = await axios.get(`${API}/data/${sid}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const rows = res.data || [];
      setData(rows);
      setHeaders(rows.length ? Object.keys(rows[0]) : []);
    } catch (err) {
      console.error("❌ Load data failed:", err.message);
    }
  };

  // --- File Upload (Admin only) ---
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

      setCondCol1(""); setCondCol2(""); setValueCol("");
      setSortConfig(null);
      setPivotOn(false); setTwoOn(false);
      setPivotRowKey(""); setPivotColKey(""); setPivotValKey(""); setPivotAgg("sum");

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

  // --- My Files modal data
  const openSelect = async () => {
    setSelectOpen(true);
    setMyFilesLoading(true);
    try {
      const r = await axios.get(`${API}/my-files`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setMyFiles(r.data || []);
    } catch (e) {
      console.error("my-files failed", e);
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
      await axios.post(`${API}/load-sheet`, { sheetId: id }, {
        headers: { Authorization: `Bearer ${token}` },
      });
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
      console.error("load-sheet failed", e);
      alert("❌ Could not load the selected sheet");
    }
  };

  // Admin: Folder Files modal helpers
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
        } else {
          setSheetId(res.data.sheetId);
          setActiveFilename(res.data.filename || "");
          setTotalsCol(res.data.totals_column || "");
          await loadData(res.data.sheetId);
        }
      }
    } catch (e) {
      console.error("delete sheet failed:", e);
      alert("❌ Could not delete file");
    }
  };

  // --- Sorting ---
  const sortedData = React.useMemo(() => {
    let rows = [...(data || [])];
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
  }, [data, sortConfig]);

  const requestSort = (key) => {
    let direction = "asc";
    if (sortConfig && sortConfig.key === key && sortConfig.direction === "asc") {
      direction = "desc";
    }
    setSortConfig({ key, direction });
  };

  // Two-condition Summary
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

  // Pivot compute (compute when keys exist; do NOT gate on pivotOn)
  const { pivotHeaders, pivotRows } = React.useMemo(() => {
    if (!pivotRowKey || !pivotColKey) return { pivotHeaders: [], pivotRows: [] };

    const dynSet = new Set();
    (sortedData || []).forEach(r => {
      const k = r[pivotColKey];
      if (k !== undefined && k !== null && k !== "") dynSet.add(String(k));
    });
    const dynHeaders = Array.from(dynSet).sort();

    const groups = new Map();
    (sortedData || []).forEach(r => {
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

    const outRows = Array.from(groups.entries()).map(([rk, cols]) => {
      const o = { [pivotRowKey]: rk };
      let total = 0;
      dynHeaders.forEach(h => {
        const val = cols[h] || 0;
        o[h] = val;
        total += val;
      });
      o._Total = total;
      return o;
    }).sort((a,b) => String(a[pivotRowKey]).localeCompare(String(b[pivotRowKey])));

    const headers2 = [pivotRowKey, ...dynHeaders, "_Total"];
    return { pivotHeaders: headers2, pivotRows: outRows };
  }, [pivotRowKey, pivotColKey, pivotValKey, pivotAgg, sortedData]);

  const pivotSeriesKeys = React.useMemo(() => {
    if (!pivotHeaders?.length || !pivotRowKey) return [];
    return pivotHeaders.filter(h => h !== pivotRowKey && h !== "_Total");
  }, [pivotHeaders, pivotRowKey]);

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
      const fileName = "report.pdf";
      const title = fileName.replace(/\.[^/.]+$/, "");
      const doc = new jsPDF();
      doc.setFontSize(14);
      doc.text(title, 14, 16);

      if (summaryData?.length > 0 && condCol1 && condCol2 && valueCol) {
        doc.setFontSize(12);
        doc.text("Summary (Two Conditions)", 14, 28);
        autoTable(doc, {
          startY: 32,
          head: [[condCol1, condCol2, `Total ${valueCol}`]],
          body: summaryData.map((row) => [
            row[condCol1],
            row[condCol2],
            row.total,
          ]),
        });
      }

      if (sortedData?.length > 0) {
        doc.addPage();
        doc.setFontSize(12);
        doc.text("Filtered Data Table", 14, 16);
        autoTable(doc, {
          startY: 20,
          head: [headers],
          body: sortedData.map((row) => headers.map((h) => row[h] || "")),
        });
      }

      doc.save(fileName);
    } catch (err) {
      console.error("PDF Export failed:", err);
      alert("❌ PDF Export failed, check console");
    }
  };

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
  };

  const headerOptions = headers.map(h => ({ value: h, label: h }));
  const folderOptions = [{ value: "", label: "Folder (required)…" }].concat(
    folders.map(f => ({
      value: String(f.id),
      label: f.name,
    }))
  );

  const saveTotalsColumn = async (col) => {
    if (!sheetId) return;
    try {
      await axios.patch(`${API}/sheets/${sheetId}`, { totals_column: col || null }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setTotalsCol(col || "");
    } catch (e) {
      console.error("save totals_column failed", e);
      alert("❌ Could not save totals column");
    }
  };

  // --- Login Page ---
  if (!token || !user) {
    return (
      <div className="w-full min-h-0 flex items-center justify-center bg-gradient-to-br from-blue-100 to-indigo-200 py-16">
        <form
          onSubmit={handleLogin}
          className="bg-white shadow-lg rounded-xl p-8 w-96 border"
        >
          <h2 className="text-2xl font-bold mb-6 text-center text-gray-700">
            🔐 Universal Analytics
          </h2>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border p-3 mb-3 rounded focus:ring focus:ring-blue-200"
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full border p-3 mb-6 rounded focus:ring focus:ring-blue-200"
          />
          <button
            type="submit"
            className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg font-semibold h-11"
          >
            Login
          </button>
        </form>
      </div>
    );
  }

  // --- Dashboard ---
  const Dashboard = () => (
    <div className="w-full bg-gray-50">
      {/* Top Bar */}
      <div className="bg-green-700 text-white px-6 py-4 flex justify-between items-center shadow">
        <h1 className="text-xl font-bold">📊 Dashboard</h1>
        <div className="flex items-center gap-3">
          <button
            onClick={openSelect}
            className="bg-gray-900 hover:bg-black px-3 py-1 rounded-lg h-10"
            title="Choose a sheet you have access to"
          >
            Select Sheet
          </button>
          <span className="italic">{user.email}</span>
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
              setCondCol1(""); setCondCol2(""); setValueCol(""); setSortConfig(null);
              setPivotOn(false);
              setTwoOn(false);
              setPivotRowKey(""); setPivotColKey(""); setPivotValKey(""); setPivotAgg("sum");
            }}
            className="bg-red-500 hover:bg-red-600 px-3 py-1 rounded-lg h-10"
          >
            Logout
          </button>
        </div>
      </div>

      {/* Top header line menu (light green) */}
      <nav className="bg-green-200 text-gray-900 p-3 flex gap-4">
        <Link to="/">Dashboard</Link>
        {user?.role === "admin" && <Link to="/users">Manage Users</Link>}
      </nav>

      {/* Controls */}
      <div className="flex flex-wrap gap-3 p-4 bg-white shadow-sm border-b items-center">
        {/* Upload (admin) */}
        {user.role === "admin" && (
          <>
            <label className="flex items-center gap-3 border rounded p-2 bg-gray-50 h-10">
              <input
                type="file"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  setFile(f || null);
                  setSelectedFileName(f?.name || "");
                }}
                className="border p-1 rounded"
              />
              <span className="text-sm text-gray-700">
                {selectedFileName || activeFilename || "No file selected"}
              </span>
            </label>

            {/* Folder selection (required) */}
            <SearchableSelect
              options={folderOptions}
              value={selectedFolderId}
              onChange={(e)=>setSelectedFolderId(e.target.value)}
              placeholder="Folder (required)…"
              className="ml-1"
              buttonClassName="border p-2 rounded min-w-[14rem] bg-white h-10"
            />

            <button
              onClick={handleUpload}
              disabled={!file || !selectedFolderId}
              className={`${!file || !selectedFolderId
                ? "bg-gray-300 cursor-not-allowed"
                : "bg-blue-600 hover:bg-blue-700"
              } text-white px-4 rounded-lg h-10`}
              title={!file ? "Choose a file" : !selectedFolderId ? "Select a folder" : "Upload & Load"}
            >
              Upload & Load
            </button>
          </>
        )}

        <button
          onClick={() => loadData()}
          className="bg-green-600 hover:bg-green-700 text-white px-3 rounded-lg h-10"
        >
          Refresh
        </button>

        {/* Export buttons + Toggles */}
        <div className="flex gap-3 ml-0 md:ml-6 items-center">
          <button
            onClick={exportCSV}
            className="bg-gray-600 hover:bg-gray-700 text-white px-3 rounded-lg h-10"
          >
            Download CSV
          </button>
          <button
            onClick={exportXLSX}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 rounded-lg h-10"
          >
            Download XLSX
          </button>
          <button
            onClick={exportPDF}
            className="bg-red-600 hover:bg-red-700 text-white px-3 rounded-lg h-10"
          >
            Download PDF
          </button>

          {/* Pivot toggle */}
          <button
            onClick={() => setPivotOn((p) => !p)}
            className="px-3 rounded-lg font-semibold bg-orange-500 text-white h-10"
            title="Toggle Pivot mode"
          >
            {pivotOn ? "Pivot: ON" : "Pivot: OFF"}
          </button>

          {/* Two-Condition toggle */}
          <button
            onClick={() => setTwoOn((t) => !t)}
            className="px-3 rounded-lg font-semibold bg-green-600 text-white h-10"
            title="Toggle Two-Condition summary"
          >
            {twoOn ? "2-Cond: ON" : "2-Cond: OFF"}
          </button>
        </div>

        {/* Totals column (admin, persisted per sheet) */}
        {user.role === "admin" && (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-sm text-gray-600">Totals:</span>
            <SearchableSelect
              options={headers.length ? [{ value: "", label: "Totals column…" }, ...headerOptions] : [{ value:"", label:"Totals column…"}]}
              value={totalsCol}
              onChange={(e)=>saveTotalsColumn(e.target.value)}
              placeholder="Totals column…"
              panelWidth={260}
              buttonClassName="border p-2 rounded min-w-[12rem] bg-white h-10"
            />
          </div>
        )}
      </div>

      {/* Pivot Controls */}
      {pivotOn && (
        <div className="p-4 bg-orange-50 border-y border-orange-200">
          <div className="flex flex-wrap items-end gap-3">
            <SearchableSelect
              options={[{ value: "", label: "Row key…" }, ...headers.map(h => ({ value: h, label: h }))]}
              value={pivotRowKey}
              onChange={(e) => setPivotRowKey(e.target.value)}
              placeholder="Row key…"
              buttonClassName="border p-2 rounded min-w-[14rem] bg-white h-10"
            />

            <SearchableSelect
              options={[{ value: "", label: "Dynamic header…" }, ...headers.map(h => ({ value: h, label: h }))]}
              value={pivotColKey}
              onChange={(e) => setPivotColKey(e.target.value)}
              placeholder="Dynamic header…"
              buttonClassName="border p-2 rounded min-w-[14rem] bg-white h-10"
            />

            <SearchableSelect
              options={[{ value: "", label: pivotAgg === "count" ? "— (count)" : "Value…" }, ...headers.map(h => ({ value: h, label: h }))]}
              value={pivotValKey}
              onChange={(e) => setPivotValKey(e.target.value)}
              placeholder={pivotAgg === "count" ? "— (count)" : "Value…"}
              disabled={pivotAgg === "count"}
              buttonClassName="border p-2 rounded min-w-[14rem] bg-white h-10"
            />

            <SearchableSelect
              options={[
                { value: "sum", label: "sum" },
                { value: "count", label: "count" },
              ]}
              value={pivotAgg}
              onChange={(e) => setPivotAgg(e.target.value)}
              placeholder="Aggregation…"
              panelWidth={180}
              buttonClassName="border p-2 rounded min-w-[10rem] bg-white h-10"
            />

            <div className="flex gap-2 ml-auto">
              <button
                onClick={() => {
                  if (!pivotRows.length) return;
                  try {
                    const wb = XLSX.utils.book_new();
                    const ws = XLSX.utils.json_to_sheet(pivotRows, { header: pivotHeaders });
                    XLSX.utils.book_append_sheet(wb, ws, "Pivot");
                    XLSX.writeFile(wb, "pivot.xlsx");
                  } catch (e) {
                    console.error("Pivot export failed:", e);
                  }
                }}
                className={`px-3 rounded h-10 ${pivotRows.length ? "bg-orange-500 text-white" : "bg-gray-300 cursor-not-allowed text-gray-700"}`}
                title={pivotRows.length ? "Export Pivot" : "Nothing to export yet"}
              >
                Export Pivot
              </button>

              <button
                onClick={resetPivot}
                className="px-3 bg-white border border-orange-300 rounded h-10"
                title="Clear Row key / Dynamic header / Value (keeps Pivot mode on)"
              >
                Reset
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pivot Chart + Table */}
      {pivotOn && (
        <div className="m-4 bg-white rounded-xl shadow-lg border border-gray-200">
          <div className="p-3 font-semibold">📌 Pivot</div>

          {pivotRowKey && pivotColKey && (pivotAgg === "count" || pivotValKey) && pivotRows.length > 0 && pivotSeriesKeys.length > 0 ? (
            <div className="px-3 pb-3">
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={pivotRows}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey={pivotRowKey} />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <defs>
                    <linearGradient id="pivotOrange" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f97316" stopOpacity={0.9} />
                      <stop offset="95%" stopColor="#fdba74" stopOpacity={0.25} />
                    </linearGradient>
                  </defs>
                  {pivotSeriesKeys.map((k) => (
                    <Bar key={k} dataKey={k} stackId="pivot" fill="url(#pivotOrange)" />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="text-xs text-gray-500 px-3 pb-3">
              Select Row / Dynamic / Value to render.
            </div>
          )}

          {pivotRows.length ? (
            <div className="overflow-auto px-3 pb-3">
              <table className="table-auto border-collapse w-full text-sm">
                <thead className="bg-orange-500 text-white">
                  <tr>
                    {pivotHeaders.map((h) => (
                      <th key={h} className="p-2 border text-left whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pivotRows.map((row, i) => (
                    <tr key={i} className="odd:bg-gray-50 even:bg-white">
                      {pivotHeaders.map((h) => (
                        <td key={h} className="p-2 border whitespace-nowrap">
                          {Number.isFinite(row[h]) ? row[h].toLocaleString() : row[h]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      )}

      {/* Two-Condition Controls & Chart — only when ON */}
      {twoOn && (
        <div className="p-4 bg-green-50 border-t border-green-200">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold text-green-800">📊 Two-Condition Summary</h2>
            <button
              onClick={resetSummary}
              className="px-3 bg-white border border-green-300 rounded h-10 text-sm"
              title="Clear Condition 1, Condition 2, and Value"
            >
              Reset
            </button>
          </div>

          <div className="grid gap-3 md:grid-cols-3 sm:grid-cols-2 grid-cols-1 items-end">
            <SearchableSelect
              options={[{value:"",label:"-- Select --"}, ...headers.map(h=>({value:h,label:h}))]}
              value={condCol1}
              onChange={(e)=>setCondCol1(e.target.value)}
              placeholder="Condition 1…"
              buttonClassName="border p-2 rounded min-w-[14rem] bg-white h-10"
              panelWidth={280}
            />
            <SearchableSelect
              options={[{value:"",label:"-- Select --"}, ...headers.map(h=>({value:h,label:h}))]}
              value={condCol2}
              onChange={(e)=>setCondCol2(e.target.value)}
              placeholder="Condition 2…"
              buttonClassName="border p-2 rounded min-w-[14rem] bg-white h-10"
              panelWidth={280}
            />
            <SearchableSelect
              options={[{value:"",label:"-- Select --"}, ...headers.map(h=>({value:h,label:h}))]}
              value={valueCol}
              onChange={(e)=>setValueCol(e.target.value)}
              placeholder="Value column…"
              buttonClassName="border p-2 rounded min-w-[14rem] bg-white h-10"
              panelWidth={280}
            />
          </div>

          {condCol1 && condCol2 && valueCol && summaryData?.length > 0 ? (
            <div className="mt-4">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={summaryData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey={condCol2} />
                  <YAxis tickFormatter={fmt2} />
                  <Tooltip formatter={(val) => fmt2(val)} />
                  <Legend />
                  <defs>
                    <linearGradient id="twoCondGreen" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#16a34a" stopOpacity={0.9} />
                      <stop offset="95%" stopColor="#86efac" stopOpacity={0.25} />
                    </linearGradient>
                  </defs>
                  <Bar dataKey="total" fill="url(#twoCondGreen)" />
                </BarChart>
              </ResponsiveContainer>

              <table className="table-auto border-collapse w-full text-sm mt-6">
                <thead className="bg-green-600 text-white">
                  <tr>
                    <th className="p-2 border">{condCol1}</th>
                    <th className="p-2 border">{condCol2}</th>
                    <th className="p-2 border">Total {valueCol}</th>
                  </tr>
                </thead>
                <tbody>
                  {summaryData.map((row, i) => (
                    <tr key={i} className="odd:bg-gray-50 even:bg-white">
                      <td className="p-2 border">{row[condCol1]}</td>
                      <td className="p-2 border">{row[condCol2]}</td>
                      <td className="p-2 border font-semibold">
                        ${row.total.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-gray-600 mt-3">
              ℹ️ Select two conditions and a value column to see results.
            </p>
          )}
        </div>
      )}

      {/* Data Table */}
      <div className="m-4 bg-white rounded-xl shadow-lg border border-gray-200">
        {sortedData?.length > 0 ? (
          <>
            <div className="p-3 text-sm text-gray-600">
              {activeFilename ? <>Loaded: <b>{activeFilename}</b></> : "No sheet loaded"}
            </div>
            <table className="table-auto border-collapse w-full text-sm">
              <thead className="sticky top-0 bg-green-700 text-white shadow-sm">
                <tr>
                  {headers.map((h) => (
                    <th
                      key={h}
                      className="border border-gray-200 px-4 py-2 text-left whitespace-nowrap cursor-pointer"
                      onClick={() => requestSort(h)}
                    >
                      {h}
                      {sortConfig?.key === h
                        ? sortConfig.direction === "asc"
                          ? " ▲"
                          : " ▼"
                        : " ⬍"}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedData.map((row, i) => (
                  <tr
                    key={i}
                    className="odd:bg-gray-50 even:bg-white hover:bg-blue-50"
                  >
                    {headers.map((h) => (
                      <td
                        key={h}
                        className="border border-gray-200 px-4 py-2 whitespace-nowrap"
                      >
                        {row[h] || ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>

            {totalsCol ? (
              <div className="p-3 text-sm bg-gray-50 border-t">
                Σ Total of <b>{totalsCol}</b>: <span className="font-semibold">
                  {Number.isFinite(totalsSum) ? `$${fmt2(totalsSum)}` : "—"}
                </span>
              </div>
            ) : null}
          </>
        ) : (
          <div className="text-gray-500 text-center py-10">
            📂 Use <b>Select Sheet</b> to pick a file you have access to, or upload (admin).
          </div>
        )}
      </div>

      {/* Select Sheet / Delete Files Modal */}
      <Modal
        open={selectOpen}
        onClose={() => setSelectOpen(false)}
        title={user.role === "admin" ? "Select or Delete a Sheet" : "Select a Sheet"}
      >
        {myFilesLoading ? (
          <div>Loading…</div>
        ) : myFiles.length ? (
          <div className="overflow-auto">
            <table className="table-auto border-collapse w-full text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="p-2 border text-left">Filename</th>
                  <th className="p-2 border text-left">Folder</th>
                  <th className="p-2 border text-left">Uploaded</th>
                  <th className="p-2 border"></th>
                  {user.role === "admin" && <th className="p-2 border"></th>}
                </tr>
              </thead>
              <tbody>
                {myFiles.map(f => (
                  <tr key={f.id} className="odd:bg-white even:bg-gray-50">
                    <td className="p-2 border">{f.filename}</td>
                    <td className="p-2 border">{f.folder_name || "—"}</td>
                    <td className="p-2 border">{new Date(f.uploaded_at).toLocaleString()}</td>
                    <td className="p-2 border">
                      <button
                        onClick={() => loadStored(f.id)}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded"
                      >
                        Load
                      </button>
                    </td>
                    {user.role === "admin" && (
                      <td className="p-2 border">
                        <button
                          onClick={async () => {
                            await deleteSheet(f.id);
                            await refreshMyFiles();
                          }}
                          className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded"
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
          <div className="text-gray-500">No files found.</div>
        )}
      </Modal>

      {/* Admin Folder Files Modal */}
      <Modal
        open={folderFilesOpen}
        onClose={() => setFolderFilesOpen(false)}
        title={`Files in: ${folderFilesMeta.name || ""}`}
        widthClass="max-w-4xl"
      >
        {folderFilesLoading ? (
          <div>Loading…</div>
        ) : folderFiles.length ? (
          <table className="table-auto border-collapse w-full text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="p-2 border text-left">Filename</th>
                <th className="p-2 border text-left">Uploaded</th>
                <th className="p-2 border text-left">Active</th>
                <th className="p-2 border"></th>
              </tr>
            </thead>
            <tbody>
              {folderFiles.map(f => (
                <tr key={f.id} className="odd:bg-white even:bg-gray-50">
                  <td className="p-2 border">{f.filename}</td>
                  <td className="p-2 border">{new Date(f.uploaded_at).toLocaleString()}</td>
                  <td className="p-2 border">{f.active ? "Yes" : "No"}</td>
                  <td className="p-2 border">
                    <button
                      onClick={() => deleteSheet(f.id)}
                      className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="text-gray-500">No files in this folder.</div>
        )}
      </Modal>
    </div>
  );

  return (
    <Router>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        {user?.role === "admin" && (
          <Route path="/users" element={<UserManagement token={token} sheetId={sheetId} />} />
        )}
      </Routes>
    </Router>
  );
}

