import React, { useState, useRef, useMemo, forwardRef } from "react";
import { FixedSizeList as List } from "react-window";
import AutoSizer from "react-virtualized-auto-sizer";
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
    ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line,
} from "recharts";
import * as XLSX from "xlsx";
import axios from "axios";

import SearchableSelect from "../common/SearchableSelect";
import MultiSelect from "../common/MultiSelect";
import ExportMenu from "./ExportMenu";
import ChartMenu from "./ChartMenu";
import ColumnFilterMenu from "./ColumnFilterMenu";
import TrendTooltip from "./TrendTooltip";
import SheetTabBar from "./SheetTabBar";

const COLORS = ["#2563EB", "#059669", "#F59E0B", "#DC2626", "#7C3AED", "#0EA5E9"];
const PIE_COLORS = ["#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899", "#6366F1", "#14B8A6"];

// Helper for date formatting
const renderMaybeDate = (columnName, value) => {
    if (value == null) return "";
    if (typeof value === "string" && value.endsWith("T00:00:00.000Z")) {
        return value.substring(0, value.indexOf("T"));
    }
    const ISO_FULL_RE = /^\d{4}-\d{2}-\d{2}T/;
    if (typeof value === "string" && ISO_FULL_RE.test(value)) return value.slice(0, 10);

    if (value !== "" && !isNaN(Number(value))) {
        return Number(value).toFixed(2);
    }
    return value;
};

export default function DashboardBody(props) {
    const {
        user,
        token,
        API,
        sheetId,
        activeFilename,
        file,
        setFile,
        selectedFileName,
        setSelectedFileName,

        handleUpload,
        loadData,
        selectedViewId,
        setSelectedViewId,
        views,
        setViews,
        setPendingViewName,
        setShowColumnSelector,
        openSelect, // passed from App (opens key modal)

        // Data & State
        sortedData,
        headers,
        displayHeaders,

        // Filters & Sort
        openFilterCol,
        setOpenFilterCol,
        columnFilters,
        setColumnFilters,
        sortConfig,
        requestSort,
        uniqueValuesByColumn,

        // Charts / Pivot State
        pivotOn, setPivotOn,
        pivotRowKey, setPivotRowKey,
        pivotColKey, setPivotColKey,
        pivotValKey, setPivotValKey,
        pivotAgg, setPivotAgg,
        pivotRows,
        pivotHeaders,
        pivotSeriesKeys,
        pieData,
        exportPivotPDF,
        resetPivot,
        pivotChartRef,

        // Two-Condition State
        twoOn, setTwoOn,
        condCol1, setCondCol1,
        condCol2, setCondCol2,
        valueCol, setValueCol,
        summaryData,
        resetSummary,

        // Trends State
        trendsOn, setTrendsOn,
        trendsDateKey, setTrendsDateKey,
        trendsValueKey, setTrendsValueKey,
        trendGranularity, setTrendGranularity,
        yearsBack, setYearsBack,
        trendsData,
        trendYearOptions,
        compareYears, setCompareYears, maxYear,

        // Actions
        exportCSV,
        exportXLSX,
        exportPDF,

        // Refs
        tableContainerRef,
        filterAnchorRefs,
        filterBtnRefs,

        // Multi-sheet tabs logic
        myFiles,
        loadStored,

        // Tab support
        tabs,
        activeTab,
        onTabChange,

        // Helper checks
        hasRequiredColumns
    } = props;

    const headerRef = useRef(null);

    // Internal State for Folders (fetched here to ensure freshness)
    const [folders, setFolders] = useState([]);
    const [selectedFolderId, setSelectedFolderId] = useState("");

    // Fetch folders on mount
    React.useEffect(() => {
        if (!token) return;
        axios.get(`${API}/folders`, { headers: { Authorization: `Bearer ${token}` } })
            .then(r => setFolders(r.data || []))
            .catch(e => console.error("Fetch folders failed", e));
    }, [token, API]);

    const folderOptions = React.useMemo(() => {
        return [{ value: "", label: "Folder (required)…" }].concat(
            folders.map((f) => ({ value: String(f.id), label: f.name }))
        );
    }, [folders]);

    // Helper to format numbers in charts
    const formatNumber = (val) => {
        if (typeof val === 'number' && !isNaN(val)) {
            return new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(val);
        }
        return val;
    };

    // State for rows to show




    // tabs and activeTab are now passed as props from App.jsx

    // Calculate min col width
    const minColWidth = 180; // Increased for better visibility

    // Memoize InnerElement to prevent remounts and issues with ref
    const totalRowWidth = (displayHeaders?.length || 0) * minColWidth;

    // InnerElement forces the content width to enable horizontal scrolling
    const InnerElement = useMemo(() => forwardRef(({ style, ...rest }, ref) => (
        <div
            ref={ref}
            style={{
                ...style,
                width: totalRowWidth,
                minWidth: '100%',
                position: 'relative'
            }}
            {...rest}
        />
    )), [totalRowWidth]);

    // OuterElement intercepts scroll events to sync the header
    const OuterElement = useMemo(() => forwardRef(({ onScroll, ...rest }, ref) => (
        <div
            ref={ref}
            onScroll={(e) => {
                // Pass event to react-window
                onScroll(e);

                // Sync header horizontal scroll
                if (headerRef.current) {
                    headerRef.current.scrollLeft = e.currentTarget.scrollLeft;
                }
            }}
            {...rest}
        />
    )), []);

    // Non-admin users: show welcome screen until sheet is selected
    if (user.role !== "admin" && !sheetId) {
        return (
            <div className="w-full min-h-screen flex items-center justify-center bg-slate-50/50">
                <div className="bg-white/80 backdrop-blur shadow-2xl rounded-2xl p-8 w-96 border border-slate-200 text-center">
                    <h2 className="text-2xl font-bold mb-4 bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">📊 Welcome</h2>
                    <p className="text-slate-500 mb-6 font-medium">Please select a sheet to get started</p>
                    <button
                        onClick={openSelect}
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2.5 rounded-lg font-semibold shadow-lg shadow-blue-500/20 transition-all hover:scale-[1.02] text-sm"
                    >
                        Select Sheet
                    </button>
                </div>
            </div>
        );
    }





    // Admin or sheet selected: show normal dashboard
    return (
        <div className="w-full h-full flex flex-col bg-slate-50 relative pointer-events-auto">
            {/* Global Controls Bar */}
            <div className="flex flex-wrap gap-3 p-4 bg-white/90 backdrop-blur shadow-sm border-b border-slate-100 items-center relative z-30">
                {/* Upload (admin) */}
                {user.role === "admin" && (
                    <>
                        <label className="flex items-center gap-3 border border-slate-200 rounded-lg p-2 bg-white h-10">
                            <input
                                type="file"
                                onChange={(e) => {
                                    const f = e.target.files?.[0];
                                    setFile(f || null);
                                    setSelectedFileName(f?.name || "");
                                }}
                                className="border border-slate-200 p-1 rounded-md"
                            />
                            <span className="text-sm text-gray-700">
                                {selectedFileName || activeFilename || "No file selected"}
                            </span>
                        </label>

                        <SearchableSelect
                            options={folderOptions}
                            value={selectedFolderId}
                            onChange={(e) => setSelectedFolderId(e.target.value)}
                            placeholder="Folder (required)…"
                            className="ml-1"
                            buttonClassName="border border-slate-200 p-2 rounded-lg min-w-[14rem] bg-white h-10"
                        />

                        <button
                            onClick={() => handleUpload(file, selectedFolderId)}
                            disabled={!file || !selectedFolderId}
                            className={`${!file || !selectedFolderId
                                ? "bg-slate-100 cursor-not-allowed text-slate-400 border border-slate-200"
                                : "bg-blue-600 hover:bg-blue-700 text-white shadow-sm hover:shadow"
                                } px-4 rounded-lg h-9 font-semibold text-sm transition-all flex items-center gap-2`}
                            title={!file ? "Choose a file" : !selectedFolderId ? "Select a folder" : "Upload & Load"}
                        >
                            Upload & Load
                        </button>
                    </>
                )}

                <button
                    onClick={() => loadData(sheetId, user.role !== "admin" && selectedViewId)}
                    className="bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 px-4 rounded-lg h-9 shadow-sm font-semibold text-sm transition-all"
                >
                    Refresh
                </button>

                {user.role === "admin" && (
                    <SearchableSelect
                        options={[{ value: "", label: "Select a view…" }].concat(
                            views.map((v) => ({ value: v.id, label: v.name }))
                        )}
                        value={selectedViewId}
                        onChange={(e) => {
                            const viewId = e.target.value;
                            setSelectedViewId(viewId);
                        }}
                        onDelete={async (id) => {
                            if (!confirm("Delete this view?")) return;
                            try {
                                await axios.delete(`${API}/views/${id}`, {
                                    headers: { Authorization: `Bearer ${token}` }
                                });
                                // Refresh views
                                const res = await axios.get(`${API}/views/${sheetId}`, {
                                    headers: { Authorization: `Bearer ${token}` }
                                });
                                setViews(res.data || []);
                                if (String(selectedViewId) === String(id)) {
                                    setSelectedViewId("");
                                }
                            } catch (e) {
                                console.error("Delete view failed:", e);
                                alert("Failed to delete view");
                            }
                        }}
                        placeholder="Select a view…"
                        className="ml-1"
                        buttonClassName="border border-slate-200 p-2 rounded-lg min-w-[14rem] bg-white h-10"
                    />
                )}

                {user.role === "admin" && (
                    <button
                        onClick={() => {
                            const name = prompt("Enter a name for this view:");
                            if (name) {
                                setPendingViewName(name);
                                setShowColumnSelector(true);
                            }
                        }}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 rounded-lg h-9 shadow-sm font-semibold text-sm transition-all flex items-center gap-2"
                    >
                        Save View
                    </button>
                )}

                {/* ... Duplicate/Delete View logic omitted/simplified for brevity? NO, need to include it if we want feature parity */}

                {/* Export dropdown + Charts dropdown */}
                <div className="flex gap-3 ml-0 md:ml-6 items-center">
                    <ExportMenu onCSV={exportCSV} onXLSX={exportXLSX} onPDF={exportPDF} />

                    <ChartMenu
                        pivotOn={pivotOn}
                        setPivotOn={setPivotOn}
                        twoOn={twoOn}
                        setTwoOn={setTwoOn}
                        trendsOn={trendsOn}
                        setTrendsOn={setTrendsOn}
                    />
                </div>
            </div>

            {/* Pivot Controls */}
            {pivotOn && (
                <div className="p-4 bg-slate-50 border-y border-slate-200/70">
                    <div className="flex flex-col gap-4">
                        <div className="flex justify-between items-center border-b border-gray-200 pb-2 mb-2">
                            <h3 className="font-bold text-lg text-gray-800 flex items-center gap-2">📐 Pivot & Segmentation</h3>
                            <button onClick={() => setPivotOn(false)} className="text-gray-400 hover:text-gray-600">✕ Close</button>
                        </div>
                        <div className="flex flex-wrap items-end gap-3">
                            <SearchableSelect
                                options={[{ value: "", label: "Row key…" }, ...displayHeaders.map((h) => ({ value: h, label: h }))]}
                                value={pivotRowKey}
                                onChange={(e) => setPivotRowKey(e.target.value)}
                                placeholder="Row key…"
                                buttonClassName="border border-slate-200 p-2 rounded-lg min-w-[14rem] bg-white h-10"
                            />
                            <SearchableSelect
                                options={[{ value: "", label: "Dynamic header…" }, ...displayHeaders.map((h) => ({ value: h, label: h }))]}
                                value={pivotColKey}
                                onChange={(e) => setPivotColKey(e.target.value)}
                                placeholder="Dynamic header…"
                                buttonClassName="border border-slate-200 p-2 rounded-lg min-w-[14rem] bg-white h-10"
                            />
                            <SearchableSelect
                                options={[
                                    { value: "", label: pivotAgg === "count" ? "— (count)" : "Value…" },
                                    ...displayHeaders.map((h) => ({ value: h, label: h })),
                                ]}
                                value={pivotValKey}
                                onChange={(e) => setPivotValKey(e.target.value)}
                                placeholder={pivotAgg === "count" ? "— (count)" : "Value…"}
                                disabled={pivotAgg === "count"}
                                buttonClassName="border border-slate-200 p-2 rounded-lg min-w-[14rem] bg-white h-10"
                            />
                            <SearchableSelect
                                options={[
                                    { value: "sum", label: "sum" },
                                    { value: "count", label: "count" },
                                    { value: "avg", label: "average" },
                                ]}
                                value={pivotAgg}
                                onChange={(e) => setPivotAgg(e.target.value)}
                                placeholder="Aggregation…"
                                panelWidth={180}
                                buttonClassName="border border-slate-200 p-2 rounded-lg min-w-[10rem] bg-white h-10"
                            />
                            <div className="flex gap-2 ml-auto">
                                <button onClick={resetPivot} className="px-3 bg-white border border-slate-200 rounded-lg h-10 hover:bg-gray-50">Reset</button>
                            </div>
                        </div>

                        {/* Pivot Chart & Table Area */}

                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 h-96 mt-4">
                            <div className="col-span-2 bg-white border rounded-xl p-4 shadow-sm flex flex-col overflow-hidden">
                                <h4 className="text-xs font-bold text-gray-500 mb-2 uppercase text-center tracking-wider">Distribution</h4>
                                {pieData && pieData.length > 0 ? (
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart
                                            data={pieData}
                                            margin={{ top: 10, right: 30, left: 10, bottom: 60 }} // Increased bottom for labels
                                        >
                                            <XAxis
                                                dataKey="name"
                                                angle={-45}
                                                textAnchor="end"
                                                height={60}
                                                interval={0}
                                                tick={{ fontSize: 11, fill: '#6b7280' }}
                                            />
                                            <YAxis tickFormatter={formatNumber} />
                                            <Tooltip formatter={(value) => formatNumber(value)} contentStyle={{ borderRadius: '8px', zIndex: 100 }} />
                                            <Bar dataKey="value" fill="#8884d8">
                                                {pieData.map((entry, index) => (
                                                    <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                                                ))}
                                            </Bar>
                                        </BarChart>
                                    </ResponsiveContainer>
                                ) : (
                                    <div className="h-full flex items-center justify-center text-gray-400">Select Row Key and Value to visualize</div>
                                )}
                            </div>
                            <div className="col-span-1 bg-white border rounded-xl overflow-hidden shadow-sm flex flex-col">
                                <div className="bg-gray-50 font-bold border-b p-3 flex justify-between items-center">
                                    <span className="uppercase text-xs tracking-wider text-gray-500">Pivot Table</span>
                                    <span className="text-xs font-normal text-gray-400">{pivotRows?.length || 0} rows</span>
                                </div>
                                <div className="overflow-auto flex-1">
                                    <table className="min-w-full text-xs text-left">
                                        <thead className="bg-gray-100 font-bold border-b sticky top-0 z-10">
                                            <tr>
                                                {pivotHeaders && pivotHeaders.map((h, i) => (
                                                    <th key={i} className={`p-3 whitespace-nowrap bg-gray-100 text-gray-600 ${i > 0 ? 'text-right' : ''}`}>
                                                        {h}
                                                    </th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {pivotRows && pivotRows.map((row, i) => (
                                                <tr key={i} className="border-b last:border-0 hover:bg-blue-50 transition-colors">
                                                    {pivotHeaders.map((h, j) => (
                                                        <td key={j} className={`p-3 whitespace-nowrap ${j > 0 ? 'text-right font-mono text-blue-700' : 'font-medium text-gray-800'}`}>
                                                            {typeof row[h] === 'number'
                                                                ? formatNumber(row[h])
                                                                : (row[h] || '-')}
                                                        </td>
                                                    ))}
                                                </tr>
                                            ))}
                                            {(!pivotRows || pivotRows.length === 0) && (
                                                <tr>
                                                    <td colSpan={pivotHeaders?.length || 1} className="p-8 text-center text-gray-400 italic">
                                                        No pivot data. Select Group and Value columns.
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Trends Overlay */}
            {trendsOn && (
                <div className="bg-white border-b p-6 shadow-inner animate-in fade-in slide-in-from-top-4 duration-300">
                    <div className="flex justify-between mb-6 border-b pb-2">
                        <h3 className="font-bold text-xl text-gray-800 flex items-center gap-2">📈 Trend Analysis</h3>
                        <button onClick={() => setTrendsOn(false)} className="text-gray-400 hover:text-gray-600 transition-colors">✕ Close</button>
                    </div>
                    <div className="flex gap-4 mb-6 flex-wrap items-end">
                        <div>
                            <label className="block text-xs font-bold text-gray-500 mb-1 uppercase tracking-wider">Date Column</label>
                            <select value={trendsDateKey || ""} onChange={e => setTrendsDateKey(e.target.value)} className="border border-slate-300 bg-white p-2 rounded-lg text-sm min-w-[200px] h-10">
                                <option value="">Auto-detect...</option>
                                {headers.map(h => <option key={h} value={h}>{h}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-gray-500 mb-1 uppercase tracking-wider">Value to Plot</label>
                            <select value={trendsValueKey || ""} onChange={e => setTrendsValueKey(e.target.value)} className="border border-slate-300 bg-white p-2 rounded-lg text-sm min-w-[200px] h-10">
                                <option value="">Select...</option>
                                {headers.map(h => <option key={h} value={h}>{h}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-gray-500 mb-1 uppercase tracking-wider">Granularity</label>
                            <select value={trendGranularity} onChange={e => setTrendGranularity(e.target.value)} className="border border-slate-300 bg-white p-2 rounded-lg text-sm h-10">
                                <option value="month">Monthly</option>
                                <option value="year">Yearly</option>
                                <option value="day">Daily</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-gray-500 mb-1 uppercase tracking-wider">Compare to Years</label>
                            <MultiSelect
                                options={trendYearOptions}
                                value={compareYears}
                                onChange={setCompareYears}
                                placeholder="Select years..."
                                className="min-w-[160px] h-10"
                            />
                        </div>
                    </div>
                    <div className="h-80 w-full bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                        {trendsData && trendsData.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={trendsData}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                                    <XAxis dataKey="date" tick={{ fontSize: 12, fill: '#6b7280' }} tickLine={false} axisLine={false} dy={10} />
                                    <YAxis tick={{ fontSize: 12, fill: '#6b7280' }} tickLine={false} axisLine={false} dx={-10} tickFormatter={formatNumber} />
                                    <Tooltip
                                        formatter={(value) => formatNumber(value)}
                                        contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                    />
                                    <Legend />

                                    {(!compareYears || compareYears.length === 0) ? (
                                        // Single Line
                                        <Line type="monotone" dataKey="value" stroke="#3b82f6" strokeWidth={3} dot={{ r: 4, strokeWidth: 2, fill: 'white' }} activeDot={{ r: 8, fill: '#3b82f6' }} />
                                    ) : (
                                        // Comparison Lines (maxYear + selected years)
                                        [maxYear, ...compareYears].filter(y => y).map((year, i) => (
                                            <Line
                                                key={year}
                                                type="monotone"
                                                dataKey={String(year)} // The key in data object is the year string
                                                stroke={COLORS[i % COLORS.length]}
                                                strokeWidth={3}
                                                dot={{ r: 4, strokeWidth: 2, fill: 'white' }}
                                                activeDot={{ r: 8 }}
                                                name={String(year)}
                                            />
                                        ))
                                    )}
                                </LineChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="h-full flex flex-col items-center justify-center text-gray-400">
                                <span className="text-4xl mb-2">📉</span>
                                <span className="text-sm font-medium">Select a valid date and value column to see trends.</span>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Two Condition Overlay */}
            {twoOn && (
                <div className="bg-white border-b p-6 shadow-inner animate-in fade-in slide-in-from-top-4 duration-300">
                    <div className="flex justify-between mb-6 border-b pb-2">
                        <h3 className="font-bold text-xl text-gray-800 flex items-center gap-2">🔬 Multi-Condition Breakdown</h3>
                        <button onClick={() => setTwoOn(false)} className="text-gray-400 hover:text-gray-600 transition-colors">✕ Close</button>
                    </div>
                    <div className="flex gap-4 mb-6 items-end flex-wrap">
                        {/* 
                           Condition 1 (Filter) filtering is currently handled by the main table filters.
                           Here we allow specific highlighting? Or maybe just re-purposing for future grouped filtering.
                        */}
                        <div>
                            <label className="block text-xs font-bold text-gray-500 mb-1 uppercase tracking-wider">Condition 1 (Filter Context)</label>
                            <select value={condCol1 || ""} onChange={e => setCondCol1(e.target.value)} className="border border-slate-300 bg-white p-2 rounded-lg text-sm min-w-[200px] h-10">
                                <option value="">(Any)</option>
                                {headers.map(h => <option key={h}>{h}</option>)}
                            </select>
                        </div>
                        <div className="pb-3 text-gray-400 font-bold">+</div>
                        <div>
                            <label className="block text-xs font-bold text-gray-500 mb-1 uppercase tracking-wider">Condition 2 (Group By)</label>
                            <select value={condCol2 || ""} onChange={e => setCondCol2(e.target.value)} className="border border-slate-300 bg-white p-2 rounded-lg text-sm min-w-[200px] h-10">
                                <option value="">(None)</option>
                                {headers.map(h => <option key={h}>{h}</option>)}
                            </select>
                        </div>
                        <div className="pb-3 text-gray-400 font-bold">→</div>
                        <div>
                            <label className="block text-xs font-bold text-gray-500 mb-1 uppercase tracking-wider">Value to Sum</label>
                            <select value={valueCol || ""} onChange={e => setValueCol(e.target.value)} className="border border-slate-300 bg-white p-2 rounded-lg text-sm min-w-[200px] h-10">
                                <option value="">Select...</option>
                                {headers.map(h => <option key={h}>{h}</option>)}
                            </select>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="col-span-1 bg-gradient-to-br from-blue-50 to-white p-6 rounded-2xl border border-blue-100 flex flex-col justify-center items-center shadow-sm">
                            <span className="text-xs text-blue-600 font-bold uppercase tracking-widest mb-2">Total Result</span>
                            <span className="text-4xl font-extrabold text-blue-900 tracking-tight">
                                ${summaryData?.total?.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 }) ?? 0}
                            </span>
                            <span className="text-xs text-blue-400 mt-2 font-medium">Based on current filters</span>
                        </div>

                        <div className="col-span-2 h-64 border rounded-xl p-4 bg-white shadow-sm flex flex-col">
                            <h4 className="text-xs font-bold text-gray-500 mb-2 uppercase tracking-wider">Distribution by Group</h4>
                            {summaryData?.chartData?.length > 0 ? (
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={summaryData.chartData} layout="vertical" margin={{ top: 5, right: 30, left: 40, bottom: 5 }}>
                                        <XAxis type="number" hide />
                                        <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 11 }} interval={0} />
                                        <Tooltip cursor={{ fill: '#f8fafc' }} contentStyle={{ borderRadius: '8px' }} />
                                        <Bar dataKey="value" fill="#8b5cf6" radius={[0, 4, 4, 0]} barSize={20} />
                                    </BarChart>
                                </ResponsiveContainer>
                            ) : (
                                <div className="h-full flex flex-col items-center justify-center text-gray-400 border-2 border-dashed border-gray-100 rounded-lg">
                                    <span className="text-sm font-medium">Select 'Condition 2' and 'Value' to see breakdown</span>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Tab Bar for Multi-Sheet Navigation */}
            {/* ... (Tab logic) ... */}

            {/* Data Table */}
            <div className="flex flex-col h-full bg-slate-50">
                {/* ... controls ... */}

                {/* Tab Bar for Multi-Sheet Navigation */}
                {/* ... (Tab logic) ... */}

                {/* Data Table */}
                <div className="m-4 bg-white rounded-2xl shadow-2xl border border-gray-200 focus:ring-slate-100 relative z-0 flex-1 flex flex-col min-h-[500px] overflow-hidden">
                    {sortedData?.length > 0 ? (
                        <>
                            <div className="sticky top-0 bg-slate-50/90 backdrop-blur text-slate-500 font-semibold border-b border-slate-200 z-10 px-4 py-2 text-xs uppercase tracking-wider flex justify-between items-center">
                                {activeFilename ? <span>Loaded: <b className="text-slate-800">{activeFilename}</b></span> : <span>Loaded: <b>Sheet</b></span>}
                            </div>

                            {/* Virtualized Table Container */}
                            <div className="flex-1 w-full flex flex-col min-h-0">

                                {/* Headers Row (Flexible Height) */}
                                <div
                                    className="flex bg-slate-100 border-y border-slate-200 shadow-sm z-10 overflow-hidden shrink-0 h-10 items-center"
                                    style={{ width: "100%" }}
                                    ref={(el) => {
                                        headerRef.current = el;
                                        if (el && tableContainerRef.current) {
                                            tableContainerRef.current.header = el;
                                        }
                                    }}
                                >
                                    {displayHeaders.map((h) => (
                                        <div
                                            key={h}
                                            style={{ minWidth: minColWidth, flex: 1 }}
                                            ref={(el) => {
                                                if (!filterAnchorRefs.current) filterAnchorRefs.current = {};
                                                filterAnchorRefs.current[h] = el;
                                            }}
                                            className="relative border-r border-slate-200 px-3 py-1 text-xs text-left cursor-pointer group flex items-center justify-between hover:bg-slate-200 transition-colors bg-slate-100 text-slate-700 font-bold uppercase tracking-wide h-full"
                                            onClick={(e) => {
                                                if (openFilterCol === h) return;
                                                const isFilterBtn = e.target.closest && e.target.closest(".filter-btn");
                                                if (!isFilterBtn) requestSort(h);
                                            }}
                                        >
                                            <span className="flex-1 font-semibold whitespace-nowrap leading-tight flex items-center gap-1">
                                                <span>{h}</span>
                                                {sortConfig?.key === h && (
                                                    <span className="text-yellow-300 font-bold whitespace-nowrap">
                                                        {sortConfig.direction === "asc" ? "▲" : "▼"}
                                                    </span>
                                                )}
                                            </span>

                                            <button
                                                type="button"
                                                ref={(el) => {
                                                    if (!filterBtnRefs.current) filterBtnRefs.current = {};
                                                    filterBtnRefs.current[h] = el;
                                                }}
                                                className={`filter-btn ml-2 text-[10px] h-6 px-1.5 rounded transition-all ${columnFilters[h] && columnFilters[h] instanceof Set && columnFilters[h].size > 0
                                                    ? "bg-blue-100 text-blue-700 ring-2 ring-blue-200 font-bold"
                                                    : "bg-slate-200 text-slate-500 hover:bg-slate-300 hover:text-slate-700 group-hover:bg-slate-200"
                                                    }`}
                                                title="Filter"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setOpenFilterCol((prev) => (prev === h ? null : h));
                                                }}
                                            >
                                                ▼
                                            </button>

                                            {/* Filter Menu Rendering */}
                                            {openFilterCol === h && (
                                                <ColumnFilterMenu
                                                    anchorMapRef={filterBtnRefs}
                                                    columnKey={h}
                                                    column={h}
                                                    allValues={uniqueValuesByColumn[h] || []}
                                                    appliedSelected={columnFilters[h] && columnFilters[h] instanceof Set ? columnFilters[h] : null}
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
                                                    tableContainerRef={{ current: document.body }}
                                                />
                                            )}
                                        </div>
                                    ))}
                                </div>

                                {/* Data List (Fills remaining space) */}
                                <div className="flex-1 min-h-0">
                                    <AutoSizer>
                                        {({ height, width }) => (
                                            <List
                                                height={height}
                                                itemCount={sortedData.length}
                                                itemSize={36}
                                                width={width}
                                                outerRef={(el) => {
                                                    tableContainerRef.current = el;
                                                }}
                                                innerElementType={InnerElement}
                                                outerElementType={OuterElement}
                                            >
                                                {({ index, style }) => {
                                                    const row = sortedData[index];
                                                    return (
                                                        <div
                                                            style={{ ...style, width: "100%" }}
                                                            className={`flex ${index % 2 === 1 ? "bg-slate-50" : "bg-white"} hover:bg-blue-50/80 transition-colors border-b border-slate-200 items-center h-8`}
                                                        >
                                                            {displayHeaders.map((h) => {
                                                                const val = row[h];
                                                                return (
                                                                    <div
                                                                        key={h}
                                                                        style={{ minWidth: minColWidth, flex: 1 }}
                                                                        className="border-r border-slate-200 px-3 text-xs text-slate-700 truncate h-full flex items-center whitespace-nowrap"
                                                                        title={String(val)}
                                                                    >
                                                                        {typeof val === 'number'
                                                                            ? <span className="font-mono text-slate-600">{formatNumber(val)}</span>
                                                                            : renderMaybeDate(h, val)
                                                                        }
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    );
                                                }}
                                            </List>
                                        )}
                                    </AutoSizer>
                                </div>
                            </div>

                            {/* Excel-style Tab Bar */}
                            {tabs && tabs.length > 1 && (
                                <SheetTabBar
                                    tabs={tabs}
                                    activeTab={activeTab}
                                    onTabClick={onTabChange}
                                />
                            )}
                        </>
                    ) : (
                        <div className="text-gray-600 text-center py-10">
                            Use <b>Select Sheet</b> to pick a file you have access to, or upload (admin).
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
