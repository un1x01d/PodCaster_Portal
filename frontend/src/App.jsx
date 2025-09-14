import React, { useState, useEffect } from "react";
import axios from "axios";

export default function App() {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem("token") || "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [data, setData] = useState([]);
  const [headers, setHeaders] = useState([]);
  const [sortConfig, setSortConfig] = useState(null);
  const [file, setFile] = useState(null);

  const [calcColumn, setCalcColumn] = useState("");
  const [error, setError] = useState("");

  const [filters, setFilters] = useState({});

  // summary table state
  const [groupCol, setGroupCol] = useState("");
  const [valCol1, setValCol1] = useState("");
  const [valCol2, setValCol2] = useState("");

  // --- Authentication ---
  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      const res = await axios.post("http://localhost:4000/login", {
        email,
        password,
      });
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

  // --- Data Load ---
  const loadData = async () => {
    try {
      const res = await axios.get("http://localhost:4000/data", {
        headers: { Authorization: `Bearer ${token}` },
      });
      setData(res.data);
      setError("");
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

        if (!groupCol) setGroupCol(cols[0]);
        if (!valCol1) setValCol1(cols[1]);
        if (!valCol2 && cols.length > 2) setValCol2(cols[2]);
      }
    } catch (err) {
      console.error("❌ Load data failed:", err.message);
    }
  };

  useEffect(() => {
    if (token && user) {
      loadData();
    }
  }, [token, user]);

  // --- File Upload ---
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
      setError("");
      loadData();
    } catch (err) {
      console.error("Upload error:", err.response?.data || err.message);
      if (err.response?.data?.error) {
        setError(err.response.data.error);
      } else {
        setError("❌ Upload failed. Please try again.");
      }
    }
  };

  // --- Sorting ---
  const sortedData = React.useMemo(() => {
    let rows = [...data];
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

  // --- Filters ---
  const filteredData = React.useMemo(() => {
    return sortedData.filter((row) =>
      Object.entries(filters).every(
        ([col, val]) => !val || row[col] === val
      )
    );
  }, [sortedData, filters]);

  // --- Totals ---
  const total = React.useMemo(() => {
    if (!calcColumn) return 0;
    return filteredData.reduce((acc, row) => {
      if (!row[calcColumn]) return acc;
      let raw = String(row[calcColumn]).trim();
      let clean = raw.replace(/[\$,]/g, "");
      const num = parseFloat(clean);
      return acc + (isNaN(num) ? 0 : num);
    }, 0);
  }, [filteredData, calcColumn]);

  // --- Summary Data ---
  const summaryData = React.useMemo(() => {
    if (!groupCol || !valCol1 || !valCol2) return [];

    const groups = {};
    filteredData.forEach((row) => {
      const g = row[groupCol];
      if (!g) return;

      const v1 = parseFloat(String(row[valCol1]).replace(/[\$,]/g, "")) || 0;
      const v2 = parseFloat(String(row[valCol2]).replace(/[\$,]/g, "")) || 0;

      if (!groups[g]) groups[g] = { [valCol1]: 0, [valCol2]: 0 };
      groups[g][valCol1] += v1;
      groups[g][valCol2] += v2;
    });

    return Object.entries(groups);
  }, [filteredData, groupCol, valCol1, valCol2]);

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
  return (
    <div className="w-screen min-h-screen flex flex-col bg-gray-50">
      {/* Top Bar */}
      <div className="bg-blue-600 text-white px-6 py-4 flex justify-between items-center shadow">
        <h1 className="text-xl font-bold">📊 Podcaster Dashboard</h1>
        <div className="flex items-center gap-4">
          <span className="italic">{user.email}</span>
          <button
            onClick={() => {
              localStorage.removeItem("token");
              setToken("");
              setUser(null);
              setData([]);
            }}
            className="bg-red-500 hover:bg-red-600 px-3 py-1 rounded-lg"
          >
            Logout
          </button>
        </div>
      </div>

      {/* Controls */}
      <div className="flex gap-3 p-4 bg-white shadow-sm border-b items-center flex-wrap">
        {user.role === "admin" && (
          <>
            <input
              type="file"
              onChange={(e) => setFile(e.target.files[0])}
              className="border p-2 rounded"
            />
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
          <>
            <div className="ml-6 flex items-center gap-2">
              <label className="font-semibold">Totals Column:</label>
              <select
                value={calcColumn}
                onChange={(e) => setCalcColumn(e.target.value)}
                className="border p-2 rounded text-sm"
              >
                {headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </div>

            {/* Reset Filters */}
            <button
              onClick={() => setFilters({})}
              className="bg-gray-500 hover:bg-gray-600 text-white px-3 py-2 rounded-lg ml-4"
            >
              Reset Filters
            </button>
          </>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="m-4 p-4 border border-red-400 bg-red-100 text-red-800 rounded-lg whitespace-pre-wrap">
          <strong>Upload Error:</strong>
          <br />
          {error}
        </div>
      )}

      {/* Totals */}
      {calcColumn && !error && (
        <div className="p-4 bg-indigo-100 border-b border-gray-200 font-bold">
          {calcColumn}:{" "}
          <span className="text-indigo-800">${total.toLocaleString()}</span>
        </div>
      )}

      {/* Summary Table */}
      {headers.length > 0 && (
        <div className="m-4 bg-white rounded-xl shadow-lg border border-gray-200 p-4">
          <h2 className="text-lg font-bold mb-2">Summary by Group</h2>
          <div className="flex gap-4 mb-4">
            <div>
              <label className="font-semibold mr-2">Group By:</label>
              <select
                value={groupCol}
                onChange={(e) => setGroupCol(e.target.value)}
                className="border p-2 rounded text-sm"
              >
                {headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="font-semibold mr-2">Value 1:</label>
              <select
                value={valCol1}
                onChange={(e) => setValCol1(e.target.value)}
                className="border p-2 rounded text-sm"
              >
                {headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="font-semibold mr-2">Value 2:</label>
              <select
                value={valCol2}
                onChange={(e) => setValCol2(e.target.value)}
                className="border p-2 rounded text-sm"
              >
                {headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <table className="table-auto border-collapse w-full text-sm">
            <thead className="bg-blue-700 text-white">
              <tr>
                <th className="border px-4 py-2 text-left">{groupCol}</th>
                <th className="border px-4 py-2 text-left">{valCol1}</th>
                <th className="border px-4 py-2 text-left">{valCol2}</th>
              </tr>
            </thead>
            <tbody>
              {summaryData.map(([group, totals]) => (
                <tr key={group} className="odd:bg-gray-50 even:bg-white">
                  <td className="border px-4 py-2">{group}</td>
                  <td className="border px-4 py-2">
                    ${totals[valCol1].toLocaleString()}
                  </td>
                  <td className="border px-4 py-2">
                    ${totals[valCol2].toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Main Table */}
      <div className="m-4 bg-white rounded-xl shadow-lg border border-gray-200">
        {data.length > 0 && !error ? (
          <table className="table-auto border-collapse w-full text-sm">
            <thead className="sticky top-0 bg-blue-700 text-white shadow-sm">
              <tr>
                {headers.map((h) => (
                  <th
                    key={h}
                    className="border border-gray-200 px-4 py-2 text-left whitespace-nowrap"
                  >
                    <div className="flex flex-col">
                      <span
                        className="cursor-pointer"
                        onClick={() => requestSort(h)}
                      >
                        {h}
                        {sortConfig?.key === h
                          ? sortConfig.direction === "asc"
                            ? " ▲"
                            : " ▼"
                          : " ⬍"}
                      </span>
                      <select
                        value={filters[h] || ""}
                        onChange={(e) =>
                          setFilters({ ...filters, [h]: e.target.value })
                        }
                        className="mt-1 text-black border rounded text-xs"
                      >
                        <option value="">All</option>
                        {Array.from(
                          new Set(
                            filteredData.map((row) => row[h]).filter(Boolean)
                          )
                        ).map((val) => (
                          <option key={val} value={val}>
                            {val}
                          </option>
                        ))}
                      </select>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredData.map((row, i) => (
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
        ) : !error ? (
          <div className="text-gray-500 text-center py-10">
            📂 Upload or refresh to see data
          </div>
        ) : null}
      </div>
    </div>
  );
}

