import React, { useState, useEffect } from "react";
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

  // Two-condition summary
  const [condCol1, setCondCol1] = useState("");
  const [condCol2, setCondCol2] = useState("");
  const [valueCol, setValueCol] = useState("");

  // NEW: show/hide inline user management
  const [showUsers, setShowUsers] = useState(false);

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
          await loadData(res.data.sheetId);
        } else {
          setSheetId(null);
          setActiveFilename("");
          setData([]);
          setHeaders([]);
        }
      } catch (e) {
        console.error("active sheet fetch failed", e);
      }
    };
    if (token && user) init();
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

      // refresh active + data
      const res = await axios.get(`${API}/sheets/active`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.data?.sheetId) {
        setSheetId(res.data.sheetId);
        setActiveFilename(res.data.filename || uploadRes.data?.filename || "");
        await loadData(res.data.sheetId);
      }
    } catch (e) {
      console.error("upload failed", e);
      alert("❌ Upload failed");
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

  // --- Exports ---
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
              setCondCol1(""); setCondCol2(""); setValueCol(""); setSortConfig(null);
              setShowUsers(false);
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
            <button
              onClick={handleUpload}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg"
            >
              Upload & Load
            </button>
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
      </div>

      {/* Two-Condition Controls */}
      <div className="p-4 bg-white border-t border-gray-200">
        <h2 className="text-lg font-bold mb-2">📊 Two-Condition Summary</h2>
        <div className="flex gap-4 mb-4 flex-wrap">
          <div>
            <label className="block text-sm font-semibold">Condition 1:</label>
            <select
              value={condCol1}
              onChange={(e) => setCondCol1(e.target.value)}
              className="border p-2 rounded w-64"
            >
              <option value="">-- Select --</option>
              {headers.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold">Condition 2:</label>
            <select
              value={condCol2}
              onChange={(e) => setCondCol2(e.target.value)}
              className="border p-2 rounded w-64"
            >
              <option value="">-- Select --</option>
              {headers.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold">Value Column:</label>
            <select
              value={valueCol}
              onChange={(e) => setValueCol(e.target.value)}
              className="border p-2 rounded w-64"
            >
              <option value="">-- Select --</option>
              {headers.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </div>
        </div>

        {condCol1 && condCol2 && valueCol && summaryData?.length > 0 ? (
          <>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={summaryData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey={condCol2} />
                <YAxis />
                <Tooltip />
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

      {/* Full Data Table */}
      <div className="flex-1 overflow-auto m-4 bg-white rounded-xl shadow-lg border border-gray-200">
        {sortedData?.length > 0 ? (
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
        {/* you can safely remove this route if you no longer want a separate page */}
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

