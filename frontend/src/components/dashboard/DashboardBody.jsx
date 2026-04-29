import React, { useState, useRef, useMemo, forwardRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { FixedSizeList as List } from "react-window";
import AutoSizer from "react-virtualized-auto-sizer";
import axios from "axios";

import SearchableSelect from "../common/SearchableSelect";
import MultiSelect from "../common/MultiSelect";
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
        fileLabel,
        setFileLabel,
        reportSourceName = "",
        setReportSourceName = () => {},
        reportSources = [],
        reportSourceImports = {},

        handleUpload,
        handleGoogleDriveImport,
        handleDropboxImport,
        handleDropboxConnect,
        dropboxEnabled,
        handleOneDriveImport,
        handleOneDriveConnect,
        oneDriveEnabled,
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
        ,
        onInsightApplyFilter,
        onInsightOpenChart,
        onInsightSaveView,
        fetchUniqueValues,
        onLoadMore,
        isBatchLoading,
        secondaryData,
        secondaryHeaders,
        secondaryIsBatchLoading,
        onLoadMoreSecondary,
        secondarySheetId,
        setSecondarySheetId,
        secondaryTab,
        setSecondaryTab
    } = props;

    const headerRef = useRef(null);
    const secondaryHeaderRef = useRef(null);

    // Sync header scroll with horizontal data scroll
    const handlePrimaryScroll = ({ scrollTop }) => {
        if (comparisonOn && secondaryListRef.current) {
            // Only sync if the position is significantly different to avoid loops
            const currentSecondary = secondaryListRef.current.state?.scrollOffset || 0;
            if (Math.abs(currentSecondary - scrollTop) > 1) {
                secondaryListRef.current.scrollTo(scrollTop);
            }
        }
    };

    const handleSecondaryScroll = ({ scrollTop }) => {
        if (comparisonOn && primaryListRef.current) {
            const currentPrimary = primaryListRef.current.state?.scrollOffset || 0;
            if (Math.abs(currentPrimary - scrollTop) > 1) {
                primaryListRef.current.scrollTo(scrollTop);
            }
        }
    };

    // Detect near-end of scroll for infinite loading
    const handleItemsRendered = ({ visibleStopIndex }) => {
        if (visibleStopIndex >= sortedData.length - 15 && onLoadMore && !isBatchLoading) {
            onLoadMore();
        }
    };

    const handleSecondaryItemsRendered = ({ visibleStopIndex }) => {
        if (visibleStopIndex >= secondaryData.length - 15 && onLoadMoreSecondary && !secondaryIsBatchLoading) {
            onLoadMoreSecondary();
        }
    };

    // Internal State for Folders (fetched here to ensure freshness)
    const [folders, setFolders] = useState([]);
    const [selectedFolderId, setSelectedFolderId] = useState("");
    const [selectedReportSourceId, setSelectedReportSourceId] = useState("");
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

    // Comparison View State
    const [comparisonOn, setComparisonOn] = useState(false);
    const [splitWidth, setSplitWidth] = useState(50); // percentage
    const isResizingRef = useRef(false);

    const [primaryFields, setPrimaryFields] = useState([]);
    const [secondaryFields, setSecondaryFields] = useState([]);

    const activePrimaryFields = primaryFields.length > 0 ? primaryFields : (displayHeaders || []);
    const activeSecondaryFields = secondaryFields.length > 0 ? secondaryFields : (secondaryHeaders || []);

    // Reset fields when headers change
    useEffect(() => {
        if (displayHeaders?.length) {
            setPrimaryFields(displayHeaders);
        }
    }, [displayHeaders]);

    useEffect(() => {
        if (secondaryHeaders?.length) {
            setSecondaryFields(secondaryHeaders);
        }
    }, [secondaryHeaders]);

    const primaryGridRef = useRef(null);
    const secondaryGridRef = useRef(null);
    const primaryListRef = useRef(null);
    const secondaryListRef = useRef(null);

    const handleMouseDown = (e) => {
        isResizingRef.current = true;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        // Add a global class to disable pointer events on all IFrames/Grids
        document.body.classList.add('resizing-active');
    };

    useEffect(() => {
        let animationFrameId;
        
        const handleMouseMove = (e) => {
            if (!isResizingRef.current) return;
            
            // Throttle to screen refresh rate for maximum smoothness
            if (animationFrameId) cancelAnimationFrame(animationFrameId);
            
            animationFrameId = requestAnimationFrame(() => {
                const container = document.getElementById('split-container');
                if (!container || !primaryGridRef.current || !secondaryGridRef.current) return;
                
                const containerRect = container.getBoundingClientRect();
                let newPct = ((e.clientX - containerRect.left) / containerRect.width) * 100;
                newPct = Math.max(15, Math.min(85, newPct));
                
                primaryGridRef.current.style.width = `${newPct}%`;
                secondaryGridRef.current.style.width = `${100 - newPct}%`;
            });
        };
        
        const handleMouseUp = () => {
            if (isResizingRef.current) {
                if (primaryGridRef.current) {
                    const finalPct = parseFloat(primaryGridRef.current.style.width);
                    setSplitWidth(finalPct);
                }
                isResizingRef.current = false;
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                document.body.classList.remove('resizing-active');
            }
        };
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
            if (animationFrameId) cancelAnimationFrame(animationFrameId);
        };
    }, []);

    const [drivePickerOpen, setDrivePickerOpen] = useState(false);
    const [driveEntries, setDriveEntries] = useState([]);
    const [driveLoading, setDriveLoading] = useState(false);
    const [driveBreadcrumbs, setDriveBreadcrumbs] = useState([{ id: "root", name: "My Drive" }]);
    const [selectedDriveFile, setSelectedDriveFile] = useState(null);
    const [dropboxPickerOpen, setDropboxPickerOpen] = useState(false);
    const [dropboxEntries, setDropboxEntries] = useState([]);
    const [dropboxLoading, setDropboxLoading] = useState(false);
    const [dropboxBreadcrumbs, setDropboxBreadcrumbs] = useState([{ path: "", name: "Dropbox" }]);
    const [selectedDropboxFile, setSelectedDropboxFile] = useState(null);
    const [oneDrivePickerOpen, setOneDrivePickerOpen] = useState(false);
    const [oneDriveEntries, setOneDriveEntries] = useState([]);
    const [oneDriveLoading, setOneDriveLoading] = useState(false);
    const [oneDriveBreadcrumbs, setOneDriveBreadcrumbs] = useState([{ id: "root", name: "OneDrive" }]);
    const [selectedOneDriveFile, setSelectedOneDriveFile] = useState(null);
    const [isNewLabel, setIsNewLabel] = useState(false);

    const toggleMenu = (key) => {
        setExpandedMenus((prev) => ({ ...prev, [key]: !prev[key] }));
    };

    const activeView = views.find((v) => String(v.id) === String(selectedViewId));
    const canImportFromDrive = React.useMemo(() => {
        if (!user) return false;
        if (String(user.role || "").toLowerCase() === "admin") return true;
        return !!(user.is_group_admin || user.group_admin || user.is_admin);
    }, [user]);

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
        return [{ value: "", label: "Select folder" }].concat(
            folders.map((f) => ({ value: String(f.id), label: f.path || f.name }))
        );
    }, [folders]);

    const reportSourceOptions = React.useMemo(() => {
        return [{ value: "", label: "Create new report source" }].concat(
            (reportSources || []).filter((source) => !source.is_inferred).map((source) => {
                const name = source.name || source.report_source_name || `Report source ${source.id}`;
                return { value: String(source.id), label: name };
            })
        );
    }, [reportSources]);

    const labelOptions = React.useMemo(() => {
        if (!selectedReportSourceId) return [];
        const imports = reportSourceImports[selectedReportSourceId] || [];
        const labels = new Set(imports.map(i => i.file_label).filter(Boolean));
        const options = Array.from(labels).sort().map(l => ({ label: l, value: l }));
        return [...options, { label: "+ Create New Label", value: "__NEW__" }];
    }, [selectedReportSourceId, reportSourceImports]);

    useEffect(() => {
        if (selectedReportSourceId) {
            // If we have labels, default to the first one.
            if (labelOptions.length > 1) {
                if (!fileLabel || !labelOptions.some(o => o.value === fileLabel)) {
                    const firstVal = labelOptions[0].value;
                    if (firstVal !== "__NEW__") {
                        setFileLabel(firstVal);
                        setIsNewLabel(false);
                    } else {
                        setIsNewLabel(true);
                    }
                }
            } else {
                setIsNewLabel(true);
            }
        } else {
            setIsNewLabel(true);
        }
    }, [selectedReportSourceId, labelOptions]);

    const leftMenuSelectClasses = {
        buttonClassName: "!bg-white/10 !border-white/25 !rounded-[0.6rem] !min-h-[2.05rem] !h-auto !px-2 !py-1.5 !text-[0.76rem] !font-bold !text-white hover:!bg-white/20 hover:!border-white/35 !shadow-none focus:!outline-none focus:!ring-2 focus:!ring-white/20",
        labelClassName: "!text-white !font-bold",
        panelClassName: "!bg-[#001f3f] !text-white !border-white/20 !shadow-2xl !rounded-[0.65rem] !mt-1",
        optionClassName: "!rounded-[0.5rem] !text-white hover:!bg-white/20 !border !border-transparent",
        optionTextClassName: "!font-bold !text-[0.72rem] !text-white",
        selectedOptionClassName: "!bg-white/20 !border-white/25",
        searchInputClassName: "!bg-white/10 !border-white/20 !text-white !placeholder-blue-200 !rounded-[0.5rem] !text-[0.72rem] !font-bold focus:!ring-white/20 focus:!border-white/35",
    };

    const viewOptions = React.useMemo(() => {
        const sorted = (views || []).map((v) => {
            let prefix = "[Rev]";
            if (v.is_global) prefix = "[Global]";
            else if (v.report_source_id && !v.file_label) prefix = "[Source]";
            else if (v.report_source_id && v.file_label) prefix = "[File]";
            return { value: v.id, label: `${prefix} ${v.name}` };
        });
        return [{ value: "", label: "Select a view…" }].concat(sorted);
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

    const isSupportedDriveFile = React.useCallback((entry) => {
        const mime = String(entry?.mimeType || "").toLowerCase();
        const name = String(entry?.name || "").toLowerCase();
        if (mime === "text/csv" || mime === "application/vnd.ms-excel" || mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
            return true;
        }
        return name.endsWith(".csv") || name.endsWith(".xls") || name.endsWith(".xlsx");
    }, []);

    const fetchDriveEntries = React.useCallback(async (nextParentId = "root", nextBreadcrumbs = null) => {
        setDriveLoading(true);
        try {
            const res = await axios.get(`${API}/google/drive/files`, {
                headers: { Authorization: `Bearer ${token}` },
                params: { parentId: nextParentId },
            });
            const raw = Array.isArray(res?.data?.files) ? res.data.files : [];
            const normalized = raw
                .filter((entry) => {
                    const mime = String(entry?.mimeType || "");
                    if (mime === "application/vnd.google-apps.folder") return true;
                    return isSupportedDriveFile(entry);
                })
                .map((entry) => ({ ...entry, id: String(entry.id || "") }))
                .filter((entry) => entry.id);
            setDriveEntries(normalized);
            setDriveBreadcrumbs(Array.isArray(nextBreadcrumbs) && nextBreadcrumbs.length ? nextBreadcrumbs : [{ id: "root", name: "My Drive" }]);
        } catch (e) {
            console.error("Fetch Google Drive entries failed:", e);
            alert(e?.response?.data?.error || "Failed to fetch Google Drive files");
        } finally {
            setDriveLoading(false);
        }
    }, [API, token, isSupportedDriveFile]);

    const openDrivePicker = React.useCallback(() => {
        setSelectedDriveFile(null);
        setDrivePickerOpen(true);
        fetchDriveEntries("root", [{ id: "root", name: "My Drive" }]);
    }, [fetchDriveEntries]);

    const closeDrivePicker = React.useCallback(() => {
        setDrivePickerOpen(false);
        setSelectedDriveFile(null);
    }, []);

    const fetchDropboxEntries = React.useCallback(async (nextPath = "", nextBreadcrumbs = null) => {
        setDropboxLoading(true);
        try {
            const res = await axios.get(`${API}/dropbox/files`, {
                headers: { Authorization: `Bearer ${token}` },
                params: { path: nextPath },
            });
            const raw = Array.isArray(res?.data?.entries) ? res.data.entries : [];
            const normalized = raw
                .map((entry) => ({ ...entry, id: String(entry.id || entry.pathLower || "") }))
                .filter((entry) => entry.id);
            setDropboxEntries(normalized);
            setDropboxBreadcrumbs(Array.isArray(nextBreadcrumbs) && nextBreadcrumbs.length ? nextBreadcrumbs : [{ path: "", name: "Dropbox" }]);
        } catch (e) {
            const errCode = String(e?.response?.data?.error || "");
            if (errCode === "dropbox_not_connected") {
                if (confirm("Dropbox is not connected for this user yet. Connect now?")) {
                    handleDropboxConnect?.();
                }
                return;
            }
            console.error("Fetch Dropbox entries failed:", e);
            alert(e?.response?.data?.error || "Failed to fetch Dropbox files");
        } finally {
            setDropboxLoading(false);
        }
    }, [API, token, handleDropboxConnect]);

    const openDropboxPicker = React.useCallback(() => {
        setSelectedDropboxFile(null);
        setDropboxPickerOpen(true);
        fetchDropboxEntries("", [{ path: "", name: "Dropbox" }]);
    }, [fetchDropboxEntries]);

    const closeDropboxPicker = React.useCallback(() => {
        setDropboxPickerOpen(false);
        setSelectedDropboxFile(null);
    }, []);

    const fetchOneDriveEntries = React.useCallback(async (nextItemId = "root", nextBreadcrumbs = null) => {
        setOneDriveLoading(true);
        try {
            const res = await axios.get(`${API}/onedrive/files`, {
                headers: { Authorization: `Bearer ${token}` },
                params: { itemId: nextItemId },
            });
            const raw = Array.isArray(res?.data?.entries) ? res.data.entries : [];
            const normalized = raw
                .map((entry) => ({ ...entry, id: String(entry.id || "") }))
                .filter((entry) => entry.id);
            setOneDriveEntries(normalized);
            setOneDriveBreadcrumbs(Array.isArray(nextBreadcrumbs) && nextBreadcrumbs.length ? nextBreadcrumbs : [{ id: "root", name: "OneDrive" }]);
        } catch (e) {
            const errCode = String(e?.response?.data?.error || "");
            if (errCode === "onedrive_not_connected") {
                if (confirm("OneDrive is not connected for this user yet. Connect now?")) {
                    handleOneDriveConnect?.();
                }
                return;
            }
            console.error("Fetch OneDrive entries failed:", e);
            alert(e?.response?.data?.error || "Failed to fetch OneDrive files");
        } finally {
            setOneDriveLoading(false);
        }
    }, [API, token, handleOneDriveConnect]);

    const openOneDrivePicker = React.useCallback(() => {
        setSelectedOneDriveFile(null);
        setOneDrivePickerOpen(true);
        fetchOneDriveEntries("root", [{ id: "root", name: "OneDrive" }]);
    }, [fetchOneDriveEntries]);

    const closeOneDrivePicker = React.useCallback(() => {
        setOneDrivePickerOpen(false);
        setSelectedOneDriveFile(null);
    }, []);

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
        return activePrimaryFields?.reduce((sum, h) => sum + (colWidths[h] || 180), 0) || 0;
    }, [activePrimaryFields, colWidths]);

    const secondaryTotalWidth = React.useMemo(() => {
        return activeSecondaryFields?.reduce((sum, h) => sum + 180, 0) || 0;
    }, [activeSecondaryFields]);

    const PrimaryOuterElement = React.useMemo(() => forwardRef(({ onScroll, ...rest }, ref) => (
        <div
            ref={ref}
            onScroll={(e) => {
                onScroll(e);
                if (headerRef.current) {
                    headerRef.current.scrollLeft = e.currentTarget.scrollLeft;
                }
            }}
            {...rest}
        />
    )), []);

    const SecondaryOuterElement = React.useMemo(() => forwardRef(({ onScroll, ...rest }, ref) => (
        <div
            ref={ref}
            onScroll={(e) => {
                onScroll(e);
                if (secondaryHeaderRef.current) {
                    secondaryHeaderRef.current.scrollLeft = e.currentTarget.scrollLeft;
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

    const hasChart = pivotOn || trendsOn || twoOn;

    // Admin or sheet selected: show normal dashboard
    return (
        <div className="workspace-shell w-full h-full min-h-0 flex bg-slate-50 relative pointer-events-auto overflow-hidden">
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

                                    <div className="mt-2 border-t border-blue-800/30 pt-2 px-2">
                                        <button 
                                            className={`w-full flex items-center justify-between px-2 py-1.5 rounded text-[10px] font-bold uppercase tracking-wider transition-colors ${comparisonOn ? 'bg-indigo-600 text-white' : 'text-blue-300 hover:bg-blue-800/40'}`}
                                            onClick={() => setComparisonOn(!comparisonOn)}
                                        >
                                            <span>Split-Screen Mode</span>
                                            <span>{comparisonOn ? 'ON' : 'OFF'}</span>
                                        </button>

                                        {comparisonOn && (
                                            <div className="mt-3 space-y-1.5 px-1 animate-in slide-in-from-left-2 duration-300">
                                                <div className="flex items-center gap-2 opacity-70">
                                                    <div className="w-1 h-1 rounded-full bg-blue-400"></div>
                                                    <label className="text-[9px] text-white font-bold uppercase tracking-[0.1em]">Primary Fields</label>
                                                </div>
                                                <MultiSelect
                                                    options={displayHeaders}
                                                    value={primaryFields}
                                                    onChange={setPrimaryFields}
                                                    placeholder="Grab fields…"
                                                    className="w-full"
                                                    activeColor="blue"
                                                />
                                            </div>
                                        )}

                                        {comparisonOn && (
                                            <div className="mt-4 space-y-1.5 px-0 animate-in slide-in-from-left-2 duration-300 border-t border-white/10 pt-3">
                                                <div className="flex items-center gap-1.5 mb-1 px-3 opacity-70">
                                                    <div className="w-0.5 h-2 bg-emerald-400"></div>
                                                    <label className="text-[9px] text-white font-bold uppercase tracking-[0.1em]">Second Spreadsheet</label>
                                                </div>
                                                <div className="px-2">
                                                    <SearchableSelect
                                                        options={props.myFiles.map(f => ({ value: String(f.id), label: f.display_name || f.filename }))}
                                                        value={secondarySheetId}
                                                        onChange={(e) => {
                                                            setSecondarySheetId(e.target.value);
                                                        }}
                                                        placeholder="Select sheet…"
                                                        className="w-full"
                                                        buttonClassName="!bg-white !border-slate-300 !text-slate-900 !h-8 !rounded-lg !text-[11px] !font-bold hover:!border-slate-400 hover:!bg-slate-50 transition-all shadow-sm"
                                                        panelClassName="!bg-white !border-slate-200 !shadow-2xl !rounded-xl !mt-1"
                                                        optionClassName="hover:!bg-indigo-50 !text-slate-600 hover:!text-slate-900 !rounded-lg"
                                                        optionTextClassName="!font-bold !text-[11px] !text-inherit"
                                                        searchInputClassName="!bg-slate-50 !border-slate-100 !text-slate-900 !placeholder-slate-400 !rounded-lg"
                                                        panelWidth={200}
                                                    />
                                                </div>
                                                {secondarySheetId && (
                                                    <div className="mt-2 px-2 space-y-1.5">
                                                        <div className="flex items-center gap-2 opacity-70">
                                                            <div className="w-1 h-1 rounded-full bg-emerald-400"></div>
                                                            <label className="text-[9px] text-white font-bold uppercase tracking-[0.1em]">Secondary Fields</label>
                                                        </div>
                                                        <MultiSelect
                                                            options={secondaryHeaders}
                                                            value={secondaryFields}
                                                            onChange={setSecondaryFields}
                                                            placeholder="Grab fields…"
                                                            className="w-full"
                                                            activeColor="emerald"
                                                        />
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                    {user.role === "admin" ? (
                                        <details className="left-menu-disclosure">
                                            <summary className="left-menu-summary font-bold">
                                                Locked Views (Admin)
                                                <span className="left-menu-summary-meta">{activeView?.name || "None active"}</span>
                                            </summary>
                                            <div className="left-menu-nested space-y-2 px-0">
                                                <div className="px-1">
                                                    <SearchableSelect
                                                        options={viewOptions}
                                                        value={selectedViewId}
                                                        onChange={(e) => {
                                                            const viewId = e.target.value;
                                                            setSelectedViewId(viewId);
                                                        }}
                                                        onDelete={deleteView}
                                                        placeholder="Locked Views…"
                                                        className="w-full"
                                                        buttonClassName="!bg-white !border-slate-300 !rounded-lg !h-8 !text-[11px] !font-bold !text-slate-900 hover:!border-slate-400 hover:!bg-slate-50 transition-all shadow-sm"
                                                        panelClassName="!bg-white !border-slate-200 !shadow-2xl !rounded-xl !mt-1"
                                                        optionClassName="hover:!bg-indigo-50 !text-slate-600 hover:!text-slate-900 !rounded-lg"
                                                        optionTextClassName="!font-bold !text-[11px] !text-inherit"
                                                        searchInputClassName="!bg-slate-50 !border-slate-100 !text-slate-900 !placeholder-slate-400 !rounded-lg"
                                                        panelWidth={200}
                                                    />
                                                </div>
                                                <div className="px-1">
                                                    <button
                                                        type="button"
                                                        className="w-full btn-premium bg-indigo-600 text-white py-1.5 text-[10px] font-bold shadow-sm hover:bg-indigo-700 rounded-md border-none"

                                                        onClick={() => {
                                                            const name = prompt("Enter a name for this Locked View (includes current filters/pivots):");
                                                            if (name) {
                                                                setPendingViewName(name);
                                                                setShowColumnSelector(true);
                                                            }
                                                        }}
                                                    >
                                                        Create Locked View
                                                    </button>
                                                </div>
                                            </div>
                                        </details>
                                    ) : (
                                        <div className="mt-4 px-2">
                                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-2 ml-1">Available Views</label>
                                            <SearchableSelect
                                                options={viewOptions}
                                                value={selectedViewId}
                                                onChange={(e) => {
                                                    const viewId = e.target.value;
                                                    setSelectedViewId(viewId);
                                                }}
                                                placeholder="Switch View…"
                                                className="w-full"
                                                buttonClassName="!bg-white !border-slate-300 !rounded-lg !h-8 !text-[11px] !font-bold !text-slate-900 hover:!border-slate-400 transition-all shadow-sm"
                                                panelClassName="!bg-white !border-slate-200 !shadow-2xl !rounded-xl !mt-1"
                                                optionClassName="hover:!bg-indigo-50 !text-slate-600 hover:!text-slate-900 !rounded-lg"
                                                optionTextClassName="!font-bold !text-[11px] !text-inherit"
                                                searchInputClassName="!bg-slate-50 !border-slate-100 !text-slate-900 !placeholder-slate-400 !rounded-lg"
                                                panelWidth={210}
                                            />
                                            {activeView && (
                                                <div className="mt-2 p-2 bg-indigo-50 border border-indigo-100 rounded-md">
                                                    <div className="text-[9px] font-bold text-indigo-600 uppercase">Active restriction</div>
                                                    <div className="text-[11px] font-medium text-slate-700 truncate">{activeView.name}</div>
                                                </div>
                                            )}
                                        </div>
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
                                    {canImportFromDrive && (
                                        <details className="left-menu-disclosure">
                                            <summary className="left-menu-summary">Upload & Import</summary>
                                            <div className="left-menu-nested">
                                                {String(user?.role || "").toLowerCase() === "admin" && (
                                                    <>
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
                                                            placeholder="Select folder"
                                                            className="w-full"
                                                            {...leftMenuSelectClasses}
                                                            panelWidth="100%"
                                                        />
                                                        <SearchableSelect
                                                            options={reportSourceOptions}
                                                            value={selectedReportSourceId}
                                                            onChange={(e) => {
                                                                setSelectedReportSourceId(e.target.value);
                                                            }}
                                                            placeholder="Report source (optional)"
                                                            className="w-full"
                                                            {...leftMenuSelectClasses}
                                                            panelWidth="100%"
                                                        />

                                                        {selectedReportSourceId && labelOptions.length > 1 && (
                                                            <SearchableSelect
                                                                options={labelOptions}
                                                                value={isNewLabel ? "__NEW__" : fileLabel}
                                                                onChange={(e) => {
                                                                    if (e.target.value === "__NEW__") {
                                                                        setIsNewLabel(true);
                                                                        setFileLabel("");
                                                                    } else {
                                                                        setIsNewLabel(false);
                                                                        setFileLabel(e.target.value);
                                                                    }
                                                                }}
                                                                placeholder="Select Label"
                                                                className="w-full"
                                                                {...leftMenuSelectClasses}
                                                                panelWidth="100%"
                                                            />
                                                        )}

                                                        {(!selectedReportSourceId || isNewLabel || labelOptions.length <= 1) && (
                                                            <input
                                                                type="text"
                                                                value={fileLabel}
                                                                onChange={(e) => setFileLabel(e.target.value.replace(/\s+/g, "_"))}
                                                                placeholder="Label (required)"
                                                                className="left-menu-action"
                                                                maxLength={120}
                                                                required
                                                            />
                                                        )}

                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                // Use fileLabel for both display_name and file_label.
                                                                // If no source ID, use fileLabel as the source name too.
                                                                handleUpload(file, selectedFolderId, fileLabel, selectedReportSourceId, selectedReportSourceId ? "" : fileLabel, fileLabel);
                                                                setFileLabel("");
                                                            }}
                                                            disabled={!file || (!selectedFolderId && !selectedReportSourceId && !fileLabel.trim()) || (selectedReportSourceId && !fileLabel.trim())}
                                                            className={`left-menu-action ${!file || (!selectedFolderId && !selectedReportSourceId && !fileLabel.trim()) || (selectedReportSourceId && !fileLabel.trim()) ? "left-menu-action-disabled" : ""}`}
                                                            title={
                                                                !file
                                                                    ? "Choose a file"
                                                                    : (!selectedFolderId && !selectedReportSourceId && !fileLabel.trim())
                                                                        ? "Select a folder or enter a label"
                                                                        : "Upload & Load"
                                                            }
                                                        >
                                                            Upload & Load
                                                        </button>
                                                    </>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={openDrivePicker}
                                                    className="left-menu-action inline-flex items-center gap-2"
                                                >
                                                    <svg viewBox="0 0 87 78" width="14" height="14" aria-hidden="true" className="shrink-0">
                                                        <path fill="#0066DA" d="M6.6 77.3L0 65.9L22.4 27.2H35.6L6.6 77.3Z" />
                                                        <path fill="#00AC47" d="M80.4 77.3H6.6L13.2 65.9H87L80.4 77.3Z" />
                                                        <path fill="#EA4335" d="M50.8 0L87 65.9H73.8L37.6 0H50.8Z" />
                                                        <path fill="#00832D" d="M35.6 27.2L42.2 15.8H55.4L48.8 27.2H35.6Z" />
                                                        <path fill="#2684FC" d="M22.4 27.2L29 15.8H42.2L35.6 27.2H22.4Z" />
                                                        <path fill="#FFBA00" d="M48.8 27.2L55.4 15.8L77.8 54.5L71.2 65.9L48.8 27.2Z" />
                                                    </svg>
                                                    <span>Import from Google Drive</span>
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={openDropboxPicker}
                                                    disabled={!dropboxEnabled}
                                                    className={`left-menu-action inline-flex items-center gap-2 ${dropboxEnabled ? "" : "left-menu-action-disabled"}`}
                                                >
                                                    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" className="shrink-0">
                                                        <path fill="#0061FF" d="M6 2 0 6l6 4 6-4-6-4Zm12 0-6 4 6 4 6-4-6-4ZM6 10l-6 4 6 4 6-4-6-4Zm12 0-6 4 6 4 6-4-6-4ZM12 14l-6 4 6 4 6-4-6-4Z" />
                                                    </svg>
                                                    <span>Import from Dropbox</span>
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={openOneDrivePicker}
                                                    disabled={!oneDriveEnabled}
                                                    className={`left-menu-action inline-flex items-center gap-2 ${oneDriveEnabled ? "" : "left-menu-action-disabled"}`}
                                                >
                                                    <img src="https://upload.wikimedia.org/wikipedia/commons/e/e7/Microsoft_OneDrive_Icon_%282025_-_present%29.svg" alt="OneDrive" className="h-3.5 w-3.5 shrink-0" />
                                                    <span>Import from OneDrive</span>
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

            {drivePickerOpen && (
                <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/35 p-4">
                    <div className="w-full max-w-2xl rounded-xl border border-slate-300 bg-white shadow-2xl">
                        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                            <div>
                                <h3 className="text-sm font-semibold text-slate-900">Import from Google Drive</h3>
                                <p className="text-[11px] font-medium text-slate-500">Supported files: CSV, XLS, XLSX</p>
                            </div>
                            <button type="button" onClick={closeDrivePicker} className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                                Close
                            </button>
                        </div>
                        <div className="border-b border-slate-200 px-4 py-2 text-xs text-slate-600">
                            <div className="flex flex-wrap items-center gap-1.5">
                                {driveBreadcrumbs.map((crumb, idx) => (
                                    <button
                                        key={`${crumb.id}-${idx}`}
                                        type="button"
                                        className={`rounded px-1.5 py-0.5 font-semibold ${idx === driveBreadcrumbs.length - 1 ? "bg-slate-200 text-slate-800" : "text-slate-600 hover:bg-slate-100"}`}
                                        onClick={() => {
                                            const nextCrumbs = driveBreadcrumbs.slice(0, idx + 1);
                                            const target = nextCrumbs[nextCrumbs.length - 1];
                                            fetchDriveEntries(target.id, nextCrumbs);
                                            setSelectedDriveFile(null);
                                        }}
                                    >
                                        {crumb.name}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="max-h-[380px] overflow-y-auto p-2">
                            {driveLoading ? (
                                <div className="px-3 py-6 text-center text-sm font-semibold text-slate-500">Loading…</div>
                            ) : driveEntries.length ? (
                                <div className="space-y-1">
                                    {driveEntries.map((entry) => {
                                        const isFolder = String(entry.mimeType || "") === "application/vnd.google-apps.folder";
                                        const selected = selectedDriveFile?.id && selectedDriveFile.id === entry.id;
                                        return (
                                            <button
                                                key={entry.id}
                                                type="button"
                                                onClick={() => {
                                                    if (isFolder) {
                                                        const nextCrumbs = driveBreadcrumbs.concat([{ id: entry.id, name: entry.name || "Folder" }]);
                                                        setSelectedDriveFile(null);
                                                        fetchDriveEntries(entry.id, nextCrumbs);
                                                        return;
                                                    }
                                                    setSelectedDriveFile(entry);
                                                }}
                                                className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left ${selected ? "border-blue-400 bg-blue-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}
                                            >
                                                <span className="truncate text-sm font-medium text-slate-800">
                                                    {isFolder ? "📁 " : "📄 "}
                                                    {entry.name || "Unnamed"}
                                                </span>
                                                <span className="ml-3 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                                    {isFolder ? "Folder" : "File"}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className="px-3 py-6 text-center text-sm font-semibold text-slate-500">No supported files in this folder.</div>
                            )}
                        </div>
                        <div className="p-4 space-y-3">
                            <SearchableSelect
                                options={reportSourceOptions}
                                value={selectedReportSourceId}
                                onChange={(e) => setSelectedReportSourceId(e.target.value)}
                                placeholder="Report source (optional)"
                                className="w-full border border-slate-300 rounded-md text-xs"
                                panelWidth="100%"
                            />
                            {selectedReportSourceId && labelOptions.length > 1 && (
                                <SearchableSelect
                                    options={labelOptions}
                                    value={isNewLabel ? "__NEW__" : fileLabel}
                                    onChange={(e) => {
                                        if (e.target.value === "__NEW__") {
                                            setIsNewLabel(true);
                                            setFileLabel("");
                                        } else {
                                            setIsNewLabel(false);
                                            setFileLabel(e.target.value);
                                        }
                                    }}
                                    placeholder="Select Label"
                                    className="w-full border border-slate-300 rounded-md text-xs"
                                    panelWidth="100%"
                                />
                            )}
                            {(!selectedReportSourceId || isNewLabel || labelOptions.length <= 1) && (
                                <input
                                    type="text"
                                    value={fileLabel}
                                    onChange={(e) => setFileLabel(e.target.value.replace(/\s+/g, "_"))}
                                    placeholder="Label (required)"
                                    className="w-full border border-slate-300 rounded-md px-3 py-1.5 text-xs focus:ring-1 focus:ring-slate-400 outline-none"
                                    maxLength={120}
                                />
                            )}
                        </div>
                        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
                            <button type="button" onClick={closeDrivePicker} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                                Cancel
                            </button>
                            <button
                                type="button"
                                disabled={!selectedDriveFile || (!selectedFolderId && !selectedReportSourceId && !fileLabel.trim()) || (selectedReportSourceId && !fileLabel.trim())}
                                onClick={() => {
                                    if (!selectedDriveFile) return;
                                    handleGoogleDriveImport({
                                        fileId: selectedDriveFile.id,
                                        name: selectedDriveFile.name,
                                        mimeType: selectedDriveFile.mimeType,
                                        folderId: selectedFolderId,
                                        displayName: fileLabel,
                                        reportSourceId: selectedReportSourceId,
                                        reportSourceName: selectedReportSourceId ? "" : fileLabel,
                                        fileLabel: fileLabel,
                                    });
                                    setFileLabel("");
                                    closeDrivePicker();
                                }}
                                className={`rounded-md px-3 py-1.5 text-xs font-semibold text-white ${!selectedDriveFile || (!selectedFolderId && !selectedReportSourceId && !fileLabel.trim()) || (selectedReportSourceId && !fileLabel.trim()) ? "cursor-not-allowed bg-slate-400" : "bg-slate-800 hover:bg-slate-900"}`}
                                title={
                                    (!selectedFolderId && !selectedReportSourceId && !fileLabel.trim())
                                        ? "Select a folder or enter a label"
                                        : !selectedDriveFile
                                            ? "Select a Google Drive file"
                                            : "Import selected file"
                                }
                            >
                                Import selected file
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {dropboxPickerOpen && (
                <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/35 p-4">
                    <div className="w-full max-w-2xl rounded-xl border border-slate-300 bg-white shadow-2xl">
                        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                            <div>
                                <h3 className="text-sm font-semibold text-slate-900">Import from Dropbox</h3>
                                <p className="text-[11px] font-medium text-slate-500">Supported files: CSV, XLS, XLSX</p>
                            </div>
                            <button type="button" onClick={closeDropboxPicker} className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                                Close
                            </button>
                        </div>
                        <div className="border-b border-slate-200 px-4 py-2 text-xs text-slate-600">
                            <div className="flex flex-wrap items-center gap-1.5">
                                {dropboxBreadcrumbs.map((crumb, idx) => (
                                    <button
                                        key={`${crumb.path}-${idx}`}
                                        type="button"
                                        className={`rounded px-1.5 py-0.5 font-semibold ${idx === dropboxBreadcrumbs.length - 1 ? "bg-slate-200 text-slate-800" : "text-slate-600 hover:bg-slate-100"}`}
                                        onClick={() => {
                                            const nextCrumbs = dropboxBreadcrumbs.slice(0, idx + 1);
                                            const target = nextCrumbs[nextCrumbs.length - 1];
                                            fetchDropboxEntries(target.path, nextCrumbs);
                                            setSelectedDropboxFile(null);
                                        }}
                                    >
                                        {crumb.name}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="max-h-[380px] overflow-y-auto p-2">
                            {dropboxLoading ? (
                                <div className="px-3 py-6 text-center text-sm font-semibold text-slate-500">Loading…</div>
                            ) : dropboxEntries.length ? (
                                <div className="space-y-1">
                                    {dropboxEntries.map((entry) => {
                                        const isFolder = String(entry.tag || "") === "folder";
                                        const selected = selectedDropboxFile?.id && selectedDropboxFile.id === entry.id;
                                        return (
                                            <button
                                                key={entry.id}
                                                type="button"
                                                onClick={() => {
                                                    if (isFolder) {
                                                        const nextCrumbs = dropboxBreadcrumbs.concat([{ path: entry.pathLower || "", name: entry.name || "Folder" }]);
                                                        setSelectedDropboxFile(null);
                                                        fetchDropboxEntries(entry.pathLower || "", nextCrumbs);
                                                        return;
                                                    }
                                                    setSelectedDropboxFile(entry);
                                                }}
                                                className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left ${selected ? "border-blue-400 bg-blue-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}
                                            >
                                                <span className="truncate text-sm font-medium text-slate-800">
                                                    {isFolder ? "📁 " : "📄 "}
                                                    {entry.name || "Unnamed"}
                                                </span>
                                                <span className="ml-3 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                                    {isFolder ? "Folder" : "File"}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className="px-3 py-6 text-center text-sm font-semibold text-slate-500">No supported files in this folder.</div>
                            )}
                        </div>
                        <div className="p-4 space-y-3">
                            <SearchableSelect
                                options={reportSourceOptions}
                                value={selectedReportSourceId}
                                onChange={(e) => setSelectedReportSourceId(e.target.value)}
                                placeholder="Report source (optional)"
                                className="w-full border border-slate-300 rounded-md text-xs"
                                panelWidth="100%"
                            />
                            {selectedReportSourceId && labelOptions.length > 1 && (
                                <SearchableSelect
                                    options={labelOptions}
                                    value={isNewLabel ? "__NEW__" : fileLabel}
                                    onChange={(e) => {
                                        if (e.target.value === "__NEW__") {
                                            setIsNewLabel(true);
                                            setFileLabel("");
                                        } else {
                                            setIsNewLabel(false);
                                            setFileLabel(e.target.value);
                                        }
                                    }}
                                    placeholder="Select Label"
                                    className="w-full border border-slate-300 rounded-md text-xs"
                                    panelWidth="100%"
                                />
                            )}
                            {(!selectedReportSourceId || isNewLabel || labelOptions.length <= 1) && (
                                <input
                                    type="text"
                                    value={fileLabel}
                                    onChange={(e) => setFileLabel(e.target.value.replace(/\s+/g, "_"))}
                                    placeholder="Label (required)"
                                    className="w-full border border-slate-300 rounded-md px-3 py-1.5 text-xs focus:ring-1 focus:ring-slate-400 outline-none"
                                    maxLength={120}
                                />
                            )}
                        </div>
                        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
                            <button type="button" onClick={closeDropboxPicker} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                                Cancel
                            </button>
                            <button
                                type="button"
                                disabled={!selectedDropboxFile || (!selectedFolderId && !selectedReportSourceId && !fileLabel.trim()) || (selectedReportSourceId && !fileLabel.trim())}
                                onClick={() => {
                                    if (!selectedDropboxFile) return;
                                    handleDropboxImport({
                                        pathLower: selectedDropboxFile.pathLower,
                                        name: selectedDropboxFile.name,
                                        folderId: selectedFolderId,
                                        displayName: fileLabel,
                                        reportSourceId: selectedReportSourceId,
                                        reportSourceName: selectedReportSourceId ? "" : fileLabel,
                                        fileLabel: fileLabel,
                                    });
                                    setFileLabel("");
                                    closeDropboxPicker();
                                }}
                                className={`rounded-md px-3 py-1.5 text-xs font-semibold text-white ${!selectedDropboxFile || (!selectedFolderId && !selectedReportSourceId && !fileLabel.trim()) || (selectedReportSourceId && !fileLabel.trim()) ? "cursor-not-allowed bg-slate-400" : "bg-slate-800 hover:bg-slate-900"}`}
                                title={
                                    (!selectedFolderId && !selectedReportSourceId && !fileLabel.trim())
                                        ? "Select a folder or enter a label"
                                        : !selectedDropboxFile
                                            ? "Select a Dropbox file"
                                            : "Import selected file"
                                }
                            >
                                Import selected file
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {oneDrivePickerOpen && (
                <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/35 p-4">
                    <div className="w-full max-w-2xl rounded-xl border border-slate-300 bg-white shadow-2xl">
                        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                            <div>
                                <h3 className="text-sm font-semibold text-slate-900">Import from OneDrive</h3>
                                <p className="text-[11px] font-medium text-slate-500">Supported files: CSV, XLS, XLSX</p>
                            </div>
                            <button type="button" onClick={closeOneDrivePicker} className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                                Close
                            </button>
                        </div>
                        <div className="border-b border-slate-200 px-4 py-2 text-xs text-slate-600">
                            <div className="flex flex-wrap items-center gap-1.5">
                                {oneDriveBreadcrumbs.map((crumb, idx) => (
                                    <button
                                        key={`${crumb.id}-${idx}`}
                                        type="button"
                                        className={`rounded px-1.5 py-0.5 font-semibold ${idx === oneDriveBreadcrumbs.length - 1 ? "bg-slate-200 text-slate-800" : "text-slate-600 hover:bg-slate-100"}`}
                                        onClick={() => {
                                            const nextCrumbs = oneDriveBreadcrumbs.slice(0, idx + 1);
                                            const target = nextCrumbs[nextCrumbs.length - 1];
                                            fetchOneDriveEntries(target.id, nextCrumbs);
                                            setSelectedOneDriveFile(null);
                                        }}
                                    >
                                        {crumb.name}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="max-h-[380px] overflow-y-auto p-2">
                            {oneDriveLoading ? (
                                <div className="px-3 py-6 text-center text-sm font-semibold text-slate-500">Loading…</div>
                            ) : oneDriveEntries.length ? (
                                <div className="space-y-1">
                                    {oneDriveEntries.map((entry) => {
                                        const isFolder = !!entry.isFolder;
                                        const selected = selectedOneDriveFile?.id && selectedOneDriveFile.id === entry.id;
                                        return (
                                            <button
                                                key={entry.id}
                                                type="button"
                                                onClick={() => {
                                                    if (isFolder) {
                                                        const nextCrumbs = oneDriveBreadcrumbs.concat([{ id: entry.id, name: entry.name || "Folder" }]);
                                                        setSelectedOneDriveFile(null);
                                                        fetchOneDriveEntries(entry.id, nextCrumbs);
                                                        return;
                                                    }
                                                    setSelectedOneDriveFile(entry);
                                                }}
                                                className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left ${selected ? "border-blue-400 bg-blue-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}
                                            >
                                                <span className="truncate text-sm font-medium text-slate-800">
                                                    {isFolder ? "📁 " : "📄 "}
                                                    {entry.name || "Unnamed"}
                                                </span>
                                                <span className="ml-3 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                                    {isFolder ? "Folder" : "File"}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className="px-3 py-6 text-center text-sm font-semibold text-slate-500">No supported files in this folder.</div>
                            )}
                        </div>
                        <div className="p-4 space-y-3">
                            <SearchableSelect
                                options={reportSourceOptions}
                                value={selectedReportSourceId}
                                onChange={(e) => setSelectedReportSourceId(e.target.value)}
                                placeholder="Report source (optional)"
                                className="w-full border border-slate-300 rounded-md text-xs"
                                panelWidth="100%"
                            />
                            {selectedReportSourceId && labelOptions.length > 1 && (
                                <SearchableSelect
                                    options={labelOptions}
                                    value={isNewLabel ? "__NEW__" : fileLabel}
                                    onChange={(e) => {
                                        if (e.target.value === "__NEW__") {
                                            setIsNewLabel(true);
                                            setFileLabel("");
                                        } else {
                                            setIsNewLabel(false);
                                            setFileLabel(e.target.value);
                                        }
                                    }}
                                    placeholder="Select Label"
                                    className="w-full border border-slate-300 rounded-md text-xs"
                                    panelWidth="100%"
                                />
                            )}
                            {(!selectedReportSourceId || isNewLabel || labelOptions.length <= 1) && (
                                <input
                                    type="text"
                                    value={fileLabel}
                                    onChange={(e) => setFileLabel(e.target.value.replace(/\s+/g, "_"))}
                                    placeholder="Label (required)"
                                    className="w-full border border-slate-300 rounded-md px-3 py-1.5 text-xs focus:ring-1 focus:ring-slate-400 outline-none"
                                    maxLength={120}
                                />
                            )}
                        </div>
                        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
                            <button type="button" onClick={closeOneDrivePicker} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                                Cancel
                            </button>
                            <button
                                type="button"
                                disabled={!selectedOneDriveFile || (!selectedFolderId && !selectedReportSourceId && !fileLabel.trim()) || (selectedReportSourceId && !fileLabel.trim())}
                                onClick={() => {
                                    if (!selectedOneDriveFile) return;
                                    handleOneDriveImport({
                                        itemId: selectedOneDriveFile.id,
                                        name: selectedOneDriveFile.name,
                                        folderId: selectedFolderId,
                                        displayName: fileLabel,
                                        reportSourceId: selectedReportSourceId,
                                        reportSourceName: selectedReportSourceId ? "" : fileLabel,
                                        fileLabel: fileLabel,
                                    });
                                    setFileLabel("");
                                    closeOneDrivePicker();
                                }}
                                className={`rounded-md px-3 py-1.5 text-xs font-semibold text-white ${!selectedOneDriveFile || (!selectedFolderId && !selectedReportSourceId && !fileLabel.trim()) || (selectedReportSourceId && !fileLabel.trim()) ? "cursor-not-allowed bg-slate-400" : "bg-slate-800 hover:bg-slate-900"}`}
                                title={
                                    (!selectedFolderId && !selectedReportSourceId && !fileLabel.trim())
                                        ? "Select a folder or enter a label"
                                        : !selectedOneDriveFile
                                            ? "Select a OneDrive file"
                                            : "Import selected file"
                                }
                            >
                                Import selected file
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-y-auto scroll-smooth">
                <div className="flex flex-col min-h-full">

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
                    tabs={tabs}
                    activeTab={activeTab}
                    onTabChange={onTabChange}
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
                    tabs={tabs}
                    activeTab={activeTab}
                    onTabChange={onTabChange}
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
                    tabs={tabs}
                    activeTab={activeTab}
                    onTabChange={onTabChange}
                    condCol2={condCol2} setCondCol2={setCondCol2}
                    valueCol={valueCol} setValueCol={setValueCol}
                    summaryData={summaryData}
                />
            )}

            <div className={`flex flex-col flex-1 min-h-0 bg-slate-50`}>
                <div id="split-container" className={`m-4 bg-white rounded-2xl shadow-2xl border border-gray-200 focus:ring-slate-100 relative z-0 flex-1 flex overflow-hidden ${comparisonOn ? 'flex-row gap-0' : 'flex-col'} ${hasChart ? 'min-h-[750px]' : 'min-h-[600px]'}`} style={comparisonOn ? { height: '650px' } : {}}>
                    
                    {/* PRIMARY GRID */}
                    <div 
                        ref={primaryGridRef}
                        className={`flex flex-col h-full min-h-0 min-w-0 ${comparisonOn ? '' : 'flex-1'}`}
                        style={comparisonOn ? { width: `${splitWidth}%`, flex: `0 0 ${splitWidth}%` } : {}}
                    >
                        {sortedData?.length > 0 ? (
                            <>
                                <div className="sticky top-0 bg-slate-50/90 backdrop-blur text-slate-500 font-semibold border-b border-slate-200 z-10 px-4 py-2 text-[10px] uppercase tracking-wider flex justify-between items-center shrink-0">
                                    <span>Primary: <b className="text-indigo-600">{props.activeFilename || "Current Sheet"}</b></span>
                                </div>

                                <div className="flex-1 w-full flex flex-col min-h-0">
                                    <div
                                        className="flex bg-slate-100 border-b border-slate-200 shadow-sm z-10 overflow-hidden shrink-0 h-10 items-center no-scrollbar"
                                        style={{ width: "100%" }}
                                        ref={headerRef}
                                    >
                                        <div style={{ display: 'flex', width: totalRowWidth, height: '100%' }}>
                                            {activePrimaryFields.map((h) => (
                                                <div
                                                    key={h}
                                                    style={{ width: colWidths[h] || 180, minWidth: colWidths[h] || 180 }}
                                                    className="table-pro-text relative border-r border-slate-200 px-3 py-1.5 text-[11px] text-left cursor-pointer group flex items-center justify-between hover:bg-slate-200 transition-colors bg-slate-100 text-slate-800 font-bold h-full"
                                                    onClick={() => requestSort(h)}
                                                >
                                                    <span className="truncate">{h}</span>
                                                    {sortConfig?.key === h && <span className="ml-1 text-[9px]">{sortConfig.direction === "asc" ? "▲" : "▼"}</span>}
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="flex-1 min-h-0 relative">
                                        <div className="absolute inset-0">
                                            <AutoSizer key={comparisonOn ? 'split-primary' : 'single-primary'}>
                                                {({ height, width }) => (
                                                    <List
                                                        ref={primaryListRef}
                                                        height={height}
                                                        itemCount={sortedData.length}
                                                        itemSize={36}
                                                        width={width}
                                                        onItemsRendered={handleItemsRendered}
                                                        onScroll={handlePrimaryScroll}
                                                        outerElementType={PrimaryOuterElement}
                                                        innerElementType={({ style, ...rest }) => (
                                                            <div style={{ ...style, width: totalRowWidth, position: 'relative' }} {...rest} />
                                                        )}
                                                    >
                                                        {({ index, style }) => {
                                                            const row = sortedData[index];
                                                            return (
                                                                <div
                                                                    style={{ ...style, width: (activePrimaryFields.length * 180), minWidth: "100%" }}
                                                                    className={`flex ${index % 2 === 1 ? "bg-slate-50" : "bg-white"} hover:bg-indigo-50/50 transition-colors border-b border-slate-100 items-center h-8`}
                                                                >
                                                                    {activePrimaryFields.map((h) => (
                                                                        <div key={h} style={{ width: colWidths[h] || 180, minWidth: colWidths[h] || 180 }} className="border-r border-slate-100 px-3 text-[11px] text-slate-700 truncate h-full flex items-center">
                                                                            {typeof row[h] === 'number' ? formatSmart(row[h], h) : renderMaybeDate(h, row[h])}
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            );
                                                        }}
                                                    </List>
                                                )}
                                            </AutoSizer>
                                        </div>
                                        {isBatchLoading && (
                                            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-indigo-600 text-white px-3 py-1 rounded-full text-[9px] font-bold shadow-lg animate-bounce z-50">
                                                Loading rows...
                                            </div>
                                        )}
                                    </div>
                                    {tabs && tabs.length > 1 && (
                                        <div className="sticky bottom-0 z-30 bg-white border-t border-slate-200">
                                            <SheetTabBar
                                                tabs={tabs}
                                                activeTab={activeTab}
                                                onTabClick={onTabChange}
                                            />
                                        </div>
                                    )}
                                </div>
                            </>
                        ) : (
                            <div className="text-gray-400 text-center py-20 text-xs">Select primary sheet.</div>
                        )}
                    </div>

                    {/* RESIZER */}
                    {comparisonOn && (
                        <div 
                            className="w-1.5 h-full bg-slate-200 hover:bg-indigo-400 cursor-col-resize transition-colors z-20 flex items-center justify-center group"
                            onMouseDown={handleMouseDown}
                        >
                            <div className="w-px h-8 bg-slate-400 group-hover:bg-white" />
                        </div>
                    )}

                    {/* SECONDARY GRID */}
                    {comparisonOn && (
                        <div 
                            ref={secondaryGridRef}
                            className="flex flex-col h-full min-h-0 min-w-0 bg-slate-50/30"
                            style={{ width: `${100 - splitWidth}%`, flex: `1 1 ${100 - splitWidth}%` }}
                        >
                            {secondaryData?.length > 0 ? (
                                <>
                                    <div className="sticky top-0 bg-slate-100/90 backdrop-blur text-slate-500 font-semibold border-b border-slate-200 z-10 px-4 py-2 text-[10px] uppercase tracking-wider flex justify-between items-center shrink-0">
                                        <span>Secondary: <b className="text-emerald-600">{props.myFiles.find(f => String(f.id) === String(secondarySheetId))?.display_name || "Sheet B"}</b></span>
                                    </div>

                                    <div className="flex-1 w-full flex flex-col min-h-0">
                                        <div 
                                            className="flex bg-slate-200/50 border-b border-slate-200 shadow-sm z-10 overflow-hidden shrink-0 h-10 items-center"
                                            ref={secondaryHeaderRef}
                                        >
                                            <div style={{ display: 'flex', width: secondaryTotalWidth, height: '100%' }}>
                                                {activeSecondaryFields.map((h) => (
                                                    <div key={h} style={{ width: 180, minWidth: 180 }} className="px-3 py-1.5 text-[11px] font-bold text-slate-700 border-r border-slate-200 truncate h-full flex items-center">
                                                        {h}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>

                                        <div className="flex-1 min-h-0 relative">
                                            <div className="absolute inset-0">
                                                <AutoSizer key="split-secondary">
                                                    {({ height, width }) => (
                                                        <List
                                                            ref={secondaryListRef}
                                                            height={height}
                                                            itemCount={secondaryData.length}
                                                            itemSize={36}
                                                            width={width}
                                                            onItemsRendered={handleSecondaryItemsRendered}
                                                            onScroll={handleSecondaryScroll}
                                                            outerElementType={SecondaryOuterElement}
                                                            innerElementType={({ style, ...rest }) => (
                                                                <div style={{ ...style, width: secondaryTotalWidth, position: 'relative' }} {...rest} />
                                                            )}
                                                        >
                                                            {({ index, style }) => {
                                                                const row = secondaryData[index];
                                                                return (
                                                                    <div style={style} className={`flex ${index % 2 === 1 ? "bg-slate-100/30" : "bg-white"} border-b border-slate-100 items-center h-8`}>
                                                                        {activeSecondaryFields.map((h) => (
                                                                            <div key={h} style={{ width: 180, minWidth: 180 }} className="border-r border-slate-100 px-3 text-[11px] text-slate-600 truncate">
                                                                                {typeof row[h] === 'number' ? formatSmart(row[h], h) : renderMaybeDate(h, row[h])}
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                );
                                                            }}
                                                        </List>
                                                    )}
                                                </AutoSizer>
                                            </div>
                                            {secondaryIsBatchLoading && (
                                                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-emerald-600 text-white px-3 py-1 rounded-full text-[9px] font-bold shadow-lg animate-bounce z-50">
                                                    Loading rows...
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </>
                            ) : (
                                <div className="h-full flex flex-col items-center justify-center p-8 text-center">
                                    <div className="text-4xl mb-3">◫</div>
                                    <div className="text-slate-400 font-bold text-[11px] uppercase tracking-widest">Select comparison sheet</div>
                                </div>
                            )}
                            {secondaryIsBatchLoading && (
                                <div className="absolute inset-0 bg-white/60 backdrop-blur-[1px] flex items-center justify-center z-50">
                                    <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
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
