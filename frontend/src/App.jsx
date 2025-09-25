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

/* -------------------------------------------------------
 * SearchableSelect (no deps, popover w/ search input)
 * -----------------------------------------------------*/
function SearchableSelect({
  options = [],           // [{ value, label }]
  value = "",
  onChange = () => {},
  placeholder = "Select…",
  className = "",
  disabled = false,
  buttonClassName = "border p-2 rounded min-w-[10rem] bg-white",
  panelWidth = 260,       // px
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

  // folders
  const [folders, setFolders] = useState([]);
  const [selectedFolderId, setSelectedFolderId] = useState("");
  const newFolderNameRef = useRef(null);
  const [groups, setGroups] = useState([]);
  const [newFolderGroupId, setNewFolderGroupId] = useState("");

  // Two-condition summary
  const [condCol1, setCondCol1] = useState("");
  const [condCol2, setCondCol2] = useState("");
  const [valueCol, setValueCol] = useState("");

  // Inline user management (admin)
  const [showUsers, setShowUsers] = useState(false);

  // ===== PIVOT (dynamic headers) =====
  const [pivotOn, setPivotOn] = useState(false);
  const [pivotRowKey, setPivotRowKey] = useState("");
  const [pivotColKey, setPivotColKey] = useState("");   // dynamic headers
  const [pivotValKey, setPivotValKey] = useState("");
  const [pivotAgg, setPivotAgg] = useState("sum");      // "sum" | "count"

  // Totals column (per-sheet persisted)
  const [totalsCol, setTotalsCol] = useState("");

  // charts: 2-decimal formatting
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

  // --- Init: fetch active sheet then data ---
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

  // fetch folders + groups (for admin)
  const fetchMeta = async () => {
    if (user?.role !== "admin") return;
    try {
      const [fRes, gRes] = await Promise.all([
        axios.get(`${API}/folders`, { headers: { Authorization: `Bearer ${token}` } }),
        axios.get(`${API}/groups`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      setFolders(fRes.data || []);
      setGroups(gRes.data || []);
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
    const formData = new FormData();
    formData.append("file", file);
    if (selectedFolderId) formData.append("folderId", String(selectedFolderId));
    try {
      const uploadRes = await axios.post(`${API}/upload`, formData, {
        headers: {
          "Content-Type": "multipart/form-data",
          Authorization: `Bearer ${token}`,
        },
      });

      // Clear filters on new upload
      setCondCol1("");
      setCondCol2("");
      setValueCol("");
      setSortConfig(null);

      // reset pivot selections
      setPivotOn(false);
      setPivotRowKey("");
      setPivotColKey("");
      setPivotValKey("");
      setPivotAgg("sum");

      // refresh active + data
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

  // create folder (admin)
  const createFolder = async () => {
    const name = newFolderNameRef.current?.value?.trim() || "";
    if (!name) return;
    try {
      await axios.post(`${API}/folders`, {
        name,
        groupId: newFolderGroupId ? Number(newFolderGroupId) : null,
      }, { headers: { Authorization: `Bearer ${token}` }});
      if (newFolderNameRef.current) newFolderNameRef.current.value = "";
      setNewFolderGroupId("");
      await fetchMeta();
      alert("✅ Folder created");
    } catch (e) {
      console.error("create folder failed", e);
      alert("❌ Could not create folder (name or group already used?)");
    }
  };

  // delete folder (admin)
  const deleteFolder = async (id) => {
    if (!window.confirm("Delete this folder? (Saved copies stay on disk; sheets will detach)")) return;
    try {
      await axios.delete(`${API}/folders/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (String(selectedFolderId) === String(id)) setSelectedFolderId("");
      await fetchMeta();
    } catch (e) {
      console.error("delete folder failed", e);
      alert("❌ Could not delete folder");
    }
  };

  // delete group (admin)
  const deleteGroup = async (id) => {
    if (!window.confirm("Delete this group and its memberships/permissions?")) return;
    try {
      await axios.delete(`${API}/groups/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (String(newFolderGroupId) === String(id)) setNewFolderGroupId("");
      await fetchMeta();
    } catch (e) {
      console.error("delete group failed", e);
      alert("❌ Could not delete group");
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

  // --- Two-condition Summary ---
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

  // ===== PIVOT COMPUTE (dynamic headers) =====
  const { pivotHeaders, pivotRows } = React.useMemo(() => {
    if (!pivotOn || !pivotRowKey || !pivotColKey) return { pivotHeaders: [], pivotRows: [] };

    // dynamic header keys
    const dynSet = new Set();
    (sortedData || []).forEach(r => {
      const k = r[pivotColKey];
      if (k !== undefined && k !== null && k !== "") dynSet.add(String(k));
    });
    const dynHeaders = Array.from(dynSet).sort();

    // group by row key
    const groups = new Map();
    (sortedData || []).forEach(r => {
      const rowK = String(r[pivotRowKey] ?? "N/A");
      const colK = String(r[pivotColKey] ?? "N/A");
      let v = 1; // for count
      if (pivotAgg === "sum") {
        const num = parseFloat(String(r[pivotValKey] ?? "").replace(/[\$,]/g, ""));
        v = Number.isFinite(num) ? num : 0;
      }
      if (!groups.has(rowK)) groups.set(rowK, {});
      const rowObj = groups.get(rowK);
      rowObj[colK] = (rowObj[colK] || 0) + v;
    });

    // emit with totals
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
  }, [pivotOn, pivotRowKey, pivotColKey, pivotValKey, pivotAgg, sortedData]);

  // series keys for Pivot Chart
  const pivotSeriesKeys = React.useMemo(() => {
    if (!pivotHeaders?.length || !pivotRowKey) return [];
    return pivotHeaders.filter(h => h !== pivotRowKey && h !== "_Total");
  }, [pivotHeaders, pivotRowKey]);

  const seriesColors = [
    "#4f46e5","#22c55e","#f59e0b","#ef4444","#06b6d4",
    "#a855f7","#10b981","#eab308","#3b82f6","#f97316",
    "#14b8a6","#84cc16"
  ];

  // --- Totals Sum (for selected totalsCol) ---
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

  // --- Exports (SheetJS) ---
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

  // --- resets ---
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

  // helpers to build options
  const headerOptions = headers.map(h => ({ value: h, label: h }));
  const folderOptions = [{ value: "", label: "Folder (optional)…" }].concat(
    folders.map(f => ({
      value: String(f.id),
      label: `${f.name}${f.group_name ? ` — ${f.group_name}` : ""}`,
    }))
  );
  const groupOptions = [{ value: "", label: "(no group)" }].concat(
    groups.map(g => ({ value: String(g.id), label: g.name }))
  );
  const totalsOptions = [{ value: "", label: "Totals column…" }].concat(headerOptions);

  // Persist totals column (admin)
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
      <div className="w-screen h-screen flex items-center justify-center bg-gradient-to-br from-blue-100 to-indigo-200">
        <form
          onSubmit={handleLogin}
          className="bg-white shadow-lg rounded-xl p-8 w-96 border"
        >
          <h2 className="text-2xl font-bold mb-6 text-center text-gray-700">
            🔐 Podcaster Portal
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
            className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg font-semibold"
          >
            Login
          </button>
        </form>
      </div>
    );
  }

  // --- Dashboard ---
  const Dashboard = () => (
    <div className="w-screen h-screen flex flex-col bg-gray-50">
      {/* Top Bar */}
      <div className="bg-blue-600 text-white px-6 py-4 flex justify-between items-center shadow">
        <h1 className="text-xl font-bold">📊 Dashboard</h1>
        <div className="flex items-center gap-3">
          {user.role === "admin" && (
            <button
              onClick={() => setShowUsers((s) => !s)}
              className="bg-amber-500 hover:bg-amber-600 px-3 py-1 rounded-lg"
              title="Toggle inline User Management panel"
            >
              {showUsers ? "Hide User Mgmt" : "Show User Mgmt"}
            </button>
          )}
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
              setShowUsers(false);
              setPivotOn(false);
              setPivotRowKey(""); setPivotColKey(""); setPivotValKey(""); setPivotAgg("sum");
            }}
            className="bg-red-500 hover:bg-red-600 px-3 py-1 rounded-lg"
          >
            Logout
          </button>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-3 p-4 bg-white shadow-sm border-b items-center">
        {/* Upload (admin) */}
        {user.role === "admin" && (
          <>
            <label className="flex items-center gap-3 border rounded p-2 bg-gray-50">
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

            {/* Folder selection */}
            <SearchableSelect
              options={[{ value: "", label: "Folder (optional)…" }, ...folderOptions.slice(1)]}
              value={selectedFolderId}
              onChange={(e)=>setSelectedFolderId(e.target.value)}
              placeholder="Folder (optional)…"
              className="ml-1"
            />

            <button
              onClick={handleUpload}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg"
            >
              Upload & Load
            </button>

            {/* Quick create folder */}
            <div className="flex items-center gap-2 ml-2">
              <input
                ref={newFolderNameRef}
                className="border rounded p-2 w-44"
                placeholder="New folder name"
                autoComplete="off"
              />
              <SearchableSelect
                options={groupOptions}
                value={newFolderGroupId}
                onChange={(e)=>setNewFolderGroupId(e.target.value)}
                placeholder="(no group)"
                panelWidth={220}
              />
              <button
                onClick={createFolder}
                className="bg-gray-700 hover:bg-gray-800 text-white px-3 py-2 rounded"
                title="Create folder and (optionally) assign to a group"
              >
                Add Folder
              </button>
            </div>
          </>
        )}

        <button
          onClick={() => loadData()}
          className="bg-green-600 hover:bg-green-700 text-white px-3 py-2 rounded-lg"
        >
          Refresh
        </button>

        {/* Export buttons for all users */}
        <div className="flex gap-3 ml-0 md:ml-6">
          <button
            onClick={exportCSV}
            className="bg-gray-600 hover:bg-gray-700 text-white px-3 py-2 rounded-lg"
          >
            Download CSV
          </button>
          <button
            onClick={exportXLSX}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-2 rounded-lg"
          >
            Download XLSX
          </button>
          <button
            onClick={exportPDF}
            className="bg-red-600 hover:bg-red-700 text-white px-3 py-2 rounded-lg"
          >
            Download PDF
          </button>
        </div>

        {/* Totals column (admin, persisted per sheet) */}
        {user.role === "admin" && (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-sm text-gray-600">Totals:</span>
            <SearchableSelect
              options={totalsOptions}
              value={totalsCol}
              onChange={(e)=>saveTotalsColumn(e.target.value)}
              placeholder="Totals column…"
              panelWidth={260}
            />
          </div>
        )}
      </div>

      {/* Two-Condition Controls */}
      <div className="p-4 bg-white border-t border-gray-200">
        <h2 className="text-lg font-bold mb-2">📊 Two-Condition Summary</h2>
        <div className="flex gap-4 mb-4 flex-wrap">
          <div>
            <label className="block text-sm font-semibold">Condition 1:</label>
            <SearchableSelect
              options={[{value:"",label:"-- Select --"}, ...headers.map(h=>({value:h,label:h}))]}
              value={condCol1}
              onChange={(e)=>setCondCol1(e.target.value)}
              placeholder="-- Select --"
              className="w-64"
              panelWidth={280}
            />
          </div>
          <div>
            <label className="block text-sm font-semibold">Condition 2:</label>
            <SearchableSelect
              options={[{value:"",label:"-- Select --"}, ...headers.map(h=>({value:h,label:h}))]}
              value={condCol2}
              onChange={(e)=>setCondCol2(e.target.value)}
              placeholder="-- Select --"
              className="w-64"
              panelWidth={280}
            />
          </div>
          <div>
            <label className="block text-sm font-semibold">Value Column:</label>
            <SearchableSelect
              options={[{value:"",label:"-- Select --"}, ...headers.map(h=>({value:h,label:h}))]}
              value={valueCol}
              onChange={(e)=>setValueCol(e.target.value)}
              placeholder="-- Select --"
              className="w-64"
              panelWidth={280}
            />
          </div>

          {/* Reset Summary */}
          <button
            onClick={resetSummary}
            className="h-10 self-end px-3 py-2 bg-gray-200 hover:bg-gray-300 rounded text-sm"
            title="Clear Condition 1, Condition 2, and Value"
          >
            Reset
          </button>
        </div>

        {condCol1 && condCol2 && valueCol && summaryData?.length > 0 ? (
          <>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={summaryData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey={condCol2} />
                <YAxis tickFormatter={fmt2} />
                <Tooltip formatter={(val) => fmt2(val)} />
                <Legend />
                <Bar dataKey="total" fill="url(#colorUv)" />
                <defs>
                  <linearGradient id="colorUv" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.8} />
                    <stop offset="95%" stopColor="#818cf8" stopOpacity={0.2} />
                  </linearGradient>
                </defs>
              </BarChart>
            </ResponsiveContainer>

            <table className="table-auto border-collapse w-full text-sm mt-6">
              <thead className="bg-indigo-600 text-white">
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
          </>
        ) : (
          <p className="text-gray-500">
            ℹ️ Select two conditions and a value column to see results.
          </p>
        )}
      </div>

      {/* ===== Pivot (Chart + Table) ===== */}
      {pivotOn && (
        <div className="m-4 bg-white rounded-xl shadow-lg border border-gray-200">
          <div className="p-3 font-semibold">📌 Pivot</div>

          {/* Pivot Chart */}
          {pivotRows.length && pivotSeriesKeys.length ? (
            <div className="px-3 pb-3">
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={pivotRows}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey={pivotRowKey}
                    tick={{ fontSize: 12 }}
                    interval={0}
                  />
                  <YAxis tickFormatter={fmt2} />
                  <Tooltip formatter={(val) => fmt2(val)} />
                  <Legend />
                  {pivotSeriesKeys.map((k, idx) => (
                    <Bar
                      key={k}
                      dataKey={k}
                      stackId="pivot"
                      fill={["#4f46e5","#22c55e","#f59e0b","#ef4444","#06b6d4","#a855f7","#10b981","#eab308","#3b82f6","#f97316","#14b8a6","#84cc16"][idx % 12]}
                      name={k}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
              <div className="text-xs text-gray-500 mt-2">
                Stacked by <b>{pivotColKey}</b>. X-axis is <b>{pivotRowKey}</b>. Aggregation: <b>{pivotAgg}</b>{pivotAgg === "sum" && pivotValKey ? <> on <b>{pivotValKey}</b></> : null}.
              </div>
            </div>
          ) : (
            <div className="text-gray-500 px-3 pb-3">
              Select a <b>Row key</b>, <b>Dynamic header</b>, and {pivotAgg === "count" ? "aggregation" : <b>Value</b>} to render a chart.
            </div>
          )}

          {/* Pivot Table */}
          {pivotRows.length ? (
            <div className="overflow-auto">
              <table className="table-auto border-collapse w-full text-sm">
                <thead className="sticky top-0 bg-amber-600 text-white">
                  <tr>
                    {pivotHeaders.map(h => (
                      <th key={h} className="border px-3 py-2 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pivotRows.map((r, i) => (
                    <tr key={i} className="odd:bg-gray-50 even:bg-white">
                      {pivotHeaders.map(h => (
                        <td key={h} className="border px-3 py-2 whitespace-nowrap">
                          {typeof r[h] === "number" ? r[h].toLocaleString() : (r[h] ?? "")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-gray-500 p-4">
              Set <b>Row key</b>, <b>Dynamic header</b>, and {pivotAgg === "count" ? "" : <b>Value</b>} to generate a pivot.
            </div>
          )}
        </div>
      )}

      {/* Full Data Table */}
      <div className="flex-1 overflow-auto m-4 bg-white rounded-xl shadow-lg border border-gray-200">
        {sortedData?.length > 0 ? (
          <>
            <table className="table-auto border-collapse w-full text-sm">
              <thead className="sticky top-0 bg-blue-700 text-white shadow-sm">
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

            {/* Totals summary under table */}
            {totalsCol ? (
              <div className="p-3 text-sm bg-gray-50 border-t">
                Σ Total of <b>{totalsCol}</b>: <span className="font-semibold">${fmt2(totalsSum ?? 0)}</span>
              </div>
            ) : null}
          </>
        ) : (
          <div className="text-gray-500 text-center py-10">
            📂 Upload or refresh to see data
          </div>
        )}
      </div>

      {/* INLINE USER MANAGEMENT (Admin only) */}
      {user.role === "admin" && showUsers && (
        <div className="m-4 bg-white rounded-xl shadow-lg border border-gray-200">
          <UserManagement token={token} sheetId={sheetId} />
        </div>
      )}
    </div>
  );

  return (
    <Router>
      <nav className="bg-gray-800 text-white p-3 flex gap-4">
        <Link to="/">Dashboard</Link>
        {user?.role === "admin" && <Link to="/users">Manage Users (legacy)</Link>}
      </nav>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        {user?.role === "admin" && (
          <Route path="/users" element={<UserManagement token={token} sheetId={sheetId} />} />
        )}
      </Routes>
    </Router>
  );
}

