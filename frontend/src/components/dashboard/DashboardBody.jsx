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
        <div className="workspace-shell w-full h-full min-h-0 flex bg-slate-50 relative overflow-hidden pointer-events-auto">
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
                                    {user.role === "admin" ? (
                                        <details className="left-menu-disclosure" open>
                                            <summary className="left-menu-summary font-bold">
                                                Locked Views (Admin)
                                                <span className="left-menu-summary-meta">{activeView?.name || "None active"}</span>
                                            </summary>
                                            <div className="left-menu-nested space-y-2">
                                                <SearchableSelect
                                                    options={viewOptions}
                                                    value={selectedViewId}
                                                    onChange={(e) => {
                                                        const viewId = e.target.value;
                                                        setSelectedViewId(viewId);
                                                        // loadData is triggered by useEffect in App.jsx when selectedViewId changes
                                                    }}
                                                    onDelete={deleteView}
                                                    placeholder="Locked Views…"
                                                    className="w-full"
                                                    buttonClassName="!bg-white !border-slate-300"
                                                    panelWidth={210}
                                                />
                                                <button
                                                    type="button"
                                                    className="w-full btn-premium bg-indigo-600 text-white py-1.5 text-[10px] font-bold shadow-sm hover:bg-indigo-700"
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
                                                buttonClassName="!bg-white !border-slate-300"
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
                                                            placeholder="Select Folder…"
                                                            className="w-full"
                                                            panelClassName="!rounded-md !border-slate-200 !shadow-xl"
                                                            optionClassName="!rounded-sm hover:!bg-slate-50"
                                                            optionTextClassName="!font-bold !text-[0.78rem]"
                                                            searchInputClassName="!text-[0.78rem] !font-bold"
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
                        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
                            <button type="button" onClick={closeDrivePicker} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                                Cancel
                            </button>
                            <button
                                type="button"
                                disabled={!selectedDriveFile || !selectedFolderId || !String(uploadDisplayName || "").trim()}
                                onClick={() => {
                                    if (!selectedDriveFile) return;
                                    handleGoogleDriveImport({
                                        fileId: selectedDriveFile.id,
                                        name: selectedDriveFile.name,
                                        mimeType: selectedDriveFile.mimeType,
                                        folderId: selectedFolderId,
                                        displayName: uploadDisplayName,
                                    });
                                    closeDrivePicker();
                                }}
                                className={`rounded-md px-3 py-1.5 text-xs font-semibold text-white ${!selectedDriveFile || !selectedFolderId || !String(uploadDisplayName || "").trim() ? "cursor-not-allowed bg-slate-400" : "bg-slate-800 hover:bg-slate-900"}`}
                                title={
                                    !selectedFolderId
                                        ? "Select a destination folder first"
                                        : !String(uploadDisplayName || "").trim()
                                            ? "Enter a display name"
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
                        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
                            <button type="button" onClick={closeDropboxPicker} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                                Cancel
                            </button>
                            <button
                                type="button"
                                disabled={!selectedDropboxFile || !selectedFolderId || !String(uploadDisplayName || "").trim()}
                                onClick={() => {
                                    if (!selectedDropboxFile) return;
                                    handleDropboxImport({
                                        pathLower: selectedDropboxFile.pathLower,
                                        name: selectedDropboxFile.name,
                                        folderId: selectedFolderId,
                                        displayName: uploadDisplayName,
                                    });
                                    closeDropboxPicker();
                                }}
                                className={`rounded-md px-3 py-1.5 text-xs font-semibold text-white ${!selectedDropboxFile || !selectedFolderId || !String(uploadDisplayName || "").trim() ? "cursor-not-allowed bg-slate-400" : "bg-slate-800 hover:bg-slate-900"}`}
                                title={
                                    !selectedFolderId
                                        ? "Select a destination folder first"
                                        : !String(uploadDisplayName || "").trim()
                                            ? "Enter a display name"
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
                        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
                            <button type="button" onClick={closeOneDrivePicker} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                                Cancel
                            </button>
                            <button
                                type="button"
                                disabled={!selectedOneDriveFile || !selectedFolderId || !String(uploadDisplayName || "").trim()}
                                onClick={() => {
                                    if (!selectedOneDriveFile) return;
                                    handleOneDriveImport({
                                        itemId: selectedOneDriveFile.id,
                                        name: selectedOneDriveFile.name,
                                        folderId: selectedFolderId,
                                        displayName: uploadDisplayName,
                                    });
                                    closeOneDrivePicker();
                                }}
                                className={`rounded-md px-3 py-1.5 text-xs font-semibold text-white ${!selectedOneDriveFile || !selectedFolderId || !String(uploadDisplayName || "").trim() ? "cursor-not-allowed bg-slate-400" : "bg-slate-800 hover:bg-slate-900"}`}
                                title={
                                    !selectedFolderId
                                        ? "Select a destination folder first"
                                        : !String(uploadDisplayName || "").trim()
                                            ? "Enter a display name"
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
