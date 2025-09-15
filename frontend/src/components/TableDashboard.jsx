import { useState, useMemo } from "react";

export default function TableDashboard({ data, config }) {
  const columns = config.columns || Object.keys(data[0] || {});
  const [filters, setFilters] = useState({});

  const filteredData = useMemo(() => {
    return data.filter((row) =>
      Object.entries(filters).every(([col, value]) =>
        value ? String(row[col]) === String(value) : true
      )
    );
  }, [data, filters]);

  const filterOptions = useMemo(() => {
    const opts = {};
    columns.forEach((col) => {
      opts[col] = [...new Set(data.map((row) => row[col]))];
    });
    return opts;
  }, [data, columns]);

  return (
    // ✅ Stretch table to always fill the widget size
    <div style={{ height: "100%", width: "100%", overflow: "auto" }}>
      <table style={{ width: "100%", height: "100%" }}>
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col}>
                {col}
                {config.filters && (
                  <select
                    value={filters[col] || ""}
                    onChange={(e) =>
                      setFilters((prev) => ({
                        ...prev,
                        [col]: e.target.value || null
                      }))
                    }
                  >
                    <option value="">All</option>
                    {filterOptions[col].map((val) => (
                      <option key={val}>{val}</option>
                    ))}
                  </select>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filteredData.map((row, i) => (
            <tr key={i}>
              {columns.map((col) => (
                <td key={col}>{row[col]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

