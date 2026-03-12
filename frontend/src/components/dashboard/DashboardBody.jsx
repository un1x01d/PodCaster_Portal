import React, { useState, useRef, useMemo, forwardRef } from "react";
import { FixedSizeList as List } from "react-window";
import AutoSizer from "react-virtualized-auto-sizer";
import axios from "axios";

import SearchableSelect from "../common/SearchableSelect";
import ExportMenu from "./ExportMenu";
import ChartMenu from "./ChartMenu";
import ColumnFilterMenu from "./ColumnFilterMenu";
import SheetTabBar from "./SheetTabBar";
import PivotOverlay from "./PivotOverlay";
import TrendsOverlay from "./TrendsOverlay";
import TwoConditionOverlay from "./TwoConditionOverlay";
import EbitdaMenu from "./EbitdaMenu";

import { renderMaybeDate, formatSmart } from "../../utils/formatting";

export default function DashboardBody(props) {
    const {
        user,
        token,
        API,
        sheetId,
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

        // Data & State
        sortedData,
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
        pieData,
        resetPivot,

        // Two-Condition State
        twoOn, setTwoOn,
        condCol1, setCondCol1,
        condCol2, setCondCol2,
        valueCol, setValueCol,
        summaryData,

        // Trends State
        trendsOn, setTrendsOn,
        trendsDateKey, setTrendsDateKey,
        trendsValueKey, setTrendsValueKey,
        trendGranularity, setTrendGranularity,
        // yearsBack, setYearsBack, // unused?
        trendsData,
        trendYearOptions,
        compareYears, setCompareYears,

        // Actions
        exportCSV,
        exportXLSX,
        exportPDF,

        // Refs
        tableContainerRef,
        filterAnchorRefs,
        filterBtnRefs,

        // Tab support
        tabs,
        activeTab,
        onTabChange,

        // Calcs
        appendCalculatedColumn,

        // Actions
        onDeleteSheet
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

    // Calculate dynamic col widths based on header length
    const colWidths = React.useMemo(() => {
        const widths = {};
        if (displayHeaders) {
            displayHeaders.forEach((h) => {
                // ~8px per character + some padding for sort/filter icons, min 180px
                widths[h] = Math.max(180, h.length * 8 + 60);
            });
        }
        return widths;
    }, [displayHeaders]);

    // Memoize InnerElement to prevent remounts and issues with ref
    const totalRowWidth = React.useMemo(() => {
        return displayHeaders?.reduce((sum, h) => sum + (colWidths[h] || 180), 0) || 0;
    }, [displayHeaders, colWidths]);

    // InnerElement forces the content width to enable horizontal scrolling
    const InnerElement = useMemo(() => forwardRef(({ style, ...rest }, ref) => (
        <div
            ref={ref}
            style={{
                ...style,
                width: `${totalRowWidth}px`,
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
                    <p className="text-slate-400 text-sm">Use the sheet selector in the top navigation bar to load a spreadsheet.</p>
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
                        <label className="flex items-center gap-2 cursor-pointer bg-white border border-slate-300 hover:border-blue-400 hover:bg-blue-50 text-slate-700 rounded-lg px-3 h-8 shadow-sm transition-all group">
                            <input
                                type="file"
                                onChange={(e) => {
                                    const f = e.target.files?.[0];
                                    setFile(f || null);
                                    setSelectedFileName(f?.name || "");
                                    e.target.value = null;
                                }}
                                className="hidden"
                            />
                            <span className="text-lg group-hover:scale-110 transition-transform">📂</span>
                            <span className="text-xs font-semibold whitespace-nowrap max-w-[8rem] truncate">
                                {selectedFileName || "Choose File"}
                            </span>
                        </label>

                        <SearchableSelect
                            options={folderOptions}
                            value={selectedFolderId}
                            onChange={(e) => setSelectedFolderId(e.target.value)}
                            placeholder="Folder (required)…"
                            className="ml-1"
                            buttonClassName="border border-slate-200 px-2 rounded-lg min-w-[14rem] bg-white h-8 text-xs"
                        />

                        <button
                            onClick={() => handleUpload(file, selectedFolderId)}
                            disabled={!file || !selectedFolderId}
                            className={`${!file || !selectedFolderId
                                ? "bg-slate-100 cursor-not-allowed text-slate-400 border border-slate-200"
                                : "bg-blue-600 hover:bg-blue-700 text-white shadow-sm hover:shadow"
                                } px-4 rounded-lg h-8 font-semibold text-xs transition-all flex items-center gap-2 whitespace-nowrap`}
                            title={!file ? "Choose a file" : !selectedFolderId ? "Select a folder" : "Upload & Load"}
                        >
                            Upload & Load
                        </button>
                    </>
                )}

                <button
                    onClick={() => loadData(sheetId, user.role !== "admin" && selectedViewId)}
                    className="bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 px-4 rounded-lg h-8 shadow-sm font-semibold text-xs transition-all whitespace-nowrap"
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
                        buttonClassName="border border-slate-200 px-2 rounded-lg min-w-[14rem] bg-white h-8 text-xs"
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
                        className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 rounded-lg h-8 shadow-sm font-semibold text-xs transition-all flex items-center gap-2 whitespace-nowrap"
                    >
                        Save View
                    </button>
                )}

                <div className="flex gap-3 ml-0 md:ml-6 items-center">
                    <EbitdaMenu
                        headers={displayHeaders}
                        onCalculate={appendCalculatedColumn}
                    />
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
                <PivotOverlay
                    setPivotOn={setPivotOn}
                    pivotRowKey={pivotRowKey} setPivotRowKey={setPivotRowKey}
                    pivotColKey={pivotColKey} setPivotColKey={setPivotColKey}
                    pivotValKey={pivotValKey} setPivotValKey={setPivotValKey}
                    pivotAgg={pivotAgg} setPivotAgg={setPivotAgg}
                    resetPivot={resetPivot}
                    displayHeaders={displayHeaders}
                    pieData={pieData}
                    pivotRows={pivotRows}
                    pivotHeaders={pivotHeaders}
                />
            )}

            {/* Trends Overlay */}
            {trendsOn && (
                <TrendsOverlay
                    setTrendsOn={setTrendsOn}
                    trendsDateKey={trendsDateKey} setTrendsDateKey={setTrendsDateKey}
                    headers={displayHeaders}
                    trendsValueKey={trendsValueKey} setTrendsValueKey={setTrendsValueKey}
                    trendGranularity={trendGranularity} setTrendGranularity={setTrendGranularity}
                    compareYears={compareYears} setCompareYears={setCompareYears}
                    trendYearOptions={trendYearOptions}
                    trendsData={trendsData}
                />
            )}

            {/* Two Condition Overlay */}
            {twoOn && (
                <TwoConditionOverlay
                    setTwoOn={setTwoOn}
                    condCol1={condCol1} setCondCol1={setCondCol1}
                    headers={displayHeaders}
                    condCol2={condCol2} setCondCol2={setCondCol2}
                    valueCol={valueCol} setValueCol={setValueCol}
                    summaryData={summaryData}
                />
            )}

            {/* Data Table */}
            <div className="flex flex-col h-full bg-slate-50">
                <div className="m-4 bg-white rounded-2xl shadow-2xl border border-gray-200 focus:ring-slate-100 relative z-0 flex-1 flex flex-col min-h-[500px] overflow-hidden">
                    {sortedData?.length > 0 ? (
                        <>
                            <div className="sticky top-0 bg-slate-50/90 backdrop-blur text-slate-500 font-semibold border-b border-slate-200 z-10 px-4 py-2 text-xs uppercase tracking-wider flex justify-between items-center">
                                {/* Filename display is now handled in Header mostly, but we can keep a breadcrumb here if needed. 
                                    Or just empty. Original had 'Loaded: ...'. Keeping minimal.
                                */}
                                <span>Loaded: <b className="text-slate-800">{props.activeFilename || "Sheet"}</b></span>
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
                                            style={{ width: colWidths[h] || 180, minWidth: colWidths[h] || 180 }}
                                            ref={(el) => {
                                                if (!filterAnchorRefs.current) filterAnchorRefs.current = {};
                                                filterAnchorRefs.current[h] = el;
                                            }}
                                            className="relative border-r border-slate-200 px-3 py-1 text-[11px] text-left cursor-pointer group flex items-center justify-between hover:bg-slate-200 transition-colors bg-slate-100 text-slate-700 font-bold uppercase tracking-wide h-full"
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
                                                    tableContainerRef={tableContainerRef}
                                                />
                                            )}
                                        </div>
                                    ))}
                                    {/* Spacer for vertical scrollbar compensation */}
                                    <div style={{ minWidth: 100, flexShrink: 0 }}></div>
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
                                                            style={{ ...style, width: totalRowWidth, minWidth: "100%" }}
                                                            className={`flex ${index % 2 === 1 ? "bg-slate-50" : "bg-white"} hover:bg-blue-50/80 transition-colors border-b border-slate-200 items-center h-8`}
                                                        >
                                                            {displayHeaders.map((h) => {
                                                                const val = row[h];
                                                                return (
                                                                    <div
                                                                        key={h}
                                                                        style={{ width: colWidths[h] || 180, minWidth: colWidths[h] || 180 }}
                                                                        className="border-r border-slate-200 px-3 text-xs text-slate-700 truncate h-full flex items-center whitespace-nowrap"
                                                                        title={String(val)}
                                                                    >
                                                                        {typeof val === 'number'
                                                                            ? <span className="font-mono text-slate-600">{formatSmart(val, h)}</span>
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
                            Use <b>Select Sheet</b> in the header to pick a file.
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}