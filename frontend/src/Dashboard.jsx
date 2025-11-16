import React, { useState, useEffect, useRef, useLayoutEffect } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line,
} from "recharts";
import SearchableSelect from "./components/SearchableSelect";
import ExportMenu from "./components/ExportMenu";
import ColumnFilterMenu from "./components/ColumnFilterMenu";
import TrendTooltip from "./components/TrendTooltip";
import { renderMaybeDate } from "./utils";

export default function Dashboard({
  user,
  data,
  headers,
  sortConfig,
  columnFilters,
  openFilterCol,
  setOpenFilterCol,
  filterAnchorRefs,
  filterBtnRefs,
  uniqueValuesByColumn,
  setColumnFilters,
  requestSort,
  sortedData,
  activeFilename,
  handleUpload,
  setFile,
  setSelectedFileName,
  selectedFileName,
  folderOptions,
  selectedFolderId,
  setSelectedFolderId,
  loadData,
  exportCSV,
  exportXLSX,
  exportPDF,
  pivotOn,
  setPivotOn,
  twoOn,
  setTwoOn,
  trendsOn,
  setTrendsOn,
  pivotRowKey,
  setPivotRowKey,
  pivotColKey,
  setPivotColKey,
  pivotValKey,
  setPivotValKey,
  pivotAgg,
  setPivotAgg,
  pivotRows,
  pivotHeaders,
  exportPivotPDF,
  resetPivot,
  pivotChartRef,
  pivotSeriesKeys,
  pieMode,
  setPieMode,
  pieTopN,
  setPieTopN,
  pieData,
  PIE_COLORS,
  condCol1,
  setCondCol1,
  condCol2,
  setCondCol2,
  valueCol,
  setValueCol,
  summaryData,
  resetSummary,
  trendsDateKey,
  setTrendsDateKey,
  trendsValueKey,
  setTrendsValueKey,
  trendGranularity,
  setTrendGranularity,
  yearsBack,
  setYearsBack,
  trendsData,
  totalsCol,
  guessedNumericKey,
}) {
  return (
    <div className="w-full bg-gradient-to-b from-white to-emerald-50/40">
      {/* Global Controls Bar */}
      <div className="flex flex-wrap gap-3 p-4 bg-white/90 backdrop-blur shadow-sm border-b border-emerald-100 items-center relative z-30">
        {/* Upload (admin) */}
        {user.role === "admin" && (
          <>
            <label className="flex items-center gap-3 border border-emerald-200 rounded-lg p-2 bg-white h-10">
              <input
                type="file"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  setFile(f || null);
                  setSelectedFileName(f?.name || "");
                }}
                className="border border-emerald-200 p-1 rounded-md"
              />
              <span className="text-sm text-gray-700">
                {selectedFileName || activeFilename || "No file selected"}
              </span>
            </label>

            {/* Folder selection (required) */}
            <SearchableSelect
              options={folderOptions}
              value={selectedFolderId}
              onChange={(e) => setSelectedFolderId(e.target.value)}
              placeholder="Folder (required)…"
              className="ml-1"
              buttonClassName="border border-emerald-200 p-2 rounded-lg min-w-[14rem] bg-white h-10"
            />

            <button
              onClick={handleUpload}
              disabled={!selectedFileName || !selectedFolderId}
              className={`${
                !selectedFileName || !selectedFolderId
                  ? "bg-gradient-to-r from-gray-200 to-gray-300 cursor-not-allowed text-gray-600"
                  : "bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-600 hover:to-emerald-600 text-white shadow"
              } px-4 rounded-lg h-10`}
              title={!selectedFileName ? "Choose a file" : !selectedFolderId ? "Select a folder" : "Upload & Load"}
            >
              Upload & Load
            </button>
          </>
        )}

        <button onClick={() => loadData()} className="bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-600 hover:to-emerald-600 text-white px-3 rounded-lg h-10 shadow">
          Refresh
        </button>

        {/* Export dropdown + Toggles */}
        <div className="flex gap-3 ml-0 md:ml-6 items-center">
          <ExportMenu onCSV={exportCSV} onXLSX={exportXLSX} onPDF={exportPDF} />

          {/* Pivot toggle */}
          <button
            onClick={() => setPivotOn((p) => !p)}
            className="px-3 rounded-lg font-semibold bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-500 hover:to-emerald-500 text-white h-10 shadow"
            title="Toggle Pivot mode"
          >
            {pivotOn ? "Pivot: ON" : "Pivot: OFF"}
          </button>

          {/* Two-Condition toggle */}
          <button
            onClick={() => setTwoOn((t) => !t)}
            className="px-3 rounded-lg font-semibold bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-600 hover:to-emerald-600 text-white h-10 shadow"
            title="Toggle Two-Condition summary"
          >
            {twoOn ? "2-Cond: ON" : "2-Cond: OFF"}
          </button>

          {/* Trends toggle */}
          <button
            onClick={() => setTrendsOn((v) => !v)}
            className="px-3 rounded-lg font-semibold bg-gradient-to-r from-sky-600 to-sky-500 hover:from-sky-600 hover:to-sky-600 text-white h-10 shadow"
            title="Toggle Trends"
          >
            {trendsOn ? "Trends: ON" : "Trends: OFF"}
          </button>
        </div>
      </div>

      {/* Pivot Controls */}
      {pivotOn && (
        <div className="p-4 bg-emerald-50 border-y border-emerald-200/70">
          <div className="flex flex-wrap items-end gap-3">
            <SearchableSelect
              options={[{ value: "", label: "Row key…" }, ...headers.map((h) => ({ value: h, label: h }))]}
              value={pivotRowKey}
              onChange={(e) => setPivotRowKey(e.target.value)}
              placeholder="Row key…"
              buttonClassName="border border-emerald-200 p-2 rounded-lg min-w-[14rem] bg-white h-10"
            />
            <SearchableSelect
              options={[{ value: "", label: "Dynamic header…" }, ...headers.map((h) => ({ value: h, label: h }))]}
              value={pivotColKey}
              onChange={(e) => setPivotColKey(e.target.value)}
              placeholder="Dynamic header…"
              buttonClassName="border border-emerald-200 p-2 rounded-lg min-w-[14rem] bg-white h-10"
            />
            <SearchableSelect
              options={[
                { value: "", label: pivotAgg === "count" ? "— (count)" : "Value…" },
                ...headers.map((h) => ({ value: h, label: h })),
              ]}
              value={pivotValKey}
              onChange={(e) => setPivotValKey(e.target.value)}
              placeholder={pivotAgg === "count" ? "— (count)" : "Value…"}
              disabled={pivotAgg === "count"}
              buttonClassName="border border-emerald-200 p-2 rounded-lg min-w-[14rem] bg-white h-10"
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
              buttonClassName="border border-emerald-200 p-2 rounded-lg min-w-[10rem] bg-white h-10"
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
                className={`px-3 rounded-lg h-10 shadow ${
                  pivotRows.length
                    ? "bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-500 hover:to-emerald-500 text-white"
                    : "bg-gradient-to-r from-gray-200 to-gray-300 cursor-not-allowed text-gray-600"
                }`}
                title={pivotRows.length ? "Export Pivot (XLSX)" : "Nothing to export yet"}
              >
                Export Pivot
              </button>

              <button
                onClick={exportPivotPDF}
                className={`px-3 rounded-lg h-10 shadow ${
                  pivotRows.length
                    ? "bg-gradient-to-r from-rose-600 to-rose-500 hover:from-rose-600 hover:to-rose-600 text-white"
                    : "bg-gradient-to-r from-gray-200 to-gray-300 cursor-not-allowed text-gray-600"
                }`}
                title={pivotRows.length ? "Export Pivot (PDF)" : "Nothing to export yet"}
                disabled={!pivotRows.length}
              >
                Export Pivot PDF
              </button>

              <button
                onClick={resetPivot}
                className="px-3 bg-gradient-to-r from-white to-gray-50 border border-emerald-200 rounded-lg h-10 hover:from-gray-50 hover:to-gray-100"
                title="Clear pivot selections"
              >
                Reset
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pivot Chart + Pie + Table */}
      {pivotOn && (
        <div className="m-4 bg-white rounded-2xl shadow-xl border border-emerald-100">
          <div className="p-3 font-semibold text-gray-900">📌 Pivot</div>

          {pivotRowKey && pivotColKey && (pivotAgg === "count" || pivotValKey) && pivotRows.length > 0 && pivotSeriesKeys.length > 0 ? (
            <div className="p-0" ref={pivotChartRef}>
              <div className="flex flex-col lg:flex-row gap-0">
                {/* Bar chart (left) - wider */}
                <div className="lg:w-3/4 w-full">
                  <ResponsiveContainer width="100%" height={320}>
                    <BarChart data={pivotRows} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey={pivotRowKey} />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <defs>
                        <linearGradient id="pivotEmerald" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10B981" stopOpacity={0.95} />
                          <stop offset="95%" stopColor="#A7F3D0" stopOpacity={0.25} />
                        </linearGradient>
                      </defs>
                      {pivotSeriesKeys.map((k) => (
                        <Bar key={k} dataKey={k} stackId="pivot" fill="url(#pivotEmerald)" />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* Pie chart (right) */}
                <div className="lg:w-1/4 w-full relative">
                  <div className="absolute top-0 left-0 z-10 flex items-center gap-2">
                    <div className="flex items-center gap-2 bg-white/90 border border-emerald-200 rounded-md px-2 py-1">
                      <label className="flex items-center gap-1 text-xs text-gray-800">
                        <input
                          type="checkbox"
                          className="w-3 h-3 accent-emerald-600"
                          checked={pieMode === "rows"}
                          onChange={() => setPieMode("rows")}
                        />
                        Rows
                      </label>
                      <label className="flex items-center gap-1 text-xs text-gray-800">
                        <input
                          type="checkbox"
                          className="w-3 h-3 accent-emerald-600"
                          checked={pieMode === "cols"}
                          onChange={() => setPieMode("cols")}
                        />
                        Columns
                      </label>
                    </div>

                    <div className="flex items-center gap-2 bg-white/90 border border-emerald-200 rounded-md px-2 py-1">
                      {["5", "10", "15", "20"].map((n) => (
                        <label key={n} className="flex items-center gap-1 text-xs text-gray-800">
                          <input
                            type="checkbox"
                            className="w-3 h-3 accent-emerald-600"
                            checked={pieTopN === n}
                            onChange={() => setPieTopN(n)}
                          />
                          Top {n}
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="w-full h=[320px]">
                    {pieData.length ? (
                      <ResponsiveContainer width="100%" height={320}>
                        <PieChart margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                          <Tooltip formatter={(v, n) => [Number(v).toLocaleString(), n]} />
                          <Pie
                            data={pieData}
                            dataKey="value"
                            nameKey="name"
                            cx="50%"
                            cy="47%"
                            innerRadius="52%"
                            outerRadius="95%"
                            paddingAngle={1}
                            isAnimationActive={false}
                          >
                            {pieData.map((entry, idx) => (
                              <Cell key={`cell-${idx}`} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                            ))}
                          </Pie>
                        </PieChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="text-xs text-gray-500">No pie data for current Pivot.</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-xs text-gray-500 px-3 pb-3">Select Row / Dynamic / Value to render.</div>
          )}

          {pivotRows.length ? (
            <div className="overflow-auto px-3 pb-3">
              <table className="table-auto border-collapse w-full text-sm">
                <thead className="bg-gradient-to-r from-emerald-100 to-white text-gray-800">
                  <tr>
                    {pivotHeaders.map((h) => (
                      <th key={h} className="p-2 border border-emerald-200 border-dashed text-left whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pivotRows.map((row, i) => (
                    <tr key={i} className="odd:bg-white even:bg-emerald-50/40 hover:bg-emerald-50 transition-colors">
                      {pivotHeaders.map((h) => (
                        <td key={h} className="p-2 border border-emerald-200 border-dashed whitespace-nowrap">
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

      {/* Two-Condition Controls & Chart */}
      {twoOn && (
        <div className="p-4 bg-emerald-50/60 border-t border-emerald-200">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold text-gray-900">📊 Two-Condition Summary</h2>
            <button
              onClick={resetSummary}
              className="px-3 bg-gradient-to-r from-white to-gray-50 border border-emerald-200 rounded-lg h-10 hover:from-gray-50 hover:to-gray-100"
              title="Clear selections"
            >
              Reset
            </button>
          </div>

          <div className="grid gap-3 md:grid-cols-3 sm:grid-cols-2 grid-cols-1 items-end">
            <SearchableSelect
              options={[{ value: "", label: "-- Select --" }, ...headers.map((h) => ({ value: h, label: h }))]}
              value={condCol1}
              onChange={(e) => setCondCol1(e.target.value)}
              placeholder="Condition 1…"
              buttonClassName="border border-emerald-200 p-2 rounded-lg min-w-[14rem] bg-white h-10"
              panelWidth={280}
            />
            <SearchableSelect
              options={[{ value: "", label: "-- Select --" }, ...headers.map((h) => ({ value: h, label: h }))]}
              value={condCol2}
              onChange={(e) => setCondCol2(e.target.value)}
              placeholder="Condition 2…"
              buttonClassName="border border-emerald-200 p-2 rounded-lg min-w-[14rem] bg-white h-10"
              panelWidth={280}
            />
            <SearchableSelect
              options={[{ value: "", label: "-- Select --" }, ...headers.map((h) => ({ value: h, label: h }))]}
              value={valueCol}
              onChange={(e) => setValueCol(e.target.value)}
              placeholder="Value column…"
              buttonClassName="border border-emerald-200 p-2 rounded-lg min-w-[14rem] bg-white h-10"
              panelWidth={280}
            />
          </div>

          {condCol1 && condCol2 && valueCol && summaryData?.length > 0 ? (
            <div className="mt-4">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={summaryData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey={condCol2} />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <defs>
                    <linearGradient id="twoCondGreen" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10B981" stopOpacity={0.95} />
                      <stop offset="95%" stopColor="#A7F3D0" stopOpacity={0.25} />
                    </linearGradient>
                  </defs>
                  <Bar dataKey="total" fill="url(#twoCondGreen)" />
                </BarChart>
              </ResponsiveContainer>

              <table className="table-auto border-collapse w-full text-sm mt-6">
                <thead className="bg-gradient-to-r from-emerald-100 to-white text-gray-800">
                  <tr>
                    <th className="p-2 border border-emerald-200 border-dashed">{condCol1}</th>
                    <th className="p-2 border border-emerald-200 border-dashed">{condCol2}</th>
                    <th className="p-2 border border-emerald-200 border-dashed">Total {valueCol}</th>
                  </tr>
                </thead>
                <tbody>
                  {summaryData.map((row, i) => (
                    <tr key={i} className="odd:bg-white even:bg-emerald-50/40 hover:bg-emerald-50 transition-colors">
                      <td className="p-2 border border-emerald-200 border-dashed">{row[condCol1]}</td>
                      <td className="p-2 border border-emerald-200 border-dashed">{row[condCol2]}</td>
                      <td className="p-2 border border-emerald-200 border-dashed font-semibold">
                        ${Number(row.total ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-gray-700 mt-3">ℹ️ Select two conditions and a value column to see results.</p>
          )}
        </div>
      )}

      {/* Trends */}
      {trendsOn && (
        <div className="m-4 bg-white rounded-2xl shadow-2xl border border-sky-100">
          <div className="p-3 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="font-semibold text-gray-900">📈 Trends</div>
              <div className="flex gap-1">
                <button
                  className={`px-2 h-8 rounded border ${!trendsValueKey ? "bg-sky-600 text-white border-sky-600" : "bg-white border-sky-200"}`}
                  onClick={() => setTrendsValueKey("")}
                  title="Count per day"
                >
                  Count
                </button>
                <button
                  className={`px-2 h-8 rounded border ${trendsValueKey ? "bg-sky-600 text-white border-sky-600" : "bg-white border-sky-200"}`}
                  onClick={() => {
                    const key = trendsValueKey || totalsCol || guessedNumericKey || "";
                    if (!key) { alert("No numeric column detected for sum."); return; }
                    setTrendsValueKey(key);
                  }}
                  title={`Sum per day${trendsValueKey ? ` (${trendsValueKey})` : totalsCol ? ` (${totalsCol})` : guessedNumericKey ? ` (${guessedNumericKey})` : ""}`}
                >
                  Sum
                </button>
              </div>
            </div>

            <div className="flex flex-wrap gap-3 items-end">
              <SearchableSelect
                options={[{ value: "", label: "Date column…" }, ...headers.map((h) => ({ value: h, label: h }))]}
                value={trendsDateKey}
                onChange={(e) => setTrendsDateKey(e.target.value)}
                placeholder="Date column…"
                buttonClassName="border border-sky-200 p-2 rounded-lg min-w-[14rem] bg-white h-10"
              />
              <SearchableSelect
                options={[{ value: "", label: "(Count events)" }, ...headers.map((h) => ({ value: h, label: h }))]}
                value={trendsValueKey}
                onChange={(e) => setTrendsValueKey(e.target.value)}
                placeholder="Value column (optional)…"
                buttonClassName="border border-sky-200 p-2 rounded-lg min-w-[16rem] bg-white h-10"
              />
              <SearchableSelect
                options={[
                  { value: "", label: "Granularity…" },
                  { value: "daily", label: "Daily (same day across years)" },
                  { value: "month", label: "Month Total (same month across years)" },
                  { value: "year", label: "Year Total (per year)" },
                ]}
                value={trendGranularity}
                onChange={(e) => setTrendGranularity(e.target.value)}
                placeholder="Granularity…"
                buttonClassName="border border-sky-200 p-2 rounded-lg min-w-[18rem] bg-white h-10"
              />
              <SearchableSelect
                options={[
                  { value: "", label: "Years back…" },
                  { value: "1", label: "1 year back" },
                  { value: "2", label: "2 years back" },
                  { value: "3", label: "3 years back" },
                  { value: "4", label: "4 years back" },
                  { value: "5", label: "5 years back" },
                ]}
                value={yearsBack}
                onChange={(e) => setYearsBack(e.target.value)}
                placeholder="Years back…"
                buttonClassName="border border-sky-200 p-2 rounded-lg min-w-[14rem] bg-white h-10"
              />
            </div>
          </div>

          <div className="px-3 pb-3">
            {trendsDateKey && trendGranularity && yearsBack && trendsData.length ? (
              <ResponsiveContainer width="100%" height={320}>
                {(() => {
                  const measureKeyLocal = trendsValueKey ? "sum" : "count";
                  const maxBack = Math.min(5, Math.max(1, parseInt(yearsBack, 10)));
                  const COLORS = ["#2563EB", "#059669", "#F59E0B", "#DC2626", "#7C3AED", "#0EA5E9"];
                  const lines = [];
                  const currentKey = trendGranularity === "daily" ? measureKeyLocal : "currentAgg";

                  lines.push(
                    <Line
                      key="current"
                      type="monotone"
                      dataKey={currentKey}
                      name={`Current ${trendGranularity}`}
                      dot={false}
                      stroke={COLORS[0]}
                      strokeWidth={3}
                    />
                  );

                  for (let k = 1; k <= maxBack; k++) {
                    lines.push(
                      <Line
                        key={`prev_${k}y`}
                        type="monotone"
                        dataKey={`prev_${k}y`}
                        name={`${k}y back`}
                        dot={false}
                        stroke={COLORS[k] || COLORS[COLORS.length - 1]}
                        strokeWidth={3}
                        strokeDasharray={k % 2 === 0 ? "6 4" : "4 4"}
                      />
                    );
                  }

                  return (
                    <LineChart data={trendsData} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" />
                      <YAxis />
                      <Tooltip content={<TrendTooltip />} />
                      <Legend />
                      {lines}
                    </LineChart>
                  );
                })()}
              </ResponsiveContainer>
            ) : (
              <div className="text-sm text-gray-600">
                Pick a <b>Date</b>, choose <b>Count/Sum</b>, then set <b>Granularity</b> and <b>Years back (1–5)</b>.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Data Table */}
      <div className="m-4 bg-white rounded-2xl shadow-2xl border border-emerald-100 ring-1 ring-emerald-100 relative z-0">
        {sortedData?.length > 0 ? (
          <>
            <div className="p-3 text-sm text-gray-600 border-b border-emerald-100 bg-gradient-to-r from-white to-emerald-50/60">
              {activeFilename ? (
                <>Loaded: <b>{activeFilename}</b></>
              ) : (
                "No sheet loaded"
              )}
            </div>

            {/* Limit viewport to ~30 rows; keep header sticky; scroll the rest */}
            <div
              className="overflow-auto"
              style={{ maxHeight: "960px" }}
            >
              <table className="table-auto border-collapse w-full text-sm">
                <thead className="sticky top-0 bg-gradient-to-r from-emerald-200 to-emerald-100 text-gray-900 shadow-sm z-0">
                  <tr>
                    {headers.map((h) => (
                      <th
                        key={h}
                        ref={(el) => {
                          if (!filterAnchorRefs.current) filterAnchorRefs.current = {};
                          filterAnchorRefs.current[h] = el;
                        }}
                        className="relative border border-emerald-200 border-dashed px-4 py-2 text-left whitespace-nowrap cursor-pointer group"
                        onClick={(e) => {
                          if (openFilterCol === h) return;
                          const isFilterBtn = e.target.closest && e.target.closest(".filter-btn");
                          if (!isFilterBtn) requestSort(h);
                        }}
                      >
                        <div className="flex items-center gap-2">
                          <span className="truncate">
                            {h}
                            {sortConfig?.key === h ? (sortConfig.direction === "asc" ? " ▲" : " ▼") : " ⬍"}
                          </span>

                          <button
                            type="button"
                            ref={(el) => {
                              if (!filterBtnRefs.current) filterBtnRefs.current = {};
                              filterBtnRefs.current[h] = el;
                            }}
                            className={`filter-btn ml-auto text-[11px] h-7 px-2 rounded-md bg-white/80 backdrop-blur border ${
                              columnFilters[h] && columnFilters[h] instanceof Set && columnFilters[h].size > 0
                                ? "border-emerald-400 ring-1 ring-emerald-300"
                                : "border-emerald-200"
                            } text-gray-800 hover:bg-emerald-50 focus:outline-none focus:ring focus:ring-emerald-100`}
                            title="Filter"
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenFilterCol((prev) => (prev === h ? null : h));
                            }}
                          >
                            ▾ Filter
                          </button>

                          {openFilterCol === h && (
                            <ColumnFilterMenu
                              anchorMapRef={filterBtnRefs}
                              columnKey={h}
                              column={h}
                              allValues={uniqueValuesByColumn[h] || []}
                              appliedSelected={
                                columnFilters[h] && columnFilters[h] instanceof Set ? columnFilters[h] : null
                              }
                              onApply={(col, set) => {
                                setColumnFilters((prev) => {
                                  const next = { ...prev };
                                  if (set === null) delete next[col];
                                  else next[col] = new Set(set);
                                  return next;
                                });
                              }}
                              onClear={(col) => {
                                setColumnFilters((prev) => {
                                  const next = { ...prev };
                                  delete next[col];
                                  return next;
                                });
                              }}
                              onClose={() => setOpenFilterCol(null)}
                            />
                          )}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="[&>tr]:h-8">
                  {sortedData.map((row, i) => (
                    <tr key={i} className="odd:bg-white even:bg-emerald-50/40 hover:bg-emerald-50 transition-colors">
                      {headers.map((h) => (
                        <td key={h} className="border border-emerald-200 border-dashed px-4 py-2 whitespace-nowrap">
                          {renderMaybeDate(h, row[h])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

          </>
        ) : (
          <div className="text-gray-600 text-center py-10">
            📂 Use <b>Select Sheet</b> to pick a file you have access to, or upload (admin).
          </div>
        )}
      </div>
    </div>
  );
}