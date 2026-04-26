import React, { useState, useRef, useMemo, forwardRef } from "react";
import { useNavigate } from "react-router-dom";
import { FixedSizeList as List } from "react-window";
import AutoSizer from "react-virtualized-auto-sizer";
import axios from "axios";

import SearchableSelect from "../common/SearchableSelect";
import ColumnFilterMenu from "./ColumnFilterMenu";
import SheetTabBar from "./SheetTabBar";
import PivotOverlay from "./PivotOverlay";
import TrendsOverlay from "./TrendsOverlay";
import TwoConditionOverlay from "./TwoConditionOverlay";
import EbitdaMenu from "./EbitdaMenu";
import InsightFeed from "./InsightFeed";

import { renderMaybeDate, formatSmart } from "../../utils/formatting";

export default function DashboardBody(props) {
    const navigate = useNavigate();
    const {
        user,
        token,
        API,
        sheetId,
        file,
        setFile,
        selectedFileName,
        setSelectedFileName,
        uploadDisplayName,
        setUploadDisplayName,

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
        ,
        onInsightApplyFilter,
        onInsightOpenChart,
        onInsightSaveView,
    } = props;

    const headerRef = useRef(null);

    // Internal State for Folders (fetched here to ensure freshness)
    const [folders, setFolders] = useState([]);
    const [selectedFolderId, setSelectedFolderId] = useState("");
    const [menuOpen, setMenuOpen] = useState(false);
    const [expandedMenus, setExpandedMenus] = useState({
        view: true,
        data: false,
        insights: false,
        charts: false,
        export: false,
        admin: false,
        danger: false
    });
    const [insightsOn, setInsightsOn] = useState(false);

    const toggleMenu = (key) => {
        setExpandedMenus((prev) => ({ ...prev, [key]: !prev[key] }));
    };

    const activeView = views.find((v) => String(v.id) === String(selectedViewId));

    // Fetch folders on mount
    React.useEffect(() => {
        if (!token) return;
        axios.get(`${API}/folders`, { headers: { Authorization: `Bearer ${token}` } })
            .then(r => setFolders(r.data || []))
            .catch(e => console.error("Fetch folders failed", e));
    }, [token, API]);

    React.useEffect(() => {
        if (!menuOpen) return undefined;
        const onEsc = (e) => {
            if (e.key === "Escape") setMenuOpen(false);
        };
        document.addEventListener("keydown", onEsc);
        return () => document.removeEventListener("keydown", onEsc);
    }, [menuOpen]);

    React.useEffect(() => {
        setMenuOpen(false);
    }, [sheetId]);

    const folderOptions = React.useMemo(() => {
        return [{ value: "", label: "Folder (required)…" }].concat(
            folders.map((f) => ({ value: String(f.id), label: f.path || f.name }))
        );
    }, [folders]);

    const viewOptions = React.useMemo(() => {
        return [{ value: "", label: "Select a view…" }].concat(
            views.map((v) => ({ value: v.id, label: v.name }))
        );
    }, [views]);

    const deleteView = async (id) => {
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
    };

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
            <div className="w-full min-h-screen flex items-center justify-center premium-gradient">
                <div className="glass rounded-[3rem] p-12 w-[32rem] text-center shadow-2xl animate-in zoom-in-95 duration-500">
                    <div className="bg-indigo-600 text-white w-16 h-16 rounded-2xl flex items-center justify-center text-3xl shadow-xl shadow-indigo-200 mx-auto mb-6">📊</div>
                    <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight mb-4">Welcome to Analytics</h2>
                    <p className="text-slate-500 mb-8 font-medium leading-relaxed">Please select a spreadsheet from the navigation menu above to begin your data analysis journey.</p>
                    <div className="flex justify-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-indigo-200 animate-bounce delay-0"></span>
                        <span className="w-2 h-2 rounded-full bg-indigo-400 animate-bounce delay-150"></span>
                        <span className="w-2 h-2 rounded-full bg-indigo-600 animate-bounce delay-300"></span>
                    </div>
                </div>
            </div>
        );
    }

    // Admin or sheet selected: show normal dashboard
    return (
        <div className="w-full h-full min-h-0 flex bg-slate-50 relative overflow-hidden pointer-events-auto">
            <aside
                id="dashboard-left-menu"
                aria-label="Dashboard actions menu"
                className={`left-side-menu h-full shrink-0 sticky top-0 self-start overflow-y-auto shadow-xl border-r border-blue-800 transition-all duration-200 ${menuOpen ? "w-[17rem] p-3" : "w-14 p-2"}`}
            >
                <div className={`flex items-center ${menuOpen ? "justify-between mb-3" : "justify-center mb-2"}`}>
                    {menuOpen && <h2 className="left-menu-heading">Menu</h2>}
                    <button
                        type="button"
                        onClick={() => setMenuOpen((v) => !v)}
                        className="left-menu-close"
                        aria-label={menuOpen ? "Collapse menu" : "Expand menu"}
                        aria-expanded={menuOpen}
                        aria-controls="dashboard-left-menu-content"
                    >
                        {menuOpen ? "◀" : "☰"}
                    </button>
                </div>

                {menuOpen && (
                    <div id="dashboard-left-menu-content">
                        <div className="left-menu-group">
                            <button className="left-menu-section-toggle" onClick={() => toggleMenu("view")} aria-expanded={expandedMenus.view}>
                                <span>View</span>
                                <span>{expandedMenus.view ? "▾" : "▸"}</span>
                            </button>
                            {expandedMenus.view && (
                                <div className="left-menu-submenu">
                                    <button
                                        type="button"
                                        className="left-menu-action"
                                        onClick={() => {
                                            navigate("/");
                                        }}
                                    >
                                        Dashboard Home
                                    </button>
                                    <button
                                        type="button"
                                        className="left-menu-action"
                                        onClick={() => {
                                            loadData(sheetId, user.role !== "admin" && selectedViewId);
                                            setMenuOpen(false);
                                        }}
                                    >
                                        Refresh Data
                                    </button>
                                    {user.role === "admin" && (
                                        <details className="left-menu-disclosure">
                                            <summary className="left-menu-summary">
                                                Saved Views
                                                <span className="left-menu-summary-meta">{activeView?.name || "None selected"}</span>
                                            </summary>
                                            <div className="left-menu-nested">
                                                <SearchableSelect
                                                    options={viewOptions}
                                                    value={selectedViewId}
                                                    onChange={(e) => {
                                                        const viewId = e.target.value;
                                                        setSelectedViewId(viewId);
                                                    }}
                                                    onDelete={deleteView}
                                                    placeholder="Saved Views…"
                                                    className="w-full"
                                                    buttonClassName="w-full border border-blue-700 rounded-lg h-9 bg-blue-900 text-white font-bold px-3"
                                                    panelWidth={320}
                                                />
                                                <button
                                                    type="button"
                                                    className="left-menu-action"
                                                    onClick={() => {
                                                        const name = prompt("Enter a name for this view:");
                                                        if (name) {
                                                            setPendingViewName(name);
                                                            setShowColumnSelector(true);
                                                        }
                                                    }}
                                                >
                                                    Save View
                                                </button>
                                            </div>
                                        </details>
                                    )}
                                </div>
                            )}
                        </div>

                        <div className="left-menu-group">
                            <button className="left-menu-section-toggle" onClick={() => toggleMenu("data")} aria-expanded={expandedMenus.data}>
                                <span>Data</span>
                                <span>{expandedMenus.data ? "▾" : "▸"}</span>
                            </button>
                            {expandedMenus.data && (
                                <div className="left-menu-submenu">
                                    {user.role === "admin" && (
                                        <details className="left-menu-disclosure">
                                            <summary className="left-menu-summary">Upload & Import</summary>
                                            <div className="left-menu-nested">
                                                <label className="left-menu-file-picker">
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
                                                    <span>📂</span>
                                                    <span className="truncate">{selectedFileName || "Choose spreadsheet"}</span>
                                                </label>
                                                <SearchableSelect
                                                    options={folderOptions}
                                                    value={selectedFolderId}
                                                    onChange={(e) => setSelectedFolderId(e.target.value)}
                                                    placeholder="Select Folder…"
                                                    className="w-full"
                                                    buttonClassName="left-menu-action !font-medium !text-[0.74rem]"
                                                    labelClassName="!font-medium tracking-normal"
                                                    panelClassName="!rounded-md !border-slate-200 !shadow-xl"
                                                    optionClassName="!rounded-sm hover:!bg-slate-50"
                                                    optionTextClassName="!font-medium !text-[0.78rem]"
                                                    searchInputClassName="!text-[0.78rem] !font-medium"
                                                    panelWidth={210}
                                                />
                                                <input
                                                    type="text"
                                                    value={uploadDisplayName}
                                                    onChange={(e) => setUploadDisplayName(e.target.value.replace(/\s+/g, "_"))}
                                                    placeholder="Display_name (required)"
                                                    className="left-menu-action"
                                                    maxLength={120}
                                                    required
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        handleUpload(file, selectedFolderId, uploadDisplayName);
                                                    }}
                                                    disabled={!file || !selectedFolderId || !String(uploadDisplayName || "").trim()}
                                                    className={`left-menu-action ${!file || !selectedFolderId || !String(uploadDisplayName || "").trim() ? "left-menu-action-disabled" : ""}`}
                                                    title={
                                                        !file
                                                            ? "Choose a file"
                                                            : !selectedFolderId
                                                                ? "Select a folder"
                                                                : !String(uploadDisplayName || "").trim()
                                                                    ? "Enter a display name"
                                                                    : "Upload & Load"
                                                    }
                                                >
                                                    Upload & Load
                                                </button>
                                            </div>
                                        </details>
                                    )}

                                    <details className="left-menu-disclosure">
                                        <summary className="left-menu-summary">EBITDA Calculator</summary>
                                        <div className="left-menu-nested">
                                            <EbitdaMenu
                                                embedded
                                                headers={displayHeaders}
                                                onCalculate={appendCalculatedColumn}
                                            />
                                        </div>
                                    </details>
                                </div>
                            )}
                        </div>

                        <div className="left-menu-group">
                            <button className="left-menu-section-toggle" onClick={() => toggleMenu("charts")} aria-expanded={expandedMenus.charts}>
                                <span>Chart / Table Config</span>
                                <span>{expandedMenus.charts ? "▾" : "▸"}</span>
                            </button>
                            {expandedMenus.charts && (
                                <div className="left-menu-submenu">
                                    <button className="left-menu-action left-menu-toggle-row" onClick={() => setPivotOn((p) => !p)}>
                                        <span>Pivot Table</span>
                                        <span className="left-menu-state">{pivotOn ? "ON" : "OFF"}</span>
                                    </button>
                                    <button className="left-menu-action left-menu-toggle-row" onClick={() => setTwoOn((p) => !p)}>
                                        <span>Two-Condition</span>
                                        <span className="left-menu-state">{twoOn ? "ON" : "OFF"}</span>
                                    </button>
                                    <button className="left-menu-action left-menu-toggle-row" onClick={() => setTrendsOn((p) => !p)}>
                                        <span>Trends</span>
                                        <span className="left-menu-state">{trendsOn ? "ON" : "OFF"}</span>
                                    </button>
                                </div>
                            )}
                        </div>

                        <div className="left-menu-group">
                            <button className="left-menu-section-toggle" onClick={() => toggleMenu("insights")} aria-expanded={expandedMenus.insights}>
                                <span>Insights</span>
                                <span>{expandedMenus.insights ? "▾" : "▸"}</span>
                            </button>
                            {expandedMenus.insights && (
                                <div className="left-menu-submenu">
                                    <button className="left-menu-action left-menu-toggle-row" onClick={() => setInsightsOn((p) => !p)}>
                                        <span>Insight Feed Panel</span>
                                        <span className="left-menu-state">{insightsOn ? "ON" : "OFF"}</span>
                                    </button>
                                </div>
                            )}
                        </div>

                        <div className="left-menu-group">
                            <button className="left-menu-section-toggle" onClick={() => toggleMenu("export")} aria-expanded={expandedMenus.export}>
                                <span>Export</span>
                                <span>{expandedMenus.export ? "▾" : "▸"}</span>
                            </button>
                            {expandedMenus.export && (
                                <div className="left-menu-submenu">
                                    <button className="left-menu-action" onClick={() => { exportCSV(); }}>Export CSV (.csv)</button>
                                    <button className="left-menu-action" onClick={() => { exportXLSX(); }}>Export Excel (.xlsx)</button>
                                    <button className="left-menu-action" onClick={() => { exportPDF(); }}>Export PDF (.pdf)</button>
                                </div>
                            )}
                        </div>

                        {user.role === "admin" && (
                            <div className="left-menu-group">
                                <button className="left-menu-section-toggle" onClick={() => toggleMenu("admin")} aria-expanded={expandedMenus.admin}>
                                    <span>Admin</span>
                                    <span>{expandedMenus.admin ? "▾" : "▸"}</span>
                                </button>
                                {expandedMenus.admin && (
                                    <div className="left-menu-submenu">
                                        <button
                                            className="left-menu-action"
                                            onClick={() => {
                                                navigate("/users");
                                            }}
                                        >
                                            User / Group / Permissions
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}

                        {user.role === "admin" && (
                            <div className="left-menu-group left-menu-danger">
                                <button className="left-menu-section-toggle" onClick={() => toggleMenu("danger")} aria-expanded={expandedMenus.danger}>
                                    <span>Danger Zone</span>
                                    <span>{expandedMenus.danger ? "▾" : "▸"}</span>
                                </button>
                                {expandedMenus.danger && (
                                    <div className="left-menu-submenu">
                                        <button
                                            className="left-menu-action left-menu-danger-action"
                                            disabled={!sheetId}
                                            onClick={() => {
                                                if (!sheetId) return;
                                                if (!confirm("Delete the current sheet?")) return;
                                                onDeleteSheet(sheetId);
                                            }}
                                        >
                                            Delete Current Sheet
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </aside>

            <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-y-auto">

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
            <div className="flex flex-col flex-1 min-h-0 bg-slate-50">
                <div className="m-4 bg-white rounded-2xl shadow-2xl border border-gray-200 focus:ring-slate-100 relative z-0 flex-1 flex flex-col min-h-[500px] overflow-hidden">
                    {sortedData?.length > 0 ? (
                        <>
                            <div className="sticky top-0 bg-slate-50/90 backdrop-blur text-slate-500 font-semibold border-b border-slate-200 z-10 px-4 py-2 text-xs uppercase tracking-wider flex justify-between items-center">
                                {/* Filename display is now handled in Header mostly, but we can keep a breadcrumb here if needed. 
                                    Or just empty. Original had 'Loaded: ...'. Keeping minimal.
                                */}
                                <span>Dataset: <b className="text-slate-800">{props.activeFilename || "Current Sheet"}</b></span>
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
                                            className="table-pro-text relative border-r border-slate-200 px-3 py-1.5 text-[12px] text-left cursor-pointer group flex items-center justify-between hover:bg-slate-200 transition-colors bg-slate-100 text-slate-800 font-semibold h-full"
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
                                                                    className="table-pro-text border-r border-slate-200 px-3 text-[12px] text-slate-800 truncate h-full flex items-center whitespace-nowrap"
                                                                        title={String(val)}
                                                                    >
                                                                        {typeof val === 'number'
                                                                            ? <span className="table-pro-number text-slate-900 font-medium">{formatSmart(val, h)}</span>
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
                            Please select a sheet from the header to view dataset rows.
                        </div>
                    )}
                </div>
            </div>
            </div>
            {insightsOn && (
                <aside className="w-[22rem] shrink-0 h-full border-l border-slate-200 bg-slate-50 p-3 overflow-y-auto">
                    <InsightFeed
                        sheetId={sheetId}
                        context="workspace"
                        user={user}
                        onApplyFilter={onInsightApplyFilter}
                        onOpenChart={onInsightOpenChart}
                        onSaveView={onInsightSaveView}
                    />
                </aside>
            )}
        </div>
    );
}
