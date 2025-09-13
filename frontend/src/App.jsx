import React, { useState, useEffect } from "react";
import axios from "axios";

export default function App() {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem("token") || "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [data, setData] = useState([]);
  const [headers, setHeaders] = useState([]);
  const [filters, setFilters] = useState({});
  const [sortConfig, setSortConfig] = useState(null);
  const [file, setFile] = useState(null);

  const api = axios.create({
    baseURL: "http://localhost:4000",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  // Login
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

  const loadData = async () => {
    try {
      const res = await api.get("/data");
      setData(res.data);
      if (res.data.length > 0) {
        setHeaders(Object.keys(res.data[0]));
      }
    } catch (err) {
      console.error("❌ Load data failed:", err.message);
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    try {
      await api.post("/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      loadData();
    } catch {
      alert("❌ Upload failed");
    }
  };

  // Sorting + Filtering
  const sortedData = React.useMemo(() => {
    let rows = [...data];

    // Apply filters
    Object.entries(filters).forEach(([col, value]) => {
      if (value && value !== "All") {
        rows = rows.filter((row) => row[col] === value);
      }
    });

    // Apply sorting
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
  }, [data, filters, sortConfig]);

  const requestSort = (key) => {
    let direction = "asc";
    if (sortConfig && sortConfig.key === key && sortConfig.direction === "asc") {
      direction = "desc";
    }
    setSortConfig({ key, direction });
  };

  const getUniqueValues = (col) => {
    const values = [...new Set(data.map((row) => row[col]).filter(Boolean))];
    return values.sort();
  };

  const resetFilters = () => {
    setFilters({});
  };

  // Totals
  const totals = React.useMemo(() => {
    const sumField = (field) =>
      sortedData.reduce((acc, row) => {
        if (!row[field]) return acc;
        let val = String(row[field]).replace(/[^0-9.-]+/g, "");
        const num = parseFloat(val);
        return acc + (isNaN(num) ? 0 : num);
      }, 0);

    return {
      forecast: sumField("Forecast Budget Distributed"),
      netnet: sumField("Net-Net"),
    };
  }, [sortedData]);

  // If not logged in → show login
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

  // Logged in → dashboard
  return (
    <div className="w-screen h-screen flex flex-col bg-gray-50">
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
            }}
            className="bg-red-500 hover:bg-red-600 px-3 py-1 rounded-lg"
          >
            Logout
          </button>
        </div>
      </div>

      {/* Controls */}
      <div className="flex gap-3 p-4 bg-white shadow-sm border-b">
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
        <button
          onClick={resetFilters}
          className="bg-gray-500 hover:bg-gray-600 text-white px-3 py-2 rounded-lg"
        >
          Reset Filters
        </button>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-3 gap-4 m-4">
        <div className="bg-white shadow rounded-lg p-4">
          <h3 className="text-gray-500 text-sm">Forecast Total</h3>
          <p className="text-2xl font-bold text-indigo-700">
            ${totals.forecast.toLocaleString()}
          </p>
        </div>
        <div className="bg-white shadow rounded-lg p-4">
          <h3 className="text-gray-500 text-sm">Net-Net Total</h3>
          <p className="text-2xl font-bold text-green-700">
            ${totals.netnet.toLocaleString()}
          </p>
        </div>
        <div className="bg-white shadow rounded-lg p-4">
          <h3 className="text-gray-500 text-sm">Total Deals</h3>
          <p className="text-2xl font-bold">{sortedData.length}</p>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto m-4 bg-white rounded-xl shadow-lg border border-gray-200">
        {data.length > 0 ? (
          <>
            <table className="table-auto border-collapse w-full text-sm">
              <thead className="sticky top-0 bg-blue-700 text-white shadow-sm">
                <tr>
                  {headers.map((h) => (
                    <th
                      key={h}
                      className="border border-gray-200 px-4 py-2 text-left whitespace-nowrap"
                    >
                      <div
                        onClick={() => requestSort(h)}
                        className="cursor-pointer select-none font-semibold"
                      >
                        {h}
                        {sortConfig?.key === h
                          ? sortConfig.direction === "asc"
                            ? " ▲"
                            : " ▼"
                          : " ⬍"}
                      </div>
                      <select
                        className="mt-1 w-full border border-gray-300 rounded text-xs p-1 bg-gray-100 text-gray-800"
                        value={filters[h] || "All"}
                        onChange={(e) =>
                          setFilters((prev) => ({
                            ...prev,
                            [h]: e.target.value,
                          }))
                        }
                      >
                        <option>All</option>
                        {getUniqueValues(h).map((val) => (
                          <option key={val} value={val}>
                            {val}
                          </option>
                        ))}
                      </select>
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

            {/* Totals row */}
            <div className="p-4 border-t border-gray-200 bg-indigo-100 flex gap-8 font-bold">
              <div>
                Forecast Total:{" "}
                <span className="text-indigo-800">
                  ${totals.forecast.toLocaleString()}
                </span>
              </div>
              <div>
                Net-Net Total:{" "}
                <span className="text-green-700">
                  ${totals.netnet.toLocaleString()}
                </span>
              </div>
            </div>
          </>
        ) : (
          <div className="text-gray-500 text-center py-10">
            📂 Upload or refresh to see data
          </div>
        )}
      </div>
    </div>
  );
}

