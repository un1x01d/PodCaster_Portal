import React, { useState, useEffect } from "react";
import axios from "axios";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

export default function Dashboard({ token, user }) {
  const [data, setData] = useState([]);
  const [headers, setHeaders] = useState([]);
  const [file, setFile] = useState(null);
  const [filters, setFilters] = useState({});
  const [calcColumn, setCalcColumn] = useState("");
  const [lockedViews, setLockedViews] = useState([]);
  const [views, setViews] = useState([]);
  const [newViewName, setNewViewName] = useState("");
  const [activeSheet, setActiveSheet] = useState(null);

  // --- Two condition inputs ---
  const [cond1Col, setCond1Col] = useState("");
  const [cond2Col, setCond2Col] = useState("");
  const [valueCol, setValueCol] = useState("");

  const loadData = async () => {
    if (!activeSheet?.sheetId) return;
    try {
      const res = await axios.get("http://localhost:4000/data", {
        headers: { Authorization: `Bearer ${token}` },
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
      }
    } catch (err) {
      console.error("❌ Load data failed:", err.message);
    }
  };

  useEffect(() => {
    fetchActiveSheet();
    fetchAllViews();
    loadLockedViews();
  }, []);

  useEffect(() => {
    loadData();
    fetchAllViews();
    loadLockedViews();
  }, [activeSheet]);

  const fetchActiveSheet = async () => {
    const res = await axios.get("http://localhost:4000/sheets/active", {
      headers: { Authorization: `Bearer ${token}` },
    });
    setActiveSheet(res.data);
  };

  const fetchAllViews = async () => {
    if (!activeSheet?.sheetId) return;
    const res = await axios.get(`http://localhost:4000/views/${activeSheet.sheetId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    setViews(res.data);
  };

  const loadLockedViews = async () => {
    if (!activeSheet?.sheetId) return;
    try {
      const res = await axios.get(`http://localhost:4000/views/locked/${activeSheet.sheetId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setLockedViews(res.data);
    } catch (err) {
      console.error("❌ Load locked views failed:", err.message);
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    try {
      await axios.post("http://localhost:4000/upload", formData, {
        headers: {
          "Content-Type": "multipart/form-data",
          Authorization: `Bearer ${token}`,
        },
      });
      fetchActiveSheet();
    } catch {
      alert("❌ Upload failed");
    }
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
          onClick={loadData}
          className="bg-green-600 hover:bg-green-700 text-white px-3 py-2 rounded-lg"
        >
          Refresh
        </button>

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

      {/* View Management */}
      <div className="p-4 bg-white border-b">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <h3 className="font-bold text-lg mb-2">Locked Views</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {lockedViews.map((view) => (
                <div key={view.id} className="bg-gray-100 p-4 rounded-lg shadow">
                  <h4 className="font-semibold">{view.name}</h4>
                  <p className="text-sm text-gray-600">Sheet ID: {view.sheet_id}</p>
                  <p className="text-sm text-gray-600">Created by: {view.created_by}</p>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h3 className="font-bold text-lg mb-2">Manage Views</h3>
            <div className="flex gap-2 mb-3">
              <input
                className="border rounded p-2 flex-1"
                placeholder="New view name"
                value={newViewName}
                onChange={(e) => setNewViewName(e.target.value)}
              />
              <button
                className="bg-blue-600 hover:bg-blue-700 text-white rounded px-3"
                onClick={async () => {
                  if (!newViewName.trim() || !activeSheet) return;
                  await axios.post(
                    "http://localhost:4000/views",
                    {
                      name: newViewName.trim(),
                      sheetId: activeSheet.sheetId,
                      config: {},
                      locked: false,
                    },
                    { headers: { Authorization: `Bearer ${token}` } }
                  );
                  setNewViewName("");
                  fetchAllViews();
                }}
              >
                Create
              </button>
            </div>
            <div className="max-h-64 overflow-auto border rounded">
              {views.map((v) => (
                <div key={v.id} className="px-3 py-2 border-b">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium">{v.name}</div>
                      <div className="text-xs text-gray-500">id: {v.id}</div>
                    </div>
                    <button
                      className={`${
                        v.locked ? "bg-red-500" : "bg-green-500"
                      } text-white px-2 py-1 rounded`}
                      onClick={async () => {
                        await axios.patch(
                          `http://localhost:4000/views/${v.id}`,
                          { locked: !v.locked },
                          { headers: { Authorization: `Bearer ${token}` } }
                        );
                        fetchAllViews();
                        loadLockedViews();
                      }}
                    >
                      {v.locked ? "Unlock" : "Lock"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
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
