import React, { useState, useEffect } from "react";
import axios from "axios";
import {
  BarChart,
  Bar,
import ColumnFilterMenu from "./components/ColumnFilterMenu";
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

export default function Dashboard({ token, user }) {
  const [data, setData] = useState([]);
  const [headers, setHeaders] = useState([]);
  const [file, setFile] = useState(null);
  const [filters, setFilters] = useState({});
  const [calcColumn, setCalcColumn] = useState("");

  // --- Views ---
  const [sheetId, setSheetId] = useState(null);
  const [views, setViews] = useState([]);
  const [selectedViewId, setSelectedViewId] = useState("");

  // --- Two condition inputs ---
  const [cond1Col, setCond1Col] = useState("");
  const [cond2Col, setCond2Col] = useState("");
  const [valueCol, setValueCol] = useState("");

  const fetchActiveSheet = async () => {
    try {
      const res = await axios.get(`${API}/sheets/active`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const sid = res.data?.sheetId;
      setSheetId(sid);
      if (sid) fetchViews(sid); else setViews([]);
    } catch (e) {
      console.error("fetchActiveSheet failed", e);
    }
  };

  const fetchViews = async (sid) => {
    try {
      const res = await axios.get(`${API}/my-views`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { sheetId: sid }
      });
      setViews(res.data || []);
    } catch (e) {
      console.error("fetchViews failed", e);
    }
  };

  const loadData = async () => {
    if (!sheetId) { setData([]); return; }
    try {
      const res = await axios.get(`${API}/data/${sheetId}`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { viewId: selectedViewId || undefined }
      });
      setData(res.data);
      if (res.data.length > 0) {
        const cols = Object.keys(res.data[0]);
        setHeaders(cols);

        if (!calcColumn) {
          const numericCol = cols.find((c) =>
            res.data.some((row) => {
              if (!row[c]) return false;
              let clean = String(row[c]).replace(/[\$,]/g, "");
              return !isNaN(parseFloat(clean));
            })
          );
          setCalcColumn(numericCol || "");
        }
      } else {
        setHeaders([]);
      }
    } catch (err) {
      console.error("❌ Load data failed:", err.message);
      setData([]);
      setHeaders([]);
    }
  };

  useEffect(() => {
    fetchActiveSheet();
  }, []);

  useEffect(() => {
    loadData();
  }, [sheetId, selectedViewId]);

  const handleUpload = async () => {
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    try {
      await axios.post(`${API}/upload`, formData, {
        headers: {
          "Content-Type": "multipart/form-data",
          Authorization: `Bearer ${token}`,
        },
      });
      setSelectedViewId(""); // reset to default
      fetchActiveSheet();
    } catch {
      alert("❌ Upload failed");
    }
  };

  const handleRefresh = () => {
    setSelectedViewId(""); // reset to default
    fetchActiveSheet();
  };

  // --- Filtering ---
  const filteredData = React.useMemo(() => {
    return data.filter((row) =>
      Object.entries(filters).every(([col, val]) =>
        val ? String(row[col]) === val : true
      )
    );
  }, [data, filters]);

  // --- Totals ---
  const total = React.useMemo(() => {
    if (!calcColumn) return 0;
    return filteredData.reduce((acc, row) => {
      if (!row[calcColumn]) return acc;
      let raw = String(row[calcColumn]).replace(/[\$,]/g, "");
      const num = parseFloat(raw);
      return acc + (isNaN(num) ? 0 : num);
    }, 0);
  }, [filteredData, calcColumn]);

  // --- Two conditions summary ---
  const twoConditionTotal = React.useMemo(() => {
    if (!cond1Col || !cond2Col || !valueCol) return 0;
    return filteredData.reduce((acc, row) => {
      if (filters[cond1Col] && String(row[cond1Col]) !== filters[cond1Col]) return acc;
      if (filters[cond2Col] && String(row[cond2Col]) !== filters[cond2Col]) return acc;

      let raw = String(row[valueCol] || "").replace(/[\$,]/g, "");
      const num = parseFloat(raw);
      return acc + (isNaN(num) ? 0 : num);
    }, 0);
  }, [filteredData, cond1Col, cond2Col, valueCol, filters]);

  // --- Chart Data based on 2 conditions ---
  const chartData = React.useMemo(() => {
    if (!cond1Col || !cond2Col || !valueCol) return [];
    const monthCol = headers.find((h) => h.toLowerCase().includes("month"));
    if (!monthCol) return [];

    const grouped = {};
    filteredData.forEach((row) => {
      if (filters[cond1Col] && String(row[cond1Col]) !== filters[cond1Col]) return;
      if (filters[cond2Col] && String(row[cond2Col]) !== filters[cond2Col]) return;

      const month = row[monthCol];
      let raw = String(row[valueCol] || "").replace(/[\$,]/g, "");
      const num = parseFloat(raw);
      if (!isNaN(num)) grouped[month] = (grouped[month] || 0) + num;
    });

    return Object.entries(grouped).map(([month, total]) => ({ month, total }));
  }, [filteredData, cond1Col, cond2Col, valueCol, headers, filters]);

  return (
    <div className="w-screen h-[calc(100vh-64px)] flex flex-col bg-gray-50">
      {/* Controls */}
      <div className="flex gap-3 p-4 bg-white shadow-sm border-b items-center">
        {user.role === "admin" && (
          <>
            <input type="file" onChange={(e) => setFile(e.target.files[0])} className="border p-2 rounded" />
            <button
              onClick={handleUpload}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg"
            >
              Upload & Load
            </button>
          </>
        )}
        <button
          onClick={handleRefresh}
          className="bg-green-600 hover:bg-green-700 text-white px-3 py-2 rounded-lg"
        >
          Refresh
        </button>

        {user.role !== "admin" && views.length > 0 && (
          <div className="ml-6 flex items-center gap-2">
            <label className="font-semibold">View:</label>
            <select
              value={selectedViewId}
              onChange={(e) => setSelectedViewId(e.target.value)}
              className="border p-2 rounded text-sm"
            >
              <option value="">Default</option>
              {views.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
          </div>
        )}

        {headers.length > 0 && (
          <div className="ml-6 flex items-center gap-2">
            <label className="font-semibold">Totals Column:</label>
            <select
              value={calcColumn}
              onChange={(e) => setCalcColumn(e.target.value)}
              className="border p-2 rounded text-sm"
            >
              {headers.map((h) => (
                <option key={h}>{h}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Totals */}
      {calcColumn && (
        <div className="p-4 bg-indigo-100 border-b font-bold">
          {calcColumn}: <span className="text-indigo-800">${total.toLocaleString()}</span>
        </div>
      )}

      {/* Two Conditions Summary */}
      <div className="p-4 bg-white border-b shadow-sm flex gap-4 items-center">
        <label>Condition 1:</label>
        <select value={cond1Col} onChange={(e) => setCond1Col(e.target.value)} className="border p-2 rounded">
          <option value="">Select column</option>
          {headers.map((h) => <option key={h}>{h}</option>)}
        </select>

        <label>Condition 2:</label>
        <select value={cond2Col} onChange={(e) => setCond2Col(e.target.value)} className="border p-2 rounded">
          <option value="">Select column</option>
          {headers.map((h) => <option key={h}>{h}</option>)}
        </select>

        <label>Value:</label>
        <select value={valueCol} onChange={(e) => setValueCol(e.target.value)} className="border p-2 rounded">
          <option value="">Select column</option>
          {headers.map((h) => <option key={h}>{h}</option>)}
        </select>

        <div className="ml-4 font-bold">
          Result: <span className="text-indigo-700">${twoConditionTotal.toLocaleString()}</span>
        </div>
      </div>

      {/* Chart */}
      <div className="h-64 p-4 bg-white border-b">
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="total" fill="url(#grad)" />
              <defs>
                <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.8} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.8} />
                </linearGradient>
              </defs>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="text-gray-500 text-center">📊 No chart data available</div>
        )}
      </div>

      {/* Table with dropdown filters */}
      <div className="flex-1 overflow-auto m-4 bg-white rounded-xl shadow-lg border">
        {filteredData.length > 0 ? (
          <table className="table-auto border-collapse w-full text-sm">
            <thead className="sticky top-0 bg-blue-700 text-white">
              <tr>
                {headers.map((h) => (
                  <th key={h} className="border px-4 py-2">
                    <select
                      value={filters[h] || ""}
                      onChange={(e) =>
                        setFilters({ ...filters, [h]: e.target.value })
                      }
                      className="text-black text-xs border rounded"
                    >
                      <option value="">All</option>
                      {[...new Set(data.map((row) => row[h]))].map((val, i) => (
                        <option key={i} value={val}>
                          {val}
                        </option>
                      ))}
                    </select>
                    <div>{h}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredData.slice(0, 50).map((row, i) => (
                <tr key={i} className="odd:bg-gray-50 even:bg-white hover:bg-blue-50">
                  {headers.map((h) => (
                    <td key={h} className="border px-4 py-2 whitespace-nowrap">
                      {row[h] || ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="text-gray-500 text-center py-10">📂 No data</div>
        )}
      </div>
    </div>
  );
}

